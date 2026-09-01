import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  SalesReservation,
  SalesReservationStatus,
} from '../../../../shared/types/index.js';

export interface CreateSalesReservationDbInput {
  companyId: string;
  branchId?: string | null;
  salesOrderId: string;
  salesOrderLineId: string;
  itemId: string;
  warehouseId: string;
  batchId?: string | null;
  uomId: string;
  reservedQuantity: number;
  status?: SalesReservationStatus;
  createdBy?: string | null;
}

export class SalesReservationRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async create(
    input: CreateSalesReservationDbInput,
    client?: pg.PoolClient
  ): Promise<SalesReservation> {
    const executor = this.getExecutor(client);
    const sql = `
      INSERT INTO sales_reservations (
        company_id, branch_id, sales_order_id, sales_order_line_id,
        item_id, warehouse_id, batch_id, uom_id,
        reserved_quantity, fulfilled_quantity, released_quantity,
        status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, $10, $11)
      RETURNING *
    `;
    const values = [
      input.companyId,
      input.branchId || null,
      input.salesOrderId,
      input.salesOrderLineId,
      input.itemId,
      input.warehouseId,
      input.batchId || null,
      input.uomId,
      input.reservedQuantity,
      input.status || 'ACTIVE',
      input.createdBy || null,
    ];
    const res = await executor.query(sql, values);
    return this.mapRow(res.rows[0]);
  }

  async findById(
    id: string,
    companyId?: string,
    client?: pg.PoolClient
  ): Promise<SalesReservation | null> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT sr.*,
             so.so_number,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             b.batch_number as batch_number,
             u.code as uom_code, u.symbol as uom_symbol
      FROM sales_reservations sr
      LEFT JOIN sales_orders so ON sr.sales_order_id = so.id
      LEFT JOIN items i ON sr.item_id = i.id
      LEFT JOIN warehouses w ON sr.warehouse_id = w.id
      LEFT JOIN inventory_batches b ON sr.batch_id = b.id
      LEFT JOIN uoms u ON sr.uom_id = u.id
      WHERE sr.id = $1
    `;
    const params: any[] = [id];
    if (companyId) {
      sql += ` AND sr.company_id = $2`;
      params.push(companyId);
    }
    const res = await executor.query(sql, params);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async list(
    companyId: string,
    filters?: {
      salesOrderId?: string;
      itemId?: string;
      warehouseId?: string;
      status?: SalesReservationStatus;
      page?: number;
      limit?: number;
    },
    client?: pg.PoolClient
  ): Promise<{ data: SalesReservation[]; total: number }> {
    const executor = this.getExecutor(client);
    let whereSql = ` WHERE sr.company_id = $1`;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.salesOrderId) {
      whereSql += ` AND sr.sales_order_id = $${idx++}`;
      values.push(filters.salesOrderId);
    }
    if (filters?.itemId) {
      whereSql += ` AND sr.item_id = $${idx++}`;
      values.push(filters.itemId);
    }
    if (filters?.warehouseId) {
      whereSql += ` AND sr.warehouse_id = $${idx++}`;
      values.push(filters.warehouseId);
    }
    if (filters?.status) {
      whereSql += ` AND sr.status = $${idx++}`;
      values.push(filters.status);
    }

    const countRes = await executor.query(
      `SELECT COUNT(*) as count FROM sales_reservations sr ${whereSql}`,
      values
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT sr.*,
             so.so_number,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             b.batch_number as batch_number,
             u.code as uom_code, u.symbol as uom_symbol
      FROM sales_reservations sr
      LEFT JOIN sales_orders so ON sr.sales_order_id = so.id
      LEFT JOIN items i ON sr.item_id = i.id
      LEFT JOIN warehouses w ON sr.warehouse_id = w.id
      LEFT JOIN inventory_batches b ON sr.batch_id = b.id
      LEFT JOIN uoms u ON sr.uom_id = u.id
      ${whereSql}
      ORDER BY sr.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);

    const dataRes = await executor.query(dataSql, values);
    return {
      data: dataRes.rows.map(this.mapRow),
      total,
    };
  }

  async findBySalesOrder(
    salesOrderId: string,
    client?: pg.PoolClient
  ): Promise<SalesReservation[]> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT sr.*,
             so.so_number,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             b.batch_number as batch_number,
             u.code as uom_code, u.symbol as uom_symbol
      FROM sales_reservations sr
      LEFT JOIN sales_orders so ON sr.sales_order_id = so.id
      LEFT JOIN items i ON sr.item_id = i.id
      LEFT JOIN warehouses w ON sr.warehouse_id = w.id
      LEFT JOIN inventory_batches b ON sr.batch_id = b.id
      LEFT JOIN uoms u ON sr.uom_id = u.id
      WHERE sr.sales_order_id = $1
      ORDER BY sr.created_at ASC
    `;
    const res = await executor.query(sql, [salesOrderId]);
    return res.rows.map(this.mapRow);
  }

  async getActiveReservationsForLine(
    salesOrderLineId: string,
    client?: pg.PoolClient
  ): Promise<SalesReservation[]> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT sr.*,
             so.so_number,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             b.batch_number as batch_number,
             u.code as uom_code, u.symbol as uom_symbol
      FROM sales_reservations sr
      LEFT JOIN sales_orders so ON sr.sales_order_id = so.id
      LEFT JOIN items i ON sr.item_id = i.id
      LEFT JOIN warehouses w ON sr.warehouse_id = w.id
      LEFT JOIN inventory_batches b ON sr.batch_id = b.id
      LEFT JOIN uoms u ON sr.uom_id = u.id
      WHERE sr.sales_order_line_id = $1 AND sr.status = 'ACTIVE'
      ORDER BY sr.created_at ASC
    `;
    const res = await executor.query(sql, [salesOrderLineId]);
    return res.rows.map(this.mapRow);
  }

  async updateFulfilledQuantity(
    id: string,
    addedQuantity: number,
    client?: pg.PoolClient
  ): Promise<SalesReservation | null> {
    const executor = this.getExecutor(client);
    const sql = `
      UPDATE sales_reservations
      SET fulfilled_quantity = fulfilled_quantity + $1,
          status = CASE
            WHEN (fulfilled_quantity + $1 + released_quantity) >= reserved_quantity THEN 'FULFILLED'
            ELSE status
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const res = await executor.query(sql, [addedQuantity, id]);
    if (res.rows.length === 0) return null;
    return this.findById(id, undefined, client);
  }

  async updateReleasedQuantity(
    id: string,
    addedQuantity: number,
    client?: pg.PoolClient
  ): Promise<SalesReservation | null> {
    const executor = this.getExecutor(client);
    const sql = `
      UPDATE sales_reservations
      SET released_quantity = released_quantity + $1,
          status = CASE
            WHEN (fulfilled_quantity + released_quantity + $1) >= reserved_quantity THEN 'RELEASED'
            ELSE status
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const res = await executor.query(sql, [addedQuantity, id]);
    if (res.rows.length === 0) return null;
    return this.findById(id, undefined, client);
  }

  private mapRow(row: any): SalesReservation {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      salesOrderId: row.sales_order_id,
      salesOrderLineId: row.sales_order_line_id,
      itemId: row.item_id,
      warehouseId: row.warehouse_id,
      batchId: row.batch_id,
      uomId: row.uom_id,
      reservedQuantity: parseFloat(row.reserved_quantity),
      fulfilledQuantity: parseFloat(row.fulfilled_quantity || '0'),
      releasedQuantity: parseFloat(row.released_quantity || '0'),
      status: row.status,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      salesOrder: row.so_number
        ? ({
            id: row.sales_order_id,
            soNumber: row.so_number,
          } as any)
        : null,
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
