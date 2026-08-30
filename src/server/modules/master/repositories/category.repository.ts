import { query } from '../../../db/connection.js';
import { ItemCategory, PaginatedResult } from '../../../../shared/types/index.js';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  CategoryQueryInput,
} from '../schemas/category.schema.js';
import pg from 'pg';

export class CategoryRepository {
  private mapRowToEntity(row: any): ItemCategory {
    return {
      id: row.id,
      companyId: row.company_id,
      code: row.code,
      name: row.name,
      description: row.description || undefined,
      parentCategoryId: row.parent_category_id || undefined,
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      parentCode: row.parent_code || undefined,
      parentName: row.parent_name || undefined,
    };
  }

  async findById(id: string, companyId?: string | null, client?: pg.PoolClient): Promise<ItemCategory | null> {
    let sql = `
      SELECT c.id, c.company_id, c.code, c.name, c.description, c.parent_category_id,
             c.is_active, c.created_at, c.updated_at,
             p.code AS parent_code, p.name AS parent_name
      FROM item_categories c
      LEFT JOIN item_categories p ON c.parent_category_id = p.id
      WHERE c.id = $1
    `;
    const params: any[] = [id];

    if (companyId) {
      sql += ' AND c.company_id = $2';
      params.push(companyId);
    }

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async findByCode(code: string, companyId: string, client?: pg.PoolClient): Promise<ItemCategory | null> {
    const sql = `
      SELECT c.id, c.company_id, c.code, c.name, c.description, c.parent_category_id,
             c.is_active, c.created_at, c.updated_at,
             p.code AS parent_code, p.name AS parent_name
      FROM item_categories c
      LEFT JOIN item_categories p ON c.parent_category_id = p.id
      WHERE UPPER(c.code) = UPPER($1) AND c.company_id = $2
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [code, companyId]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async list(companyId: string, queryFilters: CategoryQueryInput, client?: pg.PoolClient): Promise<PaginatedResult<ItemCategory>> {
    const conditions: string[] = ['c.company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (queryFilters.search) {
      conditions.push(`(c.code ILIKE $${idx} OR c.name ILIKE $${idx} OR c.description ILIKE $${idx})`);
      params.push(`%${queryFilters.search}%`);
      idx++;
    }

    if (queryFilters.code) {
      conditions.push(`c.code ILIKE $${idx}`);
      params.push(`%${queryFilters.code}%`);
      idx++;
    }

    if (queryFilters.name) {
      conditions.push(`c.name ILIKE $${idx}`);
      params.push(`%${queryFilters.name}%`);
      idx++;
    }

    if (queryFilters.parentCategoryId !== undefined) {
      if (queryFilters.parentCategoryId === null) {
        conditions.push('c.parent_category_id IS NULL');
      } else {
        conditions.push(`c.parent_category_id = $${idx}`);
        params.push(queryFilters.parentCategoryId);
        idx++;
      }
    }

    if (queryFilters.isActive !== undefined) {
      conditions.push(`c.is_active = $${idx}`);
      params.push(queryFilters.isActive);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS total FROM item_categories c ${whereClause}`;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const countRes = await executor.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const page = queryFilters.page || 1;
    const limit = queryFilters.limit || 100;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT c.id, c.company_id, c.code, c.name, c.description, c.parent_category_id,
             c.is_active, c.created_at, c.updated_at,
             p.code AS parent_code, p.name AS parent_name
      FROM item_categories c
      LEFT JOIN item_categories p ON c.parent_category_id = p.id
      ${whereClause}
      ORDER BY c.code ASC
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

  async create(companyId: string, input: CreateCategoryInput, client?: pg.PoolClient): Promise<ItemCategory> {
    const sql = `
      INSERT INTO item_categories (
        company_id, code, name, description, parent_category_id, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `;
    const params = [
      companyId,
      input.code.toUpperCase(),
      input.name,
      input.description || null,
      input.parentCategoryId || null,
      input.isActive ?? true,
    ];

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const res = await executor.query(sql, params);
    return this.mapRowToEntity(res.rows[0]);
  }

  async update(id: string, companyId: string, input: UpdateCategoryInput, client?: pg.PoolClient): Promise<ItemCategory | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      fields.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${idx++}`);
      params.push(input.description || null);
    }
    if (input.parentCategoryId !== undefined) {
      fields.push(`parent_category_id = $${idx++}`);
      params.push(input.parentCategoryId || null);
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
      UPDATE item_categories
      SET ${fields.join(', ')}
      WHERE id = $${idx++} AND company_id = $${idx++}
      RETURNING *
    `;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const res = await executor.query(sql, params);
    if (res.rows.length === 0) return null;
    return this.findById(id, companyId, client);
  }

  async softDelete(id: string, companyId: string, client?: pg.PoolClient): Promise<ItemCategory | null> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const sql = `
      UPDATE item_categories
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND company_id = $2
      RETURNING *
    `;
    const res = await executor.query(sql, [id, companyId]);
    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async hasActiveChildren(id: string, client?: pg.PoolClient): Promise<boolean> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const res = await executor.query(
      'SELECT 1 FROM item_categories WHERE parent_category_id = $1 AND is_active = TRUE LIMIT 1',
      [id]
    );
    return res.rows.length > 0;
  }

  async hasItemsAssigned(id: string, client?: pg.PoolClient): Promise<boolean> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const res = await executor.query(
      'SELECT 1 FROM items WHERE category_id = $1 AND is_active = TRUE LIMIT 1',
      [id]
    );
    return res.rows.length > 0;
  }
}
