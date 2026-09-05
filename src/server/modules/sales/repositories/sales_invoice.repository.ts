import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceStatus,
} from '../../../../shared/types/index.js';

export interface CreateSalesInvoiceDbHeaderInput {
  companyId: string;
  branchId?: string | null;
  invoiceNumber: string;
  customerId: string;
  salesOrderId?: string | null;
  deliveryId?: string | null;
  invoiceDate?: string;
  dueDate?: string | null;
  status: SalesInvoiceStatus;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  createdBy?: string | null;
}

export interface CreateSalesInvoiceLineDbInput {
  salesOrderLineId?: string | null;
  deliveryLineId?: string | null;
  lineNumber: number;
  itemId: string;
  warehouseId?: string | null;
  uomId: string;
  quantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitPrice: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineNet: number;
  lineTotal: number;
  revenueAccountId?: string | null;
}

export class SalesInvoiceRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  private mapRowToEntity(row: any, lines: SalesInvoiceLine[] = []): SalesInvoice {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id || null,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      salesOrderId: row.sales_order_id || null,
      deliveryId: row.delivery_id || null,
      invoiceDate: new Date(row.invoice_date).toISOString().split('T')[0],
      dueDate: row.due_date ? new Date(row.due_date).toISOString().split('T')[0] : null,
      status: row.status,
      currencyCode: row.currency_code,
      exchangeRate: Number(row.exchange_rate),
      subtotal: Number(row.subtotal),
      discountTotal: Number(row.discount_total),
      taxTotal: Number(row.tax_total),
      grandTotal: Number(row.grand_total),
      notes: row.notes || null,
      createdBy: row.created_by || null,
      approvedBy: row.approved_by || null,
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      postedBy: row.posted_by || null,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      reversedBy: row.reversed_by || null,
      reversedAt: row.reversed_at ? new Date(row.reversed_at).toISOString() : null,
      journalId: row.journal_id || null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      customer: row.customer_name
        ? {
            id: row.customer_id,
            companyId: row.company_id,
            partnerCode: row.customer_code,
            legalName: row.customer_name,
            tradeName: row.customer_name,
            partnerType: 'ORGANIZATION',
            countryCode: 'US',
            currencyCode: row.currency_code || 'USD',
            isCustomer: true,
            isSupplier: false,
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      salesOrder: row.so_number
        ? {
            id: row.sales_order_id,
            companyId: row.company_id,
            soNumber: row.so_number,
            customerId: row.customer_id,
            orderDate: row.invoice_date || new Date().toISOString().split('T')[0],
            status: row.so_status,
            currencyCode: row.currency_code,
            exchangeRate: Number(row.exchange_rate || 1),
            subtotal: 0,
            taxTotal: 0,
            grandTotal: 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      delivery: row.delivery_number
        ? {
            id: row.delivery_id,
            companyId: row.company_id,
            deliveryNumber: row.delivery_number,
            customerId: row.customer_id,
            deliveryDate: row.delivery_date,
            status: row.delivery_status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      lines,
    };
  }

  private mapLineRowToEntity(row: any): SalesInvoiceLine {
    return {
      id: row.id,
      salesInvoiceId: row.sales_invoice_id,
      salesOrderLineId: row.sales_order_line_id || null,
      deliveryLineId: row.delivery_line_id || null,
      lineNumber: Number(row.line_number),
      itemId: row.item_id,
      warehouseId: row.warehouse_id || null,
      uomId: row.uom_id,
      quantity: Number(row.quantity),
      conversionFactor: Number(row.conversion_factor),
      baseQuantity: Number(row.base_quantity),
      unitPrice: Number(row.unit_price),
      discountRate: Number(row.discount_rate),
      discountAmount: Number(row.discount_amount),
      taxRate: Number(row.tax_rate),
      taxAmount: Number(row.tax_amount),
      lineNet: Number(row.line_net),
      lineTotal: Number(row.line_total),
      revenueAccountId: row.revenue_account_id || null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      item: row.sku
        ? {
            id: row.item_id,
            companyId: row.company_id || '',
            sku: row.sku,
            itemName: row.item_name,
            itemType: 'FINISHED_GOOD',
            categoryId: row.category_id || '',
            baseUomId: row.uom_id,
            isStockItem: true,
            isSaleable: true,
            isPurchasable: true,
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      warehouse: row.warehouse_code
        ? {
            id: row.warehouse_id,
            companyId: row.company_id || '',
            code: row.warehouse_code,
            name: row.warehouse_name,
            warehouseType: 'PHYSICAL',
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      uom: row.uom_code
        ? {
            id: row.uom_id,
            companyId: row.company_id || '',
            code: row.uom_code,
            name: row.uom_name,
            symbol: row.uom_code || '',
            uomType: 'COUNT',
            conversionPrecision: 2,
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
    };
  }

  async create(
    header: CreateSalesInvoiceDbHeaderInput,
    lines: CreateSalesInvoiceLineDbInput[],
    client?: pg.PoolClient
  ): Promise<SalesInvoice> {
    const executor = this.getExecutor(client);

    const headerSql = `
      INSERT INTO sales_invoices (
        company_id, branch_id, invoice_number, customer_id, sales_order_id,
        delivery_id, invoice_date, due_date, status, currency_code,
        exchange_rate, subtotal, discount_total, tax_total, grand_total,
        notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE), $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `;
    const headerValues = [
      header.companyId,
      header.branchId || null,
      header.invoiceNumber,
      header.customerId,
      header.salesOrderId || null,
      header.deliveryId || null,
      header.invoiceDate || null,
      header.dueDate || null,
      header.status,
      header.currencyCode,
      header.exchangeRate,
      header.subtotal,
      header.discountTotal,
      header.taxTotal,
      header.grandTotal,
      header.notes || null,
      header.createdBy || null,
    ];
    const headerRes = await executor.query(headerSql, headerValues);
    const invoiceId = headerRes.rows[0].id;

    const createdLines: SalesInvoiceLine[] = [];
    for (const line of lines) {
      const lineSql = `
        INSERT INTO sales_invoice_lines (
          sales_invoice_id, sales_order_line_id, delivery_line_id, line_number,
          item_id, warehouse_id, uom_id, quantity, conversion_factor,
          base_quantity, unit_price, discount_rate, discount_amount,
          tax_rate, tax_amount, line_net, line_total, revenue_account_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *
      `;
      const lineValues = [
        invoiceId,
        line.salesOrderLineId || null,
        line.deliveryLineId || null,
        line.lineNumber,
        line.itemId,
        line.warehouseId || null,
        line.uomId,
        line.quantity,
        line.conversionFactor,
        line.baseQuantity,
        line.unitPrice,
        line.discountRate,
        line.discountAmount,
        line.taxRate,
        line.taxAmount,
        line.lineNet,
        line.lineTotal,
        line.revenueAccountId || null,
      ];
      const lineRes = await executor.query(lineSql, lineValues);
      createdLines.push(this.mapLineRowToEntity(lineRes.rows[0]));
    }

    return this.mapRowToEntity(headerRes.rows[0], createdLines);
  }

  async findById(id: string, companyId: string, client?: pg.PoolClient): Promise<SalesInvoice | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT si.*, bp.partner_code as customer_code, bp.legal_name as customer_name,
             so.so_number, so.status as so_status,
             sd.delivery_number, sd.status as delivery_status, sd.delivery_date
      FROM sales_invoices si
      JOIN business_partners bp ON bp.id = si.customer_id
      LEFT JOIN sales_orders so ON so.id = si.sales_order_id
      LEFT JOIN sales_deliveries sd ON sd.id = si.delivery_id
      WHERE si.id = $1 AND si.company_id = $2
    `;
    const res = await executor.query(sql, [id, companyId]);
    if (res.rows.length === 0) return null;

    const linesSql = `
      SELECT sil.*, i.sku, i.item_name, i.category_id,
             w.code as warehouse_code, w.name as warehouse_name,
             u.code as uom_code, u.name as uom_name
      FROM sales_invoice_lines sil
      JOIN items i ON i.id = sil.item_id
      LEFT JOIN warehouses w ON w.id = sil.warehouse_id
      JOIN uoms u ON u.id = sil.uom_id
      WHERE sil.sales_invoice_id = $1
      ORDER BY sil.line_number ASC
    `;
    const linesRes = await executor.query(linesSql, [id]);
    const lines = linesRes.rows.map((r) => this.mapLineRowToEntity(r));

    return this.mapRowToEntity(res.rows[0], lines);
  }

  async findByNumber(invoiceNumber: string, companyId: string, client?: pg.PoolClient): Promise<SalesInvoice | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT si.*, bp.partner_code as customer_code, bp.legal_name as customer_name,
             so.so_number, so.status as so_status,
             sd.delivery_number, sd.status as delivery_status, sd.delivery_date
      FROM sales_invoices si
      JOIN business_partners bp ON bp.id = si.customer_id
      LEFT JOIN sales_orders so ON so.id = si.sales_order_id
      LEFT JOIN sales_deliveries sd ON sd.id = si.delivery_id
      WHERE si.invoice_number = $1 AND si.company_id = $2
    `;
    const res = await executor.query(sql, [invoiceNumber, companyId]);
    if (res.rows.length === 0) return null;

    const linesSql = `
      SELECT sil.*, i.sku, i.item_name, i.category_id,
             w.code as warehouse_code, w.name as warehouse_name,
             u.code as uom_code, u.name as uom_name
      FROM sales_invoice_lines sil
      JOIN items i ON i.id = sil.item_id
      LEFT JOIN warehouses w ON w.id = sil.warehouse_id
      JOIN uoms u ON u.id = sil.uom_id
      WHERE sil.sales_invoice_id = $1
      ORDER BY sil.line_number ASC
    `;
    const linesRes = await executor.query(linesSql, [res.rows[0].id]);
    const lines = linesRes.rows.map((r) => this.mapLineRowToEntity(r));

    return this.mapRowToEntity(res.rows[0], lines);
  }

  async updateStatus(
    id: string,
    companyId: string,
    status: SalesInvoiceStatus,
    metadata?: {
      approvedBy?: string;
      postedBy?: string;
      reversedBy?: string;
      journalId?: string;
    },
    client?: pg.PoolClient
  ): Promise<void> {
    const executor = this.getExecutor(client);
    let extraSql = '';
    const values: any[] = [status, id, companyId];
    let idx = 4;

    if (metadata?.approvedBy) {
      extraSql += `, approved_by = $${idx++}, approved_at = CURRENT_TIMESTAMP`;
      values.push(metadata.approvedBy);
    }
    if (metadata?.postedBy) {
      extraSql += `, posted_by = $${idx++}, posted_at = CURRENT_TIMESTAMP`;
      values.push(metadata.postedBy);
    }
    if (metadata?.reversedBy) {
      extraSql += `, reversed_by = $${idx++}, reversed_at = CURRENT_TIMESTAMP`;
      values.push(metadata.reversedBy);
    }
    if (metadata?.journalId) {
      extraSql += `, journal_id = $${idx++}`;
      values.push(metadata.journalId);
    }

    const sql = `
      UPDATE sales_invoices
      SET status = $1, updated_at = CURRENT_TIMESTAMP ${extraSql}
      WHERE id = $2 AND company_id = $3
    `;
    await executor.query(sql, values);
  }

  async findByIdForUpdate(id: string, companyId: string, client: pg.PoolClient): Promise<SalesInvoice | null> {
    const sql = `
      SELECT si.*, bp.partner_code as customer_code, bp.legal_name as customer_name,
             so.so_number, so.status as so_status,
             sd.delivery_number, sd.status as delivery_status, sd.delivery_date
      FROM sales_invoices si
      JOIN business_partners bp ON bp.id = si.customer_id
      LEFT JOIN sales_orders so ON so.id = si.sales_order_id
      LEFT JOIN sales_deliveries sd ON sd.id = si.delivery_id
      WHERE si.id = $1 AND si.company_id = $2
      FOR UPDATE OF si
    `;
    const res = await client.query(sql, [id, companyId]);
    if (res.rows.length === 0) return null;

    const linesSql = `
      SELECT sil.*, i.sku, i.item_name, i.category_id,
             w.code as warehouse_code, w.name as warehouse_name,
             u.code as uom_code, u.name as uom_name
      FROM sales_invoice_lines sil
      JOIN items i ON i.id = sil.item_id
      LEFT JOIN warehouses w ON w.id = sil.warehouse_id
      JOIN uoms u ON u.id = sil.uom_id
      WHERE sil.sales_invoice_id = $1
      ORDER BY sil.line_number ASC
    `;
    const linesRes = await client.query(linesSql, [id]);
    const lines = linesRes.rows.map((r) => this.mapLineRowToEntity(r));

    return this.mapRowToEntity(res.rows[0], lines);
  }

  async deleteDraft(id: string, companyId: string, client?: pg.PoolClient): Promise<boolean> {
    const executor = this.getExecutor(client);
    const sql = `
      DELETE FROM sales_invoices
      WHERE id = $1 AND company_id = $2 AND status = 'DRAFT'
      RETURNING id
    `;
    const res = await executor.query(sql, [id, companyId]);
    return res.rows.length > 0;
  }

  async getInvoicedQuantityForDeliveryLine(
    deliveryLineId: string,
    excludeInvoiceId?: string,
    client?: pg.PoolClient
  ): Promise<number> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT COALESCE(SUM(sil.quantity), 0) as total_invoiced
      FROM sales_invoice_lines sil
      JOIN sales_invoices si ON si.id = sil.sales_invoice_id
      WHERE sil.delivery_line_id = $1
        AND si.status IN ('SUBMITTED', 'APPROVED', 'POSTED')
    `;
    const params: any[] = [deliveryLineId];
    if (excludeInvoiceId) {
      sql += ` AND si.id != $2`;
      params.push(excludeInvoiceId);
    }
    const res = await executor.query(sql, params);
    return Number(res.rows[0].total_invoiced);
  }

  async getInvoicedQuantityForSalesOrderLine(
    salesOrderLineId: string,
    excludeInvoiceId?: string,
    client?: pg.PoolClient
  ): Promise<number> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT COALESCE(SUM(sil.quantity), 0) as total_invoiced
      FROM sales_invoice_lines sil
      JOIN sales_invoices si ON si.id = sil.sales_invoice_id
      WHERE sil.sales_order_line_id = $1
        AND si.status IN ('SUBMITTED', 'APPROVED', 'POSTED')
    `;
    const params: any[] = [salesOrderLineId];
    if (excludeInvoiceId) {
      sql += ` AND si.id != $2`;
      params.push(excludeInvoiceId);
    }
    const res = await executor.query(sql, params);
    return Number(res.rows[0].total_invoiced);
  }

  async list(
    companyId: string,
    filters?: {
      customerId?: string;
      salesOrderId?: string;
      deliveryId?: string;
      status?: SalesInvoiceStatus;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
    client?: pg.PoolClient
  ): Promise<{ items: SalesInvoice[]; total: number }> {
    const executor = this.getExecutor(client);
    const conditions: string[] = ['si.company_id = $1'];
    const values: any[] = [companyId];
    let paramIdx = 2;

    if (filters?.customerId) {
      conditions.push(`si.customer_id = $${paramIdx++}`);
      values.push(filters.customerId);
    }
    if (filters?.salesOrderId) {
      conditions.push(`si.sales_order_id = $${paramIdx++}`);
      values.push(filters.salesOrderId);
    }
    if (filters?.deliveryId) {
      conditions.push(`si.delivery_id = $${paramIdx++}`);
      values.push(filters.deliveryId);
    }
    if (filters?.status) {
      conditions.push(`si.status = $${paramIdx++}`);
      values.push(filters.status);
    }
    if (filters?.startDate) {
      conditions.push(`si.invoice_date >= $${paramIdx++}`);
      values.push(filters.startDate);
    }
    if (filters?.endDate) {
      conditions.push(`si.invoice_date <= $${paramIdx++}`);
      values.push(filters.endDate);
    }

    const whereClause = conditions.join(' AND ');
    const countSql = `SELECT COUNT(*) as total FROM sales_invoices si WHERE ${whereClause}`;
    const countRes = await executor.query(countSql, values);
    const total = Number(countRes.rows[0].total);

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    const sql = `
      SELECT si.*, bp.partner_code as customer_code, bp.legal_name as customer_name,
             so.so_number, so.status as so_status,
             sd.delivery_number, sd.status as delivery_status, sd.delivery_date
      FROM sales_invoices si
      JOIN business_partners bp ON bp.id = si.customer_id
      LEFT JOIN sales_orders so ON so.id = si.sales_order_id
      LEFT JOIN sales_deliveries sd ON sd.id = si.delivery_id
      WHERE ${whereClause}
      ORDER BY si.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    values.push(limit, offset);

    const res = await executor.query(sql, values);
    return {
      items: res.rows.map((r) => this.mapRowToEntity(r)),
      total,
    };
  }
}
