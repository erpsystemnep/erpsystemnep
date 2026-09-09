import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import { InventoryValuationTransaction, CogsReportLine } from '../../../../shared/types/index.js';

export interface CreateValuationTxDbInput {
  companyId: string;
  branchId?: string | null;
  warehouseId: string;
  itemId: string;
  batchId: string;
  costLayerId?: string | null;
  transactionType: 'RECEIPT' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT' | 'REVERSAL';
  sourceType: string;
  sourceId: string;
  sourceLineId?: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseUnitCost?: number;
  baseTotalCost?: number;
  accountingDate?: string;
  journalId?: string | null;
  status?: 'POSTED' | 'REVERSED';
  reversalJournalId?: string | null;
}

export class ValuationTransactionRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  private mapRow(row: any): InventoryValuationTransaction {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      warehouseId: row.warehouse_id,
      itemId: row.item_id,
      batchId: row.batch_id,
      costLayerId: row.cost_layer_id,
      transactionType: row.transaction_type,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceLineId: row.source_line_id,
      quantity: parseFloat(row.quantity || '0'),
      unitCost: parseFloat(row.unit_cost || '0'),
      totalCost: parseFloat(row.total_cost || '0'),
      currencyCode: row.currency_code || 'USD',
      exchangeRate: parseFloat(row.exchange_rate || '1.0'),
      baseUnitCost: parseFloat(row.base_unit_cost || row.unit_cost || '0'),
      baseTotalCost: parseFloat(row.base_total_cost || row.total_cost || '0'),
      accountingDate: row.accounting_date ? new Date(row.accounting_date).toISOString().split('T')[0] : '',
      journalId: row.journal_id,
      status: row.status || 'POSTED',
      reversalJournalId: row.reversal_journal_id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      item: row.item_code ? {
        id: row.item_id,
        itemCode: row.item_code,
        itemName: row.item_name,
      } as any : undefined,
      warehouse: row.warehouse_name ? {
        id: row.warehouse_id,
        name: row.warehouse_name,
      } as any : undefined,
      batch: row.batch_number ? {
        id: row.batch_id,
        batchNumber: row.batch_number,
      } as any : undefined,
    };
  }

  async createTransaction(
    tx: CreateValuationTxDbInput,
    client?: pg.PoolClient
  ): Promise<InventoryValuationTransaction> {
    const executor = this.getExecutor(client);
    const sql = `
      INSERT INTO inventory_valuation_transactions (
        company_id, branch_id, warehouse_id, item_id, batch_id, cost_layer_id,
        transaction_type, source_type, source_id, source_line_id,
        quantity, unit_cost, total_cost, currency_code, exchange_rate,
        base_unit_cost, base_total_cost, accounting_date, journal_id,
        status, reversal_journal_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `;
    const values = [
      tx.companyId,
      tx.branchId || null,
      tx.warehouseId,
      tx.itemId,
      tx.batchId,
      tx.costLayerId || null,
      tx.transactionType,
      tx.sourceType,
      tx.sourceId,
      tx.sourceLineId || null,
      tx.quantity,
      tx.unitCost,
      tx.totalCost,
      tx.currencyCode || 'USD',
      tx.exchangeRate || 1.0,
      tx.baseUnitCost ?? tx.unitCost,
      tx.baseTotalCost ?? tx.totalCost,
      tx.accountingDate || new Date().toISOString().split('T')[0],
      tx.journalId || null,
      tx.status || 'POSTED',
      tx.reversalJournalId || null,
    ];
    const res = await executor.query(sql, values);
    return this.mapRow(res.rows[0]);
  }

  async findBySource(
    sourceType: string,
    sourceId: string,
    client?: pg.PoolClient
  ): Promise<InventoryValuationTransaction[]> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT *
      FROM inventory_valuation_transactions
      WHERE source_type = $1 AND source_id = $2
      ORDER BY created_at ASC
    `;
    const res = await executor.query(sql, [sourceType, sourceId]);
    return res.rows.map((r) => this.mapRow(r));
  }

  async markReversed(
    sourceType: string,
    sourceId: string,
    reversalJournalId?: string | null,
    client?: pg.PoolClient
  ): Promise<void> {
    const executor = this.getExecutor(client);
    const sql = `
      UPDATE inventory_valuation_transactions
      SET status = 'REVERSED',
          reversal_journal_id = COALESCE($1, reversal_journal_id)
      WHERE source_type = $2 AND source_id = $3 AND status = 'POSTED'
    `;
    await executor.query(sql, [reversalJournalId || null, sourceType, sourceId]);
  }

  async getCogsReport(
    companyId: string,
    filters: {
      startDate?: string;
      endDate?: string;
      warehouseId?: string;
      itemId?: string;
      deliveryId?: string;
    },
    client?: pg.PoolClient
  ): Promise<any[]> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT 
        vt.id,
        vt.accounting_date,
        vt.source_type,
        vt.source_id,
        vt.item_id,
        i.sku as item_code,
        i.item_name,
        b.batch_number,
        w.name as warehouse_name,
        ABS(vt.quantity) as quantity_delivered,
        vt.unit_cost,
        ABS(vt.total_cost) as total_cogs,
        vt.journal_id,
        vt.status
      FROM inventory_valuation_transactions vt
      JOIN items i ON vt.item_id = i.id
      JOIN warehouses w ON vt.warehouse_id = w.id
      JOIN inventory_batches b ON vt.batch_id = b.id
      WHERE vt.company_id = $1
        AND vt.transaction_type = 'ISSUE'
        AND vt.status = 'POSTED'
    `;
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.startDate) {
      sql += ` AND vt.accounting_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND vt.accounting_date <= $${idx++}`;
      params.push(filters.endDate);
    }
    if (filters.warehouseId) {
      sql += ` AND vt.warehouse_id = $${idx++}`;
      params.push(filters.warehouseId);
    }
    if (filters.itemId) {
      sql += ` AND vt.item_id = $${idx++}`;
      params.push(filters.itemId);
    }
    if (filters.deliveryId) {
      sql += ` AND vt.source_id = $${idx++}`;
      params.push(filters.deliveryId);
    }

    sql += ` ORDER BY vt.accounting_date DESC, vt.created_at DESC`;

    const res = await executor.query(sql, params);
    return res.rows.map((r) => ({
      id: r.id,
      accountingDate: r.accounting_date ? new Date(r.accounting_date).toISOString().split('T')[0] : '',
      sourceType: r.source_type,
      sourceId: r.source_id,
      itemId: r.item_id,
      itemCode: r.item_code,
      itemName: r.item_name,
      batchNumber: r.batch_number,
      warehouseName: r.warehouse_name,
      quantityDelivered: parseFloat(r.quantity_delivered || '0'),
      quantity: parseFloat(r.quantity_delivered || '0'),
      unitCost: parseFloat(r.unit_cost || '0'),
      totalCogs: parseFloat(r.total_cogs || '0'),
      totalCost: parseFloat(r.total_cogs || '0'),
      journalId: r.journal_id,
      status: r.status,
    }));
  }

  async list(
    companyId: string,
    filters: {
      warehouseId?: string;
      itemId?: string;
      batchId?: string;
      transactionType?: string;
      sourceType?: string;
      sourceId?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    },
    client?: pg.PoolClient
  ): Promise<{ data: InventoryValuationTransaction[]; total: number }> {
    const executor = this.getExecutor(client);
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;

    let whereClause = `WHERE vt.company_id = $1`;
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.warehouseId) {
      whereClause += ` AND vt.warehouse_id = $${idx++}`;
      params.push(filters.warehouseId);
    }
    if (filters.itemId) {
      whereClause += ` AND vt.item_id = $${idx++}`;
      params.push(filters.itemId);
    }
    if (filters.batchId) {
      whereClause += ` AND vt.batch_id = $${idx++}`;
      params.push(filters.batchId);
    }
    if (filters.transactionType) {
      whereClause += ` AND vt.transaction_type = $${idx++}`;
      params.push(filters.transactionType);
    }
    if (filters.sourceType) {
      whereClause += ` AND vt.source_type = $${idx++}`;
      params.push(filters.sourceType);
    }
    if (filters.sourceId) {
      whereClause += ` AND vt.source_id = $${idx++}`;
      params.push(filters.sourceId);
    }
    if (filters.startDate) {
      whereClause += ` AND vt.accounting_date >= $${idx++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      whereClause += ` AND vt.accounting_date <= $${idx++}`;
      params.push(filters.endDate);
    }

    const countRes = await executor.query(
      `SELECT COUNT(*) as cnt FROM inventory_valuation_transactions vt ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.cnt || '0', 10);

    const dataRes = await executor.query(
      `
      SELECT vt.*,
             i.sku as item_code, i.item_name as item_name,
             w.name as warehouse_name,
             b.batch_number as batch_number
      FROM inventory_valuation_transactions vt
      JOIN items i ON vt.item_id = i.id
      JOIN warehouses w ON vt.warehouse_id = w.id
      JOIN inventory_batches b ON vt.batch_id = b.id
      ${whereClause}
      ORDER BY vt.accounting_date DESC, vt.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
      `,
      [...params, limit, offset]
    );

    return {
      data: dataRes.rows.map((r) => this.mapRow(r)),
      total,
    };
  }
}
