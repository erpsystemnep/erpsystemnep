import { query } from '../../../db/connection.js';
import { Warehouse, WarehouseType } from '../../../../shared/types/index.js';
import { CreateWarehouseInput, UpdateWarehouseInput } from '../../../../shared/schemas/org.js';
import pg from 'pg';

export class WarehouseRepository {
  private mapRowToEntity(row: any): Warehouse {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id || null,
      code: row.code,
      name: row.name,
      warehouseType: row.warehouse_type as WarehouseType,
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<Warehouse | null> {
    const sql = `
      SELECT id, company_id, branch_id, code, name, warehouse_type,
             is_active, created_at, updated_at
      FROM warehouses
      WHERE id = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async findByCompanyAndCode(companyId: string, code: string, client?: pg.PoolClient): Promise<Warehouse | null> {
    const sql = `
      SELECT id, company_id, branch_id, code, name, warehouse_type,
             is_active, created_at, updated_at
      FROM warehouses
      WHERE company_id = $1 AND code = $2
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [companyId, code.toUpperCase()]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async listByCompany(
    companyId: string,
    filters?: { branchId?: string | null; isActive?: boolean },
    client?: pg.PoolClient
  ): Promise<Warehouse[]> {
    let sql = `
      SELECT id, company_id, branch_id, code, name, warehouse_type,
             is_active, created_at, updated_at
      FROM warehouses
      WHERE company_id = $1
    `;
    const params: any[] = [companyId];
    let idx = 2;

    if (filters?.branchId !== undefined) {
      if (filters.branchId === null) {
        sql += ' AND branch_id IS NULL';
      } else {
        sql += ` AND branch_id = $${idx++}`;
        params.push(filters.branchId);
      }
    }

    if (filters?.isActive !== undefined) {
      sql += ` AND is_active = $${idx++}`;
      params.push(filters.isActive);
    }

    sql += ' ORDER BY code ASC';

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return result.rows.map((r: any) => this.mapRowToEntity(r));
  }

  async create(input: CreateWarehouseInput, client?: pg.PoolClient): Promise<Warehouse> {
    const sql = `
      INSERT INTO warehouses (
        company_id, branch_id, code, name, warehouse_type,
        is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id, company_id, branch_id, code, name, warehouse_type,
                is_active, created_at, updated_at
    `;
    const params = [
      input.companyId,
      input.branchId || null,
      input.code.toUpperCase(),
      input.name,
      input.warehouseType || 'PHYSICAL',
      input.isActive ?? true,
    ];

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return this.mapRowToEntity(result.rows[0]);
  }

  async update(id: string, input: UpdateWarehouseInput, client?: pg.PoolClient): Promise<Warehouse | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.branchId !== undefined) {
      fields.push(`branch_id = $${idx++}`);
      params.push(input.branchId);
    }
    if (input.code !== undefined) {
      fields.push(`code = $${idx++}`);
      params.push(input.code.toUpperCase());
    }
    if (input.name !== undefined) {
      fields.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.warehouseType !== undefined) {
      fields.push(`warehouse_type = $${idx++}`);
      params.push(input.warehouseType);
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
      UPDATE warehouses
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, company_id, branch_id, code, name, warehouse_type,
                is_active, created_at, updated_at
    `;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }
}
