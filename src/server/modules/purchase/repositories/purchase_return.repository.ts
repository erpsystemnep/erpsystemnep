import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  PurchaseReturn,
  PurchaseReturnLine,
  PurchaseReturnStatus,
} from '../../../../shared/types/index.js';

export interface CreateReturnDbInput {
  companyId: string;
  branchId?: string | null;
  returnNumber: string;
  supplierId: string;
  receiptId?: string | null;
  qcInspectionId?: string | null;
  returnDate: string;
  status: PurchaseReturnStatus;
  reason?: string | null;
  totalAmount: number;
  createdBy?: string | null;
}

export interface CreateReturnLineDbInput {
  qcLineId?: string | null;
  receiptLineId: string;
  batchId: string;
  itemId: string;
  warehouseId: string;
  returnQuantity: number;
  unitRate: number;
  totalAmount: number;
}

export class PurchaseReturnRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async create(
    returnDoc: CreateReturnDbInput,
    lines: CreateReturnLineDbInput[],
    client?: pg.PoolClient
  ): Promise<PurchaseReturn> {
    const executor = this.getExecutor(client);

    const retSql = `
      INSERT INTO purchase_returns (
        company_id, branch_id, return_number, supplier_id, receipt_id, qc_inspection_id,
        return_date, status, reason, total_amount, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const retValues = [
      returnDoc.companyId,
      returnDoc.branchId || null,
      returnDoc.returnNumber,
      returnDoc.supplierId,
      returnDoc.receiptId || null,
      returnDoc.qcInspectionId || null,
      returnDoc.returnDate,
      returnDoc.status,
      returnDoc.reason || null,
      returnDoc.totalAmount,
      returnDoc.createdBy || null,
    ];

    const retRes = await executor.query(retSql, retValues);
    const retRow = retRes.rows[0];

    const insertedLines: PurchaseReturnLine[] = [];
    for (const line of lines) {
      const lineSql = `
        INSERT INTO purchase_return_lines (
          return_id, qc_line_id, receipt_line_id, batch_id, item_id, warehouse_id,
          return_quantity, unit_rate, total_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      const lineValues = [
        retRow.id,
        line.qcLineId || null,
        line.receiptLineId,
        line.batchId,
        line.itemId,
        line.warehouseId,
        line.returnQuantity,
        line.unitRate,
        line.totalAmount,
      ];
      const lineRes = await executor.query(lineSql, lineValues);
      insertedLines.push(this.mapLineRow(lineRes.rows[0]));
    }

    return {
      ...this.mapRow(retRow),
      lines: insertedLines,
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<PurchaseReturn | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT pr.*, 
             bp.partner_code as supplier_code, bp.legal_name as supplier_name,
             rc.receipt_number, qc.inspection_number
      FROM purchase_returns pr
      LEFT JOIN business_partners bp ON pr.supplier_id = bp.id
      LEFT JOIN purchase_receipts rc ON pr.receipt_id = rc.id
      LEFT JOIN qc_inspections qc ON pr.qc_inspection_id = qc.id
      WHERE pr.id = $1
    `;
    const res = await executor.query(sql, [id]);
    if (res.rows.length === 0) return null;

    const returnDoc = this.mapRow(res.rows[0]);
    returnDoc.lines = await this.findLinesByReturnId(id, client);
    return returnDoc;
  }

  async findByReturnNumber(companyId: string, returnNumber: string, client?: pg.PoolClient): Promise<PurchaseReturn | null> {
    const executor = this.getExecutor(client);
    const sql = `SELECT id FROM purchase_returns WHERE company_id = $1 AND return_number = $2`;
    const res = await executor.query(sql, [companyId, returnNumber]);
    if (res.rows.length === 0) return null;
    return this.findById(res.rows[0].id, client);
  }

  async findLinesByReturnId(returnId: string, client?: pg.PoolClient): Promise<PurchaseReturnLine[]> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT prl.*,
             i.sku as item_sku, i.item_name as item_name,
             b.batch_number as batch_number,
             w.code as warehouse_code, w.name as warehouse_name
      FROM purchase_return_lines prl
      LEFT JOIN items i ON prl.item_id = i.id
      LEFT JOIN inventory_batches b ON prl.batch_id = b.id
      LEFT JOIN warehouses w ON prl.warehouse_id = w.id
      WHERE prl.return_id = $1
    `;
    const res = await executor.query(sql, [returnId]);
    return res.rows.map(this.mapLineRow);
  }

  async list(
    companyId: string,
    filters?: { supplierId?: string; status?: string; receiptId?: string },
    client?: pg.PoolClient
  ): Promise<PurchaseReturn[]> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT pr.*, 
             bp.partner_code as supplier_code, bp.legal_name as supplier_name,
             rc.receipt_number, qc.inspection_number
      FROM purchase_returns pr
      LEFT JOIN business_partners bp ON pr.supplier_id = bp.id
      LEFT JOIN purchase_receipts rc ON pr.receipt_id = rc.id
      LEFT JOIN qc_inspections qc ON pr.qc_inspection_id = qc.id
      WHERE pr.company_id = $1
    `;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.supplierId) {
      sql += ` AND pr.supplier_id = $${idx++}`;
      values.push(filters.supplierId);
    }
    if (filters?.status) {
      sql += ` AND pr.status = $${idx++}`;
      values.push(filters.status);
    }
    if (filters?.receiptId) {
      sql += ` AND pr.receipt_id = $${idx++}`;
      values.push(filters.receiptId);
    }

    sql += ` ORDER BY pr.created_at DESC`;
    const res = await executor.query(sql, values);
    return res.rows.map(this.mapRow);
  }

  async updateStatus(
    id: string,
    status: PurchaseReturnStatus,
    client?: pg.PoolClient,
    meta?: {
      approvedBy?: string | null;
      approvedAt?: string | null;
      postedBy?: string | null;
      postedAt?: string | null;
    }
  ): Promise<PurchaseReturn | null> {
    const executor = this.getExecutor(client);
    let sql = `
      UPDATE purchase_returns
      SET status = $1, updated_at = CURRENT_TIMESTAMP
    `;
    const values: any[] = [status, id];
    let idx = 3;

    if (meta?.approvedBy !== undefined) {
      sql += `, approved_by = $${idx++}`;
      values.splice(values.length - 1, 0, meta.approvedBy);
    }
    if (meta?.approvedAt !== undefined) {
      sql += `, approved_at = $${idx++}`;
      values.splice(values.length - 1, 0, meta.approvedAt);
    }
    if (meta?.postedBy !== undefined) {
      sql += `, posted_by = $${idx++}`;
      values.splice(values.length - 1, 0, meta.postedBy);
    }
    if (meta?.postedAt !== undefined) {
      sql += `, posted_at = $${idx++}`;
      values.splice(values.length - 1, 0, meta.postedAt);
    }

    sql += ` WHERE id = $2 RETURNING *`;
    const res = await executor.query(sql, values);
    if (res.rows.length === 0) return null;
    return this.findById(id, client);
  }

  async getTotalReturnedQuantityForQcLine(qcLineId: string, client?: pg.PoolClient): Promise<number> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT COALESCE(SUM(prl.return_quantity), 0) as total_returned
      FROM purchase_return_lines prl
      JOIN purchase_returns pr ON prl.return_id = pr.id
      WHERE prl.qc_line_id = $1 AND pr.status IN ('APPROVED', 'POSTED')
    `;
    const res = await executor.query(sql, [qcLineId]);
    return parseFloat(res.rows[0].total_returned || '0');
  }

  private mapRow(row: any): PurchaseReturn {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      returnNumber: row.return_number,
      supplierId: row.supplier_id,
      receiptId: row.receipt_id,
      qcInspectionId: row.qc_inspection_id,
      returnDate: new Date(row.return_date).toISOString(),
      status: row.status,
      reason: row.reason,
      totalAmount: parseFloat(row.total_amount),
      createdBy: row.created_by,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
      postedBy: row.posted_by,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      supplier: row.supplier_name
        ? ({
            id: row.supplier_id,
            partnerCode: row.supplier_code,
            legalName: row.supplier_name,
          } as any)
        : null,
      receipt: row.receipt_number
        ? ({
            id: row.receipt_id,
            receiptNumber: row.receipt_number,
          } as any)
        : null,
      qcInspection: row.inspection_number
        ? ({
            id: row.qc_inspection_id,
            inspectionNumber: row.inspection_number,
          } as any)
        : null,
    };
  }

  private mapLineRow(row: any): PurchaseReturnLine {
    return {
      id: row.id,
      returnId: row.return_id,
      qcLineId: row.qc_line_id,
      receiptLineId: row.receipt_line_id,
      batchId: row.batch_id,
      itemId: row.item_id,
      warehouseId: row.warehouse_id,
      returnQuantity: parseFloat(row.return_quantity),
      unitRate: parseFloat(row.unit_rate),
      totalAmount: parseFloat(row.total_amount),
      createdAt: new Date(row.created_at).toISOString(),
      item: row.item_name
        ? ({
            id: row.item_id,
            sku: row.item_sku,
            itemName: row.item_name,
          } as any)
        : null,
      batch: row.batch_number
        ? ({
            id: row.batch_id,
            batchNumber: row.batch_number,
          } as any)
        : null,
      warehouse: row.warehouse_name
        ? ({
            id: row.warehouse_id,
            code: row.warehouse_code,
            name: row.warehouse_name,
          } as any)
        : null,
    };
  }
}
