import { UomRepository } from '../repositories/uom.repository.js';
import { AuditService } from '../../audit/services/audit.service.js';
import {
  UnitOfMeasure,
  PaginatedResult,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  createUomSchema,
  updateUomSchema,
  uomQuerySchema,
} from '../schemas/uom.schema.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class UomService {
  constructor(
    private readonly uomRepo: UomRepository = new UomRepository(),
    private readonly auditService: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Unit of Measure operations');
    }
    return ctx.activeCompanyId;
  }

  async getUom(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<UnitOfMeasure> {
    const companyId = this.resolveCompanyId(ctx);
    const uom = await this.uomRepo.findById(id, ctx.isSuperadmin ? null : companyId, client);
    if (!uom) {
      throw AppError.notFound(`Unit of measure with id '${id}' not found`);
    }
    return uom;
  }

  async listUoms(rawQuery: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<PaginatedResult<UnitOfMeasure>> {
    const companyId = this.resolveCompanyId(ctx, (rawQuery as any)?.companyId);
    const parseResult = uomQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw AppError.validation('Invalid UOM query parameters', parseResult.error.format());
    }
    return this.uomRepo.list(companyId, parseResult.data, client);
  }

  async createUom(rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<UnitOfMeasure> {
    const companyId = this.resolveCompanyId(ctx, (rawInput as any)?.companyId);
    const parseResult = createUomSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid unit of measure data', parseResult.error.format());
    }

    const input = parseResult.data;

    // Check duplicate code
    const existing = await this.uomRepo.findByCode(input.code, companyId, client);
    if (existing) {
      throw AppError.conflict(`Unit of measure with code '${input.code.toUpperCase()}' already exists in this company`);
    }

    const uom = await this.uomRepo.create(companyId, input, client);

    // Audit log
    await this.auditService.logCreate(
      'master',
      'UnitOfMeasure',
      uom.id,
      uom as unknown as Record<string, unknown>,
      ctx,
      client
    );

    return uom;
  }

  async updateUom(id: string, rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<UnitOfMeasure> {
    const companyId = this.resolveCompanyId(ctx, (rawInput as any)?.companyId);
    const existing = await this.uomRepo.findById(id, companyId, client);
    if (!existing) {
      throw AppError.notFound(`Unit of measure with id '${id}' not found`);
    }

    const parseResult = updateUomSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid unit of measure update data', parseResult.error.format());
    }

    const updated = await this.uomRepo.update(id, companyId, parseResult.data, client);
    if (!updated) {
      throw AppError.notFound(`Unit of measure with id '${id}' not found`);
    }

    // Audit log
    await this.auditService.logUpdate(
      'master',
      'UnitOfMeasure',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      ctx,
      'Updated unit of measure specifications',
      client
    );

    return updated;
  }

  async deleteUom(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<UnitOfMeasure> {
    const companyId = this.resolveCompanyId(ctx);
    const existing = await this.uomRepo.findById(id, companyId, client);
    if (!existing) {
      throw AppError.notFound(`Unit of measure with id '${id}' not found`);
    }

    // Guard against deactivating UOM if items are assigned
    const hasItems = await this.uomRepo.hasItemsAssigned(id, client);
    if (hasItems) {
      throw AppError.validation(`Cannot deactivate UOM '${existing.code}' because active items reference it as their base UOM`);
    }

    const deactivated = await this.uomRepo.softDelete(id, companyId, client);
    if (!deactivated) {
      throw AppError.notFound(`Unit of measure with id '${id}' not found`);
    }

    // Audit log
    await this.auditService.logDelete(
      'master',
      'UnitOfMeasure',
      id,
      existing as unknown as Record<string, unknown>,
      ctx,
      'Soft-deleted / deactivated unit of measure',
      client
    );

    return deactivated;
  }
}
