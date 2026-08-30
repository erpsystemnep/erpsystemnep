import { ItemRepository } from '../repositories/item.repository.js';
import { CategoryRepository } from '../repositories/category.repository.js';
import { UomRepository } from '../repositories/uom.repository.js';
import { AuditService } from '../../audit/services/audit.service.js';
import {
  Item,
  ItemUomConversion,
  PaginatedResult,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  createItemSchema,
  updateItemSchema,
  itemQuerySchema,
  itemUomConversionInputSchema,
} from '../schemas/item.schema.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class ItemService {
  constructor(
    private readonly itemRepo: ItemRepository = new ItemRepository(),
    private readonly categoryRepo: CategoryRepository = new CategoryRepository(),
    private readonly uomRepo: UomRepository = new UomRepository(),
    private readonly auditService: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Item operations');
    }
    return ctx.activeCompanyId;
  }

  async getItem(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<Item> {
    const companyId = this.resolveCompanyId(ctx);
    const item = await this.itemRepo.findById(id, ctx.isSuperadmin ? null : companyId, client);
    if (!item) {
      throw AppError.notFound(`Item with id '${id}' not found`);
    }
    return item;
  }

  async listItems(rawQuery: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<PaginatedResult<Item>> {
    const companyId = this.resolveCompanyId(ctx, (rawQuery as any)?.companyId);
    const parseResult = itemQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw AppError.validation('Invalid item query parameters', parseResult.error.format());
    }
    return this.itemRepo.list(companyId, parseResult.data, client);
  }

  async createItem(rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<Item> {
    const companyId = this.resolveCompanyId(ctx, (rawInput as any)?.companyId);
    const parseResult = createItemSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid item data', parseResult.error.format());
    }

    const input = parseResult.data;

    // Check duplicate SKU
    const existing = await this.itemRepo.findBySku(input.sku, companyId, client);
    if (existing) {
      throw AppError.conflict(`Item with SKU '${input.sku.toUpperCase()}' already exists in this company`);
    }

    // Validate Base UOM belongs to same company and is active
    const baseUom = await this.uomRepo.findById(input.baseUomId, companyId, client);
    if (!baseUom) {
      throw AppError.validation(`Base UOM '${input.baseUomId}' does not exist or belongs to another company`);
    }
    if (!baseUom.isActive) {
      throw AppError.validation(`Base UOM '${baseUom.code}' is inactive and cannot be assigned`);
    }

    // Validate Category if specified
    if (input.categoryId) {
      const category = await this.categoryRepo.findById(input.categoryId, companyId, client);
      if (!category) {
        throw AppError.validation(`Category '${input.categoryId}' does not exist or belongs to another company`);
      }
      if (!category.isActive) {
        throw AppError.validation(`Category '${category.code}' is inactive and cannot be assigned`);
      }
    }

    // Validate Conversions if specified
    if (input.conversions && input.conversions.length > 0) {
      for (const conv of input.conversions) {
        const fromUom = await this.uomRepo.findById(conv.fromUomId, companyId, client);
        const toUom = await this.uomRepo.findById(conv.toUomId, companyId, client);
        if (!fromUom || !toUom) {
          throw AppError.validation('Conversion UOM does not exist or belongs to another company');
        }
        if (conv.conversionFactor <= 0) {
          throw AppError.validation('Conversion factor must be strictly greater than 0');
        }
      }
    }

    const item = await this.itemRepo.create(companyId, input, client);

    // Audit log
    await this.auditService.logCreate(
      'master',
      'Item',
      item.id,
      item as unknown as Record<string, unknown>,
      ctx,
      client
    );

    return item;
  }

  async updateItem(id: string, rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<Item> {
    const companyId = this.resolveCompanyId(ctx, (rawInput as any)?.companyId);
    const existing = await this.itemRepo.findById(id, companyId, client);
    if (!existing) {
      throw AppError.notFound(`Item with id '${id}' not found`);
    }

    const parseResult = updateItemSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid item update data', parseResult.error.format());
    }

    const input = parseResult.data;

    // Validate Base UOM if changing
    if (input.baseUomId) {
      const baseUom = await this.uomRepo.findById(input.baseUomId, companyId, client);
      if (!baseUom) {
        throw AppError.validation(`Base UOM '${input.baseUomId}' does not exist or belongs to another company`);
      }
    }

    // Validate Category if changing
    if (input.categoryId !== undefined && input.categoryId !== null) {
      const category = await this.categoryRepo.findById(input.categoryId, companyId, client);
      if (!category) {
        throw AppError.validation(`Category '${input.categoryId}' does not exist or belongs to another company`);
      }
    }

    // Validate Conversions if changing
    if (input.conversions && input.conversions.length > 0) {
      for (const conv of input.conversions) {
        const fromUom = await this.uomRepo.findById(conv.fromUomId, companyId, client);
        const toUom = await this.uomRepo.findById(conv.toUomId, companyId, client);
        if (!fromUom || !toUom) {
          throw AppError.validation('Conversion UOM does not exist or belongs to another company');
        }
        if (conv.conversionFactor <= 0) {
          throw AppError.validation('Conversion factor must be strictly greater than 0');
        }
      }
    }

    const updated = await this.itemRepo.update(id, companyId, input, client);
    if (!updated) {
      throw AppError.notFound(`Item with id '${id}' not found`);
    }

    // Audit log
    await this.auditService.logUpdate(
      'master',
      'Item',
      id,
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      ctx,
      'Updated item specifications',
      client
    );

    return updated;
  }

  async deleteItem(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<Item> {
    const companyId = this.resolveCompanyId(ctx);
    const existing = await this.itemRepo.findById(id, companyId, client);
    if (!existing) {
      throw AppError.notFound(`Item with id '${id}' not found`);
    }

    const deactivated = await this.itemRepo.softDelete(id, companyId, client);
    if (!deactivated) {
      throw AppError.notFound(`Item with id '${id}' not found`);
    }

    // Audit log
    await this.auditService.logDelete(
      'master',
      'Item',
      id,
      existing as unknown as Record<string, unknown>,
      ctx,
      'Soft-deleted / deactivated item record',
      client
    );

    return deactivated;
  }

  async addConversion(itemId: string, rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<ItemUomConversion> {
    const companyId = this.resolveCompanyId(ctx);
    const item = await this.itemRepo.findById(itemId, companyId, client);
    if (!item) {
      throw AppError.notFound(`Item with id '${itemId}' not found`);
    }

    const parseResult = itemUomConversionInputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid conversion parameters', parseResult.error.format());
    }

    const input = parseResult.data;

    // Validate from & to UOMs belong to company
    const fromUom = await this.uomRepo.findById(input.fromUomId, companyId, client);
    const toUom = await this.uomRepo.findById(input.toUomId, companyId, client);
    if (!fromUom || !toUom) {
      throw AppError.validation('Conversion UOMs must exist within the item company');
    }

    return this.itemRepo.addConversion(itemId, input, client);
  }

  async deleteConversion(itemId: string, conversionId: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<boolean> {
    const companyId = this.resolveCompanyId(ctx);
    const item = await this.itemRepo.findById(itemId, companyId, client);
    if (!item) {
      throw AppError.notFound(`Item with id '${itemId}' not found`);
    }

    return this.itemRepo.deleteConversion(conversionId, itemId, client);
  }
}
