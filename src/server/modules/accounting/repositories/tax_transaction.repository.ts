import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  TaxTransaction,
  TaxType,
  TaxSourceType,
  TaxTransactionStatus,
} from '../../../../shared/types/index.js';

export interface CreateTaxTransactionInput {
  companyId: string;
  branchId?: string | null;
  taxType: TaxType;
  sourceType: TaxSourceType;
  sourceId: string;
  sourceLineId?: string | null;
  taxCode?: string | null;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseTaxableAmount?: number;
  baseTaxAmount?: number;
  accountingDate: string;
  journalId?: string | null;
  journalLineId?: string | null;
  status?: TaxTransactionStatus;
}

export interface ListTaxTransactionsFilter {
  taxType?: TaxType;
  sourceType?: TaxSourceType;
  sourceId?: string;
  status?: TaxTransactionStatus;
  fromDate?: string;
  toDate?: string;
  taxCode?: string;
  limit?: number;
  offset?: number;
}

export class TaxTransactionRepository {
  private mapRow(row: any): TaxTransaction {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      taxType: row.tax_type,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceLineId: row.source_line_id,
      taxCode: row.tax_code,
      taxRate: parseFloat(row.tax_rate || '0'),
      taxableAmount: parseFloat(row.taxable_amount || '0'),
      taxAmount: parseFloat(row.tax_amount || '0'),
      currencyCode: row.currency_code,
      exchangeRate: parseFloat(row.exchange_rate || '1'),
      baseTaxableAmount: parseFloat(row.base_taxable_amount || '0'),
      baseTaxAmount: parseFloat(row.base_tax_amount || '0'),
      accountingDate: row.accounting_date ? new Date(row.accounting_date).toISOString().split('T')[0] : '',
      journalId: row.journal_id,
      journalLineId: row.journal_line_id,
      status: row.status,
      reversalJournalId: row.reversal_journal_id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  }

  async create(input: CreateTaxTransactionInput, client?: pg.PoolClient): Promise<TaxTransaction> {
    const db = client || getPool();
    const exchangeRate = input.exchangeRate || 1.0;
    const baseTaxableAmount =
      input.baseTaxableAmount !== undefined
        ? input.baseTaxableAmount
        : Math.round(input.taxableAmount * exchangeRate * 10000) / 10000;
    const baseTaxAmount =
      input.baseTaxAmount !== undefined
        ? input.baseTaxAmount
        : Math.round(input.taxAmount * exchangeRate * 10000) / 10000;

    const sql = `
      INSERT INTO tax_transactions (
        company_id, branch_id, tax_type, source_type, source_id, source_line_id,
        tax_code, tax_rate, taxable_amount, tax_amount, currency_code, exchange_rate,
        base_taxable_amount, base_tax_amount, accounting_date, journal_id, journal_line_id,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18
      )
      RETURNING *
    `;

    const values = [
      input.companyId,
      input.branchId || null,
      input.taxType,
      input.sourceType,
      input.sourceId,
      input.sourceLineId || null,
      input.taxCode || null,
      input.taxRate,
      input.taxableAmount,
      input.taxAmount,
      input.currencyCode || 'USD',
      exchangeRate,
      baseTaxableAmount,
      baseTaxAmount,
      input.accountingDate,
      input.journalId || null,
      input.journalLineId || null,
      input.status || 'POSTED',
    ];

    const result = await db.query(sql, values);
    return this.mapRow(result.rows[0]);
  }

  async createBatch(inputs: CreateTaxTransactionInput[], client?: pg.PoolClient): Promise<TaxTransaction[]> {
    const results: TaxTransaction[] = [];
    for (const input of inputs) {
      const created = await this.create(input, client);
      results.push(created);
    }
    return results;
  }

  async findById(id: string, companyId: string, client?: pg.PoolClient): Promise<TaxTransaction | null> {
    const db = client || getPool();
    const result = await db.query(
      `SELECT * FROM tax_transactions WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async findBySource(
    sourceType: TaxSourceType,
    sourceId: string,
    companyId: string,
    client?: pg.PoolClient
  ): Promise<TaxTransaction[]> {
    const db = client || getPool();
    const result = await db.query(
      `SELECT * FROM tax_transactions 
       WHERE source_type = $1 AND source_id = $2 AND company_id = $3
       ORDER BY created_at ASC`,
      [sourceType, sourceId, companyId]
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async updateStatusBySource(
    sourceType: TaxSourceType,
    sourceId: string,
    companyId: string,
    status: TaxTransactionStatus,
    reversalJournalId?: string | null,
    client?: pg.PoolClient
  ): Promise<number> {
    const db = client || getPool();
    const result = await db.query(
      `UPDATE tax_transactions 
       SET status = $1, reversal_journal_id = COALESCE($2, reversal_journal_id), updated_at = CURRENT_TIMESTAMP
       WHERE source_type = $3 AND source_id = $4 AND company_id = $5`,
      [status, reversalJournalId || null, sourceType, sourceId, companyId]
    );
    return result.rowCount || 0;
  }

  async list(
    companyId: string,
    filters: ListTaxTransactionsFilter = {},
    client?: pg.PoolClient
  ): Promise<{ items: TaxTransaction[]; total: number }> {
    const db = client || getPool();
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.taxType) {
      conditions.push(`tax_type = $${idx++}`);
      params.push(filters.taxType);
    }
    if (filters.sourceType) {
      conditions.push(`source_type = $${idx++}`);
      params.push(filters.sourceType);
    }
    if (filters.sourceId) {
      conditions.push(`source_id = $${idx++}`);
      params.push(filters.sourceId);
    }
    if (filters.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.taxCode) {
      conditions.push(`tax_code ILIKE $${idx++}`);
      params.push(`%${filters.taxCode}%`);
    }
    if (filters.fromDate) {
      conditions.push(`accounting_date >= $${idx++}`);
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`accounting_date <= $${idx++}`);
      params.push(filters.toDate);
    }

    const whereClause = conditions.join(' AND ');
    const countSql = `SELECT COUNT(*) FROM tax_transactions WHERE ${whereClause}`;
    const countRes = await db.query(countSql, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const dataSql = `
      SELECT * FROM tax_transactions
      WHERE ${whereClause}
      ORDER BY accounting_date DESC, created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(limit, offset);

    const dataRes = await db.query(dataSql, params);
    const items = dataRes.rows.map((r) => this.mapRow(r));

    return { items, total };
  }

  /**
   * Aggregates tax transactions for summary reporting.
   * Only POSTED transactions are included in net totals.
   */
  async getSummary(
    companyId: string,
    filters: { fromDate?: string; toDate?: string } = {},
    client?: pg.PoolClient
  ) {
    const db = client || getPool();
    const conditions: string[] = ["company_id = $1 AND status = 'POSTED'"];
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.fromDate) {
      conditions.push(`accounting_date >= $${idx++}`);
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`accounting_date <= $${idx++}`);
      params.push(filters.toDate);
    }

    const whereClause = conditions.join(' AND ');

    // 1. Totals by tax_type
    const totalsSql = `
      SELECT 
        tax_type,
        COALESCE(SUM(base_taxable_amount), 0) as total_taxable,
        COALESCE(SUM(base_tax_amount), 0) as total_tax
      FROM tax_transactions
      WHERE ${whereClause}
      GROUP BY tax_type
    `;
    const totalsRes = await db.query(totalsSql, params);

    let totalOutputTaxable = 0;
    let totalOutputTax = 0;
    let totalInputTaxable = 0;
    let totalInputTax = 0;

    for (const r of totalsRes.rows) {
      if (r.tax_type === 'OUTPUT_TAX') {
        totalOutputTaxable = parseFloat(r.total_taxable);
        totalOutputTax = parseFloat(r.total_tax);
      } else if (r.tax_type === 'INPUT_TAX') {
        totalInputTaxable = parseFloat(r.total_taxable);
        totalInputTax = parseFloat(r.total_tax);
      }
    }

    // 2. Breakdown by tax_code & tax_rate
    const breakdownSql = `
      SELECT 
        COALESCE(tax_code, 'DEFAULT') as tax_code,
        tax_type,
        tax_rate,
        COALESCE(SUM(base_taxable_amount), 0) as taxable_amount,
        COALESCE(SUM(base_tax_amount), 0) as tax_amount,
        COUNT(*) as tx_count
      FROM tax_transactions
      WHERE ${whereClause}
      GROUP BY tax_code, tax_type, tax_rate
      ORDER BY tax_type, tax_rate DESC
    `;
    const breakdownRes = await db.query(breakdownSql, params);
    const taxCodeBreakdown = breakdownRes.rows.map((r) => ({
      taxCode: r.tax_code,
      taxType: r.tax_type as TaxType,
      taxRate: parseFloat(r.tax_rate),
      taxableAmount: parseFloat(r.taxable_amount),
      taxAmount: parseFloat(r.tax_amount),
      transactionCount: parseInt(r.tx_count, 10),
    }));

    const netTaxPosition = totalOutputTax - totalInputTax;

    return {
      companyId,
      totalOutputTaxable,
      totalOutputTax,
      totalInputTaxable,
      totalInputTax,
      netTaxPosition,
      taxCodeBreakdown,
    };
  }
}
