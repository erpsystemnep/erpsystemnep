import pg from 'pg';
import { ChartOfAccountsRepository } from '../repositories/chart_of_accounts.repository.js';
import { CompanyRepository } from '../../org/repositories/company.repository.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { ChartOfAccount, SecurityContext } from '../../../../shared/types/index.js';
import {
  CreateAccountInput,
  UpdateAccountInput,
  createAccountSchema,
  updateAccountSchema,
} from '../../../../shared/schemas/accounting.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class ChartOfAccountsService {
  constructor(
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository(),
    private companyRepo: CompanyRepository = new CompanyRepository(),
    private auditService: AuditService = new AuditService()
  ) {}

  private assertCompanyAccess(ctx: SecurityContext, targetCompanyId: string): void {
    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*')) {
      return;
    }
    if (!ctx.activeCompanyId || ctx.activeCompanyId !== targetCompanyId) {
      throw AppError.forbidden(
        `Cross-tenant access violation: Caller active company '${ctx.activeCompanyId}' cannot access chart of accounts in company '${targetCompanyId}'`
      );
    }
  }

  async createAccount(rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<ChartOfAccount> {
    const parseResult = createAccountSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid chart of account creation payload', parseResult.error.format());
    }
    const input: CreateAccountInput = parseResult.data;

    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required to create an account');
    }
    this.assertCompanyAccess(ctx, companyId);

    // Verify company exists
    const company = await this.companyRepo.findById(companyId);
    if (!company) {
      throw AppError.notFound(`Company with ID '${companyId}' does not exist`);
    }

    // Verify account code uniqueness
    const existing = await this.coaRepo.findByCode(companyId, input.accountCode, client);
    if (existing) {
      throw AppError.conflict(
        `Account code '${input.accountCode.toUpperCase()}' already exists in company '${company.code}'`
      );
    }

    // If parent account specified, verify parent exists in same company and is a group
    if (input.parentAccountId) {
      const parent = await this.coaRepo.findById(input.parentAccountId, client);
      if (!parent || parent.companyId !== companyId) {
        throw AppError.badRequest(`Parent account '${input.parentAccountId}' not found in active company`);
      }
      if (!parent.isGroup) {
        throw AppError.badRequest(`Parent account '${parent.accountCode}' must be a group account`);
      }
    }

    const created = await this.coaRepo.create(
      {
        companyId,
        accountCode: input.accountCode,
        accountName: input.accountName,
        accountType: input.accountType,
        parentAccountId: input.parentAccountId,
        isGroup: input.isGroup,
        isActive: input.isActive,
        currencyCode: input.currencyCode || company.baseCurrency || 'USD',
        description: input.description,
      },
      client
    );

    // Audit trail
    await this.auditService.logCreate(
      'accounting',
      'ChartOfAccount',
      created.id,
      { accountCode: created.accountCode, accountName: created.accountName, accountType: created.accountType },
      ctx,
      client
    );

    return created;
  }

  async updateAccount(id: string, rawInput: unknown, ctx: SecurityContext, client?: pg.PoolClient): Promise<ChartOfAccount> {
    const account = await this.coaRepo.findById(id, client);
    if (!account) {
      throw AppError.notFound(`Chart of account with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, account.companyId);

    const parseResult = updateAccountSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid chart of account update payload', parseResult.error.format());
    }
    const input: UpdateAccountInput = parseResult.data;

    // Verify parent account if changing
    if (input.parentAccountId) {
      if (input.parentAccountId === id) {
        throw AppError.badRequest('An account cannot be its own parent');
      }
      const parent = await this.coaRepo.findById(input.parentAccountId, client);
      if (!parent || parent.companyId !== account.companyId) {
        throw AppError.badRequest(`Parent account '${input.parentAccountId}' not found in active company`);
      }
      if (!parent.isGroup) {
        throw AppError.badRequest(`Parent account '${parent.accountCode}' must be a group account`);
      }
    }

    const updated = await this.coaRepo.update(id, input, client);
    if (!updated) {
      throw AppError.notFound(`Chart of account with ID '${id}' not found`);
    }

    await this.auditService.logUpdate(
      'accounting',
      'ChartOfAccount',
      updated.id,
      { accountCode: account.accountCode },
      { accountCode: updated.accountCode, changes: input },
      ctx,
      'Updated chart of account definition',
      client
    );

    return updated;
  }

  async getAccountById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<ChartOfAccount> {
    const account = await this.coaRepo.findById(id, client);
    if (!account) {
      throw AppError.notFound(`Chart of account with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, account.companyId);
    return account;
  }

  async listAccounts(
    companyId: string,
    ctx: SecurityContext,
    filters?: { accountType?: any; isActive?: boolean; isGroup?: boolean; search?: string },
    client?: pg.PoolClient
  ): Promise<ChartOfAccount[]> {
    this.assertCompanyAccess(ctx, companyId);
    return this.coaRepo.list(companyId, filters, client);
  }
}
