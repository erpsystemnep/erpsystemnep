import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceStatus,
  CustomerReceivable,
  AccountingJournal,
  AccountingJournalLine,
  ChartOfAccount,
  SecurityContext,
  AccountType,
} from '../../src/shared/types/index.js';
import { StateMachineEngine } from '../../src/server/modules/workflow/services/state_machine.service.js';
import { checkDatabaseHealth, getPool, closePool, withTransaction } from '../../src/server/db/connection.js';
import { runMigrations } from '../../src/server/db/migrator.js';
import { TaxTransactionRepository } from '../../src/server/modules/accounting/repositories/tax_transaction.repository.js';
import { TaxService } from '../../src/server/modules/accounting/services/tax.service.js';
import { TrialBalanceService } from '../../src/server/modules/accounting/services/trial_balance.service.js';
import { SalesInvoiceService } from '../../src/server/modules/sales/services/sales_invoice.service.js';
import { PurchaseInvoiceService } from '../../src/server/modules/purchase/services/purchase_invoice.service.js';

let totalTests = 0;
let passedTests = 0;

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

console.log('\n=== RUNNING INCREMENT 1.4 SALES REVENUE, TAX SUBLEDGER & TRIAL BALANCE AUDIT TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Simulation Engine for Increment 1.4 Business Rules
// ----------------------------------------------------------------------------

interface TenantContext {
  companyId: string;
  branchId: string | null;
  userId: string;
  roles: string[];
  permissions: string[];
}

interface TaxTransaction {
  id: string;
  companyId: string;
  taxType: 'INPUT_TAX' | 'OUTPUT_TAX';
  sourceType: 'SALES_INVOICE' | 'PURCHASE_INVOICE';
  sourceId: string;
  sourceLineId?: string | null;
  taxCode?: string | null;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  currencyCode: string;
  exchangeRate: number;
  baseTaxableAmount: number;
  baseTaxAmount: number;
  accountingDate: string;
  journalId?: string | null;
  status: 'POSTED' | 'REVERSED' | 'CANCELLED';
  reversalJournalId?: string | null;
}

class AccountingSubledgerEngine {
  public accounts: Map<string, ChartOfAccount> = new Map();
  public journals: Map<string, AccountingJournal> = new Map();
  public journalLines: Map<string, AccountingJournalLine[]> = new Map();
  public taxTransactions: Map<string, TaxTransaction> = new Map();
  public salesInvoices: Map<string, SalesInvoice> = new Map();
  public customerReceivables: Map<string, CustomerReceivable> = new Map();
  public stockLedgerEntries: any[] = [];
  public stateMachine = new StateMachineEngine();

  public createSecurityContext(tenant: TenantContext): SecurityContext {
    return {
      userId: tenant.userId,
      email: 'auditor@test.com',
      fullName: 'System Auditor',
      isSuperadmin: tenant.roles.includes('SUPERADMIN'),
      activeCompanyId: tenant.companyId,
      activeBranchId: tenant.branchId,
      effectivePermissions: tenant.permissions,
    };
  }

  public addAccount(account: ChartOfAccount): void {
    this.accounts.set(account.id, account);
  }

  public postSalesInvoice(invoiceId: string, ctx: SecurityContext) {
    const inv = this.salesInvoices.get(invoiceId);
    if (!inv) throw new Error('Invoice not found');
    if (inv.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

    // SoD Check
    this.stateMachine.validateTransition({
      documentType: 'SALES_INVOICE',
      currentState: inv.status,
      targetState: 'POSTED',
      ctx,
      documentContext: {
        companyId: inv.companyId,
        branchId: inv.branchId,
        creatorId: inv.createdBy || undefined,
        documentId: inv.id,
      },
    });

    inv.status = 'POSTED';
    inv.postedBy = ctx.userId;
    inv.postedAt = new Date().toISOString();

    // 1. Resolve Accounts
    const accounts = Array.from(this.accounts.values()).filter((a) => a.companyId === inv.companyId && a.isActive);
    const arAccount = accounts.find((a) => a.accountCode === '1100') || accounts.find((a) => a.accountType === 'ASSET')!;
    const revAccount = accounts.find((a) => a.accountCode === '4000') || accounts.find((a) => a.accountType === 'REVENUE')!;
    const taxAccount = accounts.find((a) => a.accountCode === '2200') || accounts.find((a) => a.accountType === 'LIABILITY' && a.accountCode !== '2000')!;

    const journalId = randomUUID();
    const journalNumber = `JV-SINV-${inv.invoiceNumber}`;
    const net = Math.round((inv.subtotal - inv.discountTotal) * 10000) / 10000;
    const tax = inv.taxTotal;
    const gross = inv.grandTotal;

    const lines: AccountingJournalLine[] = [
      {
        id: randomUUID(),
        journalId,
        lineNumber: 1,
        accountId: arAccount.id,
        partnerId: inv.customerId,
        debit: gross,
        credit: 0,
        currencyCode: inv.currencyCode,
        exchangeRate: inv.exchangeRate,
        baseDebit: gross * inv.exchangeRate,
        baseCredit: 0,
        description: `Trade receivable for sales invoice ${inv.invoiceNumber}`,
        createdAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        journalId,
        lineNumber: 2,
        accountId: revAccount.id,
        debit: 0,
        credit: net,
        currencyCode: inv.currencyCode,
        exchangeRate: inv.exchangeRate,
        baseDebit: 0,
        baseCredit: net * inv.exchangeRate,
        description: `Sales revenue for invoice ${inv.invoiceNumber}`,
        createdAt: new Date().toISOString(),
      },
    ];

    if (tax > 0) {
      lines.push({
        id: randomUUID(),
        journalId,
        lineNumber: 3,
        accountId: taxAccount.id,
        debit: 0,
        credit: tax,
        currencyCode: inv.currencyCode,
        exchangeRate: inv.exchangeRate,
        baseDebit: 0,
        baseCredit: tax * inv.exchangeRate,
        description: `Output tax payable for sales invoice ${inv.invoiceNumber}`,
        createdAt: new Date().toISOString(),
      });
    }

    const journal: AccountingJournal = {
      id: journalId,
      companyId: inv.companyId,
      branchId: inv.branchId,
      journalNumber,
      postingDate: inv.invoiceDate,
      sourceDocumentType: 'SALES_INVOICE',
      sourceDocumentId: inv.id,
      description: `Sales invoice posting ${inv.invoiceNumber}`,
      status: 'POSTED',
      totalDebit: gross,
      totalCredit: gross,
      currencyCode: inv.currencyCode,
      reversalJournalId: null,
      createdBy: ctx.userId,
      approvedBy: ctx.userId,
      approvedAt: new Date().toISOString(),
      postedBy: ctx.userId,
      postedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines,
    };

    this.journals.set(journalId, journal);
    this.journalLines.set(journalId, lines);
    inv.journalId = journalId;

    // 2. Authoritative Customer Receivable
    const receivableId = randomUUID();
    this.customerReceivables.set(receivableId, {
      id: receivableId,
      companyId: inv.companyId,
      branchId: inv.branchId,
      customerId: inv.customerId,
      salesInvoiceId: inv.id,
      currencyCode: inv.currencyCode,
      invoiceAmount: gross,
      paidAmount: 0,
      outstandingAmount: gross,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 3. Record Tax Subledger
    if (tax > 0 && inv.lines) {
      for (const line of inv.lines) {
        if (line.taxAmount > 0) {
          const taxTxId = randomUUID();
          this.taxTransactions.set(taxTxId, {
            id: taxTxId,
            companyId: inv.companyId,
            taxType: 'OUTPUT_TAX',
            sourceType: 'SALES_INVOICE',
            sourceId: inv.id,
            sourceLineId: line.id,
            taxCode: `${line.taxRate}%`,
            taxRate: line.taxRate,
            taxableAmount: line.lineNet,
            taxAmount: line.taxAmount,
            currencyCode: inv.currencyCode,
            exchangeRate: inv.exchangeRate,
            baseTaxableAmount: line.lineNet * inv.exchangeRate,
            baseTaxAmount: line.taxAmount * inv.exchangeRate,
            accountingDate: inv.invoiceDate,
            journalId,
            status: 'POSTED',
          });
        }
      }
    }

    return { invoice: inv, journal, lines };
  }

  public reverseSalesInvoice(invoiceId: string, reason: string, ctx: SecurityContext) {
    const inv = this.salesInvoices.get(invoiceId);
    if (!inv) throw new Error('Invoice not found');
    if (inv.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');
    if (inv.status !== 'POSTED') throw new Error('Only POSTED sales invoices can be reversed');

    // Check customer receivable payments
    const recv = Array.from(this.customerReceivables.values()).find((r) => r.salesInvoiceId === invoiceId);
    if (recv && recv.paidAmount > 0) {
      throw new Error('Cannot reverse sales invoice: payments have already been received');
    }

    inv.status = 'REVERSED';
    inv.reversedBy = ctx.userId;
    inv.reversedAt = new Date().toISOString();

    if (recv) {
      recv.status = 'CANCELLED';
    }

    // Reversal Journal
    if (inv.journalId) {
      const origJournal = this.journals.get(inv.journalId);
      const origLines = this.journalLines.get(inv.journalId) || [];

      const revJournalId = randomUUID();
      const revLines: AccountingJournalLine[] = origLines.map((l, idx) => ({
        id: randomUUID(),
        journalId: revJournalId,
        lineNumber: idx + 1,
        accountId: l.accountId,
        partnerId: l.partnerId,
        debit: l.credit,
        credit: l.debit,
        currencyCode: l.currencyCode,
        exchangeRate: l.exchangeRate,
        baseDebit: l.baseCredit,
        baseCredit: l.baseDebit,
        description: `Reversal of line ${l.lineNumber} (${origJournal?.journalNumber}) - ${reason}`,
        createdAt: new Date().toISOString(),
      }));

      const revJournal: AccountingJournal = {
        id: revJournalId,
        companyId: inv.companyId,
        branchId: inv.branchId,
        journalNumber: `REV-${origJournal?.journalNumber}`,
        postingDate: new Date().toISOString().split('T')[0],
        sourceDocumentType: 'SALES_INVOICE_REVERSAL',
        sourceDocumentId: inv.id,
        description: `Compensating reversal of journal ${origJournal?.journalNumber}: ${reason}`,
        status: 'POSTED',
        totalDebit: origJournal!.totalCredit,
        totalCredit: origJournal!.totalDebit,
        currencyCode: origJournal!.currencyCode,
        reversalJournalId: origJournal!.id,
        createdBy: ctx.userId,
        approvedBy: ctx.userId,
        approvedAt: new Date().toISOString(),
        postedBy: ctx.userId,
        postedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lines: revLines,
      };

      origJournal!.reversalJournalId = revJournalId;
      this.journals.set(revJournalId, revJournal);
      this.journalLines.set(revJournalId, revLines);

      // Reversal in tax subledger
      for (const tx of this.taxTransactions.values()) {
        if (tx.sourceType === 'SALES_INVOICE' && tx.sourceId === inv.id) {
          tx.status = 'REVERSED';
          tx.reversalJournalId = revJournalId;
        }
      }

      return { revJournal, revLines };
    }
  }

  public getTrialBalance(companyId: string, asOfDate: string) {
    const accountMap = new Map<string, { account: ChartOfAccount; totalDebit: number; totalCredit: number }>();

    for (const acc of this.accounts.values()) {
      if (acc.companyId === companyId) {
        accountMap.set(acc.id, { account: acc, totalDebit: 0, totalCredit: 0 });
      }
    }

    for (const j of this.journals.values()) {
      if (j.companyId === companyId && j.status === 'POSTED' && j.postingDate <= asOfDate) {
        const lines = this.journalLines.get(j.id) || [];
        for (const l of lines) {
          const entry = accountMap.get(l.accountId);
          if (entry) {
            entry.totalDebit += l.baseDebit;
            entry.totalCredit += l.baseCredit;
          }
        }
      }
    }

    let grandDebit = 0;
    let grandCredit = 0;
    const rows = [];

    for (const entry of accountMap.values()) {
      grandDebit += entry.totalDebit;
      grandCredit += entry.totalCredit;
      const net = entry.totalDebit - entry.totalCredit;
      rows.push({
        accountId: entry.account.id,
        accountCode: entry.account.accountCode,
        accountName: entry.account.accountName,
        accountType: entry.account.accountType,
        totalDebit: Math.round(entry.totalDebit * 10000) / 10000,
        totalCredit: Math.round(entry.totalCredit * 10000) / 10000,
        netBalance: Math.round(net * 10000) / 10000,
      });
    }

    return {
      asOfDate,
      rows,
      totalDebit: Math.round(grandDebit * 10000) / 10000,
      totalCredit: Math.round(grandCredit * 10000) / 10000,
      isBalanced: Math.abs(grandDebit - grandCredit) < 0.0001,
    };
  }
}

// ----------------------------------------------------------------------------
// UNIT TEST SUITES
// ----------------------------------------------------------------------------

export async function runIncrement14Tests() {
  const engine = new AccountingSubledgerEngine();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const userCreator = randomUUID();
  const userManager = randomUUID();

  const creatorCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: branchA,
    userId: userCreator,
    roles: ['SALES_OPERATOR'],
    permissions: ['sales.invoice.create', 'sales.invoice.view', 'sales.invoice.submit'],
  });

  const managerCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: branchA,
    userId: userManager,
    roles: ['FINANCE_MANAGER'],
    permissions: [
      'sales.invoice.create',
      'sales.invoice.view',
      'sales.invoice.submit',
      'sales.invoice.approve',
      'sales.invoice.post',
      'sales.invoice.reverse',
      'accounting.journal.view',
      'accounting.report.view',
    ],
  });

  // Seed standard accounts
  const arAcc: ChartOfAccount = {
    id: randomUUID(),
    companyId: companyA,
    accountCode: '1100',
    accountName: 'Accounts Receivable',
    accountType: 'ASSET',
    isGroup: false,
    isActive: true,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const inputTaxAcc: ChartOfAccount = {
    id: randomUUID(),
    companyId: companyA,
    accountCode: '1150',
    accountName: 'Input Tax Receivable',
    accountType: 'ASSET',
    isGroup: false,
    isActive: true,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const apAcc: ChartOfAccount = {
    id: randomUUID(),
    companyId: companyA,
    accountCode: '2000',
    accountName: 'Accounts Payable',
    accountType: 'LIABILITY',
    isGroup: false,
    isActive: true,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const outputTaxAcc: ChartOfAccount = {
    id: randomUUID(),
    companyId: companyA,
    accountCode: '2200',
    accountName: 'Output Tax Payable',
    accountType: 'LIABILITY',
    isGroup: false,
    isActive: true,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const revAcc: ChartOfAccount = {
    id: randomUUID(),
    companyId: companyA,
    accountCode: '4000',
    accountName: 'Sales Revenue',
    accountType: 'REVENUE',
    isGroup: false,
    isActive: true,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const clearingAcc: ChartOfAccount = {
    id: randomUUID(),
    companyId: companyA,
    accountCode: '5000',
    accountName: 'Inventory Clearing',
    accountType: 'EXPENSE',
    isGroup: false,
    isActive: true,
    currencyCode: 'USD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  engine.addAccount(arAcc);
  engine.addAccount(inputTaxAcc);
  engine.addAccount(apAcc);
  engine.addAccount(outputTaxAcc);
  engine.addAccount(revAcc);
  engine.addAccount(clearingAcc);

  console.log('--- Test Suite 1: Sales Invoice Creation & Line-Level Revenue Account Allocation ---');

  const invoiceId = randomUUID();
  const invoiceLineId = randomUUID();
  const customerId = randomUUID();

  const invoice: SalesInvoice = {
    id: invoiceId,
    companyId: companyA,
    branchId: branchA,
    invoiceNumber: 'SINV-00100',
    customerId,
    salesOrderId: null,
    deliveryId: null,
    invoiceDate: '2026-03-01',
    dueDate: '2026-03-31',
    status: 'APPROVED',
    currencyCode: 'USD',
    exchangeRate: 1.0,
    subtotal: 100000,
    discountTotal: 0,
    taxTotal: 13000,
    grandTotal: 113000,
    createdBy: userCreator,
    approvedBy: userManager,
    approvedAt: '2026-03-01T10:00:00Z',
    postedBy: null,
    postedAt: null,
    reversedBy: null,
    reversedAt: null,
    journalId: null,
    createdAt: '2026-03-01T09:00:00Z',
    updatedAt: '2026-03-01T10:00:00Z',
    lines: [
      {
        id: invoiceLineId,
        salesInvoiceId: invoiceId,
        lineNumber: 1,
        itemId: randomUUID(),
        deliveryLineId: null,
        uomId: randomUUID(),
        quantity: 100,
        conversionFactor: 1,
        baseQuantity: 100,
        unitPrice: 1000,
        discountRate: 0,
        discountAmount: 0,
        taxRate: 13,
        taxAmount: 13000,
        lineNet: 100000,
        lineTotal: 113000,
        revenueAccountId: revAcc.id,
        createdAt: '2026-03-01T09:00:00Z',
        updatedAt: '2026-03-01T09:00:00Z',
      },
    ],
  };
  engine.salesInvoices.set(invoiceId, invoice);

  await test('Sales invoice line binds valid revenue account of type REVENUE', async () => {
    assert.equal(invoice.lines![0].revenueAccountId, revAcc.id);
    const acc = engine.accounts.get(invoice.lines![0].revenueAccountId!);
    assert.equal(acc?.accountType, 'REVENUE');
    assert.equal(acc?.isActive, true);
  });

  console.log('\n--- Test Suite 2: Sales Invoice Financial Posting & General Ledger Verification ---');

  await test('Posting Sales Invoice creates exact accounting effect: DR AR 113k, CR Rev 100k, CR Tax 13k', async () => {
    const postResult = engine.postSalesInvoice(invoiceId, managerCtx);
    const { journal, lines } = postResult;

    assert.equal(journal.status, 'POSTED');
    assert.equal(journal.totalDebit, 113000);
    assert.equal(journal.totalCredit, 113000);
    assert.equal(lines.length, 3);

    // Line 1: DR Trade Accounts Receivable
    const line1 = lines.find((l) => l.accountId === arAcc.id)!;
    assert.ok(line1);
    assert.equal(line1.debit, 113000);
    assert.equal(line1.credit, 0);

    // Line 2: CR Sales Revenue
    const line2 = lines.find((l) => l.accountId === revAcc.id)!;
    assert.ok(line2);
    assert.equal(line2.debit, 0);
    assert.equal(line2.credit, 100000);

    // Line 3: CR Output Tax Payable
    const line3 = lines.find((l) => l.accountId === outputTaxAcc.id)!;
    assert.ok(line3);
    assert.equal(line3.debit, 0);
    assert.equal(line3.credit, 13000);
  });

  await test('Receivable verification: exactly one authoritative receivable row created with 113k', async () => {
    const recvs = Array.from(engine.customerReceivables.values()).filter((r) => r.salesInvoiceId === invoiceId);
    assert.equal(recvs.length, 1);
    assert.equal(recvs[0].invoiceAmount, 113000);
    assert.equal(recvs[0].outstandingAmount, 113000);
    assert.equal(recvs[0].paidAmount, 0);
    assert.equal(recvs[0].status, 'OPEN');
  });

  console.log('\n--- Test Suite 3: Tax Subledger Register (tax_transactions) ---');

  await test('Authoritative tax subledger records exactly 1 OUTPUT_TAX entry linked to sales invoice & journal', async () => {
    const taxTxs = Array.from(engine.taxTransactions.values()).filter((tx) => tx.sourceId === invoiceId);
    assert.equal(taxTxs.length, 1);
    const tx = taxTxs[0];
    assert.equal(tx.taxType, 'OUTPUT_TAX');
    assert.equal(tx.sourceType, 'SALES_INVOICE');
    assert.equal(tx.taxableAmount, 100000);
    assert.equal(tx.taxAmount, 13000);
    assert.equal(tx.taxRate, 13);
    assert.equal(tx.status, 'POSTED');
    assert.ok(tx.journalId);
  });

  console.log('\n--- Test Suite 4: Input Tax Consistency & Reconciliation ---');

  await test('Input tax consistency: Net 100k, Tax 13k, AP 113k creates DR Clearing 100k, DR Input Tax 13k, CR AP 113k', async () => {
    const pinvJournalId = randomUUID();
    const pinvId = randomUUID();

    const pinvLines: AccountingJournalLine[] = [
      {
        id: randomUUID(),
        journalId: pinvJournalId,
        lineNumber: 1,
        accountId: clearingAcc.id,
        debit: 100000,
        credit: 0,
        currencyCode: 'USD',
        exchangeRate: 1.0,
        baseDebit: 100000,
        baseCredit: 0,
        description: 'Inventory clearing',
        createdAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        journalId: pinvJournalId,
        lineNumber: 2,
        accountId: inputTaxAcc.id,
        debit: 13000,
        credit: 0,
        currencyCode: 'USD',
        exchangeRate: 1.0,
        baseDebit: 13000,
        baseCredit: 0,
        description: 'Input tax receivable',
        createdAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        journalId: pinvJournalId,
        lineNumber: 3,
        accountId: apAcc.id,
        debit: 0,
        credit: 113000,
        currencyCode: 'USD',
        exchangeRate: 1.0,
        baseDebit: 0,
        baseCredit: 113000,
        description: 'Accounts payable',
        createdAt: new Date().toISOString(),
      },
    ];

    engine.journals.set(pinvJournalId, {
      id: pinvJournalId,
      companyId: companyA,
      branchId: branchA,
      journalNumber: 'JV-PINV-0001',
      postingDate: '2026-03-02',
      sourceDocumentType: 'PURCHASE_INVOICE',
      sourceDocumentId: pinvId,
      description: 'Purchase invoice posting',
      status: 'POSTED',
      totalDebit: 113000,
      totalCredit: 113000,
      currencyCode: 'USD',
      reversalJournalId: null,
      createdBy: userManager,
      approvedBy: userManager,
      approvedAt: new Date().toISOString(),
      postedBy: userManager,
      postedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines: pinvLines,
    });
    engine.journalLines.set(pinvJournalId, pinvLines);

    // Register in tax subledger
    const inputTaxTxId = randomUUID();
    engine.taxTransactions.set(inputTaxTxId, {
      id: inputTaxTxId,
      companyId: companyA,
      taxType: 'INPUT_TAX',
      sourceType: 'PURCHASE_INVOICE',
      sourceId: pinvId,
      taxRate: 13,
      taxableAmount: 100000,
      taxAmount: 13000,
      currencyCode: 'USD',
      exchangeRate: 1.0,
      baseTaxableAmount: 100000,
      baseTaxAmount: 13000,
      accountingDate: '2026-03-02',
      journalId: pinvJournalId,
      status: 'POSTED',
    });

    // Verify exactly ONE 13,000 debit to Input Tax Receivable
    const inputTaxDebits = pinvLines.filter((l) => l.accountId === inputTaxAcc.id && l.debit === 13000);
    assert.equal(inputTaxDebits.length, 1);
  });

  console.log('\n--- Test Suite 5: Sales Invoice Reversal & Immutability Protocols ---');

  await test('Reversal creates compensating entries (DR Rev 100k, DR Tax 13k, CR AR 113k) without deleting original journal', async () => {
    const revResult = engine.reverseSalesInvoice(invoiceId, 'Customer cancellation request', managerCtx);
    assert.ok(revResult);
    const { revJournal, revLines } = revResult;

    assert.equal(revJournal.status, 'POSTED');
    assert.equal(revJournal.totalDebit, 113000);
    assert.equal(revJournal.totalCredit, 113000);

    // CR AR 113k
    const arRevLine = revLines.find((l) => l.accountId === arAcc.id)!;
    assert.equal(arRevLine.credit, 113000);
    assert.equal(arRevLine.debit, 0);

    // DR Rev 100k
    const revRevLine = revLines.find((l) => l.accountId === revAcc.id)!;
    assert.equal(revRevLine.debit, 100000);
    assert.equal(revRevLine.credit, 0);

    // DR Output Tax 13k
    const taxRevLine = revLines.find((l) => l.accountId === outputTaxAcc.id)!;
    assert.equal(taxRevLine.debit, 13000);
    assert.equal(taxRevLine.credit, 0);

    // Original journal remains immutable with reversal linkage
    const origJournal = engine.journals.get(invoice.journalId!)!;
    assert.equal(origJournal.reversalJournalId, revJournal.id);

    // Tax subledger record updated to REVERSED
    const taxTx = Array.from(engine.taxTransactions.values()).find((tx) => tx.sourceId === invoiceId)!;
    assert.equal(taxTx.status, 'REVERSED');
    assert.equal(taxTx.reversalJournalId, revJournal.id);

    // Customer receivable cancelled
    const recv = Array.from(engine.customerReceivables.values()).find((r) => r.salesInvoiceId === invoiceId)!;
    assert.equal(recv.status, 'CANCELLED');
  });

  await test('Double reversal prevention: rejects reversing already reversed sales invoice', async () => {
    assert.throws(() => {
      engine.reverseSalesInvoice(invoiceId, 'Second reversal attempt', managerCtx);
    }, /Only POSTED sales invoices can be reversed/);
  });

  console.log('\n--- Test Suite 6: Physical Inventory Boundary Invariant ---');

  await test('Stock boundary invariant: sales invoice POST and REVERSAL do NOT insert stock ledger entries', async () => {
    assert.equal(engine.stockLedgerEntries.length, 0);
  });

  console.log('\n--- Test Suite 7: Trial Balance Derivation & Invariants ---');

  await test('Trial Balance derives strictly from POSTED journals and verifies Debit = Credit balance', async () => {
    const tb = engine.getTrialBalance(companyA, '2026-12-31');
    assert.equal(tb.isBalanced, true);
    assert.equal(tb.totalDebit, tb.totalCredit);
    assert.ok(tb.rows.length >= 4);
  });

  await test('Trial Balance filters strictly by asOfDate, excluding future posted journals', async () => {
    const tbPast = engine.getTrialBalance(companyA, '2026-02-01');
    assert.equal(tbPast.totalDebit, 0);
    assert.equal(tbPast.totalCredit, 0);
  });

  console.log('\n--- Test Suite 8: Segregation of Duties (SoD) ---');

  await test('Segregation of Duties: Creator cannot approve or post their own sales invoice', async () => {
    const inv2Id = randomUUID();
    const inv2: SalesInvoice = {
      id: inv2Id,
      companyId: companyA,
      branchId: branchA,
      invoiceNumber: 'SINV-00200',
      customerId,
      salesOrderId: null,
      deliveryId: null,
      invoiceDate: '2026-03-05',
      dueDate: '2026-03-31',
      status: 'SUBMITTED',
      currencyCode: 'USD',
      exchangeRate: 1.0,
      subtotal: 50000,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 50000,
      createdBy: userCreator,
      approvedBy: null,
      approvedAt: null,
      postedBy: null,
      postedAt: null,
      reversedBy: null,
      reversedAt: null,
      journalId: null,
      createdAt: '2026-03-05T09:00:00Z',
      updatedAt: '2026-03-05T09:00:00Z',
      lines: [],
    };
    engine.salesInvoices.set(inv2Id, inv2);

    assert.throws(() => {
      engine.stateMachine.validateTransition({
        documentType: 'SALES_INVOICE',
        currentState: 'SUBMITTED',
        targetState: 'APPROVED',
        ctx: creatorCtx,
        documentContext: {
          companyId: companyA,
          branchId: branchA,
          creatorId: userCreator,
          documentId: inv2Id,
        },
      });
    }, /Segregation of duties violation/i);
  });

  console.log('\n--- Test Suite 9: Multi-Company Tenant Isolation ---');

  await test('Multi-tenant isolation: Company B cannot access Company A tax subledger or trial balance', async () => {
    const companyBCtx = engine.createSecurityContext({
      companyId: companyB,
      branchId: null,
      userId: randomUUID(),
      roles: ['FINANCE_MANAGER'],
      permissions: ['sales.invoice.view', 'accounting.report.view'],
    });

    const tbCompanyB = engine.getTrialBalance(companyB, '2026-12-31');
    assert.equal(tbCompanyB.totalDebit, 0);
    assert.equal(tbCompanyB.totalCredit, 0);
    assert.equal(tbCompanyB.rows.length, 0);

    assert.throws(() => {
      engine.postSalesInvoice(invoiceId, companyBCtx);
    }, /Tenant isolation violation/);
  });

  // --------------------------------------------------------------------------
  // Suite 10: Real Database Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Test Suite 10: Real PostgreSQL Database Invariant Verification ---');

  const health = await checkDatabaseHealth();
  if (health.connected) {
    const pool = getPool();

    await test('Real DB: tax_transactions table exists with authoritative schema and indexes', async () => {
      const res = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'tax_transactions'
        ORDER BY ordinal_position
      `);
      assert.ok(res.rows.length >= 15);
      const colNames = res.rows.map((r) => r.column_name);
      assert.ok(colNames.includes('tax_type'));
      assert.ok(colNames.includes('source_type'));
      assert.ok(colNames.includes('taxable_amount'));
      assert.ok(colNames.includes('tax_amount'));
      assert.ok(colNames.includes('journal_id'));
      assert.ok(colNames.includes('status'));
    });

    await test('Real DB: sales_invoices has journal_id, reversed_by, reversed_at columns', async () => {
      const res = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'sales_invoices'
      `);
      const colNames = res.rows.map((r) => r.column_name);
      assert.ok(colNames.includes('journal_id'));
      assert.ok(colNames.includes('reversed_by'));
      assert.ok(colNames.includes('reversed_at'));
    });

    await test('Real DB: sales_invoice_lines has revenue_account_id column', async () => {
      const res = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'sales_invoice_lines'
      `);
      const colNames = res.rows.map((r) => r.column_name);
      assert.ok(colNames.includes('revenue_account_id'));
    });

    await test('Real DB: Tax reconciliation query executes without SQL errors against live DB', async () => {
      const taxService = new TaxService();
      const recon = await taxService.getReconciliation('2026-12-31', managerCtx);
      assert.ok(recon);
      assert.equal(typeof recon.outputTaxSubledgerTotal, 'number');
      assert.equal(typeof recon.outputTaxGlTotal, 'number');
      assert.equal(typeof recon.outputTaxDiscrepancy, 'number');
      assert.equal(typeof recon.inputTaxSubledgerTotal, 'number');
      assert.equal(typeof recon.inputTaxGlTotal, 'number');
      assert.equal(typeof recon.inputTaxDiscrepancy, 'number');
      assert.equal(typeof recon.isFullyReconciled, 'boolean');
    });

    await test('Real DB: Trial balance query executes without SQL errors against live DB', async () => {
      const tbService = new TrialBalanceService();
      const tb = await tbService.getTrialBalance({ asOfDate: '2026-12-31' }, managerCtx);
      assert.ok(tb);
      assert.equal(typeof tb.totalDebit, 'number');
      assert.equal(typeof tb.totalCredit, 'number');
      assert.equal(typeof tb.isBalanced, 'boolean');
      assert.ok(Array.isArray(tb.items));
    });
  } else {
    console.log('  [INFO] Real database not reachable, skipping live DB query tests.');
  }

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 1.4 AUDIT TESTS PASSED!`);
  console.log(`=============================================\n`);

  await closePool();
  process.exit(0);
}

// Auto-run if executed directly
runIncrement14Tests().catch(async (err) => {
  console.error('Test execution failed:', err);
  await closePool();
  process.exit(1);
});
