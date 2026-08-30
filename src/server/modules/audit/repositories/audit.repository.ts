import { query } from '../../../db/connection.js';
import { AuditLog, PaginatedResult } from '../../../../shared/types/index.js';
import { CreateAuditLogInput, AuditQueryInput } from '../../../../shared/schemas/audit.js';
import pg from 'pg';

export class AuditRepository {
  /**
   * Maps raw database row to AuditLog domain interface.
   */
  private mapRowToEntity(row: any): AuditLog {
    return {
      id: row.id,
      companyId: row.company_id || null,
      branchId: row.branch_id || null,
      warehouseId: row.warehouse_id || null,
      userId: row.user_id || null,
      action: row.action,
      module: row.module,
      entityName: row.entity_name,
      entityId: row.entity_id,
      reasonCode: row.reason_code || undefined,
      reasonText: row.reason_text || undefined,
      changes: row.changes || undefined,
      ipAddress: row.ip_address || undefined,
      userAgent: row.user_agent || undefined,
      sessionId: row.session_id || undefined,
      correlationId: row.correlation_id || undefined,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /**
   * Inserts an immutable audit log record.
   * Can participate in an ongoing Unit of Work transaction via `client`.
   */
  async create(input: CreateAuditLogInput, client?: pg.PoolClient): Promise<AuditLog> {
    const sql = `
      INSERT INTO audit_logs (
        company_id, branch_id, warehouse_id, user_id, action,
        module, entity_name, entity_id, reason_code, reason_text,
        changes, ip_address, user_agent, session_id, correlation_id,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, CURRENT_TIMESTAMP
      )
      RETURNING id, company_id, branch_id, warehouse_id, user_id, action,
                module, entity_name, entity_id, reason_code, reason_text,
                changes, ip_address, user_agent, session_id, correlation_id,
                created_at
    `;

    const params = [
      input.companyId || null,
      input.branchId || null,
      input.warehouseId || null,
      input.userId || null,
      input.action,
      input.module,
      input.entityName,
      input.entityId,
      input.reasonCode || null,
      input.reasonText || null,
      input.changes ? JSON.stringify(input.changes) : null,
      input.ipAddress || null,
      input.userAgent || null,
      input.sessionId || null,
      input.correlationId || null,
    ];

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return this.mapRowToEntity(result.rows[0]);
  }

  /**
   * Queries audit records with filtering and pagination.
   */
  async query(filters: AuditQueryInput, client?: pg.PoolClient): Promise<PaginatedResult<AuditLog>> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.companyId) {
      conditions.push(`company_id = $${idx++}`);
      params.push(filters.companyId);
    }

    if (filters.branchId) {
      conditions.push(`branch_id = $${idx++}`);
      params.push(filters.branchId);
    }

    if (filters.warehouseId) {
      conditions.push(`warehouse_id = $${idx++}`);
      params.push(filters.warehouseId);
    }

    if (filters.userId) {
      conditions.push(`user_id = $${idx++}`);
      params.push(filters.userId);
    }

    if (filters.action) {
      conditions.push(`action = $${idx++}`);
      params.push(filters.action);
    }

    if (filters.module) {
      conditions.push(`module = $${idx++}`);
      params.push(filters.module);
    }

    if (filters.entityName) {
      conditions.push(`entity_name = $${idx++}`);
      params.push(filters.entityName);
    }

    if (filters.entityId) {
      conditions.push(`entity_id = $${idx++}`);
      params.push(filters.entityId);
    }

    if (filters.startDate) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matching records
    const countSql = `SELECT COUNT(*) AS total FROM audit_logs ${whereClause}`;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const countResult = await executor.query(countSql, params);
    const total = Number(countResult.rows[0]?.total || 0);

    // Fetch paginated records
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT id, company_id, branch_id, warehouse_id, user_id, action,
             module, entity_name, entity_id, reason_code, reason_text,
             changes, ip_address, user_agent, session_id, correlation_id,
             created_at
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const dataResult = await executor.query(dataSql, [...params, limit, offset]);
    const items = dataResult.rows.map((row: any) => this.mapRowToEntity(row));
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }
}
