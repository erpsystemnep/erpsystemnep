import { query } from '../../../db/connection.js';
import { Branch } from '../../../../shared/types/index.js';
import { CreateBranchInput, UpdateBranchInput } from '../../../../shared/schemas/org.js';
import pg from 'pg';

export class BranchRepository {
  private mapRowToEntity(row: any): Branch {
    return {
      id: row.id,
      companyId: row.company_id,
      code: row.code,
      name: row.name,
      isHeadOffice: Boolean(row.is_head_office),
      addressLine1: row.address_line1 || undefined,
      city: row.city || undefined,
      stateProvince: row.state_province || undefined,
      postalCode: row.postal_code || undefined,
      countryCode: row.country_code,
      timezone: row.timezone,
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<Branch | null> {
    const sql = `
      SELECT id, company_id, code, name, is_head_office, address_line1,
             city, state_province, postal_code, country_code, timezone,
             is_active, created_at, updated_at
      FROM branches
      WHERE id = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async findByCompanyAndCode(companyId: string, code: string, client?: pg.PoolClient): Promise<Branch | null> {
    const sql = `
      SELECT id, company_id, code, name, is_head_office, address_line1,
             city, state_province, postal_code, country_code, timezone,
             is_active, created_at, updated_at
      FROM branches
      WHERE company_id = $1 AND code = $2
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [companyId, code.toUpperCase()]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async listByCompany(companyId: string, filters?: { isActive?: boolean }, client?: pg.PoolClient): Promise<Branch[]> {
    let sql = `
      SELECT id, company_id, code, name, is_head_office, address_line1,
             city, state_province, postal_code, country_code, timezone,
             is_active, created_at, updated_at
      FROM branches
      WHERE company_id = $1
    `;
    const params: any[] = [companyId];

    if (filters?.isActive !== undefined) {
      sql += ' AND is_active = $2';
      params.push(filters.isActive);
    }

    sql += ' ORDER BY code ASC';

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return result.rows.map((r: any) => this.mapRowToEntity(r));
  }

  async create(input: CreateBranchInput, client?: pg.PoolClient): Promise<Branch> {
    const sql = `
      INSERT INTO branches (
        company_id, code, name, is_head_office, address_line1,
        city, state_province, postal_code, country_code, timezone,
        is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id, company_id, code, name, is_head_office, address_line1,
                city, state_province, postal_code, country_code, timezone,
                is_active, created_at, updated_at
    `;
    const params = [
      input.companyId,
      input.code.toUpperCase(),
      input.name,
      input.isHeadOffice ?? false,
      input.addressLine1 || null,
      input.city || null,
      input.stateProvince || null,
      input.postalCode || null,
      (input.countryCode || 'US').toUpperCase(),
      input.timezone || 'UTC',
      input.isActive ?? true,
    ];

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return this.mapRowToEntity(result.rows[0]);
  }

  async update(id: string, input: UpdateBranchInput, client?: pg.PoolClient): Promise<Branch | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.code !== undefined) {
      fields.push(`code = $${idx++}`);
      params.push(input.code.toUpperCase());
    }
    if (input.name !== undefined) {
      fields.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.isHeadOffice !== undefined) {
      fields.push(`is_head_office = $${idx++}`);
      params.push(input.isHeadOffice);
    }
    if (input.addressLine1 !== undefined) {
      fields.push(`address_line1 = $${idx++}`);
      params.push(input.addressLine1);
    }
    if (input.city !== undefined) {
      fields.push(`city = $${idx++}`);
      params.push(input.city);
    }
    if (input.stateProvince !== undefined) {
      fields.push(`state_province = $${idx++}`);
      params.push(input.stateProvince);
    }
    if (input.postalCode !== undefined) {
      fields.push(`postal_code = $${idx++}`);
      params.push(input.postalCode);
    }
    if (input.countryCode !== undefined) {
      fields.push(`country_code = $${idx++}`);
      params.push(input.countryCode.toUpperCase());
    }
    if (input.timezone !== undefined) {
      fields.push(`timezone = $${idx++}`);
      params.push(input.timezone);
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
      UPDATE branches
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, company_id, code, name, is_head_office, address_line1,
                city, state_province, postal_code, country_code, timezone,
                is_active, created_at, updated_at
    `;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }
}
