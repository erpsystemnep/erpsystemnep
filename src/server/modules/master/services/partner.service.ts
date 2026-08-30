import { PartnerRepository } from '../repositories/partner.repository.js';
import { AuditService } from '../../audit/services/audit.service.js';
import {
  BusinessPartner,
  PaginatedResult,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  createPartnerSchema,
  updatePartnerSchema,
  partnerQuerySchema,
} from '../schemas/partner.schema.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class PartnerService {
  constructor(
    private readonly partnerRepo: PartnerRepository = new PartnerRepository(),
    private readonly auditService: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Business Partner operations');
    }
    return ctx.activeCompanyId;
  }

  async getPartner(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<BusinessPartner> {
    const companyId = this.resolveCompanyId(ctx);
    const partner = await this.partnerRepo.findById(id, ctx.isSuperadmin ? null : companyId, client);
    if (!partner) {
      throw AppError.notFound(`Business partner with id '${id}' not found`);
    }
    return partner;
  }

  async listPartners(rawQuery: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<PaginatedResult<BusinessPartner>> {
    const companyId = this.resolveCompanyId(ctx, (rawQuery as any)?.companyId);
    const parseResult = partnerQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw AppError.validation('Invalid partner query parameters', parseResult.error.format());
    }
    return this.partnerRepo.list(companyId, parseResult.data, client);
  }

  async createPartner(rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<BusinessPartner> {
    const companyId = this.resolveCompanyId(ctx, (rawInput as any)?.companyId);
    const parseResult = createPartnerSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid business partner data', parseResult.error.format());
    }

    const input = parseResult.data;

    // Check duplicate code
    const existing = await this.partnerRepo.findByCode(input.partnerCode, companyId, client);
    if (existing) {
      throw AppError.conflict(`Business partner with code '${input.partnerCode.toUpperCase()}' already exists in this company`);
    }

    const partner = await this.partnerRepo.create(companyId, input, client);

    // Audit log
    await this.auditService.logCreate(
      'master',
      'BusinessPartner',
      partner.id,
      partner as unknown as Record<string, unknown>,
      ctx,
      client
    );

    return partner;
  }

  async updatePartner(id: string, rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<BusinessPartner> {
    const companyId = this.resolveCompanyId(ctx, (rawInput as any)?.companyId);
    const existing = await this.partnerRepo.findById(id, companyId, client);
    if (!existing) {
      throw AppError.notFound(`Business partner with id '${id}' not found`);
    }

    const parseResult = updatePartnerSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid business partner update data', parseResult.error.format());
    }

    const updated = await this.partnerRepo.update(id, companyId, parseResult.data, client);
    if (!updated) {
      throw AppError.notFound(`Business partner with id '${id}' not found`);
    }

    // Audit log
    await this.auditService.logUpdate(
      'master',
      'BusinessPartner',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      ctx,
      'Updated business partner attributes',
      client
    );

    return updated;
  }

  async deletePartner(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<BusinessPartner> {
    const companyId = this.resolveCompanyId(ctx);
    const existing = await this.partnerRepo.findById(id, companyId, client);
    if (!existing) {
      throw AppError.notFound(`Business partner with id '${id}' not found`);
    }

    const deactivated = await this.partnerRepo.softDelete(id, companyId, client);
    if (!deactivated) {
      throw AppError.notFound(`Business partner with id '${id}' not found`);
    }

    // Audit log
    await this.auditService.logDelete(
      'master',
      'BusinessPartner',
      id,
      existing as unknown as Record<string, unknown>,
      ctx,
      'Soft-deleted / deactivated business partner record',
      client
    );

    return deactivated;
  }
}
