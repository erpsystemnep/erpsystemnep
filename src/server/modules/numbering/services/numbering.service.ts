import { NumberingSeriesRepository } from '../repositories/numbering_series.repository.js';
import { CompanyRepository } from '../../org/repositories/company.repository.js';
import { BranchRepository } from '../../org/repositories/branch.repository.js';
import { withTransaction } from '../../../db/connection.js';
import {
  NumberingSeries,
  SecurityContext,
  GenerateNumberParams,
  GeneratedNumberResult,
} from '../../../../shared/types/index.js';
import {
  CreateNumberingSeriesInput,
  UpdateNumberingSeriesInput,
  createNumberingSeriesSchema,
  updateNumberingSeriesSchema,
} from '../../../../shared/schemas/org.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class NumberingService {
  constructor(
    private numberingRepo: NumberingSeriesRepository = new NumberingSeriesRepository(),
    private companyRepo: CompanyRepository = new CompanyRepository(),
    private branchRepo: BranchRepository = new BranchRepository()
  ) {}

  /**
   * Generates the next sequential document number with concurrency lock protection.
   */
  async generateNextNumber(
    params: GenerateNumberParams,
    ctx: SecurityContext,
    client?: pg.PoolClient,
    now: Date = new Date()
  ): Promise<GeneratedNumberResult> {
    const { companyId, branchId, documentType } = params;

    // 1. Tenant Security Boundary
    this.assertTenantAccess(ctx, companyId);

    // 2. Wrap in transaction with FOR UPDATE row lock if not already inside one
    const executeAllocation = async (txClient: pg.PoolClient): Promise<GeneratedNumberResult> => {
      // Step A: Resolve series (Branch-specific first, fallback to company-wide)
      let series: NumberingSeries | null = null;

      if (branchId) {
        series = await this.numberingRepo.findByScope(companyId, branchId, documentType, txClient);
      }

      if (!series) {
        // Fallback to company-wide series
        series = await this.numberingRepo.findByScope(companyId, null, documentType, txClient);
      }

      if (!series) {
        const branchMsg = branchId ? ` or branch '${branchId}'` : '';
        throw AppError.notFound(
          `Numbering series not configured for document type '${documentType}' in company '${companyId}'${branchMsg}`
        );
      }

      // Step B: Lock the series row for atomic update
      const lockedSeries = await this.numberingRepo.findForUpdate(series.id, txClient);
      if (!lockedSeries) {
        throw AppError.notFound(`Numbering series with ID '${series.id}' not found during lock`);
      }

      // Step C: Invariant & Active Check
      if (!lockedSeries.isActive) {
        throw AppError.invariantViolation(
          `Numbering series '${lockedSeries.prefix}' for document type '${documentType}' is inactive`
        );
      }

      // Step D: Evaluate Reset Frequency
      const currentDateStr = now.toISOString().split('T')[0];
      let nextNumber = lockedSeries.currentNumber + 1;
      let shouldReset = false;

      if (lockedSeries.lastResetDate) {
        const lastDate = new Date(lockedSeries.lastResetDate);
        if (lockedSeries.resetFrequency === 'ANNUAL') {
          if (now.getUTCFullYear() > lastDate.getUTCFullYear()) {
            shouldReset = true;
          }
        } else if (lockedSeries.resetFrequency === 'MONTHLY') {
          const yearDiff = now.getUTCFullYear() - lastDate.getUTCFullYear();
          const monthDiff = now.getUTCMonth() - lastDate.getUTCMonth();
          if (yearDiff > 0 || monthDiff > 0) {
            shouldReset = true;
          }
        }
      } else if (lockedSeries.resetFrequency !== 'NEVER' && lockedSeries.currentNumber > 0) {
        // First recorded reset date
        shouldReset = false;
      }

      if (shouldReset) {
        nextNumber = 1;
      }

      // Step E: Persist incremented counter atomically
      const updatedSeries = await this.numberingRepo.incrementAndReset(
        lockedSeries.id,
        nextNumber,
        currentDateStr,
        txClient
      );

      // Step F: Format sequence number
      const paddedNumber = String(nextNumber).padStart(updatedSeries.minDigits, '0');
      const suffix = updatedSeries.suffix ? updatedSeries.suffix : '';
      const formattedNumber = `${updatedSeries.prefix}${paddedNumber}${suffix}`;

      return {
        formattedNumber,
        seriesId: updatedSeries.id,
        sequenceNumber: nextNumber,
        prefix: updatedSeries.prefix,
        suffix: updatedSeries.suffix,
      };
    };

    if (client) {
      return executeAllocation(client);
    } else {
      return withTransaction(executeAllocation);
    }
  }

  // --------------------------------------------------------------------------
  // ADMINISTRATIVE & CONFIGURATION METHODS
  // --------------------------------------------------------------------------

  async getSeriesById(id: string, ctx: SecurityContext): Promise<NumberingSeries> {
    const series = await this.numberingRepo.findById(id);
    if (!series) {
      throw AppError.notFound(`Numbering series with ID '${id}' not found`);
    }
    this.assertTenantAccess(ctx, series.companyId);
    return series;
  }

  async listSeries(
    companyId: string,
    ctx: SecurityContext,
    filters?: { branchId?: string | null; documentType?: string; isActive?: boolean }
  ): Promise<NumberingSeries[]> {
    this.assertTenantAccess(ctx, companyId);
    return this.numberingRepo.list(companyId, filters);
  }

  async createSeries(rawInput: unknown, ctx: SecurityContext): Promise<NumberingSeries> {
    const parseResult = createNumberingSeriesSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid numbering series creation payload', parseResult.error.format());
    }
    const input = parseResult.data;

    this.assertTenantAccess(ctx, input.companyId);

    // Verify company exists
    const company = await this.companyRepo.findById(input.companyId);
    if (!company) {
      throw AppError.notFound(`Parent company with ID '${input.companyId}' does not exist`);
    }

    // Verify branch if specified
    if (input.branchId) {
      const branch = await this.branchRepo.findById(input.branchId);
      if (!branch) {
        throw AppError.notFound(`Referenced branch with ID '${input.branchId}' does not exist`);
      }
      if (branch.companyId !== input.companyId) {
        throw AppError.badRequest(`Referenced branch belongs to a different company`);
      }
    }

    // Check duplicate series definition
    const existing = await this.numberingRepo.findByScope(
      input.companyId,
      input.branchId,
      input.documentType
    );
    if (existing) {
      const scopeDesc = input.branchId ? `branch '${input.branchId}'` : 'company-wide scope';
      throw AppError.conflict(
        `Numbering series for document type '${input.documentType}' already exists in ${scopeDesc}`
      );
    }

    return this.numberingRepo.create(input);
  }

  async updateSeries(id: string, rawInput: unknown, ctx: SecurityContext): Promise<NumberingSeries> {
    const series = await this.numberingRepo.findById(id);
    if (!series) {
      throw AppError.notFound(`Numbering series with ID '${id}' not found`);
    }
    this.assertTenantAccess(ctx, series.companyId);

    const parseResult = updateNumberingSeriesSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid numbering series update payload', parseResult.error.format());
    }
    const input = parseResult.data;

    const updated = await this.numberingRepo.update(id, input);
    if (!updated) {
      throw AppError.notFound(`Numbering series with ID '${id}' not found`);
    }
    return updated;
  }

  // --------------------------------------------------------------------------
  // SECURITY ASSERTIONS
  // --------------------------------------------------------------------------

  private assertTenantAccess(ctx: SecurityContext, targetCompanyId: string): void {
    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*')) {
      return;
    }
    if (!ctx.activeCompanyId || ctx.activeCompanyId !== targetCompanyId) {
      throw AppError.forbidden(
        `Cross-tenant access violation: Caller active company '${ctx.activeCompanyId}' cannot access numbering series of company '${targetCompanyId}'`
      );
    }
  }
}
