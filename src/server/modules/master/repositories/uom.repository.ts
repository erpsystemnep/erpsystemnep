import { query } from '../../../db/connection.js';
import { UnitOfMeasure, PaginatedResult } from '../../../../shared/types/index.js';
import {
  CreateUomInput,
  UpdateUomInput,
  UomQueryInput,
} from '../schemas/uom.schema.js';
import pg from 'pg';

export class UomRepository {
  private mapRowToEntity(row: any): UnitOfMeasure {
    return {
      id: row.id,
      companyId: row.company_id,
      code: row.code,
      name: row.name,
      symbol: row.symbol,
      uomType: row.uom_type,
      conversionPrecision: Number(row.conversion_precision),
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async findById(id: string, companyId?: string | null, client?: pg.PoolClient): Promise<UnitOfMeasure | null> {
    let sql = `
      SELECT id, company_id, code, name, symbol, uom_type,
             conversion_precision, is_active, created_at, updated_at
      FROM uoms
      WHERE id = $1
    `;
    const params: any[] = [id];

    if (companyId) {
      sql += ' AND company_id = $2';
      params.push(companyId);
    }

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async findByCode(code: string, companyId: string, client?: pg.PoolClient): Promise<UnitOfMeasure | null> {
    const sql = `
      SELECT id, company_id, code, name, symbol, uom_type,
             conversion_precision, is_active, created_at, updated_at
      FROM uoms
      WHERE UPPER(code) = UPPER($1) AND company_id = $2
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [code, companyId]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async list(companyId: string, queryFilters: UomQueryInput, client?: pg.PoolClient): Promise<PaginatedResult<UnitOfMeasure>> {
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (queryFilters.search) {
      conditions.push(`(code ILIKE $${idx} OR name ILIKE $${idx} OR symbol ILIKE $${idx})`);
      params.push(`%${queryFilters.search}%`);
      idx++;
    }

    if (queryFilters.code) {
      conditions.push(`code ILIKE $${idx}`);
      params.push(`%${queryFilters.code}%`);
      idx++;
    }

    if (queryFilters.name) {
      conditions.push(`name ILIKE $${idx}`);
      params.push(`%${queryFilters.name}%`);
      idx++;
    }

    if (queryFilters.uomType) {
      conditions.push(`uom_type = $${idx}`);
      params.push(queryFilters.uomType);
      idx++;
    }

    if (queryFilters.isActive !== undefined) {
      conditions.push(`is_active = $${idx}`);
      params.push(queryFilters.isActive);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS total FROM uoms ${whereClause}`;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const countRes = await executor.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const page = queryFilters.page || 1;
    const limit = queryFilters.limit || 100;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT id, company_id, code, name, symbol, uom_type,
             conversion_precision, is_active, created_at, updated_at
      FROM uoms
      ${whereClause}
      ORDER BY code ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(limit, offset);

    const dataRes = await executor.query(dataSql, params);
    const items = dataRes.rows.map((r: any) => this.mapRowToEntity(r));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(companyId: string, input: CreateUomInput, client?: pg.PoolClient): Promise<UnitOfMeasure> {
    const sql = `
      INSERT INTO uoms (
        company_id, code, name, symbol, uom_type,
        conversion_precision, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `;
    const params = [
      companyId,
      input.code.toUpperCase(),
      input.name,
      input.symbol,
      input.uomType || 'COUNT',
      input.conversionPrecision ?? 4,
      input.isActive ?? true,
    ];

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const res = await executor.query(sql, params);
    return this.mapRowToEntity(res.rows[0]);
  }

  async update(id: string, companyId: string, input: UpdateUomInput, client?: pg.PoolClient): Promise<UnitOfMeasure | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      fields.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.symbol !== undefined) {
      fields.push(`symbol = $${idx++}`);
      params.push(input.symbol);
    }
    if (input.uomType !== undefined) {
      fields.push(`uom_type = $${idx++}`);
      params.push(input.uomType);
    }
    if (input.conversionPrecision !== undefined) {
      fields.push(`conversion_precision = $${idx++}`);
      params.push(input.conversionPrecision);
    }
    if (input.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      params.push(input.isActive);
    }

    if (fields.length === 0) {
      return this.findById(id, companyId, client);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id, companyId);

    const sql = `
      UPDATE uoms
      SET ${fields.join(', ')}
      WHERE id = $${idx++} AND company_id = $${idx++}
      RETURNING *
    `;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const res = await executor.query(sql, params);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async softDelete(id: string, companyId: string, client?: pg.PoolClient): Promise<UnitOfMeasure | null> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const sql = `
      UPDATE uoms
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND company_id = $2
      RETURNING *
    `;
    const res = await executor.query(sql, [id, companyId]);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async hasItemsAssigned(id: string, client?: pg.PoolClient): Promise<boolean> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const res = await executor.query(
      'SELECT 1 FROM items WHERE base_uom_id = $1 AND is_active = TRUE LIMIT 1',
      [id]
    );
    return res.rows.length > 0;
  }
}
