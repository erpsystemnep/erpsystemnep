import { query } from '../../../db/connection.js';
import { NumberingSeries } from '../../../../shared/types/index.js';
import {
  CreateNumberingSeriesInput,
  UpdateNumberingSeriesInput,
} from '../../../../shared/schemas/org.js';
import pg from 'pg';

export class NumberingSeriesRepository {
  /**
   * Maps raw database row to NumberingSeries domain interface.
   */
  private mapRowToEntity(row: any): NumberingSeries {
    return {
      id: row.id,
      companyId: row.company_id,
      branchId: row.branch_id || null,
      documentType: row.document_type,
      prefix: row.prefix,
      suffix: row.suffix || undefined,
      minDigits: Number(row.min_digits),
      currentNumber: Number(row.current_number),
      resetFrequency: row.reset_frequency,
      lastResetDate: row.last_reset_date ? new Date(row.last_reset_date).toISOString().split('T')[0] : undefined,
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<NumberingSeries | null> {
    const sql = `
      SELECT id, company_id, branch_id, document_type, prefix, suffix,
             min_digits, current_number, reset_frequency, last_reset_date,
             is_active, created_at, updated_at
      FROM numbering_series
      WHERE id = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  /**
   * Finds numbering series by exact scope (branch-specific or company-wide where branch_id IS NULL).
   */
  async findByScope(
    companyId: string,
    branchId: string | null | undefined,
    documentType: string,
    client?: pg.PoolClient
  ): Promise<NumberingSeries | null> {
    let sql: string;
    let params: any[];

    if (branchId) {
      sql = `
        SELECT id, company_id, branch_id, document_type, prefix, suffix,
               min_digits, current_number, reset_frequency, last_reset_date,
               is_active, created_at, updated_at
        FROM numbering_series
        WHERE company_id = $1 AND branch_id = $2 AND document_type = $3
      `;
      params = [companyId, branchId, documentType.toUpperCase()];
    } else {
      sql = `
        SELECT id, company_id, branch_id, document_type, prefix, suffix,
               min_digits, current_number, reset_frequency, last_reset_date,
               is_active, created_at, updated_at
        FROM numbering_series
        WHERE company_id = $1 AND branch_id IS NULL AND document_type = $2
      `;
      params = [companyId, documentType.toUpperCase()];
    }

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  /**
   * Locks the series row for atomic update during sequence generation.
   * MUST be executed inside an active transaction.
   */
  async findForUpdate(id: string, client: pg.PoolClient): Promise<NumberingSeries | null> {
    const sql = `
      SELECT id, company_id, branch_id, document_type, prefix, suffix,
             min_digits, current_number, reset_frequency, last_reset_date,
             is_active, created_at, updated_at
      FROM numbering_series
      WHERE id = $1
      FOR UPDATE
    `;
    const result = await client.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  /**
   * Atomically increments current_number and updates last_reset_date.
   */
  async incrementAndReset(
    id: string,
    nextNumber: number,
    lastResetDate: string | null,
    client: pg.PoolClient
  ): Promise<NumberingSeries> {
    const sql = `
      UPDATE numbering_series
      SET current_number = $1,
          last_reset_date = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, company_id, branch_id, document_type, prefix, suffix,
                min_digits, current_number, reset_frequency, last_reset_date,
                is_active, created_at, updated_at
    `;
    const result = await client.query(sql, [nextNumber, lastResetDate, id]);
    return this.mapRowToEntity(result.rows[0]);
  }

  async list(
    companyId: string,
    filters?: { branchId?: string | null; documentType?: string; isActive?: boolean },
    client?: pg.PoolClient
  ): Promise<NumberingSeries[]> {
    let sql = `
      SELECT id, company_id, branch_id, document_type, prefix, suffix,
             min_digits, current_number, reset_frequency, last_reset_date,
             is_active, created_at, updated_at
      FROM numbering_series
      WHERE company_id = $1
    `;
    const params: any[] = [companyId];
    let idx = 2;

    if (filters?.branchId !== undefined) {
      if (filters.branchId === null) {
        sql += ' AND branch_id IS NULL';
      } else {
        sql += ` AND branch_id = $${idx++}`;
        params.push(filters.branchId);
      }
    }

    if (filters?.documentType) {
      sql += ` AND document_type = $${idx++}`;
      params.push(filters.documentType.toUpperCase());
    }

    if (filters?.isActive !== undefined) {
      sql += ` AND is_active = $${idx++}`;
      params.push(filters.isActive);
    }

    sql += ' ORDER BY document_type ASC, branch_id ASC NULLS FIRST';

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return result.rows.map((r: any) => this.mapRowToEntity(r));
  }

  async create(input: CreateNumberingSeriesInput, client?: pg.PoolClient): Promise<NumberingSeries> {
    const sql = `
      INSERT INTO numbering_series (
        company_id, branch_id, document_type, prefix, suffix,
        min_digits, current_number, reset_frequency, is_active,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id, company_id, branch_id, document_type, prefix, suffix,
                min_digits, current_number, reset_frequency, last_reset_date,
                is_active, created_at, updated_at
    `;
    const params = [
      input.companyId,
      input.branchId || null,
      input.documentType.toUpperCase(),
      input.prefix,
      input.suffix || null,
      input.minDigits ?? 5,
      input.currentNumber ?? 0,
      input.resetFrequency ?? 'NEVER',
      input.isActive ?? true,
    ];

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return this.mapRowToEntity(result.rows[0]);
  }

  async update(
    id: string,
    input: UpdateNumberingSeriesInput,
    client?: pg.PoolClient
  ): Promise<NumberingSeries | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.prefix !== undefined) {
      fields.push(`prefix = $${idx++}`);
      params.push(input.prefix);
    }
    if (input.suffix !== undefined) {
      fields.push(`suffix = $${idx++}`);
      params.push(input.suffix || null);
    }
    if (input.minDigits !== undefined) {
      fields.push(`min_digits = $${idx++}`);
      params.push(input.minDigits);
    }
    if (input.currentNumber !== undefined) {
      fields.push(`current_number = $${idx++}`);
      params.push(input.currentNumber);
    }
    if (input.resetFrequency !== undefined) {
      fields.push(`reset_frequency = $${idx++}`);
      params.push(input.resetFrequency);
    }
    if (input.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      params.push(input.isActive);
    }

    if (fields.length === 0) {
      return this.findById(id, client);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const sql = `
      UPDATE numbering_series
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, company_id, branch_id, document_type, prefix, suffix,
                min_digits, current_number, reset_frequency, last_reset_date,
                is_active, created_at, updated_at
    `;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }
}
