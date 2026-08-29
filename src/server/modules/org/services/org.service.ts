import { CompanyRepository } from '../repositories/company.repository.js';
import { BranchRepository } from '../repositories/branch.repository.js';
import { WarehouseRepository } from '../repositories/warehouse.repository.js';
import {
  CreateCompanyInput,
  UpdateCompanyInput,
  CreateBranchInput,
  UpdateBranchInput,
  CreateWarehouseInput,
  UpdateWarehouseInput,
  createCompanySchema,
  updateCompanySchema,
  createBranchSchema,
  updateBranchSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
} from '../../../../shared/schemas/org.js';
import { Company, Branch, Warehouse, SecurityContext } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class OrgService {
  constructor(
    private companyRepo: CompanyRepository = new CompanyRepository(),
    private branchRepo: BranchRepository = new BranchRepository(),
    private warehouseRepo: WarehouseRepository = new WarehouseRepository()
  ) {}

  // --------------------------------------------------------------------------
  // COMPANY DOMAIN METHODS
  // --------------------------------------------------------------------------

  async getCompanyById(id: string, ctx: SecurityContext): Promise<Company> {
    this.assertCompanyAccess(ctx, id);
    const company = await this.companyRepo.findById(id);
    if (!company) {
      throw AppError.notFound(`Company with ID '${id}' not found`);
    }
    return company;
  }

  async listCompanies(ctx: SecurityContext, filters?: { isActive?: boolean }): Promise<Company[]> {
    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*')) {
      return this.companyRepo.list(filters);
    }
    if (ctx.activeCompanyId) {
      const company = await this.companyRepo.findById(ctx.activeCompanyId);
      if (!company) return [];
      if (filters?.isActive !== undefined && company.isActive !== filters.isActive) {
        return [];
      }
      return [company];
    }
    return [];
  }

  async createCompany(rawInput: unknown, ctx: SecurityContext): Promise<Company> {
    const parseResult = createCompanySchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid company creation payload', parseResult.error.format());
    }
    const input = parseResult.data;

    // Uniqueness check on company code
    const existing = await this.companyRepo.findByCode(input.code);
    if (existing) {
      throw AppError.conflict(`Company code '${input.code}' is already registered`);
    }

    return this.companyRepo.create(input);
  }

  async updateCompany(id: string, rawInput: unknown, ctx: SecurityContext): Promise<Company> {
    this.assertCompanyAccess(ctx, id);

    const parseResult = updateCompanySchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid company update payload', parseResult.error.format());
    }
    const input = parseResult.data;

    const existing = await this.companyRepo.findById(id);
    if (!existing) {
      throw AppError.notFound(`Company with ID '${id}' not found`);
    }

    if (input.code && input.code !== existing.code) {
      const duplicate = await this.companyRepo.findByCode(input.code);
      if (duplicate && duplicate.id !== id) {
        throw AppError.conflict(`Company code '${input.code}' is already taken`);
      }
    }

    const updated = await this.companyRepo.update(id, input);
    if (!updated) {
      throw AppError.notFound(`Company with ID '${id}' not found`);
    }
    return updated;
  }

  // --------------------------------------------------------------------------
  // BRANCH DOMAIN METHODS
  // --------------------------------------------------------------------------

  async getBranchById(id: string, ctx: SecurityContext): Promise<Branch> {
    const branch = await this.branchRepo.findById(id);
    if (!branch) {
      throw AppError.notFound(`Branch with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, branch.companyId);
    return branch;
  }

  async listBranches(
    companyId: string,
    ctx: SecurityContext,
    filters?: { isActive?: boolean }
  ): Promise<Branch[]> {
    this.assertCompanyAccess(ctx, companyId);
    return this.branchRepo.listByCompany(companyId, filters);
  }

  async createBranch(rawInput: unknown, ctx: SecurityContext): Promise<Branch> {
    const parseResult = createBranchSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid branch creation payload', parseResult.error.format());
    }
    const input = parseResult.data;

    this.assertCompanyAccess(ctx, input.companyId);

    // Verify company exists
    const company = await this.companyRepo.findById(input.companyId);
    if (!company) {
      throw AppError.notFound(`Parent company with ID '${input.companyId}' does not exist`);
    }

    // Check branch code uniqueness within company
    const existing = await this.branchRepo.findByCompanyAndCode(input.companyId, input.code);
    if (existing) {
      throw AppError.conflict(`Branch code '${input.code}' already exists in company '${company.code}'`);
    }

    return this.branchRepo.create(input);
  }

  async updateBranch(id: string, rawInput: unknown, ctx: SecurityContext): Promise<Branch> {
    const branch = await this.branchRepo.findById(id);
    if (!branch) {
      throw AppError.notFound(`Branch with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, branch.companyId);

    const parseResult = updateBranchSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid branch update payload', parseResult.error.format());
    }
    const input = parseResult.data;

    if (input.code && input.code !== branch.code) {
      const duplicate = await this.branchRepo.findByCompanyAndCode(branch.companyId, input.code);
      if (duplicate && duplicate.id !== id) {
        throw AppError.conflict(`Branch code '${input.code}' already exists in company`);
      }
    }

    const updated = await this.branchRepo.update(id, input);
    if (!updated) {
      throw AppError.notFound(`Branch with ID '${id}' not found`);
    }
    return updated;
  }

  // --------------------------------------------------------------------------
  // WAREHOUSE DOMAIN METHODS
  // --------------------------------------------------------------------------

  async getWarehouseById(id: string, ctx: SecurityContext): Promise<Warehouse> {
    const warehouse = await this.warehouseRepo.findById(id);
    if (!warehouse) {
      throw AppError.notFound(`Warehouse with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, warehouse.companyId);
    return warehouse;
  }

  async listWarehouses(
    companyId: string,
    ctx: SecurityContext,
    filters?: { branchId?: string | null; isActive?: boolean }
  ): Promise<Warehouse[]> {
    this.assertCompanyAccess(ctx, companyId);
    return this.warehouseRepo.listByCompany(companyId, filters);
  }

  async createWarehouse(rawInput: unknown, ctx: SecurityContext): Promise<Warehouse> {
    const parseResult = createWarehouseSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid warehouse creation payload', parseResult.error.format());
    }
    const input = parseResult.data;

    this.assertCompanyAccess(ctx, input.companyId);

    // Verify company exists
    const company = await this.companyRepo.findById(input.companyId);
    if (!company) {
      throw AppError.notFound(`Parent company with ID '${input.companyId}' does not exist`);
    }

    // If branch is provided, verify branch exists and belongs to same company
    if (input.branchId) {
      const branch = await this.branchRepo.findById(input.branchId);
      if (!branch) {
        throw AppError.notFound(`Referenced branch '${input.branchId}' does not exist`);
      }
      if (branch.companyId !== input.companyId) {
        throw AppError.badRequest(
          `Branch '${branch.code}' belongs to company '${branch.companyId}', not target company '${input.companyId}'`
        );
      }
    }

    // Check warehouse code uniqueness within company
    const existing = await this.warehouseRepo.findByCompanyAndCode(input.companyId, input.code);
    if (existing) {
      throw AppError.conflict(`Warehouse code '${input.code}' already exists in company '${company.code}'`);
    }

    return this.warehouseRepo.create(input);
  }

  async updateWarehouse(id: string, rawInput: unknown, ctx: SecurityContext): Promise<Warehouse> {
    const warehouse = await this.warehouseRepo.findById(id);
    if (!warehouse) {
      throw AppError.notFound(`Warehouse with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, warehouse.companyId);

    const parseResult = updateWarehouseSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid warehouse update payload', parseResult.error.format());
    }
    const input = parseResult.data;

    if (input.branchId) {
      const branch = await this.branchRepo.findById(input.branchId);
      if (!branch) {
        throw AppError.notFound(`Referenced branch '${input.branchId}' does not exist`);
      }
      if (branch.companyId !== warehouse.companyId) {
        throw AppError.badRequest(`Referenced branch belongs to a different company`);
      }
    }

    if (input.code && input.code !== warehouse.code) {
      const duplicate = await this.warehouseRepo.findByCompanyAndCode(warehouse.companyId, input.code);
      if (duplicate && duplicate.id !== id) {
        throw AppError.conflict(`Warehouse code '${input.code}' already exists in company`);
      }
    }

    const updated = await this.warehouseRepo.update(id, input);
    if (!updated) {
      throw AppError.notFound(`Warehouse with ID '${id}' not found`);
    }
    return updated;
  }

  // --------------------------------------------------------------------------
  // SECURITY & TENANT ISOLATION ASSERTIONS
  // --------------------------------------------------------------------------

  private assertCompanyAccess(ctx: SecurityContext, targetCompanyId: string): void {
    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*')) {
      return;
    }
    if (!ctx.activeCompanyId || ctx.activeCompanyId !== targetCompanyId) {
      throw AppError.forbidden(
        `Cross-tenant access violation: Caller active company '${ctx.activeCompanyId}' does not match target resource company '${targetCompanyId}'`
      );
    }
  }
}
