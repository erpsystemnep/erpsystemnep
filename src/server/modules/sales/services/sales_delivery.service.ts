import { withTransaction } from '../../../db/connection.js';
import {
  SalesDeliveryRepository,
  CreateDeliveryDbHeaderInput,
  CreateDeliveryLineDbInput,
} from '../repositories/sales_delivery.repository.js';
import { SalesOrderRepository } from '../repositories/sales_order.repository.js';
import { SalesReservationRepository } from '../repositories/sales_reservation.repository.js';
import { BatchRepository } from '../../inventory/repositories/batch.repository.js';
import { StockLedgerRepository } from '../../inventory/repositories/stock_ledger.repository.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { CreateSalesDeliveryInput } from '../../../../shared/schemas/sales.js';
import { InventoryValuationService } from '../../inventory/services/inventory_valuation.service.js';
import { ChartOfAccountsRepository } from '../../accounting/repositories/chart_of_accounts.repository.js';
import { AccountingJournalRepository } from '../../accounting/repositories/accounting_journal.repository.js';
import { SalesDelivery, SecurityContext, SalesDeliveryStatus } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class SalesDeliveryService {
  constructor(
    private deliveryRepo: SalesDeliveryRepository = new SalesDeliveryRepository(),
    private soRepo: SalesOrderRepository = new SalesOrderRepository(),
    private resvRepo: SalesReservationRepository = new SalesReservationRepository(),
    private batchRepo: BatchRepository = new BatchRepository(),
    private stockLedgerRepo: StockLedgerRepository = new StockLedgerRepository(),
    private stateMachine: StateMachineEngine = new StateMachineEngine(),
    private numbering: NumberingService = new NumberingService(),
    private audit: AuditService = new AuditService(),
    private valuationService: InventoryValuationService = new InventoryValuationService(),
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository(),
    private journalRepo: AccountingJournalRepository = new AccountingJournalRepository()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Sales Delivery operations');
    }
    return ctx.activeCompanyId;
  }

  async create(
    input: CreateSalesDeliveryInput,
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<SalesDelivery> {
    const companyId = this.resolveCompanyId(ctx, input.companyId);

    const exec = async (dbClient: pg.PoolClient) => {
      // 1. Verify Customer
      const custRes = await dbClient.query(
        `SELECT id, legal_name, is_customer, is_active FROM business_partners WHERE id = $1 AND company_id = $2`,
        [input.customerId, companyId]
      );
      if (custRes.rows.length === 0) {
        throw AppError.notFound(`Customer with id '${input.customerId}' not found in company`);
      }
      if (!custRes.rows[0].is_customer) {
        throw AppError.badRequest(`Business partner '${custRes.rows[0].legal_name}' is not registered as a customer`);
      }
      if (!custRes.rows[0].is_active) {
        throw AppError.badRequest(`Customer '${custRes.rows[0].legal_name}' is inactive`);
      }

      // 2. If Sales Order reference is provided, verify it
      if (input.salesOrderId) {
        const soRes = await dbClient.query(
          `SELECT id, so_number, customer_id, status FROM sales_orders WHERE id = $1 AND company_id = $2`,
          [input.salesOrderId, companyId]
        );
        if (soRes.rows.length === 0) {
          throw AppError.notFound(`Referenced Sales Order '${input.salesOrderId}' not found in company`);
        }
        const so = soRes.rows[0];
        if (so.status !== 'APPROVED' && so.status !== 'POSTED') {
          throw AppError.badRequest(
            `Referenced Sales Order '${so.so_number}' must be in APPROVED or POSTED status (currently '${so.status}')`
          );
        }
        if (so.customer_id !== input.customerId) {
          throw AppError.badRequest('Delivery customer does not match Sales Order customer');
        }
      }

      // 3. Process Lines and Batch Allocations
      const calculatedLines: CreateDeliveryLineDbInput[] = [];

      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        const lineNum = line.lineNumber || i + 1;

        const itemRes = await dbClient.query(
          `SELECT id, sku, item_name, is_stock_item, is_sellable, is_active FROM items WHERE id = $1 AND company_id = $2`,
          [line.itemId, companyId]
        );
        if (itemRes.rows.length === 0) {
          throw AppError.notFound(`Item '${line.itemId}' not found in company`);
        }
        if (!itemRes.rows[0].is_stock_item) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].item_name}' is not marked as a stock item`);
        }
        if (!itemRes.rows[0].is_sellable) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].item_name}' is not marked as sellable`);
        }
        if (!itemRes.rows[0].is_active) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].item_name}' is inactive`);
        }

        const whRes = await dbClient.query(
          `SELECT id FROM warehouses WHERE id = $1 AND company_id = $2`,
          [line.warehouseId, companyId]
        );
        if (whRes.rows.length === 0) {
          throw AppError.notFound(`Warehouse '${line.warehouseId}' not found in company`);
        }

        // Validate SO line quantity ceiling if linked
        if (line.salesOrderLineId) {
          const soLineRes = await dbClient.query(
            `SELECT ordered_quantity FROM sales_order_lines WHERE id = $1`,
            [line.salesOrderLineId]
          );
          if (soLineRes.rows.length > 0) {
            const orderedQty = parseFloat(soLineRes.rows[0].ordered_quantity);
            const alreadyDelivered = await this.soRepo.getTotalDeliveredQuantityForSoLine(
              line.salesOrderLineId,
              dbClient
            );
            if (alreadyDelivered + line.deliveredQuantity > orderedQty) {
              throw AppError.badRequest(
                `Delivered quantity (${alreadyDelivered + line.deliveredQuantity}) exceeds Sales Order ordered quantity (${orderedQty}) for line ${lineNum}`
              );
            }
          }
        }

        // Validate batch allocations sum
        const totalBatchQty = line.batchAllocations.reduce((sum, b) => sum + b.quantity, 0);
        if (Math.abs(totalBatchQty - line.deliveredQuantity) > 0.0001) {
          throw AppError.badRequest(
            `Sum of batch allocation quantities (${totalBatchQty}) must equal delivered quantity (${line.deliveredQuantity}) for line ${lineNum}`
          );
        }

        // Validate batches exist and are for this item and not expired
        for (const alloc of line.batchAllocations) {
          const batchRes = await dbClient.query(
            `SELECT id, batch_number, expiry_date FROM inventory_batches WHERE id = $1 AND company_id = $2 AND item_id = $3`,
            [alloc.batchId, companyId, line.itemId]
          );
          if (batchRes.rows.length === 0) {
            throw AppError.badRequest(
              `Batch with id '${alloc.batchId}' does not exist for item '${itemRes.rows[0].sku}' in company`
            );
          }
        }

        const convFactor = line.conversionFactor || 1.0;
        const baseQty = line.baseQuantity || line.deliveredQuantity * convFactor;

        calculatedLines.push({
          salesOrderLineId: line.salesOrderLineId || null,
          lineNumber: lineNum,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          uomId: line.uomId,
          deliveredQuantity: line.deliveredQuantity,
          conversionFactor: convFactor,
          baseQuantity: baseQty,
          isReserved: Boolean(line.isReserved),
          batchAllocations: line.batchAllocations.map((a) => ({
            batchId: a.batchId,
            quantity: a.quantity,
          })),
        });
      }

      // 4. Generate Delivery Number
      const generatedNumber = await this.numbering.generateNextNumber(
        {
          companyId,
          branchId: input.branchId || null,
          documentType: 'SALES_DELIVERY',
        },
        ctx,
        dbClient
      );

      // 5. Save Delivery Document
      const headerInput: CreateDeliveryDbHeaderInput = {
        companyId,
        branchId: input.branchId || null,
        deliveryNumber: generatedNumber.formattedNumber,
        salesOrderId: input.salesOrderId || null,
        customerId: input.customerId,
        deliveryDate: input.deliveryDate || new Date().toISOString(),
        status: 'DRAFT',
        notes: input.notes || null,
        createdBy: ctx.userId,
      };

      const createdDelivery = await this.deliveryRepo.create(headerInput, calculatedLines, dbClient);

      // 6. Audit Log
      await this.audit.logCreate(
        'sales',
        'SalesDelivery',
        createdDelivery.id,
        createdDelivery as any,
        ctx,
        dbClient
      );

      return createdDelivery;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async findById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesDelivery> {
    const companyId = ctx.isSuperadmin ? undefined : (ctx.activeCompanyId || undefined);
    const delivery = await this.deliveryRepo.findById(id, companyId, client);
    if (!delivery) {
      throw AppError.notFound(`Sales Delivery '${id}' not found`);
    }
    return delivery;
  }

  async list(
    filters: {
      customerId?: string;
      salesOrderId?: string;
      status?: SalesDeliveryStatus;
      search?: string;
      page?: number;
      limit?: number;
    },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<{ data: SalesDelivery[]; total: number }> {
    const companyId = this.resolveCompanyId(ctx);
    return this.deliveryRepo.list(companyId, filters, client);
  }

  async submit(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesDelivery> {
    const exec = async (dbClient: pg.PoolClient) => {
      const delivery = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_DELIVERY',
        currentState: delivery.status,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          creatorId: delivery.createdBy || undefined,
          companyId: delivery.companyId,
          branchId: delivery.branchId,
          documentId: delivery.id,
        },
      });

      const updated = await this.deliveryRepo.updateStatus(id, 'SUBMITTED', dbClient);
      await this.audit.logUpdate(
        'sales',
        'SalesDelivery',
        id,
        { status: delivery.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted sales delivery note for approval',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async approve(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesDelivery> {
    const exec = async (dbClient: pg.PoolClient) => {
      const delivery = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_DELIVERY',
        currentState: delivery.status,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          creatorId: delivery.createdBy || undefined,
          companyId: delivery.companyId,
          branchId: delivery.branchId,
          documentId: delivery.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.deliveryRepo.updateStatus(id, 'APPROVED', dbClient, {
        approvedBy: ctx.userId,
        approvedAt: now,
      });

      await this.audit.logUpdate(
        'sales',
        'SalesDelivery',
        id,
        { status: delivery.status },
        { status: 'APPROVED', approvedBy: ctx.userId, approvedAt: now },
        ctx,
        'Approved sales delivery note',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async reject(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesDelivery> {
    const exec = async (dbClient: pg.PoolClient) => {
      const delivery = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_DELIVERY',
        currentState: delivery.status,
        targetState: 'REJECTED',
        ctx,
        documentContext: {
          creatorId: delivery.createdBy || undefined,
          companyId: delivery.companyId,
          branchId: delivery.branchId,
          documentId: delivery.id,
        },
      });

      const updated = await this.deliveryRepo.updateStatus(id, 'REJECTED', dbClient);
      await this.audit.logUpdate(
        'sales',
        'SalesDelivery',
        id,
        { status: delivery.status },
        { status: 'REJECTED' },
        ctx,
        'Rejected sales delivery note',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async post(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesDelivery> {
    const exec = async (dbClient: pg.PoolClient) => {
      const delivery = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_DELIVERY',
        currentState: delivery.status,
        targetState: 'POSTED',
        ctx,
        documentContext: {
          creatorId: delivery.createdBy || undefined,
          companyId: delivery.companyId,
          branchId: delivery.branchId,
          documentId: delivery.id,
        },
      });

      // 1. Process Stock Ledger Deductions, Reservation Fulfillments, and Cost Layer Consumption
      let totalCogsCost = 0;
      for (const line of delivery.lines || []) {
        for (const alloc of line.batchAllocations || []) {
          // Fetch batch unit cost for accurate valuation
          const batchRes = await dbClient.query(
            `SELECT unit_cost FROM inventory_batches WHERE id = $1`,
            [alloc.batchId]
          );
          const unitCost = batchRes.rows.length > 0 ? parseFloat(batchRes.rows[0].unit_cost || '0') : 0;
          const totalCost = alloc.quantity * unitCost;

          if (line.isReserved && line.salesOrderLineId) {
            // Check active reservations for this line & batch
            const resvSql = `
              SELECT id, reserved_quantity, fulfilled_quantity, released_quantity
              FROM sales_reservations
              WHERE sales_order_line_id = $1 AND (batch_id = $2 OR batch_id IS NULL) AND status = 'ACTIVE'
              ORDER BY created_at ASC
            `;
            const resvRes = await dbClient.query(resvSql, [line.salesOrderLineId, alloc.batchId]);
            let remainingToFulfill = alloc.quantity;

            for (const r of resvRes.rows) {
              if (remainingToFulfill <= 0) break;
              const unfulfilled = parseFloat(r.reserved_quantity) - parseFloat(r.fulfilled_quantity || '0') - parseFloat(r.released_quantity || '0');
              const fulfillThis = Math.min(remainingToFulfill, unfulfilled);

              if (fulfillThis > 0) {
                await this.resvRepo.updateFulfilledQuantity(r.id, fulfillThis, dbClient);
                remainingToFulfill -= fulfillThis;
              }
            }

            // Post deduction from RESERVED pool
            await this.stockLedgerRepo.createEntry(
              {
                companyId: delivery.companyId,
                branchId: delivery.branchId,
                warehouseId: line.warehouseId,
                itemId: line.itemId,
                batchId: alloc.batchId,
                uomId: line.uomId,
                quantity: -alloc.quantity,
                stockStatus: 'RESERVED',
                movementType: 'SALES_DELIVERY',
                unitCost,
                totalCost,
                sourceDocumentType: 'SALES_DELIVERY',
                sourceDocumentId: delivery.id,
                sourceDocumentLineId: line.id,
                createdBy: ctx.userId,
              },
              dbClient
            );
          } else {
            // Direct fulfillment from AVAILABLE stock
            // Verify stock availability
            const availBalance = await this.stockLedgerRepo.getBatchStockBalance(
              delivery.companyId,
              line.warehouseId,
              line.itemId,
              alloc.batchId,
              'AVAILABLE',
              dbClient
            );
            if (availBalance < alloc.quantity) {
              throw AppError.badRequest(
                `Insufficient available stock for batch. Required: ${alloc.quantity}, Available: ${availBalance}`
              );
            }

            // Post deduction from AVAILABLE pool
            await this.stockLedgerRepo.createEntry(
              {
                companyId: delivery.companyId,
                branchId: delivery.branchId,
                warehouseId: line.warehouseId,
                itemId: line.itemId,
                batchId: alloc.batchId,
                uomId: line.uomId,
                quantity: -alloc.quantity,
                stockStatus: 'AVAILABLE',
                movementType: 'SALES_DELIVERY',
                unitCost,
                totalCost,
                sourceDocumentType: 'SALES_DELIVERY',
                sourceDocumentId: delivery.id,
                sourceDocumentLineId: line.id,
                createdBy: ctx.userId,
              },
              dbClient
            );
          }

          // Authoritative FIFO cost layer consumption and valuation subledger recording
          const issueRes = await this.valuationService.issueCostLayers(
            {
              companyId: delivery.companyId,
              branchId: delivery.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: alloc.batchId,
              quantity: alloc.quantity,
              sourceDocumentType: 'SALES_DELIVERY',
              sourceDocumentId: delivery.id,
              sourceDocumentLineId: line.id,
              accountingDate: delivery.deliveryDate ? new Date(delivery.deliveryDate).toISOString().split('T')[0] : undefined,
            },
            dbClient
          );
          totalCogsCost = Math.round((totalCogsCost + issueRes.totalCost) * 10000) / 10000;
        }
      }

      // 2. Mark status as POSTED
      const now = new Date().toISOString();
      const updated = await this.deliveryRepo.updateStatus(id, 'POSTED', dbClient, {
        postedBy: ctx.userId,
        postedAt: now,
      });

      // 3. Post COGS General Ledger Journal if cost recognized
      let journalId: string | null = null;
      if (totalCogsCost > 0) {
        const accounts = await this.coaRepo.list(delivery.companyId, { isActive: true, isGroup: false }, dbClient);

        let cogsAccount = accounts.find(
          (a) =>
            a.accountCode === '5000' ||
            a.accountCode === '5100' ||
            a.accountName.toUpperCase().includes('COGS') ||
            a.accountName.toUpperCase().includes('COST OF GOODS') ||
            a.accountType === 'EXPENSE'
        );
        if (!cogsAccount) {
          cogsAccount = await this.coaRepo.create(
            {
              companyId: delivery.companyId,
              accountCode: '5000',
              accountName: 'Cost of Goods Sold',
              accountType: 'EXPENSE',
              isGroup: false,
              isActive: true,
              currencyCode: 'USD',
              description: 'Cost of Goods Sold expense account',
            },
            dbClient
          );
        }

        let inventoryAccount = accounts.find(
          (a) =>
            a.accountCode === '1400' ||
            a.accountName.toUpperCase().includes('INVENTORY') ||
            a.accountType === 'ASSET'
        );
        if (!inventoryAccount) {
          inventoryAccount = await this.coaRepo.create(
            {
              companyId: delivery.companyId,
              accountCode: '1400',
              accountName: 'Merchandise Inventory',
              accountType: 'ASSET',
              isGroup: false,
              isActive: true,
              currencyCode: 'USD',
              description: 'General Inventory Asset Account',
            },
            dbClient
          );
        }

        let journalNumber = '';
        try {
          const numRes = await this.numbering.generateNextNumber(
            {
              companyId: delivery.companyId,
              branchId: delivery.branchId || null,
              documentType: 'JOURNAL',
            },
            ctx,
            dbClient
          );
          journalNumber = numRes.formattedNumber;
        } catch {
          journalNumber = `JV-DELV-${delivery.deliveryNumber}`;
        }

        const journal = await this.journalRepo.create(
          {
            companyId: delivery.companyId,
            branchId: delivery.branchId,
            journalNumber,
            postingDate: delivery.deliveryDate ? new Date(delivery.deliveryDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            sourceDocumentType: 'SALES_DELIVERY',
            sourceDocumentId: delivery.id,
            description: `COGS recognition for delivery ${delivery.deliveryNumber}`,
            status: 'POSTED',
            totalDebit: totalCogsCost,
            totalCredit: totalCogsCost,
            currencyCode: 'USD',
            createdBy: ctx.userId,
            postedBy: ctx.userId,
            postedAt: now,
            lines: [
              {
                lineNumber: 1,
                accountId: cogsAccount.id,
                debit: totalCogsCost,
                credit: 0,
                baseDebit: totalCogsCost,
                baseCredit: 0,
                description: `COGS for delivery ${delivery.deliveryNumber}`,
              },
              {
                lineNumber: 2,
                accountId: inventoryAccount.id,
                debit: 0,
                credit: totalCogsCost,
                baseDebit: 0,
                baseCredit: totalCogsCost,
                description: `Inventory reduction for delivery ${delivery.deliveryNumber}`,
              },
            ],
          },
          dbClient
        );

        journalId = journal.id;
        await dbClient.query(`UPDATE sales_deliveries SET journal_id = $1 WHERE id = $2`, [journal.id, delivery.id]);
        await this.valuationService.assignJournalToTransactions('SALES_DELIVERY', delivery.id, journal.id, dbClient);
      }

      // 4. Audit Log
      await this.audit.logUpdate(
        'sales',
        'SalesDelivery',
        id,
        { status: delivery.status },
        { status: 'POSTED', postedBy: ctx.userId, postedAt: now, journalId },
        ctx,
        'Posted Goods Delivery Note, deducted stock and recorded COGS',
        dbClient
      );

      const refreshed = await this.findById(id, ctx, dbClient);
      return refreshed;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async reverse(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesDelivery> {
    const exec = async (dbClient: pg.PoolClient) => {
      const delivery = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_DELIVERY',
        currentState: delivery.status,
        targetState: 'REVERSED',
        ctx,
        documentContext: {
          creatorId: delivery.createdBy || undefined,
          companyId: delivery.companyId,
          branchId: delivery.branchId,
          documentId: delivery.id,
        },
      });

      // Compensating stock movements: add back stock
      for (const line of delivery.lines || []) {
        for (const alloc of line.batchAllocations || []) {
          const batchRes = await dbClient.query(
            `SELECT unit_cost FROM inventory_batches WHERE id = $1`,
            [alloc.batchId]
          );
          const unitCost = batchRes.rows.length > 0 ? parseFloat(batchRes.rows[0].unit_cost || '0') : 0;
          const totalCost = alloc.quantity * unitCost;

          await this.stockLedgerRepo.createEntry(
            {
              companyId: delivery.companyId,
              branchId: delivery.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: alloc.batchId,
              uomId: line.uomId,
              quantity: alloc.quantity, // positive return
              stockStatus: 'AVAILABLE',
              movementType: 'SALES_DELIVERY_REVERSAL',
              unitCost,
              totalCost,
              sourceDocumentType: 'SALES_DELIVERY',
              sourceDocumentId: delivery.id,
              sourceDocumentLineId: line.id,
              createdBy: ctx.userId,
            },
            dbClient
          );
        }
      }

      // Restore FIFO Cost layers and record valuation reversal transactions
      const restoreRes = await this.valuationService.restoreCostLayers('SALES_DELIVERY', delivery.id, dbClient);

      const now = new Date().toISOString();
      const updated = await this.deliveryRepo.updateStatus(id, 'REVERSED', dbClient);
      await dbClient.query(
        `UPDATE sales_deliveries SET reversed_by = $1, reversed_at = $2 WHERE id = $3`,
        [ctx.userId, now, id]
      );

      // Compensating General Ledger Journal for COGS reversal
      if (delivery.journalId && restoreRes.totalCost > 0) {
        const origJournal = await this.journalRepo.findById(delivery.journalId, dbClient);
        if (origJournal && origJournal.lines && origJournal.lines.length >= 2) {
          const cogsLine = origJournal.lines.find((l) => l.debit > 0);
          const invLine = origJournal.lines.find((l) => l.credit > 0);

          if (cogsLine && invLine) {
            const revJournal = await this.journalRepo.create(
              {
                companyId: delivery.companyId,
                branchId: delivery.branchId,
                journalNumber: `REV-DELV-${delivery.deliveryNumber}`,
                postingDate: new Date().toISOString().split('T')[0],
                sourceDocumentType: 'SALES_DELIVERY_REVERSAL',
                sourceDocumentId: delivery.id,
                description: `Reversal of COGS for delivery ${delivery.deliveryNumber}`,
                status: 'POSTED',
                totalDebit: restoreRes.totalCost,
                totalCredit: restoreRes.totalCost,
                currencyCode: 'USD',
                createdBy: ctx.userId,
                postedBy: ctx.userId,
                postedAt: now,
                lines: [
                  {
                    lineNumber: 1,
                    accountId: invLine.accountId,
                    debit: restoreRes.totalCost,
                    credit: 0,
                    baseDebit: restoreRes.totalCost,
                    baseCredit: 0,
                    description: `Inventory restoration for delivery ${delivery.deliveryNumber}`,
                  },
                  {
                    lineNumber: 2,
                    accountId: cogsLine.accountId,
                    debit: 0,
                    credit: restoreRes.totalCost,
                    baseDebit: 0,
                    baseCredit: restoreRes.totalCost,
                    description: `COGS reversal for delivery ${delivery.deliveryNumber}`,
                  },
                ],
              },
              dbClient
            );

            await dbClient.query(
              `UPDATE accounting_journals SET reversal_journal_id = $1 WHERE id = $2`,
              [revJournal.id, origJournal.id]
            );

            await dbClient.query(
              `UPDATE inventory_valuation_transactions SET reversal_journal_id = $1 WHERE source_type = 'SALES_DELIVERY_REVERSAL' AND source_id = $2`,
              [revJournal.id, delivery.id]
            );
          }
        }
      }

      await this.audit.logUpdate(
        'sales',
        'SalesDelivery',
        id,
        { status: delivery.status },
        { status: 'REVERSED', reversedBy: ctx.userId, reversedAt: now },
        ctx,
        'Reversed posted Goods Delivery Note with offset stock ledger and COGS reversal',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async cancel(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesDelivery> {
    const exec = async (dbClient: pg.PoolClient) => {
      const delivery = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_DELIVERY',
        currentState: delivery.status,
        targetState: 'CANCELLED',
        ctx,
        documentContext: {
          creatorId: delivery.createdBy || undefined,
          companyId: delivery.companyId,
          branchId: delivery.branchId,
          documentId: delivery.id,
        },
      });

      const updated = await this.deliveryRepo.updateStatus(id, 'CANCELLED', dbClient);
      await this.audit.logUpdate(
        'sales',
        'SalesDelivery',
        id,
        { status: delivery.status },
        { status: 'CANCELLED' },
        ctx,
        'Cancelled draft or approved sales delivery note',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async delete(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<boolean> {
    const exec = async (dbClient: pg.PoolClient) => {
      const delivery = await this.findById(id, ctx, dbClient);
      if (delivery.status !== 'DRAFT') {
        throw AppError.badRequest(`Cannot delete Sales Delivery in '${delivery.status}' status (must be DRAFT)`);
      }
      const deleted = await this.deliveryRepo.delete(id, delivery.companyId, dbClient);
      if (deleted) {
        await this.audit.logDelete('sales', 'SalesDelivery', id, delivery as any, ctx, 'Deleted draft delivery note', dbClient);
      }
      return deleted;
    };

    return client ? exec(client) : withTransaction(exec);
  }
}
