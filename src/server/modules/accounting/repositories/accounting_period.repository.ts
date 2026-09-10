import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  FiscalYear,
  FiscalYearStatus,
  AccountingPeriod,
  AccountingPeriodStatus,
} from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export interface CreateFiscalYearDbInput {
  companyId: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface CreateAccountingPeriodDbInput {
  companyId: string;
  fiscalYearId?: string | null;
  periodName: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status?: AccountingPeriodStatus;
  closingNotes?: string | null;
}

export class AccountingPeriodRepository {
  private mapFiscalYearRow(row: any): FiscalYear {
    return {
      id: row.id,
      companyId: row.company_id,
      name: row.name,
      startDate: row.start_date ? new Date(row.start_date).toISOString().split('T')[0] : '',
      endDate: row.end_date ? new Date(row.end_date).toISOString().split('T')[0] : '',
      status: row.status as FiscalYearStatus,
      closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
      closedBy: row.closed_by || null,
      reopenedAt: row.reopened_at ? new Date(row.reopened_at).toISOString() : null,
      reopenedBy: row.reopened_by || null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  }

  private mapPeriodRow(row: any): AccountingPeriod {
    return {
      id: row.id,
      companyId: row.company_id,
      fiscalYearId: row.fiscal_year_id || null,
      periodName: row.period_name,
      periodNumber: row.period_number,
      startDate: row.start_date ? new Date(row.start_date).toISOString().split('T')[0] : '',
      endDate: row.end_date ? new Date(row.end_date).toISOString().split('T')[0] : '',
      status: row.status as AccountingPeriodStatus,
      closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
      closedBy: row.closed_by || null,
      reopenedAt: row.reopened_at ? new Date(row.reopened_at).toISOString() : null,
      reopenedBy: row.reopened_by || null,
      closingNotes: row.closing_notes || null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  }

  async createFiscalYear(data: CreateFiscalYearDbInput, client?: pg.PoolClient): Promise<FiscalYear> {
    const pool = client || getPool();
    const sql = `
      INSERT INTO fiscal_years (company_id, name, start_date, end_date, status)
      VALUES ($1, $2, $3, $4, 'OPEN')
      RETURNING *;
    `;
    const res = await pool.query(sql, [data.companyId, data.name.trim(), data.startDate, data.endDate]);
    return this.mapFiscalYearRow(res.rows[0]);
  }

  async findFiscalYearById(id: string, client?: pg.PoolClient): Promise<FiscalYear | null> {
    const pool = client || getPool();
    const sql = `SELECT * FROM fiscal_years WHERE id = $1;`;
    const res = await pool.query(sql, [id]);
    if (res.rows.length === 0) return null;
    return this.mapFiscalYearRow(res.rows[0]);
  }

  async findFiscalYearByName(companyId: string, name: string, client?: pg.PoolClient): Promise<FiscalYear | null> {
    const pool = client || getPool();
    const sql = `SELECT * FROM fiscal_years WHERE company_id = $1 AND name = $2;`;
    const res = await pool.query(sql, [companyId, name.trim()]);
    if (res.rows.length === 0) return null;
    return this.mapFiscalYearRow(res.rows[0]);
  }

  async listFiscalYears(companyId: string, client?: pg.PoolClient): Promise<FiscalYear[]> {
    const pool = client || getPool();
    const sql = `
      SELECT * FROM fiscal_years 
      WHERE company_id = $1 
      ORDER BY start_date DESC;
    `;
    const res = await pool.query(sql, [companyId]);
    return res.rows.map((r) => this.mapFiscalYearRow(r));
  }

  async updateFiscalYearStatus(
    id: string,
    status: FiscalYearStatus,
    meta: {
      closedBy?: string | null;
      closedAt?: string | null;
      reopenedBy?: string | null;
      reopenedAt?: string | null;
    } = {},
    client?: pg.PoolClient
  ): Promise<FiscalYear | null> {
    const pool = client || getPool();
    const updates: string[] = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [id, status];
    let idx = 3;

    if (meta.closedBy !== undefined) {
      updates.push(`closed_by = $${idx++}`);
      params.push(meta.closedBy);
    }
    if (meta.closedAt !== undefined) {
      updates.push(`closed_at = $${idx++}`);
      params.push(meta.closedAt ? new Date(meta.closedAt) : null);
    }
    if (meta.reopenedBy !== undefined) {
      updates.push(`reopened_by = $${idx++}`);
      params.push(meta.reopenedBy);
    }
    if (meta.reopenedAt !== undefined) {
      updates.push(`reopened_at = $${idx++}`);
      params.push(meta.reopenedAt ? new Date(meta.reopenedAt) : null);
    }

    const sql = `
      UPDATE fiscal_years
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *;
    `;
    const res = await pool.query(sql, params);
    if (res.rows.length === 0) return null;
    return this.mapFiscalYearRow(res.rows[0]);
  }

  async createPeriod(data: CreateAccountingPeriodDbInput, client?: pg.PoolClient): Promise<AccountingPeriod> {
    const pool = client || getPool();
    const sql = `
      INSERT INTO accounting_periods (
        company_id, fiscal_year_id, period_name, period_number, start_date, end_date, status, closing_notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const params = [
      data.companyId,
      data.fiscalYearId || null,
      data.periodName.trim(),
      data.periodNumber,
      data.startDate,
      data.endDate,
      data.status || 'OPEN',
      data.closingNotes || null,
    ];
    const res = await pool.query(sql, params);
    return this.mapPeriodRow(res.rows[0]);
  }

  async findPeriodById(id: string, client?: pg.PoolClient): Promise<AccountingPeriod | null> {
    const pool = client || getPool();
    const sql = `SELECT * FROM accounting_periods WHERE id = $1;`;
    const res = await pool.query(sql, [id]);
    if (res.rows.length === 0) return null;
    return this.mapPeriodRow(res.rows[0]);
  }

  async findPeriodByName(companyId: string, periodName: string, client?: pg.PoolClient): Promise<AccountingPeriod | null> {
    const pool = client || getPool();
    const sql = `SELECT * FROM accounting_periods WHERE company_id = $1 AND period_name = $2;`;
    const res = await pool.query(sql, [companyId, periodName.trim()]);
    if (res.rows.length === 0) return null;
    return this.mapPeriodRow(res.rows[0]);
  }

  async findPeriodByDate(
    companyId: string,
    postingDate: string,
    options: { forUpdate?: boolean; forShare?: boolean } = {},
    client?: pg.PoolClient
  ): Promise<AccountingPeriod | null> {
    const pool = client || getPool();
    let lockClause = '';
    if (options.forUpdate) {
      lockClause = 'FOR UPDATE';
    } else if (options.forShare) {
      lockClause = 'FOR SHARE';
    }

    const sql = `
      SELECT * FROM accounting_periods 
      WHERE company_id = $1 AND start_date <= $2 AND end_date >= $2
      ORDER BY created_at DESC
      LIMIT 1
      ${lockClause};
    `;
    const res = await pool.query(sql, [companyId, postingDate]);
    if (res.rows.length === 0) return null;
    return this.mapPeriodRow(res.rows[0]);
  }

  async listPeriods(
    companyId: string,
    filters: { fiscalYearId?: string; status?: AccountingPeriodStatus } = {},
    client?: pg.PoolClient
  ): Promise<AccountingPeriod[]> {
    const pool = client || getPool();
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.fiscalYearId) {
      conditions.push(`fiscal_year_id = $${idx++}`);
      params.push(filters.fiscalYearId);
    }
    if (filters.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filters.status);
    }

    const sql = `
      SELECT * FROM accounting_periods
      WHERE ${conditions.join(' AND ')}
      ORDER BY start_date ASC;
    `;
    const res = await pool.query(sql, params);
    return res.rows.map((r) => this.mapPeriodRow(r));
  }

  async updatePeriodStatus(
    id: string,
    status: AccountingPeriodStatus,
    meta: {
      closedBy?: string | null;
      closedAt?: string | null;
      reopenedBy?: string | null;
      reopenedAt?: string | null;
      closingNotes?: string | null;
    } = {},
    client?: pg.PoolClient
  ): Promise<AccountingPeriod | null> {
    const pool = client || getPool();
    const updates: string[] = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [id, status];
    let idx = 3;

    if (meta.closedBy !== undefined) {
      updates.push(`closed_by = $${idx++}`);
      params.push(meta.closedBy);
    }
    if (meta.closedAt !== undefined) {
      updates.push(`closed_at = $${idx++}`);
      params.push(meta.closedAt ? new Date(meta.closedAt) : null);
    }
    if (meta.reopenedBy !== undefined) {
      updates.push(`reopened_by = $${idx++}`);
      params.push(meta.reopenedBy);
    }
    if (meta.reopenedAt !== undefined) {
      updates.push(`reopened_at = $${idx++}`);
      params.push(meta.reopenedAt ? new Date(meta.reopenedAt) : null);
    }
    if (meta.closingNotes !== undefined) {
      updates.push(`closing_notes = $${idx++}`);
      params.push(meta.closingNotes);
    }

    const sql = `
      UPDATE accounting_periods
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *;
    `;
    const res = await pool.query(sql, params);
    if (res.rows.length === 0) return null;
    return this.mapPeriodRow(res.rows[0]);
  }

  /**
   * Authoritative check verifying that the accounting period for a given posting date is OPEN.
   * Runs inside the calling transaction with FOR SHARE locking to ensure concurrency safety.
   */
  async assertPeriodOpen(companyId: string, postingDate: string, client?: pg.PoolClient | pg.Pool): Promise<void> {
    const pool = client || getPool();
    const sql = `
      SELECT status, period_name, start_date, end_date 
      FROM accounting_periods 
      WHERE company_id = $1 AND start_date <= $2 AND end_date >= $2
      FOR SHARE;
    `;
    const res = await pool.query(sql, [companyId, postingDate]);
    if (res.rows.length > 0) {
      const period = res.rows[0];
      if (period.status === 'CLOSED') {
        const sDate = period.start_date instanceof Date ? period.start_date.toISOString().split('T')[0] : period.start_date;
        const eDate = period.end_date instanceof Date ? period.end_date.toISOString().split('T')[0] : period.end_date;
        throw AppError.badRequest(
          `Cannot post to closed accounting period '${period.period_name}' (${sDate} to ${eDate}) with posting date '${postingDate}'`
        );
      }
    }
  }
}
