import { withTransaction } from '../../../db/connection.js';
import {
  QcInspectionRepository,
  CreateQcInspectionDbInput,
  CreateQcLineDbInput,
} from '../repositories/qc.repository.js';
import { StockLedgerRepository } from '../repositories/stock_ledger.repository.js';
import { StateMachineEngine } from '../../workflow/services/state_machine.service.js';
import { NumberingService } from '../../numbering/services/numbering.service.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { CreateQcInspectionInput } from '../../../../shared/schemas/inventory.js';
import { QcInspection, SecurityContext } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export class QcInspectionService {
  constructor(
    private qcRepo: QcInspectionRepository = new QcInspectionRepository(),
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
      throw AppError.forbidden('Active company context is required for QC Inspection operations');
    }
    return ctx.activeCompanyId;
  }

  async create(input: CreateQcInspectionInput, ctx: SecurityContext, client?: pg.PoolClient): Promise<QcInspection> {
    const companyId = this.resolveCompanyId(ctx, input.companyId);

    const exec = async (dbClient: pg.PoolClient) => {
      // 1. Verify receipt
      const receiptRes = await dbClient.query(
        `SELECT id, receipt_number, status, qc_required, branch_id FROM purchase_receipts WHERE id = $1 AND company_id = $2`,
        [input.receiptId, companyId]
      );
      if (receiptRes.rows.length === 0) {
        throw AppError.notFound(`Receipt '${input.receiptId}' not found in company`);
      }
      if (receiptRes.rows[0].status !== 'POSTED') {
        throw AppError.badRequest(
          `Receipt '${receiptRes.rows[0].receipt_number}' must be in POSTED status to perform QC inspection (currently '${receiptRes.rows[0].status}')`
        );
      }

      // 2. Validate lines
      const validatedLines: CreateQcLineDbInput[] = [];
      for (const line of input.lines) {
        if (line.passedQuantity + line.failedQuantity > line.receivedQuantity) {
          throw AppError.badRequest(
            `Passed (${line.passedQuantity}) + Failed (${line.failedQuantity}) cannot exceed received quantity (${line.receivedQuantity})`
          );
        }

        validatedLines.push({
          receiptLineId: line.receiptLineId,
          batchId: line.batchId,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          receivedQuantity: line.receivedQuantity,
          passedQuantity: line.passedQuantity,
          failedQuantity: line.failedQuantity,
          rejectionReason: line.rejectionReason || null,
          remarks: line.remarks || null,
        });
      }

      // 3. Generate inspection number
      let inspectionNumber = input.inspectionNumber;
      if (!inspectionNumber) {
        const numRes = await this.numbering.generateNextNumber(
          {
            companyId,
            branchId: input.branchId || receiptRes.rows[0].branch_id || null,
            documentType: 'QC_INSPECTION',
          },
          ctx,
          dbClient
        );
        inspectionNumber = numRes.formattedNumber;
      }

      const qcDb: CreateQcInspectionDbInput = {
        companyId,
        branchId: input.branchId || receiptRes.rows[0].branch_id || null,
        inspectionNumber: inspectionNumber!,
        receiptId: input.receiptId,
        inspectionDate: input.inspectionDate || new Date().toISOString(),
        status: 'DRAFT',
        inspectorId: ctx.userId,
        remarks: input.remarks || null,
        createdBy: ctx.userId,
      };

      const created = await this.qcRepo.create(qcDb, validatedLines, dbClient);

      await this.audit.logCreate(
        'inventory',
        'QcInspection',
        created.id,
        created as unknown as Record<string, unknown>,
        ctx,
        dbClient
      );

      return created;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async findById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<QcInspection> {
    const companyId = this.resolveCompanyId(ctx);
    const qc = await this.qcRepo.findById(id, client);
    if (!qc || (!ctx.isSuperadmin && qc.companyId !== companyId)) {
      throw AppError.notFound(`QC inspection '${id}' not found`);
    }
    return qc;
  }

  async list(
    filters: { receiptId?: string; status?: string },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<QcInspection[]> {
    const companyId = this.resolveCompanyId(ctx);
    return this.qcRepo.list(companyId, filters, client);
  }

  async submit(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<QcInspection> {
    const exec = async (dbClient: pg.PoolClient) => {
      const qc = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'QC_INSPECTION',
        currentState: qc.status,
        targetState: 'SUBMITTED',
        ctx,
        documentContext: {
          creatorId: qc.createdBy || undefined,
          companyId: qc.companyId,
          branchId: qc.branchId,
          documentId: qc.id,
        },
      });

      const updated = await this.qcRepo.updateStatus(id, 'SUBMITTED', dbClient);
      await this.audit.logUpdate(
        'inventory',
        'QcInspection',
        id,
        { status: qc.status },
        { status: 'SUBMITTED' },
        ctx,
        'Submitted QC inspection for approval',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async approve(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<QcInspection> {
    const exec = async (dbClient: pg.PoolClient) => {
      const qc = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'QC_INSPECTION',
        currentState: qc.status,
        targetState: 'APPROVED',
        ctx,
        documentContext: {
          creatorId: qc.createdBy || undefined,
          companyId: qc.companyId,
          branchId: qc.branchId,
          documentId: qc.id,
        },
      });

      const updated = await this.qcRepo.updateStatus(id, 'APPROVED', dbClient);
      await this.audit.logUpdate(
        'inventory',
        'QcInspection',
        id,
        { status: qc.status },
        { status: 'APPROVED' },
        ctx,
        'Approved QC inspection',
        dbClient
      );
      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }

  async post(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<QcInspection> {
    const exec = async (dbClient: pg.PoolClient) => {
      const qc = await this.findById(id, ctx, dbClient);
      this.stateMachine.validateTransition({
        documentType: 'QC_INSPECTION',
        currentState: qc.status,
        targetState: 'POSTED',
        ctx,
        documentContext: {
          creatorId: qc.createdBy || undefined,
          companyId: qc.companyId,
          branchId: qc.branchId,
          documentId: qc.id,
        },
      });

      const now = new Date().toISOString();
      const updated = await this.qcRepo.updateStatus(id, 'POSTED', dbClient, {
        postedBy: ctx.userId,
        postedAt: now,
      });

      for (const line of qc.lines || []) {
        const itemRes = await dbClient.query(`SELECT base_uom_id FROM items WHERE id = $1`, [line.itemId]);
        const uomId = itemRes.rows[0]?.base_uom_id;

        const batchRes = await dbClient.query(`SELECT unit_cost FROM inventory_batches WHERE id = $1`, [line.batchId]);
        const unitCost = parseFloat(batchRes.rows[0]?.unit_cost || '0');

        // 1. Process Passed items (Release to AVAILABLE)
        if (line.passedQuantity > 0) {
          // Negative QC_PENDING
          await this.stockLedgerRepo.createEntry(
            {
              companyId: qc.companyId,
              branchId: qc.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: line.batchId,
              uomId,
              quantity: -line.passedQuantity,
              stockStatus: 'QC_PENDING',
              movementType: 'QC_RELEASE',
              unitCost,
              totalCost: -(line.passedQuantity * unitCost),
              sourceDocumentType: 'QC_INSPECTION',
              sourceDocumentId: qc.id,
              sourceDocumentLineId: line.id,
              createdBy: ctx.userId,
            },
            dbClient
          );

          // Positive AVAILABLE
          await this.stockLedgerRepo.createEntry(
            {
              companyId: qc.companyId,
              branchId: qc.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: line.batchId,
              uomId,
              quantity: line.passedQuantity,
              stockStatus: 'AVAILABLE',
              movementType: 'QC_RELEASE',
              unitCost,
              totalCost: line.passedQuantity * unitCost,
              sourceDocumentType: 'QC_INSPECTION',
              sourceDocumentId: qc.id,
              sourceDocumentLineId: line.id,
              createdBy: ctx.userId,
            },
            dbClient
          );
        }

        // 2. Process Failed items (Restricted to QC_FAILED)
        if (line.failedQuantity > 0) {
          // Negative QC_PENDING
          await this.stockLedgerRepo.createEntry(
            {
              companyId: qc.companyId,
              branchId: qc.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: line.batchId,
              uomId,
              quantity: -line.failedQuantity,
              stockStatus: 'QC_PENDING',
              movementType: 'QC_RESTRICTION',
              unitCost,
              totalCost: -(line.failedQuantity * unitCost),
              sourceDocumentType: 'QC_INSPECTION',
              sourceDocumentId: qc.id,
              sourceDocumentLineId: line.id,
              createdBy: ctx.userId,
            },
            dbClient
          );

          // Positive QC_FAILED
          await this.stockLedgerRepo.createEntry(
            {
              companyId: qc.companyId,
              branchId: qc.branchId,
              warehouseId: line.warehouseId,
              itemId: line.itemId,
              batchId: line.batchId,
              uomId,
              quantity: line.failedQuantity,
              stockStatus: 'QC_FAILED',
              movementType: 'QC_RESTRICTION',
              unitCost,
              totalCost: line.failedQuantity * unitCost,
              sourceDocumentType: 'QC_INSPECTION',
              sourceDocumentId: qc.id,
              sourceDocumentLineId: line.id,
              createdBy: ctx.userId,
            },
            dbClient
          );
        }
      }

      await this.audit.logUpdate(
        'inventory',
        'QcInspection',
        id,
        { status: qc.status },
        { status: 'POSTED', postedBy: ctx.userId, postedAt: now },
        ctx,
        'Posted QC inspection to stock ledger',
        dbClient
      );

      return updated!;
    };

    return client ? exec(client) : withTransaction(exec);
  }
}
