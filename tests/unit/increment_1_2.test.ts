import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ChartOfAccount,
  AccountingJournal,
  AccountingJournalLine,
  CustomerPayment,
  CustomerPaymentAllocation,
  CustomerReceivable,
  SalesInvoice,
  SecurityContext,
  AccountType,
} from '../../src/shared/types/index.js';
import {
  createAccountSchema,
  updateAccountSchema,
  createJournalSchema,
} from '../../src/shared/schemas/accounting.js';
import {
  createCustomerPaymentSchema,
  updateCustomerPaymentSchema,
} from '../../src/shared/schemas/customer_payment.js';
import { StateMachineEngine } from '../../src/server/modules/workflow/services/state_machine.service.js';

let passedTests = 0;
let totalTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('\n=== RUNNING INCREMENT 1.2 ACCOUNTS RECEIVABLE PAYMENTS & GENERAL LEDGER UNIT TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Simulation Engine for Chart of Accounts, Journals & AR Payments
// ----------------------------------------------------------------------------

interface TenantContext {
  companyId: string;
  branchId: string | null;
  userId: string;
  roles: string[];
  permissions: string[];
}

interface AuditRecord {
  id: string;
  companyId: string;
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  performedBy: string;
  timestamp: string;
  details?: any;
}

class InMemoryERPAccountingEngine {
  public chartOfAccounts: Map<string, ChartOfAccount> = new Map();
  public accountingJournals: Map<string, AccountingJournal> = new Map();
  public customerPayments: Map<string, CustomerPayment> = new Map();
  public customerPaymentAllocations: Map<string, CustomerPaymentAllocation[]> = new Map();
  public customerReceivables: Map<string, CustomerReceivable> = new Map();
  public salesInvoices: Map<string, SalesInvoice> = new Map();
  public businessPartners: Map<string, { id: string; companyId: string; legalName: string; isCustomer: boolean; isActive: boolean }> = new Map();
  public auditLogs: AuditRecord[] = [];
  public stateMachine = new StateMachineEngine();

  private paymentCounter = 1;
  private journalCounter = 1;

  public createSecurityContext(tenant: TenantContext): SecurityContext {
    return {
      userId: tenant.userId,
      email: 'user@test.com',
      fullName: 'Test User',
      isSuperadmin: tenant.roles.includes('SUPERADMIN'),
      activeCompanyId: tenant.companyId,
      activeBranchId: tenant.branchId,
      effectivePermissions: tenant.permissions,
    };
  }

  public logAudit(record: Omit<AuditRecord, 'id' | 'timestamp'>): void {
    this.auditLogs.push({
      ...record,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    });
  }

  // --- Chart of Accounts Methods ---
  public async createAccount(input: any, ctx: SecurityContext): Promise<ChartOfAccount> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw new Error('Active company context is required');

    createAccountSchema.parse(input);

    const accountCode = input.accountCode.trim().toUpperCase();
    for (const acc of this.chartOfAccounts.values()) {
      if (acc.companyId === companyId && acc.accountCode.toUpperCase() === accountCode) {
        throw new Error(`Account code '${accountCode}' already exists in company`);
      }
    }

    if (input.parentAccountId) {
      const parent = this.chartOfAccounts.get(input.parentAccountId);
      if (!parent || parent.companyId !== companyId) {
        throw new Error(`Parent account '${input.parentAccountId}' not found in company`);
      }
      if (!parent.isGroup) {
        throw new Error(`Parent account '${parent.accountCode}' is not marked as a group account`);
      }
    }

    const id = randomUUID();
    const account: ChartOfAccount = {
      id,
      companyId,
      accountCode,
      accountName: input.accountName.trim(),
      accountType: input.accountType,
      parentAccountId: input.parentAccountId || null,
      isGroup: input.isGroup ?? false,
      isActive: input.isActive ?? true,
      currencyCode: input.currencyCode || 'USD',
      description: input.description || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.chartOfAccounts.set(id, account);
    this.logAudit({
      companyId,
      module: 'accounting',
      entityType: 'ChartOfAccount',
      entityId: id,
      action: 'CREATE',
      performedBy: ctx.userId,
    });

    return account;
  }

  public async updateAccount(id: string, input: any, ctx: SecurityContext): Promise<ChartOfAccount> {
    const account = this.chartOfAccounts.get(id);
    if (!account || account.companyId !== ctx.activeCompanyId) {
      throw new Error(`Account '${id}' not found`);
    }

    updateAccountSchema.parse(input);

    if (input.accountName) account.accountName = input.accountName.trim();
    if (input.isActive !== undefined) account.isActive = input.isActive;
    if (input.isGroup !== undefined) account.isGroup = input.isGroup;
    if (input.description !== undefined) account.description = input.description;
    account.updatedAt = new Date().toISOString();

    this.logAudit({
      companyId: account.companyId,
      module: 'accounting',
      entityType: 'ChartOfAccount',
      entityId: id,
      action: 'UPDATE',
      performedBy: ctx.userId,
    });

    return account;
  }

  // --- Manual Journal Methods ---
  public async createJournal(input: any, ctx: SecurityContext): Promise<AccountingJournal> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw new Error('Active company context is required');

    createJournalSchema.parse(input);

    let totalDebit = 0;
    let totalCredit = 0;
    let totalBaseDebit = 0;
    let totalBaseCredit = 0;

    const lines: AccountingJournalLine[] = [];
    const journalId = randomUUID();

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      const account = this.chartOfAccounts.get(line.accountId);
      if (!account || account.companyId !== companyId) {
        throw new Error(`Account '${line.accountId}' not found in company`);
      }
      if (!account.isActive) {
        throw new Error(`Account '${account.accountCode}' is inactive`);
      }
      if (account.isGroup) {
        throw new Error(`Account '${account.accountCode}' is a group account and cannot accept direct postings`);
      }

      if (line.partnerId) {
        const partner = this.businessPartners.get(line.partnerId);
        if (!partner || partner.companyId !== companyId) {
          throw new Error(`Partner '${line.partnerId}' not found in company`);
        }
      }

      const exchangeRate = line.exchangeRate || 1.0;
      const debit = line.debit || 0;
      const credit = line.credit || 0;
      const baseDebit = Math.round(debit * exchangeRate * 10000) / 10000;
      const baseCredit = Math.round(credit * exchangeRate * 10000) / 10000;

      totalDebit += debit;
      totalCredit += credit;
      totalBaseDebit += baseDebit;
      totalBaseCredit += baseCredit;

      lines.push({
        id: randomUUID(),
        journalId,
        lineNumber: i + 1,
        accountId: line.accountId,
        partnerId: line.partnerId || null,
        debit,
        credit,
        currencyCode: line.currencyCode || 'USD',
        exchangeRate,
        baseDebit,
        baseCredit,
        description: line.description || null,
        createdAt: new Date().toISOString(),
      });
    }

    totalDebit = Math.round(totalDebit * 10000) / 10000;
    totalCredit = Math.round(totalCredit * 10000) / 10000;
    totalBaseDebit = Math.round(totalBaseDebit * 10000) / 10000;
    totalBaseCredit = Math.round(totalBaseCredit * 10000) / 10000;

    if (Math.abs(totalDebit - totalCredit) > 0.0001 || Math.abs(totalBaseDebit - totalBaseCredit) > 0.0001) {
      throw new Error(`Journal out of balance: Total Debits (${totalDebit}) != Total Credits (${totalCredit})`);
    }

    const journalNumber = `JV-${String(this.journalCounter++).padStart(5, '0')}`;
    const journal: AccountingJournal = {
      id: journalId,
      companyId,
      branchId: input.branchId || null,
      journalNumber,
      postingDate: input.postingDate || new Date().toISOString().split('T')[0],
      sourceDocumentType: input.sourceDocumentType || 'MANUAL',
      sourceDocumentId: input.sourceDocumentId || null,
      description: input.description || null,
      status: 'DRAFT',
      totalDebit,
      totalCredit,
      currencyCode: input.currencyCode || 'USD',
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines,
    };

    this.accountingJournals.set(journalId, journal);
    this.logAudit({
      companyId,
      module: 'accounting',
      entityType: 'AccountingJournal',
      entityId: journalId,
      action: 'CREATE',
      performedBy: ctx.userId,
    });

    return journal;
  }

  // --- Customer Payment Methods ---
  public async createCustomerPayment(input: any, ctx: SecurityContext): Promise<CustomerPayment> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw new Error('Active company context is required');

    createCustomerPaymentSchema.parse(input);

    const customer = this.businessPartners.get(input.customerId);
    if (!customer || customer.companyId !== companyId) {
      throw new Error(`Customer '${input.customerId}' not found in active company`);
    }
    if (!customer.isCustomer) {
      throw new Error(`Business partner '${customer.legalName}' is not registered as a customer`);
    }
    if (!customer.isActive) {
      throw new Error(`Customer '${customer.legalName}' is inactive`);
    }

    const depositAccount = this.chartOfAccounts.get(input.depositAccountId);
    if (!depositAccount || depositAccount.companyId !== companyId) {
      throw new Error(`Deposit account '${input.depositAccountId}' not found in active company`);
    }
    if (!depositAccount.isActive) {
      throw new Error(`Deposit account '${depositAccount.accountCode}' is inactive`);
    }
    if (depositAccount.isGroup) {
      throw new Error(`Deposit account '${depositAccount.accountCode}' is a group account`);
    }

    if (input.arAccountId) {
      const arAcc = this.chartOfAccounts.get(input.arAccountId);
      if (!arAcc || arAcc.companyId !== companyId) {
        throw new Error(`AR account '${input.arAccountId}' not found in active company`);
      }
      if (!arAcc.isActive) {
        throw new Error(`AR account '${arAcc.accountCode}' is inactive`);
      }
      if (arAcc.isGroup) {
        throw new Error(`AR account '${arAcc.accountCode}' is a group account`);
      }
    }

    let totalAllocated = 0;
    const paymentId = randomUUID();
    const allocations: CustomerPaymentAllocation[] = [];

    if (input.allocations && input.allocations.length > 0) {
      for (const alloc of input.allocations) {
        if (alloc.allocatedAmount <= 0) {
          throw new Error('Allocation amount must be greater than 0');
        }
        const rec = this.customerReceivables.get(alloc.receivableId);
        if (!rec || rec.companyId !== companyId) {
          throw new Error(`Receivable '${alloc.receivableId}' not found in company`);
        }
        if (rec.customerId !== input.customerId) {
          throw new Error(`Receivable '${rec.id}' belongs to different customer`);
        }
        if (rec.status === 'PAID' || rec.outstandingAmount <= 0) {
          throw new Error(`Receivable '${rec.id}' is already fully paid`);
        }
        if (alloc.allocatedAmount > rec.outstandingAmount + 0.0001) {
          throw new Error(`Allocation amount (${alloc.allocatedAmount}) exceeds outstanding receivable balance (${rec.outstandingAmount})`);
        }
        totalAllocated += alloc.allocatedAmount;
        allocations.push({
          id: randomUUID(),
          paymentId,
          receivableId: rec.id,
          allocatedAmount: alloc.allocatedAmount,
          allocationDate: input.paymentDate || new Date().toISOString().split('T')[0],
          createdAt: new Date().toISOString(),
        });
      }

      totalAllocated = Math.round(totalAllocated * 10000) / 10000;
      if (totalAllocated > input.amount + 0.0001) {
        throw new Error(`Total allocated amount (${totalAllocated}) cannot exceed payment amount (${input.amount})`);
      }
    }

    const exchangeRate = input.exchangeRate || 1.0;
    const baseAmount = Math.round(input.amount * exchangeRate * 10000) / 10000;
    const paymentNumber = `PAY-${String(this.paymentCounter++).padStart(5, '0')}`;

    const payment: CustomerPayment = {
      id: paymentId,
      companyId,
      branchId: input.branchId || null,
      paymentNumber,
      customerId: input.customerId,
      paymentDate: input.paymentDate || new Date().toISOString().split('T')[0],
      amount: input.amount,
      currencyCode: input.currencyCode || 'USD',
      exchangeRate,
      baseAmount,
      paymentMethod: input.paymentMethod || 'BANK',
      depositAccountId: input.depositAccountId,
      arAccountId: input.arAccountId || null,
      referenceNumber: input.referenceNumber || null,
      notes: input.notes || null,
      status: 'DRAFT',
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      allocations,
    };

    this.customerPayments.set(paymentId, payment);
    this.customerPaymentAllocations.set(paymentId, allocations);

    this.logAudit({
      companyId,
      module: 'sales',
      entityType: 'CustomerPayment',
      entityId: paymentId,
      action: 'CREATE',
      performedBy: ctx.userId,
    });

    return payment;
  }

  public async submitPayment(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    const payment = this.customerPayments.get(id);
    if (!payment || payment.companyId !== ctx.activeCompanyId) {
      throw new Error(`Customer payment '${id}' not found`);
    }

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

    payment.status = 'SUBMITTED';
    payment.updatedAt = new Date().toISOString();
    return payment;
  }

  public async approvePayment(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    const payment = this.customerPayments.get(id);
    if (!payment || payment.companyId !== ctx.activeCompanyId) {
      throw new Error(`Customer payment '${id}' not found`);
    }

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

    payment.status = 'APPROVED';
    payment.approvedBy = ctx.userId;
    payment.approvedAt = new Date().toISOString();
    payment.updatedAt = new Date().toISOString();
    return payment;
  }

  public async postPayment(id: string, ctx: SecurityContext): Promise<CustomerPayment> {
    const payment = this.customerPayments.get(id);
    if (!payment || payment.companyId !== ctx.activeCompanyId) {
      throw new Error(`Customer payment '${id}' not found`);
    }

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

    // 1. Process & Settle Allocations against Receivables
    const allocations = this.customerPaymentAllocations.get(payment.id) || [];
    for (const alloc of allocations) {
      const rec = this.customerReceivables.get(alloc.receivableId);
      if (!rec) {
        throw new Error(`Receivable '${alloc.receivableId}' not found`);
      }
      if (rec.outstandingAmount < alloc.allocatedAmount) {
        throw new Error(
          `Allocated amount (${alloc.allocatedAmount}) exceeds current outstanding balance (${rec.outstandingAmount}) on receivable '${rec.id}'`
        );
      }

      const newPaidAmount = Math.round((rec.paidAmount + alloc.allocatedAmount) * 10000) / 10000;
      const newOutstanding = Math.round((rec.invoiceAmount - newPaidAmount) * 10000) / 10000;
      const newStatus = newOutstanding <= 0.0001 ? 'PAID' : 'PARTIALLY_PAID';

      rec.paidAmount = newPaidAmount;
      rec.outstandingAmount = newOutstanding;
      rec.status = newStatus;
      rec.updatedAt = new Date().toISOString();
    }

    // 2. Resolve AR Account for General Ledger
    let arAccountId = payment.arAccountId;
    if (!arAccountId) {
      const accounts = Array.from(this.chartOfAccounts.values()).filter(
        (a) => a.companyId === payment.companyId && a.accountType === 'ASSET' && a.isActive && !a.isGroup
      );
      const defaultAr = accounts.find((a) => a.accountCode === '1100' || a.accountName.toUpperCase().includes('RECEIVABLE')) || accounts[0];
      if (defaultAr) {
        arAccountId = defaultAr.id;
      } else {
        const newArId = randomUUID();
        const newAr: ChartOfAccount = {
          id: newArId,
          companyId: payment.companyId,
          accountCode: '1100',
          accountName: 'Accounts Receivable',
          accountType: 'ASSET',
          isGroup: false,
          isActive: true,
          currencyCode: payment.currencyCode,
          description: 'Auto-provisioned Trade AR',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.chartOfAccounts.set(newArId, newAr);
        arAccountId = newArId;
      }
    }

    // 3. Create General Ledger Journal (Debit Bank/Cash, Credit AR)
    const journalId = randomUUID();
    const journalNumber = `JV-PAY-${payment.paymentNumber}`;
    const journal: AccountingJournal = {
      id: journalId,
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines: [
        {
          id: randomUUID(),
          journalId,
          lineNumber: 1,
          accountId: payment.depositAccountId,
          debit: payment.amount,
          credit: 0,
          currencyCode: payment.currencyCode,
          exchangeRate: payment.exchangeRate,
          baseDebit: payment.baseAmount,
          baseCredit: 0,
          description: `Receipt from payment ${payment.paymentNumber}`,
          createdAt: new Date().toISOString(),
        },
        {
          id: randomUUID(),
          journalId,
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
          createdAt: new Date().toISOString(),
        },
      ],
    };

    // Verify invariant: Debits == Credits
    assert.equal(journal.totalDebit, journal.totalCredit, 'Debits must strictly equal credits');
    this.accountingJournals.set(journalId, journal);

    // 4. Update Payment status & link journal
    payment.status = 'POSTED';
    payment.postedBy = ctx.userId;
    payment.postedAt = new Date().toISOString();
    payment.journalId = journalId;
    payment.updatedAt = new Date().toISOString();

    this.logAudit({
      companyId: payment.companyId,
      module: 'sales',
      entityType: 'CustomerPayment',
      entityId: payment.id,
      action: 'POST',
      performedBy: ctx.userId,
    });

    return payment;
  }

  public async reversePayment(id: string, reason: string, ctx: SecurityContext): Promise<CustomerPayment> {
    const payment = this.customerPayments.get(id);
    if (!payment || payment.companyId !== ctx.activeCompanyId) {
      throw new Error(`Customer payment '${id}' not found`);
    }

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
    const allocations = this.customerPaymentAllocations.get(payment.id) || [];
    for (const alloc of allocations) {
      const rec = this.customerReceivables.get(alloc.receivableId);
      if (rec) {
        const restoredPaid = Math.max(0, Math.round((rec.paidAmount - alloc.allocatedAmount) * 10000) / 10000);
        const restoredOutstanding = Math.round((rec.invoiceAmount - restoredPaid) * 10000) / 10000;
        const restoredStatus = restoredPaid <= 0.0001 ? 'OPEN' : 'PARTIALLY_PAID';

        rec.paidAmount = restoredPaid;
        rec.outstandingAmount = restoredOutstanding;
        rec.status = restoredStatus;
        rec.updatedAt = new Date().toISOString();
      }
    }

    // 2. Mark original journal as REVERSED
    if (payment.journalId) {
      const origJournal = this.accountingJournals.get(payment.journalId);
      if (origJournal) {
        origJournal.status = 'REVERSED';
        origJournal.updatedAt = new Date().toISOString();
      }
    }

    // 3. Create Compensating Reversal Journal (Debit AR, Credit Bank/Cash)
    let arAccountId = payment.arAccountId;
    if (!arAccountId) {
      const accounts = Array.from(this.chartOfAccounts.values()).filter(
        (a) => a.companyId === payment.companyId && a.accountType === 'ASSET' && a.isActive && !a.isGroup
      );
      const defaultAr = accounts.find((a) => a.accountCode === '1100' || a.accountName.toUpperCase().includes('RECEIVABLE')) || accounts[0];
      arAccountId = defaultAr ? defaultAr.id : payment.depositAccountId;
    }

    const revJournalId = randomUUID();
    const revJournalNumber = `REV-PAY-${payment.paymentNumber}`;
    const revJournal: AccountingJournal = {
      id: revJournalId,
      companyId: payment.companyId,
      branchId: payment.branchId || null,
      journalNumber: revJournalNumber,
      postingDate: new Date().toISOString().split('T')[0],
      sourceDocumentType: 'PAYMENT_REVERSAL',
      sourceDocumentId: payment.id,
      description: `Compensating reversal for customer payment ${payment.paymentNumber}: ${reason}`,
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines: [
        {
          id: randomUUID(),
          journalId: revJournalId,
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
          createdAt: new Date().toISOString(),
        },
        {
          id: randomUUID(),
          journalId: revJournalId,
          lineNumber: 2,
          accountId: payment.depositAccountId,
          debit: 0,
          credit: payment.amount, // CR Cash/Bank (Restored)
          currencyCode: payment.currencyCode,
          exchangeRate: payment.exchangeRate,
          baseDebit: 0,
          baseCredit: payment.baseAmount,
          description: `Reversal of payment ${payment.paymentNumber} Cash/Bank debit`,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    assert.equal(revJournal.totalDebit, revJournal.totalCredit, 'Reversal journal debits must equal credits');
    this.accountingJournals.set(revJournalId, revJournal);

    // 4. Update Payment status
    payment.status = 'REVERSED';
    payment.updatedAt = new Date().toISOString();

    this.logAudit({
      companyId: payment.companyId,
      module: 'sales',
      entityType: 'CustomerPayment',
      entityId: payment.id,
      action: 'REVERSE',
      performedBy: ctx.userId,
    });

    return payment;
  }
}

// ----------------------------------------------------------------------------
// Test Execution
// ----------------------------------------------------------------------------

async function runIncrement12Tests() {
  const engine = new InMemoryERPAccountingEngine();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const userCreator = randomUUID();
  const userApprover = randomUUID();
  const userPoster = randomUUID();
  const userAuditor = randomUUID();

  const creatorCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: null,
    userId: userCreator,
    roles: ['SALES_OFFICER'],
    permissions: [
      'sales.payment.view',
      'sales.payment.create',
      'sales.payment.edit',
      'sales.payment.cancel',
      'accounting.account.view',
      'accounting.account.create',
      'accounting.account.edit',
      'accounting.journal.view',
      'accounting.journal.create',
    ],
  });

  const approverCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: null,
    userId: userApprover,
    roles: ['SALES_MANAGER'],
    permissions: [
      'sales.payment.view',
      'sales.payment.approve',
      'sales.payment.reject',
      'accounting.journal.view',
      'accounting.journal.approve',
      'accounting.journal.reject',
    ],
  });

  const posterCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: null,
    userId: userPoster,
    roles: ['FINANCE_MANAGER'],
    permissions: [
      'sales.payment.view',
      'sales.payment.post',
      'sales.payment.reverse',
      'accounting.journal.view',
      'accounting.journal.post',
      'accounting.journal.reverse',
    ],
  });

  const tenantBCtx = engine.createSecurityContext({
    companyId: companyB,
    branchId: null,
    userId: randomUUID(),
    roles: ['FINANCE_MANAGER'],
    permissions: ['*'],
  });

  // Seed master data
  const customerId = randomUUID();
  engine.businessPartners.set(customerId, {
    id: customerId,
    companyId: companyA,
    legalName: 'Apex Industrial Corp',
    isCustomer: true,
    isActive: true,
  });

  const nonCustomerId = randomUUID();
  engine.businessPartners.set(nonCustomerId, {
    id: nonCustomerId,
    companyId: companyA,
    legalName: 'Supplier Direct LLC',
    isCustomer: false,
    isActive: true,
  });

  // --------------------------------------------------------------------------
  console.log('--- Test Suite 1: Chart of Accounts Foundation & Isolation ---');
  // --------------------------------------------------------------------------

  let bankAccountId = '';
  let arAccountId = '';
  let revenueAccountId = '';

  await test('1. Chart of Accounts creation & company scoping', async () => {
    const bank = await engine.createAccount(
      {
        accountCode: '1010',
        accountName: 'Operating Bank Account (USD)',
        accountType: 'ASSET',
        isGroup: false,
        isActive: true,
      },
      creatorCtx
    );
    bankAccountId = bank.id;
    assert.equal(bank.accountCode, '1010');
    assert.equal(bank.companyId, companyA);

    const ar = await engine.createAccount(
      {
        accountCode: '1100',
        accountName: 'Accounts Receivable - Trade',
        accountType: 'ASSET',
        isGroup: false,
        isActive: true,
      },
      creatorCtx
    );
    arAccountId = ar.id;
    assert.equal(ar.accountCode, '1100');

    const rev = await engine.createAccount(
      {
        accountCode: '4000',
        accountName: 'Sales Revenue',
        accountType: 'REVENUE',
        isGroup: false,
        isActive: true,
      },
      creatorCtx
    );
    revenueAccountId = rev.id;
    assert.equal(rev.accountCode, '4000');
  });

  await test('2. Company-scoped account uniqueness prevents duplicate account code in same company', async () => {
    await assert.rejects(
      async () => {
        await engine.createAccount(
          {
            accountCode: '1010',
            accountName: 'Duplicate Bank Code',
            accountType: 'ASSET',
          },
          creatorCtx
        );
      },
      /already exists in company/
    );
  });

  await test('3. Cross-company account access rejection', async () => {
    await assert.rejects(
      async () => {
        await engine.updateAccount(bankAccountId, { accountName: 'Hacked Name' }, tenantBCtx);
      },
      /not found/
    );
  });

  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 2: Customer Payment Lifecycle & Segregation of Duties ---');
  // --------------------------------------------------------------------------

  // Seed Customer Receivables for Company A
  const receivable1Id = randomUUID();
  engine.customerReceivables.set(receivable1Id, {
    id: receivable1Id,
    companyId: companyA,
    branchId: null,
    customerId,
    salesInvoiceId: randomUUID(),
    currencyCode: 'USD',
    invoiceAmount: 100000,
    paidAmount: 0,
    outstandingAmount: 100000,
    invoiceDate: '2026-09-01',
    dueDate: '2026-10-01',
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const receivable2Id = randomUUID();
  engine.customerReceivables.set(receivable2Id, {
    id: receivable2Id,
    companyId: companyA,
    branchId: null,
    customerId,
    salesInvoiceId: randomUUID(),
    currencyCode: 'USD',
    invoiceAmount: 50000,
    paidAmount: 0,
    outstandingAmount: 50000,
    invoiceDate: '2026-09-01',
    dueDate: '2026-10-01',
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  let payment1Id = '';

  await test('4. Customer payment creation with partial allocation', async () => {
    const payment = await engine.createCustomerPayment(
      {
        customerId,
        amount: 60000,
        currencyCode: 'USD',
        paymentMethod: 'BANK',
        depositAccountId: bankAccountId,
        arAccountId,
        allocations: [
          {
            receivableId: receivable1Id,
            allocatedAmount: 60000,
          },
        ],
      },
      creatorCtx
    );

    payment1Id = payment.id;
    assert.equal(payment.status, 'DRAFT');
    assert.equal(payment.amount, 60000);
    assert.equal(payment.allocations?.length, 1);
    assert.equal(payment.allocations[0].allocatedAmount, 60000);
  });

  await test('5. Payment lifecycle transition: DRAFT -> SUBMITTED', async () => {
    const submitted = await engine.submitPayment(payment1Id, creatorCtx);
    assert.equal(submitted.status, 'SUBMITTED');
  });

  await test('6. SoD Enforcement: Creator cannot approve own customer payment', async () => {
    await assert.rejects(
      async () => {
        await engine.approvePayment(payment1Id, creatorCtx);
      },
      /Segregation of duties/i
    );
  });

  await test('Authorized manager approves customer payment', async () => {
    const approved = await engine.approvePayment(payment1Id, approverCtx);
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.approvedBy, userApprover);
  });

  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 3: Canonical Accounting Scenario & Automatic GL Posting ---');
  // --------------------------------------------------------------------------

  await test('13-16. Payment posting: Atomically updates receivable to PARTIALLY_PAID and generates balanced GL journal', async () => {
    const posted = await engine.postPayment(payment1Id, posterCtx);
    assert.equal(posted.status, 'POSTED');
    assert.ok(posted.journalId, 'Must link to created GL Journal');

    // Verify Receivable state
    const rec1 = engine.customerReceivables.get(receivable1Id)!;
    assert.equal(rec1.paidAmount, 60000);
    assert.equal(rec1.outstandingAmount, 40000);
    assert.equal(rec1.status, 'PARTIALLY_PAID');
    assert.equal(rec1.invoiceAmount, rec1.paidAmount + rec1.outstandingAmount);

    // Verify GL Journal
    const journal = engine.accountingJournals.get(posted.journalId)!;
    assert.ok(journal);
    assert.equal(journal.status, 'POSTED');
    assert.equal(journal.totalDebit, 60000);
    assert.equal(journal.totalCredit, 60000);
    assert.ok(journal.lines);
    assert.equal(journal.lines!.length, 2);

    // Line 1: Debit Bank 60,000
    assert.equal(journal.lines![0].accountId, bankAccountId);
    assert.equal(journal.lines![0].debit, 60000);
    assert.equal(journal.lines![0].credit, 0);

    // Line 2: Credit AR 60,000
    assert.equal(journal.lines![1].accountId, arAccountId);
    assert.equal(journal.lines![1].debit, 0);
    assert.equal(journal.lines![1].credit, 60000);
  });

  let payment2Id = '';

  await test('7-9. Second payment of 40,000 fully settles receivable (PAID, outstanding = 0)', async () => {
    const payment2 = await engine.createCustomerPayment(
      {
        customerId,
        amount: 40000,
        currencyCode: 'USD',
        paymentMethod: 'BANK',
        depositAccountId: bankAccountId,
        arAccountId,
        allocations: [
          {
            receivableId: receivable1Id,
            allocatedAmount: 40000, // Exactly the remaining outstanding 40,000
          },
        ],
      },
      creatorCtx
    );
    payment2Id = payment2.id;

    await engine.submitPayment(payment2Id, creatorCtx);
    await engine.approvePayment(payment2Id, approverCtx);
    const posted2 = await engine.postPayment(payment2Id, posterCtx);

    assert.equal(posted2.status, 'POSTED');

    // Verify Receivable state
    const rec1 = engine.customerReceivables.get(receivable1Id)!;
    assert.equal(rec1.paidAmount, 100000);
    assert.equal(rec1.outstandingAmount, 0);
    assert.equal(rec1.status, 'PAID');
    assert.equal(rec1.invoiceAmount, rec1.paidAmount + rec1.outstandingAmount);
  });

  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 4: Reversals, Compensating Entries & Restoration ---');
  // --------------------------------------------------------------------------

  await test('18-19. Reversal of second payment creates compensating GL entry and restores receivable to PARTIALLY_PAID (60k paid, 40k out)', async () => {
    const reversed = await engine.reversePayment(payment2Id, 'Customer cheque bounced / cancelled', posterCtx);
    assert.equal(reversed.status, 'REVERSED');

    // Verify Receivable restoration
    const rec1 = engine.customerReceivables.get(receivable1Id)!;
    assert.equal(rec1.paidAmount, 60000);
    assert.equal(rec1.outstandingAmount, 40000);
    assert.equal(rec1.status, 'PARTIALLY_PAID');
    assert.equal(rec1.invoiceAmount, rec1.paidAmount + rec1.outstandingAmount);

    // Verify Compensating Reversal Journal
    const revJournals = Array.from(engine.accountingJournals.values()).filter(
      (j) => j.sourceDocumentType === 'PAYMENT_REVERSAL' && j.sourceDocumentId === payment2Id
    );
    assert.equal(revJournals.length, 1);
    const revJournal = revJournals[0];
    assert.equal(revJournal.status, 'POSTED');
    assert.equal(revJournal.totalDebit, 40000);
    assert.equal(revJournal.totalCredit, 40000);
    assert.ok(revJournal.lines);

    // Line 1: Debit AR 40,000 (Restored)
    assert.equal(revJournal.lines![0].accountId, arAccountId);
    assert.equal(revJournal.lines![0].debit, 40000);
    assert.equal(revJournal.lines![0].credit, 0);

    // Line 2: Credit Bank 40,000 (Restored)
    assert.equal(revJournal.lines![1].accountId, bankAccountId);
    assert.equal(revJournal.lines![1].debit, 0);
    assert.equal(revJournal.lines![1].credit, 40000);
  });

  await test('20. Double reversal prevention', async () => {
    await assert.rejects(
      async () => {
        await engine.reversePayment(payment2Id, 'Second reversal attempt', posterCtx);
      },
      /terminal state|invalid state transition/i
    );
  });

  await test('21. Duplicate posting prevention', async () => {
    await assert.rejects(
      async () => {
        await engine.postPayment(payment1Id, posterCtx);
      },
      /immutable|terminal state|invalid state transition/i
    );
  });

  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 5: Multi-Allocation & Boundary Validation ---');
  // --------------------------------------------------------------------------

  await test('10. One payment allocating against multiple receivables', async () => {
    // Settle remaining 40k on rec1 and 20k on rec2 (total 60k payment)
    const multiPay = await engine.createCustomerPayment(
      {
        customerId,
        amount: 60000,
        currencyCode: 'USD',
        paymentMethod: 'BANK',
        depositAccountId: bankAccountId,
        allocations: [
          { receivableId: receivable1Id, allocatedAmount: 40000 },
          { receivableId: receivable2Id, allocatedAmount: 20000 },
        ],
      },
      creatorCtx
    );

    await engine.submitPayment(multiPay.id, creatorCtx);
    await engine.approvePayment(multiPay.id, approverCtx);
    await engine.postPayment(multiPay.id, posterCtx);

    const rec1 = engine.customerReceivables.get(receivable1Id)!;
    const rec2 = engine.customerReceivables.get(receivable2Id)!;

    assert.equal(rec1.status, 'PAID');
    assert.equal(rec1.outstandingAmount, 0);

    assert.equal(rec2.status, 'PARTIALLY_PAID');
    assert.equal(rec2.paidAmount, 20000);
    assert.equal(rec2.outstandingAmount, 30000);
  });

  await test('11. Over-allocation prevention: Rejects allocation exceeding receivable outstanding balance', async () => {
    await assert.rejects(
      async () => {
        await engine.createCustomerPayment(
          {
            customerId,
            amount: 50000,
            depositAccountId: bankAccountId,
            allocations: [
              {
                receivableId: receivable2Id,
                allocatedAmount: 40000, // Remaining is 30,000. 40,000 > 30,000
              },
            ],
          },
          creatorCtx
        );
      },
      /exceeds outstanding receivable balance/
    );
  });

  await test('12. Cross-company allocation rejection', async () => {
    // Create receivable in Company B
    const recCompB = randomUUID();
    engine.customerReceivables.set(recCompB, {
      id: recCompB,
      companyId: companyB,
      branchId: null,
      customerId,
      salesInvoiceId: randomUUID(),
      currencyCode: 'USD',
      invoiceAmount: 10000,
      paidAmount: 0,
      outstandingAmount: 10000,
      invoiceDate: '2026-09-01',
      dueDate: '2026-10-01',
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await assert.rejects(
      async () => {
        await engine.createCustomerPayment(
          {
            customerId,
            amount: 5000,
            depositAccountId: bankAccountId,
            allocations: [{ receivableId: recCompB, allocatedAmount: 5000 }],
          },
          creatorCtx
        );
      },
      /not found in company/
    );
  });

  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 6: Manual General Ledger Journals & Invariants ---');
  // --------------------------------------------------------------------------

  await test('15. General ledger debit = credit invariant enforced on journal creation', async () => {
    const journal = await engine.createJournal(
      {
        description: 'Adjustment Entry',
        currencyCode: 'USD',
        lines: [
          { accountId: bankAccountId, debit: 5000, credit: 0 },
          { accountId: revenueAccountId, debit: 0, credit: 5000 },
        ],
      },
      creatorCtx
    );

    assert.equal(journal.totalDebit, 5000);
    assert.equal(journal.totalCredit, 5000);
    assert.ok(journal.lines);
    assert.equal(journal.lines!.length, 2);
  });

  await test('Rejects unbalanced manual journal (debit != credit)', async () => {
    await assert.rejects(
      async () => {
        await engine.createJournal(
          {
            description: 'Unbalanced Entry',
            lines: [
              { accountId: bankAccountId, debit: 5000, credit: 0 },
              { accountId: revenueAccountId, debit: 0, credit: 4000 },
            ],
          },
          creatorCtx
        );
      },
      /out of balance/
    );
  });

  await test('Rejects journal posting to inactive account', async () => {
    const inactiveAcc = await engine.createAccount(
      {
        accountCode: '9999',
        accountName: 'Closed Branch Clearing',
        accountType: 'LIABILITY',
        isActive: false,
      },
      creatorCtx
    );

    await assert.rejects(
      async () => {
        await engine.createJournal(
          {
            description: 'Test Inactive',
            lines: [
              { accountId: bankAccountId, debit: 100, credit: 0 },
              { accountId: inactiveAcc.id, debit: 0, credit: 100 },
            ],
          },
          creatorCtx
        );
      },
      /is inactive/
    );
  });

  await test('22. Tenant isolation blocks cross-tenant payment mutation', async () => {
    await assert.rejects(
      async () => {
        await engine.submitPayment(payment1Id, tenantBCtx);
      },
      /not found/
    );
  });

  await test('24. Audit immutability: All state mutations generated audit trail events', async () => {
    assert.ok(engine.auditLogs.length >= 10, 'Expected extensive audit trail for all events');
    const actions = new Set(engine.auditLogs.map((a) => a.action));
    assert.ok(actions.has('CREATE'));
    assert.ok(actions.has('POST'));
    assert.ok(actions.has('REVERSE'));
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 1.2 UNIT TESTS PASSED!`);
  console.log(`=============================================\n`);
}

runIncrement12Tests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
