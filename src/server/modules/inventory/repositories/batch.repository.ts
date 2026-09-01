import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import { InventoryBatch } from '../../../../shared/types/index.js';

export interface CreateBatchDbInput {
  companyId: string;
  itemId: string;
  batchNumber: string;
  supplierId?: string | null;
  supplierBatchNumber?: string | null;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  unitCost: number;
}

export class BatchRepository {
  private pool = getPool();

  private getExecutor(client?: pg.PoolClient) {
    return client || this.pool;
  }

  async create(batch: CreateBatchDbInput, client?: pg.PoolClient): Promise<InventoryBatch> {
    const executor = this.getExecutor(client);
    const sql = `
      INSERT INTO inventory_batches (
        company_id, item_id, batch_number, supplier_id, supplier_batch_number,
        manufacturing_date, expiry_date, unit_cost
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      batch.companyId,
      batch.itemId,
      batch.batchNumber,
      batch.supplierId || null,
      batch.supplierBatchNumber || null,
      batch.manufacturingDate || null,
      batch.expiryDate || null,
      batch.unitCost,
    ];
    const res = await executor.query(sql, values);
    return this.mapRow(res.rows[0]);
  }

  async findById(id: string, client?: pg.PoolClient): Promise<InventoryBatch | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT b.*,
             i.sku as item_sku, i.item_name as item_name,
             bp.partner_code as supplier_code, bp.legal_name as supplier_name
      FROM inventory_batches b
      LEFT JOIN items i ON b.item_id = i.id
      LEFT JOIN business_partners bp ON b.supplier_id = bp.id
      WHERE b.id = $1
    `;
    const res = await executor.query(sql, [id]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async findByNumber(
    companyId: string,
    itemId: string,
    batchNumber: string,
    client?: pg.PoolClient
  ): Promise<InventoryBatch | null> {
    const executor = this.getExecutor(client);
    const sql = `
      SELECT b.*,
             i.sku as item_sku, i.item_name as item_name,
             bp.partner_code as supplier_code, bp.legal_name as supplier_name
      FROM inventory_batches b
      LEFT JOIN items i ON b.item_id = i.id
      LEFT JOIN business_partners bp ON b.supplier_id = bp.id
      WHERE b.company_id = $1 AND b.item_id = $2 AND b.batch_number = $3
    `;
    const res = await executor.query(sql, [companyId, itemId, batchNumber]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  async list(
    companyId: string,
    filters?: { itemId?: string; supplierId?: string; search?: string },
    client?: pg.PoolClient
  ): Promise<InventoryBatch[]> {
    const executor = this.getExecutor(client);
    let sql = `
      SELECT b.*,
             i.sku as item_sku, i.item_name as item_name,
             bp.partner_code as supplier_code, bp.legal_name as supplier_name
      FROM inventory_batches b
      LEFT JOIN items i ON b.item_id = i.id
      LEFT JOIN business_partners bp ON b.supplier_id = bp.id
      WHERE b.company_id = $1
    `;
    const values: any[] = [companyId];
    let idx = 2;

    if (filters?.itemId) {
      sql += ` AND b.item_id = $${idx++}`;
      values.push(filters.itemId);
    }
    if (filters?.supplierId) {
      sql += ` AND b.supplier_id = $${idx++}`;
      values.push(filters.supplierId);
    }
    if (filters?.search) {
      sql += ` AND b.batch_number ILIKE $${idx++}`;
      values.push(`%${filters.search}%`);
    }

    sql += ` ORDER BY b.created_at DESC`;
    const res = await executor.query(sql, values);
    return res.rows.map(this.mapRow);
  }

  private mapRow(row: any): InventoryBatch {
    return {
      id: row.id,
      companyId: row.company_id,
      itemId: row.item_id,
      batchNumber: row.batch_number,
      supplierId: row.supplier_id,
      supplierBatchNumber: row.supplier_batch_number,
      manufacturingDate: row.manufacturing_date
        ? row.manufacturing_date instanceof Date
          ? row.manufacturing_date.toISOString().split('T')[0]
          : row.manufacturing_date
        : null,
      expiryDate: row.expiry_date
        ? row.expiry_date instanceof Date
          ? row.expiry_date.toISOString().split('T')[0]
          : row.expiry_date
        : null,
      unitCost: parseFloat(row.unit_cost),
      isActive: row.is_active,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      item: row.item_name
        ? ({
            id: row.item_id,
            sku: row.item_sku,
            itemName: row.item_name,
          } as any)
        : null,
      supplier: row.supplier_name
        ? ({
            id: row.supplier_id,
            partnerCode: row.supplier_code,
            legalName: row.supplier_name,
          } as any)
        : null,
    };
  }
}
