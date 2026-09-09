import pg from 'pg';
import { PurchaseInvoiceRepository, CreatePurchaseInvoiceDbHeaderInput, CreatePurchaseInvoiceLineDbInput } from '../repositories/purchase_invoice.repository.js';
import { SupplierPayableRepository } from '../repositories/supplier_payable.repository.js';
import { ChartOfAccountsRepository } from '../../accounting/repositories/chart_of_accounts.repository.js';
import { AccountingJournalRepository } from '../../accounting/repositories/accounting_journal.repository.js';
import { TaxTransactionRepository } from '../../accounting/repositories/tax_transaction.repository.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { withTransaction } from '../../../db/connection.js';
import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  CreatePurchaseInvoiceInput,
  UpdatePurchaseInvoiceInput,
} from '../../../../shared/schemas/purchase_invoice.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class PurchaseInvoiceService {
  constructor(
    private invoiceRepo: PurchaseInvoiceRepository = new PurchaseInvoiceRepository(),
    private payableRepo: SupplierPayableRepository = new SupplierPayableRepository(),
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository(),
    private journalRepo: AccountingJournalRepository = new AccountingJournalRepository(),
    private taxRepo: TaxTransactionRepository = new TaxTransactionRepository(),
    private numbering: NumberingService = new NumberingService(),
    private stateMachine: StateMachineEngine = new StateMachineEngine(),
    private audit: AuditService = new AuditService()
  ) {}

  private assertTenantAccess(ctx: SecurityContext, companyId: string) {
    if (!ctx.isSuperadmin && ctx.activeCompanyId !== companyId) {
      throw AppError.forbidden('Tenant isolation violation: Access to company purchase invoices is denied');
    }
  }

  async getById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    const invoice = await this.invoiceRepo.findById(id, companyId, client);
    if (!invoice) {
      throw AppError.notFound(`Purchase invoice '${id}' not found in active company`);
    }

    // Attach payable if available
    const payable = await this.payableRepo.findByInvoiceId(invoice.id, companyId, client);
    invoice.payable = payable || null;

    return invoice;
  }

  async create(input: CreatePurchaseInvoiceInput, ctx: SecurityContext): Promise<PurchaseInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      // 1. Validate Supplier
      const suppRes = await dbClient.query(
        `SELECT id, legal_name, is_supplier, is_active FROM business_partners WHERE id = $1 AND company_id = $2`,
        [input.supplierId, companyId]
      );
      if (suppRes.rows.length === 0) {
        throw AppError.notFound(`Supplier '${input.supplierId}' not found in active company`);
      }
      if (!suppRes.rows[0].is_supplier) {
        throw AppError.badRequest(`Business partner '${suppRes.rows[0].legal_name}' is not registered as a supplier`);
      }
      if (!suppRes.rows[0].is_active) {
        throw AppError.badRequest(`Supplier '${suppRes.rows[0].legal_name}' is inactive`);
      }

      // 2. Validate Source Purchase Order if provided
      if (input.purchaseOrderId) {
        const poRes = await dbClient.query(
          `SELECT id, supplier_id, status, po_number FROM purchase_orders WHERE id = $1 AND company_id = $2`,
          [input.purchaseOrderId, companyId]
        );
        if (poRes.rows.length === 0) {
          throw AppError.notFound(`Source Purchase Order '${input.purchaseOrderId}' not found in active company`);
        }
        if (poRes.rows[0].supplier_id !== input.supplierId) {
          throw AppError.badRequest('Source Purchase Order supplier does not match invoice supplier');
        }
        if (!['APPROVED', 'POSTED'].includes(poRes.rows[0].status)) {
          throw AppError.badRequest(`Source Purchase Order '${poRes.rows[0].po_number}' must be APPROVED or POSTED to be invoiced (currently '${poRes.rows[0].status}')`);
        }
      }

      // 3. Validate Source Receipt if provided
      if (input.receiptId) {
        const recRes = await dbClient.query(
          `SELECT id, supplier_id, status, receipt_number FROM purchase_receipts WHERE id = $1 AND company_id = $2`,
          [input.receiptId, companyId]
        );
        if (recRes.rows.length === 0) {
          throw AppError.notFound(`Source Purchase Receipt '${input.receiptId}' not found in active company`);
        }
        if (recRes.rows[0].supplier_id !== input.supplierId) {
          throw AppError.badRequest('Source Purchase Receipt supplier does not match invoice supplier');
        }
        if (recRes.rows[0].status !== 'POSTED') {
          throw AppError.badRequest(`Source Purchase Receipt '${recRes.rows[0].receipt_number}' must be POSTED to be invoiced (currently '${recRes.rows[0].status}')`);
        }
      }

      // 4. Process Lines, Quantities, Pricing, and Source Ceilings
      let subtotal = 0;
      let discountTotal = 0;
      let taxTotal = 0;
      let grandTotal = 0;
      const calculatedLines: CreatePurchaseInvoiceLineDbInput[] = [];

      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        const lineNum = line.lineNumber || i + 1;

        // Verify item
        const itemRes = await dbClient.query(
          `SELECT id, sku, item_name, is_purchasable, is_active FROM items WHERE id = $1 AND company_id = $2`,
          [line.itemId, companyId]
        );
        if (itemRes.rows.length === 0) {
          throw AppError.notFound(`Item '${line.itemId}' not found in active company (line ${lineNum})`);
        }
        if (!itemRes.rows[0].is_purchasable) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].sku}' is not marked as purchasable (line ${lineNum})`);
        }
        if (!itemRes.rows[0].is_active) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].sku}' is inactive (line ${lineNum})`);
        }

        // Verify UOM
        const uomRes = await dbClient.query(
          `SELECT id, code, is_active FROM uoms WHERE id = $1 AND company_id = $2`,
          [line.uomId, companyId]
        );
        if (uomRes.rows.length === 0 || !uomRes.rows[0].is_active) {
          throw AppError.badRequest(`UOM '${line.uomId}' is invalid or inactive (line ${lineNum})`);
        }

        // Verify Warehouse if provided
        if (line.warehouseId) {
          const whRes = await dbClient.query(
            `SELECT id, code, is_active FROM warehouses WHERE id = $1 AND company_id = $2`,
            [line.warehouseId, companyId]
          );
          if (whRes.rows.length === 0 || !whRes.rows[0].is_active) {
            throw AppError.badRequest(`Warehouse '${line.warehouseId}' is invalid or inactive (line ${lineNum})`);
          }
        }

        // Verify Source Purchase Receipt Line and Ceiling
        if (line.purchaseReceiptLineId) {
          const recLineRes = await dbClient.query(
            `SELECT prl.id, prl.item_id, prl.received_quantity, pr.receipt_number, pr.company_id
             FROM purchase_receipt_lines prl
             JOIN purchase_receipts pr ON prl.receipt_id = pr.id
             WHERE prl.id = $1 AND pr.company_id = $2
             FOR UPDATE`,
            [line.purchaseReceiptLineId, companyId]
          );

          if (recLineRes.rows.length === 0) {
            throw AppError.notFound(`Source Purchase Receipt Line '${line.purchaseReceiptLineId}' not found in active company (line ${lineNum})`);
          }

          const recLine = recLineRes.rows[0];
          if (recLine.item_id !== line.itemId) {
            throw AppError.badRequest(`Receipt line item does not match invoice line item (line ${lineNum})`);
          }

          const alreadyInvoiced = await this.invoiceRepo.getInvoicedQuantityForReceiptLine(
            line.purchaseReceiptLineId,
            companyId,
            undefined,
            dbClient
          );

          const availableToInvoice = Number(recLine.received_quantity) - alreadyInvoiced;
          if (line.quantity > availableToInvoice) {
            throw AppError.badRequest(
              `Cannot invoice ${line.quantity} units for line ${lineNum}: only ${availableToInvoice} units remain available to invoice on Receipt '${recLine.receipt_number}'`
            );
          }
        }

        const conversionFactor = line.conversionFactor || 1.0;
        const baseQuantity = line.quantity * conversionFactor;
        const unitPrice = line.unitPrice;
        const discountRate = line.discountRate || 0;
        const lineGross = line.quantity * unitPrice;
        const discountAmount = lineGross * (discountRate / 100);
        const lineNet = lineGross - discountAmount;
        const taxRate = line.taxRate || 0;
        const taxAmount = lineNet * (taxRate / 100);
        const lineTotal = lineNet + taxAmount;

        subtotal += lineGross;
        discountTotal += discountAmount;
        taxTotal += taxAmount;
        grandTotal += lineTotal;

        calculatedLines.push({
          purchaseReceiptLineId: line.purchaseReceiptLineId,
          poLineId: line.poLineId || null,
          lineNumber: lineNum,
          itemId: line.itemId,
          warehouseId: line.warehouseId || null,
          uomId: line.uomId,
          quantity: line.quantity,
          conversionFactor,
          baseQuantity,
          unitPrice,
          discountRate,
          discountAmount,
          taxRate,
          taxAmount,
          lineNet,
          lineTotal,
          expenseAccountId: line.expenseAccountId || null,
        });
      }

      // 5. Generate Sequence Number
      const generatedNumber = await this.numbering.generateNextNumber(
        {
          companyId,
          branchId: input.branchId || null,
          documentType: 'PURCHASE_INVOICE',
        },
        ctx,
        dbClient,
        input.invoiceDate ? new Date(input.invoiceDate) : new Date()
      );

      // 6. Save Invoice Header and Lines
      const headerInput: CreatePurchaseInvoiceDbHeaderInput = {
        companyId,
        branchId: input.branchId || null,
        invoiceNumber: generatedNumber.formattedNumber,
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
      };

      const createdInvoice = await this.invoiceRepo.create(headerInput, calculatedLines, dbClient);

      // 7. Audit Log
      await this.audit.logCreate(
        'purchase',
        'PurchaseInvoice',
        createdInvoice.id,
        {
          invoiceNumber: createdInvoice.invoiceNumber,
          supplierId: createdInvoice.supplierId,
          grandTotal: createdInvoice.grandTotal,
          linesCount: calculatedLines.length,
        },
        ctx,
        dbClient
      );

      return createdInvoice;
    });
  }

  async submit(id: string, ctx: SecurityContext): Promise<PurchaseInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_INVOICE',
        currentState: invoice.status,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          companyId,
          branchId: invoice.branchId,
          creatorId: invoice.createdBy || undefined,
          documentId: invoice.id,
        },
      });

      await this.invoiceRepo.updateStatus(id, 'SUBMITTED', {}, dbClient);

      await this.audit.logUpdate(
        'purchase',
        'PurchaseInvoice',
        id,
        { status: invoice.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted Purchase Invoice for approval',
        dbClient
      );

      return this.getById(id, ctx, dbClient);
    });
  }

  async approve(id: string, ctx: SecurityContext): Promise<PurchaseInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_INVOICE',
        currentState: invoice.status,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          companyId,
          branchId: invoice.branchId,
          creatorId: invoice.createdBy || undefined,
          documentId: invoice.id,
        },
      });

      await this.invoiceRepo.updateStatus(
        id,
        'APPROVED',
        {
          approvedBy: ctx.userId,
          approvedAt: new Date().toISOString(),
        },
        dbClient
      );

      await this.audit.logApprove(
        'purchase',
        'PurchaseInvoice',
        id,
        ctx,
        `Approved purchase invoice ${invoice.invoiceNumber}`,
        dbClient
      );

      return this.getById(id, ctx, dbClient);
    });
  }

  async reject(id: string, reason: string, ctx: SecurityContext): Promise<PurchaseInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_INVOICE',
        currentState: invoice.status,
        targetState: 'REJECTED',
        ctx,
        documentContext: {
          companyId,
          branchId: invoice.branchId,
          creatorId: invoice.createdBy || undefined,
          documentId: invoice.id,
        },
      });

      await this.invoiceRepo.updateStatus(id, 'REJECTED', {}, dbClient);

      await this.audit.logReject('purchase', 'PurchaseInvoice', id, ctx, reason, dbClient);

      return this.getById(id, ctx, dbClient);
    });
  }

  async post(id: string, ctx: SecurityContext): Promise<PurchaseInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      // 1. Enforce State Transition & SoD
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_INVOICE',
        currentState: invoice.status,
        targetState: 'POSTED',
        ctx,
        documentContext: {
          companyId,
          branchId: invoice.branchId,
          creatorId: invoice.createdBy || undefined,
          documentId: invoice.id,
        },
      });

      // 2. Verify Supplier Still Active & Valid
      const suppRes = await dbClient.query(
        `SELECT id, is_active FROM business_partners WHERE id = $1 AND company_id = $2`,
        [invoice.supplierId, companyId]
      );
      if (suppRes.rows.length === 0 || !suppRes.rows[0].is_active) {
        throw AppError.badRequest(`Supplier for invoice '${invoice.invoiceNumber}' is invalid or inactive`);
      }

      // 3. Concurrency Protection & Quantity Invariant Re-verification with FOR UPDATE locks
      for (const line of (invoice.lines || [])) {
        if (line.purchaseReceiptLineId) {
          const recLineRes = await dbClient.query(
            `SELECT prl.id, prl.received_quantity, pr.receipt_number
             FROM purchase_receipt_lines prl
             JOIN purchase_receipts pr ON prl.receipt_id = pr.id
             WHERE prl.id = $1 AND pr.company_id = $2
             FOR UPDATE`,
            [line.purchaseReceiptLineId, companyId]
          );
          if (recLineRes.rows.length === 0) {
            throw AppError.notFound(`Source Purchase Receipt Line '${line.purchaseReceiptLineId}' not found during posting`);
          }
          const alreadyInvoiced = await this.invoiceRepo.getInvoicedQuantityForReceiptLine(
            line.purchaseReceiptLineId,
            companyId,
            invoice.id,
            dbClient
          );
          const receivedQty = Number(recLineRes.rows[0].received_quantity);
          if (alreadyInvoiced + line.quantity > receivedQty) {
            const available = receivedQty - alreadyInvoiced;
            throw AppError.badRequest(
              `Cannot post invoice: Quantity ${line.quantity} exceeds available un-invoiced quantity ${available} on Receipt '${recLineRes.rows[0].receipt_number}'`
            );
          }
        }
      }

      // 4. Resolve Accounts for General Ledger Posting
      // AP Account (Liability)
      const liabilityAccounts = await this.coaRepo.list(
        companyId,
        { accountType: 'LIABILITY', isActive: true, isGroup: false },
        dbClient
      );
      const defaultAp =
        liabilityAccounts.find((a) => a.accountCode === '2100' || a.accountName.toUpperCase().includes('PAYABLE')) ||
        liabilityAccounts[0];

      let apAccountId = defaultAp?.id;
      if (!apAccountId) {
        const newAp = await this.coaRepo.create(
          {
            companyId,
            accountCode: '2100',
            accountName: 'Accounts Payable',
            accountType: 'LIABILITY',
            isGroup: false,
            isActive: true,
            currencyCode: invoice.currencyCode,
            description: 'Standard Accounts Payable Trade Liability',
          },
          dbClient
        );
        apAccountId = newAp.id;
      }

      // Inventory Clearing / Expense Account
      const assetOrExpenseAccounts = await this.coaRepo.list(
        companyId,
        { isActive: true, isGroup: false },
        dbClient
      );
      const defaultClearing =
        assetOrExpenseAccounts.find(
          (a) =>
            a.accountCode === '1400' ||
            a.accountCode === '5000' ||
            a.accountName.toUpperCase().includes('CLEARING') ||
            a.accountName.toUpperCase().includes('EXPENSE')
        ) ||
        assetOrExpenseAccounts.find((a) => a.accountType === 'ASSET' || a.accountType === 'EXPENSE') ||
        assetOrExpenseAccounts[0];

      let clearingAccountId = defaultClearing?.id;
      if (!clearingAccountId) {
        const newClearing = await this.coaRepo.create(
          {
            companyId,
            accountCode: '1400',
            accountName: 'Inventory Clearing Account',
            accountType: 'ASSET',
            isGroup: false,
            isActive: true,
            currencyCode: invoice.currencyCode,
            description: 'Material Receipt Clearing Account',
          },
          dbClient
        );
        clearingAccountId = newClearing.id;
      }

      // Input Tax Account (Asset, code 1150 or default) if taxTotal > 0
      let inputTaxAccount = null;
      if (invoice.taxTotal > 0) {
        inputTaxAccount = assetOrExpenseAccounts.find(
          (a) =>
            a.accountCode === '1150' ||
            a.accountName.toUpperCase().includes('INPUT TAX') ||
            a.accountName.toUpperCase().includes('TAX RECEIVABLE') ||
            a.accountName.toUpperCase().includes('VAT RECEIVABLE')
        );

        if (!inputTaxAccount) {
          inputTaxAccount = await this.coaRepo.create(
            {
              companyId,
              accountCode: '1150',
              accountName: 'Input Tax Receivable',
              accountType: 'ASSET',
              isGroup: false,
              isActive: true,
              currencyCode: invoice.currencyCode,
              description: 'Purchase Input Tax (VAT) Receivable Account',
            },
            dbClient
          );
        }
      }

      // 5. Generate Accounting Journal
      // DEBIT: Inventory Clearing / Expense (Net Amount)
      // DEBIT: Input Tax Receivable (Tax Amount)
      // CREDIT: Trade Accounts Payable (Grand Total)
      let journalNumber = '';
      try {
        const numResult = await this.numbering.generateNextNumber(
          {
            companyId,
            branchId: invoice.branchId || null,
            documentType: 'JOURNAL',
          },
          ctx,
          dbClient
        );
        journalNumber = numResult.formattedNumber;
      } catch {
        journalNumber = `JV-PINV-${invoice.invoiceNumber}`;
      }

      const exchangeRate = invoice.exchangeRate || 1.0;
      const baseGrandTotal = Math.round(invoice.grandTotal * exchangeRate * 10000) / 10000;
      const baseTaxAmount = Math.round(invoice.taxTotal * exchangeRate * 10000) / 10000;
      const netPurchases = Math.round((invoice.subtotal - invoice.discountTotal) * 10000) / 10000;
      const baseNetPurchases = Math.round(netPurchases * exchangeRate * 10000) / 10000;

      const journalLines: any[] = [];
      let lineNum = 1;

      // Line 1: DEBIT Inventory Clearing / Expense
      journalLines.push({
        lineNumber: lineNum++,
        accountId: clearingAccountId,
        debit: netPurchases,
        credit: 0,
        currencyCode: invoice.currencyCode,
        exchangeRate,
        baseDebit: baseNetPurchases,
        baseCredit: 0,
        description: `Inventory clearing/expense for purchase invoice ${invoice.invoiceNumber}`,
      });

      // Line 2: DEBIT Input Tax Receivable (if tax > 0)
      if (invoice.taxTotal > 0 && inputTaxAccount) {
        journalLines.push({
          lineNumber: lineNum++,
          accountId: inputTaxAccount.id,
          debit: invoice.taxTotal,
          credit: 0,
          currencyCode: invoice.currencyCode,
          exchangeRate,
          baseDebit: baseTaxAmount,
          baseCredit: 0,
          description: `Input tax receivable for purchase invoice ${invoice.invoiceNumber}`,
        });
      }

      // Line 3: CREDIT Accounts Payable
      journalLines.push({
        lineNumber: lineNum++,
        accountId: apAccountId,
        partnerId: invoice.supplierId,
        debit: 0,
        credit: invoice.grandTotal,
        currencyCode: invoice.currencyCode,
        exchangeRate,
        baseDebit: 0,
        baseCredit: baseGrandTotal,
        description: `Accounts payable obligation for invoice ${invoice.invoiceNumber}`,
      });

      // Rounding adjustment if any
      let sumBaseDebit = 0;
      let sumBaseCredit = 0;
      for (const l of journalLines) {
        sumBaseDebit += l.baseDebit;
        sumBaseCredit += l.baseCredit;
      }
      const roundingDiff = Math.round((sumBaseDebit - sumBaseCredit) * 10000) / 10000;
      if (roundingDiff !== 0 && journalLines.length > 0) {
        journalLines[0].baseDebit = Math.round((journalLines[0].baseDebit - roundingDiff) * 10000) / 10000;
        journalLines[0].debit = Math.round((journalLines[0].debit - roundingDiff / exchangeRate) * 10000) / 10000;
      }

      const totalDebit = journalLines.reduce((acc, l) => acc + l.debit, 0);
      const totalCredit = journalLines.reduce((acc, l) => acc + l.credit, 0);

      const journal = await this.journalRepo.create(
        {
          companyId,
          branchId: invoice.branchId || null,
          journalNumber,
          postingDate: invoice.invoiceDate,
          sourceDocumentType: 'PURCHASE_INVOICE',
          sourceDocumentId: invoice.id,
          description: `Purchase invoice posting ${invoice.invoiceNumber}`,
          status: 'POSTED',
          totalDebit: Math.round(totalDebit * 10000) / 10000,
          totalCredit: Math.round(totalCredit * 10000) / 10000,
          currencyCode: invoice.currencyCode,
          createdBy: ctx.userId,
          approvedBy: ctx.userId,
          approvedAt: new Date().toISOString(),
          postedBy: ctx.userId,
          postedAt: new Date().toISOString(),
          lines: journalLines,
        },
        dbClient
      );

      // Record Tax Transactions (Tax Subledger for Purchases)
      if (invoice.taxTotal > 0 && invoice.lines) {
        for (const line of invoice.lines) {
          if (line.taxAmount > 0) {
            await this.taxRepo.create(
              {
                companyId,
                branchId: invoice.branchId || null,
                taxType: 'INPUT_TAX',
                sourceType: 'PURCHASE_INVOICE',
                sourceId: invoice.id,
                sourceLineId: line.id,
                taxCode: line.taxRate ? `${line.taxRate}%` : 'INPUT_TAX',
                taxRate: line.taxRate,
                taxableAmount: line.lineNet,
                taxAmount: line.taxAmount,
                currencyCode: invoice.currencyCode,
                exchangeRate,
                baseTaxableAmount: Math.round(line.lineNet * exchangeRate * 10000) / 10000,
                baseTaxAmount: Math.round(line.taxAmount * exchangeRate * 10000) / 10000,
                accountingDate: invoice.invoiceDate,
                journalId: journal.id,
                status: 'POSTED',
              },
              dbClient
            );
          }
        }
      }

      // 6. Mark Invoice as POSTED and link journal
      await this.invoiceRepo.updateStatus(
        id,
        'POSTED',
        {
          postedBy: ctx.userId,
          postedAt: new Date().toISOString(),
          journalId: journal.id,
        },
        dbClient
      );

      // 7. Create Authoritative Supplier Payable Record (Atomic in same TX)
      await this.payableRepo.create(
        {
          companyId,
          branchId: invoice.branchId || null,
          supplierId: invoice.supplierId,
          purchaseInvoiceId: invoice.id,
          currencyCode: invoice.currencyCode,
          invoiceAmount: invoice.grandTotal,
          paidAmount: 0,
          outstandingAmount: invoice.grandTotal,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate || null,
          status: 'OPEN',
        },
        dbClient
      );

      // 8. Audit Log (Financial Document Posting)
      await this.audit.logPost(
        'purchase',
        'PurchaseInvoice',
        id,
        ctx,
        `Posted purchase invoice ${invoice.invoiceNumber} for amount ${invoice.grandTotal} ${invoice.currencyCode}`,
        dbClient
      );

      return this.getById(id, ctx, dbClient);
    });
  }

  async reverse(id: string, reason: string, ctx: SecurityContext): Promise<PurchaseInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      // 1. Enforce State Transition
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_INVOICE',
        currentState: invoice.status,
        targetState: 'REVERSED',
        ctx,
        documentContext: {
          companyId,
          branchId: invoice.branchId,
          creatorId: invoice.createdBy || undefined,
          documentId: invoice.id,
        },
      });

      // 2. Prevent Reversal if Payable has Recorded Payments
      const payable = await this.payableRepo.findByInvoiceId(id, companyId, dbClient);
      if (payable) {
        if (payable.paidAmount > 0.0001 || payable.status === 'PARTIALLY_PAID' || payable.status === 'PAID') {
          throw AppError.badRequest(
            `Cannot reverse purchase invoice '${invoice.invoiceNumber}': Associated supplier payable has recorded payment settlements of ${payable.paidAmount} ${payable.currencyCode}. Reverse all allocated supplier payments before reversing the invoice.`
          );
        }
        await this.payableRepo.updateStatus(payable.id, companyId, 'REVERSED', dbClient);
      }

      // 3. Mark Original Journal as REVERSED and Create Compensating Reversal Journal
      let reversalJournalId: string | null = null;
      if (invoice.journalId) {
        await this.journalRepo.updateStatus(invoice.journalId, 'REVERSED', {}, dbClient);

        const originalJournal = await this.journalRepo.findById(invoice.journalId, dbClient);
        if (originalJournal && originalJournal.companyId === companyId) {
          const origLines = await this.journalRepo.getLines(originalJournal.id, dbClient);

          let revNumber = '';
          try {
            const numResult = await this.numbering.generateNextNumber(
              {
                companyId,
                branchId: invoice.branchId || null,
                documentType: 'JOURNAL',
              },
              ctx,
              dbClient
            );
            revNumber = numResult.formattedNumber;
          } catch {
            revNumber = `REV-PINV-${invoice.invoiceNumber}`;
          }

          const reversalLines = origLines.map((l, idx) => ({
            lineNumber: idx + 1,
            accountId: l.accountId,
            partnerId: l.partnerId || null,
            debit: l.credit,
            credit: l.debit,
            currencyCode: l.currencyCode,
            exchangeRate: l.exchangeRate,
            baseDebit: l.baseCredit,
            baseCredit: l.baseDebit,
            description: `Reversal of purchase journal line ${l.lineNumber} (${originalJournal.journalNumber}) - ${reason}`,
          }));

          const revJournal = await this.journalRepo.create(
            {
              companyId,
              branchId: invoice.branchId || null,
              journalNumber: revNumber,
              postingDate: new Date().toISOString().split('T')[0],
              sourceDocumentType: 'PURCHASE_INVOICE_REVERSAL',
              sourceDocumentId: invoice.id,
              description: `Compensating reversal for purchase invoice ${invoice.invoiceNumber}: ${reason}`,
              status: 'POSTED',
              totalDebit: originalJournal.totalCredit,
              totalCredit: originalJournal.totalDebit,
              currencyCode: invoice.currencyCode,
              createdBy: ctx.userId,
              approvedBy: ctx.userId,
              approvedAt: new Date().toISOString(),
              postedBy: ctx.userId,
              postedAt: new Date().toISOString(),
              reversalJournalId: invoice.journalId,
              lines: reversalLines,
            },
            dbClient
          );

          reversalJournalId = revJournal.id;

          await dbClient.query(
            `UPDATE accounting_journals SET reversal_journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND company_id = $3`,
            [revJournal.id, originalJournal.id, companyId]
          );
        }
      }

      // 4. Update Tax Transactions to REVERSED
      await this.taxRepo.updateStatusBySource(
        'PURCHASE_INVOICE',
        invoice.id,
        companyId,
        'REVERSED',
        reversalJournalId,
        dbClient
      );

      // 5. Mark Invoice as REVERSED
      await this.invoiceRepo.updateStatus(
        id,
        'REVERSED',
        {
          reversedBy: ctx.userId,
          reversedAt: new Date().toISOString(),
        },
        dbClient
      );

      // 5. Audit Log
      await this.audit.logReverse('purchase', 'PurchaseInvoice', id, ctx, reason, dbClient);

      return this.getById(id, ctx, dbClient);
    });
  }

  async cancel(id: string, reason: string, ctx: SecurityContext): Promise<PurchaseInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_INVOICE',
        currentState: invoice.status,
        targetState: 'CANCELLED',
        ctx,
        documentContext: {
          companyId,
          branchId: invoice.branchId,
          creatorId: invoice.createdBy || undefined,
          documentId: invoice.id,
        },
      });

      await this.invoiceRepo.updateStatus(id, 'CANCELLED', {}, dbClient);

      await this.audit.logCancel('purchase', 'PurchaseInvoice', id, ctx, reason, dbClient);

      return this.getById(id, ctx, dbClient);
    });
  }

  async delete(id: string, ctx: SecurityContext): Promise<void> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    const invoice = await this.getById(id, ctx);
    if (invoice.status !== 'DRAFT') {
      throw AppError.badRequest(`Only DRAFT purchase invoices can be deleted (current status: '${invoice.status}')`);
    }

    const deleted = await this.invoiceRepo.deleteDraft(id, companyId);
    if (!deleted) {
      throw AppError.notFound(`Draft purchase invoice '${id}' could not be deleted`);
    }

    await this.audit.logDelete('purchase', 'PurchaseInvoice', id, { invoiceNumber: invoice.invoiceNumber }, ctx);
  }

  async list(
    filters: {
      supplierId?: string;
      purchaseOrderId?: string;
      receiptId?: string;
      status?: PurchaseInvoiceStatus;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
    ctx: SecurityContext
  ): Promise<{ data: PurchaseInvoice[]; total: number }> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return this.invoiceRepo.list(companyId, filters);
  }
}
