import pg from 'pg';
import { SalesInvoiceRepository, CreateSalesInvoiceDbHeaderInput, CreateSalesInvoiceLineDbInput } from '../repositories/sales_invoice.repository.js';
import { CustomerReceivableRepository } from '../repositories/customer_receivable.repository.js';
import { AccountingJournalRepository } from '../../accounting/repositories/accounting_journal.repository.js';
import { ChartOfAccountsRepository } from '../../accounting/repositories/chart_of_accounts.repository.js';
import { TaxTransactionRepository } from '../../accounting/repositories/tax_transaction.repository.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { withTransaction, getPool } from '../../../db/connection.js';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SecurityContext,
} from '../../../../shared/types/index.js';
import {
  CreateSalesInvoiceInput,
  UpdateSalesInvoiceInput,
} from '../../../../shared/schemas/sales_invoice.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class SalesInvoiceService {
  constructor(
    private invoiceRepo: SalesInvoiceRepository = new SalesInvoiceRepository(),
    private receivableRepo: CustomerReceivableRepository = new CustomerReceivableRepository(),
    private journalRepo: AccountingJournalRepository = new AccountingJournalRepository(),
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository(),
    private taxRepo: TaxTransactionRepository = new TaxTransactionRepository(),
    private numbering: NumberingService = new NumberingService(),
    private stateMachine: StateMachineEngine = new StateMachineEngine(),
    private audit: AuditService = new AuditService()
  ) {}

  private assertTenantAccess(ctx: SecurityContext, companyId: string) {
    if (!ctx.isSuperadmin && ctx.activeCompanyId !== companyId) {
      throw AppError.forbidden('Tenant isolation violation: Access to company sales invoices is denied');
    }
  }

  async getById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    const invoice = await this.invoiceRepo.findById(id, companyId, client);
    if (!invoice) {
      throw AppError.notFound(`Sales invoice '${id}' not found in active company`);
    }

    // Attach receivable if available
    const receivable = await this.receivableRepo.findByInvoiceId(invoice.id, companyId, client);
    invoice.receivable = receivable || null;

    return invoice;
  }

  async create(input: CreateSalesInvoiceInput, ctx: SecurityContext): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      // 1. Validate Customer
      const custRes = await dbClient.query(
        `SELECT id, legal_name, is_customer, is_active FROM business_partners WHERE id = $1 AND company_id = $2`,
        [input.customerId, companyId]
      );
      if (custRes.rows.length === 0) {
        throw AppError.notFound(`Customer '${input.customerId}' not found in active company`);
      }
      if (!custRes.rows[0].is_customer) {
        throw AppError.badRequest(`Business partner '${custRes.rows[0].legal_name}' is not registered as a customer`);
      }
      if (!custRes.rows[0].is_active) {
        throw AppError.badRequest(`Customer '${custRes.rows[0].legal_name}' is inactive`);
      }

      // 2. Validate Source Sales Order if provided
      if (input.salesOrderId) {
        const soRes = await dbClient.query(
          `SELECT id, customer_id, status, so_number FROM sales_orders WHERE id = $1 AND company_id = $2`,
          [input.salesOrderId, companyId]
        );
        if (soRes.rows.length === 0) {
          throw AppError.notFound(`Source Sales Order '${input.salesOrderId}' not found in active company`);
        }
        if (soRes.rows[0].customer_id !== input.customerId) {
          throw AppError.badRequest('Source Sales Order customer does not match invoice customer');
        }
        if (!['APPROVED', 'POSTED'].includes(soRes.rows[0].status)) {
          throw AppError.badRequest(`Source Sales Order '${soRes.rows[0].so_number}' must be APPROVED or POSTED to be invoiced (currently '${soRes.rows[0].status}')`);
        }
      }

      // 3. Validate Source Delivery if provided
      if (input.deliveryId) {
        const delRes = await dbClient.query(
          `SELECT id, customer_id, status, delivery_number FROM sales_deliveries WHERE id = $1 AND company_id = $2`,
          [input.deliveryId, companyId]
        );
        if (delRes.rows.length === 0) {
          throw AppError.notFound(`Source Delivery '${input.deliveryId}' not found in active company`);
        }
        if (delRes.rows[0].customer_id !== input.customerId) {
          throw AppError.badRequest('Source Delivery customer does not match invoice customer');
        }
        if (delRes.rows[0].status !== 'POSTED') {
          throw AppError.badRequest(`Source Delivery '${delRes.rows[0].delivery_number}' must be POSTED to be invoiced (currently '${delRes.rows[0].status}')`);
        }
      }

      // 4. Process Lines, Quantities, Pricing, and Source Ceilings
      let subtotal = 0;
      let discountTotal = 0;
      let taxTotal = 0;
      let grandTotal = 0;
      const calculatedLines: CreateSalesInvoiceLineDbInput[] = [];

      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        const lineNum = line.lineNumber || i + 1;

        // Verify item
        const itemRes = await dbClient.query(
          `SELECT id, sku, item_name, is_sellable, is_active FROM items WHERE id = $1 AND company_id = $2`,
          [line.itemId, companyId]
        );
        if (itemRes.rows.length === 0) {
          throw AppError.notFound(`Item '${line.itemId}' not found in company`);
        }
        if (!itemRes.rows[0].is_sellable) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].item_name}' is not marked as sellable`);
        }
        if (!itemRes.rows[0].is_active) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].item_name}' is inactive`);
        }

        // Verify warehouse if provided
        if (line.warehouseId) {
          const whRes = await dbClient.query(
            `SELECT id FROM warehouses WHERE id = $1 AND company_id = $2`,
            [line.warehouseId, companyId]
          );
          if (whRes.rows.length === 0) {
            throw AppError.notFound(`Warehouse '${line.warehouseId}' not found in company`);
          }
        }

        // Verify UOM
        const uomRes = await dbClient.query(
          `SELECT id, is_active FROM uoms WHERE id = $1 AND company_id = $2`,
          [line.uomId, companyId]
        );
        if (uomRes.rows.length === 0) {
          throw AppError.notFound(`UOM '${line.uomId}' not found in company`);
        }
        if (!uomRes.rows[0].is_active) {
          throw AppError.badRequest(`UOM '${line.uomId}' is inactive`);
        }

        // Source Quantity Ceilings Check: Delivery Line
        if (line.deliveryLineId) {
          const delLineRes = await dbClient.query(
            `SELECT id, delivered_quantity, item_id FROM sales_delivery_lines WHERE id = $1`,
            [line.deliveryLineId]
          );
          if (delLineRes.rows.length === 0) {
            throw AppError.notFound(`Source Delivery Line '${line.deliveryLineId}' not found`);
          }
          if (delLineRes.rows[0].item_id !== line.itemId) {
            throw AppError.badRequest(`Delivery line item does not match invoice line item`);
          }

          const deliveredQty = Number(delLineRes.rows[0].delivered_quantity);
          const alreadyInvoicedQty = await this.invoiceRepo.getInvoicedQuantityForDeliveryLine(
            line.deliveryLineId,
            undefined,
            dbClient
          );
          const remainingInvoiceable = deliveredQty - alreadyInvoicedQty;

          if (line.quantity > remainingInvoiceable + 0.0001) {
            throw AppError.badRequest(
              `Requested invoice quantity (${line.quantity}) exceeds remaining invoiceable delivered quantity (${remainingInvoiceable}) for item '${itemRes.rows[0].sku}'`
            );
          }
        }

        // Source Quantity Ceilings Check: Sales Order Line
        if (line.salesOrderLineId) {
          const soLineRes = await dbClient.query(
            `SELECT id, ordered_quantity, item_id FROM sales_order_lines WHERE id = $1`,
            [line.salesOrderLineId]
          );
          if (soLineRes.rows.length === 0) {
            throw AppError.notFound(`Source Sales Order Line '${line.salesOrderLineId}' not found`);
          }
          if (soLineRes.rows[0].item_id !== line.itemId) {
            throw AppError.badRequest(`Sales order line item does not match invoice line item`);
          }

          const orderedQty = Number(soLineRes.rows[0].ordered_quantity);
          const alreadyInvoicedQty = await this.invoiceRepo.getInvoicedQuantityForSalesOrderLine(
            line.salesOrderLineId,
            undefined,
            dbClient
          );
          const remainingInvoiceable = orderedQty - alreadyInvoicedQty;

          if (line.quantity > remainingInvoiceable + 0.0001) {
            throw AppError.badRequest(
              `Requested invoice quantity (${line.quantity}) exceeds remaining invoiceable ordered quantity (${remainingInvoiceable}) for item '${itemRes.rows[0].sku}'`
            );
          }
        }

        // Server-Side Pricing Calculations
        const convFactor = line.conversionFactor || 1.0;
        const baseQty = line.baseQuantity || line.quantity * convFactor;
        const grossAmount = line.quantity * line.unitPrice;
        const discAmount = (grossAmount * (line.discountRate || 0)) / 100;
        const netAmount = grossAmount - discAmount;
        const lineTax = (netAmount * (line.taxRate || 0)) / 100;
        const lineTotal = netAmount + lineTax;

        subtotal += netAmount;
        discountTotal += discAmount;
        taxTotal += lineTax;
        grandTotal += lineTotal;

        calculatedLines.push({
          salesOrderLineId: line.salesOrderLineId || null,
          deliveryLineId: line.deliveryLineId || null,
          lineNumber: lineNum,
          itemId: line.itemId,
          warehouseId: line.warehouseId || null,
          uomId: line.uomId,
          quantity: line.quantity,
          conversionFactor: convFactor,
          baseQuantity: baseQty,
          unitPrice: line.unitPrice,
          discountRate: line.discountRate || 0,
          discountAmount: discAmount,
          taxRate: line.taxRate || 0,
          taxAmount: lineTax,
          lineNet: netAmount,
          lineTotal,
          revenueAccountId: line.revenueAccountId || null,
        });
      }

      // 5. Generate Invoice Number
      const generatedNumber = await this.numbering.generateNextNumber(
        {
          companyId,
          branchId: input.branchId || null,
          documentType: 'SALES_INVOICE',
        },
        ctx,
        dbClient
      );

      // 6. Save Invoice Header and Lines
      const headerInput: CreateSalesInvoiceDbHeaderInput = {
        companyId,
        branchId: input.branchId || null,
        invoiceNumber: generatedNumber.formattedNumber,
        customerId: input.customerId,
        salesOrderId: input.salesOrderId || null,
        deliveryId: input.deliveryId || null,
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
        'sales',
        'SalesInvoice',
        createdInvoice.id,
        {
          invoiceNumber: createdInvoice.invoiceNumber,
          customerId: createdInvoice.customerId,
          grandTotal: createdInvoice.grandTotal,
          linesCount: calculatedLines.length,
        },
        ctx,
        dbClient
      );

      return createdInvoice;
    });
  }

  async submit(id: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      this.stateMachine.validateTransition({
        documentType: 'SALES_INVOICE',
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

      await this.invoiceRepo.updateStatus(id, companyId, 'SUBMITTED', undefined, dbClient);

      await this.audit.logUpdate(
        'sales',
        'SalesInvoice',
        id,
        { status: invoice.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted Sales Invoice for approval',
        dbClient
      );

      return this.getById(id, ctx, dbClient);
    });
  }

  async approve(id: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      this.stateMachine.validateTransition({
        documentType: 'SALES_INVOICE',
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
        companyId,
        'APPROVED',
        { approvedBy: ctx.userId },
        dbClient
      );

      await this.audit.logApprove(
        'sales',
        'SalesInvoice',
        id,
        ctx,
        `Approved sales invoice ${invoice.invoiceNumber}`,
        dbClient
      );

      return this.getById(id, ctx, dbClient);
    });
  }

  async reject(id: string, reason: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      this.stateMachine.validateTransition({
        documentType: 'SALES_INVOICE',
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

      await this.invoiceRepo.updateStatus(id, companyId, 'REJECTED', undefined, dbClient);

      await this.audit.logReject('sales', 'SalesInvoice', id, ctx, reason, dbClient);

      return this.getById(id, ctx, dbClient);
    });
  }

  async post(id: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      // 1. Enforce State Transition & SoD
      this.stateMachine.validateTransition({
        documentType: 'SALES_INVOICE',
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

      // 2. Lock invoice row FOR UPDATE
      await this.invoiceRepo.findByIdForUpdate(id, companyId, dbClient);

      // 3. Verify Customer Still Active & Valid
      const custRes = await dbClient.query(
        `SELECT id, is_active FROM business_partners WHERE id = $1 AND company_id = $2`,
        [invoice.customerId, companyId]
      );
      if (custRes.rows.length === 0 || !custRes.rows[0].is_active) {
        throw AppError.badRequest(`Customer for invoice '${invoice.invoiceNumber}' is invalid or inactive`);
      }

      // 4. Resolve Accounts:
      // AR Account (Asset, code 1100 or matching receivable)
      const accounts = await this.coaRepo.list(companyId, { isActive: true, isGroup: false }, dbClient);

      let arAccount = accounts.find(
        (a) =>
          a.accountCode === '1100' ||
          a.accountName.toUpperCase().includes('ACCOUNTS RECEIVABLE') ||
          a.accountName.toUpperCase().includes('TRADE DEBTORS')
      ) || accounts.find((a) => a.accountType === 'ASSET');

      if (!arAccount) {
        arAccount = await this.coaRepo.create(
          {
            companyId,
            accountCode: '1100',
            accountName: 'Accounts Receivable',
            accountType: 'ASSET',
            isGroup: false,
            isActive: true,
            currencyCode: invoice.currencyCode,
            description: 'Customer Accounts Receivable Control Account',
          },
          dbClient
        );
      }

      // Revenue Account (Revenue, code 4000 or default)
      let defaultRevenueAccount = accounts.find(
        (a) =>
          a.accountCode === '4000' ||
          a.accountName.toUpperCase().includes('SALES REVENUE') ||
          a.accountType === 'REVENUE'
      );

      if (!defaultRevenueAccount) {
        defaultRevenueAccount = await this.coaRepo.create(
          {
            companyId,
            accountCode: '4000',
            accountName: 'Sales Revenue',
            accountType: 'REVENUE',
            isGroup: false,
            isActive: true,
            currencyCode: invoice.currencyCode,
            description: 'General Sales Revenue Account',
          },
          dbClient
        );
      }

      // Output Tax Account (Liability, code 2200 or default) if taxTotal > 0
      let outputTaxAccount = null;
      if (invoice.taxTotal > 0) {
        outputTaxAccount = accounts.find(
          (a) =>
            a.accountCode === '2200' ||
            a.accountName.toUpperCase().includes('OUTPUT TAX') ||
            a.accountName.toUpperCase().includes('TAX PAYABLE') ||
            a.accountName.toUpperCase().includes('VAT PAYABLE')
        );

        if (!outputTaxAccount) {
          outputTaxAccount = await this.coaRepo.create(
            {
              companyId,
              accountCode: '2200',
              accountName: 'Output Tax Payable',
              accountType: 'LIABILITY',
              isGroup: false,
              isActive: true,
              currencyCode: invoice.currencyCode,
              description: 'Sales Output Tax (VAT) Payable Account',
            },
            dbClient
          );
        }
      }

      // 5. Generate Accounting Journal
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
        journalNumber = `JV-SINV-${invoice.invoiceNumber}`;
      }

      const exchangeRate = invoice.exchangeRate || 1.0;
      const baseGrandTotal = Math.round(invoice.grandTotal * exchangeRate * 10000) / 10000;
      const baseTaxTotal = Math.round(invoice.taxTotal * exchangeRate * 10000) / 10000;
      const netRevenueTotal = Math.round((invoice.subtotal - invoice.discountTotal) * 10000) / 10000;
      const baseRevenueTotal = Math.round(netRevenueTotal * exchangeRate * 10000) / 10000;

      const journalLines: any[] = [];
      let lineNum = 1;

      // DEBIT: Accounts Receivable
      journalLines.push({
        lineNumber: lineNum++,
        accountId: arAccount.id,
        partnerId: invoice.customerId,
        debit: invoice.grandTotal,
        credit: 0,
        currencyCode: invoice.currencyCode,
        exchangeRate,
        baseDebit: baseGrandTotal,
        baseCredit: 0,
        description: `Trade receivable for sales invoice ${invoice.invoiceNumber}`,
      });

      // CREDIT: Sales Revenue
      const lineMap = new Map<string, { amount: number; baseAmount: number }>();
      for (const line of invoice.lines || []) {
        const accId = line.revenueAccountId || defaultRevenueAccount.id;
        const net = Math.round(Number(line.lineNet) * 10000) / 10000;
        const baseNet = Math.round(net * exchangeRate * 10000) / 10000;
        const current = lineMap.get(accId) || { amount: 0, baseAmount: 0 };
        lineMap.set(accId, {
          amount: Math.round((current.amount + net) * 10000) / 10000,
          baseAmount: Math.round((current.baseAmount + baseNet) * 10000) / 10000,
        });
      }

      if (lineMap.size === 0) {
        lineMap.set(defaultRevenueAccount.id, {
          amount: netRevenueTotal,
          baseAmount: baseRevenueTotal,
        });
      }

      for (const [revAccId, amounts] of lineMap.entries()) {
        journalLines.push({
          lineNumber: lineNum++,
          accountId: revAccId,
          debit: 0,
          credit: amounts.amount,
          currencyCode: invoice.currencyCode,
          exchangeRate,
          baseDebit: 0,
          baseCredit: amounts.baseAmount,
          description: `Sales revenue for invoice ${invoice.invoiceNumber}`,
        });
      }

      // CREDIT: Output Tax Payable
      if (invoice.taxTotal > 0 && outputTaxAccount) {
        journalLines.push({
          lineNumber: lineNum++,
          accountId: outputTaxAccount.id,
          debit: 0,
          credit: invoice.taxTotal,
          currencyCode: invoice.currencyCode,
          exchangeRate,
          baseDebit: 0,
          baseCredit: baseTaxTotal,
          description: `Output tax payable for sales invoice ${invoice.invoiceNumber}`,
        });
      }

      // Balancing sanity check
      let sumBaseDebit = 0;
      let sumBaseCredit = 0;
      for (const l of journalLines) {
        sumBaseDebit += l.baseDebit;
        sumBaseCredit += l.baseCredit;
      }
      const roundingDiff = Math.round((sumBaseDebit - sumBaseCredit) * 10000) / 10000;
      if (roundingDiff !== 0 && journalLines.length > 1) {
        journalLines[1].baseCredit = Math.round((journalLines[1].baseCredit + roundingDiff) * 10000) / 10000;
        journalLines[1].credit = Math.round((journalLines[1].credit + roundingDiff / exchangeRate) * 10000) / 10000;
      }

      const totalDebit = journalLines.reduce((acc, l) => acc + l.debit, 0);
      const totalCredit = journalLines.reduce((acc, l) => acc + l.credit, 0);

      const journal = await this.journalRepo.create(
        {
          companyId,
          branchId: invoice.branchId || null,
          journalNumber,
          postingDate: invoice.invoiceDate,
          sourceDocumentType: 'SALES_INVOICE',
          sourceDocumentId: invoice.id,
          description: `Sales invoice posting ${invoice.invoiceNumber}`,
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

      // 6. Record Tax Transactions (Tax Subledger)
      if (invoice.taxTotal > 0 && invoice.lines) {
        for (const line of invoice.lines) {
          if (line.taxAmount > 0) {
            await this.taxRepo.create(
              {
                companyId,
                branchId: invoice.branchId || null,
                taxType: 'OUTPUT_TAX',
                sourceType: 'SALES_INVOICE',
                sourceId: invoice.id,
                sourceLineId: line.id,
                taxCode: line.taxRate ? `${line.taxRate}%` : 'OUTPUT_TAX',
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

      // 7. Mark Invoice as POSTED and link journal
      await this.invoiceRepo.updateStatus(
        id,
        companyId,
        'POSTED',
        {
          postedBy: ctx.userId,
          journalId: journal.id,
        },
        dbClient
      );

      // 8. Create Authoritative Customer Receivable Record (Atomic in same TX)
      await this.receivableRepo.create(
        {
          companyId,
          branchId: invoice.branchId || null,
          customerId: invoice.customerId,
          salesInvoiceId: invoice.id,
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

      // 9. Audit Log (Financial Document Posting)
      await this.audit.logPost(
        'sales',
        'SalesInvoice',
        id,
        ctx,
        `Posted sales invoice ${invoice.invoiceNumber} for amount ${invoice.grandTotal} ${invoice.currencyCode}`,
        dbClient
      );

      return this.getById(id, ctx, dbClient);
    });
  }

  async reverse(id: string, reason: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      // 1. Enforce State Transition
      this.stateMachine.validateTransition({
        documentType: 'SALES_INVOICE',
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

      // 2. Lock invoice row FOR UPDATE
      await this.invoiceRepo.findByIdForUpdate(id, companyId, dbClient);

      // 3. Verify that invoice has not been paid / settled
      const receivable = await this.receivableRepo.findByInvoiceId(id, companyId, dbClient);
      if (
        receivable &&
        (receivable.paidAmount > 0 ||
          receivable.status === 'PAID' ||
          receivable.status === 'PARTIALLY_PAID')
      ) {
        throw AppError.badRequest(
          `Cannot reverse sales invoice '${invoice.invoiceNumber}': payments have already been received or applied to this receivable`
        );
      }

      // 4. Create Reversal General Ledger Journal
      let reversalJournalId: string | null = null;
      if (invoice.journalId) {
        const origJournal = await this.journalRepo.findById(invoice.journalId, companyId, dbClient);
        if (origJournal && origJournal.status === 'POSTED') {
          const origLines = await this.journalRepo.getLines(origJournal.id, dbClient);

          let revJournalNumber = '';
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
            revJournalNumber = numResult.formattedNumber;
          } catch {
            revJournalNumber = `REV-${origJournal.journalNumber}`;
          }

          const reversalLines = origLines.map((l, idx) => ({
            lineNumber: idx + 1,
            accountId: l.accountId,
            partnerId: l.partnerId || null,
            debit: l.credit, // Invert
            credit: l.debit, // Invert
            currencyCode: l.currencyCode,
            exchangeRate: l.exchangeRate,
            baseDebit: l.baseCredit, // Invert
            baseCredit: l.baseDebit, // Invert
            description: `Reversal of line ${l.lineNumber} (${origJournal.journalNumber}) - ${reason}`,
          }));

          const revJournal = await this.journalRepo.create(
            {
              companyId,
              branchId: invoice.branchId || null,
              journalNumber: revJournalNumber,
              postingDate: new Date().toISOString().split('T')[0],
              sourceDocumentType: 'SALES_INVOICE_REVERSAL',
              sourceDocumentId: invoice.id,
              description: `Compensating reversal of journal ${origJournal.journalNumber} for invoice ${invoice.invoiceNumber}: ${reason}`,
              status: 'POSTED',
              totalDebit: origJournal.totalCredit,
              totalCredit: origJournal.totalDebit,
              currencyCode: origJournal.currencyCode,
              createdBy: ctx.userId,
              approvedBy: ctx.userId,
              approvedAt: new Date().toISOString(),
              postedBy: ctx.userId,
              postedAt: new Date().toISOString(),
              lines: reversalLines,
            },
            dbClient
          );

          reversalJournalId = revJournal.id;

          // Link reversal on original journal
          await dbClient.query(
            `UPDATE accounting_journals SET reversal_journal_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND company_id = $3`,
            [revJournal.id, origJournal.id, companyId]
          );
        }
      }

      // 5. Update Tax Transactions to REVERSED
      await this.taxRepo.updateStatusBySource(
        'SALES_INVOICE',
        invoice.id,
        companyId,
        'REVERSED',
        reversalJournalId,
        dbClient
      );

      // 6. Update Associated Customer Receivable status to REVERSED
      if (receivable) {
        await this.receivableRepo.updateStatus(receivable.id, companyId, 'REVERSED', dbClient);
      }

      // 7. Mark Invoice as REVERSED
      await this.invoiceRepo.updateStatus(
        id,
        companyId,
        'REVERSED',
        { reversedBy: ctx.userId },
        dbClient
      );

      // 8. Audit Log
      await this.audit.logReverse('sales', 'SalesInvoice', id, ctx, reason, dbClient);

      return this.getById(id, ctx, dbClient);
    });
  }

  async cancel(id: string, reason: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return withTransaction(async (dbClient) => {
      const invoice = await this.getById(id, ctx, dbClient);

      this.stateMachine.validateTransition({
        documentType: 'SALES_INVOICE',
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

      await this.invoiceRepo.updateStatus(id, companyId, 'CANCELLED', undefined, dbClient);

      await this.audit.logCancel('sales', 'SalesInvoice', id, ctx, reason, dbClient);

      return this.getById(id, ctx, dbClient);
    });
  }

  async delete(id: string, ctx: SecurityContext): Promise<void> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    const invoice = await this.getById(id, ctx);
    if (invoice.status !== 'DRAFT') {
      throw AppError.badRequest(`Only DRAFT sales invoices can be deleted (current status: '${invoice.status}')`);
    }

    const deleted = await this.invoiceRepo.deleteDraft(id, companyId);
    if (!deleted) {
      throw AppError.notFound(`Draft sales invoice '${id}' could not be deleted`);
    }

    await this.audit.logDelete('sales', 'SalesInvoice', id, { invoiceNumber: invoice.invoiceNumber }, ctx);
  }

  async list(
    filters: {
      customerId?: string;
      salesOrderId?: string;
      deliveryId?: string;
      status?: SalesInvoiceStatus;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
    ctx: SecurityContext
  ): Promise<{ items: SalesInvoice[]; total: number }> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return this.invoiceRepo.list(companyId, filters);
  }
}
