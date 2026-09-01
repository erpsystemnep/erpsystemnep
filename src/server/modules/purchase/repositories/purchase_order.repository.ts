import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
} from '../../../../shared/types/index.js';

export interface CreatePurchaseOrderDbInput {
  companyId: string;
  branchId?: string | null;
  poNumber: string;
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate?: string | null;
  status: PurchaseOrderStatus;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  createdBy?: string | null;
}

export interface CreatePurchaseOrderLineDbInput {
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  uomId: string;
  orderedQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

export class PurchaseOrderRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async create(
    order: CreatePurchaseOrderDbInput,
    lines: CreatePurchaseOrderLineDbInput[],
    client?: pg.PoolClient
  ): Promise<PurchaseOrder> {
    const executor = this.getExecutor(client);

    const poSql = `
      INSERT INTO purchase_orders (
        company_id, branch_id, po_number, supplier_id, order_date, expected_delivery_date,
        status, currency_code, exchange_rate, subtotal, tax_total, grand_total, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    const poValues = [
      order.companyId,
      order.branchId || null,
      order.poNumber,
      order.supplierId,
      order.orderDate,
      order.expectedDeliveryDate || null,
      order.status,
      order.currencyCode,
      order.exchangeRate,
      order.subtotal,
      order.taxTotal,
      order.grandTotal,
      order.notes || null,
      order.createdBy || null,
    ];

    const poRes = await executor.query(poSql, poValues);
    const poRow = poRes.rows[0];

    const insertedLines: PurchaseOrderLine[] = [];
    for (const line of lines) {
      const lineSql = `
        INSERT INTO purchase_order_lines (
          purchase_order_id, line_number, item_id, warehouse_id, uom_id,
          ordered_quantity, conversion_factor, base_quantity, unit_price,
          tax_rate, tax_amount, line_total
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `;
      const lineValues = [
        poRow.id,
        line.lineNumber,
        line.itemId,
        line.warehouseId,
        line.uomId,
        line.orderedQuantity,
        line.conversionFactor,
        line.baseQuantity,
        line.unitPrice,
        line.taxRate,
        line.taxAmount,
        line.lineTotal,
      ];
      const lineRes = await executor.query(lineSql, lineValues);
      insertedLines.push(this.mapLineRow(lineRes.rows[0]));
    }

    return {
      ...this.mapRow(poRow),
      lines: insertedLines,
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<PurchaseOrder | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT po.*, 
             bp.partner_code as supplier_code, bp.legal_name as supplier_name
      FROM purchase_orders po
      LEFT JOIN business_partners bp ON po.supplier_id = bp.id
      WHERE po.id = $1
    `;
    const res = await executor.query(sql, [id]);
    if (res.rows.length === 0) return null;

    const po = this.mapRow(res.rows[0]);
    po.lines = await this.findLinesByPoId(id, client);
    return po;
  }

  async findByPoNumber(companyId: string, poNumber: string, client?: pg.PoolClient): Promise<PurchaseOrder | null> {
    const executor = this.getExecutor(client);
    const sql = `SELECT * FROM purchase_orders WHERE company_id = $1 AND po_number = $2`;
    const res = await executor.query(sql, [companyId, poNumber]);
    if (res.rows.length === 0) return null;
    const po = this.mapRow(res.rows[0]);
    po.lines = await this.findLinesByPoId(po.id, client);
    return po;
  }

  async findLinesByPoId(poId: string, client?: pg.PoolClient): Promise<PurchaseOrderLine[]> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT pol.*,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             u.code as uom_code, u.symbol as uom_symbol
      FROM purchase_order_lines pol
      LEFT JOIN items i ON pol.item_id = i.id
      LEFT JOIN warehouses w ON pol.warehouse_id = w.id
      LEFT JOIN uoms u ON pol.uom_id = u.id
      WHERE pol.purchase_order_id = $1
      ORDER BY pol.line_number ASC
    `;
    const res = await executor.query(sql, [poId]);
    return res.rows.map(this.mapLineRow);
  }

  async list(
    companyId: string,
    filters?: { branchId?: string | null; supplierId?: string; status?: string },
    client?: pg.PoolClient
  ): Promise<PurchaseOrder[]> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT po.*, 
             bp.partner_code as supplier_code, bp.legal_name as supplier_name
      FROM purchase_orders po
      LEFT JOIN business_partners bp ON po.supplier_id = bp.id
      WHERE po.company_id = $1
    `;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.branchId) {
      sql += ` AND po.branch_id = $${idx++}`;
      values.push(filters.branchId);
    }
    if (filters?.supplierId) {
      sql += ` AND po.supplier_id = $${idx++}`;
      values.push(filters.supplierId);
    }
    if (filters?.status) {
      sql += ` AND po.status = $${idx++}`;
      values.push(filters.status);
    }

    sql += ` ORDER BY po.created_at DESC`;
    const res = await executor.query(sql, values);
    return res.rows.map(this.mapRow);
  }

  async updateStatus(
    id: string,
    status: PurchaseOrderStatus,
    client?: pg.PoolClient,
    meta?: { approvedBy?: string | null; approvedAt?: string | null }
  ): Promise<PurchaseOrder | null> {
    const executor = this.getExecutor(client);
    let sql = `
      UPDATE purchase_orders
      SET status = $1, updated_at = CURRENT_TIMESTAMP
    `;
    const values: any[] = [status, id];
    let idx = 3;

    if (meta?.approvedBy !== undefined) {
      sql += `, approved_by = $${idx++}`;
      values.splice(values.length - 1, 0, meta.approvedBy);
    }
    if (meta?.approvedAt !== undefined) {
      sql += `, approved_at = $${idx++}`;
      values.splice(values.length - 1, 0, meta.approvedAt);
    }

    sql += ` WHERE id = $2 RETURNING *`;
    const res = await executor.query(sql, values);
    if (res.rows.length === 0) return null;
    return this.findById(id, client);
  }

  private mapRow(row: any): PurchaseOrder {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      poNumber: row.po_number,
      supplierId: row.supplier_id,
      orderDate: row.order_date instanceof Date ? row.order_date.toISOString().split('T')[0] : row.order_date,
      expectedDeliveryDate: row.expected_delivery_date
        ? row.expected_delivery_date instanceof Date
          ? row.expected_delivery_date.toISOString().split('T')[0]
          : row.expected_delivery_date
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
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      supplier: row.supplier_name
        ? {
            id: row.supplier_id,
            companyId: row.company_id,
            partnerCode: row.supplier_code,
            legalName: row.supplier_name,
            partnerType: 'ORGANIZATION',
            countryCode: 'US',
            currencyCode: row.currency_code,
            isCustomer: false,
            isSupplier: true,
            isActive: true,
            createdAt: '',
            updatedAt: '',
          }
        : null,
    };
  }

  private mapLineRow(row: any): PurchaseOrderLine {
    return {
      id: row.id,
      purchaseOrderId: row.purchase_order_id,
      lineNumber: row.line_number,
      itemId: row.item_id,
      warehouseId: row.warehouse_id,
      uomId: row.uom_id,
      orderedQuantity: parseFloat(row.ordered_quantity),
      conversionFactor: parseFloat(row.conversion_factor),
      baseQuantity: parseFloat(row.base_quantity),
      unitPrice: parseFloat(row.unit_price),
      taxRate: parseFloat(row.tax_rate),
      taxAmount: parseFloat(row.tax_amount),
      lineTotal: parseFloat(row.line_total),
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
