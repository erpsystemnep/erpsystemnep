import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  SalesDelivery,
  SalesDeliveryLine,
  SalesDeliveryBatchAllocation,
  SalesDeliveryStatus,
} from '../../../../shared/types/index.js';

export interface CreateDeliveryDbHeaderInput {
  companyId: string;
  branchId?: string | null;
  deliveryNumber: string;
  salesOrderId?: string | null;
  customerId: string;
  deliveryDate?: string;
  status: SalesDeliveryStatus;
  notes?: string | null;
  createdBy?: string | null;
}

export interface CreateDeliveryLineDbInput {
  salesOrderLineId?: string | null;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  uomId: string;
  deliveredQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  isReserved: boolean;
  batchAllocations: Array<{
    batchId: string;
    quantity: number;
  }>;
}

export class SalesDeliveryRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async create(
    header: CreateDeliveryDbHeaderInput,
    lines: CreateDeliveryLineDbInput[],
    client?: pg.PoolClient
  ): Promise<SalesDelivery> {
    const executor = this.getExecutor(client);

    const headerSql = `
      INSERT INTO sales_deliveries (
        company_id, branch_id, delivery_number, sales_order_id,
        customer_id, delivery_date, status, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_TIMESTAMP), $7, $8, $9)
      RETURNING *
    `;
    const headerValues = [
      header.companyId,
      header.branchId || null,
      header.deliveryNumber,
      header.salesOrderId || null,
      header.customerId,
      header.deliveryDate || null,
      header.status,
      header.notes || null,
      header.createdBy || null,
    ];
    const headerRes = await executor.query(headerSql, headerValues);
    const createdDelivery = headerRes.rows[0];

    const insertedLines: SalesDeliveryLine[] = [];
    for (const line of lines) {
      const lineSql = `
        INSERT INTO sales_delivery_lines (
          delivery_id, sales_order_line_id, line_number,
          item_id, warehouse_id, uom_id,
          delivered_quantity, conversion_factor, base_quantity, is_reserved
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;
      const lineValues = [
        createdDelivery.id,
        line.salesOrderLineId || null,
        line.lineNumber,
        line.itemId,
        line.warehouseId,
        line.uomId,
        line.deliveredQuantity,
        line.conversionFactor,
        line.baseQuantity,
        line.isReserved,
      ];
      const lineRes = await executor.query(lineSql, lineValues);
      const insertedLine = lineRes.rows[0];

      const insertedAllocations: SalesDeliveryBatchAllocation[] = [];
      for (const alloc of line.batchAllocations) {
        const allocSql = `
          INSERT INTO sales_delivery_batch_allocations (
            delivery_line_id, batch_id, quantity
          ) VALUES ($1, $2, $3)
          RETURNING *
        `;
        const allocRes = await executor.query(allocSql, [
          insertedLine.id,
          alloc.batchId,
          alloc.quantity,
        ]);
        insertedAllocations.push({
          id: allocRes.rows[0].id,
          deliveryLineId: insertedLine.id,
          batchId: alloc.batchId,
          quantity: parseFloat(allocRes.rows[0].quantity),
          createdAt: new Date(allocRes.rows[0].created_at).toISOString(),
        });
      }

      insertedLines.push(this.mapLineRow(insertedLine, insertedAllocations));
    }

    return this.mapRow(createdDelivery, insertedLines);
  }

  async findById(
    id: string,
    companyId?: string,
    client?: pg.PoolClient
  ): Promise<SalesDelivery | null> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT sd.*,
             c.legal_name as customer_name, c.code as customer_code,
             so.so_number
      FROM sales_deliveries sd
      LEFT JOIN business_partners c ON sd.customer_id = c.id
      LEFT JOIN sales_orders so ON sd.sales_order_id = so.id
      WHERE sd.id = $1
    `;
    const params: any[] = [id];
    if (companyId) {
      sql += ` AND sd.company_id = $2`;
      params.push(companyId);
    }

    const res = await executor.query(sql, params);
    if (res.rows.length === 0) return null;

    const linesSql = `
      SELECT sdl.*,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             u.code as uom_code, u.symbol as uom_symbol
      FROM sales_delivery_lines sdl
      LEFT JOIN items i ON sdl.item_id = i.id
      LEFT JOIN warehouses w ON sdl.warehouse_id = w.id
      LEFT JOIN uoms u ON sdl.uom_id = u.id
      WHERE sdl.delivery_id = $1
      ORDER BY sdl.line_number ASC
    `;
    const linesRes = await executor.query(linesSql, [id]);

    const lines: SalesDeliveryLine[] = [];
    for (const lineRow of linesRes.rows) {
      const allocSql = `
        SELECT sdba.*, b.batch_number, b.expiry_date
        FROM sales_delivery_batch_allocations sdba
        LEFT JOIN inventory_batches b ON sdba.batch_id = b.id
        WHERE sdba.delivery_line_id = $1
      `;
      const allocRes = await executor.query(allocSql, [lineRow.id]);
      const allocations: SalesDeliveryBatchAllocation[] = allocRes.rows.map((a) => ({
        id: a.id,
        deliveryLineId: a.delivery_line_id,
        batchId: a.batch_id,
        quantity: parseFloat(a.quantity),
        createdAt: new Date(a.created_at).toISOString(),
        batch: a.batch_number
          ? ({
              id: a.batch_id,
              batchNumber: a.batch_number,
              expiryDate: a.expiry_date ? new Date(a.expiry_date).toISOString().split('T')[0] : null,
            } as any)
          : null,
      }));

      lines.push(this.mapLineRow(lineRow, allocations));
    }

    return this.mapRow(res.rows[0], lines);
  }

  async findByNumber(
    companyId: string,
    deliveryNumber: string,
    client?: pg.PoolClient
  ): Promise<SalesDelivery | null> {
    const executor = this.getExecutor(client);
    const sql = `SELECT id FROM sales_deliveries WHERE company_id = $1 AND delivery_number = $2`;
    const res = await executor.query(sql, [companyId, deliveryNumber]);
    if (res.rows.length === 0) return null;
    return this.findById(res.rows[0].id, companyId, client);
  }

  async list(
    companyId: string,
    filters?: {
      customerId?: string;
      salesOrderId?: string;
      status?: SalesDeliveryStatus;
      search?: string;
      page?: number;
      limit?: number;
    },
    client?: pg.PoolClient
  ): Promise<{ data: SalesDelivery[]; total: number }> {
    const executor = this.getExecutor(client);
    let whereSql = ` WHERE sd.company_id = $1`;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.customerId) {
      whereSql += ` AND sd.customer_id = $${idx++}`;
      values.push(filters.customerId);
    }
    if (filters?.salesOrderId) {
      whereSql += ` AND sd.sales_order_id = $${idx++}`;
      values.push(filters.salesOrderId);
    }
    if (filters?.status) {
      whereSql += ` AND sd.status = $${idx++}`;
      values.push(filters.status);
    }
    if (filters?.search) {
      whereSql += ` AND (sd.delivery_number ILIKE $${idx} OR c.legal_name ILIKE $${idx})`;
      values.push(`%${filters.search}%`);
      idx++;
    }

    const countRes = await executor.query(
      `SELECT COUNT(*) as count FROM sales_deliveries sd LEFT JOIN business_partners c ON sd.customer_id = c.id ${whereSql}`,
      values
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT sd.*,
             c.legal_name as customer_name, c.code as customer_code,
             so.so_number
      FROM sales_deliveries sd
      LEFT JOIN business_partners c ON sd.customer_id = c.id
      LEFT JOIN sales_orders so ON sd.sales_order_id = so.id
      ${whereSql}
      ORDER BY sd.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);

    const dataRes = await executor.query(dataSql, values);
    const data = dataRes.rows.map((r) => this.mapRow(r));

    return { data, total };
  }

  async updateStatus(
    id: string,
    status: SalesDeliveryStatus,
    client?: pg.PoolClient,
    metadata?: {
      approvedBy?: string;
      approvedAt?: string;
      postedBy?: string;
      postedAt?: string;
    }
  ): Promise<SalesDelivery | null> {
    const executor = this.getExecutor(client);
    let sql = `UPDATE sales_deliveries SET status = $1, updated_at = CURRENT_TIMESTAMP`;
    const params: any[] = [status];
    let idx = 2;

    if (metadata?.approvedBy) {
      sql += `, approved_by = $${idx++}, approved_at = $${idx++}`;
      params.push(metadata.approvedBy, metadata.approvedAt || new Date().toISOString());
    }
    if (metadata?.postedBy) {
      sql += `, posted_by = $${idx++}, posted_at = $${idx++}`;
      params.push(metadata.postedBy, metadata.postedAt || new Date().toISOString());
    }

    sql += ` WHERE id = $${idx} RETURNING *`;
    params.push(id);

    const res = await executor.query(sql, params);
    if (res.rows.length === 0) return null;
    return this.findById(id, undefined, client);
  }

  async delete(id: string, companyId: string, client?: pg.PoolClient): Promise<boolean> {
    const executor = this.getExecutor(client);
    const res = await executor.query(
      `DELETE FROM sales_deliveries WHERE id = $1 AND company_id = $2 AND status = 'DRAFT'`,
      [id, companyId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  private mapRow(row: any, lines?: SalesDeliveryLine[]): SalesDelivery {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      deliveryNumber: row.delivery_number,
      salesOrderId: row.sales_order_id,
      customerId: row.customer_id,
      deliveryDate: new Date(row.delivery_date).toISOString(),
      status: row.status,
      notes: row.notes,
      createdBy: row.created_by,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      postedBy: row.posted_by,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      customer: row.customer_name
        ? ({
            id: row.customer_id,
            code: row.customer_code,
            legalName: row.customer_name,
          } as any)
        : null,
      salesOrder: row.so_number
        ? ({
            id: row.sales_order_id,
            soNumber: row.so_number,
          } as any)
        : null,
      lines: lines || [],
    };
  }

  private mapLineRow(row: any, allocations?: SalesDeliveryBatchAllocation[]): SalesDeliveryLine {
    return {
      id: row.id,
      deliveryId: row.delivery_id,
      salesOrderLineId: row.sales_order_line_id,
      lineNumber: parseInt(row.line_number, 10),
      itemId: row.item_id,
      warehouseId: row.warehouse_id,
      uomId: row.uom_id,
      deliveredQuantity: parseFloat(row.delivered_quantity),
      conversionFactor: parseFloat(row.conversion_factor),
      baseQuantity: parseFloat(row.base_quantity),
      isReserved: Boolean(row.is_reserved),
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
      uom: row.uom_symbol
        ? ({
            id: row.uom_id,
            code: row.uom_code,
            symbol: row.uom_symbol,
          } as any)
        : null,
      batchAllocations: allocations || [],
    };
  }
}
