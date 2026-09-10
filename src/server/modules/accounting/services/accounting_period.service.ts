import pg from 'pg';
import { AccountingPeriodRepository } from '../repositories/accounting_period.repository.js';
import { ChartOfAccountsRepository } from '../repositories/chart_of_accounts.repository.js';
import { AccountingJournalRepository } from '../repositories/accounting_journal.repository.js';
import { TrialBalanceService } from './trial_balance.service.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { withTransaction, getPool } from '../../../db/connection.js';
import {
  FiscalYear,
  AccountingPeriod,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  CreateFiscalYearSchema,
  CreateAccountingPeriodSchema,
  GeneratePeriodsSchema,
  ClosePeriodSchema,
  ReopenPeriodSchema,
  YearEndClosingSchema,
} from '../../../../shared/schemas/accounting.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class AccountingPeriodService {
  constructor(
    private periodRepo: AccountingPeriodRepository = new AccountingPeriodRepository(),
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository(),
    private journalRepo: AccountingJournalRepository = new AccountingJournalRepository(),
    private trialBalanceService: TrialBalanceService = new TrialBalanceService(),
    private numberingService: NumberingService = new NumberingService(),
    private auditService: AuditService = new AuditService()
  ) {}

  private assertCompanyAccess(ctx: SecurityContext, targetCompanyId: string): void {
    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*')) {
      return;
    }
    if (!ctx.activeCompanyId || ctx.activeCompanyId !== targetCompanyId) {
      throw AppError.forbidden(
        `Cross-tenant access violation: Active company '${ctx.activeCompanyId}' cannot access accounting periods in company '${targetCompanyId}'`
      );
    }
  }

  async createFiscalYear(rawInput: unknown, ctx: SecurityContext): Promise<FiscalYear> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required to create a fiscal year');
    }
    this.assertCompanyAccess(ctx, companyId);

    const parseResult = CreateFiscalYearSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid fiscal year input', parseResult.error.format());
    }
    const input = parseResult.data;

    return withTransaction(async (txClient) => {
      const existing = await this.periodRepo.findFiscalYearByName(companyId, input.name, txClient);
      if (existing) {
        throw AppError.conflict(`Fiscal year '${input.name}' already exists in this company`);
      }

      const fy = await this.periodRepo.createFiscalYear(
        {
          companyId,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
        },
        txClient
      );

      await this.auditService.logCreate(
        'accounting',
        'FiscalYear',
        fy.id,
        { name: fy.name, startDate: fy.startDate, endDate: fy.endDate },
        ctx,
        txClient
      );

      return fy;
    });
  }

  async getFiscalYearById(id: string, ctx: SecurityContext): Promise<FiscalYear> {
    const fy = await this.periodRepo.findFiscalYearById(id);
    if (!fy) {
      throw AppError.notFound(`Fiscal year with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, fy.companyId);
    return fy;
  }

  async listFiscalYears(companyId: string, ctx: SecurityContext): Promise<FiscalYear[]> {
    this.assertCompanyAccess(ctx, companyId);
    return this.periodRepo.listFiscalYears(companyId);
  }

  async createPeriod(rawInput: unknown, ctx: SecurityContext): Promise<AccountingPeriod> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required to create an accounting period');
    }
    this.assertCompanyAccess(ctx, companyId);

    const parseResult = CreateAccountingPeriodSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid accounting period input', parseResult.error.format());
    }
    const input = parseResult.data;

    return withTransaction(async (txClient) => {
      const existing = await this.periodRepo.findPeriodByName(companyId, input.periodName, txClient);
      if (existing) {
        throw AppError.conflict(`Accounting period '${input.periodName}' already exists in this company`);
      }

      if (input.fiscalYearId) {
        const fy = await this.periodRepo.findFiscalYearById(input.fiscalYearId, txClient);
        if (!fy || fy.companyId !== companyId) {
          throw AppError.badRequest(`Fiscal year '${input.fiscalYearId}' not found in active company`);
        }
      }

      const period = await this.periodRepo.createPeriod(
        {
          companyId,
          fiscalYearId: input.fiscalYearId || null,
          periodName: input.periodName,
          periodNumber: input.periodNumber,
          startDate: input.startDate,
          endDate: input.endDate,
          status: 'OPEN',
          closingNotes: input.closingNotes || null,
        },
        txClient
      );

      await this.auditService.logCreate(
        'accounting',
        'AccountingPeriod',
        period.id,
        { periodName: period.periodName, startDate: period.startDate, endDate: period.endDate },
        ctx,
        txClient
      );

      return period;
    });
  }

  async generateMonthlyPeriods(rawInput: unknown, ctx: SecurityContext): Promise<AccountingPeriod[]> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required to generate periods');
    }
    this.assertCompanyAccess(ctx, companyId);

    const parseResult = GeneratePeriodsSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid period generation input', parseResult.error.format());
    }
    const { fiscalYearId, year } = parseResult.data;

    return withTransaction(async (txClient) => {
      if (fiscalYearId) {
        const fy = await this.periodRepo.findFiscalYearById(fiscalYearId, txClient);
        if (!fy || fy.companyId !== companyId) {
          throw AppError.badRequest(`Fiscal year '${fiscalYearId}' not found in active company`);
        }
      }

      const createdPeriods: AccountingPeriod[] = [];
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];

      for (let month = 1; month <= 12; month++) {
        const mStr = String(month).padStart(2, '0');
        const periodName = `${year}-${mStr} (${monthNames[month - 1]})`;
        const startDate = `${year}-${mStr}-01`;
        // Find last day of month
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;

        const existing = await this.periodRepo.findPeriodByName(companyId, periodName, txClient);
        if (existing) {
          createdPeriods.push(existing);
          continue;
        }

        const period = await this.periodRepo.createPeriod(
          {
            companyId,
            fiscalYearId: fiscalYearId || null,
            periodName,
            periodNumber: month,
            startDate,
            endDate,
            status: 'OPEN',
          },
          txClient
        );
        createdPeriods.push(period);
      }

      await this.auditService.logCreate(
        'accounting',
        'AccountingPeriodBatch',
        fiscalYearId || companyId,
        { year, count: createdPeriods.length },
        ctx,
        txClient
      );

      return createdPeriods;
    });
  }

  async listPeriods(
    companyId: string,
    ctx: SecurityContext,
    filters: { fiscalYearId?: string; status?: 'OPEN' | 'CLOSED' } = {}
  ): Promise<AccountingPeriod[]> {
    this.assertCompanyAccess(ctx, companyId);
    return this.periodRepo.listPeriods(companyId, filters);
  }

  async closePeriod(periodId: string, rawInput: unknown, ctx: SecurityContext): Promise<AccountingPeriod> {
    const parseResult = ClosePeriodSchema.safeParse(rawInput || {});
    if (!parseResult.success) {
      throw AppError.validation('Invalid period closing input', parseResult.error.format());
    }
    const input = parseResult.data;

    return withTransaction(async (txClient) => {
      // 1. Lock period row FOR UPDATE
      const periodRes = await txClient.query(
        `SELECT * FROM accounting_periods WHERE id = $1 FOR UPDATE;`,
        [periodId]
      );
      if (periodRes.rows.length === 0) {
        throw AppError.notFound(`Accounting period with ID '${periodId}' not found`);
      }
      const period = periodRes.rows[0];
      this.assertCompanyAccess(ctx, period.company_id);

      if (period.status === 'CLOSED') {
        throw AppError.badRequest(`Accounting period '${period.period_name}' is already closed`);
      }

      const sDate = period.start_date instanceof Date ? period.start_date.toISOString().split('T')[0] : period.start_date;
      const eDate = period.end_date instanceof Date ? period.end_date.toISOString().split('T')[0] : period.end_date;

      // 2. Invariant Check: Verify Trial Balance is balanced for this period
      const tb = await this.trialBalanceService.getTrialBalance(
        {
          startDate: sDate,
          asOfDate: eDate,
        },
        ctx,
        txClient
      );

      if (!tb.isBalanced) {
        throw AppError.invariantViolation(
          `Cannot close accounting period '${period.period_name}': General ledger is out of balance (Debits: ${tb.totalDebitBalance}, Credits: ${tb.totalCreditBalance})`
        );
      }

      // 3. Invariant Check: No pending unposted journals in this period
      const pendingRes = await txClient.query(
        `SELECT COUNT(*)::int as pending_count 
         FROM accounting_journals 
         WHERE company_id = $1 
           AND posting_date >= $2 
           AND posting_date <= $3 
           AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED');`,
        [period.company_id, sDate, eDate]
      );
      const pendingCount = pendingRes.rows[0]?.pending_count || 0;
      if (pendingCount > 0) {
        throw AppError.badRequest(
          `Cannot close accounting period '${period.period_name}': There are ${pendingCount} pending unposted journal entries in this period`
        );
      }

      // 4. Update status to CLOSED
      const now = new Date().toISOString();
      const updated = await this.periodRepo.updatePeriodStatus(
        periodId,
        'CLOSED',
        {
          closedBy: ctx.userId,
          closedAt: now,
          closingNotes: input.closingNotes || null,
        },
        txClient
      );

      await this.auditService.logUpdate(
        'accounting',
        'AccountingPeriod',
        periodId,
        { status: 'OPEN' },
        { status: 'CLOSED', closedAt: now, closedBy: ctx.userId, notes: input.closingNotes },
        ctx,
        `Closed accounting period '${period.period_name}' (${sDate} to ${eDate})`,
        txClient
      );

      return updated!;
    });
  }

  async reopenPeriod(periodId: string, rawInput: unknown, ctx: SecurityContext): Promise<AccountingPeriod> {
    const parseResult = ReopenPeriodSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid period reopening input', parseResult.error.format());
    }
    const input = parseResult.data;

    return withTransaction(async (txClient) => {
      // Check authorization
      const hasPerm =
        ctx.isSuperadmin ||
        ctx.effectivePermissions.includes('*') ||
        ctx.effectivePermissions.includes('accounting.period.reopen') ||
        ctx.effectivePermissions.includes('accounting.period.manage');

      if (!hasPerm) {
        throw AppError.forbidden('User lacks authorization to reopen closed accounting periods');
      }

      const periodRes = await txClient.query(
        `SELECT * FROM accounting_periods WHERE id = $1 FOR UPDATE;`,
        [periodId]
      );
      if (periodRes.rows.length === 0) {
        throw AppError.notFound(`Accounting period with ID '${periodId}' not found`);
      }
      const period = periodRes.rows[0];
      this.assertCompanyAccess(ctx, period.company_id);

      if (period.status === 'OPEN') {
        throw AppError.badRequest(`Accounting period '${period.period_name}' is already open`);
      }

      const now = new Date().toISOString();
      const updated = await this.periodRepo.updatePeriodStatus(
        periodId,
        'OPEN',
        {
          reopenedBy: ctx.userId,
          reopenedAt: now,
        },
        txClient
      );

      await this.auditService.logUpdate(
        'accounting',
        'AccountingPeriod',
        periodId,
        { status: 'CLOSED' },
        { status: 'OPEN', reopenedAt: now, reopenedBy: ctx.userId, reason: input.reason },
        ctx,
        `Reopened accounting period '${period.period_name}'. Reason: ${input.reason}`,
        txClient
      );

      return updated!;
    });
  }

  /**
   * Year-End Closing Procedure:
   * 1. Validates all periods in the fiscal year are closed.
   * 2. Calculates net income from Revenue and Expense accounts.
   * 3. Creates and posts a balanced Year-End Closing Journal to Retained Earnings.
   * 4. Marks the fiscal year as CLOSED.
   */
  async performYearEndClosing(rawInput: unknown, ctx: SecurityContext): Promise<{ fiscalYear: FiscalYear; closingJournal?: any }> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required for year-end closing');
    }
    this.assertCompanyAccess(ctx, companyId);

    const parseResult = YearEndClosingSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid year-end closing input', parseResult.error.format());
    }
    const input = parseResult.data;

    return withTransaction(async (txClient) => {
      // 1. Lock Fiscal Year
      const fyRes = await txClient.query(
        `SELECT * FROM fiscal_years WHERE id = $1 FOR UPDATE;`,
        [input.fiscalYearId]
      );
      if (fyRes.rows.length === 0) {
        throw AppError.notFound(`Fiscal year with ID '${input.fiscalYearId}' not found`);
      }
      const fy = fyRes.rows[0];
      if (fy.company_id !== companyId) {
        throw AppError.badRequest(`Fiscal year '${input.fiscalYearId}' not found in active company`);
      }
      if (fy.status === 'CLOSED') {
        throw AppError.badRequest(`Fiscal year '${fy.name}' is already closed`);
      }

      const fyStartDate = fy.start_date instanceof Date ? fy.start_date.toISOString().split('T')[0] : fy.start_date;
      const fyEndDate = fy.end_date instanceof Date ? fy.end_date.toISOString().split('T')[0] : fy.end_date;

      // 2. Check all periods in the fiscal year are CLOSED
      const openPeriods = await txClient.query(
        `SELECT period_name FROM accounting_periods 
         WHERE company_id = $1 AND fiscal_year_id = $2 AND status = 'OPEN';`,
        [companyId, input.fiscalYearId]
      );
      if (openPeriods.rows.length > 0) {
        const names = openPeriods.rows.map((p) => p.period_name).join(', ');
        throw AppError.badRequest(
          `Cannot perform year-end closing: The following accounting periods are still OPEN: ${names}`
        );
      }

      // 3. Identify Retained Earnings Account
      let retainedEarningsAccId = input.retainedEarningsAccountId;
      if (!retainedEarningsAccId) {
        // Look up by standard code '3100' or '3000' or name 'Retained Earnings'
        const accRes = await txClient.query(
          `SELECT id FROM chart_of_accounts 
           WHERE company_id = $1 
             AND account_type = 'EQUITY' 
             AND (account_code IN ('3100', '3000', '3010') OR account_name ILIKE '%retained%')
           ORDER BY account_code ASC
           LIMIT 1;`,
          [companyId]
        );
        if (accRes.rows.length > 0) {
          retainedEarningsAccId = accRes.rows[0].id;
        } else {
          // Fallback to any active non-group EQUITY account
          const fallbackAcc = await txClient.query(
            `SELECT id FROM chart_of_accounts 
             WHERE company_id = $1 AND account_type = 'EQUITY' AND is_group = FALSE AND is_active = TRUE
             ORDER BY account_code ASC
             LIMIT 1;`,
            [companyId]
          );
          if (fallbackAcc.rows.length === 0) {
            throw AppError.badRequest(
              'No active Equity or Retained Earnings account found to post year-end profit/loss'
            );
          }
          retainedEarningsAccId = fallbackAcc.rows[0].id;
        }
      }

      if (!retainedEarningsAccId) {
        throw AppError.badRequest('No active Equity or Retained Earnings account found to post year-end profit/loss');
      }

      const finalEquityAccountId: string = retainedEarningsAccId;

      // 4. Calculate Net Balances for all Revenue and Expense accounts for this FY
      const pnlAccountsRes = await txClient.query(
        `SELECT 
           coa.id as account_id,
           coa.account_code,
           coa.account_name,
           coa.account_type,
           COALESCE(SUM(ajl.base_debit), 0) as total_debit,
           COALESCE(SUM(ajl.base_credit), 0) as total_credit
         FROM chart_of_accounts coa
         JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
         JOIN accounting_journals aj ON ajl.journal_id = aj.id
         WHERE aj.company_id = $1
           AND aj.status = 'POSTED'
           AND aj.posting_date >= $2
           AND aj.posting_date <= $3
           AND coa.account_type IN ('REVENUE', 'EXPENSE')
         GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type
         HAVING COALESCE(SUM(ajl.base_debit), 0) != COALESCE(SUM(ajl.base_credit), 0);`,
        [companyId, fyStartDate, fyEndDate]
      );

      let closingJournal = null;

      if (pnlAccountsRes.rows.length > 0) {
        // Build closing journal lines to clear Revenue and Expense accounts
        const lines: Array<{
          lineNumber: number;
          accountId: string;
          debit: number;
          credit: number;
          currencyCode: string;
          exchangeRate: number;
          baseDebit: number;
          baseCredit: number;
          description: string;
        }> = [];

        let lineNum = 1;
        let totalClosingDebit = 0;
        let totalClosingCredit = 0;

        for (const row of pnlAccountsRes.rows) {
          const deb = Math.round(parseFloat(row.total_debit || '0') * 10000) / 10000;
          const cred = Math.round(parseFloat(row.total_credit || '0') * 10000) / 10000;

          if (row.account_type === 'REVENUE') {
            // Normal credit balance: net = cred - deb
            const netCredit = Math.round((cred - deb) * 10000) / 10000;
            if (netCredit > 0) {
              // Debit Revenue to clear
              lines.push({
                lineNumber: lineNum++,
                accountId: row.account_id,
                debit: netCredit,
                credit: 0,
                currencyCode: 'USD',
                exchangeRate: 1.0,
                baseDebit: netCredit,
                baseCredit: 0,
                description: `Year-end revenue closing: ${row.account_code} - ${row.account_name}`,
              });
              totalClosingDebit = Math.round((totalClosingDebit + netCredit) * 10000) / 10000;
            } else if (netCredit < 0) {
              const netDebit = Math.abs(netCredit);
              lines.push({
                lineNumber: lineNum++,
                accountId: row.account_id,
                debit: 0,
                credit: netDebit,
                currencyCode: 'USD',
                exchangeRate: 1.0,
                baseDebit: 0,
                baseCredit: netDebit,
                description: `Year-end revenue closing: ${row.account_code} - ${row.account_name}`,
              });
              totalClosingCredit = Math.round((totalClosingCredit + netDebit) * 10000) / 10000;
            }
          } else if (row.account_type === 'EXPENSE') {
            // Normal debit balance: net = deb - cred
            const netDebit = Math.round((deb - cred) * 10000) / 10000;
            if (netDebit > 0) {
              // Credit Expense to clear
              lines.push({
                lineNumber: lineNum++,
                accountId: row.account_id,
                debit: 0,
                credit: netDebit,
                currencyCode: 'USD',
                exchangeRate: 1.0,
                baseDebit: 0,
                baseCredit: netDebit,
                description: `Year-end expense closing: ${row.account_code} - ${row.account_name}`,
              });
              totalClosingCredit = Math.round((totalClosingCredit + netDebit) * 10000) / 10000;
            } else if (netDebit < 0) {
              const netCredit = Math.abs(netDebit);
              lines.push({
                lineNumber: lineNum++,
                accountId: row.account_id,
                debit: netCredit,
                credit: 0,
                currencyCode: 'USD',
                exchangeRate: 1.0,
                baseDebit: netCredit,
                baseCredit: 0,
                description: `Year-end expense closing: ${row.account_code} - ${row.account_name}`,
              });
              totalClosingDebit = Math.round((totalClosingDebit + netCredit) * 10000) / 10000;
            }
          }
        }

        // Balance to Retained Earnings
        const retainedEarningsDiff = Math.round((totalClosingDebit - totalClosingCredit) * 10000) / 10000;
        if (retainedEarningsDiff > 0) {
          // Credit Retained Earnings (Profit)
          lines.push({
            lineNumber: lineNum++,
            accountId: finalEquityAccountId,
            debit: 0,
            credit: retainedEarningsDiff,
            currencyCode: 'USD',
            exchangeRate: 1.0,
            baseDebit: 0,
            baseCredit: retainedEarningsDiff,
            description: `Year-end net income transfer to Retained Earnings (${fy.name})`,
          });
          totalClosingCredit = Math.round((totalClosingCredit + retainedEarningsDiff) * 10000) / 10000;
        } else if (retainedEarningsDiff < 0) {
          // Debit Retained Earnings (Loss)
          const absDiff = Math.abs(retainedEarningsDiff);
          lines.push({
            lineNumber: lineNum++,
            accountId: finalEquityAccountId,
            debit: absDiff,
            credit: 0,
            currencyCode: 'USD',
            exchangeRate: 1.0,
            baseDebit: absDiff,
            baseCredit: 0,
            description: `Year-end net loss transfer to Retained Earnings (${fy.name})`,
          });
          totalClosingDebit = Math.round((totalClosingDebit + absDiff) * 10000) / 10000;
        }

        // Generate Journal Number
        let journalNumber = `YE-${fy.name.replace(/\s+/g, '-')}`;
        try {
          const numRes = await this.numberingService.generateNextNumber(
            { companyId, branchId: null, documentType: 'JOURNAL' },
            ctx,
            txClient
          );
          journalNumber = numRes.formattedNumber;
        } catch {
          // fallback ok
        }

        // Post Year-End Closing Journal (Use FY end date or provided posting date)
        const postDate = input.postingDate || fyEndDate;

        // Note: Year-end closing journal is explicitly allowed even if period is closed as it's the official closing entry
        const count = await txClient.query(`SELECT COUNT(*)::int as c FROM accounting_journals WHERE company_id = $1`, [companyId]);
        const seq = (count.rows[0]?.c || 0) + 1;
        if (!journalNumber.startsWith('JV-')) {
          journalNumber = `JV-CLOSE-${fy.name}-${String(seq).padStart(4, '0')}`;
        }

        closingJournal = await this.journalRepo.create(
          {
            companyId,
            branchId: null,
            journalNumber,
            postingDate: postDate,
            sourceDocumentType: 'YEAR_END_CLOSING',
            sourceDocumentId: fy.id,
            description: input.notes || `Year-End Closing Entry for ${fy.name}`,
            status: 'POSTED',
            totalDebit: totalClosingDebit,
            totalCredit: totalClosingCredit,
            currencyCode: 'USD',
            createdBy: ctx.userId,
            approvedBy: ctx.userId,
            approvedAt: new Date().toISOString(),
            postedBy: ctx.userId,
            postedAt: new Date().toISOString(),
            lines,
          },
          txClient
        );
      }

      // 5. Update Fiscal Year Status to CLOSED
      const now = new Date().toISOString();
      const updatedFy = await this.periodRepo.updateFiscalYearStatus(
        fy.id,
        'CLOSED',
        {
          closedBy: ctx.userId,
          closedAt: now,
        },
        txClient
      );

      await this.auditService.logUpdate(
        'accounting',
        'FiscalYear',
        fy.id,
        { status: 'OPEN' },
        { status: 'CLOSED', closedAt: now, closedBy: ctx.userId },
        ctx,
        `Executed Year-End Closing for Fiscal Year '${fy.name}'`,
        txClient
      );

      return {
        fiscalYear: updatedFy!,
        closingJournal,
      };
    });
  }
}
