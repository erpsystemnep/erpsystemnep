import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import { InventoryCostLayer } from '../../../../shared/types/index.js';

export interface CreateCostLayerDbInput {
  companyId: string;
  branchId?: string | null;
  warehouseId: string;
  itemId: string;
  batchId: string;
  uomId: string;
  initialQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  totalCost: number;
  remainingValue: number;
  currencyCode?: string;
  exchangeRate?: number;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  accountingDate?: string;
}

export class CostLayerRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  private mapRow(row: any): InventoryCostLayer {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      warehouseId: row.warehouse_id,
      itemId: row.item_id,
      batchId: row.batch_id,
      uomId: row.uom_id,
      initialQuantity: parseFloat(row.initial_quantity || '0'),
      remainingQuantity: parseFloat(row.remaining_quantity || '0'),
      unitCost: parseFloat(row.unit_cost || '0'),
      totalCost: parseFloat(row.total_cost || '0'),
      remainingValue: parseFloat(row.remaining_value || '0'),
      currencyCode: row.currency_code || 'USD',
      exchangeRate: parseFloat(row.exchange_rate || '1.0'),
      sourceDocumentType: row.source_document_type,
      sourceDocumentId: row.source_document_id,
      sourceDocumentLineId: row.source_document_line_id,
      accountingDate: row.accounting_date ? new Date(row.accounting_date).toISOString().split('T')[0] : '',
      isExhausted: Boolean(row.is_exhausted),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
      item: row.item_code ? {
        id: row.item_id,
        itemCode: row.item_code,
        itemName: row.item_name,
      } as any : undefined,
      warehouse: row.warehouse_name ? {
        id: row.warehouse_id,
        name: row.warehouse_name,
        code: row.warehouse_code,
      } as any : undefined,
      batch: row.batch_number ? {
        id: row.batch_id,
        batchNumber: row.batch_number,
      } as any : undefined,
    };
  }

  async createLayer(layer: CreateCostLayerDbInput, client?: pg.PoolClient): Promise<InventoryCostLayer> {
    const executor = this.getExecutor(client);
    const sql = `
      INSERT INTO inventory_cost_layers (
        company_id, branch_id, warehouse_id, item_id, batch_id, uom_id,
        initial_quantity, remaining_quantity, unit_cost, total_cost, remaining_value,
        currency_code, exchange_rate, source_document_type, source_document_id,
        source_document_line_id, accounting_date, is_exhausted
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `;
    const values = [
      layer.companyId,
      layer.branchId || null,
      layer.warehouseId,
      layer.itemId,
      layer.batchId,
      layer.uomId,
      layer.initialQuantity,
      layer.remainingQuantity,
      layer.unitCost,
      layer.totalCost,
      layer.remainingValue,
      layer.currencyCode || 'USD',
      layer.exchangeRate || 1.0,
      layer.sourceDocumentType,
      layer.sourceDocumentId,
      layer.sourceDocumentLineId || null,
      layer.accountingDate || new Date().toISOString().split('T')[0],
      layer.remainingQuantity <= 0,
    ];
    const res = await executor.query(sql, values);
    return this.mapRow(res.rows[0]);
  }

  async findById(id: string, client?: pg.PoolClient): Promise<InventoryCostLayer | null> {
    const executor = this.getExecutor(client);
    const res = await executor.query(`SELECT * FROM inventory_cost_layers WHERE id = $1`, [id]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  /**
   * Authoritative FIFO ordering: earliest accounting_date first, then earliest created_at
   */
  async findLayersByBatch(
    companyId: string,
    warehouseId: string,
    itemId: string,
    batchId: string,
    client?: pg.PoolClient,
    activeOnly: boolean = true
  ): Promise<InventoryCostLayer[]> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT *
      FROM inventory_cost_layers
      WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND batch_id = $4
    `;
    const params: any[] = [companyId, warehouseId, itemId, batchId];

    if (activeOnly) {
      sql += ` AND remaining_quantity > 0 AND is_exhausted = FALSE`;
    }

    sql += ` ORDER BY accounting_date ASC, created_at ASC`;

    const res = await executor.query(sql, params);
    return res.rows.map((r) => this.mapRow(r));
  }

  async consumeFromLayer(layerId: string, quantity: number, client?: pg.PoolClient): Promise<void> {
    const executor = this.getExecutor(client);
    const sql = `
      UPDATE inventory_cost_layers
      SET remaining_quantity = GREATEST(0, remaining_quantity - $1),
          remaining_value = ROUND(GREATEST(0, remaining_quantity - $1) * unit_cost, 4),
          is_exhausted = (remaining_quantity - $1 <= 0.0001),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `;
    await executor.query(sql, [quantity, layerId]);
  }

  async restoreToLayer(layerId: string, quantity: number, client?: pg.PoolClient): Promise<void> {
    const executor = this.getExecutor(client);
    const sql = `
      UPDATE inventory_cost_layers
      SET remaining_quantity = remaining_quantity + $1,
          remaining_value = ROUND((remaining_quantity + $1) * unit_cost, 4),
          is_exhausted = FALSE,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `;
    await executor.query(sql, [quantity, layerId]);
  }

  async getValuationReport(
    companyId: string,
    filters: { warehouseId?: string; itemId?: string; batchId?: string; asOfDate?: string },
    client?: pg.PoolClient
  ): Promise<any[]> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT 
        l.item_id,
        i.sku as item_code,
        i.item_name,
        c.name as category_name,
        u.code as uom_code,
        SUM(l.remaining_quantity) as quantity_on_hand,
        SUM(l.remaining_value) as inventory_value,
        COUNT(l.id) as layers_count
      FROM inventory_cost_layers l
      JOIN items i ON l.item_id = i.id
      LEFT JOIN item_categories c ON i.category_id = c.id
      JOIN uoms u ON l.uom_id = u.id
      WHERE l.company_id = $1 AND l.remaining_quantity > 0
    `;
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.warehouseId) {
      sql += ` AND l.warehouse_id = $${idx++}`;
      params.push(filters.warehouseId);
    }
    if (filters.itemId) {
      sql += ` AND l.item_id = $${idx++}`;
      params.push(filters.itemId);
    }
    if (filters.batchId) {
      sql += ` AND l.batch_id = $${idx++}`;
      params.push(filters.batchId);
    }
    if (filters.asOfDate) {
      sql += ` AND l.accounting_date <= $${idx++}`;
      params.push(filters.asOfDate);
    }

    sql += `
      GROUP BY l.item_id, i.sku, i.item_name, c.name, u.code
      ORDER BY i.sku ASC
    `;

    const res = await executor.query(sql, params);
    return res.rows.map((r) => {
      const qoh = parseFloat(r.quantity_on_hand || '0');
      const val = parseFloat(r.inventory_value || '0');
      const avg = qoh > 0 ? Math.round((val / qoh) * 10000) / 10000 : 0;
      return {
        itemId: r.item_id,
        itemCode: r.item_code,
        itemName: r.item_name,
        categoryName: r.category_name,
        uomCode: r.uom_code,
        quantityOnHand: qoh,
        totalQuantity: qoh,
        inventoryValue: val,
        totalValue: val,
        averageCost: avg,
        layersCount: parseInt(r.layers_count || '0', 10),
      };
    });
  }

  async getTotalSubledgerValue(companyId: string, asOfDate: string, client?: pg.PoolClient): Promise<number> {
    const executor = this.getExecutor(client);
    const res = await executor.query(
      `
      SELECT COALESCE(SUM(remaining_value), 0) as total_value
      FROM inventory_cost_layers
      WHERE company_id = $1 AND remaining_quantity > 0 AND accounting_date <= $2
      `,
      [companyId, asOfDate]
    );
    return parseFloat(res.rows[0]?.total_value || '0');
  }

  async list(
    companyId: string,
    filters: {
      warehouseId?: string;
      itemId?: string;
      batchId?: string;
      isExhausted?: boolean;
      asOfDate?: string;
      page?: number;
      limit?: number;
    },
    client?: pg.PoolClient
  ): Promise<{ data: InventoryCostLayer[]; total: number }> {
    const executor = this.getExecutor(client);
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;

    let whereClause = `WHERE l.company_id = $1`;
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.warehouseId) {
      whereClause += ` AND l.warehouse_id = $${idx++}`;
      params.push(filters.warehouseId);
    }
    if (filters.itemId) {
      whereClause += ` AND l.item_id = $${idx++}`;
      params.push(filters.itemId);
    }
    if (filters.batchId) {
      whereClause += ` AND l.batch_id = $${idx++}`;
      params.push(filters.batchId);
    }
    if (typeof filters.isExhausted === 'boolean') {
      whereClause += ` AND l.is_exhausted = $${idx++}`;
      params.push(filters.isExhausted);
    }
    if (filters.asOfDate) {
      whereClause += ` AND l.accounting_date <= $${idx++}`;
      params.push(filters.asOfDate);
    }

    const countRes = await executor.query(
      `SELECT COUNT(*) as cnt FROM inventory_cost_layers l ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.cnt || '0', 10);

    const dataRes = await executor.query(
      `
      SELECT l.*,
             i.sku as item_code, i.item_name as item_name,
             w.name as warehouse_name, w.code as warehouse_code,
             b.batch_number as batch_number
      FROM inventory_cost_layers l
      JOIN items i ON l.item_id = i.id
      JOIN warehouses w ON l.warehouse_id = w.id
      JOIN inventory_batches b ON l.batch_id = b.id
      ${whereClause}
      ORDER BY l.accounting_date DESC, l.created_at DESC
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
