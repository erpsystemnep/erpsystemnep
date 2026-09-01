import { withTransaction } from '../../../db/connection.js';
import {
  PurchaseReceiptRepository,
  CreateReceiptDbInput,
  CreateReceiptLineDbInput,
} from '../repositories/purchase_receipt.repository.js';
import { BatchRepository } from '../../inventory/repositories/batch.repository.js';
import { StockLedgerRepository } from '../../inventory/repositories/stock_ledger.repository.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { CreatePurchaseReceiptInput } from '../../../../shared/schemas/purchase.js';
import { PurchaseReceipt, SecurityContext } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class PurchaseReceiptService {
  constructor(
    private receiptRepo: PurchaseReceiptRepository = new PurchaseReceiptRepository(),
    private batchRepo: BatchRepository = new BatchRepository(),
    private stockLedgerRepo: StockLedgerRepository = new StockLedgerRepository(),
    private stateMachine: StateMachineEngine = new StateMachineEngine(),
    private numbering: NumberingService = new NumberingService(),
    private audit: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Purchase Receipt operations');
    }
    return ctx.activeCompanyId;
  }

  async create(input: CreatePurchaseReceiptInput, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReceipt> {
    const companyId = this.resolveCompanyId(ctx, input.companyId);

    const exec = async (dbClient: pg.PoolClient) => {
      // 1. Verify supplier
      const suppRes = await dbClient.query(
        `SELECT id, legal_name, is_supplier, is_active FROM business_partners WHERE id = $1 AND company_id = $2`,
        [input.supplierId, companyId]
      );
      if (suppRes.rows.length === 0) {
        throw AppError.notFound(`Supplier with id '${input.supplierId}' not found in company`);
      }
      if (!suppRes.rows[0].is_supplier) {
        throw AppError.badRequest(`Business partner '${suppRes.rows[0].legal_name}' is not registered as a supplier`);
      }

      // 2. If PO reference is present, verify PO is approved and matches tenant
      if (input.purchaseOrderId) {
        const poRes = await dbClient.query(
          `SELECT id, status, supplier_id FROM purchase_orders WHERE id = $1 AND company_id = $2`,
          [input.purchaseOrderId, companyId]
        );
        if (poRes.rows.length === 0) {
          throw AppError.notFound(`Referenced purchase order '${input.purchaseOrderId}' not found in company`);
        }
        if (poRes.rows[0].status !== 'APPROVED') {
          throw AppError.badRequest(
            `Referenced purchase order must be in APPROVED status (currently '${poRes.rows[0].status}')`
          );
        }
        if (poRes.rows[0].supplier_id !== input.supplierId) {
          throw AppError.badRequest(`Receipt supplier does not match Purchase Order supplier`);
        }
      }

      // 3. Process lines and batches
      let totalAmount = 0;
      const calculatedLines: CreateReceiptLineDbInput[] = [];

      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        const lineNum = line.lineNumber || i + 1;

        const itemRes = await dbClient.query(
          `SELECT id, sku, item_name, is_stock_item, is_purchasable, is_active FROM items WHERE id = $1 AND company_id = $2`,
          [line.itemId, companyId]
        );
        if (itemRes.rows.length === 0) {
          throw AppError.notFound(`Item '${line.itemId}' not found in company`);
        }
        if (!itemRes.rows[0].is_stock_item) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].item_name}' is not marked as a stock item`);
        }

        const whRes = await dbClient.query(
          `SELECT id FROM warehouses WHERE id = $1 AND company_id = $2`,
          [line.warehouseId, companyId]
        );
        if (whRes.rows.length === 0) {
          throw AppError.notFound(`Warehouse '${line.warehouseId}' not found in company`);
        }

        if (line.poLineId) {
          const poLineRes = await dbClient.query(
            `SELECT ordered_quantity FROM purchase_order_lines WHERE id = $1`,
            [line.poLineId]
          );
          if (poLineRes.rows.length > 0) {
            const orderedQty = parseFloat(poLineRes.rows[0].ordered_quantity);
            const alreadyReceived = await this.receiptRepo.getTotalReceivedQuantityForPoLine(line.poLineId, dbClient);
            if (alreadyReceived + line.receivedQuantity > orderedQty) {
              throw AppError.badRequest(
                `Received quantity (${alreadyReceived + line.receivedQuantity}) exceeds PO ordered quantity (${orderedQty}) for line ${lineNum}`
              );
            }
          }
        }

        const totalBatchQty = line.batchAllocations.reduce((sum, b) => sum + b.quantity, 0);
        if (Math.abs(totalBatchQty - line.receivedQuantity) > 0.0001) {
          throw AppError.badRequest(
            `Sum of batch allocation quantities (${totalBatchQty}) must equal received quantity (${line.receivedQuantity}) for line ${lineNum}`
          );
        }

        const lineTotal = line.receivedQuantity * line.unitRate;
        totalAmount += lineTotal;

        const processedAllocations: Array<{ batchId: string; quantity: number; unitCost: number }> = [];
        for (const alloc of line.batchAllocations) {
          let batch = await this.batchRepo.findByNumber(companyId, line.itemId, alloc.batchNumber, dbClient);
          if (!batch) {
            batch = await this.batchRepo.create(
              {
                companyId,
                itemId: line.itemId,
                batchNumber: alloc.batchNumber,
                supplierId: input.supplierId,
                supplierBatchNumber: alloc.supplierBatchNumber || null,
                manufacturingDate: alloc.manufacturingDate || null,
                expiryDate: alloc.expiryDate || null,
                unitCost: alloc.unitCost,
              },
              dbClient
            );
          }
          processedAllocations.push({
            batchId: batch.id,
            quantity: alloc.quantity,
            unitCost: alloc.unitCost,
          });
        }

        const convFactor = line.conversionFactor || 1.0;
        const baseQty = line.baseQuantity || line.receivedQuantity * convFactor;

        calculatedLines.push({
          lineNumber: lineNum,
          poLineId: line.poLineId || null,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          uomId: line.uomId,
          receivedQuantity: line.receivedQuantity,
          conversionFactor: convFactor,
          baseQuantity: baseQty,
          unitRate: line.unitRate,
          totalAmount: lineTotal,
          batchAllocations: processedAllocations,
        });
      }

      let receiptNumber = input.receiptNumber;
      if (!receiptNumber) {
        const numRes = await this.numbering.generateNextNumber(
          {
            companyId,
            branchId: input.branchId || null,
            documentType: 'PURCHASE_RECEIPT',
          },
          ctx,
          dbClient
        );
        receiptNumber = numRes.formattedNumber;
      }

      const receiptDb: CreateReceiptDbInput = {
        companyId,
        branchId: input.branchId || null,
        receiptNumber: receiptNumber!,
        purchaseOrderId: input.purchaseOrderId || null,
        supplierId: input.supplierId,
        receiptDate: input.receiptDate || new Date().toISOString(),
        status: 'DRAFT',
        supplierDeliveryNote: input.supplierDeliveryNote || null,
        qcRequired: input.qcRequired !== undefined ? input.qcRequired : true,
        totalAmount,
        notes: input.notes || null,
        createdBy: ctx.userId,
      };

      const created = await this.receiptRepo.create(receiptDb, calculatedLines, dbClient);

      await this.audit.logCreate(
        'purchase',
        'PurchaseReceipt',
        created.id,
        created as unknown as Record<string, unknown>,
        ctx,
        dbClient
      );

      return created;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async findById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReceipt> {
    const companyId = this.resolveCompanyId(ctx);
    const receipt = await this.receiptRepo.findById(id, client);
    if (!receipt || (!ctx.isSuperadmin && receipt.companyId !== companyId)) {
      throw AppError.notFound(`Purchase receipt '${id}' not found`);
    }
    return receipt;
  }

  async list(
    filters: { branchId?: string | null; supplierId?: string; status?: string; purchaseOrderId?: string },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<PurchaseReceipt[]> {
    const companyId = this.resolveCompanyId(ctx);
    return this.receiptRepo.list(companyId, filters, client);
  }

  async submit(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReceipt> {
    const exec = async (dbClient: pg.PoolClient) => {
      const receipt = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_RECEIPT',
        currentState: receipt.status,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          creatorId: receipt.createdBy || undefined,
          companyId: receipt.companyId,
          branchId: receipt.branchId,
          documentId: receipt.id,
        },
      });

      const updated = await this.receiptRepo.updateStatus(id, 'SUBMITTED', dbClient);
      await this.audit.logUpdate(
        'purchase',
        'PurchaseReceipt',
        id,
        { status: receipt.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted purchase receipt for approval',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async approve(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReceipt> {
    const exec = async (dbClient: pg.PoolClient) => {
      const receipt = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_RECEIPT',
        currentState: receipt.status,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          creatorId: receipt.createdBy || undefined,
          companyId: receipt.companyId,
          branchId: receipt.branchId,
          documentId: receipt.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.receiptRepo.updateStatus(id, 'APPROVED', dbClient, {
        approvedBy: ctx.userId,
        approvedAt: now,
      });

      await this.audit.logUpdate(
        'purchase',
        'PurchaseReceipt',
        id,
        { status: receipt.status },
        { status: 'APPROVED', approvedBy: ctx.userId, approvedAt: now },
        ctx,
        'Approved purchase receipt',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async post(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReceipt> {
    const exec = async (dbClient: pg.PoolClient) => {
      const receipt = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_RECEIPT',
        currentState: receipt.status,
        targetState: 'POSTED',
        ctx,
        documentContext: {
          creatorId: receipt.createdBy || undefined,
          companyId: receipt.companyId,
          branchId: receipt.branchId,
          documentId: receipt.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.receiptRepo.updateStatus(id, 'POSTED', dbClient, {
        postedBy: ctx.userId,
        postedAt: now,
      });

      const stockStatus = receipt.qcRequired ? 'QC_PENDING' : 'AVAILABLE';
      for (const line of receipt.lines || []) {
        for (const alloc of line.batchAllocations || []) {
          await this.stockLedgerRepo.createEntry(
            {
              companyId: receipt.companyId,
              branchId: receipt.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: alloc.batchId,
              uomId: line.uomId,
              quantity: alloc.quantity,
              stockStatus,
              movementType: 'PURCHASE_RECEIPT',
              unitCost: alloc.unitCost,
              totalCost: alloc.quantity * alloc.unitCost,
              sourceDocumentType: 'PURCHASE_RECEIPT',
              sourceDocumentId: receipt.id,
              sourceDocumentLineId: line.id,
              createdBy: ctx.userId,
            },
            dbClient
          );
        }
      }

      await this.audit.logUpdate(
        'purchase',
        'PurchaseReceipt',
        id,
        { status: receipt.status },
        { status: 'POSTED', postedBy: ctx.userId, postedAt: now, stockStatus },
        ctx,
        'Posted purchase receipt to stock ledger',
        dbClient
      );

      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async reverse(id: string, reason: string | undefined, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReceipt> {
    const exec = async (dbClient: pg.PoolClient) => {
      const receipt = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_RECEIPT',
        currentState: receipt.status,
        targetState: 'REVERSED',
        ctx,
        documentContext: {
          creatorId: receipt.createdBy || undefined,
          companyId: receipt.companyId,
          branchId: receipt.branchId,
          documentId: receipt.id,
        },
      });

      const updated = await this.receiptRepo.updateStatus(id, 'REVERSED', dbClient);

      const stockStatus = receipt.qcRequired ? 'QC_PENDING' : 'AVAILABLE';
      for (const line of receipt.lines || []) {
        for (const alloc of line.batchAllocations || []) {
          await this.stockLedgerRepo.createEntry(
            {
              companyId: receipt.companyId,
              branchId: receipt.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: alloc.batchId,
              uomId: line.uomId,
              quantity: -alloc.quantity,
              stockStatus,
              movementType: 'REVERSAL',
              unitCost: alloc.unitCost,
              totalCost: -(alloc.quantity * alloc.unitCost),
              sourceDocumentType: 'PURCHASE_RECEIPT_REVERSAL',
              sourceDocumentId: receipt.id,
              sourceDocumentLineId: line.id,
              createdBy: ctx.userId,
            },
            dbClient
          );
        }
      }

      await this.audit.logUpdate(
        'purchase',
        'PurchaseReceipt',
        id,
        { status: receipt.status },
        { status: 'REVERSED', reason },
        ctx,
        reason || 'Reversed purchase receipt with offset ledger movements',
        dbClient
      );

      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }
}
