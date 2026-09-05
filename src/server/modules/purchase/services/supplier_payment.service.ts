import pg from 'pg';
import { SupplierPaymentRepository, ListSupplierPaymentsFilter } from '../repositories/supplier_payment.repository.js';
import { SupplierPayableRepository } from '../repositories/supplier_payable.repository.js';
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
  SupplierPayment,
  SupplierPaymentStatus,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  CreateSupplierPaymentInput,
  createSupplierPaymentSchema,
} from '../../../../shared/schemas/supplier_payment.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class SupplierPaymentService {
  constructor(
    private paymentRepo: SupplierPaymentRepository = new SupplierPaymentRepository(),
    private payableRepo: SupplierPayableRepository = new SupplierPayableRepository(),
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

  async createPayment(rawInput: unknown, ctx: SecurityContext): Promise<SupplierPayment> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required to create a supplier payment');
    }
    this.assertCompanyAccess(ctx, companyId);

    const parseResult = createSupplierPaymentSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw AppError.validation('Invalid supplier payment creation payload', parseResult.error.format());
    }
    const input: CreateSupplierPaymentInput = parseResult.data;

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

      // 3. Verify supplier exists, is supplier, and is active
      const supplier = await this.partnerRepo.findById(input.supplierId);
      if (!supplier || supplier.companyId !== companyId) {
        throw AppError.badRequest(`Supplier '${input.supplierId}' not found in active company`);
      }
      if (!supplier.isSupplier) {
        throw AppError.badRequest(`Business partner '${supplier.legalName}' is not registered as a supplier`);
      }
      if (!supplier.isActive) {
        throw AppError.badRequest(`Supplier '${supplier.legalName}' is inactive`);
      }

      // 4. Verify Disbursement Account (Cash/Bank)
      const disbursementAccount = await this.coaRepo.findById(input.disbursementAccountId, txClient);
      if (!disbursementAccount || disbursementAccount.companyId !== companyId) {
        throw AppError.badRequest(`Disbursement account '${input.disbursementAccountId}' not found in active company`);
      }
      if (!disbursementAccount.isActive) {
        throw AppError.badRequest(`Disbursement account '${disbursementAccount.accountCode}' is inactive`);
      }
      if (disbursementAccount.isGroup) {
        throw AppError.badRequest(`Disbursement account '${disbursementAccount.accountCode}' is a group account`);
      }

      // 5. Verify AP Account if provided
      if (input.apAccountId) {
        const apAcc = await this.coaRepo.findById(input.apAccountId, txClient);
        if (!apAcc || apAcc.companyId !== companyId) {
          throw AppError.badRequest(`AP account '${input.apAccountId}' not found in active company`);
        }
        if (!apAcc.isActive) {
          throw AppError.badRequest(`AP account '${apAcc.accountCode}' is inactive`);
        }
        if (apAcc.isGroup) {
          throw AppError.badRequest(`AP account '${apAcc.accountCode}' is a group account`);
        }
      }

      // 6. Validate Allocations (if provided)
      let totalAllocated = 0;
      if (input.allocations && input.allocations.length > 0) {
        for (const alloc of input.allocations) {
          if (alloc.allocatedAmount <= 0) {
            throw AppError.badRequest('Allocation amount must be greater than 0');
          }
          const payable = await this.payableRepo.findById(alloc.payableId, companyId, txClient);
          if (!payable) {
            throw AppError.badRequest(`Payable with ID '${alloc.payableId}' not found in active company`);
          }
          if (payable.supplierId !== input.supplierId) {
            throw AppError.badRequest(
              `Payable '${payable.id}' belongs to a different supplier than payment supplier '${input.supplierId}'`
            );
          }
          if (payable.status === 'PAID' || payable.outstandingAmount <= 0) {
            throw AppError.badRequest(`Payable for invoice '${payable.purchaseInvoiceId}' is already fully paid`);
          }
          if (alloc.allocatedAmount > payable.outstandingAmount) {
            throw AppError.badRequest(
              `Allocation amount (${alloc.allocatedAmount}) exceeds outstanding payable balance (${payable.outstandingAmount})`
            );
          }
          totalAllocated += alloc.allocatedAmount;
        }

        if (totalAllocated > input.amount) {
          throw AppError.badRequest(
            `Total allocated amount (${totalAllocated}) cannot exceed payment amount (${input.amount})`
          );
        }
      }

      // 7. Generate Sequence Payment Number
      const paymentDateStr = input.paymentDate || new Date().toISOString().split('T')[0];
      const numResult = await this.numberingService.generateNextNumber(
        {
          companyId,
          branchId: input.branchId || null,
          documentType: 'SUPPLIER_PAYMENT',
        },
        ctx,
        txClient,
        new Date(paymentDateStr)
      );

      // 8. Insert Payment & Allocations
      const exchangeRate = input.exchangeRate || 1.0;
      const baseAmount = Math.round(input.amount * exchangeRate * 10000) / 10000;

      const payment = await this.paymentRepo.create(
        {
          companyId,
          branchId: input.branchId || null,
          paymentNumber: numResult.formattedNumber,
          supplierId: input.supplierId,
          paymentDate: paymentDateStr,
          amount: input.amount,
          currencyCode: input.currencyCode || 'USD',
          exchangeRate,
          baseAmount,
          paymentMethod: input.paymentMethod,
          disbursementAccountId: input.disbursementAccountId,
          apAccountId: input.apAccountId || null,
          referenceNumber: input.referenceNumber || null,
          status: 'DRAFT',
          notes: input.notes || null,
          createdBy: ctx.userId,
          allocations: input.allocations,
        },
        txClient
      );

      // 9. Record Audit Log
      await this.auditService.logCreate(
        'purchase',
        'SupplierPayment',
        payment.id,
        {
          paymentNumber: payment.paymentNumber,
          supplierId: payment.supplierId,
          amount: payment.amount,
          allocationsCount: input.allocations?.length || 0,
        },
        ctx,
        txClient
      );

      return payment;
    });
  }

  async getPaymentById(id: string, ctx: SecurityContext): Promise<SupplierPayment> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required');
    }
    const payment = await this.paymentRepo.findById(id, companyId);
    if (!payment) {
      throw AppError.notFound(`Supplier payment with ID '${id}' not found`);
    }
    this.assertCompanyAccess(ctx, payment.companyId);
    return payment;
  }

  async submitPayment(id: string, ctx: SecurityContext): Promise<SupplierPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, ctx.activeCompanyId || '', txClient);
      if (!payment) {
        throw AppError.notFound(`Supplier payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      this.stateMachine.validateTransition({
        documentType: 'SUPPLIER_PAYMENT',
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

      const updated = await this.paymentRepo.updateStatus(id, payment.companyId, 'SUBMITTED', {}, txClient);
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logUpdate(
        'purchase',
        'SupplierPayment',
        payment.id,
        { status: payment.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted supplier payment for approval',
        txClient
      );

      return updated;
    });
  }

  async approvePayment(id: string, ctx: SecurityContext): Promise<SupplierPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, ctx.activeCompanyId || '', txClient);
      if (!payment) {
        throw AppError.notFound(`Supplier payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      // Enforce Segregation of Duties
      this.stateMachine.validateTransition({
        documentType: 'SUPPLIER_PAYMENT',
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
        payment.companyId,
        'APPROVED',
        {
          approvedBy: ctx.userId,
          approvedAt: new Date().toISOString(),
        },
        txClient
      );
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logApprove(
        'purchase',
        'SupplierPayment',
        payment.id,
        ctx,
        `Approved supplier payment ${payment.paymentNumber}`,
        txClient
      );

      return updated;
    });
  }

  async rejectPayment(id: string, reason: string, ctx: SecurityContext): Promise<SupplierPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, ctx.activeCompanyId || '', txClient);
      if (!payment) {
        throw AppError.notFound(`Supplier payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      this.stateMachine.validateTransition({
        documentType: 'SUPPLIER_PAYMENT',
        currentState: payment.status,
        targetState: 'REJECTED',
        ctx,
        documentContext: {
          companyId: payment.companyId,
          branchId: payment.branchId,
          creatorId: payment.createdBy || undefined,
          documentId: payment.id,
        },
      });

      const updated = await this.paymentRepo.updateStatus(id, payment.companyId, 'REJECTED', {}, txClient);
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logReject('purchase', 'SupplierPayment', payment.id, ctx, reason, txClient);

      return updated;
    });
  }

  async postPayment(id: string, ctx: SecurityContext): Promise<SupplierPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, ctx.activeCompanyId || '', txClient);
      if (!payment) {
        throw AppError.notFound(`Supplier payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      // Enforce Segregation of Duties & State Machine
      this.stateMachine.validateTransition({
        documentType: 'SUPPLIER_PAYMENT',
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

      // 1. Process & Settle Allocations with FOR UPDATE row locks on payables
      const allocations = await this.paymentRepo.getAllocations(payment.id, payment.companyId, txClient);
      for (const alloc of allocations) {
        const payable = await this.payableRepo.findForUpdate(alloc.payableId, payment.companyId, txClient);
        if (!payable) {
          throw AppError.badRequest(`Payable '${alloc.payableId}' not found during posting lock`);
        }
        if (payable.outstandingAmount < alloc.allocatedAmount) {
          throw AppError.badRequest(
            `Cannot post payment: Allocated amount (${alloc.allocatedAmount}) exceeds current outstanding balance (${payable.outstandingAmount}) on payable '${payable.id}'`
          );
        }

        const newPaidAmount = Math.round((payable.paidAmount + alloc.allocatedAmount) * 10000) / 10000;
        const newOutstanding = Math.round((payable.invoiceAmount - newPaidAmount) * 10000) / 10000;
        const newStatus = newOutstanding <= 0.0001 ? 'PAID' : 'PARTIALLY_PAID';

        await this.payableRepo.updatePaymentBalances(
          payable.id,
          payment.companyId,
          newPaidAmount,
          newOutstanding,
          newStatus,
          txClient
        );
      }

      // 2. Resolve AP Account for GL Entry
      let apAccountId = payment.apAccountId;
      if (!apAccountId) {
        // Find default AP account or any LIABILITY account with '2100' or 'PAYABLE'
        const accounts = await this.coaRepo.list(payment.companyId, { accountType: 'LIABILITY', isActive: true, isGroup: false }, txClient);
        const defaultAp = accounts.find((a) => a.accountCode === '2100' || a.accountName.toUpperCase().includes('PAYABLE')) || accounts[0];
        if (defaultAp) {
          apAccountId = defaultAp.id;
        } else {
          // Auto-provision standard AP account if none exists
          const newAp = await this.coaRepo.create(
            {
              companyId: payment.companyId,
              accountCode: '2100',
              accountName: 'Accounts Payable',
              accountType: 'LIABILITY',
              isGroup: false,
              isActive: true,
              currencyCode: payment.currencyCode,
              description: 'Standard Trade Accounts Payable',
            },
            txClient
          );
          apAccountId = newAp.id;
        }
      }

      // 3. Generate General Ledger Accounting Journal
      // Debit: Accounts Payable (Liability decrease)
      // Credit: Disbursement Account (Cash/Bank Asset decrease)
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
        journalNumber = `JV-SPAY-${payment.paymentNumber}`;
      }

      const journal = await this.journalRepo.create(
        {
          companyId: payment.companyId,
          branchId: payment.branchId || null,
          journalNumber,
          postingDate: payment.paymentDate,
          sourceDocumentType: 'SUPPLIER_PAYMENT',
          sourceDocumentId: payment.id,
          description: `Supplier payment disbursement ${payment.paymentNumber}`,
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
              accountId: apAccountId,
              partnerId: payment.supplierId,
              debit: payment.amount,
              credit: 0,
              currencyCode: payment.currencyCode,
              exchangeRate: payment.exchangeRate,
              baseDebit: payment.baseAmount,
              baseCredit: 0,
              description: `AP settlement from payment ${payment.paymentNumber}`,
            },
            {
              lineNumber: 2,
              accountId: payment.disbursementAccountId,
              debit: 0,
              credit: payment.amount,
              currencyCode: payment.currencyCode,
              exchangeRate: payment.exchangeRate,
              baseDebit: 0,
              baseCredit: payment.baseAmount,
              description: `Disbursement for payment ${payment.paymentNumber}`,
            },
          ],
        },
        txClient
      );

      // 4. Update Payment status to POSTED and link journal
      const updated = await this.paymentRepo.updateStatus(
        id,
        payment.companyId,
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
        'purchase',
        'SupplierPayment',
        payment.id,
        ctx,
        `Posted supplier payment ${payment.paymentNumber} to GL and AP`,
        txClient
      );

      return updated;
    });
  }

  async reversePayment(id: string, ctx: SecurityContext): Promise<SupplierPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, ctx.activeCompanyId || '', txClient);
      if (!payment) {
        throw AppError.notFound(`Supplier payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      this.stateMachine.validateTransition({
        documentType: 'SUPPLIER_PAYMENT',
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

      // 1. Restore Payables balances
      const allocations = await this.paymentRepo.getAllocations(payment.id, payment.companyId, txClient);
      for (const alloc of allocations) {
        const payable = await this.payableRepo.findForUpdate(alloc.payableId, payment.companyId, txClient);
        if (payable) {
          const restoredPaid = Math.max(0, Math.round((payable.paidAmount - alloc.allocatedAmount) * 10000) / 10000);
          const restoredOutstanding = Math.round((payable.invoiceAmount - restoredPaid) * 10000) / 10000;
          const restoredStatus = restoredPaid <= 0.0001 ? 'OPEN' : 'PARTIALLY_PAID';

          await this.payableRepo.updatePaymentBalances(
            payable.id,
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
        revNumber = `REV-SPAY-${payment.paymentNumber}`;
      }

      // Resolve AP account
      let apAccountId = payment.apAccountId;
      if (!apAccountId) {
        const accounts = await this.coaRepo.list(payment.companyId, { accountType: 'LIABILITY', isActive: true, isGroup: false }, txClient);
        const defaultAp = accounts.find((a) => a.accountCode === '2100' || a.accountName.toUpperCase().includes('PAYABLE')) || accounts[0];
        apAccountId = defaultAp ? defaultAp.id : payment.disbursementAccountId;
      }

      await this.journalRepo.create(
        {
          companyId: payment.companyId,
          branchId: payment.branchId || null,
          journalNumber: revNumber,
          postingDate: new Date().toISOString().split('T')[0],
          sourceDocumentType: 'PAYMENT_REVERSAL',
          sourceDocumentId: payment.id,
          description: `Compensating reversal for supplier payment ${payment.paymentNumber}`,
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
              accountId: payment.disbursementAccountId,
              debit: payment.amount, // DR Cash/Bank (Restored)
              credit: 0,
              currencyCode: payment.currencyCode,
              exchangeRate: payment.exchangeRate,
              baseDebit: payment.baseAmount,
              baseCredit: 0,
              description: `Reversal of payment ${payment.paymentNumber} disbursement credit`,
            },
            {
              lineNumber: 2,
              accountId: apAccountId,
              partnerId: payment.supplierId,
              debit: 0,
              credit: payment.amount, // CR Accounts Payable (Restored)
              currencyCode: payment.currencyCode,
              exchangeRate: payment.exchangeRate,
              baseDebit: 0,
              baseCredit: payment.baseAmount,
              description: `Reversal of payment ${payment.paymentNumber} AP settlement`,
            },
          ],
        },
        txClient
      );

      // 3. Mark payment as REVERSED
      const updated = await this.paymentRepo.updateStatus(
        id,
        payment.companyId,
        'REVERSED',
        {
          reversedBy: ctx.userId,
          reversedAt: new Date().toISOString(),
        },
        txClient
      );
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logReverse(
        'purchase',
        'SupplierPayment',
        payment.id,
        ctx,
        `Reversed supplier payment ${payment.paymentNumber}`,
        txClient
      );

      return updated;
    });
  }

  async cancelPayment(id: string, ctx: SecurityContext): Promise<SupplierPayment> {
    return withTransaction(async (txClient) => {
      const payment = await this.paymentRepo.findForUpdate(id, ctx.activeCompanyId || '', txClient);
      if (!payment) {
        throw AppError.notFound(`Supplier payment with ID '${id}' not found`);
      }
      this.assertCompanyAccess(ctx, payment.companyId);

      this.stateMachine.validateTransition({
        documentType: 'SUPPLIER_PAYMENT',
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

      const updated = await this.paymentRepo.updateStatus(id, payment.companyId, 'CANCELLED', {}, txClient);
      if (!updated) throw AppError.notFound(`Payment '${id}' not found`);

      await this.auditService.logCancel(
        'purchase',
        'SupplierPayment',
        payment.id,
        ctx,
        `Cancelled supplier payment ${payment.paymentNumber}`,
        txClient
      );

      return updated;
    });
  }

  async listPayments(
    filter: ListSupplierPaymentsFilter = {},
    limit = 50,
    offset = 0,
    ctx: SecurityContext
  ): Promise<{ data: SupplierPayment[]; total: number }> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required');
    }
    return this.paymentRepo.list(companyId, filter, limit, offset);
  }
}
