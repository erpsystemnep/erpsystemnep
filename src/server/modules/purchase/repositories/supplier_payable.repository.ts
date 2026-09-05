import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  SupplierPayable,
  SupplierPayableStatus,
} from '../../../../shared/types/index.js';

export interface CreateSupplierPayableDbInput {
  companyId: string;
  branchId?: string | null;
  supplierId: string;
  purchaseInvoiceId: string;
  currencyCode?: string;
  invoiceAmount: number;
  paidAmount?: number;
  outstandingAmount: number;
  invoiceDate: string;
  dueDate?: string | null;
  status?: SupplierPayableStatus;
}

export class SupplierPayableRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  private mapRowToEntity(row: any): SupplierPayable {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id || null,
      supplierId: row.supplier_id,
      purchaseInvoiceId: row.purchase_invoice_id,
      currencyCode: row.currency_code,
      invoiceAmount: Number(row.invoice_amount),
      paidAmount: Number(row.paid_amount),
      outstandingAmount: Number(row.outstanding_amount),
      invoiceDate: row.invoice_date instanceof Date ? row.invoice_date.toISOString().split('T')[0] : String(row.invoice_date).split('T')[0],
      dueDate: row.due_date ? (row.due_date instanceof Date ? row.due_date.toISOString().split('T')[0] : String(row.due_date).split('T')[0]) : null,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      supplier: row.supplier_name
        ? {
            id: row.supplier_id,
            companyId: row.company_id,
            partnerCode: row.supplier_code || 'SUPPLIER',
            countryCode: row.country_code || 'US',
            partnerType: 'ORGANIZATION',
            legalName: row.supplier_name,
            tradeName: row.supplier_trade_name || undefined,
            isCustomer: false,
            isSupplier: true,
            taxIdentifier: row.supplier_tax_number || undefined,
            currencyCode: row.currency_code || 'USD',
            isActive: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
      invoice: row.invoice_number
        ? {
            id: row.purchase_invoice_id,
            companyId: row.company_id,
            invoiceNumber: row.invoice_number,
            supplierId: row.supplier_id,
            invoiceDate: row.invoice_date,
            status: row.invoice_status,
            currencyCode: row.currency_code,
            exchangeRate: Number(row.exchange_rate || 1),
            subtotal: Number(row.subtotal || 0),
            discountTotal: Number(row.discount_total || 0),
            taxTotal: Number(row.tax_total || 0),
            grandTotal: Number(row.grand_total || row.invoice_amount),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : undefined,
    };
  }

  async create(data: CreateSupplierPayableDbInput, client?: pg.PoolClient): Promise<SupplierPayable> {
    const executor = this.getExecutor(client);
    const res = await executor.query(
      `INSERT INTO supplier_payables (
        company_id, branch_id, supplier_id, purchase_invoice_id, currency_code,
        invoice_amount, paid_amount, outstanding_amount, invoice_date, due_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        data.companyId,
        data.branchId || null,
        data.supplierId,
        data.purchaseInvoiceId,
        data.currencyCode || 'USD',
        data.invoiceAmount,
        data.paidAmount || 0,
        data.outstandingAmount,
        data.invoiceDate,
        data.dueDate || null,
        data.status || 'OPEN',
      ]
    );

    return this.mapRowToEntity(res.rows[0]);
  }

  async findById(id: string, companyId?: string, client?: pg.PoolClient): Promise<SupplierPayable | null> {
    const executor = this.getExecutor(client);
    const params: any[] = [id];
    let query = `
      SELECT sp.*,
             bp.legal_name as supplier_name,
             bp.trade_name as supplier_trade_name,
             bp.tax_number as supplier_tax_number,
             pi.invoice_number as invoice_number,
             pi.status as invoice_status,
             pi.exchange_rate,
             pi.subtotal,
             pi.discount_total,
             pi.tax_total,
             pi.grand_total
      FROM supplier_payables sp
      LEFT JOIN business_partners bp ON sp.supplier_id = bp.id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE sp.id = $1
    `;

    if (companyId) {
      params.push(companyId);
      query += ` AND sp.company_id = $2`;
    }

    const res = await executor.query(query, params);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findByInvoiceId(invoiceId: string, companyId?: string, client?: pg.PoolClient): Promise<SupplierPayable | null> {
    const executor = this.getExecutor(client);
    const params: any[] = [invoiceId];
    let query = `
      SELECT sp.*,
             bp.legal_name as supplier_name,
             pi.invoice_number as invoice_number,
             pi.status as invoice_status
      FROM supplier_payables sp
      LEFT JOIN business_partners bp ON sp.supplier_id = bp.id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE sp.purchase_invoice_id = $1
    `;

    if (companyId) {
      params.push(companyId);
      query += ` AND sp.company_id = $2`;
    }

    const res = await executor.query(query, params);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findForUpdate(id: string, companyId: string, client: pg.PoolClient): Promise<SupplierPayable | null> {
    const res = await client.query(
      `SELECT * FROM supplier_payables WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async updatePaymentBalances(
    id: string,
    companyId: string,
    paidAmount: number,
    outstandingAmount: number,
    status: SupplierPayableStatus,
    client: pg.PoolClient
  ): Promise<SupplierPayable | null> {
    const res = await client.query(
      `UPDATE supplier_payables
       SET paid_amount = $1,
           outstanding_amount = $2,
           status = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND company_id = $5
       RETURNING *`,
      [paidAmount, outstandingAmount, status, id, companyId]
    );
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async updateStatus(
    id: string,
    companyId: string,
    status: SupplierPayableStatus,
    client?: pg.PoolClient
  ): Promise<SupplierPayable | null> {
    const executor = this.getExecutor(client);
    const res = await executor.query(
      `UPDATE supplier_payables
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND company_id = $3
       RETURNING *`,
      [status, id, companyId]
    );
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findOpenBySupplierId(
    supplierId: string,
    companyId: string,
    client?: pg.PoolClient
  ): Promise<SupplierPayable[]> {
    const executor = this.getExecutor(client);
    const res = await executor.query(
      `SELECT sp.*,
              bp.legal_name as supplier_name,
              pi.invoice_number as invoice_number,
              pi.status as invoice_status
       FROM supplier_payables sp
       LEFT JOIN business_partners bp ON sp.supplier_id = bp.id
       LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
       WHERE sp.company_id = $1 AND sp.supplier_id = $2 AND sp.status IN ('OPEN', 'PARTIALLY_PAID')
       ORDER BY sp.invoice_date ASC`,
      [companyId, supplierId]
    );
    return res.rows.map((r) => this.mapRowToEntity(r));
  }

  async list(
    companyId: string,
    filters: {
      supplierId?: string;
      status?: SupplierPayableStatus;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    } = {},
    client?: pg.PoolClient
  ): Promise<{ data: SupplierPayable[]; total: number }> {
    const executor = this.getExecutor(client);
    const conditions: string[] = ['sp.company_id = $1'];
    const params: any[] = [companyId];
    let pIndex = 2;

    if (filters.supplierId) {
      conditions.push(`sp.supplier_id = $${pIndex++}`);
      params.push(filters.supplierId);
    }
    if (filters.status) {
      conditions.push(`sp.status = $${pIndex++}`);
      params.push(filters.status);
    }
    if (filters.startDate) {
      conditions.push(`sp.invoice_date >= $${pIndex++}`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`sp.invoice_date <= $${pIndex++}`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.join(' AND ');

    const countRes = await executor.query(
      `SELECT COUNT(*)::int as count FROM supplier_payables sp WHERE ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.count || 0;

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    params.push(limit, offset);

    const listRes = await executor.query(
      `
      SELECT sp.*,
             bp.legal_name as supplier_name,
             bp.trade_name as supplier_trade_name,
             bp.tax_number as supplier_tax_number,
             pi.invoice_number as invoice_number,
             pi.status as invoice_status,
             pi.exchange_rate,
             pi.subtotal,
             pi.discount_total,
             pi.tax_total,
             pi.grand_total
      FROM supplier_payables sp
      LEFT JOIN business_partners bp ON sp.supplier_id = bp.id
      LEFT JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE ${whereClause}
      ORDER BY sp.invoice_date DESC, sp.created_at DESC
      LIMIT $${pIndex++} OFFSET $${pIndex++}
    `,
      params
    );

    return {
      data: listRes.rows.map((r) => this.mapRowToEntity(r)),
      total,
    };
  }
}
