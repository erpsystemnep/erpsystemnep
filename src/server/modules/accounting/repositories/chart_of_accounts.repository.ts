import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import { ChartOfAccount, AccountType } from '../../../../shared/types/index.js';

export interface CreateAccountDbInput {
  companyId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  parentAccountId?: string | null;
  isGroup?: boolean;
  isActive?: boolean;
  currencyCode?: string;
  description?: string | null;
}

export interface UpdateAccountDbInput {
  accountName?: string;
  parentAccountId?: string | null;
  isGroup?: boolean;
  isActive?: boolean;
  description?: string | null;
}

export interface ListAccountsFilter {
  accountType?: AccountType;
  isActive?: boolean;
  isGroup?: boolean;
  search?: string;
}

export class ChartOfAccountsRepository {
  private mapRow(row: any): ChartOfAccount {
    return {
      id: row.id,
      companyId: row.company_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      accountType: row.account_type,
      parentAccountId: row.parent_account_id,
      isGroup: row.is_group,
      isActive: row.is_active,
      currencyCode: row.currency_code,
      description: row.description,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    };
  }

  async create(data: CreateAccountDbInput, client?: pg.PoolClient): Promise<ChartOfAccount> {
    const pool = client || getPool();
    const sql = `
      INSERT INTO chart_of_accounts (
        company_id, account_code, account_name, account_type,
        parent_account_id, is_group, is_active, currency_code, description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const params = [
      data.companyId,
      data.accountCode.trim().toUpperCase(),
      data.accountName.trim(),
      data.accountType,
      data.parentAccountId || null,
      data.isGroup ?? false,
      data.isActive ?? true,
      data.currencyCode || 'USD',
      data.description || null,
    ];

    const result = await pool.query(sql, params);
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: UpdateAccountDbInput, client?: pg.PoolClient): Promise<ChartOfAccount | null> {
    const pool = client || getPool();
    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [id];
    let idx = 2;

    if (data.accountName !== undefined) {
      updates.push(`account_name = $${idx++}`);
      params.push(data.accountName.trim());
    }
    if (data.parentAccountId !== undefined) {
      updates.push(`parent_account_id = $${idx++}`);
      params.push(data.parentAccountId || null);
    }
    if (data.isGroup !== undefined) {
      updates.push(`is_group = $${idx++}`);
      params.push(data.isGroup);
    }
    if (data.isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      params.push(data.isActive);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${idx++}`);
      params.push(data.description);
    }

    const sql = `
      UPDATE chart_of_accounts
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *;
    `;

    const result = await pool.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async findById(id: string, client?: pg.PoolClient): Promise<ChartOfAccount | null> {
    const pool = client || getPool();
    const sql = `SELECT * FROM chart_of_accounts WHERE id = $1;`;
    const result = await pool.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async findByCode(companyId: string, accountCode: string, client?: pg.PoolClient): Promise<ChartOfAccount | null> {
    const pool = client || getPool();
    const sql = `
      SELECT * FROM chart_of_accounts 
      WHERE company_id = $1 AND UPPER(account_code) = UPPER($2);
    `;
    const result = await pool.query(sql, [companyId, accountCode.trim()]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async list(companyId: string, filters: ListAccountsFilter = {}, client?: pg.PoolClient): Promise<ChartOfAccount[]> {
    const pool = client || getPool();
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (filters.accountType) {
      conditions.push(`account_type = $${idx++}`);
      params.push(filters.accountType);
    }
    if (filters.isActive !== undefined) {
      conditions.push(`is_active = $${idx++}`);
      params.push(filters.isActive);
    }
    if (filters.isGroup !== undefined) {
      conditions.push(`is_group = $${idx++}`);
      params.push(filters.isGroup);
    }
    if (filters.search) {
      conditions.push(`(account_code ILIKE $${idx} OR account_name ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const sql = `
      SELECT * FROM chart_of_accounts
      WHERE ${conditions.join(' AND ')}
      ORDER BY account_code ASC;
    `;

    const result = await pool.query(sql, params);
    return result.rows.map((r) => this.mapRow(r));
  }

  async delete(id: string, client?: pg.PoolClient): Promise<boolean> {
    const pool = client || getPool();
    const sql = `DELETE FROM chart_of_accounts WHERE id = $1 RETURNING id;`;
    const result = await pool.query(sql, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
