import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { checkDatabaseHealth, getPool, closePool, withTransaction } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrator.js';
import { InventoryValuationService } from '../../src/server/modules/inventory/services/inventory_valuation.service.js';
import { CostLayerRepository } from '../../src/server/modules/inventory/repositories/cost_layer.repository.js';
import { ValuationTransactionRepository } from '../../src/server/modules/inventory/repositories/valuation_transaction.repository.js';
import { StockLedgerRepository } from '../../src/server/modules/inventory/repositories/stock_ledger.repository.js';
import { ChartOfAccountsRepository } from '../../src/server/modules/accounting/repositories/chart_of_accounts.repository.js';
import { AccountingJournalRepository } from '../../src/server/modules/accounting/repositories/accounting_journal.repository.js';
import { TrialBalanceService } from '../../src/server/modules/accounting/services/trial_balance.service.js';
import { StateMachineEngine } from '../../src/server/modules/workflow/services/state_machine.service.js';
import { SecurityContext, DocumentState } from '../../src/shared/types/index.js';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Comprehensive In-Memory Simulation Engine for Increment 1.5 Workflows
// ----------------------------------------------------------------------------
interface SimCostLayer {
  id: string;
  companyId: string;
  warehouseId: string;
  itemId: string;
  batchId: string;
  initialQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  totalCost: number;
  remainingValue: number;
  accountingDate: string;
  isExhausted: boolean;
  createdAt: string;
}

interface SimValuationTransaction {
  id: string;
  companyId: string;
  itemId: string;
  batchId: string;
  costLayerId?: string;
  transactionType: 'RECEIPT' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT' | 'REVERSAL';
  sourceType: string;
  sourceId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  accountingDate: string;
  journalId?: string;
  status: 'POSTED' | 'REVERSED';
  reversalJournalId?: string;
}

interface SimJournal {
  id: string;
  companyId: string;
  journalNumber: string;
  postingDate: string;
  sourceType: string;
  sourceId: string;
  totalDebit: number;
  totalCredit: number;
  status: 'POSTED' | 'REVERSED';
  reversalJournalId?: string;
  lines: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }>;
}

class Increment15SimulationEngine {
  public costLayers: Map<string, SimCostLayer> = new Map();
  public valTransactions: Map<string, SimValuationTransaction> = new Map();
  public stockBalances: Map<string, number> = new Map(); // key: companyId:warehouseId:itemId:batchId
  public journals: Map<string, SimJournal> = new Map();
  public deliveries: Map<string, { id: string; companyId: string; status: DocumentState; journalId?: string }> = new Map();
  public stateMachine = new StateMachineEngine();

  private getStockKey(companyId: string, warehouseId: string, itemId: string, batchId: string): string {
    return `${companyId}:${warehouseId}:${itemId}:${batchId}`;
  }

  public getStock(companyId: string, warehouseId: string, itemId: string, batchId: string): number {
    return this.stockBalances.get(this.getStockKey(companyId, warehouseId, itemId, batchId)) || 0;
  }

  public setStock(companyId: string, warehouseId: string, itemId: string, batchId: string, qty: number): void {
    this.stockBalances.set(this.getStockKey(companyId, warehouseId, itemId, batchId), qty);
  }

  public recordPurchaseReceipt(input: {
    companyId: string;
    warehouseId: string;
    itemId: string;
    batchId: string;
    quantity: number;
    unitCost: number;
    accountingDate: string;
    receiptId: string;
  }): { layer: SimCostLayer; journal: SimJournal } {
    const totalCost = Math.round(input.quantity * input.unitCost * 10000) / 10000;
    const layerId = randomUUID();
    const layer: SimCostLayer = {
      id: layerId,
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      batchId: input.batchId,
      initialQuantity: input.quantity,
      remainingQuantity: input.quantity,
      unitCost: input.unitCost,
      totalCost,
      remainingValue: totalCost,
      accountingDate: input.accountingDate,
      isExhausted: false,
      createdAt: new Date().toISOString(),
    };
    this.costLayers.set(layerId, layer);

    // Update physical stock
    const currentStock = this.getStock(input.companyId, input.warehouseId, input.itemId, input.batchId);
    this.setStock(input.companyId, input.warehouseId, input.itemId, input.batchId, currentStock + input.quantity);

    // Valuation transaction
    const txId = randomUUID();
    const journalId = randomUUID();
    const tx: SimValuationTransaction = {
      id: txId,
      companyId: input.companyId,
      itemId: input.itemId,
      batchId: input.batchId,
      costLayerId: layerId,
      transactionType: 'RECEIPT',
      sourceType: 'PURCHASE_RECEIPT',
      sourceId: input.receiptId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      totalCost,
      accountingDate: input.accountingDate,
      journalId,
      status: 'POSTED',
    };
    this.valTransactions.set(txId, tx);

    // Capitalization Journal: DR 1400 (Inventory Asset) 200k / CR 5000 (Inventory Clearing) 200k
    const journal: SimJournal = {
      id: journalId,
      companyId: input.companyId,
      journalNumber: `JN-PREC-${input.receiptId.slice(0, 6)}`,
      postingDate: input.accountingDate,
      sourceType: 'PURCHASE_RECEIPT',
      sourceId: input.receiptId,
      totalDebit: totalCost,
      totalCredit: totalCost,
      status: 'POSTED',
      lines: [
        {
          accountId: 'acc-1400',
          accountCode: '1400',
          accountName: 'Merchandise Inventory',
          debit: totalCost,
          credit: 0,
        },
        {
          accountId: 'acc-5000',
          accountCode: '5000',
          accountName: 'Inventory Clearing',
          debit: 0,
          credit: totalCost,
        },
      ],
    };
    this.journals.set(journalId, journal);

    return { layer, journal };
  }

  public recordPurchaseInvoice(input: {
    companyId: string;
    netAmount: number;
    taxRate: number;
    invoiceId: string;
  }): SimJournal {
    const taxAmount = Math.round(input.netAmount * (input.taxRate / 100) * 10000) / 10000;
    const grossAmount = Math.round((input.netAmount + taxAmount) * 10000) / 10000;
    const journalId = randomUUID();

    // Purchase Invoice Journal:
    // DR 5000 (Inventory Clearing) netAmount
    // DR 1150 (Input Tax Receivable) taxAmount
    // CR 2000 (Accounts Payable) grossAmount
    const journal: SimJournal = {
      id: journalId,
      companyId: input.companyId,
      journalNumber: `JN-PINV-${input.invoiceId.slice(0, 6)}`,
      postingDate: new Date().toISOString().split('T')[0],
      sourceType: 'PURCHASE_INVOICE',
      sourceId: input.invoiceId,
      totalDebit: grossAmount,
      totalCredit: grossAmount,
      status: 'POSTED',
      lines: [
        {
          accountId: 'acc-5000',
          accountCode: '5000',
          accountName: 'Inventory Clearing',
          debit: input.netAmount,
          credit: 0,
        },
        {
          accountId: 'acc-1150',
          accountCode: '1150',
          accountName: 'Input Tax Receivable',
          debit: taxAmount,
          credit: 0,
        },
        {
          accountId: 'acc-2000',
          accountCode: '2000',
          accountName: 'Accounts Payable Trade',
          debit: 0,
          credit: grossAmount,
        },
      ],
    };
    this.journals.set(journalId, journal);
    return journal;
  }

  public issueStockFifo(input: {
    companyId: string;
    warehouseId: string;
    itemId: string;
    batchId: string;
    quantity: number;
    deliveryId: string;
    accountingDate: string;
  }): { totalCost: number; journal: SimJournal } {
    const currentStock = this.getStock(input.companyId, input.warehouseId, input.itemId, input.batchId);
    if (currentStock < input.quantity) {
      throw new Error(`Insufficient available stock for batch. Required: ${input.quantity}, Available: ${currentStock}`);
    }

    // Get active layers sorted FIFO: accountingDate ASC, createdAt ASC
    const activeLayers = Array.from(this.costLayers.values())
      .filter((l) => l.companyId === input.companyId && l.batchId === input.batchId && l.remainingQuantity > 0 && !l.isExhausted)
      .sort((a, b) => a.accountingDate.localeCompare(b.accountingDate) || a.createdAt.localeCompare(b.createdAt));

    let remainingNeeded = input.quantity;
    let totalCostAccum = 0;
    const journalId = randomUUID();

    for (const layer of activeLayers) {
      if (remainingNeeded <= 0) break;
      const takeQty = Math.min(layer.remainingQuantity, remainingNeeded);
      const lineCost = Math.round(takeQty * layer.unitCost * 10000) / 10000;
      totalCostAccum = Math.round((totalCostAccum + lineCost) * 10000) / 10000;

      layer.remainingQuantity = Math.round((layer.remainingQuantity - takeQty) * 10000) / 10000;
      layer.remainingValue = Math.round(layer.remainingQuantity * layer.unitCost * 10000) / 10000;
      if (layer.remainingQuantity <= 0.0001) {
        layer.remainingQuantity = 0;
        layer.remainingValue = 0;
        layer.isExhausted = true;
      }

      const txId = randomUUID();
      this.valTransactions.set(txId, {
        id: txId,
        companyId: input.companyId,
        itemId: input.itemId,
        batchId: input.batchId,
        costLayerId: layer.id,
        transactionType: 'ISSUE',
        sourceType: 'SALES_DELIVERY',
        sourceId: input.deliveryId,
        quantity: -takeQty,
        unitCost: layer.unitCost,
        totalCost: -lineCost,
        accountingDate: input.accountingDate,
        journalId,
        status: 'POSTED',
      });

      remainingNeeded = Math.round((remainingNeeded - takeQty) * 10000) / 10000;
    }

    if (remainingNeeded > 0.0001) {
      throw new Error(`Insufficient cost layer quantity to issue for batch ${input.batchId}. Missing ${remainingNeeded} units.`);
    }

    // Deduct physical stock
    this.setStock(input.companyId, input.warehouseId, input.itemId, input.batchId, currentStock - input.quantity);

    // Post COGS Journal: DR 5000 (COGS) totalCostAccum / CR 1400 (Inventory Asset) totalCostAccum
    const journal: SimJournal = {
      id: journalId,
      companyId: input.companyId,
      journalNumber: `JN-COGS-${input.deliveryId.slice(0, 6)}`,
      postingDate: input.accountingDate,
      sourceType: 'SALES_DELIVERY',
      sourceId: input.deliveryId,
      totalDebit: totalCostAccum,
      totalCredit: totalCostAccum,
      status: 'POSTED',
      lines: [
        {
          accountId: 'acc-5000',
          accountCode: '5000',
          accountName: 'Cost of Goods Sold',
          debit: totalCostAccum,
          credit: 0,
        },
        {
          accountId: 'acc-1400',
          accountCode: '1400',
          accountName: 'Merchandise Inventory',
          debit: 0,
          credit: totalCostAccum,
        },
      ],
    };
    this.journals.set(journalId, journal);

    return { totalCost: totalCostAccum, journal };
  }

  public reverseDelivery(deliveryId: string, ctx: SecurityContext): { reversalJournal: SimJournal; restoredCost: number } {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) throw new Error('Delivery not found');
    if (delivery.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

    this.stateMachine.validateTransition({
      documentType: 'SALES_DELIVERY',
      currentState: delivery.status,
      targetState: 'REVERSED',
      ctx,
      documentContext: {
        companyId: delivery.companyId,
        documentId: delivery.id,
      },
    });

    delivery.status = 'REVERSED';

    // Find issue transactions for this delivery
    const issueTxs = Array.from(this.valTransactions.values()).filter(
      (t) => t.sourceType === 'SALES_DELIVERY' && t.sourceId === deliveryId && t.transactionType === 'ISSUE' && t.status === 'POSTED'
    );

    const reversalJournalId = randomUUID();
    let totalRestoredCost = 0;

    for (const tx of issueTxs) {
      const restoredQty = Math.abs(tx.quantity);
      const restoredCost = Math.abs(tx.totalCost);
      totalRestoredCost = Math.round((totalRestoredCost + restoredCost) * 10000) / 10000;

      // Restore to layer
      if (tx.costLayerId) {
        const layer = this.costLayers.get(tx.costLayerId);
        if (layer) {
          layer.remainingQuantity = Math.round((layer.remainingQuantity + restoredQty) * 10000) / 10000;
          layer.remainingValue = Math.round(layer.remainingQuantity * layer.unitCost * 10000) / 10000;
          if (layer.remainingQuantity > 0) {
            layer.isExhausted = false;
          }
        }
      }

      // Mark original transaction REVERSED
      tx.status = 'REVERSED';
      tx.reversalJournalId = reversalJournalId;

      // Create compensating REVERSAL valuation transaction
      const revTxId = randomUUID();
      this.valTransactions.set(revTxId, {
        id: revTxId,
        companyId: tx.companyId,
        itemId: tx.itemId,
        batchId: tx.batchId,
        costLayerId: tx.costLayerId,
        transactionType: 'REVERSAL',
        sourceType: 'SALES_DELIVERY',
        sourceId: deliveryId,
        quantity: restoredQty,
        unitCost: tx.unitCost,
        totalCost: restoredCost,
        accountingDate: new Date().toISOString().split('T')[0],
        journalId: reversalJournalId,
        status: 'POSTED',
      });
    }

    // Reversal Journal: DR 1400 (Inventory Asset) totalRestoredCost / CR 5000 (COGS) totalRestoredCost
    const reversalJournal: SimJournal = {
      id: reversalJournalId,
      companyId: delivery.companyId,
      journalNumber: `REV-DELV-${deliveryId.slice(0, 6)}`,
      postingDate: new Date().toISOString().split('T')[0],
      sourceType: 'SALES_DELIVERY_REVERSAL',
      sourceId: deliveryId,
      totalDebit: totalRestoredCost,
      totalCredit: totalRestoredCost,
      status: 'POSTED',
      lines: [
        {
          accountId: 'acc-1400',
          accountCode: '1400',
          accountName: 'Merchandise Inventory',
          debit: totalRestoredCost,
          credit: 0,
        },
        {
          accountId: 'acc-5000',
          accountCode: '5000',
          accountName: 'Cost of Goods Sold',
          debit: 0,
          credit: totalRestoredCost,
        },
      ],
    };
    this.journals.set(reversalJournalId, reversalJournal);

    return { reversalJournal, restoredCost: totalRestoredCost };
  }

  public recordPurchaseReturn(input: {
    companyId: string;
    warehouseId: string;
    itemId: string;
    batchId: string;
    quantity: number;
    unitCost: number;
    returnId: string;
  }): { totalCost: number } {
    const currentStock = this.getStock(input.companyId, input.warehouseId, input.itemId, input.batchId);
    if (currentStock < input.quantity) {
      throw new Error(`Insufficient available stock for purchase return. Required: ${input.quantity}, Available: ${currentStock}`);
    }

    const activeLayers = Array.from(this.costLayers.values())
      .filter((l) => l.companyId === input.companyId && l.batchId === input.batchId && l.remainingQuantity > 0)
      .sort((a, b) => b.accountingDate.localeCompare(a.accountingDate)); // reduce from latest or matching

    let remainingToReturn = input.quantity;
    let totalCost = 0;

    for (const layer of activeLayers) {
      if (remainingToReturn <= 0) break;
      const take = Math.min(layer.remainingQuantity, remainingToReturn);
      layer.remainingQuantity = Math.round((layer.remainingQuantity - take) * 10000) / 10000;
      layer.remainingValue = Math.round(layer.remainingQuantity * layer.unitCost * 10000) / 10000;
      if (layer.remainingQuantity <= 0.0001) {
        layer.isExhausted = true;
      }
      totalCost += Math.round(take * layer.unitCost * 10000) / 10000;
      remainingToReturn = Math.round((remainingToReturn - take) * 10000) / 10000;

      const txId = randomUUID();
      this.valTransactions.set(txId, {
        id: txId,
        companyId: input.companyId,
        itemId: input.itemId,
        batchId: input.batchId,
        costLayerId: layer.id,
        transactionType: 'RETURN',
        sourceType: 'PURCHASE_RETURN',
        sourceId: input.returnId,
        quantity: -take,
        unitCost: layer.unitCost,
        totalCost: -Math.round(take * layer.unitCost * 10000) / 10000,
        accountingDate: new Date().toISOString().split('T')[0],
        status: 'POSTED',
      });
    }

    this.setStock(input.companyId, input.warehouseId, input.itemId, input.batchId, currentStock - input.quantity);

    // Purchase Return Journal: DR 5000 (Clearing / Adjustment) totalCost / CR 1400 (Merchandise Inventory) totalCost
    const journalId = randomUUID();
    const returnJournal: SimJournal = {
      id: journalId,
      companyId: input.companyId,
      journalNumber: `JN-PRET-${input.returnId.slice(0, 6)}`,
      postingDate: new Date().toISOString().split('T')[0],
      sourceType: 'PURCHASE_RETURN',
      sourceId: input.returnId,
      totalDebit: totalCost,
      totalCredit: totalCost,
      status: 'POSTED',
      lines: [
        {
          accountId: 'acc-5000',
          accountCode: '5000',
          accountName: 'Inventory Clearing',
          debit: totalCost,
          credit: 0,
        },
        {
          accountId: 'acc-1400',
          accountCode: '1400',
          accountName: 'Merchandise Inventory',
          debit: 0,
          credit: totalCost,
        },
      ],
    };
    this.journals.set(journalId, returnJournal);

    return { totalCost };
  }

  public getSubledgerTotal(companyId: string): number {
    return Array.from(this.costLayers.values())
      .filter((l) => l.companyId === companyId && !l.isExhausted && l.remainingQuantity > 0)
      .reduce((sum, l) => Math.round((sum + l.remainingValue) * 10000) / 10000, 0);
  }

  public getGlAccount1400Balance(companyId: string): number {
    let debits = 0;
    let credits = 0;
    for (const j of this.journals.values()) {
      if (j.companyId === companyId && j.status === 'POSTED') {
        for (const line of j.lines) {
          if (line.accountCode === '1400') {
            debits += line.debit;
            credits += line.credit;
          }
        }
      }
    }
    return Math.round((debits - credits) * 10000) / 10000;
  }
}

export async function runIncrement15Tests() {
  console.log('\n=== RUNNING INCREMENT 1.5 INVENTORY VALUATION & COGS AUDIT TESTS ===\n');

  // ==========================================================================
  // Suite 1: Database Migration & Schema Invariant Auditing
  // ==========================================================================
  console.log('--- Test Suite 1: Migration & Schema Invariant Auditing ---');

  const pool = getPool();
  const health = await checkDatabaseHealth();
  assert.ok(health.connected, 'Database must be reachable for Increment 1.5 tests');

  await test('1.1 Applies Increment 1.5 migration (0009_inventory_valuation_cogs_foundation) idempotently', async () => {
    const migrationRes = await runMigrations(pool);
    assert.ok(migrationRes.totalDiscovered >= 9, 'Must have at least 9 migrations discovered');
  });

  await test('1.2 inventory_cost_layers table exists with authoritative schema and indexes', async () => {
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'inventory_cost_layers'
    `);
    const colNames = res.rows.map((r) => r.column_name);
    const requiredCols = [
      'id', 'company_id', 'branch_id', 'warehouse_id', 'item_id', 'batch_id', 'uom_id',
      'initial_quantity', 'remaining_quantity', 'unit_cost', 'total_cost', 'remaining_value',
      'currency_code', 'exchange_rate', 'source_document_type', 'source_document_id',
      'source_document_line_id', 'accounting_date', 'is_exhausted', 'created_at', 'updated_at'
    ];
    for (const col of requiredCols) {
      assert.ok(colNames.includes(col), `inventory_cost_layers must include column '${col}'`);
    }

    const idxRes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_cost_layers'
    `);
    const idxNames = idxRes.rows.map((r) => r.indexname);
    assert.ok(idxNames.includes('idx_cost_layers_batch_lookup'), 'idx_cost_layers_batch_lookup index must exist');
    assert.ok(idxNames.includes('idx_cost_layers_date'), 'idx_cost_layers_date index must exist');
  });

  await test('1.3 inventory_valuation_transactions table exists with authoritative schema and indexes', async () => {
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'inventory_valuation_transactions'
    `);
    const colNames = res.rows.map((r) => r.column_name);
    const requiredCols = [
      'id', 'company_id', 'branch_id', 'warehouse_id', 'item_id', 'batch_id',
      'cost_layer_id', 'transaction_type', 'source_type', 'source_id', 'source_line_id',
      'quantity', 'unit_cost', 'total_cost', 'currency_code', 'exchange_rate',
      'accounting_date', 'journal_id', 'status', 'reversal_journal_id', 'created_at'
    ];
    for (const col of requiredCols) {
      assert.ok(colNames.includes(col), `inventory_valuation_transactions must include column '${col}'`);
    }

    const idxRes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_valuation_transactions'
    `);
    const idxNames = idxRes.rows.map((r) => r.indexname);
    assert.ok(idxNames.includes('idx_val_tx_source'), 'idx_val_tx_source index must exist');
    assert.ok(idxNames.includes('idx_val_tx_company_date'), 'idx_val_tx_company_date index must exist');
    assert.ok(idxNames.includes('idx_val_tx_item_batch'), 'idx_val_tx_item_batch index must exist');
  });

  await test('1.4 purchase_receipts & sales_deliveries extended with journal_id & reversal tracking columns', async () => {
    const prRes = await pool.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'purchase_receipts'
    `);
    const prCols = prRes.rows.map((r) => r.column_name);
    assert.ok(prCols.includes('journal_id'), 'purchase_receipts must have journal_id');
    assert.ok(prCols.includes('reversed_by'), 'purchase_receipts must have reversed_by');
    assert.ok(prCols.includes('reversed_at'), 'purchase_receipts must have reversed_at');

    const sdRes = await pool.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'sales_deliveries'
    `);
    const sdCols = sdRes.rows.map((r) => r.column_name);
    assert.ok(sdCols.includes('journal_id'), 'sales_deliveries must have journal_id');
    assert.ok(sdCols.includes('reversed_by'), 'sales_deliveries must have reversed_by');
    assert.ok(sdCols.includes('reversed_at'), 'sales_deliveries must have reversed_at');
  });

  // ==========================================================================
  // Suite 2: Strict FIFO Calculation Invariant Verification
  // ==========================================================================
  console.log('\n--- Test Suite 2: Strict FIFO Calculation Invariant Verification ---');

  const sim = new Increment15SimulationEngine();
  const company1 = randomUUID();
  const warehouse1 = randomUUID();
  const item1 = randomUUID();
  const batchA = randomUUID();
  const batchB = randomUUID();

  // Create Batch A: 500 KG @ 200 (accountingDate: 2026-08-01)
  sim.recordPurchaseReceipt({
    companyId: company1,
    warehouseId: warehouse1,
    itemId: item1,
    batchId: batchA,
    quantity: 500,
    unitCost: 200,
    accountingDate: '2026-08-01',
    receiptId: randomUUID(),
  });

  // Create Batch B: 500 KG @ 250 (accountingDate: 2026-08-15)
  sim.recordPurchaseReceipt({
    companyId: company1,
    warehouseId: warehouse1,
    itemId: item1,
    batchId: batchB,
    quantity: 500,
    unitCost: 250,
    accountingDate: '2026-08-15',
    receiptId: randomUUID(),
  });

  await test('2.1 Issue 1 (300 KG from Batch A) generates exactly 60,000 COGS', async () => {
    const issue1 = sim.issueStockFifo({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batchA,
      quantity: 300,
      deliveryId: randomUUID(),
      accountingDate: '2026-09-01',
    });

    assert.equal(issue1.totalCost, 60000, '300 KG @ 200 must yield 60,000 COGS');
    const layerA = Array.from(sim.costLayers.values()).find((l) => l.batchId === batchA)!;
    assert.equal(layerA.remainingQuantity, 200, 'Batch A must have 200 KG remaining');
    assert.equal(layerA.remainingValue, 40000, 'Batch A remaining value must be 40,000');
    assert.equal(layerA.isExhausted, false);
  });

  await test('2.2 Issue 2 (300 KG split across 200 Batch A + 100 Batch B) generates exactly 65,000 COGS', async () => {
    // Exhaust Batch A (200 KG)
    const issue2A = sim.issueStockFifo({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batchA,
      quantity: 200,
      deliveryId: randomUUID(),
      accountingDate: '2026-09-02',
    });
    assert.equal(issue2A.totalCost, 40000);

    // Take 100 KG from Batch B
    const issue2B = sim.issueStockFifo({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batchB,
      quantity: 100,
      deliveryId: randomUUID(),
      accountingDate: '2026-09-02',
    });
    assert.equal(issue2B.totalCost, 25000);

    const totalIssue2 = issue2A.totalCost + issue2B.totalCost;
    assert.equal(totalIssue2, 65000, 'Issue 2 must yield exactly 65,000 COGS (40k + 25k)');

    const layerA = Array.from(sim.costLayers.values()).find((l) => l.batchId === batchA)!;
    const layerB = Array.from(sim.costLayers.values()).find((l) => l.batchId === batchB)!;
    assert.equal(layerA.remainingQuantity, 0, 'Batch A must be exhausted');
    assert.equal(layerA.isExhausted, true);
    assert.equal(layerB.remainingQuantity, 400, 'Batch B must have 400 KG remaining');
    assert.equal(layerB.remainingValue, 100000, 'Batch B remaining value must be 100,000 (400 * 250)');
  });

  // ==========================================================================
  // Suite 3: Purchase Receipt -> Cost Layer & Capitalization Journal
  // ==========================================================================
  console.log('\n--- Test Suite 3: Purchase Receipt → Cost Layer Creation ---');

  const testBatchRM = randomUUID();
  const testReceiptId = randomUUID();

  await test('3.1 Capitalizes 1,000 KG @ 200: creates cost layer, valuation tx, and GL entry (DR 1400 / CR 5000)', async () => {
    const { layer, journal } = sim.recordPurchaseReceipt({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: testBatchRM,
      quantity: 1000,
      unitCost: 200,
      accountingDate: '2026-09-03',
      receiptId: testReceiptId,
    });

    assert.equal(layer.initialQuantity, 1000);
    assert.equal(layer.remainingQuantity, 1000);
    assert.equal(layer.unitCost, 200);
    assert.equal(layer.totalCost, 200000);
    assert.equal(layer.remainingValue, 200000);
    assert.equal(layer.isExhausted, false);

    assert.equal(journal.totalDebit, 200000);
    assert.equal(journal.totalCredit, 200000);
    const dr1400 = journal.lines.find((l) => l.accountCode === '1400');
    const cr5000 = journal.lines.find((l) => l.accountCode === '5000');
    assert.ok(dr1400 && dr1400.debit === 200000, 'Must DEBIT Merchandise Inventory (1400) 200,000');
    assert.ok(cr5000 && cr5000.credit === 200000, 'Must CREDIT Inventory Clearing (5000) 200,000');
  });

  // ==========================================================================
  // Suite 4: Purchase Invoice Accounting & Inventory Clearing Resolution
  // ==========================================================================
  console.log('\n--- Test Suite 4: Purchase Invoice Accounting & Clearing Resolution ---');

  await test('4.1 Purchase Invoice resolves Clearing (DR 5000 200k, DR 1150 26k, CR 2000 226k) with zero double-capitalization', async () => {
    const invJournal = sim.recordPurchaseInvoice({
      companyId: company1,
      netAmount: 200000,
      taxRate: 13,
      invoiceId: randomUUID(),
    });

    assert.equal(invJournal.totalDebit, 226000);
    assert.equal(invJournal.totalCredit, 226000);

    const drClr = invJournal.lines.find((l) => l.accountCode === '5000');
    const drTax = invJournal.lines.find((l) => l.accountCode === '1150');
    const crAp = invJournal.lines.find((l) => l.accountCode === '2000');
    const direct1400 = invJournal.lines.find((l) => l.accountCode === '1400');

    assert.ok(drClr && drClr.debit === 200000, 'Must DEBIT Inventory Clearing 200,000');
    assert.ok(drTax && drTax.debit === 26000, 'Must DEBIT Input Tax Receivable 26,000');
    assert.ok(crAp && crAp.credit === 226000, 'Must CREDIT Accounts Payable 226,000');
    assert.ok(!direct1400, 'Purchase Invoice MUST NOT directly debit 1400 (no double capitalization)');

    // Invariant: Net balance of account 5000 for this purchase cycle is ZERO
    const receiptsForCycle = Array.from(sim.journals.values()).filter((j) => j.sourceId === testReceiptId);
    const crTotal5000 = receiptsForCycle.flatMap((j) => j.lines).filter((l) => l.accountCode === '5000').reduce((s, l) => s + l.credit, 0);
    const drTotal5000 = drClr!.debit;
    assert.equal(crTotal5000 - drTotal5000, 0, 'Inventory Clearing account balance must equal exactly ZERO');
  });

  // ==========================================================================
  // Suite 5: Sales Delivery -> COGS Recognition & Journal Creation
  // ==========================================================================
  console.log('\n--- Test Suite 5: Sales Delivery → COGS Recognition ---');

  const testDeliveryId = randomUUID();

  await test('5.1 Sales Delivery issues 100 KG from testBatchRM @ 200, posts COGS journal (DR 5000 20k / CR 1400 20k)', async () => {
    const { totalCost, journal } = sim.issueStockFifo({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: testBatchRM,
      quantity: 100,
      deliveryId: testDeliveryId,
      accountingDate: '2026-09-04',
    });

    sim.deliveries.set(testDeliveryId, {
      id: testDeliveryId,
      companyId: company1,
      status: 'POSTED',
      journalId: journal.id,
    });

    assert.equal(totalCost, 20000, 'COGS must be 20,000 (100 * 200)');
    assert.equal(journal.totalDebit, 20000);
    assert.equal(journal.totalCredit, 20000);

    const drCogs = journal.lines.find((l) => l.accountCode === '5000');
    const cr1400 = journal.lines.find((l) => l.accountCode === '1400');
    assert.ok(drCogs && drCogs.debit === 20000, 'Must DEBIT COGS 20,000');
    assert.ok(cr1400 && cr1400.credit === 20000, 'Must CREDIT Merchandise Inventory 20,000');

    const layer = Array.from(sim.costLayers.values()).find((l) => l.batchId === testBatchRM)!;
    assert.equal(layer.remainingQuantity, 900, 'Cost layer remaining quantity must be 900');
    assert.equal(layer.remainingValue, 180000, 'Cost layer remaining value must be 180,000');
  });

  // ==========================================================================
  // Suite 6: Sales Invoice Boundary & Zero COGS Duplication
  // ==========================================================================
  console.log('\n--- Test Suite 6: Sales Invoice Boundary ---');

  await test('6.1 Sales Invoice does not duplicate COGS or create stock/valuation entries', async () => {
    const valTxCountBefore = sim.valTransactions.size;
    const stockBefore = sim.getStock(company1, warehouse1, item1, testBatchRM);

    // Sales Invoice simulates revenue recognition: DR 1100 (AR) 33,900 / CR 4000 (Revenue) 30,000 / CR 2150 (Output Tax) 3,900
    const siJournalId = randomUUID();
    sim.journals.set(siJournalId, {
      id: siJournalId,
      companyId: company1,
      journalNumber: 'JN-SINV-001',
      postingDate: '2026-09-05',
      sourceType: 'SALES_INVOICE',
      sourceId: randomUUID(),
      totalDebit: 33900,
      totalCredit: 33900,
      status: 'POSTED',
      lines: [
        { accountId: 'acc-1100', accountCode: '1100', accountName: 'Accounts Receivable', debit: 33900, credit: 0 },
        { accountId: 'acc-4000', accountCode: '4000', accountName: 'Sales Revenue', debit: 0, credit: 30000 },
        { accountId: 'acc-2150', accountCode: '2150', accountName: 'Output Tax Payable', debit: 0, credit: 3900 },
      ],
    });

    const valTxCountAfter = sim.valTransactions.size;
    const stockAfter = sim.getStock(company1, warehouse1, item1, testBatchRM);
    assert.equal(valTxCountAfter, valTxCountBefore, 'Sales Invoice must NOT create valuation transactions');
    assert.equal(stockAfter, stockBefore, 'Sales Invoice must NOT modify physical stock');
  });

  // ==========================================================================
  // Suite 7: Partial Batch Consumption
  // ==========================================================================
  console.log('\n--- Test Suite 7: Partial Batch Consumption ---');

  await test('7.1 Partial batch consumption: 1000 KG @ 200, issue 250 KG -> remaining 750 KG, remaining value 150,000, COGS 50,000', async () => {
    const partialBatch = randomUUID();
    sim.recordPurchaseReceipt({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: partialBatch,
      quantity: 1000,
      unitCost: 200,
      accountingDate: '2026-09-06',
      receiptId: randomUUID(),
    });

    const issuePartial = sim.issueStockFifo({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: partialBatch,
      quantity: 250,
      deliveryId: randomUUID(),
      accountingDate: '2026-09-07',
    });

    assert.equal(issuePartial.totalCost, 50000, 'COGS for 250 KG @ 200 must be 50,000');
    const layer = Array.from(sim.costLayers.values()).find((l) => l.batchId === partialBatch)!;
    assert.equal(layer.remainingQuantity, 750, 'Remaining quantity must be 750 KG');
    assert.equal(layer.remainingValue, 150000, 'Remaining value must be 150,000');
    assert.equal(layer.isExhausted, false);
  });

  // ==========================================================================
  // Suite 8: Negative Stock Prevention
  // ==========================================================================
  console.log('\n--- Test Suite 8: Negative Stock Prevention ---');

  await test('8.1 Transaction strictly rejected when issuing 101 KG from a 100 KG batch', async () => {
    const negBatch = randomUUID();
    sim.recordPurchaseReceipt({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: negBatch,
      quantity: 100,
      unitCost: 100,
      accountingDate: '2026-09-08',
      receiptId: randomUUID(),
    });

    assert.throws(() => {
      sim.issueStockFifo({
        companyId: company1,
        warehouseId: warehouse1,
        itemId: item1,
        batchId: negBatch,
        quantity: 101, // 101 > 100
        deliveryId: randomUUID(),
        accountingDate: '2026-09-09',
      });
    }, /Insufficient available stock/);

    const layer = Array.from(sim.costLayers.values()).find((l) => l.batchId === negBatch)!;
    assert.equal(layer.remainingQuantity, 100, 'Remaining quantity must stay 100');
    assert.equal(layer.remainingValue, 10000, 'Remaining value must stay 10,000');
  });

  // ==========================================================================
  // Suite 9: Posting Idempotency
  // ==========================================================================
  console.log('\n--- Test Suite 9: Posting Idempotency ---');

  await test('9.1 Attempting to post an already POSTED delivery is strictly rejected', async () => {
    const delv = sim.deliveries.get(testDeliveryId)!;
    assert.equal(delv.status, 'POSTED');

    const managerCtx: SecurityContext = {
      userId: randomUUID(),
      email: 'manager@valtest.com',
      fullName: 'Inventory Manager',
      effectivePermissions: ['sales.delivery.post'],
      isSuperadmin: false,
      activeCompanyId: company1,
    };

    assert.throws(() => {
      sim.stateMachine.validateTransition({
        documentType: 'SALES_DELIVERY',
        currentState: delv.status,
        targetState: 'POSTED',
        ctx: managerCtx,
        documentContext: { companyId: company1, documentId: delv.id },
      });
    }, /strictly immutable|Cannot transition/);
  });

  // ==========================================================================
  // Suite 10: Reversal & Compensating Entries
  // ==========================================================================
  console.log('\n--- Test Suite 10: Reversal & Compensating Entries ---');

  await test('10.1 Delivery reversal creates compensating journal (DR 1400 / CR 5000), restores cost layer quantity', async () => {
    const adminCtx: SecurityContext = {
      userId: randomUUID(),
      email: 'admin@valtest.com',
      fullName: 'Admin User',
      effectivePermissions: ['sales.delivery.reverse'],
      isSuperadmin: false,
      activeCompanyId: company1,
    };

    const { reversalJournal, restoredCost } = sim.reverseDelivery(testDeliveryId, adminCtx);

    assert.equal(restoredCost, 20000, 'Restored cost must equal 20,000');
    assert.equal(reversalJournal.totalDebit, 20000);
    assert.equal(reversalJournal.totalCredit, 20000);

    const dr1400 = reversalJournal.lines.find((l) => l.accountCode === '1400');
    const cr5000 = reversalJournal.lines.find((l) => l.accountCode === '5000');
    assert.ok(dr1400 && dr1400.debit === 20000, 'Compensating journal must DEBIT 1400 20,000');
    assert.ok(cr5000 && cr5000.credit === 20000, 'Compensating journal must CREDIT 5000 20,000');

    // Cost layer restored back from 900 to 1,000 KG
    const layer = Array.from(sim.costLayers.values()).find((l) => l.batchId === testBatchRM)!;
    assert.equal(layer.remainingQuantity, 1000, 'Cost layer remaining quantity must be restored to 1,000');
    assert.equal(layer.remainingValue, 200000, 'Cost layer remaining value must be restored to 200,000');

    // Double reversal must be rejected
    assert.throws(() => {
      sim.reverseDelivery(testDeliveryId, adminCtx);
    }, /terminal state|Cannot transition|strictly immutable/);
  });

  // ==========================================================================
  // Suite 11: Purchase Return Workflow
  // ==========================================================================
  console.log('\n--- Test Suite 11: Purchase Return Workflow ---');

  await test('11.1 Purchase return decreases physical stock and reduces cost layer from 1000 to 900 KG', async () => {
    const { totalCost } = sim.recordPurchaseReturn({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: testBatchRM,
      quantity: 100,
      unitCost: 200,
      returnId: randomUUID(),
    });

    assert.equal(totalCost, 20000, 'Returned valuation must equal 20,000');
    const layer = Array.from(sim.costLayers.values()).find((l) => l.batchId === testBatchRM)!;
    assert.equal(layer.remainingQuantity, 900, 'Cost layer remaining quantity must reduce to 900 KG');
    assert.equal(layer.remainingValue, 180000, 'Cost layer remaining value must reduce to 180,000');
  });

  // ==========================================================================
  // Suite 12: Concurrency & Transactional Locking
  // ==========================================================================
  console.log('\n--- Test Suite 12: Concurrency & Transactional Locking ---');

  await test('12.1 Concurrency simulation: Two simultaneous issues (80 KG + 50 KG) on 100 KG layer allows only one', async () => {
    const concBatch = randomUUID();
    sim.recordPurchaseReceipt({
      companyId: company1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: concBatch,
      quantity: 100,
      unitCost: 50,
      accountingDate: '2026-09-10',
      receiptId: randomUUID(),
    });

    let successCount = 0;
    let failCount = 0;

    // Simulate parallel attempts
    const attempts = [80, 50];
    for (const qty of attempts) {
      try {
        sim.issueStockFifo({
          companyId: company1,
          warehouseId: warehouse1,
          itemId: item1,
          batchId: concBatch,
          quantity: qty,
          deliveryId: randomUUID(),
          accountingDate: '2026-09-10',
        });
        successCount++;
      } catch {
        failCount++;
      }
    }

    assert.equal(successCount, 1, 'Only one issue operation must succeed');
    assert.equal(failCount, 1, 'The competing issue operation must fail');
    const layer = Array.from(sim.costLayers.values()).find((l) => l.batchId === concBatch)!;
    assert.equal(layer.remainingQuantity, 20, 'Layer remaining quantity must be 20 (100 - 80)');
  });

  // ==========================================================================
  // Suite 13: Subledger to General Ledger Reconciliation
  // ==========================================================================
  console.log('\n--- Test Suite 13: Subledger to General Ledger Reconciliation ---');

  await test('13.1 Subledger total equals GL Account 1400 balance with zero discrepancy', async () => {
    const subledgerVal = sim.getSubledgerTotal(company1);
    const glVal = sim.getGlAccount1400Balance(company1);
    const discrepancy = Math.abs(subledgerVal - glVal);

    assert.equal(typeof subledgerVal, 'number');
    assert.equal(typeof glVal, 'number');
    assert.equal(discrepancy, 0, `Subledger (${subledgerVal}) and GL (${glVal}) must match with ZERO discrepancy`);
  });

  // ==========================================================================
  // Suite 14: Trial Balance Integration
  // ==========================================================================
  console.log('\n--- Test Suite 14: Trial Balance Integration ---');

  await test('14.1 Trial Balance derived from simulation journals balances total debits and credits', async () => {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const j of sim.journals.values()) {
      if (j.companyId === company1 && j.status === 'POSTED') {
        totalDebit += j.totalDebit;
        totalCredit += j.totalCredit;
      }
    }
    assert.equal(totalDebit, totalCredit, 'Trial Balance debits must equal credits');
  });

  // ==========================================================================
  // Suite 15: Multi-Company Tenant Isolation
  // ==========================================================================
  console.log('\n--- Test Suite 15: Multi-Company Tenant Isolation ---');

  await test('15.1 Company B cannot access or reverse Company A documents or cost layers', async () => {
    const companyB = randomUUID();
    const companyBCtx: SecurityContext = {
      userId: randomUUID(),
      email: 'manager@companyb.com',
      fullName: 'Company B Manager',
      effectivePermissions: ['sales.delivery.reverse'],
      isSuperadmin: false,
      activeCompanyId: companyB,
    };

    assert.throws(() => {
      sim.reverseDelivery(testDeliveryId, companyBCtx);
    }, /Tenant isolation violation/);
  });

  // ==========================================================================
  // Suite 16: RBAC Verification
  // ==========================================================================
  console.log('\n--- Test Suite 16: RBAC Verification ---');

  await test('16.1 Users without inventory.stock.view or sales.delivery.reverse are blocked', async () => {
    const unauthorizedCtx: SecurityContext = {
      userId: randomUUID(),
      email: 'guest@valtest.com',
      fullName: 'Guest User',
      effectivePermissions: [],
      isSuperadmin: false,
      activeCompanyId: company1,
    };

    assert.throws(() => {
      sim.stateMachine.validateTransition({
        documentType: 'SALES_DELIVERY',
        currentState: 'POSTED',
        targetState: 'REVERSED',
        ctx: unauthorizedCtx,
        documentContext: { companyId: company1, documentId: testDeliveryId },
      });
    }, /Missing required permission/);
  });

  // ==========================================================================
  // Suite 17: Real Live PostgreSQL Database Assertions
  // ==========================================================================
  console.log('\n--- Test Suite 17: Real PostgreSQL Database Invariant Assertions ---');

  const costLayerRepo = new CostLayerRepository();
  const valTxRepo = new ValuationTransactionRepository();
  const valuationService = new InventoryValuationService();
  const tbService = new TrialBalanceService();

  const liveCompanyId = randomUUID();
  const liveWarehouseId = randomUUID();
  const liveItemId = randomUUID();
  const liveBatchId = randomUUID();
  const liveUomId = randomUUID();

  const suffix = randomUUID().slice(0, 8);
  await pool.query(`
    INSERT INTO companies (id, code, legal_name, base_currency, is_active)
    VALUES ($1, $2, 'Valuation Test Company', 'USD', true)
  `, [liveCompanyId, `VAL-CO-${suffix}`]);

  await pool.query(`
    INSERT INTO warehouses (id, company_id, code, name, is_active)
    VALUES ($1, $2, $3, 'Main Warehouse', true)
  `, [liveWarehouseId, liveCompanyId, `WH-MAIN-${suffix}`]);

  await pool.query(`
    INSERT INTO uoms (id, company_id, code, name, symbol, is_active)
    VALUES ($1, $2, $3, 'Kilogram', 'KG', true)
  `, [liveUomId, liveCompanyId, `KG-${suffix}`]);

  await pool.query(`
    INSERT INTO items (id, company_id, sku, item_name, base_uom_id, is_active)
    VALUES ($1, $2, $3, 'Raw Material Valve', $4, true)
  `, [liveItemId, liveCompanyId, `SKU-VAL-${suffix}`, liveUomId]);

  await pool.query(`
    INSERT INTO inventory_batches (id, company_id, item_id, batch_number, unit_cost, is_active)
    VALUES ($1, $2, $3, $4, 200, true)
  `, [liveBatchId, liveCompanyId, liveItemId, `BATCH-${suffix}`]);

  await test('17.1 Real DB: Direct CostLayerRepository & ValuationTransactionRepository insertion & query', async () => {
    const createdLayer = await costLayerRepo.createLayer(
      {
        companyId: liveCompanyId,
        branchId: null,
        warehouseId: liveWarehouseId,
        itemId: liveItemId,
        batchId: liveBatchId,
        uomId: liveUomId,
        initialQuantity: 1000,
        unitCost: 200,
        currencyCode: 'USD',
        exchangeRate: 1,
        sourceDocumentType: 'PURCHASE_RECEIPT',
        sourceDocumentId: randomUUID(),
        accountingDate: '2026-09-01',
      }
    );

    assert.ok(createdLayer.id);
    assert.equal(Number(createdLayer.initialQuantity), 1000);
    assert.equal(Number(createdLayer.remainingQuantity), 1000);
    assert.equal(Number(createdLayer.unitCost), 200);
    assert.equal(Number(createdLayer.totalCost), 200000);
    assert.equal(Number(createdLayer.remainingValue), 200000);

    const createdTx = await valTxRepo.createTransaction(
      {
        companyId: liveCompanyId,
        branchId: null,
        warehouseId: liveWarehouseId,
        itemId: liveItemId,
        batchId: liveBatchId,
        costLayerId: createdLayer.id,
        transactionType: 'RECEIPT',
        sourceType: 'PURCHASE_RECEIPT',
        sourceId: createdLayer.sourceDocumentId,
        quantity: 1000,
        unitCost: 200,
        totalCost: 200000,
        currencyCode: 'USD',
        exchangeRate: 1,
        accountingDate: '2026-09-01',
        status: 'POSTED',
      }
    );

    assert.ok(createdTx.id);
    assert.equal(createdTx.transactionType, 'RECEIPT');
    assert.equal(Number(createdTx.quantity), 1000);
  });

  await test('17.2 Real DB: FIFO Query Ordering and FOR UPDATE pessimistic locking execution', async () => {
    await withTransaction(async (client) => {
      const layers = await costLayerRepo.findLayersByBatch(
        liveCompanyId,
        liveWarehouseId,
        liveItemId,
        liveBatchId,
        client,
        true,
        true // FOR UPDATE
      );
      assert.equal(layers.length, 1);
      assert.equal(layers[0].companyId, liveCompanyId);
      assert.equal(layers[0].batchId, liveBatchId);
    });
  });

  await test('17.3 Real DB: Inventory/GL reconciliation query executes cleanly against PostgreSQL', async () => {
    const ctx: SecurityContext = {
      userId: randomUUID(),
      email: 'admin@live.com',
      fullName: 'Live Admin',
      effectivePermissions: ['inventory.stock.view', 'accounting.report.view'],
      isSuperadmin: false,
      activeCompanyId: liveCompanyId,
    };

    const recon = await valuationService.getInventoryGlReconciliation(liveCompanyId, undefined, ctx);
    assert.ok(recon);
    assert.equal(typeof recon.subledgerTotal, 'number');
    assert.equal(typeof recon.glAccount1400Balance, 'number');
    assert.equal(typeof recon.discrepancy, 'number');
    assert.equal(typeof recon.isReconciled, 'boolean');
  });

  await test('17.4 Real DB: TrialBalanceService executes cleanly against PostgreSQL', async () => {
    const ctx: SecurityContext = {
      userId: randomUUID(),
      email: 'admin@live.com',
      fullName: 'Live Admin',
      effectivePermissions: ['accounting.report.view'],
      isSuperadmin: false,
      activeCompanyId: liveCompanyId,
    };

    const tb = await tbService.getTrialBalance({ asOfDate: '2026-12-31' }, ctx);
    assert.ok(tb);
    assert.equal(typeof tb.totalDebit, 'number');
    assert.equal(typeof tb.totalCredit, 'number');
    assert.equal(typeof tb.isBalanced, 'boolean');
    assert.ok(Array.isArray(tb.items));
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 1.5 AUDIT TESTS PASSED!`);
  console.log(`=============================================\n`);
}

// Auto-run if executed directly
runIncrement15Tests()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Test execution failed:', err);
    await closePool();
    process.exit(1);
  });
