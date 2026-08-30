import { CategoryRepository } from '../repositories/category.repository.js';
import { AuditService } from '../../audit/services/audit.service.js';
import {
  ItemCategory,
  PaginatedResult,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  createCategorySchema,
  updateCategorySchema,
  categoryQuerySchema,
} from '../schemas/category.schema.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class CategoryService {
  constructor(
    private readonly categoryRepo: CategoryRepository = new CategoryRepository(),
    private readonly auditService: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Item Category operations');
    }
    return ctx.activeCompanyId;
  }

  async getCategory(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<ItemCategory> {
    const companyId = this.resolveCompanyId(ctx);
    const category = await this.categoryRepo.findById(id, ctx.isSuperadmin ? null : companyId, client);
    if (!category) {
      throw AppError.notFound(`Item category with id '${id}' not found`);
    }
    return category;
  }

  async listCategories(rawQuery: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<PaginatedResult<ItemCategory>> {
    const companyId = this.resolveCompanyId(ctx, (rawQuery as any)?.companyId);
    const parseResult = categoryQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw AppError.validation('Invalid category query parameters', parseResult.error.format());
    }
    return this.categoryRepo.list(companyId, parseResult.data, client);
  }

  async createCategory(rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<ItemCategory> {
    const companyId = this.resolveCompanyId(ctx, (rawInput as any)?.companyId);
    const parseResult = createCategorySchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid item category data', parseResult.error.format());
    }

    const input = parseResult.data;

    // Check duplicate code
    const existing = await this.categoryRepo.findByCode(input.code, companyId, client);
    if (existing) {
      throw AppError.conflict(`Item category with code '${input.code.toUpperCase()}' already exists in this company`);
    }

    // Validate parent category if specified
    if (input.parentCategoryId) {
      const parent = await this.categoryRepo.findById(input.parentCategoryId, companyId, client);
      if (!parent) {
        throw AppError.validation(`Parent category '${input.parentCategoryId}' does not exist or belongs to another company`);
      }
      if (!parent.isActive) {
        throw AppError.validation(`Parent category '${parent.code}' is inactive and cannot be assigned`);
      }
    }

    const category = await this.categoryRepo.create(companyId, input, client);

    // Audit log
    await this.auditService.logCreate(
      'master',
      'ItemCategory',
      category.id,
      category as unknown as Record<string, unknown>,
      ctx,
      client
    );

    return category;
  }

  async updateCategory(id: string, rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<ItemCategory> {
    const companyId = this.resolveCompanyId(ctx, (rawInput as any)?.companyId);
    const existing = await this.categoryRepo.findById(id, companyId, client);
    if (!existing) {
      throw AppError.notFound(`Item category with id '${id}' not found`);
    }

    const parseResult = updateCategorySchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid item category update data', parseResult.error.format());
    }

    const input = parseResult.data;

    // Validate parent category if changing
    if (input.parentCategoryId !== undefined && input.parentCategoryId !== null) {
      if (input.parentCategoryId === id) {
        throw AppError.validation('Category cannot be its own parent');
      }
      const parent = await this.categoryRepo.findById(input.parentCategoryId, companyId, client);
      if (!parent) {
        throw AppError.validation(`Parent category '${input.parentCategoryId}' does not exist or belongs to another company`);
      }
    }

    const updated = await this.categoryRepo.update(id, companyId, input, client);
    if (!updated) {
      throw AppError.notFound(`Item category with id '${id}' not found`);
    }

    // Audit log
    await this.auditService.logUpdate(
      'master',
      'ItemCategory',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      ctx,
      'Updated item category attributes',
      client
    );

    return updated;
  }

  async deleteCategory(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<ItemCategory> {
    const companyId = this.resolveCompanyId(ctx);
    const existing = await this.categoryRepo.findById(id, companyId, client);
    if (!existing) {
      throw AppError.notFound(`Item category with id '${id}' not found`);
    }

    // Guard against deactivating category with active children
    const hasChildren = await this.categoryRepo.hasActiveChildren(id, client);
    if (hasChildren) {
      throw AppError.validation(`Cannot deactivate category '${existing.code}' because it has active child categories`);
    }

    // Guard against deactivating category with assigned items
    const hasItems = await this.categoryRepo.hasItemsAssigned(id, client);
    if (hasItems) {
      throw AppError.validation(`Cannot deactivate category '${existing.code}' because items are currently assigned to it`);
    }

    const deactivated = await this.categoryRepo.softDelete(id, companyId, client);
    if (!deactivated) {
      throw AppError.notFound(`Item category with id '${id}' not found`);
    }

    // Audit log
    await this.auditService.logDelete(
      'master',
      'ItemCategory',
      id,
      existing as unknown as Record<string, unknown>,
      ctx,
      'Soft-deleted / deactivated item category',
      client
    );

    return deactivated;
  }
}
