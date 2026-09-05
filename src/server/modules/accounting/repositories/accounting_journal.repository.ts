import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  AccountingJournal,
  AccountingJournalLine,
  JournalStatus,
} from '../../../../shared/types/index.js';

export interface CreateJournalDbInput {
  companyId: string;
  branchId?: string | null;
  journalNumber: string;
  postingDate: string;
  sourceDocumentType: string;
  sourceDocumentId?: string | null;
  description?: string | null;
  status?: JournalStatus;
  totalDebit: number;
  totalCredit: number;
  currencyCode?: string;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  reversalJournalId?: string | null;
  lines: Array<{
    lineNumber: number;
    accountId: string;
    partnerId?: string | null;
    debit: number;
    credit: number;
    currencyCode?: string;
    exchangeRate?: number;
    baseDebit?: number;
    baseCredit?: number;
    description?: string | null;
  }>;
}

export interface ListJournalsFilter {
  status?: JournalStatus;
  sourceDocumentType?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

export class AccountingJournalRepository {
  private mapJournalRow(row: any): AccountingJournal {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      journalNumber: row.journal_number,
      postingDate: row.posting_date ? new Date(row.posting_date).toISOString().split('T')[0] : '',
      sourceDocumentType: row.source_document_type,
      sourceDocumentId: row.source_document_id,
      description: row.description,
      status: row.status,
      totalDebit: parseFloat(row.total_debit || '0'),
      totalCredit: parseFloat(row.total_credit || '0'),
      currencyCode: row.currency_code,
      createdBy: row.created_by,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      postedBy: row.posted_by,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      reversalJournalId: row.reversal_journal_id,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  }

  private mapLineRow(row: any): AccountingJournalLine {
    return {
      id: row.id,
      journalId: row.journal_id,
      lineNumber: row.line_number,
      accountId: row.account_id,
      partnerId: row.partner_id,
      debit: parseFloat(row.debit || '0'),
      credit: parseFloat(row.credit || '0'),
      currencyCode: row.currency_code,
      exchangeRate: parseFloat(row.exchange_rate || '1'),
      baseDebit: parseFloat(row.base_debit || '0'),
      baseCredit: parseFloat(row.base_credit || '0'),
      description: row.description,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      account: row.account_code ? {
        id: row.account_id,
        companyId: row.company_id || '',
        accountCode: row.account_code,
        accountName: row.account_name,
        accountType: row.account_type,
        parentAccountId: row.parent_account_id,
        isGroup: row.is_group ?? false,
        isActive: row.is_active ?? true,
        currencyCode: row.currency_code || 'USD',
        createdAt: '',
        updatedAt: '',
      } : null,
      partner: row.partner_legal_name ? {
        id: row.partner_id,
        companyId: row.company_id || '',
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
    };
  }

  async create(data: CreateJournalDbInput, client?: pg.PoolClient): Promise<AccountingJournal> {
    const pool = client || getPool();
    const sql = `
      INSERT INTO accounting_journals (
        company_id, branch_id, journal_number, posting_date,
        source_document_type, source_document_id, description, status,
        total_debit, total_credit, currency_code, created_by,
        approved_by, approved_at, posted_by, posted_at, reversal_journal_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *;
    `;
    const params = [
      data.companyId,
      data.branchId || null,
      data.journalNumber,
      data.postingDate,
      data.sourceDocumentType,
      data.sourceDocumentId || null,
      data.description || null,
      data.status || 'DRAFT',
      data.totalDebit,
      data.totalCredit,
      data.currencyCode || 'USD',
      data.createdBy || null,
      data.approvedBy || null,
      data.approvedAt ? new Date(data.approvedAt) : null,
      data.postedBy || null,
      data.postedAt ? new Date(data.postedAt) : null,
      data.reversalJournalId || null,
    ];

    const result = await pool.query(sql, params);
    const journal = this.mapJournalRow(result.rows[0]);

    // Insert lines
    const lines: AccountingJournalLine[] = [];
    for (const line of data.lines) {
      const lineSql = `
        INSERT INTO accounting_journal_lines (
          journal_id, line_number, account_id, partner_id,
          debit, credit, currency_code, exchange_rate,
          base_debit, base_credit, description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *;
      `;
      const lineParams = [
        journal.id,
        line.lineNumber,
        line.accountId,
        line.partnerId || null,
        line.debit,
        line.credit,
        line.currencyCode || journal.currencyCode,
        line.exchangeRate || 1.0,
        line.baseDebit || (line.debit * (line.exchangeRate || 1.0)),
        line.baseCredit || (line.credit * (line.exchangeRate || 1.0)),
        line.description || null,
      ];
      const lineRes = await pool.query(lineSql, lineParams);
      lines.push(this.mapLineRow(lineRes.rows[0]));
    }

    journal.lines = lines;
    return journal;
  }

  async findById(id: string, client?: pg.PoolClient): Promise<AccountingJournal | null> {
    const pool = client || getPool();
    const sql = `SELECT * FROM accounting_journals WHERE id = $1;`;
    const result = await pool.query(sql, [id]);
    if (result.rows.length === 0) return null;

    const journal = this.mapJournalRow(result.rows[0]);
    journal.lines = await this.getLines(journal.id, pool);
    return journal;
  }

  async findForUpdate(id: string, client: pg.PoolClient): Promise<AccountingJournal | null> {
    const sql = `SELECT * FROM accounting_journals WHERE id = $1 FOR UPDATE;`;
    const result = await client.query(sql, [id]);
    if (result.rows.length === 0) return null;

    const journal = this.mapJournalRow(result.rows[0]);
    journal.lines = await this.getLines(journal.id, client);
    return journal;
  }

  async getLines(journalId: string, client?: pg.PoolClient | pg.Pool): Promise<AccountingJournalLine[]> {
    const pool = client || getPool();
    const sql = `
      SELECT 
        l.*,
        a.account_code, a.account_name, a.account_type, a.parent_account_id, a.is_group, a.is_active,
        p.code AS partner_code, p.legal_name AS partner_legal_name, p.trade_name AS partner_trade_name
      FROM accounting_journal_lines l
      JOIN chart_of_accounts a ON l.account_id = a.id
      LEFT JOIN business_partners p ON l.partner_id = p.id
      WHERE l.journal_id = $1
      ORDER BY l.line_number ASC;
    `;
    const result = await pool.query(sql, [journalId]);
    return result.rows.map((r) => this.mapLineRow(r));
  }

  async list(companyId: string, filters: ListJournalsFilter = {}, client?: pg.PoolClient): Promise<AccountingJournal[]> {
    const pool = client || getPool();
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.sourceDocumentType) {
      conditions.push(`source_document_type = $${idx++}`);
      params.push(filters.sourceDocumentType);
    }
    if (filters.fromDate) {
      conditions.push(`posting_date >= $${idx++}`);
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`posting_date <= $${idx++}`);
      params.push(filters.toDate);
    }
    if (filters.search) {
      conditions.push(`(journal_number ILIKE $${idx} OR description ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const sql = `
      SELECT * FROM accounting_journals
      WHERE ${conditions.join(' AND ')}
      ORDER BY posting_date DESC, created_at DESC;
    `;

    const result = await pool.query(sql, params);
    return result.rows.map((r) => this.mapJournalRow(r));
  }

  async updateStatus(
    id: string,
    status: JournalStatus,
    meta: {
      approvedBy?: string | null;
      approvedAt?: string | null;
      postedBy?: string | null;
      postedAt?: string | null;
      reversalJournalId?: string | null;
    } = {},
    client?: pg.PoolClient
  ): Promise<AccountingJournal | null> {
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
    if (meta.reversalJournalId !== undefined) {
      updates.push(`reversal_journal_id = $${idx++}`);
      params.push(meta.reversalJournalId);
    }

    const sql = `
      UPDATE accounting_journals
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *;
    `;

    const result = await pool.query(sql, params);
    if (result.rows.length === 0) return null;
    const journal = this.mapJournalRow(result.rows[0]);
    journal.lines = await this.getLines(journal.id, pool);
    return journal;
  }
}
