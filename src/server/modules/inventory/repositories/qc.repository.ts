import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  QcInspection,
  QcInspectionLine,
  QcInspectionStatus,
} from '../../../../shared/types/index.js';

export interface CreateQcInspectionDbInput {
  companyId: string;
  branchId?: string | null;
  inspectionNumber: string;
  receiptId: string;
  inspectionDate: string;
  status: QcInspectionStatus;
  inspectorId?: string | null;
  remarks?: string | null;
  createdBy?: string | null;
}

export interface CreateQcLineDbInput {
  receiptLineId: string;
  batchId: string;
  itemId: string;
  warehouseId: string;
  receivedQuantity: number;
  passedQuantity: number;
  failedQuantity: number;
  rejectionReason?: string | null;
  remarks?: string | null;
}

export class QcInspectionRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async create(
    inspection: CreateQcInspectionDbInput,
    lines: CreateQcLineDbInput[],
    client?: pg.PoolClient
  ): Promise<QcInspection> {
    const executor = this.getExecutor(client);

    const qcSql = `
      INSERT INTO qc_inspections (
        company_id, branch_id, inspection_number, receipt_id, inspection_date,
        status, inspector_id, remarks, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const qcValues = [
      inspection.companyId,
      inspection.branchId || null,
      inspection.inspectionNumber,
      inspection.receiptId,
      inspection.inspectionDate,
      inspection.status,
      inspection.inspectorId || null,
      inspection.remarks || null,
      inspection.createdBy || null,
    ];

    const qcRes = await executor.query(qcSql, qcValues);
    const qcRow = qcRes.rows[0];

    const insertedLines: QcInspectionLine[] = [];
    for (const line of lines) {
      const lineSql = `
        INSERT INTO qc_inspection_lines (
          inspection_id, receipt_line_id, batch_id, item_id, warehouse_id,
          received_quantity, passed_quantity, failed_quantity, rejection_reason, remarks
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;
      const lineValues = [
        qcRow.id,
        line.receiptLineId,
        line.batchId,
        line.itemId,
        line.warehouseId,
        line.receivedQuantity,
        line.passedQuantity,
        line.failedQuantity,
        line.rejectionReason || null,
        line.remarks || null,
      ];
      const lineRes = await executor.query(lineSql, lineValues);
      insertedLines.push(this.mapLineRow(lineRes.rows[0]));
    }

    return {
      ...this.mapRow(qcRow),
      lines: insertedLines,
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<QcInspection | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT qc.*,
             pr.receipt_number as receipt_number
      FROM qc_inspections qc
      LEFT JOIN purchase_receipts pr ON qc.receipt_id = pr.id
      WHERE qc.id = $1
    `;
    const res = await executor.query(sql, [id]);
    if (res.rows.length === 0) return null;

    const qc = this.mapRow(res.rows[0]);
    qc.lines = await this.findLinesByInspectionId(id, client);
    return qc;
  }

  async findByInspectionNumber(companyId: string, inspectionNumber: string, client?: pg.PoolClient): Promise<QcInspection | null> {
    const executor = this.getExecutor(client);
    const sql = `SELECT id FROM qc_inspections WHERE company_id = $1 AND inspection_number = $2`;
    const res = await executor.query(sql, [companyId, inspectionNumber]);
    if (res.rows.length === 0) return null;
    return this.findById(res.rows[0].id, client);
  }

  async findLinesByInspectionId(inspectionId: string, client?: pg.PoolClient): Promise<QcInspectionLine[]> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT qcl.*,
             i.sku as item_sku, i.item_name as item_name,
             b.batch_number as batch_number,
             w.code as warehouse_code, w.name as warehouse_name
      FROM qc_inspection_lines qcl
      LEFT JOIN items i ON qcl.item_id = i.id
      LEFT JOIN inventory_batches b ON qcl.batch_id = b.id
      LEFT JOIN warehouses w ON qcl.warehouse_id = w.id
      WHERE qcl.inspection_id = $1
    `;
    const res = await executor.query(sql, [inspectionId]);
    return res.rows.map(this.mapLineRow);
  }

  async list(
    companyId: string,
    filters?: { receiptId?: string; status?: string },
    client?: pg.PoolClient
  ): Promise<QcInspection[]> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT qc.*,
             pr.receipt_number as receipt_number
      FROM qc_inspections qc
      LEFT JOIN purchase_receipts pr ON qc.receipt_id = pr.id
      WHERE qc.company_id = $1
    `;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.receiptId) {
      sql += ` AND qc.receipt_id = $${idx++}`;
      values.push(filters.receiptId);
    }
    if (filters?.status) {
      sql += ` AND qc.status = $${idx++}`;
      values.push(filters.status);
    }

    sql += ` ORDER BY qc.created_at DESC`;
    const res = await executor.query(sql, values);
    return res.rows.map(this.mapRow);
  }

  async updateStatus(
    id: string,
    status: QcInspectionStatus,
    client?: pg.PoolClient,
    meta?: { postedBy?: string | null; postedAt?: string | null }
  ): Promise<QcInspection | null> {
    const executor = this.getExecutor(client);
    let sql = `
      UPDATE qc_inspections
      SET status = $1, updated_at = CURRENT_TIMESTAMP
    `;
    const values: any[] = [status, id];
    let idx = 3;

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

  private mapRow(row: any): QcInspection {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      inspectionNumber: row.inspection_number,
      receiptId: row.receipt_id,
      inspectionDate: new Date(row.inspection_date).toISOString(),
      status: row.status,
      inspectorId: row.inspector_id,
      remarks: row.remarks,
      createdBy: row.created_by,
      postedBy: row.posted_by,
      postedAt: row.posted_at ? new Date(row.posted_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      receipt: row.receipt_number
        ? ({
            id: row.receipt_id,
            receiptNumber: row.receipt_number,
          } as any)
        : null,
    };
  }

  private mapLineRow(row: any): QcInspectionLine {
    return {
      id: row.id,
      inspectionId: row.inspection_id,
      receiptLineId: row.receipt_line_id,
      batchId: row.batch_id,
      itemId: row.item_id,
      warehouseId: row.warehouse_id,
      receivedQuantity: parseFloat(row.received_quantity),
      passedQuantity: parseFloat(row.passed_quantity),
      failedQuantity: parseFloat(row.failed_quantity),
      rejectionReason: row.rejection_reason,
      remarks: row.remarks,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
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
