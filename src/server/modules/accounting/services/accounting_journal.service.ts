import pg from 'pg';
import { AccountingJournalRepository } from '../repositories/accounting_journal.repository.js';
import { ChartOfAccountsRepository } from '../repositories/chart_of_accounts.repository.js';
import { CompanyRepository } from '../../org/repositories/company.repository.js';
import { BranchRepository } from '../../org/repositories/branch.repository.js';
import { PartnerRepository } from '../../master/repositories/partner.repository.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { withTransaction } from '../../../db/connection.js';
import {
  AccountingJournal,
  SecurityContext,
  JournalStatus,
} from '../../../../shared/types/index.js';
import {
  CreateJournalInput,
  createJournalSchema,
} from '../../../../shared/schemas/accounting.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class AccountingJournalService {
  constructor(
    private journalRepo: AccountingJournalRepository = new AccountingJournalRepository(),
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository(),
    private companyRepo: CompanyRepository = new CompanyRepository(),
    private branchRepo: BranchRepository = new BranchRepository(),
    private partnerRepo: PartnerRepository = new PartnerRepository(),
    private numberingService: NumberingService = new NumberingService(),
    private stateMachine: StateMachineEngine = new StateMachineEngine(),
    private auditService: AuditService = new AuditService()
  ) {}

  private assertCompanyAccess(ctx: SecurityContext, targetCompanyId: string): void {
    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*')) {
      return;
    }
    if (!ctx.activeCompanyId || ctx.activeCompanyId !== targetCompanyId) {
      throw AppError.forbidden(
        `Cross-tenant access violation: Caller active company '${ctx.activeCompanyId}' cannot access journals in company '${targetCompanyId}'`
      );
    }
  }

  async createJournal(rawInput: unknown, ctx: SecurityContext): Promise<AccountingJournal> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required to create a journal');
    }
    this.assertCompanyAccess(ctx, companyId);

    const parseResult = createJournalSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid accounting journal creation payload', parseResult.error.format());
    }
    const input: CreateJournalInput = parseResult.data;

    return withTransaction(async (txClient) => {
      // 1. Verify company exists
      const company = await this.companyRepo.findById(companyId);
      if (!company) {
        throw AppError.notFound(`Company with ID '${companyId}' does not exist`);
      }

      // 2. Verify branch if specified
      if (input.branchId) {
        const branch = await this.branchRepo.findById(input.branchId);
        if (!branch || branch.companyId !== companyId) {
          throw AppError.badRequest(`Branch '${input.branchId}' does not exist in active company`);
        }
      }

      // 3. Verify accounts and partners for all lines
      let totalDebit = 0;
      let totalCredit = 0;
      let totalBaseDebit = 0;
      let totalBaseCredit = 0;

      const processedLines = [];
      let lineNum = 1;

      for (const line of input.lines) {
        const account = await this.coaRepo.findById(line.accountId, txClient);
        if (!account || account.companyId !== companyId) {
          throw AppError.badRequest(`Account '${line.accountId}' not found in active company`);
        }
        if (!account.isActive) {
          throw AppError.badRequest(`Account '${account.accountCode} - ${account.accountName}' is inactive`);
        }
        if (account.isGroup) {
          throw AppError.badRequest(
            `Account '${account.accountCode} - ${account.accountName}' is a group account and cannot accept direct journal postings`
          );
        }

        if (line.partnerId) {
          const partner = await this.partnerRepo.findById(line.partnerId);
          if (!partner || partner.companyId !== companyId) {
            throw AppError.badRequest(`Business partner '${line.partnerId}' not found in active company`);
          }
        }

        const exchangeRate = line.exchangeRate || 1.0;
        const debit = line.debit || 0;
        const credit = line.credit || 0;
        const baseDebit = Math.round((debit * exchangeRate) * 10000) / 10000;
        const baseCredit = Math.round((credit * exchangeRate) * 10000) / 10000;

        totalDebit += debit;
        totalCredit += credit;
        totalBaseDebit += baseDebit;
        totalBaseCredit += baseCredit;

        processedLines.push({
          lineNumber: lineNum++,
          accountId: line.accountId,
          partnerId: line.partnerId || null,
          debit,
          credit,
          currencyCode: line.currencyCode || input.currencyCode || company.baseCurrency || 'USD',
          exchangeRate,
          baseDebit,
          baseCredit,
          description: line.description || null,
        });
      }

      // Round sums to 4 decimal places
      totalDebit = Math.round(totalDebit * 10000) / 10000;
      totalCredit = Math.round(totalCredit * 10000) / 10000;
      totalBaseDebit = Math.round(totalBaseDebit * 10000) / 10000;
      totalBaseCredit = Math.round(totalBaseCredit * 10000) / 10000;

      // Check balance invariant
      if (Math.abs(totalDebit - totalCredit) > 0.0001 || Math.abs(totalBaseDebit - totalBaseCredit) > 0.0001) {
        throw AppError.invariantViolation(
          `Journal entry is out of balance: Total Debit (${totalDebit}) must equal Total Credit (${totalCredit})`
        );
      }

      // 4. Generate Journal Number
      let journalNumber = '';
      try {
        const numResult = await this.numberingService.generateNextNumber(
          {
            companyId,
            branchId: input.branchId || null,
            documentType: 'JOURNAL',
          },
          ctx,
          txClient
        );
        journalNumber = numResult.formattedNumber;
      } catch {
        // Fallback series if not configured
        const count = await txClient.query(
          `SELECT COUNT(*)::int as count FROM accounting_journals WHERE company_id = $1`,
          [companyId]
        );
        const seq = (count.rows[0]?.count || 0) + 1;
        journalNumber = `JV-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
      }

      // 5. Create Journal
      const created = await this.journalRepo.create(
        {
          companyId,
          branchId: input.branchId || null,
          journalNumber,
          postingDate: input.postingDate || new Date().toISOString().split('T')[0],
          sourceDocumentType: input.sourceDocumentType || 'MANUAL_JOURNAL',
          sourceDocumentId: input.sourceDocumentId || null,
          description: input.description || null,
          status: 'DRAFT',
          totalDebit,
          totalCredit,
          currencyCode: input.currencyCode || company.baseCurrency || 'USD',
          createdBy: ctx.userId,
          lines: processedLines,
        },
        txClient
      );

      await this.auditService.logCreate(
        'accounting',
        'AccountingJournal',
        created.id,
        { journalNumber: created.journalNumber, totalDebit, totalCredit },
        ctx,
        txClient
      );

      return created;
    });
  }

  async getJournalById(id: string, ctx: SecurityContext): Promise<AccountingJournal> {
    const journal = await this.journalRepo.findById(id);
    if (!journal) {
      throw AppError.notFound(`Accounting journal with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, journal.companyId);
    return journal;
  }

  async listJournals(
    companyId: string,
    ctx: SecurityContext,
    filters?: { status?: JournalStatus; sourceDocumentType?: string; fromDate?: string; toDate?: string; search?: string }
  ): Promise<AccountingJournal[]> {
    this.assertCompanyAccess(ctx, companyId);
    return this.journalRepo.list(companyId, filters);
  }

  async submitJournal(id: string, ctx: SecurityContext): Promise<AccountingJournal> {
    return withTransaction(async (txClient) => {
      const journal = await this.journalRepo.findForUpdate(id, txClient);
      if (!journal) {
        throw AppError.notFound(`Accounting journal with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, journal.companyId);

      this.stateMachine.validateTransition({
        documentType: 'ACCOUNTING_JOURNAL',
        currentState: journal.status,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          companyId: journal.companyId,
          branchId: journal.branchId,
          creatorId: journal.createdBy || undefined,
          documentId: journal.id,
        },
      });

      const updated = await this.journalRepo.updateStatus(id, 'SUBMITTED', {}, txClient);
      if (!updated) throw AppError.notFound(`Journal '${id}' not found`);

      await this.auditService.logUpdate(
        'accounting',
        'AccountingJournal',
        journal.id,
        { status: journal.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted journal for approval',
        txClient
      );

      return updated;
    });
  }

  async approveJournal(id: string, ctx: SecurityContext): Promise<AccountingJournal> {
    return withTransaction(async (txClient) => {
      const journal = await this.journalRepo.findForUpdate(id, txClient);
      if (!journal) {
        throw AppError.notFound(`Accounting journal with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, journal.companyId);

      // Enforce Segregation of Duties
      this.stateMachine.validateTransition({
        documentType: 'ACCOUNTING_JOURNAL',
        currentState: journal.status,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          companyId: journal.companyId,
          branchId: journal.branchId,
          creatorId: journal.createdBy || undefined,
          documentId: journal.id,
        },
      });

      const updated = await this.journalRepo.updateStatus(
        id,
        'APPROVED',
        {
          approvedBy: ctx.userId,
          approvedAt: new Date().toISOString(),
        },
        txClient
      );
      if (!updated) throw AppError.notFound(`Journal '${id}' not found`);

      await this.auditService.logApprove(
        'accounting',
        'AccountingJournal',
        journal.id,
        ctx,
        `Approved journal ${journal.journalNumber}`,
        txClient
      );

      return updated;
    });
  }

  async postJournal(id: string, ctx: SecurityContext): Promise<AccountingJournal> {
    return withTransaction(async (txClient) => {
      const journal = await this.journalRepo.findForUpdate(id, txClient);
      if (!journal) {
        throw AppError.notFound(`Accounting journal with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, journal.companyId);

      // Enforce Segregation of Duties
      this.stateMachine.validateTransition({
        documentType: 'ACCOUNTING_JOURNAL',
        currentState: journal.status,
        targetState: 'POSTED',
        ctx,
        documentContext: {
          companyId: journal.companyId,
          branchId: journal.branchId,
          creatorId: journal.createdBy || undefined,
          documentId: journal.id,
        },
      });

      // Re-verify double-entry balance before final immutable commit
      if (Math.abs(journal.totalDebit - journal.totalCredit) > 0.0001) {
        throw AppError.invariantViolation(
          `Cannot post unbalanced journal: Total Debit (${journal.totalDebit}) != Total Credit (${journal.totalCredit})`
        );
      }

      const updated = await this.journalRepo.updateStatus(
        id,
        'POSTED',
        {
          postedBy: ctx.userId,
          postedAt: new Date().toISOString(),
        },
        txClient
      );
      if (!updated) throw AppError.notFound(`Journal '${id}' not found`);

      await this.auditService.logPost(
        'accounting',
        'AccountingJournal',
        journal.id,
        ctx,
        `Posted journal ${journal.journalNumber} to GL`,
        txClient
      );

      return updated;
    });
  }

  async reverseJournal(id: string, ctx: SecurityContext): Promise<{ originalJournal: AccountingJournal; reversalJournal: AccountingJournal }> {
    return withTransaction(async (txClient) => {
      const journal = await this.journalRepo.findForUpdate(id, txClient);
      if (!journal) {
        throw AppError.notFound(`Accounting journal with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, journal.companyId);

      this.stateMachine.validateTransition({
        documentType: 'ACCOUNTING_JOURNAL',
        currentState: journal.status,
        targetState: 'REVERSED',
        ctx,
        documentContext: {
          companyId: journal.companyId,
          branchId: journal.branchId,
          creatorId: journal.createdBy || undefined,
          documentId: journal.id,
        },
      });

      // Construct Reversal Lines (Swap Debits and Credits)
      const lines = await this.journalRepo.getLines(id, txClient);
      const reversalLines = lines.map((l) => ({
        lineNumber: l.lineNumber,
        accountId: l.accountId,
        partnerId: l.partnerId || null,
        debit: l.credit, // SWAP
        credit: l.debit, // SWAP
        currencyCode: l.currencyCode,
        exchangeRate: l.exchangeRate,
        baseDebit: l.baseCredit, // SWAP
        baseCredit: l.baseDebit, // SWAP
        description: `Reversal of ${journal.journalNumber} line ${l.lineNumber}: ${l.description || ''}`,
      }));

      // Generate Reversal Journal Number
      let revNumber = '';
      try {
        const numResult = await this.numberingService.generateNextNumber(
          {
            companyId: journal.companyId,
            branchId: journal.branchId || null,
            documentType: 'JOURNAL',
          },
          ctx,
          txClient
        );
        revNumber = numResult.formattedNumber;
      } catch {
        revNumber = `REV-${journal.journalNumber}`;
      }

      const reversalJournal = await this.journalRepo.create(
        {
          companyId: journal.companyId,
          branchId: journal.branchId || null,
          journalNumber: revNumber,
          postingDate: new Date().toISOString().split('T')[0],
          sourceDocumentType: 'JOURNAL_REVERSAL',
          sourceDocumentId: journal.id,
          description: `Compensating reversal for journal ${journal.journalNumber}`,
          status: 'POSTED',
          totalDebit: journal.totalCredit,
          totalCredit: journal.totalDebit,
          currencyCode: journal.currencyCode,
          createdBy: ctx.userId,
          approvedBy: ctx.userId,
          approvedAt: new Date().toISOString(),
          postedBy: ctx.userId,
          postedAt: new Date().toISOString(),
          reversalJournalId: journal.id,
          lines: reversalLines,
        },
        txClient
      );

      const originalUpdated = await this.journalRepo.updateStatus(
        id,
        'REVERSED',
        { reversalJournalId: reversalJournal.id },
        txClient
      );

      await this.auditService.logReverse(
        'accounting',
        'AccountingJournal',
        journal.id,
        ctx,
        `Reversed journal ${journal.journalNumber} with reversal journal ${revNumber}`,
        txClient
      );

      return {
        originalJournal: originalUpdated!,
        reversalJournal,
      };
    });
  }
}
