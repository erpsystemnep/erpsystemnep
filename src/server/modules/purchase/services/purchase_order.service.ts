import { withTransaction } from '../../../db/connection.js';
import {
  PurchaseOrderRepository,
  CreatePurchaseOrderDbInput,
  CreatePurchaseOrderLineDbInput,
} from '../repositories/purchase_order.repository.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import {
  CreatePurchaseOrderInput,
} from '../../../../shared/schemas/purchase.js';
import { PurchaseOrder, SecurityContext } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class PurchaseOrderService {
  constructor(
    private poRepo: PurchaseOrderRepository = new PurchaseOrderRepository(),
    private stateMachine: StateMachineEngine = new StateMachineEngine(),
    private numbering: NumberingService = new NumberingService(),
    private audit: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Purchase Order operations');
    }
    return ctx.activeCompanyId;
  }

  async create(input: CreatePurchaseOrderInput, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseOrder> {
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
      if (!suppRes.rows[0].is_active) {
        throw AppError.badRequest(`Supplier '${suppRes.rows[0].legal_name}' is inactive`);
      }

      // 2. Process lines
      let subtotal = 0;
      let taxTotal = 0;
      const calculatedLines: CreatePurchaseOrderLineDbInput[] = [];

      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        const lineNum = line.lineNumber || i + 1;

        const itemRes = await dbClient.query(
          `SELECT id, sku, item_name, is_purchasable, is_active FROM items WHERE id = $1 AND company_id = $2`,
          [line.itemId, companyId]
        );
        if (itemRes.rows.length === 0) {
          throw AppError.notFound(`Item '${line.itemId}' not found in company`);
        }
        if (!itemRes.rows[0].is_purchasable) {
          throw AppError.badRequest(`Item '${itemRes.rows[0].item_name}' is not marked as purchasable`);
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

        const convFactor = line.conversionFactor || 1.0;
        const baseQty = line.baseQuantity || line.orderedQuantity * convFactor;
        const lineAmount = line.orderedQuantity * line.unitPrice;
        const lineTax = (lineAmount * (line.taxRate || 0)) / 100;
        const lineTotal = lineAmount + lineTax;

        subtotal += lineAmount;
        taxTotal += lineTax;

        calculatedLines.push({
          lineNumber: lineNum,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          uomId: line.uomId,
          orderedQuantity: line.orderedQuantity,
          conversionFactor: convFactor,
          baseQuantity: baseQty,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate || 0,
          taxAmount: lineTax,
          lineTotal: lineTotal,
        });
      }

      const grandTotal = subtotal + taxTotal;

      let poNumber = input.poNumber;
      if (!poNumber) {
        const numRes = await this.numbering.generateNextNumber(
          {
            companyId,
            branchId: input.branchId || null,
            documentType: 'PURCHASE_ORDER',
          },
          ctx,
          dbClient
        );
        poNumber = numRes.formattedNumber;
      }

      const poInput: CreatePurchaseOrderDbInput = {
        companyId,
        branchId: input.branchId || null,
        poNumber: poNumber!,
        supplierId: input.supplierId,
        orderDate: input.orderDate || new Date().toISOString().split('T')[0],
        expectedDeliveryDate: input.expectedDeliveryDate || null,
        status: 'DRAFT',
        currencyCode: input.currencyCode || 'USD',
        exchangeRate: input.exchangeRate || 1.0,
        subtotal,
        taxTotal,
        grandTotal,
        notes: input.notes || null,
        createdBy: ctx.userId,
      };

      const createdPo = await this.poRepo.create(poInput, calculatedLines, dbClient);

      await this.audit.logCreate(
        'purchase',
        'PurchaseOrder',
        createdPo.id,
        createdPo as unknown as Record<string, unknown>,
        ctx,
        dbClient
      );

      return createdPo;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async findById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseOrder> {
    const companyId = this.resolveCompanyId(ctx);
    const po = await this.poRepo.findById(id, client);
    if (!po || (!ctx.isSuperadmin && po.companyId !== companyId)) {
      throw AppError.notFound(`Purchase order '${id}' not found`);
    }
    return po;
  }

  async list(
    filters: { branchId?: string | null; supplierId?: string; status?: string },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<PurchaseOrder[]> {
    const companyId = this.resolveCompanyId(ctx);
    return this.poRepo.list(companyId, filters, client);
  }

  async submit(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const po = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_ORDER',
        currentState: po.status as any,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          creatorId: po.createdBy || undefined,
          companyId: po.companyId,
          branchId: po.branchId,
          documentId: po.id,
        },
      });

      const updated = await this.poRepo.updateStatus(id, 'SUBMITTED', dbClient);
      await this.audit.logUpdate(
        'purchase',
        'PurchaseOrder',
        id,
        { status: po.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted purchase order for approval',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async approve(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const po = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_ORDER',
        currentState: po.status as any,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          creatorId: po.createdBy || undefined,
          companyId: po.companyId,
          branchId: po.branchId,
          documentId: po.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.poRepo.updateStatus(id, 'APPROVED', dbClient, {
        approvedBy: ctx.userId,
        approvedAt: now,
      });

      await this.audit.logUpdate(
        'purchase',
        'PurchaseOrder',
        id,
        { status: po.status },
        { status: 'APPROVED', approvedBy: ctx.userId, approvedAt: now },
        ctx,
        'Approved purchase order',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async reject(id: string, reason: string | undefined, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const po = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_ORDER',
        currentState: po.status as any,
        targetState: 'REJECTED',
        ctx,
        documentContext: {
          creatorId: po.createdBy || undefined,
          companyId: po.companyId,
          branchId: po.branchId,
          documentId: po.id,
        },
      });

      const updated = await this.poRepo.updateStatus(id, 'REJECTED', dbClient);
      await this.audit.logUpdate(
        'purchase',
        'PurchaseOrder',
        id,
        { status: po.status },
        { status: 'REJECTED', reason },
        ctx,
        reason || 'Rejected purchase order',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async cancel(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<PurchaseOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const po = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'PURCHASE_ORDER',
        currentState: po.status as any,
        targetState: 'CANCELLED',
        ctx,
        documentContext: {
          creatorId: po.createdBy || undefined,
          companyId: po.companyId,
          branchId: po.branchId,
          documentId: po.id,
        },
      });

      const updated = await this.poRepo.updateStatus(id, 'CANCELLED', dbClient);
      await this.audit.logUpdate(
        'purchase',
        'PurchaseOrder',
        id,
        { status: po.status },
        { status: 'CANCELLED' },
        ctx,
        'Cancelled purchase order',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }
}
