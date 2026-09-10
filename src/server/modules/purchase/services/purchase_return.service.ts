import { withTransaction } from '../../../db/connection.js';
import {
  PurchaseReturnRepository,
  CreateReturnDbInput,
  CreateReturnLineDbInput,
} from '../repositories/purchase_return.repository.js';
import { StockLedgerRepository } from '../../inventory/repositories/stock_ledger.repository.js';
import { InventoryValuationService } from '../../inventory/services/inventory_valuation.service.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { CreatePurchaseReturnInput } from '../../../../shared/schemas/purchase.js';
import { PurchaseReturn, SecurityContext } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class PurchaseReturnService {
  constructor(
    private returnRepo: PurchaseReturnRepository = new PurchaseReturnRepository(),
    private stockLedgerRepo: StockLedgerRepository = new StockLedgerRepository(),
    private valuationService: InventoryValuationService = new InventoryValuationService(),
    private stateMachine: StateMachineEngine = new StateMachineEngine(),
    private numbering: NumberingService = new NumberingService(),
    private audit: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Purchase Return operations');
    }
    return ctx.activeCompanyId;
  }

  async create(input: CreatePurchaseReturnInput, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReturn> {
    const companyId = this.resolveCompanyId(ctx, input.companyId);

    const exec = async (dbClient: pg.PoolClient) => {
      // 1. Verify supplier
      const suppRes = await dbClient.query(
        `SELECT id, legal_name, is_supplier FROM business_partners WHERE id = $1 AND company_id = $2`,
        [input.supplierId, companyId]
      );
      if (suppRes.rows.length === 0) {
        throw AppError.notFound(`Supplier with id '${input.supplierId}' not found in company`);
      }

      // 2. Validate receipt / QC references
      let totalAmount = 0;
      const validatedLines: CreateReturnLineDbInput[] = [];

      for (const line of input.lines) {
        const lineTotal = line.returnQuantity * line.unitRate;
        totalAmount += lineTotal;

        validatedLines.push({
          qcLineId: line.qcLineId || null,
          receiptLineId: line.receiptLineId,
          batchId: line.batchId,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          returnQuantity: line.returnQuantity,
          unitRate: line.unitRate,
          totalAmount: lineTotal,
        });
      }

      let returnNumber = input.returnNumber;
      if (!returnNumber) {
        const numRes = await this.numbering.generateNextNumber(
          {
            companyId,
            branchId: input.branchId || null,
            documentType: 'PURCHASE_RETURN',
          },
          ctx,
          dbClient
        );
        returnNumber = numRes.formattedNumber;
      }

      const returnDb: CreateReturnDbInput = {
        companyId,
        branchId: input.branchId || null,
        returnNumber: returnNumber!,
        receiptId: input.receiptId || null,
        qcInspectionId: input.qcInspectionId || null,
        supplierId: input.supplierId,
        returnDate: input.returnDate || new Date().toISOString(),
        status: 'DRAFT',
        reason: input.reason || null,
        totalAmount,
        createdBy: ctx.userId,
      };

      const created = await this.returnRepo.create(returnDb, validatedLines, dbClient);

      await this.audit.logCreate(
        'purchase',
        'PurchaseReturn',
        created.id,
        created as unknown as Record<string, unknown>,
        ctx,
        dbClient
      );

      return created;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async findById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReturn> {
    const companyId = this.resolveCompanyId(ctx);
    const ret = await this.returnRepo.findById(id, client);
    if (!ret || (!ctx.isSuperadmin && ret.companyId !== companyId)) {
      throw AppError.notFound(`Purchase return '${id}' not found`);
    }
    return ret;
  }

  async list(
    filters: { branchId?: string | null; supplierId?: string; status?: string; receiptId?: string },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<PurchaseReturn[]> {
    const companyId = this.resolveCompanyId(ctx);
    return this.returnRepo.list(companyId, filters, client);
  }

  async submit(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReturn> {
    const exec = async (dbClient: pg.PoolClient) => {
      const ret = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_RETURN',
        currentState: ret.status,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          creatorId: ret.createdBy || undefined,
          companyId: ret.companyId,
          branchId: ret.branchId,
          documentId: ret.id,
        },
      });

      const updated = await this.returnRepo.updateStatus(id, 'SUBMITTED', dbClient);
      await this.audit.logUpdate(
        'purchase',
        'PurchaseReturn',
        id,
        { status: ret.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted purchase return for approval',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async approve(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReturn> {
    const exec = async (dbClient: pg.PoolClient) => {
      const ret = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_RETURN',
        currentState: ret.status,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          creatorId: ret.createdBy || undefined,
          companyId: ret.companyId,
          branchId: ret.branchId,
          documentId: ret.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.returnRepo.updateStatus(id, 'APPROVED', dbClient, {
        approvedBy: ctx.userId,
        approvedAt: now,
      });

      await this.audit.logUpdate(
        'purchase',
        'PurchaseReturn',
        id,
        { status: ret.status },
        { status: 'APPROVED', approvedBy: ctx.userId, approvedAt: now },
        ctx,
        'Approved purchase return',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async post(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReturn> {
    const exec = async (dbClient: pg.PoolClient) => {
      const ret = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_RETURN',
        currentState: ret.status,
        targetState: 'POSTED',
        ctx,
        documentContext: {
          creatorId: ret.createdBy || undefined,
          companyId: ret.companyId,
          branchId: ret.branchId,
          documentId: ret.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.returnRepo.updateStatus(id, 'POSTED', dbClient, {
        postedBy: ctx.userId,
        postedAt: now,
      });

      for (const line of ret.lines || []) {
        const itemRes = await dbClient.query(`SELECT base_uom_id FROM items WHERE id = $1`, [line.itemId]);
        const uomId = itemRes.rows[0]?.base_uom_id;

        // Deduct from QC_FAILED or AVAILABLE
        const stockStatus = ret.qcInspectionId ? 'QC_FAILED' : 'AVAILABLE';

        await this.stockLedgerRepo.createEntry(
          {
            companyId: ret.companyId,
            branchId: ret.branchId,
            warehouseId: line.warehouseId,
            itemId: line.itemId,
            batchId: line.batchId,
            uomId,
            quantity: -line.returnQuantity,
            stockStatus,
            movementType: 'PURCHASE_RETURN',
            unitCost: line.unitRate,
            totalCost: -(line.returnQuantity * line.unitRate),
            sourceDocumentType: 'PURCHASE_RETURN',
            sourceDocumentId: ret.id,
            sourceDocumentLineId: line.id,
            createdBy: ctx.userId,
          },
          dbClient
        );

        if (stockStatus === 'AVAILABLE') {
          await this.valuationService.recordReturnCostLayer(
            {
              companyId: ret.companyId,
              branchId: ret.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: line.batchId,
              quantity: line.returnQuantity,
              unitCost: line.unitRate,
              sourceDocumentType: 'PURCHASE_RETURN',
              sourceDocumentId: ret.id,
              sourceDocumentLineId: line.id,
              accountingDate: ret.returnDate ? new Date(ret.returnDate).toISOString().split('T')[0] : undefined,
            },
            dbClient
          );
        }
      }

      await this.audit.logUpdate(
        'purchase',
        'PurchaseReturn',
        id,
        { status: ret.status },
        { status: 'POSTED', postedBy: ctx.userId, postedAt: now },
        ctx,
        'Posted purchase return to stock ledger',
        dbClient
      );

      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async reverse(id: string, reason: string | undefined, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseReturn> {
    const exec = async (dbClient: pg.PoolClient) => {
      const ret = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_RETURN',
        currentState: ret.status,
        targetState: 'REVERSED',
        ctx,
        documentContext: {
          creatorId: ret.createdBy || undefined,
          companyId: ret.companyId,
          branchId: ret.branchId,
          documentId: ret.id,
        },
      });

      const updated = await this.returnRepo.updateStatus(id, 'REVERSED', dbClient);

      for (const line of ret.lines || []) {
        const itemRes = await dbClient.query(`SELECT base_uom_id FROM items WHERE id = $1`, [line.itemId]);
        const uomId = itemRes.rows[0]?.base_uom_id;

        const stockStatus = ret.qcInspectionId ? 'QC_FAILED' : 'AVAILABLE';

        await this.stockLedgerRepo.createEntry(
          {
            companyId: ret.companyId,
            branchId: ret.branchId,
            warehouseId: line.warehouseId,
            itemId: line.itemId,
            batchId: line.batchId,
            uomId,
            quantity: line.returnQuantity,
            stockStatus,
            movementType: 'REVERSAL',
            unitCost: line.unitRate,
            totalCost: line.returnQuantity * line.unitRate,
            sourceDocumentType: 'PURCHASE_RETURN_REVERSAL',
            sourceDocumentId: ret.id,
            sourceDocumentLineId: line.id,
            createdBy: ctx.userId,
          },
          dbClient
        );
      }

      await this.audit.logUpdate(
        'purchase',
        'PurchaseReturn',
        id,
        { status: ret.status },
        { status: 'REVERSED', reason },
        ctx,
        reason || 'Reversed purchase return with offset ledger movements',
        dbClient
      );

      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }
}
