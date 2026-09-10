import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  CustomerPayment,
  CustomerPaymentAllocation,
  CustomerPaymentStatus,
  PaymentMethod,
} from '../../../../shared/types/index.js';

export interface CreateCustomerPaymentDbInput {
  companyId: string;
  branchId?: string | null;
  paymentNumber: string;
  customerId: string;
  paymentDate: string;
  amount: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseAmount?: number;
  paymentMethod: PaymentMethod;
  depositAccountId: string;
  arAccountId?: string | null;
  referenceNumber?: string | null;
  status?: CustomerPaymentStatus;
  notes?: string | null;
  createdBy?: string | null;
  allocations?: Array<{
    receivableId: string;
    allocatedAmount: number;
    allocationDate?: string;
  }>;
}

export interface ListCustomerPaymentsFilter {
  customerId?: string;
  status?: CustomerPaymentStatus;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

export class CustomerPaymentRepository {
  private mapPaymentRow(row: any): CustomerPayment {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      paymentNumber: row.payment_number,
      customerId: row.customer_id,
      paymentDate: row.payment_date ? new Date(row.payment_date).toISOString().split('T')[0] : '',
      amount: parseFloat(row.amount || '0'),
      currencyCode: row.currency_code,
      exchangeRate: parseFloat(row.exchange_rate || '1'),
      baseAmount: parseFloat(row.base_amount || '0'),
      paymentMethod: row.payment_method,
      depositAccountId: row.deposit_account_id,
      arAccountId: row.ar_account_id,
      referenceNumber: row.reference_number,
      status: row.status,
      notes: row.notes,
      createdBy: row.created_by,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      postedBy: row.posted_by,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      journalId: row.journal_id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
      customer: row.partner_legal_name ? {
        id: row.customer_id,
        companyId: row.company_id,
        code: row.partner_code || '',
        legalName: row.partner_legal_name,
        tradeName: row.partner_trade_name,
        isCustomer: true,
        isSupplier: false,
        isActive: true,
        currencyCode: 'USD',
        createdAt: '',
        updatedAt: '',
      } as any : null,
      depositAccount: row.deposit_acc_code ? {
        id: row.deposit_account_id,
        companyId: row.company_id,
        accountCode: row.deposit_acc_code,
        accountName: row.deposit_acc_name,
        accountType: 'ASSET',
        isGroup: false,
        isActive: true,
        currencyCode: 'USD',
        createdAt: '',
        updatedAt: '',
      } as any : null,
    };
  }

  private mapAllocRow(row: any): CustomerPaymentAllocation {
    return {
      id: row.id,
      paymentId: row.payment_id,
      receivableId: row.receivable_id,
      allocatedAmount: parseFloat(row.allocated_amount || '0'),
      allocationDate: row.allocation_date ? new Date(row.allocation_date).toISOString().split('T')[0] : '',
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      receivable: row.invoice_amount !== undefined ? {
        id: row.receivable_id,
        companyId: row.company_id || '',
        customerId: row.customer_id || '',
        salesInvoiceId: row.sales_invoice_id || '',
        currencyCode: row.currency_code || 'USD',
        invoiceAmount: parseFloat(row.invoice_amount || '0'),
        paidAmount: parseFloat(row.paid_amount || '0'),
        outstandingAmount: parseFloat(row.outstanding_amount || '0'),
        invoiceDate: row.invoice_date ? new Date(row.invoice_date).toISOString().split('T')[0] : '',
        status: row.receivable_status || 'OPEN',
        createdAt: '',
        updatedAt: '',
      } as any : null,
    };
  }

  async create(data: CreateCustomerPaymentDbInput, client?: pg.PoolClient): Promise<CustomerPayment> {
    const pool = client || getPool();
    const sql = `
      INSERT INTO customer_payments (
        company_id, branch_id, payment_number, customer_id,
        payment_date, amount, currency_code, exchange_rate, base_amount,
        payment_method, deposit_account_id, ar_account_id, reference_number,
        status, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *;
    `;
    const params = [
      data.companyId,
      data.branchId || null,
      data.paymentNumber,
      data.customerId,
      data.paymentDate,
      data.amount,
      data.currencyCode || 'USD',
      data.exchangeRate || 1.0,
      data.baseAmount || (data.amount * (data.exchangeRate || 1.0)),
      data.paymentMethod,
      data.depositAccountId,
      data.arAccountId || null,
      data.referenceNumber || null,
      data.status || 'DRAFT',
      data.notes || null,
      data.createdBy || null,
    ];

    const result = await pool.query(sql, params);
    const payment = this.mapPaymentRow(result.rows[0]);

    // Insert allocations if provided
    const allocations: CustomerPaymentAllocation[] = [];
    if (data.allocations && data.allocations.length > 0) {
      for (const alloc of data.allocations) {
        const allocSql = `
          INSERT INTO customer_payment_allocations (
            payment_id, receivable_id, allocated_amount, allocation_date
          )
          VALUES ($1, $2, $3, $4)
          RETURNING *;
        `;
        const allocParams = [
          payment.id,
          alloc.receivableId,
          alloc.allocatedAmount,
          alloc.allocationDate || payment.paymentDate,
        ];
        const aRes = await pool.query(allocSql, allocParams);
        allocations.push(this.mapAllocRow(aRes.rows[0]));
      }
    }

    payment.allocations = allocations;
    return payment;
  }

  async findById(id: string, client?: pg.PoolClient | pg.Pool): Promise<CustomerPayment | null> {
    const pool = client || getPool();
    const sql = `
      SELECT 
        p.*,
        bp.partner_code AS partner_code, bp.legal_name AS partner_legal_name, bp.trade_name AS partner_trade_name,
        da.account_code AS deposit_acc_code, da.account_name AS deposit_acc_name
      FROM customer_payments p
      JOIN business_partners bp ON p.customer_id = bp.id
      JOIN chart_of_accounts da ON p.deposit_account_id = da.id
      WHERE p.id = $1;
    `;
    const result = await pool.query(sql, [id]);
    if (result.rows.length === 0) return null;

    const payment = this.mapPaymentRow(result.rows[0]);
    payment.allocations = await this.getAllocations(payment.id, pool);
    return payment;
  }

  async findForUpdate(id: string, client: pg.PoolClient): Promise<CustomerPayment | null> {
    const sql = `SELECT * FROM customer_payments WHERE id = $1 FOR UPDATE;`;
    const result = await client.query(sql, [id]);
    if (result.rows.length === 0) return null;

    const payment = this.mapPaymentRow(result.rows[0]);
    payment.allocations = await this.getAllocations(payment.id, client);
    return payment;
  }

  async getAllocations(paymentId: string, client?: pg.PoolClient | pg.Pool): Promise<CustomerPaymentAllocation[]> {
    const pool = client || getPool();
    const sql = `
      SELECT 
        a.*,
        r.company_id, r.customer_id, r.sales_invoice_id, r.currency_code,
        r.invoice_amount, r.paid_amount, r.outstanding_amount, r.invoice_date,
        r.status AS receivable_status
      FROM customer_payment_allocations a
      JOIN customer_receivables r ON a.receivable_id = r.id
      WHERE a.payment_id = $1
      ORDER BY a.created_at ASC;
    `;
    const result = await pool.query(sql, [paymentId]);
    return result.rows.map((r) => this.mapAllocRow(r));
  }

  async list(companyId: string, filters: ListCustomerPaymentsFilter = {}, client?: pg.PoolClient): Promise<CustomerPayment[]> {
    const pool = client || getPool();
    const conditions: string[] = ['p.company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.customerId) {
      conditions.push(`p.customer_id = $${idx++}`);
      params.push(filters.customerId);
    }
    if (filters.status) {
      conditions.push(`p.status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.fromDate) {
      conditions.push(`p.payment_date >= $${idx++}`);
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`p.payment_date <= $${idx++}`);
      params.push(filters.toDate);
    }
    if (filters.search) {
      conditions.push(`(p.payment_number ILIKE $${idx} OR p.reference_number ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const sql = `
      SELECT 
        p.*,
        bp.partner_code AS partner_code, bp.legal_name AS partner_legal_name, bp.trade_name AS partner_trade_name,
        da.account_code AS deposit_acc_code, da.account_name AS deposit_acc_name
      FROM customer_payments p
      JOIN business_partners bp ON p.customer_id = bp.id
      JOIN chart_of_accounts da ON p.deposit_account_id = da.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.payment_date DESC, p.created_at DESC;
    `;

    const result = await pool.query(sql, params);
    return result.rows.map((r) => this.mapPaymentRow(r));
  }

  async updateStatus(
    id: string,
    status: CustomerPaymentStatus,
    meta: {
      approvedBy?: string | null;
      approvedAt?: string | null;
      postedBy?: string | null;
      postedAt?: string | null;
      journalId?: string | null;
    } = {},
    client?: pg.PoolClient
  ): Promise<CustomerPayment | null> {
    const pool = client || getPool();
    const updates: string[] = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [id, status];
    let idx = 3;

    if (meta.approvedBy !== undefined) {
      updates.push(`approved_by = $${idx++}`);
      params.push(meta.approvedBy);
    }
    if (meta.approvedAt !== undefined) {
      updates.push(`approved_at = $${idx++}`);
      params.push(meta.approvedAt ? new Date(meta.approvedAt) : null);
    }
    if (meta.postedBy !== undefined) {
      updates.push(`posted_by = $${idx++}`);
      params.push(meta.postedBy);
    }
    if (meta.postedAt !== undefined) {
      updates.push(`posted_at = $${idx++}`);
      params.push(meta.postedAt ? new Date(meta.postedAt) : null);
    }
    if (meta.journalId !== undefined) {
      updates.push(`journal_id = $${idx++}`);
      params.push(meta.journalId);
    }

    const sql = `
      UPDATE customer_payments
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *;
    `;

    const result = await pool.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.findById(id, pool);
  }
}
