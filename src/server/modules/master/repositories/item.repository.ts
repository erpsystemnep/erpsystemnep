import { query } from '../../../db/connection.js';
import {
  Item,
  ItemCategory,
  UnitOfMeasure,
  ItemUomConversion,
  PaginatedResult,
} from '../../../../shared/types/index.js';
import {
  CreateItemInput,
  UpdateItemInput,
  ItemQueryInput,
  ItemUomConversionInput,
} from '../schemas/item.schema.js';
import pg from 'pg';

export class ItemRepository {
  private mapItemRow(row: any): Item {
    return {
      id: row.id,
      companyId: row.company_id,
      sku: row.sku,
      itemName: row.item_name,
      description: row.description || undefined,
      categoryId: row.category_id || undefined,
      itemType: row.item_type,
      baseUomId: row.base_uom_id,
      isStockItem: Boolean(row.is_stock_item),
      isSaleable: Boolean(row.is_saleable),
      isPurchasable: Boolean(row.is_purchasable),
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private mapConversionRow(row: any): ItemUomConversion {
    return {
      id: row.id,
      itemId: row.item_id,
      fromUomId: row.from_uom_id,
      toUomId: row.to_uom_id,
      conversionFactor: Number(row.conversion_factor),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      fromUomCode: row.from_uom_code || undefined,
      toUomCode: row.to_uom_code || undefined,
    };
  }

  async findById(id: string, companyId?: string | null, client?: pg.PoolClient): Promise<Item | null> {
    let sql = `
      SELECT i.id, i.company_id, i.sku, i.item_name, i.description, i.category_id,
             i.item_type, i.base_uom_id, i.is_stock_item, i.is_saleable, i.is_purchasable,
             i.is_active, i.created_at, i.updated_at,
             c.code AS category_code, c.name AS category_name,
             u.code AS uom_code, u.name AS uom_name, u.symbol AS uom_symbol, u.uom_type AS uom_type
      FROM items i
      LEFT JOIN item_categories c ON i.category_id = c.id
      LEFT JOIN uoms u ON i.base_uom_id = u.id
      WHERE i.id = $1
    `;
    const params: any[] = [id];

    if (companyId) {
      sql += ' AND i.company_id = $2';
      params.push(companyId);
    }

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const item = this.mapItemRow(row);

    if (row.category_id) {
      item.category = {
        id: row.category_id,
        companyId: row.company_id,
        code: row.category_code,
        name: row.category_name,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      };
    }

    if (row.base_uom_id) {
      item.baseUom = {
        id: row.base_uom_id,
        companyId: row.company_id,
        code: row.uom_code,
        name: row.uom_name,
        symbol: row.uom_symbol,
        uomType: row.uom_type,
        conversionPrecision: 4,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      };
    }

    // Fetch conversions
    const convSql = `
      SELECT c.id, c.item_id, c.from_uom_id, c.to_uom_id, c.conversion_factor,
             c.created_at, c.updated_at,
             fu.code AS from_uom_code, tu.code AS to_uom_code
      FROM item_uom_conversions c
      JOIN uoms fu ON c.from_uom_id = fu.id
      JOIN uoms tu ON c.to_uom_id = tu.id
      WHERE c.item_id = $1
      ORDER BY c.created_at ASC
    `;
    const convRes = await executor.query(convSql, [item.id]);
    item.conversions = convRes.rows.map((r: any) => this.mapConversionRow(r));

    return item;
  }

  async findBySku(sku: string, companyId: string, client?: pg.PoolClient): Promise<Item | null> {
    const sql = `
      SELECT id, company_id, sku, item_name, description, category_id,
             item_type, base_uom_id, is_stock_item, is_saleable, is_purchasable,
             is_active, created_at, updated_at
      FROM items
      WHERE UPPER(sku) = UPPER($1) AND company_id = $2
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [sku, companyId]);
    if (result.rows.length === 0) return null;
    return this.mapItemRow(result.rows[0]);
  }

  async list(companyId: string, queryFilters: ItemQueryInput, client?: pg.PoolClient): Promise<PaginatedResult<Item>> {
    const conditions: string[] = ['i.company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (queryFilters.search) {
      conditions.push(`(i.sku ILIKE $${idx} OR i.item_name ILIKE $${idx} OR i.description ILIKE $${idx})`);
      params.push(`%${queryFilters.search}%`);
      idx++;
    }

    if (queryFilters.sku) {
      conditions.push(`i.sku ILIKE $${idx}`);
      params.push(`%${queryFilters.sku}%`);
      idx++;
    }

    if (queryFilters.itemName) {
      conditions.push(`i.item_name ILIKE $${idx}`);
      params.push(`%${queryFilters.itemName}%`);
      idx++;
    }

    if (queryFilters.categoryId) {
      conditions.push(`i.category_id = $${idx}`);
      params.push(queryFilters.categoryId);
      idx++;
    }

    if (queryFilters.itemType) {
      conditions.push(`i.item_type = $${idx}`);
      params.push(queryFilters.itemType);
      idx++;
    }

    if (queryFilters.baseUomId) {
      conditions.push(`i.base_uom_id = $${idx}`);
      params.push(queryFilters.baseUomId);
      idx++;
    }

    if (queryFilters.isStockItem !== undefined) {
      conditions.push(`i.is_stock_item = $${idx}`);
      params.push(queryFilters.isStockItem);
      idx++;
    }

    if (queryFilters.isSaleable !== undefined) {
      conditions.push(`i.is_saleable = $${idx}`);
      params.push(queryFilters.isSaleable);
      idx++;
    }

    if (queryFilters.isPurchasable !== undefined) {
      conditions.push(`i.is_purchasable = $${idx}`);
      params.push(queryFilters.isPurchasable);
      idx++;
    }

    if (queryFilters.isActive !== undefined) {
      conditions.push(`i.is_active = $${idx}`);
      params.push(queryFilters.isActive);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS total FROM items i ${whereClause}`;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const countRes = await executor.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const page = queryFilters.page || 1;
    const limit = queryFilters.limit || 50;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT i.id, i.company_id, i.sku, i.item_name, i.description, i.category_id,
             i.item_type, i.base_uom_id, i.is_stock_item, i.is_saleable, i.is_purchasable,
             i.is_active, i.created_at, i.updated_at,
             c.code AS category_code, c.name AS category_name,
             u.code AS uom_code, u.name AS uom_name, u.symbol AS uom_symbol
      FROM items i
      LEFT JOIN item_categories c ON i.category_id = c.id
      LEFT JOIN uoms u ON i.base_uom_id = u.id
      ${whereClause}
      ORDER BY i.sku ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(limit, offset);

    const dataRes = await executor.query(dataSql, params);
    const items = dataRes.rows.map((row: any) => {
      const item = this.mapItemRow(row);
      if (row.category_id) {
        item.category = {
          id: row.category_id,
          companyId: row.company_id,
          code: row.category_code,
          name: row.category_name,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        };
      }
      if (row.base_uom_id) {
        item.baseUom = {
          id: row.base_uom_id,
          companyId: row.company_id,
          code: row.uom_code,
          name: row.uom_name,
          symbol: row.uom_symbol,
          uomType: 'COUNT',
          conversionPrecision: 4,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        };
      }
      return item;
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(companyId: string, input: CreateItemInput, client?: pg.PoolClient): Promise<Item> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };

    const sql = `
      INSERT INTO items (
        company_id, sku, item_name, description, category_id,
        item_type, base_uom_id, is_stock_item, is_saleable, is_purchasable,
        is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `;
    const params = [
      companyId,
      input.sku.toUpperCase(),
      input.itemName,
      input.description || null,
      input.categoryId || null,
      input.itemType || 'RAW_MATERIAL',
      input.baseUomId,
      input.isStockItem ?? true,
      input.isSaleable ?? false,
      input.isPurchasable ?? true,
      input.isActive ?? true,
    ];

    const result = await executor.query(sql, params);
    const item = this.mapItemRow(result.rows[0]);

    // Insert conversions if provided
    if (input.conversions && input.conversions.length > 0) {
      item.conversions = [];
      for (const conv of input.conversions) {
        const convSql = `
          INSERT INTO item_uom_conversions (
            item_id, from_uom_id, to_uom_id, conversion_factor, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *
        `;
        const convRes = await executor.query(convSql, [
          item.id,
          conv.fromUomId,
          conv.toUomId,
          conv.conversionFactor,
        ]);
        item.conversions.push(this.mapConversionRow(convRes.rows[0]));
      }
    }

    return item;
  }

  async update(id: string, companyId: string, input: UpdateItemInput, client?: pg.PoolClient): Promise<Item | null> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.itemName !== undefined) {
      fields.push(`item_name = $${idx++}`);
      params.push(input.itemName);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${idx++}`);
      params.push(input.description || null);
    }
    if (input.categoryId !== undefined) {
      fields.push(`category_id = $${idx++}`);
      params.push(input.categoryId || null);
    }
    if (input.itemType !== undefined) {
      fields.push(`item_type = $${idx++}`);
      params.push(input.itemType);
    }
    if (input.baseUomId !== undefined) {
      fields.push(`base_uom_id = $${idx++}`);
      params.push(input.baseUomId);
    }
    if (input.isStockItem !== undefined) {
      fields.push(`is_stock_item = $${idx++}`);
      params.push(input.isStockItem);
    }
    if (input.isSaleable !== undefined) {
      fields.push(`is_saleable = $${idx++}`);
      params.push(input.isSaleable);
    }
    if (input.isPurchasable !== undefined) {
      fields.push(`is_purchasable = $${idx++}`);
      params.push(input.isPurchasable);
    }
    if (input.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      params.push(input.isActive);
    }

    if (fields.length > 0) {
      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(id, companyId);

      const sql = `
        UPDATE items
        SET ${fields.join(', ')}
        WHERE id = $${idx++} AND company_id = $${idx++}
        RETURNING *
      `;
      const res = await executor.query(sql, params);
      if (res.rows.length === 0) return null;
    }

    // Sync conversions if provided
    if (input.conversions !== undefined) {
      await executor.query('DELETE FROM item_uom_conversions WHERE item_id = $1', [id]);
      for (const conv of input.conversions) {
        await executor.query(
          `INSERT INTO item_uom_conversions (
            item_id, from_uom_id, to_uom_id, conversion_factor, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [id, conv.fromUomId, conv.toUomId, conv.conversionFactor]
        );
      }
    }

    return this.findById(id, companyId, client);
  }

  async softDelete(id: string, companyId: string, client?: pg.PoolClient): Promise<Item | null> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const sql = `
      UPDATE items
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND company_id = $2
      RETURNING *
    `;
    const res = await executor.query(sql, [id, companyId]);
    if (res.rows.length === 0) return null;
    return this.mapItemRow(res.rows[0]);
  }

  // Conversion specific methods
  async addConversion(itemId: string, input: ItemUomConversionInput, client?: pg.PoolClient): Promise<ItemUomConversion> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const sql = `
      INSERT INTO item_uom_conversions (
        item_id, from_uom_id, to_uom_id, conversion_factor, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;
    const res = await executor.query(sql, [
      itemId,
      input.fromUomId,
      input.toUomId,
      input.conversionFactor,
    ]);
    return this.mapConversionRow(res.rows[0]);
  }

  async deleteConversion(conversionId: string, itemId: string, client?: pg.PoolClient): Promise<boolean> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const res = await executor.query(
      'DELETE FROM item_uom_conversions WHERE id = $1 AND item_id = $2 RETURNING id',
      [conversionId, itemId]
    );
    return res.rows.length > 0;
  }
}
