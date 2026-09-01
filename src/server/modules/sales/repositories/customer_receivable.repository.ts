import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  CustomerReceivable,
  CustomerReceivableStatus,
} from '../../../../shared/types/index.js';

export interface CreateCustomerReceivableDbInput {
  companyId: string;
  branchId?: string | null;
  customerId: string;
  salesInvoiceId: string;
  currencyCode?: string;
  invoiceAmount: number;
  paidAmount?: number;
  outstandingAmount: number;
  invoiceDate: string;
  dueDate?: string | null;
  status?: CustomerReceivableStatus;
}

export class CustomerReceivableRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  private mapRowToEntity(row: any): CustomerReceivable {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id || null,
      customerId: row.customer_id,
      salesInvoiceId: row.sales_invoice_id,
      currencyCode: row.currency_code,
      invoiceAmount: Number(row.invoice_amount),
      paidAmount: Number(row.paid_amount),
      outstandingAmount: Number(row.outstanding_amount),
      invoiceDate: new Date(row.invoice_date).toISOString().split('T')[0],
      dueDate: row.due_date ? new Date(row.due_date).toISOString().split('T')[0] : null,
      status: row.status,
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
      invoice: row.invoice_number
        ? {
            id: row.sales_invoice_id,
            companyId: row.company_id,
            invoiceNumber: row.invoice_number,
            customerId: row.customer_id,
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

  async create(input: CreateCustomerReceivableDbInput, client?: pg.PoolClient): Promise<CustomerReceivable> {
    const executor = this.getExecutor(client);
    const sql = `
      INSERT INTO customer_receivables (
        company_id, branch_id, customer_id, sales_invoice_id,
        currency_code, invoice_amount, paid_amount, outstanding_amount,
        invoice_date, due_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const values = [
      input.companyId,
      input.branchId || null,
      input.customerId,
      input.salesInvoiceId,
      input.currencyCode || 'USD',
      input.invoiceAmount,
      input.paidAmount || 0,
      input.outstandingAmount,
      input.invoiceDate,
      input.dueDate || null,
      input.status || 'OPEN',
    ];
    const res = await executor.query(sql, values);
    return this.mapRowToEntity(res.rows[0]);
  }

  async findById(id: string, companyId: string, client?: pg.PoolClient): Promise<CustomerReceivable | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT cr.*, bp.partner_code as customer_code, bp.legal_name as customer_name,
             si.invoice_number, si.status as invoice_status, si.exchange_rate,
             si.subtotal, si.discount_total, si.tax_total, si.grand_total
      FROM customer_receivables cr
      JOIN business_partners bp ON bp.id = cr.customer_id
      JOIN sales_invoices si ON si.id = cr.sales_invoice_id
      WHERE cr.id = $1 AND cr.company_id = $2
    `;
    const res = await executor.query(sql, [id, companyId]);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findByInvoiceId(salesInvoiceId: string, companyId: string, client?: pg.PoolClient): Promise<CustomerReceivable | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT cr.*, bp.partner_code as customer_code, bp.legal_name as customer_name,
             si.invoice_number, si.status as invoice_status, si.exchange_rate,
             si.subtotal, si.discount_total, si.tax_total, si.grand_total
      FROM customer_receivables cr
      JOIN business_partners bp ON bp.id = cr.customer_id
      JOIN sales_invoices si ON si.id = cr.sales_invoice_id
      WHERE cr.sales_invoice_id = $1 AND cr.company_id = $2
    `;
    const res = await executor.query(sql, [salesInvoiceId, companyId]);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async updateStatus(
    id: string,
    companyId: string,
    status: CustomerReceivableStatus,
    client?: pg.PoolClient
  ): Promise<void> {
    const executor = this.getExecutor(client);
    const sql = `
      UPDATE customer_receivables
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND company_id = $3
    `;
    await executor.query(sql, [status, id, companyId]);
  }

  async list(
    companyId: string,
    filters?: {
      customerId?: string;
      status?: CustomerReceivableStatus;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
    client?: pg.PoolClient
  ): Promise<{ items: CustomerReceivable[]; total: number }> {
    const executor = this.getExecutor(client);
    const conditions: string[] = ['cr.company_id = $1'];
    const values: any[] = [companyId];
    let paramIdx = 2;

    if (filters?.customerId) {
      conditions.push(`cr.customer_id = $${paramIdx++}`);
      values.push(filters.customerId);
    }
    if (filters?.status) {
      conditions.push(`cr.status = $${paramIdx++}`);
      values.push(filters.status);
    }
    if (filters?.startDate) {
      conditions.push(`cr.invoice_date >= $${paramIdx++}`);
      values.push(filters.startDate);
    }
    if (filters?.endDate) {
      conditions.push(`cr.invoice_date <= $${paramIdx++}`);
      values.push(filters.endDate);
    }

    const whereClause = conditions.join(' AND ');
    const countSql = `SELECT COUNT(*) as total FROM customer_receivables cr WHERE ${whereClause}`;
    const countRes = await executor.query(countSql, values);
    const total = Number(countRes.rows[0].total);

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    const sql = `
      SELECT cr.*, bp.partner_code as customer_code, bp.legal_name as customer_name,
             si.invoice_number, si.status as invoice_status, si.exchange_rate,
             si.subtotal, si.discount_total, si.tax_total, si.grand_total
      FROM customer_receivables cr
      JOIN business_partners bp ON bp.id = cr.customer_id
      JOIN sales_invoices si ON si.id = cr.sales_invoice_id
      WHERE ${whereClause}
      ORDER BY cr.created_at DESC
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
