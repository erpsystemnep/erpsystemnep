import { withTransaction } from '../../../db/connection.js';
import {
  SalesOrderRepository,
  CreateSalesOrderDbHeaderInput,
  CreateSalesOrderLineDbInput,
} from '../repositories/sales_order.repository.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { CreateSalesOrderInput } from '../../../../shared/schemas/sales.js';
import { SalesOrder, SecurityContext, SalesOrderStatus } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class SalesOrderService {
  constructor(
    private soRepo: SalesOrderRepository = new SalesOrderRepository(),
    private stateMachine: StateMachineEngine = new StateMachineEngine(),
    private numbering: NumberingService = new NumberingService(),
    private audit: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Sales Order operations');
    }
    return ctx.activeCompanyId;
  }

  async create(
    input: CreateSalesOrderInput,
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<SalesOrder> {
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

      // 2. Process Lines
      let subtotal = 0;
      let taxTotal = 0;
      let grandTotal = 0;
      const calculatedLines: CreateSalesOrderLineDbInput[] = [];

      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        const lineNum = line.lineNumber || i + 1;

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

        const whRes = await dbClient.query(
          `SELECT id FROM warehouses WHERE id = $1 AND company_id = $2`,
          [line.warehouseId, companyId]
        );
        if (whRes.rows.length === 0) {
          throw AppError.notFound(`Warehouse '${line.warehouseId}' not found in company`);
        }

        const convFactor = line.conversionFactor || 1.0;
        const baseQty = line.baseQuantity || line.orderedQuantity * convFactor;
        const grossAmount = line.orderedQuantity * line.unitPrice;
        const discAmount = (grossAmount * (line.discountRate || 0)) / 100;
        const netAmount = grossAmount - discAmount;
        const lineTax = (netAmount * (line.taxRate || 0)) / 100;
        const lineTotal = netAmount + lineTax;

        subtotal += netAmount;
        taxTotal += lineTax;
        grandTotal += lineTotal;

        calculatedLines.push({
          lineNumber: lineNum,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          uomId: line.uomId,
          orderedQuantity: line.orderedQuantity,
          conversionFactor: convFactor,
          baseQuantity: baseQty,
          unitPrice: line.unitPrice,
          discountRate: line.discountRate || 0,
          discountAmount: discAmount,
          taxRate: line.taxRate || 0,
          taxAmount: lineTax,
          lineTotal,
        });
      }

      // 3. Generate SO Number
      const generatedNumber = await this.numbering.generateNextNumber(
        {
          companyId,
          branchId: input.branchId || null,
          documentType: 'SALES_ORDER',
        },
        ctx,
        dbClient
      );

      // 4. Save Sales Order
      const headerInput: CreateSalesOrderDbHeaderInput = {
        companyId,
        branchId: input.branchId || null,
        soNumber: generatedNumber.formattedNumber,
        customerId: input.customerId,
        orderDate: input.orderDate,
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

      const createdOrder = await this.soRepo.create(headerInput, calculatedLines, dbClient);

      // 5. Audit Log
      await this.audit.logCreate(
        'sales',
        'SalesOrder',
        createdOrder.id,
        createdOrder as any,
        ctx,
        dbClient
      );

      return createdOrder;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async findById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesOrder> {
    const companyId = ctx.isSuperadmin ? undefined : (ctx.activeCompanyId || undefined);
    const order = await this.soRepo.findById(id, companyId, client);
    if (!order) {
      throw AppError.notFound(`Sales Order '${id}' not found`);
    }
    return order;
  }

  async list(
    filters: {
      customerId?: string;
      status?: SalesOrderStatus;
      branchId?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<{ data: SalesOrder[]; total: number }> {
    const companyId = this.resolveCompanyId(ctx);
    return this.soRepo.list(companyId, filters, client);
  }

  async submit(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const order = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_ORDER',
        currentState: order.status,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          creatorId: order.createdBy || undefined,
          companyId: order.companyId,
          branchId: order.branchId,
          documentId: order.id,
        },
      });

      const updated = await this.soRepo.updateStatus(id, 'SUBMITTED', dbClient);
      await this.audit.logUpdate(
        'sales',
        'SalesOrder',
        id,
        { status: order.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted Sales Order for approval',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async approve(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const order = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_ORDER',
        currentState: order.status,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          creatorId: order.createdBy || undefined,
          companyId: order.companyId,
          branchId: order.branchId,
          documentId: order.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.soRepo.updateStatus(id, 'APPROVED', dbClient, {
        approvedBy: ctx.userId,
        approvedAt: now,
      });

      await this.audit.logUpdate(
        'sales',
        'SalesOrder',
        id,
        { status: order.status },
        { status: 'APPROVED', approvedBy: ctx.userId, approvedAt: now },
        ctx,
        'Approved Sales Order',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async reject(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const order = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_ORDER',
        currentState: order.status,
        targetState: 'REJECTED',
        ctx,
        documentContext: {
          creatorId: order.createdBy || undefined,
          companyId: order.companyId,
          branchId: order.branchId,
          documentId: order.id,
        },
      });

      const updated = await this.soRepo.updateStatus(id, 'REJECTED', dbClient);
      await this.audit.logUpdate(
        'sales',
        'SalesOrder',
        id,
        { status: order.status },
        { status: 'REJECTED' },
        ctx,
        'Rejected Sales Order',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async post(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const order = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_ORDER',
        currentState: order.status,
        targetState: 'POSTED',
        ctx,
        documentContext: {
          creatorId: order.createdBy || undefined,
          companyId: order.companyId,
          branchId: order.branchId,
          documentId: order.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.soRepo.updateStatus(id, 'POSTED', dbClient, {
        postedBy: ctx.userId,
        postedAt: now,
      });

      await this.audit.logUpdate(
        'sales',
        'SalesOrder',
        id,
        { status: order.status },
        { status: 'POSTED', postedBy: ctx.userId, postedAt: now },
        ctx,
        'Confirmed and posted Sales Order for fulfillment',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async cancel(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesOrder> {
    const exec = async (dbClient: pg.PoolClient) => {
      const order = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'SALES_ORDER',
        currentState: order.status,
        targetState: 'CANCELLED',
        ctx,
        documentContext: {
          creatorId: order.createdBy || undefined,
          companyId: order.companyId,
          branchId: order.branchId,
          documentId: order.id,
        },
      });

      // Release any active reservations for this sales order
      const activeResvSql = `
        SELECT sr.* FROM sales_reservations sr
        WHERE sr.sales_order_id = $1 AND sr.status = 'ACTIVE'
      `;
      const resvRes = await dbClient.query(activeResvSql, [id]);
      for (const resv of resvRes.rows) {
        const remainingToRelease = parseFloat(resv.reserved_quantity) - parseFloat(resv.fulfilled_quantity || '0') - parseFloat(resv.released_quantity || '0');
        if (remainingToRelease > 0) {
          // Compensating stock ledger movements to return reserved stock to available
          await dbClient.query(
            `INSERT INTO stock_ledger (
              company_id, branch_id, warehouse_id, item_id, batch_id, uom_id,
              quantity, stock_status, movement_type, unit_cost, total_cost,
              source_document_type, source_document_id, created_by
            ) VALUES
            ($1, $2, $3, $4, $5, $6, $7, 'RESERVED', 'SALES_RESERVATION_RELEASE', 0, 0, 'SALES_RESERVATION', $8, $9),
            ($1, $2, $3, $4, $5, $6, $10, 'AVAILABLE', 'SALES_RESERVATION_RELEASE', 0, 0, 'SALES_RESERVATION', $8, $9)`,
            [
              resv.company_id,
              resv.branch_id || null,
              resv.warehouse_id,
              resv.item_id,
              resv.batch_id || null,
              resv.uom_id,
              -remainingToRelease,
              resv.id,
              ctx.userId,
              remainingToRelease,
            ]
          );

          await dbClient.query(
            `UPDATE sales_reservations
             SET released_quantity = released_quantity + $1, status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [remainingToRelease, resv.id]
          );
        }
      }

      const updated = await this.soRepo.updateStatus(id, 'CANCELLED', dbClient);
      await this.audit.logUpdate(
        'sales',
        'SalesOrder',
        id,
        { status: order.status },
        { status: 'CANCELLED' },
        ctx,
        'Cancelled Sales Order and released reservations',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async delete(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<boolean> {
    const exec = async (dbClient: pg.PoolClient) => {
      const order = await this.findById(id, ctx, dbClient);
      if (order.status !== 'DRAFT') {
        throw AppError.badRequest(`Cannot delete Sales Order in '${order.status}' status (must be DRAFT)`);
      }
      const deleted = await this.soRepo.delete(id, order.companyId, dbClient);
      if (deleted) {
        await this.audit.logDelete('sales', 'SalesOrder', id, order as any, ctx, 'Deleted draft Sales Order', dbClient);
      }
      return deleted;
    };

    return client ? exec(client) : withTransaction(exec);
  }
}
