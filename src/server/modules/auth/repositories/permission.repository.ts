import { query } from '../../../db/connection.js';
import { PermissionDefinition } from '../seed/defaultRoles.js';
import pg from 'pg';

export class PermissionRepository {
  async findAll(client?: pg.PoolClient): Promise<PermissionDefinition[]> {
    const sql = `
      SELECT id, module, action, description
      FROM permissions
      ORDER BY module ASC, action ASC
    `;
    const executor = client ? client : { query: (text: string, params?: any[]) => query(text, params) };
    const result = await executor.query(sql);
    return result.rows.map((row: any) => ({
      id: row.id,
      module: row.module,
      action: row.action,
      description: row.description,
    }));
  }

  async findById(id: string, client?: pg.PoolClient): Promise<PermissionDefinition | null> {
    const sql = `
      SELECT id, module, action, description
      FROM permissions
      WHERE id = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      module: row.module,
      action: row.action,
      description: row.description,
    };
  }

  async upsertMany(permissions: PermissionDefinition[], client?: pg.PoolClient): Promise<void> {
    if (permissions.length === 0) return;
    const executor = client ? client : { query: (text: string, params?: any[]) => query(text, params) };

    const ids: string[] = [];
    const modules: string[] = [];
    const actions: string[] = [];
    const descriptions: string[] = [];

    for (const p of permissions) {
      ids.push(p.id);
      modules.push(p.module);
      actions.push(p.action);
      descriptions.push(p.description);
    }

    const sql = `
      INSERT INTO permissions (id, module, action, description, created_at)
      SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], array_fill(CURRENT_TIMESTAMP, ARRAY[cardinality($1::text[])]))
      ON CONFLICT (id) DO UPDATE
      SET description = EXCLUDED.description,
          module = EXCLUDED.module,
          action = EXCLUDED.action
    `;
    await executor.query(sql, [ids, modules, actions, descriptions]);
  }
}
