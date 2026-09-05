import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  PurchaseInvoice,
  PurchaseInvoiceLine,
  PurchaseInvoiceStatus,
} from '../../../../shared/types/index.js';

export interface CreatePurchaseInvoiceDbHeaderInput {
  companyId: string;
  branchId?: string | null;
  invoiceNumber: string;
  supplierInvoiceRef?: string | null;
  supplierId: string;
  purchaseOrderId?: string | null;
  receiptId?: string | null;
  invoiceDate?: string;
  dueDate?: string | null;
  status: PurchaseInvoiceStatus;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  createdBy?: string | null;
}

export interface CreatePurchaseInvoiceLineDbInput {
  purchaseReceiptLineId: string;
  poLineId?: string | null;
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
  expenseAccountId?: string | null;
}

export class PurchaseInvoiceRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  private mapRowToEntity(row: any, lines: PurchaseInvoiceLine[] = []): PurchaseInvoice {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id || null,
      invoiceNumber: row.invoice_number,
      supplierInvoiceRef: row.supplier_invoice_ref || null,
      supplierId: row.supplier_id,
      purchaseOrderId: row.purchase_order_id || null,
      receiptId: row.receipt_id || null,
      invoiceDate: row.invoice_date instanceof Date ? row.invoice_date.toISOString().split('T')[0] : String(row.invoice_date).split('T')[0],
      dueDate: row.due_date ? (row.due_date instanceof Date ? row.due_date.toISOString().split('T')[0] : String(row.due_date).split('T')[0]) : null,
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
      lines,
      supplier: row.supplier_legal_name
        ? {
            id: row.supplier_id,
            companyId: row.company_id,
            partnerCode: row.supplier_code || 'SUPPLIER',
            countryCode: row.country_code || 'US',
            partnerType: 'ORGANIZATION',
            legalName: row.supplier_legal_name,
            tradeName: row.supplier_trade_name || undefined,
            isCustomer: false,
            isSupplier: true,
            taxIdentifier: row.supplier_tax_number || undefined,
            currencyCode: row.currency_code,
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      payable: row.payable_id
        ? {
            id: row.payable_id,
            companyId: row.company_id,
            supplierId: row.supplier_id,
            purchaseInvoiceId: row.id,
            currencyCode: row.currency_code,
            invoiceAmount: Number(row.payable_invoice_amount || row.grand_total),
            paidAmount: Number(row.payable_paid_amount || 0),
            outstandingAmount: Number(row.payable_outstanding_amount || row.grand_total),
            invoiceDate: row.invoice_date,
            dueDate: row.due_date,
            status: row.payable_status || 'OPEN',
            createdAt: row.payable_created_at || row.created_at,
            updatedAt: row.payable_updated_at || row.updated_at,
          }
        : undefined,
    };
  }

  private mapLineRow(row: any): PurchaseInvoiceLine {
    return {
      id: row.id,
      purchaseInvoiceId: row.purchase_invoice_id,
      purchaseReceiptLineId: row.purchase_receipt_line_id,
      poLineId: row.po_line_id || null,
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
      expenseAccountId: row.expense_account_id || null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      item: row.item_sku
        ? {
            id: row.item_id,
            companyId: row.company_id,
            sku: row.item_sku,
            itemName: row.item_name,
            categoryId: row.item_category_id || '',
            baseUomId: row.uom_id,
            itemType: (row.item_type as any) || 'FINISHED_GOOD',
            isStockItem: true,
            isSaleable: false,
            isPurchasable: true,
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      uom: row.uom_code
        ? {
            id: row.uom_id,
            companyId: row.company_id,
            code: row.uom_code,
            name: row.uom_name || row.uom_code,
            symbol: row.uom_symbol || row.uom_code,
            uomType: 'COUNT',
            conversionPrecision: 4,
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      warehouse: row.warehouse_code
        ? {
            id: row.warehouse_id,
            companyId: row.company_id,
            code: row.warehouse_code,
            name: row.warehouse_name || row.warehouse_code,
            warehouseType: 'PHYSICAL',
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
    };
  }

  async create(
    header: CreatePurchaseInvoiceDbHeaderInput,
    lines: CreatePurchaseInvoiceLineDbInput[],
    client?: pg.PoolClient
  ): Promise<PurchaseInvoice> {
    const executor = this.getExecutor(client);

    const headerRes = await executor.query(
      `INSERT INTO purchase_invoices (
        company_id, branch_id, invoice_number, supplier_invoice_ref, supplier_id,
        purchase_order_id, receipt_id, invoice_date, due_date, status,
        currency_code, exchange_rate, subtotal, discount_total, tax_total, grand_total,
        notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        header.companyId,
        header.branchId || null,
        header.invoiceNumber,
        header.supplierInvoiceRef || null,
        header.supplierId,
        header.purchaseOrderId || null,
        header.receiptId || null,
        header.invoiceDate || new Date().toISOString().split('T')[0],
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
      ]
    );

    const invoiceRow = headerRes.rows[0];
    const insertedLines: PurchaseInvoiceLine[] = [];

    for (const line of lines) {
      const lineRes = await executor.query(
        `INSERT INTO purchase_invoice_lines (
          purchase_invoice_id, purchase_receipt_line_id, po_line_id, line_number,
          item_id, warehouse_id, uom_id, quantity, conversion_factor, base_quantity,
          unit_price, discount_rate, discount_amount, tax_rate, tax_amount,
          line_net, line_total, expense_account_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *`,
        [
          invoiceRow.id,
          line.purchaseReceiptLineId,
          line.poLineId || null,
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
          line.expenseAccountId || null,
        ]
      );
      insertedLines.push(this.mapLineRow(lineRes.rows[0]));
    }

    return this.mapRowToEntity(invoiceRow, insertedLines);
  }

  async findById(id: string, companyId?: string, client?: pg.PoolClient): Promise<PurchaseInvoice | null> {
    const executor = this.getExecutor(client);
    const params: any[] = [id];
    let query = `
      SELECT pi.*, 
             bp.legal_name as supplier_legal_name,
             bp.trade_name as supplier_trade_name,
             bp.tax_number as supplier_tax_number
      FROM purchase_invoices pi
      LEFT JOIN business_partners bp ON pi.supplier_id = bp.id
      WHERE pi.id = $1
    `;

    if (companyId) {
      params.push(companyId);
      query += ` AND pi.company_id = $2`;
    }

    const res = await executor.query(query, params);
    if (res.rows.length === 0) return null;

    const linesRes = await executor.query(
      `
      SELECT pil.*,
             i.sku as item_sku,
             i.item_name as item_name,
             i.item_type as item_type,
             i.category_id as item_category_id,
             u.code as uom_code,
             u.name as uom_name,
             u.symbol as uom_symbol,
             w.code as warehouse_code,
             w.name as warehouse_name
      FROM purchase_invoice_lines pil
      LEFT JOIN items i ON pil.item_id = i.id
      LEFT JOIN uoms u ON pil.uom_id = u.id
      LEFT JOIN warehouses w ON pil.warehouse_id = w.id
      WHERE pil.purchase_invoice_id = $1
      ORDER BY pil.line_number ASC
    `,
      [id]
    );

    const lines = linesRes.rows.map((r) => this.mapLineRow(r));
    return this.mapRowToEntity(res.rows[0], lines);
  }

  async findForUpdate(id: string, companyId: string, client: pg.PoolClient): Promise<PurchaseInvoice | null> {
    const res = await client.query(
      `SELECT * FROM purchase_invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (res.rows.length === 0) return null;

    const linesRes = await client.query(
      `SELECT * FROM purchase_invoice_lines WHERE purchase_invoice_id = $1 ORDER BY line_number ASC`,
      [id]
    );
    const lines = linesRes.rows.map((r) => this.mapLineRow(r));
    return this.mapRowToEntity(res.rows[0], lines);
  }

  async updateStatus(
    id: string,
    status: PurchaseInvoiceStatus,
    extraFields: {
      approvedBy?: string | null;
      approvedAt?: string | null;
      postedBy?: string | null;
      postedAt?: string | null;
      reversedBy?: string | null;
      reversedAt?: string | null;
      journalId?: string | null;
    } = {},
    client?: pg.PoolClient
  ): Promise<PurchaseInvoice | null> {
    const executor = this.getExecutor(client);
    const res = await executor.query(
      `UPDATE purchase_invoices 
       SET status = $1,
           approved_by = COALESCE($2, approved_by),
           approved_at = COALESCE($3, approved_at),
           posted_by = COALESCE($4, posted_by),
           posted_at = COALESCE($5, posted_at),
           reversed_by = COALESCE($6, reversed_by),
           reversed_at = COALESCE($7, reversed_at),
           journal_id = COALESCE($8, journal_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [
        status,
        extraFields.approvedBy || null,
        extraFields.approvedAt || null,
        extraFields.postedBy || null,
        extraFields.postedAt || null,
        extraFields.reversedBy || null,
        extraFields.reversedAt || null,
        extraFields.journalId || null,
        id,
      ]
    );

    if (res.rows.length === 0) return null;
    return this.findById(id, undefined, client);
  }

  async list(
    companyId: string,
    filters: {
      supplierId?: string;
      purchaseOrderId?: string;
      receiptId?: string;
      status?: PurchaseInvoiceStatus;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    } = {},
    client?: pg.PoolClient
  ): Promise<{ data: PurchaseInvoice[]; total: number }> {
    const executor = this.getExecutor(client);
    const conditions: string[] = ['pi.company_id = $1'];
    const params: any[] = [companyId];
    let pIndex = 2;

    if (filters.supplierId) {
      conditions.push(`pi.supplier_id = $${pIndex++}`);
      params.push(filters.supplierId);
    }
    if (filters.purchaseOrderId) {
      conditions.push(`pi.purchase_order_id = $${pIndex++}`);
      params.push(filters.purchaseOrderId);
    }
    if (filters.receiptId) {
      conditions.push(`pi.receipt_id = $${pIndex++}`);
      params.push(filters.receiptId);
    }
    if (filters.status) {
      conditions.push(`pi.status = $${pIndex++}`);
      params.push(filters.status);
    }
    if (filters.startDate) {
      conditions.push(`pi.invoice_date >= $${pIndex++}`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`pi.invoice_date <= $${pIndex++}`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await executor.query(
      `SELECT COUNT(*)::int as count FROM purchase_invoices pi WHERE ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.count || 0;

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    params.push(limit, offset);

    const listRes = await executor.query(
      `
      SELECT pi.*,
             bp.legal_name as supplier_legal_name,
             bp.trade_name as supplier_trade_name,
             bp.tax_number as supplier_tax_number
      FROM purchase_invoices pi
      LEFT JOIN business_partners bp ON pi.supplier_id = bp.id
      WHERE ${whereClause}
      ORDER BY pi.created_at DESC
      LIMIT $${pIndex++} OFFSET $${pIndex++}
    `,
      params
    );

    const data: PurchaseInvoice[] = [];
    for (const row of listRes.rows) {
      data.push(this.mapRowToEntity(row));
    }

    return { data, total };
  }

  async getInvoicedQuantityForReceiptLine(
    receiptLineId: string,
    companyId: string,
    excludeInvoiceId?: string,
    client?: pg.PoolClient
  ): Promise<number> {
    const executor = this.getExecutor(client);
    const params: any[] = [receiptLineId, companyId];
    let query = `
      SELECT COALESCE(SUM(pil.quantity), 0) as total_invoiced
      FROM purchase_invoice_lines pil
      JOIN purchase_invoices pi ON pil.purchase_invoice_id = pi.id
      WHERE pil.purchase_receipt_line_id = $1
        AND pi.company_id = $2
        AND pi.status NOT IN ('CANCELLED', 'REVERSED')
    `;

    if (excludeInvoiceId) {
      params.push(excludeInvoiceId);
      query += ` AND pi.id != $3`;
    }

    const res = await executor.query(query, params);
    return Number(res.rows[0]?.total_invoiced || 0);
  }

  async deleteDraft(id: string, companyId: string, client?: pg.PoolClient): Promise<boolean> {
    const executor = this.getExecutor(client);
    await executor.query(`DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id = $1`, [id]);
    const res = await executor.query(
      `DELETE FROM purchase_invoices WHERE id = $1 AND company_id = $2 AND status = 'DRAFT' RETURNING id`,
      [id, companyId]
    );
    return res.rows.length > 0;
  }
}
