import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  PurchaseReceipt,
  PurchaseReceiptLine,
  PurchaseReceiptBatchAllocation,
  PurchaseReceiptStatus,
} from '../../../../shared/types/index.js';

export interface CreateReceiptDbInput {
  companyId: string;
  branchId?: string | null;
  receiptNumber: string;
  purchaseOrderId?: string | null;
  supplierId: string;
  receiptDate: string;
  status: PurchaseReceiptStatus;
  supplierDeliveryNote?: string | null;
  qcRequired: boolean;
  totalAmount: number;
  notes?: string | null;
  createdBy?: string | null;
}

export interface CreateReceiptLineDbInput {
  lineNumber: number;
  poLineId?: string | null;
  itemId: string;
  warehouseId: string;
  uomId: string;
  receivedQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitRate: number;
  totalAmount: number;
  batchAllocations: Array<{
    batchId: string;
    quantity: number;
    unitCost: number;
  }>;
}

export class PurchaseReceiptRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async create(
    receipt: CreateReceiptDbInput,
    lines: CreateReceiptLineDbInput[],
    client?: pg.PoolClient
  ): Promise<PurchaseReceipt> {
    const executor = this.getExecutor(client);

    const receiptSql = `
      INSERT INTO purchase_receipts (
        company_id, branch_id, receipt_number, purchase_order_id, supplier_id,
        receipt_date, status, supplier_delivery_note, qc_required, total_amount,
        notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const receiptValues = [
      receipt.companyId,
      receipt.branchId || null,
      receipt.receiptNumber,
      receipt.purchaseOrderId || null,
      receipt.supplierId,
      receipt.receiptDate,
      receipt.status,
      receipt.supplierDeliveryNote || null,
      receipt.qcRequired,
      receipt.totalAmount,
      receipt.notes || null,
      receipt.createdBy || null,
    ];

    const receiptRes = await executor.query(receiptSql, receiptValues);
    const receiptRow = receiptRes.rows[0];

    const insertedLines: PurchaseReceiptLine[] = [];
    for (const line of lines) {
      const lineSql = `
        INSERT INTO purchase_receipt_lines (
          receipt_id, line_number, po_line_id, item_id, warehouse_id, uom_id,
          received_quantity, conversion_factor, base_quantity, unit_rate, total_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;
      const lineValues = [
        receiptRow.id,
        line.lineNumber,
        line.poLineId || null,
        line.itemId,
        line.warehouseId,
        line.uomId,
        line.receivedQuantity,
        line.conversionFactor,
        line.baseQuantity,
        line.unitRate,
        line.totalAmount,
      ];
      const lineRes = await executor.query(lineSql, lineValues);
      const lineRow = lineRes.rows[0];

      const insertedAllocations: PurchaseReceiptBatchAllocation[] = [];
      for (const alloc of line.batchAllocations) {
        const allocSql = `
          INSERT INTO purchase_receipt_batch_allocations (
            receipt_line_id, batch_id, quantity, unit_cost
          ) VALUES ($1, $2, $3, $4)
          RETURNING *
        `;
        const allocRes = await executor.query(allocSql, [
          lineRow.id,
          alloc.batchId,
          alloc.quantity,
          alloc.unitCost,
        ]);
        insertedAllocations.push({
          id: allocRes.rows[0].id,
          receiptLineId: lineRow.id,
          batchId: alloc.batchId,
          quantity: parseFloat(allocRes.rows[0].quantity),
          unitCost: parseFloat(allocRes.rows[0].unit_cost),
          createdAt: new Date(allocRes.rows[0].created_at).toISOString(),
        });
      }

      insertedLines.push({
        ...this.mapLineRow(lineRow),
        batchAllocations: insertedAllocations,
      });
    }

    return {
      ...this.mapRow(receiptRow),
      lines: insertedLines,
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<PurchaseReceipt | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT pr.*, 
             bp.partner_code as supplier_code, bp.legal_name as supplier_name,
             po.po_number as purchase_order_number
      FROM purchase_receipts pr
      LEFT JOIN business_partners bp ON pr.supplier_id = bp.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      WHERE pr.id = $1
    `;
    const res = await executor.query(sql, [id]);
    if (res.rows.length === 0) return null;

    const receipt = this.mapRow(res.rows[0]);
    receipt.lines = await this.findLinesByReceiptId(id, client);
    return receipt;
  }

  async findByReceiptNumber(companyId: string, receiptNumber: string, client?: pg.PoolClient): Promise<PurchaseReceipt | null> {
    const executor = this.getExecutor(client);
    const sql = `SELECT id FROM purchase_receipts WHERE company_id = $1 AND receipt_number = $2`;
    const res = await executor.query(sql, [companyId, receiptNumber]);
    if (res.rows.length === 0) return null;
    return this.findById(res.rows[0].id, client);
  }

  async findLinesByReceiptId(receiptId: string, client?: pg.PoolClient): Promise<PurchaseReceiptLine[]> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT prl.*,
             i.sku as item_sku, i.item_name as item_name,
             w.code as warehouse_code, w.name as warehouse_name,
             u.code as uom_code, u.symbol as uom_symbol
      FROM purchase_receipt_lines prl
      LEFT JOIN items i ON prl.item_id = i.id
      LEFT JOIN warehouses w ON prl.warehouse_id = w.id
      LEFT JOIN uoms u ON prl.uom_id = u.id
      WHERE prl.receipt_id = $1
      ORDER BY prl.line_number ASC
    `;
    const linesRes = await executor.query(sql, [receiptId]);
    const lines: PurchaseReceiptLine[] = [];

    for (const row of linesRes.rows) {
      const line = this.mapLineRow(row);
      const allocSql = `
        SELECT ba.*, b.batch_number, b.expiry_date
        FROM purchase_receipt_batch_allocations ba
        LEFT JOIN inventory_batches b ON ba.batch_id = b.id
        WHERE ba.receipt_line_id = $1
      `;
      const allocRes = await executor.query(allocSql, [row.id]);
      line.batchAllocations = allocRes.rows.map((ar) => ({
        id: ar.id,
        receiptLineId: ar.receipt_line_id,
        batchId: ar.batch_id,
        quantity: parseFloat(ar.quantity),
        unitCost: parseFloat(ar.unit_cost),
        createdAt: new Date(ar.created_at).toISOString(),
        batch: {
          id: ar.batch_id,
          companyId: '',
          itemId: row.item_id,
          batchNumber: ar.batch_number,
          expiryDate: ar.expiry_date ? new Date(ar.expiry_date).toISOString().split('T')[0] : null,
          unitCost: parseFloat(ar.unit_cost),
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      }));
      lines.push(line);
    }

    return lines;
  }

  async list(
    companyId: string,
    filters?: { branchId?: string | null; supplierId?: string; status?: string; purchaseOrderId?: string },
    client?: pg.PoolClient
  ): Promise<PurchaseReceipt[]> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT pr.*, 
             bp.partner_code as supplier_code, bp.legal_name as supplier_name,
             po.po_number as purchase_order_number
      FROM purchase_receipts pr
      LEFT JOIN business_partners bp ON pr.supplier_id = bp.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      WHERE pr.company_id = $1
    `;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.branchId) {
      sql += ` AND pr.branch_id = $${idx++}`;
      values.push(filters.branchId);
    }
    if (filters?.supplierId) {
      sql += ` AND pr.supplier_id = $${idx++}`;
      values.push(filters.supplierId);
    }
    if (filters?.status) {
      sql += ` AND pr.status = $${idx++}`;
      values.push(filters.status);
    }
    if (filters?.purchaseOrderId) {
      sql += ` AND pr.purchase_order_id = $${idx++}`;
      values.push(filters.purchaseOrderId);
    }

    sql += ` ORDER BY pr.created_at DESC`;
    const res = await executor.query(sql, values);
    return res.rows.map(this.mapRow);
  }

  async updateStatus(
    id: string,
    status: PurchaseReceiptStatus,
    client?: pg.PoolClient,
    meta?: {
      approvedBy?: string | null;
      approvedAt?: string | null;
      postedBy?: string | null;
      postedAt?: string | null;
    }
  ): Promise<PurchaseReceipt | null> {
    const executor = this.getExecutor(client);
    let sql = `
      UPDATE purchase_receipts
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

  async getTotalReceivedQuantityForPoLine(poLineId: string, client?: pg.PoolClient): Promise<number> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT COALESCE(SUM(prl.received_quantity), 0) as total_received
      FROM purchase_receipt_lines prl
      JOIN purchase_receipts pr ON prl.receipt_id = pr.id
      WHERE prl.po_line_id = $1 AND pr.status IN ('APPROVED', 'POSTED')
    `;
    const res = await executor.query(sql, [poLineId]);
    return parseFloat(res.rows[0].total_received || '0');
  }

  private mapRow(row: any): PurchaseReceipt {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id,
      receiptNumber: row.receipt_number,
      purchaseOrderId: row.purchase_order_id,
      supplierId: row.supplier_id,
      receiptDate: new Date(row.receipt_date).toISOString(),
      status: row.status,
      supplierDeliveryNote: row.supplier_delivery_note,
      qcRequired: row.qc_required,
      totalAmount: parseFloat(row.total_amount),
      notes: row.notes,
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
      purchaseOrder: row.purchase_order_number
        ? ({
            id: row.purchase_order_id,
            poNumber: row.purchase_order_number,
          } as any)
        : null,
    };
  }

  private mapLineRow(row: any): PurchaseReceiptLine {
    return {
      id: row.id,
      receiptId: row.receipt_id,
      lineNumber: row.line_number,
      poLineId: row.po_line_id,
      itemId: row.item_id,
      warehouseId: row.warehouse_id,
      uomId: row.uom_id,
      receivedQuantity: parseFloat(row.received_quantity),
      conversionFactor: parseFloat(row.conversion_factor),
      baseQuantity: parseFloat(row.base_quantity),
      unitRate: parseFloat(row.unit_rate),
      totalAmount: parseFloat(row.total_amount),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      item: row.item_name
        ? ({
            id: row.item_id,
            sku: row.item_sku,
            itemName: row.item_name,
          } as any)
        : null,
      warehouse: row.warehouse_name
        ? ({
            id: row.warehouse_id,
            code: row.warehouse_code,
            name: row.warehouse_name,
          } as any)
        : null,
      uom: row.uom_symbol
        ? ({
            id: row.uom_id,
            code: row.uom_code,
            symbol: row.uom_symbol,
          } as any)
        : null,
    };
  }
}
