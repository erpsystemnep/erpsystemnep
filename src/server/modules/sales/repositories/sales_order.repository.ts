import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  SalesOrder,
  SalesOrderLine,
  SalesOrderStatus,
} from '../../../../shared/types/index.js';

export interface CreateSalesOrderDbHeaderInput {
  companyId: string;
  branchId?: string | null;
  soNumber: string;
  customerId: string;
  orderDate?: string;
  expectedDeliveryDate?: string | null;
  status: SalesOrderStatus;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  createdBy?: string | null;
}

export interface CreateSalesOrderLineDbInput {
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  uomId: string;
  orderedQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitPrice: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

export class SalesOrderRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async create(
    header: CreateSalesOrderDbHeaderInput,
    lines: CreateSalesOrderLineDbInput[],
    client?: pg.PoolClient
  ): Promise<SalesOrder> {
    const executor = this.getExecutor(client);

    const headerSql = `
      INSERT INTO sales_orders (
        company_id, branch_id, so_number, customer_id, order_date,
        expected_delivery_date, status, currency_code, exchange_rate,
        subtotal, tax_total, grand_total, notes, created_by
      ) VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    const headerValues = [
      header.companyId,
      header.branchId || null,
      header.soNumber,
      header.customerId,
      header.orderDate || null,
      header.expectedDeliveryDate || null,
      header.status,
      header.currencyCode,
      header.exchangeRate,
      header.subtotal,
      header.taxTotal,
      header.grandTotal,
      header.notes || null,
      header.createdBy || null,
    ];
    const headerRes = await executor.query(headerSql, headerValues);
    const createdOrder = headerRes.rows[0];

    const insertedLines: SalesOrderLine[] = [];
    for (const line of lines) {
      const lineSql = `
        INSERT INTO sales_order_lines (
          sales_order_id, line_number, item_id, warehouse_id, uom_id,
          ordered_quantity, conversion_factor, base_quantity,
          unit_price, discount_rate, discount_amount, tax_rate, tax_amount, line_total
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `;
      const lineValues = [
        createdOrder.id,
        line.lineNumber,
        line.itemId,
        line.warehouseId,
        line.uomId,
        line.orderedQuantity,
        line.conversionFactor,
        line.baseQuantity,
        line.unitPrice,
        line.discountRate,
        line.discountAmount,
        line.taxRate,
        line.taxAmount,
        line.lineTotal,
      ];
      const lineRes = await executor.query(lineSql, lineValues);
      insertedLines.push(this.mapLineRow(lineRes.rows[0]));
    }

    return this.mapRow(createdOrder, insertedLines);
  }

  async findById(
    id: string,
    companyId?: string,
    client?: pg.PoolClient
  ): Promise<SalesOrder | null> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT so.*,
             c.legal_name as customer_name, c.code as customer_code,
             b.code as branch_code, b.name as branch_name
      FROM sales_orders so
      LEFT JOIN business_partners c ON so.customer_id = c.id
      LEFT JOIN branches b ON so.branch_id = b.id
      WHERE so.id = $1
    `;
    const params: any[] = [id];
    if (companyId) {
      sql += ` AND so.company_id = $2`;
      params.push(companyId);
    }

    const res = await executor.query(sql, params);
    if (res.rows.length === 0) return null;

    const linesSql = `
      SELECT sol.*,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             u.code as uom_code, u.symbol as uom_symbol,
             COALESCE(deliv.delivered_qty, 0) as delivered_quantity,
             COALESCE(resv.reserved_qty, 0) as reserved_quantity
      FROM sales_order_lines sol
      LEFT JOIN items i ON sol.item_id = i.id
      LEFT JOIN warehouses w ON sol.warehouse_id = w.id
      LEFT JOIN uoms u ON sol.uom_id = u.id
      LEFT JOIN (
        SELECT sdl.sales_order_line_id, SUM(sdl.delivered_quantity) as delivered_qty
        FROM sales_delivery_lines sdl
        JOIN sales_deliveries sd ON sdl.delivery_id = sd.id
        WHERE sd.status = 'POSTED'
        GROUP BY sdl.sales_order_line_id
      ) deliv ON deliv.sales_order_line_id = sol.id
      LEFT JOIN (
        SELECT sr.sales_order_line_id, SUM(sr.reserved_quantity - sr.fulfilled_quantity - sr.released_quantity) as reserved_qty
        FROM sales_reservations sr
        WHERE sr.status = 'ACTIVE'
        GROUP BY sr.sales_order_line_id
      ) resv ON resv.sales_order_line_id = sol.id
      WHERE sol.sales_order_id = $1
      ORDER BY sol.line_number ASC
    `;
    const linesRes = await executor.query(linesSql, [id]);
    const lines = linesRes.rows.map(this.mapLineRow);

    return this.mapRow(res.rows[0], lines);
  }

  async findByNumber(
    companyId: string,
    soNumber: string,
    client?: pg.PoolClient
  ): Promise<SalesOrder | null> {
    const executor = this.getExecutor(client);
    const sql = `SELECT id FROM sales_orders WHERE company_id = $1 AND so_number = $2`;
    const res = await executor.query(sql, [companyId, soNumber]);
    if (res.rows.length === 0) return null;
    return this.findById(res.rows[0].id, companyId, client);
  }

  async list(
    companyId: string,
    filters?: {
      customerId?: string;
      status?: SalesOrderStatus;
      branchId?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    client?: pg.PoolClient
  ): Promise<{ data: SalesOrder[]; total: number }> {
    const executor = this.getExecutor(client);
    let whereSql = ` WHERE so.company_id = $1`;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.customerId) {
      whereSql += ` AND so.customer_id = $${idx++}`;
      values.push(filters.customerId);
    }
    if (filters?.status) {
      whereSql += ` AND so.status = $${idx++}`;
      values.push(filters.status);
    }
    if (filters?.branchId) {
      whereSql += ` AND so.branch_id = $${idx++}`;
      values.push(filters.branchId);
    }
    if (filters?.search) {
      whereSql += ` AND (so.so_number ILIKE $${idx} OR c.legal_name ILIKE $${idx})`;
      values.push(`%${filters.search}%`);
      idx++;
    }

    const countRes = await executor.query(
      `SELECT COUNT(*) as count FROM sales_orders so LEFT JOIN business_partners c ON so.customer_id = c.id ${whereSql}`,
      values
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT so.*,
             c.legal_name as customer_name, c.code as customer_code,
             b.code as branch_code, b.name as branch_name
      FROM sales_orders so
      LEFT JOIN business_partners c ON so.customer_id = c.id
      LEFT JOIN branches b ON so.branch_id = b.id
      ${whereSql}
      ORDER BY so.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);

    const dataRes = await executor.query(dataSql, values);
    const data = dataRes.rows.map((r) => this.mapRow(r));

    return { data, total };
  }

  async updateStatus(
    id: string,
    status: SalesOrderStatus,
    client?: pg.PoolClient,
    metadata?: {
      approvedBy?: string;
      approvedAt?: string;
      postedBy?: string;
      postedAt?: string;
    }
  ): Promise<SalesOrder | null> {
    const executor = this.getExecutor(client);
    let sql = `UPDATE sales_orders SET status = $1, updated_at = CURRENT_TIMESTAMP`;
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
      `DELETE FROM sales_orders WHERE id = $1 AND company_id = $2 AND status = 'DRAFT'`,
      [id, companyId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getTotalDeliveredQuantityForSoLine(soLineId: string, client?: pg.PoolClient): Promise<number> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT COALESCE(SUM(sdl.delivered_quantity), 0) as total_delivered
      FROM sales_delivery_lines sdl
      JOIN sales_deliveries sd ON sdl.delivery_id = sd.id
      WHERE sdl.sales_order_line_id = $1 AND sd.status = 'POSTED'
    `;
    const res = await executor.query(sql, [soLineId]);
    return parseFloat(res.rows[0].total_delivered || '0');
  }

  private mapRow(row: any, lines?: SalesOrderLine[]): SalesOrder {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      soNumber: row.so_number,
      customerId: row.customer_id,
      orderDate: row.order_date ? new Date(row.order_date).toISOString().split('T')[0] : '',
      expectedDeliveryDate: row.expected_delivery_date
        ? new Date(row.expected_delivery_date).toISOString().split('T')[0]
        : null,
      status: row.status,
      currencyCode: row.currency_code,
      exchangeRate: parseFloat(row.exchange_rate),
      subtotal: parseFloat(row.subtotal),
      taxTotal: parseFloat(row.tax_total),
      grandTotal: parseFloat(row.grand_total),
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
      branch: row.branch_name
        ? ({
            id: row.branch_id,
            code: row.branch_code,
            name: row.branch_name,
          } as any)
        : null,
      lines: lines || [],
    };
  }

  private mapLineRow(row: any): SalesOrderLine {
    const ordered = parseFloat(row.ordered_quantity);
    const delivered = parseFloat(row.delivered_quantity || '0');
    const reserved = parseFloat(row.reserved_quantity || '0');
    const remaining = Math.max(0, ordered - delivered);

    return {
      id: row.id,
      salesOrderId: row.sales_order_id,
      lineNumber: parseInt(row.line_number, 10),
      itemId: row.item_id,
      warehouseId: row.warehouse_id,
      uomId: row.uom_id,
      orderedQuantity: ordered,
      conversionFactor: parseFloat(row.conversion_factor),
      baseQuantity: parseFloat(row.base_quantity),
      unitPrice: parseFloat(row.unit_price),
      discountRate: parseFloat(row.discount_rate || '0'),
      discountAmount: parseFloat(row.discount_amount || '0'),
      taxRate: parseFloat(row.tax_rate || '0'),
      taxAmount: parseFloat(row.tax_amount || '0'),
      lineTotal: parseFloat(row.line_total),
      deliveredQuantity: delivered,
      reservedQuantity: reserved,
      remainingQuantity: remaining,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
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
    };
  }
}
