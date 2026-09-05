import pg from 'pg';
import { CustomerPaymentRepository } from '../repositories/customer_payment.repository.js';
import { CustomerReceivableRepository } from '../repositories/customer_receivable.repository.js';
import { PartnerRepository } from '../../master/repositories/partner.repository.js';
import { ChartOfAccountsRepository } from '../../accounting/repositories/chart_of_accounts.repository.js';
import { AccountingJournalRepository } from '../../accounting/repositories/accounting_journal.repository.js';
import { CompanyRepository } from '../../org/repositories/company.repository.js';
import { BranchRepository } from '../../org/repositories/branch.repository.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { withTransaction } from '../../../db/connection.js';
import {
  CustomerPayment,
  CustomerPaymentStatus,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  CreateCustomerPaymentInput,
  createCustomerPaymentSchema,
} from '../../../../shared/schemas/customer_payment.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class CustomerPaymentService {
  constructor(
    private paymentRepo: CustomerPaymentRepository = new CustomerPaymentRepository(),
    private receivableRepo: CustomerReceivableRepository = new CustomerReceivableRepository(),
    private partnerRepo: PartnerRepository = new PartnerRepository(),
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository(),
    private journalRepo: AccountingJournalRepository = new AccountingJournalRepository(),
    private companyRepo: CompanyRepository = new CompanyRepository(),
    private branchRepo: BranchRepository = new BranchRepository(),
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
        `Cross-tenant access violation: Caller active company '${ctx.activeCompanyId}' cannot access payment resources in company '${targetCompanyId}'`
      );
    }
  }

  async createPayment(rawInput: unknown, ctx: SecurityContext): Promise<CustomerPayment> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required to create a customer payment');
    }
    this.assertCompanyAccess(ctx, companyId);

    const parseResult = createCustomerPaymentSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid customer payment creation payload', parseResult.error.format());
    }
    const input: CreateCustomerPaymentInput = parseResult.data;

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

      // 3. Verify customer exists, is customer, and is active
      const customer = await this.partnerRepo.findById(input.customerId);
      if (!customer || customer.companyId !== companyId) {
        throw AppError.badRequest(`Customer '${input.customerId}' not found in active company`);
      }
      if (!customer.isCustomer) {
        throw AppError.badRequest(`Business partner '${customer.legalName}' is not registered as a customer`);
      }
      if (!customer.isActive) {
        throw AppError.badRequest(`Customer '${customer.legalName}' is inactive`);
      }

      // 4. Verify Deposit Account (Cash/Bank)
      const depositAccount = await this.coaRepo.findById(input.depositAccountId, txClient);
      if (!depositAccount || depositAccount.companyId !== companyId) {
        throw AppError.badRequest(`Deposit account '${input.depositAccountId}' not found in active company`);
      }
      if (!depositAccount.isActive) {
        throw AppError.badRequest(`Deposit account '${depositAccount.accountCode}' is inactive`);
      }
      if (depositAccount.isGroup) {
        throw AppError.badRequest(`Deposit account '${depositAccount.accountCode}' is a group account`);
      }

      // 5. Verify AR Account if provided
      if (input.arAccountId) {
        const arAcc = await this.coaRepo.findById(input.arAccountId, txClient);
        if (!arAcc || arAcc.companyId !== companyId) {
          throw AppError.badRequest(`AR account '${input.arAccountId}' not found in active company`);
        }
        if (!arAcc.isActive) {
          throw AppError.badRequest(`AR account '${arAcc.accountCode}' is inactive`);
        }
        if (arAcc.isGroup) {
          throw AppError.badRequest(`AR account '${arAcc.accountCode}' is a group account`);
        }
      }

      // 6. Validate Allocations (if provided)
      let totalAllocated = 0;
      if (input.allocations && input.allocations.length > 0) {
        for (const alloc of input.allocations) {
          if (alloc.allocatedAmount <= 0) {
            throw AppError.badRequest('Allocation amount must be greater than 0');
          }
          const rec = await this.receivableRepo.findById(alloc.receivableId, companyId, txClient);
          if (!rec) {
            throw AppError.badRequest(`Receivable with ID '${alloc.receivableId}' not found in active company`);
          }
          if (rec.customerId !== input.customerId) {
            throw AppError.badRequest(
              `Receivable '${rec.id}' belongs to a different customer than payment customer '${input.customerId}'`
            );
          }
          if (rec.status === 'PAID' || rec.outstandingAmount <= 0) {
            throw AppError.badRequest(`Receivable for invoice '${rec.salesInvoiceId}' is already fully paid`);
          }
          if (alloc.allocatedAmount > rec.outstandingAmount) {
            throw AppError.badRequest(
              `Allocation amount (${alloc.allocatedAmount}) exceeds outstanding receivable balance (${rec.outstandingAmount})`
            );
          }
          totalAllocated += alloc.allocatedAmount;
        }

        totalAllocated = Math.round(totalAllocated * 10000) / 10000;
        if (totalAllocated > input.amount) {
          throw AppError.badRequest(
            `Total allocated amount (${totalAllocated}) cannot exceed payment amount (${input.amount})`
          );
        }
      }

      // 7. Generate Payment Number
      let paymentNumber = '';
      try {
        const numResult = await this.numberingService.generateNextNumber(
          {
            companyId,
            branchId: input.branchId || null,
            documentType: 'PAYMENT',
          },
          ctx,
          txClient
        );
        paymentNumber = numResult.formattedNumber;
      } catch {
        // Fallback numbering
        const countRes = await txClient.query(
          `SELECT COUNT(*)::int as count FROM customer_payments WHERE company_id = $1`,
          [companyId]
        );
        const seq = (countRes.rows[0]?.count || 0) + 1;
        paymentNumber = `PAY-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
      }

      // 8. Insert Payment Record
      const created = await this.paymentRepo.create(
        {
          companyId,
          branchId: input.branchId || null,
          paymentNumber,
          customerId: input.customerId,
          paymentDate: input.paymentDate || new Date().toISOString().split('T')[0],
          amount: input.amount,
          currencyCode: input.currencyCode || company.baseCurrency || 'USD',
          exchangeRate: input.exchangeRate || 1.0,
          paymentMethod: input.paymentMethod || 'BANK',
          depositAccountId: input.depositAccountId,
          arAccountId: input.arAccountId || null,
          referenceNumber: input.referenceNumber || null,
          status: 'DRAFT',
          notes: input.notes || null,
          createdBy: ctx.userId,
          allocations: input.allocations,
        },
        txClient
      );

      await this.auditService.logCreate(
        'sales',
        'CustomerPayment',
        created.id,
        { paymentNumber: created.paymentNumber, amount: created.amount, customerId: created.customerId },
        ctx,
        txClient
      );

      return created;
    });
  }

  async getPaymentById(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    const payment = await this.paymentRepo.findById(id);
    if (!payment) {
      throw AppError.notFound(`Customer payment with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, payment.companyId);
    return payment;
  }

  async listPayments(
    companyId: string,
    ctx: SecurityContext,
    filters?: { customerId?: string; status?: CustomerPaymentStatus; fromDate?: string; toDate?: string; search?: string }
  ): Promise<CustomerPayment[]> {
    this.assertCompanyAccess(ctx, companyId);
    return this.paymentRepo.list(companyId, filters);
  }

  async submitPayment(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, txClient);
      if (!payment) {
        throw AppError.notFound(`Customer payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      this.stateMachine.validateTransition({
        documentType: 'CUSTOMER_PAYMENT',
        currentState: payment.status,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          companyId: payment.companyId,
          branchId: payment.branchId,
          creatorId: payment.createdBy || undefined,
          documentId: payment.id,
        },
      });

      const updated = await this.paymentRepo.updateStatus(id, 'SUBMITTED', {}, txClient);
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logUpdate(
        'sales',
        'CustomerPayment',
        payment.id,
        { status: payment.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted customer payment for approval',
        txClient
      );

      return updated;
    });
  }

  async approvePayment(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, txClient);
      if (!payment) {
        throw AppError.notFound(`Customer payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      // Enforce Segregation of Duties
      this.stateMachine.validateTransition({
        documentType: 'CUSTOMER_PAYMENT',
        currentState: payment.status,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          companyId: payment.companyId,
          branchId: payment.branchId,
          creatorId: payment.createdBy || undefined,
          documentId: payment.id,
        },
      });

      const updated = await this.paymentRepo.updateStatus(
        id,
        'APPROVED',
        {
          approvedBy: ctx.userId,
          approvedAt: new Date().toISOString(),
        },
        txClient
      );
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logApprove(
        'sales',
        'CustomerPayment',
        payment.id,
        ctx,
        `Approved customer payment ${payment.paymentNumber}`,
        txClient
      );

      return updated;
    });
  }

  async postPayment(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, txClient);
      if (!payment) {
        throw AppError.notFound(`Customer payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      // Enforce Segregation of Duties
      this.stateMachine.validateTransition({
        documentType: 'CUSTOMER_PAYMENT',
        currentState: payment.status,
        targetState: 'POSTED',
        ctx,
        documentContext: {
          companyId: payment.companyId,
          branchId: payment.branchId,
          creatorId: payment.createdBy || undefined,
          documentId: payment.id,
        },
      });

      // 1. Process & Settle Allocations with FOR UPDATE row locks on receivables
      const allocations = await this.paymentRepo.getAllocations(payment.id, txClient);
      for (const alloc of allocations) {
        const rec = await this.receivableRepo.findForUpdate(alloc.receivableId, payment.companyId, txClient);
        if (!rec) {
          throw AppError.badRequest(`Receivable '${alloc.receivableId}' not found during posting lock`);
        }
        if (rec.outstandingAmount < alloc.allocatedAmount) {
          throw AppError.badRequest(
            `Cannot post payment: Allocated amount (${alloc.allocatedAmount}) exceeds current outstanding balance (${rec.outstandingAmount}) on receivable '${rec.id}'`
          );
        }

        const newPaidAmount = Math.round((rec.paidAmount + alloc.allocatedAmount) * 10000) / 10000;
        const newOutstanding = Math.round((rec.invoiceAmount - newPaidAmount) * 10000) / 10000;
        const newStatus = newOutstanding <= 0.0001 ? 'PAID' : 'PARTIALLY_PAID';

        await this.receivableRepo.updatePaymentBalances(
          rec.id,
          payment.companyId,
          newPaidAmount,
          newOutstanding,
          newStatus,
          txClient
        );
      }

      // 2. Resolve AR Account for GL Entry
      let arAccountId = payment.arAccountId;
      if (!arAccountId) {
        // Find default AR account or any ASSET account with '1100' or 'RECEIVABLE'
        const accounts = await this.coaRepo.list(payment.companyId, { accountType: 'ASSET', isActive: true, isGroup: false }, txClient);
        const defaultAr = accounts.find((a) => a.accountCode === '1100' || a.accountName.toUpperCase().includes('RECEIVABLE')) || accounts[0];
        if (defaultAr) {
          arAccountId = defaultAr.id;
        } else {
          // Auto-provision standard AR account if none exists
          const newAr = await this.coaRepo.create(
            {
              companyId: payment.companyId,
              accountCode: '1100',
              accountName: 'Accounts Receivable',
              accountType: 'ASSET',
              isGroup: false,
              isActive: true,
              currencyCode: payment.currencyCode,
              description: 'Standard Trade Accounts Receivable',
            },
            txClient
          );
          arAccountId = newAr.id;
        }
      }

      // 3. Generate General Ledger Accounting Journal
      // Debit: Deposit Account (Cash/Bank)
      // Credit: Accounts Receivable
      let journalNumber = '';
      try {
        const numResult = await this.numberingService.generateNextNumber(
          {
            companyId: payment.companyId,
            branchId: payment.branchId || null,
            documentType: 'JOURNAL',
          },
          ctx,
          txClient
        );
        journalNumber = numResult.formattedNumber;
      } catch {
        journalNumber = `JV-PAY-${payment.paymentNumber}`;
      }

      const journal = await this.journalRepo.create(
        {
          companyId: payment.companyId,
          branchId: payment.branchId || null,
          journalNumber,
          postingDate: payment.paymentDate,
          sourceDocumentType: 'CUSTOMER_PAYMENT',
          sourceDocumentId: payment.id,
          description: `Customer payment receipt ${payment.paymentNumber}`,
          status: 'POSTED',
          totalDebit: payment.amount,
          totalCredit: payment.amount,
          currencyCode: payment.currencyCode,
          createdBy: ctx.userId,
          approvedBy: ctx.userId,
          approvedAt: new Date().toISOString(),
          postedBy: ctx.userId,
          postedAt: new Date().toISOString(),
          lines: [
            {
              lineNumber: 1,
              accountId: payment.depositAccountId,
              debit: payment.amount,
              credit: 0,
              currencyCode: payment.currencyCode,
              exchangeRate: payment.exchangeRate,
              baseDebit: payment.baseAmount,
              baseCredit: 0,
              description: `Receipt from payment ${payment.paymentNumber}`,
            },
            {
              lineNumber: 2,
              accountId: arAccountId,
              partnerId: payment.customerId,
              debit: 0,
              credit: payment.amount,
              currencyCode: payment.currencyCode,
              exchangeRate: payment.exchangeRate,
              baseDebit: 0,
              baseCredit: payment.baseAmount,
              description: `AR settlement from payment ${payment.paymentNumber}`,
            },
          ],
        },
        txClient
      );

      // 4. Update Payment status to POSTED and link journal
      const updated = await this.paymentRepo.updateStatus(
        id,
        'POSTED',
        {
          postedBy: ctx.userId,
          postedAt: new Date().toISOString(),
          journalId: journal.id,
        },
        txClient
      );
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logPost(
        'sales',
        'CustomerPayment',
        payment.id,
        ctx,
        `Posted customer payment ${payment.paymentNumber} to GL and AR`,
        txClient
      );

      return updated;
    });
  }

  async reversePayment(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, txClient);
      if (!payment) {
        throw AppError.notFound(`Customer payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      this.stateMachine.validateTransition({
        documentType: 'CUSTOMER_PAYMENT',
        currentState: payment.status,
        targetState: 'REVERSED',
        ctx,
        documentContext: {
          companyId: payment.companyId,
          branchId: payment.branchId,
          creatorId: payment.createdBy || undefined,
          documentId: payment.id,
        },
      });

      // 1. Restore Receivables balances
      const allocations = await this.paymentRepo.getAllocations(payment.id, txClient);
      for (const alloc of allocations) {
        const rec = await this.receivableRepo.findForUpdate(alloc.receivableId, payment.companyId, txClient);
        if (rec) {
          const restoredPaid = Math.max(0, Math.round((rec.paidAmount - alloc.allocatedAmount) * 10000) / 10000);
          const restoredOutstanding = Math.round((rec.invoiceAmount - restoredPaid) * 10000) / 10000;
          const restoredStatus = restoredPaid <= 0.0001 ? 'OPEN' : 'PARTIALLY_PAID';

          await this.receivableRepo.updatePaymentBalances(
            rec.id,
            payment.companyId,
            restoredPaid,
            restoredOutstanding,
            restoredStatus,
            txClient
          );
        }
      }

      // 2. Generate Compensating GL Reversal Journal
      if (payment.journalId) {
        await this.journalRepo.updateStatus(payment.journalId, 'REVERSED', {}, txClient);
      }

      let revNumber = '';
      try {
        const numResult = await this.numberingService.generateNextNumber(
          {
            companyId: payment.companyId,
            branchId: payment.branchId || null,
            documentType: 'JOURNAL',
          },
          ctx,
          txClient
        );
        revNumber = numResult.formattedNumber;
      } catch {
        revNumber = `REV-PAY-${payment.paymentNumber}`;
      }

      // Resolve AR account
      let arAccountId = payment.arAccountId;
      if (!arAccountId) {
        const accounts = await this.coaRepo.list(payment.companyId, { accountType: 'ASSET', isActive: true, isGroup: false }, txClient);
        const defaultAr = accounts.find((a) => a.accountCode === '1100' || a.accountName.toUpperCase().includes('RECEIVABLE')) || accounts[0];
        arAccountId = defaultAr ? defaultAr.id : payment.depositAccountId;
      }

      await this.journalRepo.create(
        {
          companyId: payment.companyId,
          branchId: payment.branchId || null,
          journalNumber: revNumber,
          postingDate: new Date().toISOString().split('T')[0],
          sourceDocumentType: 'PAYMENT_REVERSAL',
          sourceDocumentId: payment.id,
          description: `Compensating reversal for customer payment ${payment.paymentNumber}`,
          status: 'POSTED',
          totalDebit: payment.amount,
          totalCredit: payment.amount,
          currencyCode: payment.currencyCode,
          createdBy: ctx.userId,
          approvedBy: ctx.userId,
          approvedAt: new Date().toISOString(),
          postedBy: ctx.userId,
          postedAt: new Date().toISOString(),
          reversalJournalId: payment.journalId || null,
          lines: [
            {
              lineNumber: 1,
              accountId: arAccountId,
              partnerId: payment.customerId,
              debit: payment.amount, // DR AR (Restored)
              credit: 0,
              currencyCode: payment.currencyCode,
              exchangeRate: payment.exchangeRate,
              baseDebit: payment.baseAmount,
              baseCredit: 0,
              description: `Reversal of payment ${payment.paymentNumber} AR credit`,
            },
            {
              lineNumber: 2,
              accountId: payment.depositAccountId,
              debit: 0,
              credit: payment.amount, // CR Cash/Bank (Restored)
              currencyCode: payment.currencyCode,
              exchangeRate: payment.exchangeRate,
              baseDebit: 0,
              baseCredit: payment.baseAmount,
              description: `Reversal of payment ${payment.paymentNumber} Cash/Bank debit`,
            },
          ],
        },
        txClient
      );

      // 3. Mark payment as REVERSED
      const updated = await this.paymentRepo.updateStatus(id, 'REVERSED', {}, txClient);
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logReverse(
        'sales',
        'CustomerPayment',
        payment.id,
        ctx,
        `Reversed customer payment ${payment.paymentNumber}`,
        txClient
      );

      return updated;
    });
  }

  async cancelPayment(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, txClient);
      if (!payment) {
        throw AppError.notFound(`Customer payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      this.stateMachine.validateTransition({
        documentType: 'CUSTOMER_PAYMENT',
        currentState: payment.status,
        targetState: 'CANCELLED',
        ctx,
        documentContext: {
          companyId: payment.companyId,
          branchId: payment.branchId,
          creatorId: payment.createdBy || undefined,
          documentId: payment.id,
        },
      });

      const updated = await this.paymentRepo.updateStatus(id, 'CANCELLED', {}, txClient);
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logCancel(
        'sales',
        'CustomerPayment',
        payment.id,
        ctx,
        `Cancelled customer payment ${payment.paymentNumber}`,
        txClient
      );

      return updated;
    });
  }
}
