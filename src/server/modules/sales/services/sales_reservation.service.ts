import { withTransaction } from '../../../db/connection.js';
import {
  SalesReservationRepository,
  CreateSalesReservationDbInput,
} from '../repositories/sales_reservation.repository.js';
import { StockLedgerRepository } from '../../inventory/repositories/stock_ledger.repository.js';
import { AuditService } from '../../audit/services/audit.service.js';
import {
  CreateSalesReservationInput,
  ReleaseSalesReservationInput,
} from '../../../../shared/schemas/sales.js';
import { SalesReservation, SecurityContext } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class SalesReservationService {
  constructor(
    private resvRepo: SalesReservationRepository = new SalesReservationRepository(),
    private stockLedgerRepo: StockLedgerRepository = new StockLedgerRepository(),
    private audit: AuditService = new AuditService()
  ) {}

  private resolveCompanyId(ctx: SecurityContext, explicitCompanyId?: string): string {
    if (ctx.isSuperadmin && explicitCompanyId) {
      return explicitCompanyId;
    }
    if (!ctx.activeCompanyId) {
      throw AppError.forbidden('Active company context is required for Stock Reservation operations');
    }
    return ctx.activeCompanyId;
  }

  async create(
    input: CreateSalesReservationInput,
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<SalesReservation> {
    const exec = async (dbClient: pg.PoolClient) => {
      // 1. Fetch Sales Order and verify status
      const soRes = await dbClient.query(
        `SELECT id, company_id, branch_id, so_number, status FROM sales_orders WHERE id = $1`,
        [input.salesOrderId]
      );
      if (soRes.rows.length === 0) {
        throw AppError.notFound(`Sales Order '${input.salesOrderId}' not found`);
      }
      const so = soRes.rows[0];
      const companyId = this.resolveCompanyId(ctx, so.company_id);
      if (so.company_id !== companyId) {
        throw AppError.forbidden('Cannot reserve stock for a sales order of a different company');
      }
      if (so.status !== 'APPROVED' && so.status !== 'POSTED') {
        throw AppError.badRequest(
          `Stock reservations can only be created for APPROVED or POSTED sales orders (currently '${so.status}')`
        );
      }

      // 2. Fetch Sales Order Line
      const lineRes = await dbClient.query(
        `SELECT id, item_id, warehouse_id, uom_id, ordered_quantity FROM sales_order_lines WHERE id = $1 AND sales_order_id = $2`,
        [input.salesOrderLineId, input.salesOrderId]
      );
      if (lineRes.rows.length === 0) {
        throw AppError.notFound(`Sales Order Line '${input.salesOrderLineId}' not found on Sales Order '${so.so_number}'`);
      }
      const soLine = lineRes.rows[0];
      const warehouseId = input.warehouseId || soLine.warehouse_id;
      const itemId = soLine.item_id;
      const uomId = soLine.uom_id;
      const orderedQty = parseFloat(soLine.ordered_quantity);

      // 3. Check existing active reservations and deliveries against ordered quantity
      const existingResvSql = `
        SELECT COALESCE(SUM(reserved_quantity - fulfilled_quantity - released_quantity), 0) as active_resv
        FROM sales_reservations
        WHERE sales_order_line_id = $1 AND status = 'ACTIVE'
      `;
      const activeResvRes = await dbClient.query(existingResvSql, [input.salesOrderLineId]);
      const currentActiveResv = parseFloat(activeResvRes.rows[0].active_resv || '0');

      const delivRes = await dbClient.query(
        `SELECT COALESCE(SUM(sdl.delivered_quantity), 0) as total_delivered
         FROM sales_delivery_lines sdl
         JOIN sales_deliveries sd ON sdl.delivery_id = sd.id
         WHERE sdl.sales_order_line_id = $1 AND sd.status = 'POSTED'`,
        [input.salesOrderLineId]
      );
      const totalDelivered = parseFloat(delivRes.rows[0].total_delivered || '0');

      if (currentActiveResv + totalDelivered + input.reservedQuantity > orderedQty) {
        throw AppError.badRequest(
          `Cannot reserve ${input.reservedQuantity} units. Active reservations (${currentActiveResv}) + Delivered (${totalDelivered}) + New (${input.reservedQuantity}) exceeds line ordered quantity (${orderedQty})`
        );
      }

      // 4. Verify Available Stock in Stock Ledger
      let availableBalance = 0;
      if (input.batchId) {
        availableBalance = await this.stockLedgerRepo.getBatchStockBalance(
          companyId,
          warehouseId,
          itemId,
          input.batchId,
          'AVAILABLE',
          dbClient
        );
      } else {
        availableBalance = await this.stockLedgerRepo.getItemStockBalance(
          companyId,
          warehouseId,
          itemId,
          'AVAILABLE',
          dbClient
        );
      }

      if (availableBalance < input.reservedQuantity) {
        throw AppError.badRequest(
          `Insufficient available stock. Requested: ${input.reservedQuantity}, Available: ${availableBalance}`
        );
      }

      // 5. Create Sales Reservation record
      const dbInput: CreateSalesReservationDbInput = {
        companyId,
        branchId: so.branch_id || null,
        salesOrderId: input.salesOrderId,
        salesOrderLineId: input.salesOrderLineId,
        itemId,
        warehouseId,
        batchId: input.batchId || null,
        uomId,
        reservedQuantity: input.reservedQuantity,
        status: 'ACTIVE',
        createdBy: ctx.userId,
      };
      const createdResv = await this.resvRepo.create(dbInput, dbClient);

      // 6. Post Conservation-Preserving Stock Ledger Movements
      // Deduct from AVAILABLE, add to RESERVED
      await this.stockLedgerRepo.createEntry(
        {
          companyId,
          branchId: so.branch_id || null,
          warehouseId,
          itemId,
          batchId: input.batchId || null,
          uomId,
          quantity: -input.reservedQuantity,
          stockStatus: 'AVAILABLE',
          movementType: 'SALES_RESERVATION',
          unitCost: 0,
          totalCost: 0,
          sourceDocumentType: 'SALES_RESERVATION',
          sourceDocumentId: createdResv.id,
          sourceDocumentLineId: input.salesOrderLineId,
          createdBy: ctx.userId,
        },
        dbClient
      );

      await this.stockLedgerRepo.createEntry(
        {
          companyId,
          branchId: so.branch_id || null,
          warehouseId,
          itemId,
          batchId: input.batchId || null,
          uomId,
          quantity: input.reservedQuantity,
          stockStatus: 'RESERVED',
          movementType: 'SALES_RESERVATION',
          unitCost: 0,
          totalCost: 0,
          sourceDocumentType: 'SALES_RESERVATION',
          sourceDocumentId: createdResv.id,
          sourceDocumentLineId: input.salesOrderLineId,
          createdBy: ctx.userId,
        },
        dbClient
      );

      // 7. Audit Log
      await this.audit.logCreate(
        'sales',
        'SalesReservation',
        createdResv.id,
        createdResv as any,
        ctx,
        dbClient
      );

      return (await this.resvRepo.findById(createdResv.id, companyId, dbClient))!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async release(
    id: string,
    input: ReleaseSalesReservationInput,
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<SalesReservation> {
    const exec = async (dbClient: pg.PoolClient) => {
      const resv = await this.resvRepo.findById(id, undefined, dbClient);
      if (!resv) {
        throw AppError.notFound(`Sales Reservation '${id}' not found`);
      }
      const companyId = this.resolveCompanyId(ctx, resv.companyId);
      if (resv.companyId !== companyId) {
        throw AppError.forbidden('Cannot release reservation from another company');
      }
      if (resv.status !== 'ACTIVE') {
        throw AppError.badRequest(`Cannot release reservation in '${resv.status}' status (must be ACTIVE)`);
      }

      const remainingActive = resv.reservedQuantity - resv.fulfilledQuantity - resv.releasedQuantity;
      if (remainingActive <= 0) {
        throw AppError.badRequest('No remaining quantity left to release on this reservation');
      }

      const releaseQty = input.quantity ? Math.min(input.quantity, remainingActive) : remainingActive;
      if (releaseQty <= 0) {
        throw AppError.badRequest('Release quantity must be greater than 0');
      }

      // Stock Ledger Movements: Deduct from RESERVED, Return to AVAILABLE
      await this.stockLedgerRepo.createEntry(
        {
          companyId: resv.companyId,
          branchId: resv.branchId || null,
          warehouseId: resv.warehouseId,
          itemId: resv.itemId,
          batchId: resv.batchId || null,
          uomId: resv.uomId,
          quantity: -releaseQty,
          stockStatus: 'RESERVED',
          movementType: 'SALES_RESERVATION_RELEASE',
          unitCost: 0,
          totalCost: 0,
          sourceDocumentType: 'SALES_RESERVATION',
          sourceDocumentId: resv.id,
          sourceDocumentLineId: resv.salesOrderLineId,
          createdBy: ctx.userId,
        },
        dbClient
      );

      await this.stockLedgerRepo.createEntry(
        {
          companyId: resv.companyId,
          branchId: resv.branchId || null,
          warehouseId: resv.warehouseId,
          itemId: resv.itemId,
          batchId: resv.batchId || null,
          uomId: resv.uomId,
          quantity: releaseQty,
          stockStatus: 'AVAILABLE',
          movementType: 'SALES_RESERVATION_RELEASE',
          unitCost: 0,
          totalCost: 0,
          sourceDocumentType: 'SALES_RESERVATION',
          sourceDocumentId: resv.id,
          sourceDocumentLineId: resv.salesOrderLineId,
          createdBy: ctx.userId,
        },
        dbClient
      );

      const updated = await this.resvRepo.updateReleasedQuantity(id, releaseQty, dbClient);

      await this.audit.logUpdate(
        'sales',
        'SalesReservation',
        id,
        { releasedQuantity: resv.releasedQuantity, status: resv.status },
        { releasedQuantity: updated!.releasedQuantity, status: updated!.status },
        ctx,
        `Released ${releaseQty} units from reservation back to available stock`,
        dbClient
      );

      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async list(
    filters: {
      salesOrderId?: string;
      itemId?: string;
      warehouseId?: string;
      status?: any;
      page?: number;
      limit?: number;
    },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<{ data: SalesReservation[]; total: number }> {
    const companyId = this.resolveCompanyId(ctx);
    return this.resvRepo.list(companyId, filters, client);
  }

  async findById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<SalesReservation> {
    const companyId = ctx.isSuperadmin ? undefined : (ctx.activeCompanyId || undefined);
    const resv = await this.resvRepo.findById(id, companyId, client);
    if (!resv) {
      throw AppError.notFound(`Sales Reservation '${id}' not found`);
    }
    return resv;
  }
}
