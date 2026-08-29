import { query, withTransaction } from '../../../db/connection.js';
import { Company } from '../../../../shared/types/index.js';
import { CreateCompanyInput, UpdateCompanyInput } from '../../../../shared/schemas/org.js';
import pg from 'pg';

export class CompanyRepository {
  /**
   * Maps raw database row to Company domain interface.
   */
  private mapRowToEntity(row: any): Company {
    return {
      id: row.id,
      code: row.code,
      legalName: row.legal_name,
      tradeName: row.trade_name || undefined,
      baseCurrency: row.base_currency,
      taxIdentifier: row.tax_identifier || undefined,
      fiscalYearStartMonth: Number(row.fiscal_year_start_month),
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<Company | null> {
    const sql = `
      SELECT id, code, legal_name, trade_name, base_currency, tax_identifier,
             fiscal_year_start_month, is_active, created_at, updated_at
      FROM companies
      WHERE id = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async findByCode(code: string, client?: pg.PoolClient): Promise<Company | null> {
    const sql = `
      SELECT id, code, legal_name, trade_name, base_currency, tax_identifier,
             fiscal_year_start_month, is_active, created_at, updated_at
      FROM companies
      WHERE code = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [code.toUpperCase()]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async list(filters?: { isActive?: boolean }, client?: pg.PoolClient): Promise<Company[]> {
    let sql = `
      SELECT id, code, legal_name, trade_name, base_currency, tax_identifier,
             fiscal_year_start_month, is_active, created_at, updated_at
      FROM companies
    `;
    const params: any[] = [];

    if (filters?.isActive !== undefined) {
      sql += ' WHERE is_active = $1';
      params.push(filters.isActive);
    }

    sql += ' ORDER BY code ASC';

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return result.rows.map((r: any) => this.mapRowToEntity(r));
  }

  async create(input: CreateCompanyInput, client?: pg.PoolClient): Promise<Company> {
    const sql = `
      INSERT INTO companies (
        code, legal_name, trade_name, base_currency, tax_identifier,
        fiscal_year_start_month, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id, code, legal_name, trade_name, base_currency, tax_identifier,
                fiscal_year_start_month, is_active, created_at, updated_at
    `;
    const params = [
      input.code.toUpperCase(),
      input.legalName,
      input.tradeName || null,
      input.baseCurrency.toUpperCase(),
      input.taxIdentifier || null,
      input.fiscalYearStartMonth ?? 1,
      input.isActive ?? true,
    ];

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return this.mapRowToEntity(result.rows[0]);
  }

  async update(id: string, input: UpdateCompanyInput, client?: pg.PoolClient): Promise<Company | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.code !== undefined) {
      fields.push(`code = $${idx++}`);
      params.push(input.code.toUpperCase());
    }
    if (input.legalName !== undefined) {
      fields.push(`legal_name = $${idx++}`);
      params.push(input.legalName);
    }
    if (input.tradeName !== undefined) {
      fields.push(`trade_name = $${idx++}`);
      params.push(input.tradeName);
    }
    if (input.baseCurrency !== undefined) {
      fields.push(`base_currency = $${idx++}`);
      params.push(input.baseCurrency.toUpperCase());
    }
    if (input.taxIdentifier !== undefined) {
      fields.push(`tax_identifier = $${idx++}`);
      params.push(input.taxIdentifier);
    }
    if (input.fiscalYearStartMonth !== undefined) {
      fields.push(`fiscal_year_start_month = $${idx++}`);
      params.push(input.fiscalYearStartMonth);
    }
    if (input.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      params.push(input.isActive);
    }

    if (fields.length === 0) {
      return this.findById(id, client);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const sql = `
      UPDATE companies
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, code, legal_name, trade_name, base_currency, tax_identifier,
                fiscal_year_start_month, is_active, created_at, updated_at
    `;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }
}
