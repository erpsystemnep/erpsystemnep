import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  SupplierPayment,
  SupplierPaymentAllocation,
  SupplierPaymentStatus,
  PaymentMethod,
} from '../../../../shared/types/index.js';

export interface CreateSupplierPaymentDbInput {
  companyId: string;
  branchId?: string | null;
  paymentNumber: string;
  supplierId: string;
  paymentDate: string;
  amount: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseAmount?: number;
  paymentMethod: PaymentMethod;
  disbursementAccountId: string;
  apAccountId?: string | null;
  referenceNumber?: string | null;
  status?: SupplierPaymentStatus;
  notes?: string | null;
  createdBy?: string | null;
  allocations?: Array<{
    payableId: string;
    allocatedAmount: number;
    allocationDate?: string;
  }>;
}

export interface ListSupplierPaymentsFilter {
  supplierId?: string;
  status?: SupplierPaymentStatus;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

export class SupplierPaymentRepository {
  private mapPaymentRow(row: any): SupplierPayment {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id || null,
      paymentNumber: row.payment_number,
      supplierId: row.supplier_id,
      paymentDate: row.payment_date instanceof Date ? row.payment_date.toISOString().split('T')[0] : String(row.payment_date).split('T')[0],
      amount: parseFloat(row.amount || '0'),
      currencyCode: row.currency_code,
      exchangeRate: parseFloat(row.exchange_rate || '1'),
      baseAmount: parseFloat(row.base_amount || '0'),
      paymentMethod: row.payment_method,
      disbursementAccountId: row.disbursement_account_id,
      apAccountId: row.ap_account_id || null,
      referenceNumber: row.reference_number || null,
      status: row.status,
      notes: row.notes || null,
      createdBy: row.created_by || null,
      approvedBy: row.approved_by || null,
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      postedBy: row.posted_by || null,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      reversedBy: row.reversed_by || null,
      reversedAt: row.reversed_at ? new Date(row.reversed_at).toISOString() : null,
      journalId: row.journal_id || null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
      supplier: row.partner_legal_name
        ? {
            id: row.supplier_id,
            companyId: row.company_id,
            partnerCode: row.partner_code || 'SUPPLIER',
            countryCode: row.country_code || 'US',
            legalName: row.partner_legal_name,
            tradeName: row.partner_trade_name || undefined,
            isCustomer: false,
            isSupplier: true,
            isActive: true,
            currencyCode: row.currency_code || 'USD',
            partnerType: 'ORGANIZATION',
            createdAt: '',
            updatedAt: '',
          }
        : undefined,
      disbursementAccount: row.disbursement_account_code
        ? {
            id: row.disbursement_account_id,
            companyId: row.company_id,
            accountCode: row.disbursement_account_code,
            accountName: row.disbursement_account_name,
            accountType: 'ASSET',
            currencyCode: 'USD',
            isGroup: false,
            isActive: true,
            createdAt: '',
            updatedAt: '',
          }
        : undefined,
      apAccount: row.ap_account_code
        ? {
            id: row.ap_account_id,
            companyId: row.company_id,
            accountCode: row.ap_account_code,
            accountName: row.ap_account_name,
            accountType: 'LIABILITY',
            currencyCode: 'USD',
            isGroup: false,
            isActive: true,
            createdAt: '',
            updatedAt: '',
          }
        : undefined,
    };
  }

  private mapAllocationRow(row: any): SupplierPaymentAllocation {
    return {
      id: row.id,
      paymentId: row.payment_id,
      payableId: row.payable_id,
      allocatedAmount: parseFloat(row.allocated_amount || '0'),
      allocationDate: row.allocation_date instanceof Date ? row.allocation_date.toISOString().split('T')[0] : String(row.allocation_date).split('T')[0],
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      payable: row.invoice_number
        ? {
            id: row.payable_id,
            companyId: row.company_id,
            supplierId: row.payable_supplier_id || row.supplier_id,
            purchaseInvoiceId: row.purchase_invoice_id,
            currencyCode: row.payable_currency_code || 'USD',
            invoiceAmount: parseFloat(row.invoice_amount || '0'),
            paidAmount: parseFloat(row.paid_amount || '0'),
            outstandingAmount: parseFloat(row.outstanding_amount || '0'),
            invoiceDate: row.invoice_date instanceof Date ? row.invoice_date.toISOString().split('T')[0] : String(row.invoice_date).split('T')[0],
            dueDate: row.due_date ? (row.due_date instanceof Date ? row.due_date.toISOString().split('T')[0] : String(row.due_date).split('T')[0]) : null,
            status: row.payable_status,
            createdAt: '',
            updatedAt: '',
          }
        : undefined,
    };
  }

  async create(data: CreateSupplierPaymentDbInput, client?: pg.PoolClient): Promise<SupplierPayment> {
    const pool = client || getPool();
    const query = `
      INSERT INTO supplier_payments (
        company_id, branch_id, payment_number, supplier_id, payment_date,
        amount, currency_code, exchange_rate, base_amount, payment_method,
        disbursement_account_id, ap_account_id, reference_number, status,
        notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *;
    `;

    const values = [
      data.companyId,
      data.branchId || null,
      data.paymentNumber,
      data.supplierId,
      data.paymentDate,
      data.amount,
      data.currencyCode || 'USD',
      data.exchangeRate || 1,
      data.baseAmount || data.amount,
      data.paymentMethod,
      data.disbursementAccountId,
      data.apAccountId || null,
      data.referenceNumber || null,
      data.status || 'DRAFT',
      data.notes || null,
      data.createdBy || null,
    ];

    const result = await pool.query(query, values);
    const payment = this.mapPaymentRow(result.rows[0]);

    if (data.allocations && data.allocations.length > 0) {
      payment.allocations = [];
      for (const alloc of data.allocations) {
        const allocQuery = `
          INSERT INTO supplier_payment_allocations (
            company_id, payment_id, payable_id, allocated_amount, allocation_date
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING *;
        `;
        const allocResult = await pool.query(allocQuery, [
          data.companyId,
          payment.id,
          alloc.payableId,
          alloc.allocatedAmount,
          alloc.allocationDate || data.paymentDate,
        ]);
        payment.allocations.push(this.mapAllocationRow(allocResult.rows[0]));
      }
    }

    return payment;
  }

  async findById(id: string, companyId: string, client?: pg.PoolClient): Promise<SupplierPayment | null> {
    const pool = client || getPool();
    const query = `
      SELECT p.*,
             bp.legal_name AS partner_legal_name,
             bp.trade_name AS partner_trade_name,
             da.account_code AS disbursement_account_code,
             da.account_name AS disbursement_account_name,
             apa.account_code AS ap_account_code,
             apa.account_name AS ap_account_name
      FROM supplier_payments p
      LEFT JOIN business_partners bp ON p.supplier_id = bp.id
      LEFT JOIN chart_of_accounts da ON p.disbursement_account_id = da.id
      LEFT JOIN chart_of_accounts apa ON p.ap_account_id = apa.id
      WHERE p.id = $1 AND p.company_id = $2;
    `;

    const result = await pool.query(query, [id, companyId]);
    if (result.rows.length === 0) return null;

    const payment = this.mapPaymentRow(result.rows[0]);
    payment.allocations = await this.getAllocations(id, companyId, client);
    return payment;
  }

  async findForUpdate(id: string, companyId: string, client: pg.PoolClient): Promise<SupplierPayment | null> {
    const query = `
      SELECT p.*,
             bp.legal_name AS partner_legal_name,
             bp.trade_name AS partner_trade_name,
             da.account_code AS disbursement_account_code,
             da.account_name AS disbursement_account_name,
             apa.account_code AS ap_account_code,
             apa.account_name AS ap_account_name
      FROM supplier_payments p
      LEFT JOIN business_partners bp ON p.supplier_id = bp.id
      LEFT JOIN chart_of_accounts da ON p.disbursement_account_id = da.id
      LEFT JOIN chart_of_accounts apa ON p.ap_account_id = apa.id
      WHERE p.id = $1 AND p.company_id = $2
      FOR UPDATE;
    `;

    const result = await client.query(query, [id, companyId]);
    if (result.rows.length === 0) return null;

    const payment = this.mapPaymentRow(result.rows[0]);
    payment.allocations = await this.getAllocations(id, companyId, client);
    return payment;
  }

  async getAllocations(paymentId: string, companyId: string, client?: pg.PoolClient): Promise<SupplierPaymentAllocation[]> {
    const pool = client || getPool();
    const query = `
      SELECT a.*,
             sp.supplier_id AS payable_supplier_id,
             sp.purchase_invoice_id,
             sp.currency_code AS payable_currency_code,
             sp.invoice_amount,
             sp.paid_amount,
             sp.outstanding_amount,
             sp.invoice_date,
             sp.due_date,
             sp.status AS payable_status,
             pi.invoice_number
      FROM supplier_payment_allocations a
      JOIN supplier_payables sp ON a.payable_id = sp.id
      JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE a.payment_id = $1 AND a.company_id = $2;
    `;

    const result = await pool.query(query, [paymentId, companyId]);
    return result.rows.map((row) => this.mapAllocationRow(row));
  }

  async updateStatus(
    id: string,
    companyId: string,
    status: SupplierPaymentStatus,
    metadata?: {
      approvedBy?: string | null;
      approvedAt?: string | null;
      postedBy?: string | null;
      postedAt?: string | null;
      reversedBy?: string | null;
      reversedAt?: string | null;
      journalId?: string | null;
    },
    client?: pg.PoolClient
  ): Promise<SupplierPayment | null> {
    const pool = client || getPool();
    const query = `
      UPDATE supplier_payments
      SET status = $1,
          approved_by = COALESCE($2, approved_by),
          approved_at = COALESCE($3, approved_at),
          posted_by = COALESCE($4, posted_by),
          posted_at = COALESCE($5, posted_at),
          reversed_by = COALESCE($6, reversed_by),
          reversed_at = COALESCE($7, reversed_at),
          journal_id = COALESCE($8, journal_id),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $9 AND company_id = $10
      RETURNING *;
    `;

    const values = [
      status,
      metadata?.approvedBy || null,
      metadata?.approvedAt || null,
      metadata?.postedBy || null,
      metadata?.postedAt || null,
      metadata?.reversedBy || null,
      metadata?.reversedAt || null,
      metadata?.journalId || null,
      id,
      companyId,
    ];

    const result = await pool.query(query, values);
    if (result.rows.length === 0) return null;

    return this.findById(id, companyId, client);
  }

  async list(
    companyId: string,
    filter: ListSupplierPaymentsFilter = {},
    limit = 50,
    offset = 0,
    client?: pg.PoolClient
  ): Promise<{ data: SupplierPayment[]; total: number }> {
    const pool = client || getPool();
    const conditions = ['p.company_id = $1'];
    const values: any[] = [companyId];
    let paramIndex = 2;

    if (filter.supplierId) {
      conditions.push(`p.supplier_id = $${paramIndex}`);
      values.push(filter.supplierId);
      paramIndex++;
    }

    if (filter.status) {
      conditions.push(`p.status = $${paramIndex}`);
      values.push(filter.status);
      paramIndex++;
    }

    if (filter.fromDate) {
      conditions.push(`p.payment_date >= $${paramIndex}`);
      values.push(filter.fromDate);
      paramIndex++;
    }

    if (filter.toDate) {
      conditions.push(`p.payment_date <= $${paramIndex}`);
      values.push(filter.toDate);
      paramIndex++;
    }

    if (filter.search) {
      conditions.push(`(p.payment_number ILIKE $${paramIndex} OR p.reference_number ILIKE $${paramIndex} OR bp.legal_name ILIKE $${paramIndex})`);
      values.push(`%${filter.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM supplier_payments p
      LEFT JOIN business_partners bp ON p.supplier_id = bp.id
      WHERE ${whereClause};
    `;
    const countResult = await pool.query(countQuery, values);
    const total = countResult.rows[0]?.total || 0;

    const dataQuery = `
      SELECT p.*,
             bp.legal_name AS partner_legal_name,
             bp.trade_name AS partner_trade_name,
             da.account_code AS disbursement_account_code,
             da.account_name AS disbursement_account_name,
             apa.account_code AS ap_account_code,
             apa.account_name AS ap_account_name
      FROM supplier_payments p
      LEFT JOIN business_partners bp ON p.supplier_id = bp.id
      LEFT JOIN chart_of_accounts da ON p.disbursement_account_id = da.id
      LEFT JOIN chart_of_accounts apa ON p.ap_account_id = apa.id
      WHERE ${whereClause}
      ORDER BY p.payment_date DESC, p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;

    values.push(limit, offset);
    const dataResult = await pool.query(dataQuery, values);
    const data = dataResult.rows.map((row) => this.mapPaymentRow(row));

    return { data, total };
  }
}
