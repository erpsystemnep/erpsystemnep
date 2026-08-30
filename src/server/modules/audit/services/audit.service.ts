import { AuditRepository } from '../repositories/audit.repository.js';
import {
  AuditLog,
  AuditAction,
  SecurityContext,
  PaginatedResult,
} from '../../../../shared/types/index.js';
import {
  CreateAuditLogInput,
  AuditQueryInput,
  createAuditLogSchema,
  auditQuerySchema,
} from '../../../../shared/schemas/audit.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class AuditService {
  constructor(private auditRepo: AuditRepository = new AuditRepository()) {}

  /**
   * Records an audit event using authenticated security context.
   * Prevents identity and tenant spoofing.
   * Supports participation in Unit of Work transactions via `client`.
   */
  async recordEvent(
    event: {
      action: AuditAction;
      module: string;
      entityName: string;
      entityId: string;
      companyId?: string | null;
      branchId?: string | null;
      warehouseId?: string | null;
      reasonCode?: string;
      reasonText?: string;
      changes?: {
        old?: Record<string, unknown>;
        new?: Record<string, unknown>;
      };
      ipAddress?: string;
      userAgent?: string;
    },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    // Determine companyId: Non-superadmin cannot spoof another company's audit trail
    let companyId: string | null = null;
    if (ctx.isSuperadmin && event.companyId !== undefined) {
      companyId = event.companyId;
    } else {
      companyId = ctx.activeCompanyId || event.companyId || null;
    }

    // Determine branchId: Default to activeBranchId if not explicitly provided
    const branchId = event.branchId !== undefined ? event.branchId : (ctx.activeBranchId || null);

    // Identity is strictly bound to authenticated user
    const userId = ctx.userId !== 'anonymous' ? ctx.userId : null;

    const rawInput: CreateAuditLogInput = {
      companyId,
      branchId,
      warehouseId: event.warehouseId || null,
      userId,
      action: event.action,
      module: event.module,
      entityName: event.entityName,
      entityId: event.entityId,
      reasonCode: event.reasonCode,
      reasonText: event.reasonText,
      changes: event.changes,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      sessionId: ctx.sessionId,
      correlationId: ctx.correlationId,
    };

    const parseResult = createAuditLogSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid audit log event payload', parseResult.error.format());
    }

    return this.auditRepo.create(parseResult.data, client);
  }

  // --------------------------------------------------------------------------
  // CONVENIENCE DISPATCHERS FOR STANDARD ACTIONS
  // --------------------------------------------------------------------------

  async logCreate(
    module: string,
    entityName: string,
    entityId: string,
    newData: Record<string, unknown>,
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'CREATE',
        module,
        entityName,
        entityId,
        changes: { new: newData },
      },
      ctx,
      client
    );
  }

  async logUpdate(
    module: string,
    entityName: string,
    entityId: string,
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
    ctx: SecurityContext,
    reason?: string,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'UPDATE',
        module,
        entityName,
        entityId,
        reasonText: reason,
        changes: { old: oldData, new: newData },
      },
      ctx,
      client
    );
  }

  async logDelete(
    module: string,
    entityName: string,
    entityId: string,
    oldData: Record<string, unknown>,
    ctx: SecurityContext,
    reason?: string,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'DELETE',
        module,
        entityName,
        entityId,
        reasonText: reason,
        changes: { old: oldData },
      },
      ctx,
      client
    );
  }

  async logApprove(
    module: string,
    entityName: string,
    entityId: string,
    ctx: SecurityContext,
    reason?: string,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'APPROVE',
        module,
        entityName,
        entityId,
        reasonText: reason,
      },
      ctx,
      client
    );
  }

  async logReject(
    module: string,
    entityName: string,
    entityId: string,
    ctx: SecurityContext,
    reason?: string,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'REJECT',
        module,
        entityName,
        entityId,
        reasonText: reason,
      },
      ctx,
      client
    );
  }

  async logPost(
    module: string,
    entityName: string,
    entityId: string,
    ctx: SecurityContext,
    reason?: string,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'POST',
        module,
        entityName,
        entityId,
        reasonText: reason,
      },
      ctx,
      client
    );
  }

  async logCancel(
    module: string,
    entityName: string,
    entityId: string,
    ctx: SecurityContext,
    reason?: string,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'CANCEL',
        module,
        entityName,
        entityId,
        reasonText: reason,
      },
      ctx,
      client
    );
  }

  async logReverse(
    module: string,
    entityName: string,
    entityId: string,
    ctx: SecurityContext,
    reason?: string,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'REVERSE',
        module,
        entityName,
        entityId,
        reasonText: reason,
      },
      ctx,
      client
    );
  }

  async logPermissionChange(
    entityId: string,
    changes: { old?: Record<string, unknown>; new?: Record<string, unknown> },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<AuditLog> {
    return this.recordEvent(
      {
        action: 'PERMISSION_CHANGE',
        module: 'auth',
        entityName: 'RolePermission',
        entityId,
        changes,
      },
      ctx,
      client
    );
  }

  // --------------------------------------------------------------------------
  // QUERY AUDIT LOGS
  // --------------------------------------------------------------------------

  async queryLogs(
    rawQuery: unknown,
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<PaginatedResult<AuditLog>> {
    const parseResult = auditQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw AppError.validation('Invalid audit query filters', parseResult.error.format());
    }
    const filters = parseResult.data;

    // Enforce tenant boundary: Non-superadmins can only query within their company
    if (!ctx.isSuperadmin) {
      if (!ctx.activeCompanyId) {
        throw AppError.forbidden('Active company context required to query audit records');
      }
      if (filters.companyId && filters.companyId !== ctx.activeCompanyId) {
        throw AppError.forbidden('Cross-tenant audit query access denied');
      }
      filters.companyId = ctx.activeCompanyId;
    }

    return this.auditRepo.query(filters, client);
  }
}
