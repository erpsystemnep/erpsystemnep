import { query } from '../../../db/connection.js';
import { Role, UserCompanyRole } from '../../../../shared/types/index.js';
import pg from 'pg';

export interface CreateRoleData {
  companyId?: string | null;
  code: string;
  name: string;
  description?: string;
  isSystem?: boolean;
  permissions?: string[];
}

export class RoleRepository {
  protected mapRoleRow(row: any): Role {
    return {
      id: row.id,
      companyId: row.company_id || null,
      code: row.code,
      name: row.name,
      description: row.description || '',
      isSystem: Boolean(row.is_system),
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<Role | null> {
    const sql = `
      SELECT id, company_id, code, name, description, is_system, created_at
      FROM roles
      WHERE id = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRoleRow(result.rows[0]);
  }

  async findByCode(code: string, companyId?: string | null, client?: pg.PoolClient): Promise<Role | null> {
    let sql: string;
    let params: any[];

    if (companyId) {
      sql = `
        SELECT id, company_id, code, name, description, is_system, created_at
        FROM roles
        WHERE code = $1 AND (company_id = $2 OR company_id IS NULL)
        ORDER BY company_id DESC NULLS LAST
        LIMIT 1
      `;
      params = [code.toUpperCase().trim(), companyId];
    } else {
      sql = `
        SELECT id, company_id, code, name, description, is_system, created_at
        FROM roles
        WHERE code = $1 AND company_id IS NULL
        LIMIT 1
      `;
      params = [code.toUpperCase().trim()];
    }

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRoleRow(result.rows[0]);
  }

  async create(data: CreateRoleData, client?: pg.PoolClient): Promise<Role> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };

    const sql = `
      INSERT INTO roles (company_id, code, name, description, is_system, created_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING id, company_id, code, name, description, is_system, created_at
    `;
    const params = [
      data.companyId || null,
      data.code.toUpperCase().trim(),
      data.name.trim(),
      data.description?.trim() || null,
      data.isSystem ?? false,
    ];

    const result = await executor.query(sql, params);
    const role = this.mapRoleRow(result.rows[0]);

    if (data.permissions && data.permissions.length > 0) {
      await this.setRolePermissions(role.id, data.permissions, client);
    }

    return role;
  }

  async setRolePermissions(roleId: string, permissions: string[], client?: pg.PoolClient): Promise<void> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };

    // Clear existing permissions for role
    await executor.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

    // Insert new permissions
    for (const perm of permissions) {
      if (perm === '*') continue; // Wildcard is managed conceptually by role definition
      await executor.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [roleId, perm]
      );
    }
  }

  async getRolePermissions(roleId: string, client?: pg.PoolClient): Promise<string[]> {
    const sql = `
      SELECT permission_id
      FROM role_permissions
      WHERE role_id = $1
      ORDER BY permission_id ASC
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [roleId]);
    return result.rows.map((r: any) => r.permission_id);
  }

  async assignUserRole(
    data: {
      userId: string;
      companyId: string;
      roleId: string;
      branchId?: string | null;
    },
    client?: pg.PoolClient
  ): Promise<UserCompanyRole> {
    const sql = `
      INSERT INTO user_company_roles (user_id, company_id, branch_id, role_id, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, company_id, branch_id, role_id) DO UPDATE
      SET created_at = CURRENT_TIMESTAMP
      RETURNING id, user_id, company_id, branch_id, role_id, created_at
    `;
    const params = [data.userId, data.companyId, data.branchId || null, data.roleId];
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      companyId: row.company_id,
      branchId: row.branch_id || null,
      roleId: row.role_id,
    };
  }

  async removeUserRole(
    data: {
      userId: string;
      companyId: string;
      roleId: string;
      branchId?: string | null;
    },
    client?: pg.PoolClient
  ): Promise<boolean> {
    let sql: string;
    let params: any[];

    if (data.branchId) {
      sql = `
        DELETE FROM user_company_roles
        WHERE user_id = $1 AND company_id = $2 AND role_id = $3 AND branch_id = $4
      `;
      params = [data.userId, data.companyId, data.roleId, data.branchId];
    } else {
      sql = `
        DELETE FROM user_company_roles
        WHERE user_id = $1 AND company_id = $2 AND role_id = $3 AND branch_id IS NULL
      `;
      params = [data.userId, data.companyId, data.roleId];
    }

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return (result.rowCount ?? 0) > 0;
  }

  async getUserCompanyRoles(userId: string, companyId?: string, client?: pg.PoolClient): Promise<Array<UserCompanyRole & { roleCode: string; roleName: string }>> {
    let sql = `
      SELECT ucr.id, ucr.user_id, ucr.company_id, ucr.branch_id, ucr.role_id, ucr.created_at,
             r.code AS role_code, r.name AS role_name
      FROM user_company_roles ucr
      JOIN roles r ON r.id = ucr.role_id
      WHERE ucr.user_id = $1
    `;
    const params: any[] = [userId];

    if (companyId) {
      sql += ' AND ucr.company_id = $2';
      params.push(companyId);
    }

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return result.rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      companyId: row.company_id,
      branchId: row.branch_id || undefined,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
