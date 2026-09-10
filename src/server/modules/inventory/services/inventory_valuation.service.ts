import pg from 'pg';
import { CostLayerRepository } from '../repositories/cost_layer.repository.js';
import { ValuationTransactionRepository } from '../repositories/valuation_transaction.repository.js';
import { ChartOfAccountsRepository } from '../../accounting/repositories/chart_of_accounts.repository.js';
import { AccountingJournalRepository } from '../../accounting/repositories/accounting_journal.repository.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { getPool, withTransaction } from '../../../db/connection.js';
import {
  InventoryCostLayer,
  InventoryValuationTransaction,
  InventoryValuationReportSummary,
  CogsReportSummary,
  InventoryGlReconciliation,
  SecurityContext,
} from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export interface RecordReceiptCostLayerInput {
  companyId: string;
  branchId?: string | null;
  warehouseId: string;
  itemId: string;
  batchId: string;
  uomId: string;
  quantity: number;
  unitCost: number;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  accountingDate?: string;
  journalId?: string | null;
  currencyCode?: string;
  exchangeRate?: number;
}

export interface IssueBatchCostInput {
  companyId: string;
  branchId?: string | null;
  warehouseId: string;
  itemId: string;
  batchId: string;
  quantity: number;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  accountingDate?: string;
}

export interface ConsumedLayerResult {
  layerId: string;
  batchId: string;
  quantityConsumed: number;
  unitCost: number;
  totalCost: number;
}

export class InventoryValuationService {
  constructor(
    private costLayerRepo: CostLayerRepository = new CostLayerRepository(),
    private valTxRepo: ValuationTransactionRepository = new ValuationTransactionRepository(),
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository(),
    private journalRepo: AccountingJournalRepository = new AccountingJournalRepository(),
    private numberingService: NumberingService = new NumberingService(),
    private auditService: AuditService = new AuditService()
  ) {}

  private assertCompanyAccess(ctx: SecurityContext, targetCompanyId: string): void {
    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*')) {
      return;
    }
    if (!ctx.activeCompanyId || ctx.activeCompanyId !== targetCompanyId) {
      throw AppError.forbidden(
        `Cross-tenant access violation: Caller active company '${ctx.activeCompanyId}' cannot access inventory in company '${targetCompanyId}'`
      );
    }
  }

  /**
   * Records a new cost layer and valuation transaction for an inventory receipt (e.g. Purchase Receipt)
   */
  async recordReceiptCostLayer(
    data: RecordReceiptCostLayerInput,
    client?: pg.PoolClient
  ): Promise<{ layer: InventoryCostLayer; transaction: InventoryValuationTransaction }> {
    const totalCost = Math.round(data.quantity * data.unitCost * 10000) / 10000;
    const currencyCode = data.currencyCode || 'USD';
    const exchangeRate = data.exchangeRate || 1.0;

    const layer = await this.costLayerRepo.createLayer(
      {
        companyId: data.companyId,
        branchId: data.branchId,
        warehouseId: data.warehouseId,
        itemId: data.itemId,
        batchId: data.batchId,
        uomId: data.uomId,
        initialQuantity: data.quantity,
        remainingQuantity: data.quantity,
        unitCost: data.unitCost,
        totalCost,
        remainingValue: totalCost,
        currencyCode,
        exchangeRate,
        sourceDocumentType: data.sourceDocumentType,
        sourceDocumentId: data.sourceDocumentId,
        sourceDocumentLineId: data.sourceDocumentLineId,
        accountingDate: data.accountingDate,
      },
      client
    );

    const transaction = await this.valTxRepo.createTransaction(
      {
        companyId: data.companyId,
        branchId: data.branchId,
        warehouseId: data.warehouseId,
        itemId: data.itemId,
        batchId: data.batchId,
        costLayerId: layer.id,
        transactionType: 'RECEIPT',
        sourceType: data.sourceDocumentType,
        sourceId: data.sourceDocumentId,
        sourceLineId: data.sourceDocumentLineId,
        quantity: data.quantity,
        unitCost: data.unitCost,
        totalCost,
        currencyCode,
        exchangeRate,
        accountingDate: data.accountingDate,
        journalId: data.journalId || null,
        status: 'POSTED',
      },
      client
    );

    return { layer, transaction };
  }

  /**
   * Consumes/reduces cost layers for a purchase return
   */
  async recordReturnCostLayer(
    data: {
      companyId: string;
      branchId?: string | null;
      warehouseId: string;
      itemId: string;
      batchId: string;
      quantity: number;
      unitCost: number;
      sourceDocumentType: string;
      sourceDocumentId: string;
      sourceDocumentLineId?: string | null;
      accountingDate?: string;
    },
    client: pg.PoolClient
  ): Promise<number> {
    const totalCost = Math.round(data.quantity * data.unitCost * 10000) / 10000;
    const layers = await this.costLayerRepo.findLayersByBatch(
      data.companyId,
      data.warehouseId,
      data.itemId,
      data.batchId,
      client,
      true,
      true
    );

    let remainingToDeduct = data.quantity;
    for (const layer of layers) {
      if (remainingToDeduct <= 0) break;
      const deduct = Math.min(layer.remainingQuantity, remainingToDeduct);
      await this.costLayerRepo.consumeFromLayer(layer.id, deduct, client);
      remainingToDeduct = Math.round((remainingToDeduct - deduct) * 10000) / 10000;

      await this.valTxRepo.createTransaction(
        {
          companyId: data.companyId,
          branchId: data.branchId,
          warehouseId: data.warehouseId,
          itemId: data.itemId,
          batchId: data.batchId,
          costLayerId: layer.id,
          transactionType: 'RETURN',
          sourceType: data.sourceDocumentType,
          sourceId: data.sourceDocumentId,
          sourceLineId: data.sourceDocumentLineId,
          quantity: -deduct,
          unitCost: layer.unitCost,
          totalCost: -Math.round(deduct * layer.unitCost * 10000) / 10000,
          currencyCode: layer.currencyCode,
          exchangeRate: layer.exchangeRate,
          accountingDate: data.accountingDate || new Date().toISOString().split('T')[0],
          status: 'POSTED',
        },
        client
      );
    }

    return totalCost;
  }

  /**
   * Consumes inventory cost layers FIFO for goods delivery issues
   */
  async issueCostLayers(
    data: IssueBatchCostInput,
    client: pg.PoolClient
  ): Promise<{ consumedLayers: ConsumedLayerResult[]; totalCost: number; unitCost: number }> {
    // Lock layers for this batch
    let availableLayers = await this.costLayerRepo.findLayersByBatch(
      data.companyId,
      data.warehouseId,
      data.itemId,
      data.batchId,
      client,
      true,
      true
    );

    let remainingNeeded = data.quantity;
    const consumedLayers: ConsumedLayerResult[] = [];
    let totalCostAccum = 0;

    // If no cost layers exist (e.g. initial seeded stock without explicit purchase receipt),
    // look up batch unit_cost and create an initial layer on the fly
    if (availableLayers.length === 0) {
      const batchRes = await client.query(
        `SELECT unit_cost, uom_id FROM inventory_batches WHERE id = $1`,
        [data.batchId]
      );
      const fallbackUnitCost = batchRes.rows.length > 0 ? parseFloat(batchRes.rows[0].unit_cost || '0') : 0;
      const fallbackUomId = batchRes.rows[0]?.uom_id;

      if (fallbackUomId) {
        const syntheticLayer = await this.costLayerRepo.createLayer(
          {
            companyId: data.companyId,
            branchId: data.branchId,
            warehouseId: data.warehouseId,
            itemId: data.itemId,
            batchId: data.batchId,
            uomId: fallbackUomId,
            initialQuantity: data.quantity,
            remainingQuantity: data.quantity,
            unitCost: fallbackUnitCost,
            totalCost: data.quantity * fallbackUnitCost,
            remainingValue: data.quantity * fallbackUnitCost,
            sourceDocumentType: 'INVENTORY_ADJUSTMENT',
            sourceDocumentId: data.sourceDocumentId,
            accountingDate: data.accountingDate,
          },
          client
        );
        availableLayers = [syntheticLayer];
      }
    }

    for (const layer of availableLayers) {
      if (remainingNeeded <= 0) break;

      const takeQty = Math.min(remainingNeeded, layer.remainingQuantity);
      if (takeQty > 0) {
        await this.costLayerRepo.consumeFromLayer(layer.id, takeQty, client);

        const lineTotalCost = Math.round(takeQty * layer.unitCost * 10000) / 10000;
        totalCostAccum = Math.round((totalCostAccum + lineTotalCost) * 10000) / 10000;

        await this.valTxRepo.createTransaction(
          {
            companyId: data.companyId,
            branchId: data.branchId,
            warehouseId: data.warehouseId,
            itemId: data.itemId,
            batchId: data.batchId,
            costLayerId: layer.id,
            transactionType: 'ISSUE',
            sourceType: data.sourceDocumentType,
            sourceId: data.sourceDocumentId,
            sourceLineId: data.sourceDocumentLineId,
            quantity: -takeQty,
            unitCost: layer.unitCost,
            totalCost: -lineTotalCost,
            currencyCode: layer.currencyCode,
            exchangeRate: layer.exchangeRate,
            accountingDate: data.accountingDate,
            status: 'POSTED',
          },
          client
        );

        consumedLayers.push({
          layerId: layer.id,
          batchId: layer.batchId,
          quantityConsumed: takeQty,
          unitCost: layer.unitCost,
          totalCost: lineTotalCost,
        });

        remainingNeeded = Math.round((remainingNeeded - takeQty) * 10000) / 10000;
      }
    }

    if (remainingNeeded > 0.0001) {
      throw AppError.badRequest(
        `Insufficient cost layer quantity to issue for batch ${data.batchId}. Missing ${remainingNeeded} units.`
      );
    }

    const effectiveUnitCost = data.quantity > 0 ? Math.round((totalCostAccum / data.quantity) * 10000) / 10000 : 0;

    return {
      consumedLayers,
      totalCost: totalCostAccum,
      unitCost: effectiveUnitCost,
    };
  }

  /**
   * Restores cost layers for delivery reversals and posts compensating valuation transactions
   */
  async restoreCostLayers(
    sourceType: string,
    sourceId: string,
    client: pg.PoolClient,
    reversalJournalId?: string | null
  ): Promise<{ totalCost: number }> {
    const originalTransactions = await this.valTxRepo.findBySource(sourceType, sourceId, client);
    const issueTransactions = originalTransactions.filter(
      (t) => t.transactionType === 'ISSUE' && t.status === 'POSTED'
    );

    let totalRestoredCost = 0;

    for (const tx of issueTransactions) {
      const restoredQty = Math.abs(tx.quantity);
      const restoredCost = Math.abs(tx.totalCost);
      totalRestoredCost = Math.round((totalRestoredCost + restoredCost) * 10000) / 10000;

      if (tx.costLayerId) {
        await this.costLayerRepo.restoreToLayer(tx.costLayerId, restoredQty, client);
      }

      await this.valTxRepo.createTransaction(
        {
          companyId: tx.companyId,
          branchId: tx.branchId,
          warehouseId: tx.warehouseId,
          itemId: tx.itemId,
          batchId: tx.batchId,
          costLayerId: tx.costLayerId,
          transactionType: 'REVERSAL',
          sourceType,
          sourceId,
          sourceLineId: tx.sourceLineId,
          quantity: restoredQty,
          unitCost: tx.unitCost,
          totalCost: restoredCost,
          currencyCode: tx.currencyCode,
          exchangeRate: tx.exchangeRate,
          accountingDate: new Date().toISOString().split('T')[0],
          journalId: reversalJournalId || null,
          status: 'POSTED',
        },
        client
      );
    }

    // Mark original transactions reversed
    await this.valTxRepo.markReversed(sourceType, sourceId, reversalJournalId || null, client);

    return { totalCost: totalRestoredCost };
  }

  /**
   * Returns cost layers list
   */
  async getCostLayers(
    companyId: string,
    filters: any,
    ctx?: SecurityContext,
    client?: pg.PoolClient
  ): Promise<{ data: InventoryCostLayer[]; total: number }> {
    if (ctx) this.assertCompanyAccess(ctx, companyId);
    return this.costLayerRepo.list(companyId, filters, client);
  }

  /**
   * Returns valuation transactions list
   */
  async getTransactions(
    companyId: string,
    filters: any,
    ctx?: SecurityContext,
    client?: pg.PoolClient
  ): Promise<{ data: InventoryValuationTransaction[]; total: number }> {
    if (ctx) this.assertCompanyAccess(ctx, companyId);
    return this.valTxRepo.list(companyId, filters, client);
  }

  /**
   * Updates journalId on valuation transactions for a given source
   */
  async assignJournalToTransactions(
    sourceType: string,
    sourceId: string,
    journalId: string,
    client?: pg.PoolClient
  ): Promise<void> {
    const executor = client || getPool();
    await executor.query(
      `UPDATE inventory_valuation_transactions SET journal_id = $1 WHERE source_type = $2 AND source_id = $3 AND journal_id IS NULL`,
      [journalId, sourceType, sourceId]
    );
  }

  /**
   * Returns authoritative Inventory Valuation Report
   */
  async getValuationReport(
    companyId: string,
    filters: {
      warehouseId?: string;
      itemId?: string;
      batchId?: string;
      asOfDate?: string;
    },
    ctx?: SecurityContext,
    client?: pg.PoolClient
  ): Promise<InventoryValuationReportSummary> {
    if (ctx) this.assertCompanyAccess(ctx, companyId);
    const items = await this.costLayerRepo.getValuationReport(companyId, filters, client);

    let totalQuantity = 0;
    let totalValue = 0;

    for (const item of items) {
      totalQuantity = Math.round((totalQuantity + item.quantityOnHand) * 10000) / 10000;
      totalValue = Math.round((totalValue + item.inventoryValue) * 10000) / 10000;
    }

    return {
      companyId,
      asOfDate: filters.asOfDate || new Date().toISOString().split('T')[0],
      warehouseId: filters.warehouseId || null,
      totalItems: items.length,
      totalQuantity,
      totalValuation: totalValue,
      currencyCode: 'USD',
      items,
    };
  }

  /**
   * Returns Cost of Goods Sold (COGS) Report
   */
  async getCogsReport(
    companyId: string,
    filters: {
      startDate?: string;
      endDate?: string;
      warehouseId?: string;
      itemId?: string;
      deliveryId?: string;
    },
    ctx?: SecurityContext,
    client?: pg.PoolClient
  ): Promise<CogsReportSummary> {
    if (ctx) this.assertCompanyAccess(ctx, companyId);
    const items = await this.valTxRepo.getCogsReport(companyId, filters, client);

    let totalQuantity = 0;
    let totalCogs = 0;

    for (const item of items) {
      totalQuantity = Math.round((totalQuantity + item.quantityDelivered) * 10000) / 10000;
      totalCogs = Math.round((totalCogs + item.totalCogs) * 10000) / 10000;
    }

    return {
      companyId,
      startDate: filters.startDate || null,
      endDate: filters.endDate || null,
      totalCogs,
      totalQuantity,
      transactionCount: items.length,
      transactions: items,
    };
  }

  /**
   * Reconciles Inventory Subledger remaining cost layers with General Ledger Inventory Account (1400)
   */
  async getInventoryGlReconciliation(
    companyId: string,
    asOfDate?: string,
    ctx?: SecurityContext,
    client?: pg.PoolClient
  ): Promise<InventoryGlReconciliation> {
    if (ctx) this.assertCompanyAccess(ctx, companyId);
    const queryDate = asOfDate || new Date().toISOString().split('T')[0];
    const executor = client || getPool();

    // 1. Authoritative subledger value
    const subledgerValue = await this.costLayerRepo.getTotalSubledgerValue(companyId, queryDate, client);

    // 2. Query General Ledger Account 1400 (Inventory Asset) balance
    const glRes = await executor.query(
      `
      SELECT 
        COALESCE(SUM(ajl.base_debit), 0) as total_debit,
        COALESCE(SUM(ajl.base_credit), 0) as total_credit
      FROM chart_of_accounts coa
      JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
      JOIN accounting_journals aj ON ajl.journal_id = aj.id
      WHERE coa.company_id = $1
        AND (coa.account_code = '1400' OR coa.account_name ILIKE '%INVENTORY%')
        AND aj.status = 'POSTED'
        AND aj.posting_date <= $2
      `,
      [companyId, queryDate]
    );

    const glDebit = parseFloat(glRes.rows[0]?.total_debit || '0');
    const glCredit = parseFloat(glRes.rows[0]?.total_credit || '0');
    const inventoryGlBalance = Math.round((glDebit - glCredit) * 10000) / 10000;

    const discrepancy = Math.round((subledgerValue - inventoryGlBalance) * 10000) / 10000;
    const isReconciled = Math.abs(discrepancy) < 0.01;

    return {
      companyId,
      asOfDate: queryDate,
      subledgerTotal: subledgerValue,
      glAccount1400Balance: inventoryGlBalance,
      discrepancy,
      isReconciled,
      details: {
        activeCostLayersTotal: subledgerValue,
        valuationTransactionsNetTotal: subledgerValue,
        glDebitsTotal: glDebit,
        glCreditsTotal: glCredit,
      },
    };
  }
}
