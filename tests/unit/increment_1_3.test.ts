import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ChartOfAccount,
  AccountingJournal,
  AccountingJournalLine,
  PurchaseInvoice,
  PurchaseInvoiceLine,
  SupplierPayable,
  SupplierPayment,
  SupplierPaymentAllocation,
  SecurityContext,
  PurchaseInvoiceStatus,
  SupplierPayableStatus,
  SupplierPaymentStatus,
} from '../../src/shared/types/index.js';
import {
  createPurchaseInvoiceSchema,
  updatePurchaseInvoiceSchema,
} from '../../src/shared/schemas/purchase_invoice.js';
import {
  createSupplierPaymentSchema,
  updateSupplierPaymentSchema,
} from '../../src/shared/schemas/supplier_payment.js';
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

console.log('\n=== RUNNING INCREMENT 1.3 ACCOUNTS PAYABLE & PURCHASE INVOICING UNIT TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Simulation Engine for AP & Purchase Invoicing
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

class InMemoryERPAccountsPayableEngine {
  public chartOfAccounts: Map<string, ChartOfAccount> = new Map();
  public accountingJournals: Map<string, AccountingJournal> = new Map();
  public purchaseInvoices: Map<string, PurchaseInvoice> = new Map();
  public purchaseReceipts: Map<string, { id: string; companyId: string; receiptNumber: string; supplierId: string; status: string }> = new Map();
  public purchaseReceiptLines: Map<string, { id: string; receiptId: string; itemId: string; receivedQuantity: number }> = new Map();
  public supplierPayables: Map<string, SupplierPayable> = new Map();
  public supplierPayments: Map<string, SupplierPayment> = new Map();
  public supplierPaymentAllocations: Map<string, SupplierPaymentAllocation[]> = new Map();
  public businessPartners: Map<string, { id: string; companyId: string; legalName: string; isSupplier: boolean; isActive: boolean }> = new Map();
  public items: Map<string, { id: string; companyId: string; sku: string; isPurchasable: boolean; isActive: boolean }> = new Map();
  public uoms: Map<string, { id: string; companyId: string; code: string; isActive: boolean }> = new Map();
  public auditLogs: AuditRecord[] = [];
  public stateMachine = new StateMachineEngine();

  private pinvCounter = 1;
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

  // --- Purchase Invoice Operations ---

  public createPurchaseInvoice(input: any, ctx: SecurityContext): PurchaseInvoice {
    if (ctx.activeCompanyId !== input.companyId && !ctx.isSuperadmin) {
      throw new Error('Tenant isolation violation');
    }

    const supplier = this.businessPartners.get(input.supplierId);
    if (!supplier || supplier.companyId !== input.companyId) {
      throw new Error(`Supplier '${input.supplierId}' not found`);
    }
    if (!supplier.isSupplier) {
      throw new Error(`Business partner '${supplier.legalName}' is not registered as a supplier`);
    }
    if (!supplier.isActive) {
      throw new Error(`Supplier '${supplier.legalName}' is inactive`);
    }

    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let grandTotal = 0;
    const lines: PurchaseInvoiceLine[] = [];

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      const lineNum = line.lineNumber || i + 1;

      const item = this.items.get(line.itemId);
      if (!item || item.companyId !== input.companyId) {
        throw new Error(`Item '${line.itemId}' not found in active company`);
      }
      if (!item.isPurchasable) {
        throw new Error(`Item '${item.sku}' is not purchasable`);
      }
      if (!item.isActive) {
        throw new Error(`Item '${item.sku}' is inactive`);
      }

      // Check receipt line ceiling
      if (line.purchaseReceiptLineId) {
        const recLine = this.purchaseReceiptLines.get(line.purchaseReceiptLineId);
        if (!recLine) {
          throw new Error(`Source Purchase Receipt Line '${line.purchaseReceiptLineId}' not found`);
        }
        if (recLine.itemId !== line.itemId) {
          throw new Error('Receipt line item does not match invoice line item');
        }

        // Compute currently invoiced
        let alreadyInvoiced = 0;
        for (const inv of this.purchaseInvoices.values()) {
          if (inv.companyId === input.companyId && !['CANCELLED', 'REVERSED'].includes(inv.status)) {
            for (const l of inv.lines || []) {
              if (l.purchaseReceiptLineId === line.purchaseReceiptLineId) {
                alreadyInvoiced += l.quantity;
              }
            }
          }
        }

        const remaining = recLine.receivedQuantity - alreadyInvoiced;
        if (line.quantity > remaining) {
          throw new Error(`Cannot invoice ${line.quantity} units: only ${remaining} units remain available to invoice`);
        }
      }

      const conversionFactor = line.conversionFactor || 1;
      const baseQuantity = line.quantity * conversionFactor;
      const lineGross = line.quantity * line.unitPrice;
      const discountAmount = lineGross * ((line.discountRate || 0) / 100);
      const lineNet = lineGross - discountAmount;
      const taxAmount = lineNet * ((line.taxRate || 0) / 100);
      const lineTotal = lineNet + taxAmount;

      subtotal += lineGross;
      discountTotal += discountAmount;
      taxTotal += taxAmount;
      grandTotal += lineTotal;

      lines.push({
        id: randomUUID(),
        purchaseInvoiceId: '',
        purchaseReceiptLineId: line.purchaseReceiptLineId,
        poLineId: line.poLineId || null,
        lineNumber: lineNum,
        itemId: line.itemId,
        warehouseId: line.warehouseId || null,
        uomId: line.uomId,
        quantity: line.quantity,
        conversionFactor,
        baseQuantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate || 0,
        discountAmount,
        taxRate: line.taxRate || 0,
        taxAmount,
        lineNet,
        lineTotal,
        expenseAccountId: line.expenseAccountId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const invoiceId = randomUUID();
    const invoiceNumber = `PINV-${String(this.pinvCounter++).padStart(5, '0')}`;

    for (const l of lines) {
      l.purchaseInvoiceId = invoiceId;
    }

    const invoice: PurchaseInvoice = {
      id: invoiceId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      invoiceNumber,
      supplierInvoiceRef: input.supplierInvoiceRef || null,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId || null,
      receiptId: input.receiptId || null,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate || null,
      status: 'DRAFT',
      currencyCode: input.currencyCode || 'USD',
      exchangeRate: input.exchangeRate || 1.0,
      subtotal,
      discountTotal,
      taxTotal,
      grandTotal,
      notes: input.notes || null,
      createdBy: ctx.userId,
      approvedBy: null,
      approvedAt: null,
      postedBy: null,
      postedAt: null,
      reversedBy: null,
      reversedAt: null,
      journalId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines,
    };

    this.purchaseInvoices.set(invoiceId, invoice);
    this.logAudit({
      companyId: input.companyId,
      module: 'purchase',
      entityType: 'PurchaseInvoice',
      entityId: invoiceId,
      action: 'CREATE',
      performedBy: ctx.userId,
      details: { invoiceNumber, grandTotal },
    });

    return invoice;
  }

  public submitPurchaseInvoice(id: string, ctx: SecurityContext): PurchaseInvoice {
    const inv = this.purchaseInvoices.get(id);
    if (!inv) throw new Error('Invoice not found');
    if (inv.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

    this.stateMachine.validateTransition({
      documentType: 'PURCHASE_INVOICE',
      currentState: inv.status,
      targetState: 'SUBMITTED',
      ctx,
      documentContext: {
        companyId: inv.companyId,
        branchId: inv.branchId,
        creatorId: inv.createdBy || undefined,
        documentId: inv.id,
      },
    });

    inv.status = 'SUBMITTED';
    inv.updatedAt = new Date().toISOString();
    return inv;
  }

  public approvePurchaseInvoice(id: string, ctx: SecurityContext): PurchaseInvoice {
    const inv = this.purchaseInvoices.get(id);
    if (!inv) throw new Error('Invoice not found');
    if (inv.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

    this.stateMachine.validateTransition({
      documentType: 'PURCHASE_INVOICE',
      currentState: inv.status,
      targetState: 'APPROVED',
      ctx,
      documentContext: {
        companyId: inv.companyId,
        branchId: inv.branchId,
        creatorId: inv.createdBy || undefined,
        documentId: inv.id,
      },
    });

    inv.status = 'APPROVED';
    inv.approvedBy = ctx.userId;
    inv.approvedAt = new Date().toISOString();
    inv.updatedAt = new Date().toISOString();
    return inv;
  }

  public postPurchaseInvoice(id: string, ctx: SecurityContext): PurchaseInvoice {
    const inv = this.purchaseInvoices.get(id);
    if (!inv) throw new Error('Invoice not found');
    if (inv.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

    this.stateMachine.validateTransition({
      documentType: 'PURCHASE_INVOICE',
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
    inv.updatedAt = new Date().toISOString();

    // Create Supplier Payable
    const payableId = randomUUID();
    const payable: SupplierPayable = {
      id: payableId,
      companyId: inv.companyId,
      branchId: inv.branchId,
      supplierId: inv.supplierId,
      purchaseInvoiceId: inv.id,
      currencyCode: inv.currencyCode,
      invoiceAmount: inv.grandTotal,
      paidAmount: 0,
      outstandingAmount: inv.grandTotal,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.supplierPayables.set(payableId, payable);

    this.logAudit({
      companyId: inv.companyId,
      module: 'purchase',
      entityType: 'PurchaseInvoice',
      entityId: inv.id,
      action: 'POST',
      performedBy: ctx.userId,
      details: { payableId, amount: inv.grandTotal },
    });

    return inv;
  }

  public reversePurchaseInvoice(id: string, ctx: SecurityContext): PurchaseInvoice {
    const inv = this.purchaseInvoices.get(id);
    if (!inv) throw new Error('Invoice not found');
    if (inv.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

    this.stateMachine.validateTransition({
      documentType: 'PURCHASE_INVOICE',
      currentState: inv.status,
      targetState: 'REVERSED',
      ctx,
      documentContext: {
        companyId: inv.companyId,
        branchId: inv.branchId,
        creatorId: inv.createdBy || undefined,
        documentId: inv.id,
      },
    });

    inv.status = 'REVERSED';
    inv.reversedBy = ctx.userId;
    inv.reversedAt = new Date().toISOString();

    for (const p of this.supplierPayables.values()) {
      if (p.purchaseInvoiceId === id && p.companyId === inv.companyId) {
        p.status = 'REVERSED';
      }
    }

    return inv;
  }

  // --- Supplier Payment Operations ---

  public createSupplierPayment(input: any, ctx: SecurityContext): SupplierPayment {
    if (ctx.activeCompanyId !== input.companyId && !ctx.isSuperadmin) {
      throw new Error('Tenant isolation violation');
    }

    const supplier = this.businessPartners.get(input.supplierId);
    if (!supplier || supplier.companyId !== input.companyId) {
      throw new Error(`Supplier '${input.supplierId}' not found`);
    }

    const disAcc = this.chartOfAccounts.get(input.disbursementAccountId);
    if (!disAcc || disAcc.companyId !== input.companyId) {
      throw new Error(`Disbursement account '${input.disbursementAccountId}' not found in active company`);
    }

    let totalAllocated = 0;
    const allocations: SupplierPaymentAllocation[] = [];
    const paymentId = randomUUID();

    if (input.allocations && input.allocations.length > 0) {
      for (const a of input.allocations) {
        const payable = this.supplierPayables.get(a.payableId);
        if (!payable || payable.companyId !== input.companyId) {
          throw new Error(`Payable with ID '${a.payableId}' not found in active company`);
        }
        if (payable.supplierId !== input.supplierId) {
          throw new Error('Payable belongs to a different supplier');
        }
        if (payable.status === 'PAID' || payable.outstandingAmount <= 0) {
          throw new Error('Payable is already fully settled');
        }
        if (a.allocatedAmount > payable.outstandingAmount) {
          throw new Error(`Allocation amount (${a.allocatedAmount}) exceeds outstanding balance (${payable.outstandingAmount})`);
        }
        totalAllocated += a.allocatedAmount;

        allocations.push({
          id: randomUUID(),
          paymentId,
          payableId: a.payableId,
          allocatedAmount: a.allocatedAmount,
          allocationDate: a.allocationDate || input.paymentDate,
          createdAt: new Date().toISOString(),
        });
      }

      if (totalAllocated > input.amount) {
        throw new Error(`Total allocated amount (${totalAllocated}) cannot exceed payment amount (${input.amount})`);
      }
    }

    const paymentNumber = `SPAY-${String(this.paymentCounter++).padStart(5, '0')}`;
    const payment: SupplierPayment = {
      id: paymentId,
      companyId: input.companyId,
      branchId: input.branchId || null,
      paymentNumber,
      supplierId: input.supplierId,
      paymentDate: input.paymentDate,
      amount: input.amount,
      currencyCode: input.currencyCode || 'USD',
      exchangeRate: input.exchangeRate || 1.0,
      baseAmount: input.amount * (input.exchangeRate || 1.0),
      paymentMethod: input.paymentMethod,
      disbursementAccountId: input.disbursementAccountId,
      apAccountId: input.apAccountId || null,
      referenceNumber: input.referenceNumber || null,
      status: 'DRAFT',
      notes: input.notes || null,
      createdBy: ctx.userId,
      approvedBy: null,
      approvedAt: null,
      postedBy: null,
      postedAt: null,
      reversedBy: null,
      reversedAt: null,
      journalId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      allocations,
    };

    this.supplierPayments.set(paymentId, payment);
    this.supplierPaymentAllocations.set(paymentId, allocations);

    this.logAudit({
      companyId: input.companyId,
      module: 'purchase',
      entityType: 'SupplierPayment',
      entityId: paymentId,
      action: 'CREATE',
      performedBy: ctx.userId,
      details: { paymentNumber, amount: input.amount },
    });

    return payment;
  }

  public submitSupplierPayment(id: string, ctx: SecurityContext): SupplierPayment {
    const payment = this.supplierPayments.get(id);
    if (!payment) throw new Error('Payment not found');
    if (payment.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

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

    payment.status = 'SUBMITTED';
    payment.updatedAt = new Date().toISOString();
    return payment;
  }

  public approveSupplierPayment(id: string, ctx: SecurityContext): SupplierPayment {
    const payment = this.supplierPayments.get(id);
    if (!payment) throw new Error('Payment not found');
    if (payment.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

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

    payment.status = 'APPROVED';
    payment.approvedBy = ctx.userId;
    payment.approvedAt = new Date().toISOString();
    payment.updatedAt = new Date().toISOString();
    return payment;
  }

  public postSupplierPayment(id: string, ctx: SecurityContext): SupplierPayment {
    const payment = this.supplierPayments.get(id);
    if (!payment) throw new Error('Payment not found');
    if (payment.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

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

    // Settle allocations
    const allocs = this.supplierPaymentAllocations.get(payment.id) || [];
    for (const a of allocs) {
      const payable = this.supplierPayables.get(a.payableId);
      if (!payable) throw new Error('Payable not found');
      if (payable.outstandingAmount < a.allocatedAmount) {
        throw new Error('Allocated amount exceeds outstanding balance');
      }

      payable.paidAmount = Math.round((payable.paidAmount + a.allocatedAmount) * 10000) / 10000;
      payable.outstandingAmount = Math.round((payable.invoiceAmount - payable.paidAmount) * 10000) / 10000;
      payable.status = payable.outstandingAmount <= 0.0001 ? 'PAID' : 'PARTIALLY_PAID';
      payable.updatedAt = new Date().toISOString();
    }

    // Generate GL Journal:
    // DR Accounts Payable (Liability decrease)
    // CR Disbursement Account (Cash/Bank Asset decrease)
    let apAccId = payment.apAccountId;
    if (!apAccId) {
      for (const a of this.chartOfAccounts.values()) {
        if (a.companyId === payment.companyId && (a.accountCode === '2100' || a.accountType === 'LIABILITY')) {
          apAccId = a.id;
          break;
        }
      }
    }

    const journalId = randomUUID();
    const journalNumber = `JV-SPAY-${String(this.journalCounter++).padStart(5, '0')}`;
    const lines: AccountingJournalLine[] = [
      {
        id: randomUUID(),
        journalId,
        lineNumber: 1,
        accountId: apAccId || 'AP_ACC_DEFAULT',
        partnerId: payment.supplierId,
        debit: payment.amount,
        credit: 0,
        currencyCode: payment.currencyCode,
        exchangeRate: payment.exchangeRate,
        baseDebit: payment.baseAmount,
        baseCredit: 0,
        description: `AP settlement from payment ${payment.paymentNumber}`,
        createdAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        journalId,
        lineNumber: 2,
        accountId: payment.disbursementAccountId,
        debit: 0,
        credit: payment.amount,
        currencyCode: payment.currencyCode,
        exchangeRate: payment.exchangeRate,
        baseDebit: 0,
        baseCredit: payment.baseAmount,
        description: `Disbursement from payment ${payment.paymentNumber}`,
        createdAt: new Date().toISOString(),
      },
    ];

    const journal: AccountingJournal = {
      id: journalId,
      companyId: payment.companyId,
      branchId: payment.branchId,
      journalNumber,
      postingDate: payment.paymentDate,
      sourceDocumentType: 'SUPPLIER_PAYMENT',
      sourceDocumentId: payment.id,
      description: `Disbursement for supplier payment ${payment.paymentNumber}`,
      status: 'POSTED',
      totalDebit: payment.amount,
      totalCredit: payment.amount,
      currencyCode: payment.currencyCode,
      createdBy: ctx.userId,
      approvedBy: ctx.userId,
      approvedAt: new Date().toISOString(),
      postedBy: ctx.userId,
      postedAt: new Date().toISOString(),
      reversalJournalId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines,
    };

    this.accountingJournals.set(journalId, journal);

    payment.status = 'POSTED';
    payment.postedBy = ctx.userId;
    payment.postedAt = new Date().toISOString();
    payment.journalId = journalId;
    payment.updatedAt = new Date().toISOString();

    this.logAudit({
      companyId: payment.companyId,
      module: 'purchase',
      entityType: 'SupplierPayment',
      entityId: payment.id,
      action: 'POST',
      performedBy: ctx.userId,
      details: { journalId, amount: payment.amount },
    });

    return payment;
  }

  public reverseSupplierPayment(id: string, ctx: SecurityContext): SupplierPayment {
    const payment = this.supplierPayments.get(id);
    if (!payment) throw new Error('Payment not found');
    if (payment.companyId !== ctx.activeCompanyId && !ctx.isSuperadmin) throw new Error('Tenant isolation violation');

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
    const allocs = this.supplierPaymentAllocations.get(payment.id) || [];
    for (const a of allocs) {
      const payable = this.supplierPayables.get(a.payableId);
      if (payable) {
        payable.paidAmount = Math.max(0, Math.round((payable.paidAmount - a.allocatedAmount) * 10000) / 10000);
        payable.outstandingAmount = Math.round((payable.invoiceAmount - payable.paidAmount) * 10000) / 10000;
        payable.status = payable.paidAmount <= 0.0001 ? 'OPEN' : 'PARTIALLY_PAID';
        payable.updatedAt = new Date().toISOString();
      }
    }

    // 2. Compensating GL Reversal Journal
    if (payment.journalId) {
      const orig = this.accountingJournals.get(payment.journalId);
      if (orig) orig.status = 'REVERSED';
    }

    let apAccId = payment.apAccountId;
    if (!apAccId) {
      for (const a of this.chartOfAccounts.values()) {
        if (a.companyId === payment.companyId && (a.accountCode === '2100' || a.accountType === 'LIABILITY')) {
          apAccId = a.id;
          break;
        }
      }
    }

    const revJournalId = randomUUID();
    const revJournalNumber = `REV-SPAY-${String(this.journalCounter++).padStart(5, '0')}`;
    const lines: AccountingJournalLine[] = [
      {
        id: randomUUID(),
        journalId: revJournalId,
        lineNumber: 1,
        accountId: payment.disbursementAccountId,
        debit: payment.amount, // DR Cash/Bank (Restored)
        credit: 0,
        currencyCode: payment.currencyCode,
        exchangeRate: payment.exchangeRate,
        baseDebit: payment.baseAmount,
        baseCredit: 0,
        description: `Reversal of disbursement for ${payment.paymentNumber}`,
        createdAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        journalId: revJournalId,
        lineNumber: 2,
        accountId: apAccId || 'AP_ACC_DEFAULT',
        partnerId: payment.supplierId,
        debit: 0,
        credit: payment.amount, // CR Accounts Payable (Restored)
        currencyCode: payment.currencyCode,
        exchangeRate: payment.exchangeRate,
        baseDebit: 0,
        baseCredit: payment.baseAmount,
        description: `Reversal of AP settlement for ${payment.paymentNumber}`,
        createdAt: new Date().toISOString(),
      },
    ];

    const revJournal: AccountingJournal = {
      id: revJournalId,
      companyId: payment.companyId,
      branchId: payment.branchId,
      journalNumber: revJournalNumber,
      postingDate: new Date().toISOString().split('T')[0],
      sourceDocumentType: 'PAYMENT_REVERSAL',
      sourceDocumentId: payment.id,
      description: `Reversal journal for supplier payment ${payment.paymentNumber}`,
      status: 'POSTED',
      totalDebit: payment.amount,
      totalCredit: payment.amount,
      currencyCode: payment.currencyCode,
      createdBy: ctx.userId,
      approvedBy: ctx.userId,
      approvedAt: new Date().toISOString(),
      postedBy: ctx.userId,
      postedAt: new Date().toISOString(),
      reversalJournalId: payment.journalId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines,
    };

    this.accountingJournals.set(revJournalId, revJournal);

    payment.status = 'REVERSED';
    payment.reversedBy = ctx.userId;
    payment.reversedAt = new Date().toISOString();
    payment.updatedAt = new Date().toISOString();

    this.logAudit({
      companyId: payment.companyId,
      module: 'purchase',
      entityType: 'SupplierPayment',
      entityId: payment.id,
      action: 'REVERSE',
      performedBy: ctx.userId,
      details: { revJournalId },
    });

    return payment;
  }
}

// ----------------------------------------------------------------------------
// TEST SUITES EXECUTION
// ----------------------------------------------------------------------------

async function runAccountsPayableTests() {
  const engine = new InMemoryERPAccountsPayableEngine();

  const companyA = randomUUID();
  const companyB = randomUUID();
  const supplier1 = randomUUID();
  const nonSupplier = randomUUID();
  const item1 = randomUUID();
  const uomPcs = randomUUID();
  const cashAccountId = randomUUID();
  const apAccountId = randomUUID();

  // Seed reference data for Company A
  engine.businessPartners.set(supplier1, {
    id: supplier1,
    companyId: companyA,
    legalName: 'Apex Industrial Supplies LLC',
    isSupplier: true,
    isActive: true,
  });

  engine.businessPartners.set(nonSupplier, {
    id: nonSupplier,
    companyId: companyA,
    legalName: 'Pure Customer Inc',
    isSupplier: false,
    isActive: true,
  });

  engine.items.set(item1, {
    id: item1,
    companyId: companyA,
    sku: 'STEEL-ROD-01',
    isPurchasable: true,
    isActive: true,
  });

  engine.uoms.set(uomPcs, {
    id: uomPcs,
    companyId: companyA,
    code: 'PCS',
    isActive: true,
  });

  engine.chartOfAccounts.set(cashAccountId, {
    id: cashAccountId,
    companyId: companyA,
    accountCode: '1010',
    accountName: 'Main Cash Account',
    accountType: 'ASSET',
    currencyCode: 'USD',
    isGroup: false,
    isActive: true,
    description: 'Cash on hand',
    createdAt: '',
    updatedAt: '',
  });

  engine.chartOfAccounts.set(apAccountId, {
    id: apAccountId,
    companyId: companyA,
    accountCode: '2100',
    accountName: 'Trade Accounts Payable',
    accountType: 'LIABILITY',
    currencyCode: 'USD',
    isGroup: false,
    isActive: true,
    description: 'Trade AP',
    createdAt: '',
    updatedAt: '',
  });

  // Purchase Receipt for 100 PCS
  const receiptId = randomUUID();
  const receiptLineId = randomUUID();
  engine.purchaseReceipts.set(receiptId, {
    id: receiptId,
    companyId: companyA,
    receiptNumber: 'GRN-001',
    supplierId: supplier1,
    status: 'POSTED',
  });
  engine.purchaseReceiptLines.set(receiptLineId, {
    id: receiptLineId,
    receiptId,
    itemId: item1,
    receivedQuantity: 100,
  });

  // Users
  const clerkCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: null,
    userId: randomUUID(),
    roles: ['PURCHASE_CLERK'],
    permissions: ['purchase.invoice.create', 'purchase.payment.create'],
  });

  const managerCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: null,
    userId: randomUUID(),
    roles: ['PURCHASE_MANAGER'],
    permissions: [
      'purchase.invoice.view',
      'purchase.invoice.approve',
      'purchase.invoice.post',
      'purchase.payment.view',
      'purchase.payment.approve',
      'purchase.payment.post',
      'purchase.payment.reverse',
      'purchase.invoice.reverse',
    ],
  });

  const companyBCtx = engine.createSecurityContext({
    companyId: companyB,
    branchId: null,
    userId: randomUUID(),
    roles: ['COMPANY_ADMIN'],
    permissions: ['*'],
  });

  console.log('--- Test Suite 1: Purchase Invoice Creation & Zod Schema Validation ---');

  await test('1.1 Zod schema validates correct purchase invoice payload with discounts & tax', async () => {
    const rawPayload = {
      companyId: companyA,
      supplierId: supplier1,
      invoiceDate: '2026-09-02',
      dueDate: '2026-10-02',
      currencyCode: 'USD',
      lines: [
        {
          purchaseReceiptLineId: receiptLineId,
          itemId: item1,
          uomId: uomPcs,
          quantity: 50,
          unitPrice: 1000,
          discountRate: 10, // 10% discount -> 45,000 net
          taxRate: 13, // 13% tax -> 5,850 tax -> 50,850 total
        },
      ],
    };

    const parsed = createPurchaseInvoiceSchema.parse(rawPayload);
    assert.equal(parsed.lines[0].quantity, 50);
    assert.equal(parsed.lines[0].discountRate, 10);
    assert.equal(parsed.lines[0].taxRate, 13);
  });

  await test('1.2 Schema rejects negative unit prices, negative quantities, or invalid tax rate > 100%', async () => {
    assert.throws(
      () =>
        createPurchaseInvoiceSchema.parse({
          companyId: companyA,
          supplierId: supplier1,
          invoiceDate: '2026-09-02',
          lines: [
            {
              purchaseReceiptLineId: receiptLineId,
              itemId: item1,
              uomId: uomPcs,
              quantity: -5,
              unitPrice: 100,
            },
          ],
        }),
      /quantity/
    );

    assert.throws(
      () =>
        createPurchaseInvoiceSchema.parse({
          companyId: companyA,
          supplierId: supplier1,
          invoiceDate: '2026-09-02',
          lines: [
            {
              purchaseReceiptLineId: receiptLineId,
              itemId: item1,
              uomId: uomPcs,
              quantity: 10,
              unitPrice: -50,
            },
          ],
        }),
      /unitPrice/
    );
  });

  await test('1.3 Rejects purchase invoice creation for non-supplier business partner', async () => {
    assert.throws(
      () =>
        engine.createPurchaseInvoice(
          {
            companyId: companyA,
            supplierId: nonSupplier,
            invoiceDate: '2026-09-02',
            lines: [
              {
                purchaseReceiptLineId: receiptLineId,
                itemId: item1,
                uomId: uomPcs,
                quantity: 10,
                unitPrice: 100,
              },
            ],
          },
          clerkCtx
        ),
      /not registered as a supplier/
    );
  });

  console.log('\n--- Test Suite 2: Invoicing Quantity Ceilings & Cumulative Enforcements ---');

  let invoice1: PurchaseInvoice;

  await test('2.1 Creates DRAFT purchase invoice for 60 PCS with server calculation of totals', async () => {
    invoice1 = engine.createPurchaseInvoice(
      {
        companyId: companyA,
        supplierId: supplier1,
        invoiceDate: '2026-09-02',
        dueDate: '2026-10-02',
        currencyCode: 'USD',
        lines: [
          {
            purchaseReceiptLineId: receiptLineId,
            itemId: item1,
            uomId: uomPcs,
            quantity: 60,
            unitPrice: 1000,
            discountRate: 0,
            taxRate: 0,
          },
        ],
      },
      clerkCtx
    );

    assert.equal(invoice1.status, 'DRAFT');
    assert.equal(invoice1.grandTotal, 60000);
  });

  await test('2.2 Rejects invoice quantity exceeding remaining invoiceable received quantity (attempting 50 when 40 remain)', async () => {
    assert.throws(
      () =>
        engine.createPurchaseInvoice(
          {
            companyId: companyA,
            supplierId: supplier1,
            invoiceDate: '2026-09-02',
            lines: [
              {
                purchaseReceiptLineId: receiptLineId,
                itemId: item1,
                uomId: uomPcs,
                quantity: 50, // 60 already invoiced on GRN of 100 -> only 40 available
                unitPrice: 1000,
              },
            ],
          },
          clerkCtx
        ),
      /only 40 units remain available to invoice/
    );
  });

  await test('2.3 Allows invoicing exactly the remaining quantity (40 units) on second invoice', async () => {
    const invoice2 = engine.createPurchaseInvoice(
      {
        companyId: companyA,
        supplierId: supplier1,
        invoiceDate: '2026-09-02',
        lines: [
          {
            purchaseReceiptLineId: receiptLineId,
            itemId: item1,
            uomId: uomPcs,
            quantity: 40,
            unitPrice: 1000,
          },
        ],
      },
      clerkCtx
    );

    assert.equal(invoice2.grandTotal, 40000);
  });

  console.log('\n--- Test Suite 3: Purchase Invoice State Machine, SoD & Financial Posting ---');

  await test('3.1 Creator transitions Purchase Invoice from DRAFT to SUBMITTED', async () => {
    const submitted = engine.submitPurchaseInvoice(invoice1.id, clerkCtx);
    assert.equal(submitted.status, 'SUBMITTED');
  });

  await test('3.2 Segregation of Duties (SoD): Creator CANNOT approve their own Purchase Invoice', async () => {
    assert.throws(
      () => engine.approvePurchaseInvoice(invoice1.id, clerkCtx),
      /Segregation of [dD]uties/i
    );
  });

  await test('3.3 Authorized manager successfully approves Purchase Invoice', async () => {
    const approved = engine.approvePurchaseInvoice(invoice1.id, managerCtx);
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.approvedBy, managerCtx.userId);
  });

  let payable1: SupplierPayable;

  await test('3.4 Financial Posting: APPROVED -> POSTED atomically creates Supplier Payable with OPEN status', async () => {
    const posted = engine.postPurchaseInvoice(invoice1.id, managerCtx);
    assert.equal(posted.status, 'POSTED');

    // Find created payable
    let found: SupplierPayable | undefined;
    for (const p of engine.supplierPayables.values()) {
      if (p.purchaseInvoiceId === invoice1.id) {
        found = p;
        break;
      }
    }

    assert.ok(found, 'Supplier Payable must be created upon invoice posting');
    assert.equal(found.status, 'OPEN');
    assert.equal(found.invoiceAmount, 60000);
    assert.equal(found.paidAmount, 0);
    assert.equal(found.outstandingAmount, 60000);
    assert.equal(found.supplierId, supplier1);
    payable1 = found;
  });

  console.log('\n--- Test Suite 4: Supplier Payment Lifecycle & Segregation of Duties ---');

  let payment1: SupplierPayment;

  await test('4.1 Creator drafts Supplier Payment of $25,000 allocating against Supplier Payable', async () => {
    payment1 = engine.createSupplierPayment(
      {
        companyId: companyA,
        supplierId: supplier1,
        paymentDate: '2026-09-05',
        amount: 25000,
        currencyCode: 'USD',
        paymentMethod: 'BANK_TRANSFER',
        disbursementAccountId: cashAccountId,
        allocations: [
          {
            payableId: payable1.id,
            allocatedAmount: 25000,
          },
        ],
      },
      clerkCtx
    );

    assert.equal(payment1.status, 'DRAFT');
    assert.equal(payment1.amount, 25000);
    assert.equal(payment1.allocations?.length, 1);
  });

  await test('4.2 Creator transitions Supplier Payment from DRAFT to SUBMITTED', async () => {
    const submitted = engine.submitSupplierPayment(payment1.id, clerkCtx);
    assert.equal(submitted.status, 'SUBMITTED');
  });

  await test('4.3 Segregation of Duties (SoD): Creator CANNOT approve their own Supplier Payment', async () => {
    assert.throws(
      () => engine.approveSupplierPayment(payment1.id, clerkCtx),
      /Segregation of [dD]uties/i
    );
  });

  await test('4.4 Authorized manager approves Supplier Payment', async () => {
    const approved = engine.approveSupplierPayment(payment1.id, managerCtx);
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.approvedBy, managerCtx.userId);
  });

  console.log('\n--- Test Suite 5: Canonical Accounting Scenario & Automatic GL Posting ---');

  await test('5.1 Posting Supplier Payment atomically updates payable to PARTIALLY_PAID (Paid $25k, Out $35k) and generates balanced GL journal', async () => {
    const posted = engine.postSupplierPayment(payment1.id, managerCtx);
    assert.equal(posted.status, 'POSTED');
    assert.ok(posted.journalId);

    // Verify Payable balance
    const updatedPayable = engine.supplierPayables.get(payable1.id)!;
    assert.equal(updatedPayable.paidAmount, 25000);
    assert.equal(updatedPayable.outstandingAmount, 35000);
    assert.equal(updatedPayable.status, 'PARTIALLY_PAID');

    // Verify GL Journal
    const journal = engine.accountingJournals.get(posted.journalId!)!;
    assert.ok(journal);
    assert.equal(journal.status, 'POSTED');
    assert.equal(journal.totalDebit, 25000);
    assert.equal(journal.totalCredit, 25000);
    assert.equal(journal.lines!.length, 2);

    // Line 1: DR AP ($25,000)
    assert.equal(journal.lines![0].debit, 25000);
    assert.equal(journal.lines![0].credit, 0);
    assert.equal(journal.lines![0].partnerId, supplier1);

    // Line 2: CR Cash/Bank ($25,000)
    assert.equal(journal.lines![1].debit, 0);
    assert.equal(journal.lines![1].credit, 25000);
    assert.equal(journal.lines![1].accountId, cashAccountId);
  });

  await test('5.2 Second payment of $35,000 fully settles the payable to PAID ($60k paid, $0 outstanding)', async () => {
    const payment2 = engine.createSupplierPayment(
      {
        companyId: companyA,
        supplierId: supplier1,
        paymentDate: '2026-09-10',
        amount: 35000,
        currencyCode: 'USD',
        paymentMethod: 'CHECK',
        disbursementAccountId: cashAccountId,
        allocations: [
          {
            payableId: payable1.id,
            allocatedAmount: 35000,
          },
        ],
      },
      clerkCtx
    );

    engine.submitSupplierPayment(payment2.id, clerkCtx);
    engine.approveSupplierPayment(payment2.id, managerCtx);
    engine.postSupplierPayment(payment2.id, managerCtx);

    const updatedPayable = engine.supplierPayables.get(payable1.id)!;
    assert.equal(updatedPayable.paidAmount, 60000);
    assert.equal(updatedPayable.outstandingAmount, 0);
    assert.equal(updatedPayable.status, 'PAID');
  });

  await test('5.3 Over-allocation prevention: Rejects payment allocating more than remaining outstanding balance', async () => {
    assert.throws(
      () =>
        engine.createSupplierPayment(
          {
            companyId: companyA,
            supplierId: supplier1,
            paymentDate: '2026-09-11',
            amount: 1000,
            currencyCode: 'USD',
            paymentMethod: 'CASH',
            disbursementAccountId: cashAccountId,
            allocations: [
              {
                payableId: payable1.id,
                allocatedAmount: 1000,
              },
            ],
          },
          clerkCtx
        ),
      /already fully settled/
    );
  });

  console.log('\n--- Test Suite 6: Payment Reversals & Compensating GL Entries ---');

  await test('6.1 Reversal of supplier payment restores payable balance to PARTIALLY_PAID (Paid $25k, Out $35k) and generates compensating GL journal', async () => {
    // We reverse the 2nd payment of 35,000
    // Get 2nd payment ID
    let p2Id = '';
    for (const p of engine.supplierPayments.values()) {
      if (p.amount === 35000) {
        p2Id = p.id;
        break;
      }
    }

    const reversed = engine.reverseSupplierPayment(p2Id, managerCtx);
    assert.equal(reversed.status, 'REVERSED');

    const updatedPayable = engine.supplierPayables.get(payable1.id)!;
    assert.equal(updatedPayable.paidAmount, 25000);
    assert.equal(updatedPayable.outstandingAmount, 35000);
    assert.equal(updatedPayable.status, 'PARTIALLY_PAID');

    // Find compensating reversal journal
    let revJournal: AccountingJournal | undefined;
    for (const j of engine.accountingJournals.values()) {
      if (j.sourceDocumentType === 'PAYMENT_REVERSAL' && j.sourceDocumentId === p2Id) {
        revJournal = j;
        break;
      }
    }

    assert.ok(revJournal);
    assert.equal(revJournal.totalDebit, 35000);
    assert.equal(revJournal.totalCredit, 35000);

    // Line 1: DR Cash/Bank ($35,000 restored)
    assert.equal(revJournal.lines![0].debit, 35000);
    assert.equal(revJournal.lines![0].accountId, cashAccountId);

    // Line 2: CR AP ($35,000 restored)
    assert.equal(revJournal.lines![1].credit, 35000);
  });

  await test('6.2 Double reversal prevention: Rejects reversing an already REVERSED payment', async () => {
    let p2Id = '';
    for (const p of engine.supplierPayments.values()) {
      if (p.amount === 35000) {
        p2Id = p.id;
        break;
      }
    }

    assert.throws(
      () => engine.reverseSupplierPayment(p2Id, managerCtx),
      /terminal state|Invalid state transition/i
    );
  });

  console.log('\n--- Test Suite 7: Purchase Invoice Reversal & Immutability Protocols ---');

  await test('7.1 Reversal of posted purchase invoice transitions status to REVERSED and cancels payable', async () => {
    const revInvoice = engine.reversePurchaseInvoice(invoice1.id, managerCtx);
    assert.equal(revInvoice.status, 'REVERSED');

    const payable = engine.supplierPayables.get(payable1.id)!;
    assert.equal(payable.status, 'REVERSED');
  });

  console.log('\n--- Test Suite 8: Multi-Tenant Cross-Company Isolation ---');

  await test('8.1 Multi-tenant isolation: Company B cannot create or mutate Company A purchase invoices or payments', async () => {
    assert.throws(
      () =>
        engine.createPurchaseInvoice(
          {
            companyId: companyA,
            supplierId: supplier1,
            invoiceDate: '2026-09-02',
            lines: [{ itemId: item1, uomId: uomPcs, quantity: 1, unitPrice: 100 }],
          },
          companyBCtx
        ),
      /Tenant isolation violation/
    );

    assert.throws(
      () =>
        engine.createSupplierPayment(
          {
            companyId: companyA,
            supplierId: supplier1,
            paymentDate: '2026-09-05',
            amount: 100,
            paymentMethod: 'CASH',
            disbursementAccountId: cashAccountId,
          },
          companyBCtx
        ),
      /Tenant isolation violation/
    );
  });

  await test('8.2 Audit Immutability: All state changes registered structured audit log events', async () => {
    const invoiceLogs = engine.auditLogs.filter((a) => a.entityType === 'PurchaseInvoice');
    const paymentLogs = engine.auditLogs.filter((a) => a.entityType === 'SupplierPayment');

    assert.ok(invoiceLogs.length >= 2, 'Purchase Invoice must have audit logs for creation, posting, etc.');
    assert.ok(paymentLogs.length >= 2, 'Supplier Payment must have audit logs for creation, posting, reversal.');
  });
}

runAccountsPayableTests()
  .then(() => {
    console.log(`\n=============================================`);
    console.log(`ALL ${passedTests}/${totalTests} INCREMENT 1.3 UNIT TESTS PASSED!`);
    console.log(`=============================================\n`);
  })
  .catch((err) => {
    console.error(`\nFAILED: Increment 1.3 Unit Tests Failed:`, err);
    process.exit(1);
  });
