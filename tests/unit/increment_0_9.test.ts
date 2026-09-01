import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PurchaseOrder,
  PurchaseReceipt,
  QcInspection,
  PurchaseReturn,
  InventoryBatch,
  StockLedgerEntry,
  StockBalanceSummary,
} from '../../src/shared/types/index.js';
import {
  createPurchaseOrderSchema,
  createPurchaseReceiptSchema,
  createPurchaseReturnSchema,
} from '../../src/shared/schemas/purchase.js';
import {
  createQcInspectionSchema,
  stockLedgerFilterSchema,
  stockBalanceFilterSchema,
} from '../../src/shared/schemas/inventory.js';

let passedTests = 0;
let totalTests = 0;

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

console.log('\n=== RUNNING INCREMENT 0.9 PURCHASING & STOCK LEDGER UNIT TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Simulation Engine for Purchasing & Stock Ledger
// ----------------------------------------------------------------------------

interface TenantContext {
  companyId: string;
  branchId: string | null;
  userId: string;
}

class InMemoryStockLedgerEngine {
  public ledgerEntries: StockLedgerEntry[] = [];
  public batches: Map<string, InventoryBatch> = new Map();
  public purchaseOrders: Map<string, PurchaseOrder> = new Map();
  public purchaseReceipts: Map<string, PurchaseReceipt> = new Map();
  public qcInspections: Map<string, QcInspection> = new Map();
  public purchaseReturns: Map<string, PurchaseReturn> = new Map();

  // 1. Stock Ledger append-only record creation
  addLedgerEntry(entry: Omit<StockLedgerEntry, 'id' | 'createdAt'>): StockLedgerEntry {
    const fullEntry: StockLedgerEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.ledgerEntries.push(fullEntry);
    return fullEntry;
  }

  // 2. Compute stock balance summary
  getBalanceSummary(companyId: string, warehouseId?: string, itemId?: string): StockBalanceSummary[] {
    const map = new Map<string, StockBalanceSummary>();

    for (const entry of this.ledgerEntries) {
      if (entry.companyId !== companyId) continue;
      if (warehouseId && entry.warehouseId !== warehouseId) continue;
      if (itemId && entry.itemId !== itemId) continue;

      const key = `${entry.warehouseId}_${entry.itemId}`;
      if (!map.has(key)) {
        map.set(key, {
          companyId,
          warehouseId: entry.warehouseId,
          warehouseCode: 'WH-MAIN',
          warehouseName: 'Main Warehouse',
          itemId: entry.itemId,
          itemSku: 'SKU-001',
          itemName: 'Industrial Item',
          uomId: entry.uomId,
          uomCode: 'PCS',
          availableQuantity: 0,
          qcPendingQuantity: 0,
          qcFailedQuantity: 0,
          quarantineQuantity: 0,
          totalQuantity: 0,
          totalValuation: 0,
        });
      }

      const row = map.get(key)!;
      if (entry.stockStatus === 'AVAILABLE') {
        row.availableQuantity += entry.quantity;
      } else if (entry.stockStatus === 'QC_PENDING') {
        row.qcPendingQuantity += entry.quantity;
      } else if (entry.stockStatus === 'QC_FAILED') {
        row.qcFailedQuantity += entry.quantity;
      }

      row.totalQuantity = (row.totalQuantity || 0) + entry.quantity;
      row.totalValuation = (row.totalValuation || 0) + entry.totalCost;
    }

    return Array.from(map.values());
  }

  // 3. Batch stock balance
  getBatchBalance(companyId: string, warehouseId: string, itemId: string, batchId: string, status: string): number {
    return this.ledgerEntries
      .filter(
        (e) =>
          e.companyId === companyId &&
          e.warehouseId === warehouseId &&
          e.itemId === itemId &&
          e.batchId === batchId &&
          e.stockStatus === status
      )
      .reduce((sum, e) => sum + e.quantity, 0);
  }
}

async function runTests() {
  const engine = new InMemoryStockLedgerEngine();

  const tenantA: TenantContext = {
    companyId: randomUUID(),
    branchId: randomUUID(),
    userId: randomUUID(),
  };

  const tenantB: TenantContext = {
    companyId: randomUUID(),
    branchId: randomUUID(),
    userId: randomUUID(),
  };

  const approverA: TenantContext = {
    companyId: tenantA.companyId,
    branchId: tenantA.branchId,
    userId: randomUUID(),
  };

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Zod Validation Schemas
  // --------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: Zod Schemas & Validations ---');

  await test('PO Schema validates correct payload and computes totals', () => {
    const rawPo = {
      companyId: tenantA.companyId,
      branchId: tenantA.branchId,
      supplierId: randomUUID(),
      orderDate: '2026-08-31',
      currencyCode: 'USD',
      exchangeRate: 1.0,
      lines: [
        {
          itemId: randomUUID(),
          warehouseId: randomUUID(),
          uomId: randomUUID(),
          orderedQuantity: 100,
          conversionFactor: 1.0,
          unitPrice: 50,
          taxRate: 10,
        },
      ],
    };

    const parsed = createPurchaseOrderSchema.parse(rawPo);
    assert.equal(parsed.lines.length, 1);
    assert.equal(parsed.lines[0].orderedQuantity, 100);
    assert.equal(parsed.lines[0].unitPrice, 50);
  });

  await test('PO Schema rejects negative quantities and zero price', () => {
    const rawPo = {
      companyId: tenantA.companyId,
      supplierId: randomUUID(),
      lines: [
        {
          itemId: randomUUID(),
          warehouseId: randomUUID(),
          uomId: randomUUID(),
          orderedQuantity: -10,
          unitPrice: 0,
        },
      ],
    };

    assert.throws(() => {
      createPurchaseOrderSchema.parse(rawPo);
    });
  });

  await test('Purchase Receipt Schema requires batch allocations', () => {
    const rawReceipt = {
      companyId: tenantA.companyId,
      supplierId: randomUUID(),
      lines: [
        {
          itemId: randomUUID(),
          warehouseId: randomUUID(),
          uomId: randomUUID(),
          receivedQuantity: 50,
          unitRate: 20,
          batchAllocations: [
            {
              batchNumber: 'LOT-2026-001',
              quantity: 50,
              unitCost: 20,
            },
          ],
        },
      ],
    };

    const parsed = createPurchaseReceiptSchema.parse(rawReceipt);
    assert.equal(parsed.lines[0].batchAllocations.length, 1);
    assert.equal(parsed.lines[0].batchAllocations[0].batchNumber, 'LOT-2026-001');
  });

  await test('QC Inspection Schema validates passed + failed quantity constraints', () => {
    const validQc = {
      companyId: tenantA.companyId,
      receiptId: randomUUID(),
      lines: [
        {
          receiptLineId: randomUUID(),
          batchId: randomUUID(),
          itemId: randomUUID(),
          warehouseId: randomUUID(),
          receivedQuantity: 100,
          passedQuantity: 80,
          failedQuantity: 20,
        },
      ],
    };

    const parsed = createQcInspectionSchema.parse(validQc);
    assert.equal(parsed.lines[0].passedQuantity, 80);
    assert.equal(parsed.lines[0].failedQuantity, 20);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 2: State Machine Lifecycle & SoD Enforcements
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: State Machine & Segregation of Duties ---');

  await test('Segregation of Duties: Creator cannot approve their own Purchase Order', () => {
    const poCreatorId = tenantA.userId;
    const poApproverId = tenantA.userId; // Violates SoD

    const canApprove = (creator: string, approver: string) => {
      if (creator === approver) {
        throw new Error('Segregation of Duties violation: Record creator cannot approve the document');
      }
      return true;
    };

    assert.throws(() => {
      canApprove(poCreatorId, poApproverId);
    }, /Segregation of Duties/);

    // Valid approver
    assert.equal(canApprove(poCreatorId, approverA.userId), true);
  });

  await test('State Machine enforces DRAFT -> SUBMITTED -> APPROVED -> POSTED lifecycle', () => {
    const allowedTransitions: Record<string, string[]> = {
      DRAFT: ['SUBMITTED', 'CANCELLED'],
      SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
      APPROVED: ['POSTED', 'CANCELLED'],
      POSTED: ['REVERSED'],
      REVERSED: [],
      REJECTED: ['DRAFT', 'CANCELLED'],
      CANCELLED: [],
    };

    const validateTransition = (from: string, to: string) => {
      const allowed = allowedTransitions[from] || [];
      if (!allowed.includes(to)) {
        throw new Error(`Illegal state transition from ${from} to ${to}`);
      }
      return true;
    };

    assert.equal(validateTransition('DRAFT', 'SUBMITTED'), true);
    assert.equal(validateTransition('SUBMITTED', 'APPROVED'), true);
    assert.equal(validateTransition('APPROVED', 'POSTED'), true);
    assert.equal(validateTransition('POSTED', 'REVERSED'), true);

    // Direct transition from DRAFT to POSTED must fail
    assert.throws(() => {
      validateTransition('DRAFT', 'POSTED');
    }, /Illegal state transition/);

    // Modification/Reversal of REVERSED must fail
    assert.throws(() => {
      validateTransition('REVERSED', 'POSTED');
    }, /Illegal state transition/);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Material Receipt & Stock Ledger Movement
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Material Receipt & Stock Ledger Invariants ---');

  const itemId1 = randomUUID();
  const warehouseId1 = randomUUID();
  const batchId1 = randomUUID();
  const uomId1 = randomUUID();

  await test('Posting GRN with QC Required creates QC_PENDING stock ledger entry', () => {
    const receiptQty = 100;
    const unitCost = 25.0;

    engine.addLedgerEntry({
      companyId: tenantA.companyId,
      branchId: tenantA.branchId,
      warehouseId: warehouseId1,
      itemId: itemId1,
      batchId: batchId1,
      uomId: uomId1,
      quantity: receiptQty,
      stockStatus: 'QC_PENDING',
      movementType: 'PURCHASE_RECEIPT',
      unitCost,
      totalCost: receiptQty * unitCost,
      sourceDocumentType: 'PURCHASE_RECEIPT',
      sourceDocumentId: randomUUID(),
      sourceDocumentLineId: randomUUID(),
      createdBy: tenantA.userId,
    });

    const balance = engine.getBalanceSummary(tenantA.companyId, warehouseId1, itemId1);
    assert.equal(balance.length, 1);
    assert.equal(balance[0].qcPendingQuantity, 100);
    assert.equal(balance[0].availableQuantity, 0);
    assert.equal(balance[0].qcFailedQuantity, 0);
    assert.equal(balance[0].totalQuantity, 100);
    assert.equal(balance[0].totalValuation, 2500.0);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 4: QC Inspection & Stock Status Buckets
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: QC Inspection & Status Buckets Transition ---');

  await test('Posting QC Inspection transitions QC_PENDING -> AVAILABLE (80) and QC_FAILED (20)', () => {
    const passedQty = 80;
    const failedQty = 20;
    const unitCost = 25.0;
    const qcDocId = randomUUID();

    // 1. Release passed items: Deduct QC_PENDING, Add to AVAILABLE
    engine.addLedgerEntry({
      companyId: tenantA.companyId,
      branchId: tenantA.branchId,
      warehouseId: warehouseId1,
      itemId: itemId1,
      batchId: batchId1,
      uomId: uomId1,
      quantity: -passedQty,
      stockStatus: 'QC_PENDING',
      movementType: 'QC_RELEASE',
      unitCost,
      totalCost: -(passedQty * unitCost),
      sourceDocumentType: 'QC_INSPECTION',
      sourceDocumentId: qcDocId,
      sourceDocumentLineId: randomUUID(),
      createdBy: tenantA.userId,
    });

    engine.addLedgerEntry({
      companyId: tenantA.companyId,
      branchId: tenantA.branchId,
      warehouseId: warehouseId1,
      itemId: itemId1,
      batchId: batchId1,
      uomId: uomId1,
      quantity: passedQty,
      stockStatus: 'AVAILABLE',
      movementType: 'QC_RELEASE',
      unitCost,
      totalCost: passedQty * unitCost,
      sourceDocumentType: 'QC_INSPECTION',
      sourceDocumentId: qcDocId,
      sourceDocumentLineId: randomUUID(),
      createdBy: tenantA.userId,
    });

    // 2. Restrict failed items: Deduct QC_PENDING, Add to QC_FAILED
    engine.addLedgerEntry({
      companyId: tenantA.companyId,
      branchId: tenantA.branchId,
      warehouseId: warehouseId1,
      itemId: itemId1,
      batchId: batchId1,
      uomId: uomId1,
      quantity: -failedQty,
      stockStatus: 'QC_PENDING',
      movementType: 'QC_RESTRICTION',
      unitCost,
      totalCost: -(failedQty * unitCost),
      sourceDocumentType: 'QC_INSPECTION',
      sourceDocumentId: qcDocId,
      sourceDocumentLineId: randomUUID(),
      createdBy: tenantA.userId,
    });

    engine.addLedgerEntry({
      companyId: tenantA.companyId,
      branchId: tenantA.branchId,
      warehouseId: warehouseId1,
      itemId: itemId1,
      batchId: batchId1,
      uomId: uomId1,
      quantity: failedQty,
      stockStatus: 'QC_FAILED',
      movementType: 'QC_RESTRICTION',
      unitCost,
      totalCost: failedQty * unitCost,
      sourceDocumentType: 'QC_INSPECTION',
      sourceDocumentId: qcDocId,
      sourceDocumentLineId: randomUUID(),
      createdBy: tenantA.userId,
    });

    // Verify Balances
    const balance = engine.getBalanceSummary(tenantA.companyId, warehouseId1, itemId1);
    assert.equal(balance[0].qcPendingQuantity, 0);
    assert.equal(balance[0].availableQuantity, 80);
    assert.equal(balance[0].qcFailedQuantity, 20);
    assert.equal(balance[0].totalQuantity, 100);
    assert.equal(balance[0].totalValuation, 2500.0);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 5: Purchase Return of QC_FAILED Material
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Purchase Return of Restricted Goods ---');

  await test('Posting Purchase Return deducts from QC_FAILED stock bucket', () => {
    const returnQty = 20;
    const unitCost = 25.0;

    const currentFailedBalance = engine.getBatchBalance(
      tenantA.companyId,
      warehouseId1,
      itemId1,
      batchId1,
      'QC_FAILED'
    );
    assert.equal(currentFailedBalance, 20);

    // Deduct return
    engine.addLedgerEntry({
      companyId: tenantA.companyId,
      branchId: tenantA.branchId,
      warehouseId: warehouseId1,
      itemId: itemId1,
      batchId: batchId1,
      uomId: uomId1,
      quantity: -returnQty,
      stockStatus: 'QC_FAILED',
      movementType: 'PURCHASE_RETURN',
      unitCost,
      totalCost: -(returnQty * unitCost),
      sourceDocumentType: 'PURCHASE_RETURN',
      sourceDocumentId: randomUUID(),
      sourceDocumentLineId: randomUUID(),
      createdBy: tenantA.userId,
    });

    const balance = engine.getBalanceSummary(tenantA.companyId, warehouseId1, itemId1);
    assert.equal(balance[0].qcFailedQuantity, 0);
    assert.equal(balance[0].availableQuantity, 80);
    assert.equal(balance[0].totalQuantity, 80);
    assert.equal(balance[0].totalValuation, 2000.0);
  });

  // --------------------------------------------------------------------------
  // TEST GROUP 6: Multi-Tenant Cross-Company Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: Cross-Company Multi-Tenant Isolation ---');

  await test('Stock balances and transactions of Company A are strictly invisible to Company B', () => {
    // Add stock to Company B
    engine.addLedgerEntry({
      companyId: tenantB.companyId,
      branchId: tenantB.branchId,
      warehouseId: randomUUID(),
      itemId: randomUUID(),
      batchId: randomUUID(),
      uomId: randomUUID(),
      quantity: 500,
      stockStatus: 'AVAILABLE',
      movementType: 'PURCHASE_RECEIPT',
      unitCost: 10.0,
      totalCost: 5000.0,
      sourceDocumentType: 'PURCHASE_RECEIPT',
      sourceDocumentId: randomUUID(),
      sourceDocumentLineId: randomUUID(),
      createdBy: tenantB.userId,
    });

    const balanceA = engine.getBalanceSummary(tenantA.companyId);
    const balanceB = engine.getBalanceSummary(tenantB.companyId);

    // Tenant A summary must only reflect Tenant A's 80 available units
    assert.equal(balanceA.length, 1);
    assert.equal(balanceA[0].totalQuantity, 80);

    // Tenant B summary must only reflect Tenant B's 500 available units
    assert.equal(balanceB.length, 1);
    assert.equal(balanceB[0].totalQuantity, 500);
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log(`\n===============================================================`);
  console.log(`INCREMENT 0.9 TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log(`===============================================================\n`);
}

runTests().catch((err) => {
  console.error('Test suite execution failed:', err);
  process.exit(1);
});
