import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  StockLedgerEntry,
  StockBalanceSummary,
  StockStatus,
  StockMovementType,
} from '../../../../shared/types/index.js';

export interface CreateStockLedgerEntryDbInput {
  companyId: string;
  branchId?: string | null;
  warehouseId: string;
  itemId: string;
  batchId?: string | null;
  uomId: string;
  quantity: number; // positive = inward, negative = outward
  stockStatus: StockStatus;
  movementType: StockMovementType;
  unitCost: number;
  totalCost: number;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  createdBy?: string | null;
}

export class StockLedgerRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async createEntry(
    entry: CreateStockLedgerEntryDbInput,
    client?: pg.PoolClient
  ): Promise<StockLedgerEntry> {
    const executor = this.getExecutor(client);
    const sql = `
      INSERT INTO stock_ledger (
        company_id, branch_id, warehouse_id, item_id, batch_id, uom_id,
        quantity, stock_status, movement_type, unit_cost, total_cost,
        source_document_type, source_document_id, source_document_line_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;
    const values = [
      entry.companyId,
      entry.branchId || null,
      entry.warehouseId,
      entry.itemId,
      entry.batchId || null,
      entry.uomId,
      entry.quantity,
      entry.stockStatus,
      entry.movementType,
      entry.unitCost,
      entry.totalCost,
      entry.sourceDocumentType,
      entry.sourceDocumentId,
      entry.sourceDocumentLineId || null,
      entry.createdBy || null,
    ];
    const res = await executor.query(sql, values);
    return this.mapRow(res.rows[0]);
  }

  async createEntries(
    entries: CreateStockLedgerEntryDbInput[],
    client?: pg.PoolClient
  ): Promise<StockLedgerEntry[]> {
    const results: StockLedgerEntry[] = [];
    for (const entry of entries) {
      results.push(await this.createEntry(entry, client));
    }
    return results;
  }

  async listEntries(
    companyId: string,
    filters?: {
      warehouseId?: string;
      itemId?: string;
      batchId?: string;
      stockStatus?: StockStatus;
      movementType?: StockMovementType;
      page?: number;
      limit?: number;
    },
    client?: pg.PoolClient
  ): Promise<{ data: StockLedgerEntry[]; total: number }> {
    const executor = this.getExecutor(client);
    let whereSql = ` WHERE sl.company_id = $1`;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.warehouseId) {
      whereSql += ` AND sl.warehouse_id = $${idx++}`;
      values.push(filters.warehouseId);
    }
    if (filters?.itemId) {
      whereSql += ` AND sl.item_id = $${idx++}`;
      values.push(filters.itemId);
    }
    if (filters?.batchId) {
      whereSql += ` AND sl.batch_id = $${idx++}`;
      values.push(filters.batchId);
    }
    if (filters?.stockStatus) {
      whereSql += ` AND sl.stock_status = $${idx++}`;
      values.push(filters.stockStatus);
    }
    if (filters?.movementType) {
      whereSql += ` AND sl.movement_type = $${idx++}`;
      values.push(filters.movementType);
    }

    const countRes = await executor.query(
      `SELECT COUNT(*) as count FROM stock_ledger sl ${whereSql}`,
      values
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT sl.*,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             b.batch_number as batch_number,
             u.code as uom_code, u.symbol as uom_symbol
      FROM stock_ledger sl
      LEFT JOIN items i ON sl.item_id = i.id
      LEFT JOIN warehouses w ON sl.warehouse_id = w.id
      LEFT JOIN inventory_batches b ON sl.batch_id = b.id
      LEFT JOIN uoms u ON sl.uom_id = u.id
      ${whereSql}
      ORDER BY sl.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);

    const dataRes = await executor.query(dataSql, values);
    return {
      data: dataRes.rows.map(this.mapRow),
      total,
    };
  }

  async getBalanceSummary(
    companyId: string,
    filters?: { warehouseId?: string; itemId?: string },
    client?: pg.PoolClient
  ): Promise<StockBalanceSummary[]> {
    const executor = this.getExecutor(client);
    let whereSql = ` WHERE sl.company_id = $1`;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.warehouseId) {
      whereSql += ` AND sl.warehouse_id = $${idx++}`;
      values.push(filters.warehouseId);
    }
    if (filters?.itemId) {
      whereSql += ` AND sl.item_id = $${idx++}`;
      values.push(filters.itemId);
    }

    const sql = `
      SELECT sl.company_id,
             sl.warehouse_id, w.name as warehouse_name,
             sl.item_id, i.sku as item_sku, i.item_name as item_name,
             sl.batch_id, b.batch_number as batch_number,
             sl.uom_id, u.symbol as uom_symbol,
             SUM(CASE WHEN sl.stock_status = 'AVAILABLE' THEN sl.quantity ELSE 0 END) as available_quantity,
             SUM(CASE WHEN sl.stock_status = 'RESERVED' THEN sl.quantity ELSE 0 END) as reserved_quantity,
             SUM(CASE WHEN sl.stock_status = 'QC_PENDING' THEN sl.quantity ELSE 0 END) as qc_pending_quantity,
             SUM(CASE WHEN sl.stock_status = 'QC_FAILED' THEN sl.quantity ELSE 0 END) as qc_failed_quantity,
             SUM(sl.quantity) as total_physical_quantity
      FROM stock_ledger sl
      LEFT JOIN items i ON sl.item_id = i.id
      LEFT JOIN warehouses w ON sl.warehouse_id = w.id
      LEFT JOIN inventory_batches b ON sl.batch_id = b.id
      LEFT JOIN uoms u ON sl.uom_id = u.id
      ${whereSql}
      GROUP BY sl.company_id, sl.warehouse_id, w.name, sl.item_id, i.sku, i.item_name, sl.batch_id, b.batch_number, sl.uom_id, u.symbol
      HAVING SUM(sl.quantity) != 0 OR SUM(CASE WHEN sl.stock_status = 'AVAILABLE' THEN sl.quantity ELSE 0 END) != 0 OR SUM(CASE WHEN sl.stock_status = 'RESERVED' THEN sl.quantity ELSE 0 END) != 0
      ORDER BY i.sku ASC, b.batch_number ASC
    `;
    const res = await executor.query(sql, values);
    return res.rows.map((r) => ({
      companyId: r.company_id,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      itemId: r.item_id,
      itemSku: r.item_sku,
      itemName: r.item_name,
      batchId: r.batch_id,
      batchNumber: r.batch_number,
      uomId: r.uom_id,
      uomSymbol: r.uom_symbol,
      availableQuantity: parseFloat(r.available_quantity || '0'),
      reservedQuantity: parseFloat(r.reserved_quantity || '0'),
      qcPendingQuantity: parseFloat(r.qc_pending_quantity || '0'),
      qcFailedQuantity: parseFloat(r.qc_failed_quantity || '0'),
      totalPhysicalQuantity: parseFloat(r.total_physical_quantity || '0'),
    }));
  }

  async getItemStockBalance(
    companyId: string,
    warehouseId: string,
    itemId: string,
    stockStatus: StockStatus,
    client?: pg.PoolClient
  ): Promise<number> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT COALESCE(SUM(quantity), 0) as balance
      FROM stock_ledger
      WHERE company_id = $1
        AND warehouse_id = $2
        AND item_id = $3
        AND stock_status = $4
    `;
    const res = await executor.query(sql, [companyId, warehouseId, itemId, stockStatus]);
    return parseFloat(res.rows[0].balance || '0');
  }

  async getBatchStockBalance(
    companyId: string,
    warehouseId: string,
    itemId: string,
    batchId: string,
    stockStatus: StockStatus,
    client?: pg.PoolClient
  ): Promise<number> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT COALESCE(SUM(quantity), 0) as balance
      FROM stock_ledger
      WHERE company_id = $1
        AND warehouse_id = $2
        AND item_id = $3
        AND batch_id = $4
        AND stock_status = $5
    `;
    const res = await executor.query(sql, [companyId, warehouseId, itemId, batchId, stockStatus]);
    return parseFloat(res.rows[0].balance || '0');
  }

  private mapRow(row: any): StockLedgerEntry {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      warehouseId: row.warehouse_id,
      itemId: row.item_id,
      batchId: row.batch_id,
      uomId: row.uom_id,
      quantity: parseFloat(row.quantity),
      stockStatus: row.stock_status,
      movementType: row.movement_type,
      unitCost: parseFloat(row.unit_cost),
      totalCost: parseFloat(row.total_cost),
      sourceDocumentType: row.source_document_type,
      sourceDocumentId: row.source_document_id,
      sourceDocumentLineId: row.source_document_line_id,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at).toISOString(),
      item: row.item_name
        ? ({
            id: row.item_id,
            sku: row.item_sku,
            itemName: row.item_name,
          } as any)
        : null,
      warehouse: row.warehouse_name
        ? ({
            id: row.warehouse_id,
            code: row.warehouse_code,
            name: row.warehouse_name,
          } as any)
        : null,
      batch: row.batch_number
        ? ({
            id: row.batch_id,
            batchNumber: row.batch_number,
          } as any)
        : null,
      uom: row.uom_symbol
        ? ({
            id: row.uom_id,
            code: row.uom_code,
            symbol: row.uom_symbol,
          } as any)
        : null,
    };
  }
}
