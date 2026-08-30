import { query } from '../../../db/connection.js';
import {
  BusinessPartner,
  BusinessPartnerAddress,
  BusinessPartnerContact,
  PaginatedResult,
} from '../../../../shared/types/index.js';
import {
  CreatePartnerInput,
  UpdatePartnerInput,
  PartnerQueryInput,
} from '../schemas/partner.schema.js';
import pg from 'pg';

export class PartnerRepository {
  private mapPartnerRow(row: any): BusinessPartner {
    return {
      id: row.id,
      companyId: row.company_id,
      partnerCode: row.partner_code,
      legalName: row.legal_name,
      tradeName: row.trade_name || undefined,
      partnerType: row.partner_type,
      taxIdentifier: row.tax_identifier || undefined,
      email: row.email || undefined,
      phone: row.phone || undefined,
      countryCode: row.country_code,
      currencyCode: row.currency_code,
      isCustomer: Boolean(row.is_customer),
      isSupplier: Boolean(row.is_supplier),
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private mapAddressRow(row: any): BusinessPartnerAddress {
    return {
      id: row.id,
      partnerId: row.partner_id,
      addressType: row.address_type,
      addressLine1: row.address_line1,
      addressLine2: row.address_line2 || undefined,
      city: row.city || undefined,
      stateProvince: row.state_province || undefined,
      postalCode: row.postal_code || undefined,
      countryCode: row.country_code,
      isDefault: Boolean(row.is_default),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private mapContactRow(row: any): BusinessPartnerContact {
    return {
      id: row.id,
      partnerId: row.partner_id,
      contactName: row.contact_name,
      designation: row.designation || undefined,
      email: row.email || undefined,
      phone: row.phone || undefined,
      isPrimary: Boolean(row.is_primary),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async findById(id: string, companyId?: string | null, client?: pg.PoolClient): Promise<BusinessPartner | null> {
    let sql = `
      SELECT id, company_id, partner_code, legal_name, trade_name, partner_type,
             tax_identifier, email, phone, country_code, currency_code,
             is_customer, is_supplier, is_active, created_at, updated_at
      FROM business_partners
      WHERE id = $1
    `;
    const params: any[] = [id];

    if (companyId) {
      sql += ' AND company_id = $2';
      params.push(companyId);
    }

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;

    const partner = this.mapPartnerRow(result.rows[0]);

    // Fetch addresses & contacts
    const [addrRes, contactRes] = await Promise.all([
      executor.query(
        'SELECT * FROM business_partner_addresses WHERE partner_id = $1 ORDER BY is_default DESC, created_at ASC',
        [partner.id]
      ),
      executor.query(
        'SELECT * FROM business_partner_contacts WHERE partner_id = $1 ORDER BY is_primary DESC, created_at ASC',
        [partner.id]
      ),
    ]);

    partner.addresses = addrRes.rows.map((r: any) => this.mapAddressRow(r));
    partner.contacts = contactRes.rows.map((r: any) => this.mapContactRow(r));

    return partner;
  }

  async findByCode(partnerCode: string, companyId: string, client?: pg.PoolClient): Promise<BusinessPartner | null> {
    const sql = `
      SELECT id, company_id, partner_code, legal_name, trade_name, partner_type,
             tax_identifier, email, phone, country_code, currency_code,
             is_customer, is_supplier, is_active, created_at, updated_at
      FROM business_partners
      WHERE UPPER(partner_code) = UPPER($1) AND company_id = $2
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [partnerCode, companyId]);
    if (result.rows.length === 0) return null;
    return this.mapPartnerRow(result.rows[0]);
  }

  async list(companyId: string, queryFilters: PartnerQueryInput, client?: pg.PoolClient): Promise<PaginatedResult<BusinessPartner>> {
    const conditions: string[] = ['company_id = $1'];
    const params: any[] = [companyId];
    let idx = 2;

    if (queryFilters.search) {
      conditions.push(`(partner_code ILIKE $${idx} OR legal_name ILIKE $${idx} OR trade_name ILIKE $${idx} OR tax_identifier ILIKE $${idx})`);
      params.push(`%${queryFilters.search}%`);
      idx++;
    }

    if (queryFilters.partnerCode) {
      conditions.push(`partner_code ILIKE $${idx}`);
      params.push(`%${queryFilters.partnerCode}%`);
      idx++;
    }

    if (queryFilters.legalName) {
      conditions.push(`legal_name ILIKE $${idx}`);
      params.push(`%${queryFilters.legalName}%`);
      idx++;
    }

    if (queryFilters.taxIdentifier) {
      conditions.push(`tax_identifier ILIKE $${idx}`);
      params.push(`%${queryFilters.taxIdentifier}%`);
      idx++;
    }

    if (queryFilters.isCustomer !== undefined) {
      conditions.push(`is_customer = $${idx}`);
      params.push(queryFilters.isCustomer);
      idx++;
    }

    if (queryFilters.isSupplier !== undefined) {
      conditions.push(`is_supplier = $${idx}`);
      params.push(queryFilters.isSupplier);
      idx++;
    }

    if (queryFilters.isActive !== undefined) {
      conditions.push(`is_active = $${idx}`);
      params.push(queryFilters.isActive);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS total FROM business_partners ${whereClause}`;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const countRes = await executor.query(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    const page = queryFilters.page || 1;
    const limit = queryFilters.limit || 50;
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT id, company_id, partner_code, legal_name, trade_name, partner_type,
             tax_identifier, email, phone, country_code, currency_code,
             is_customer, is_supplier, is_active, created_at, updated_at
      FROM business_partners
      ${whereClause}
      ORDER BY partner_code ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(limit, offset);

    const dataRes = await executor.query(dataSql, params);
    const items = dataRes.rows.map((r: any) => this.mapPartnerRow(r));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async create(companyId: string, input: CreatePartnerInput, client?: pg.PoolClient): Promise<BusinessPartner> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };

    const sql = `
      INSERT INTO business_partners (
        company_id, partner_code, legal_name, trade_name, partner_type,
        tax_identifier, email, phone, country_code, currency_code,
        is_customer, is_supplier, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `;
    const params = [
      companyId,
      input.partnerCode.toUpperCase(),
      input.legalName,
      input.tradeName || null,
      input.partnerType || 'ORGANIZATION',
      input.taxIdentifier || null,
      input.email || null,
      input.phone || null,
      (input.countryCode || 'US').toUpperCase(),
      (input.currencyCode || 'USD').toUpperCase(),
      input.isCustomer ?? false,
      input.isSupplier ?? false,
      input.isActive ?? true,
    ];

    const result = await executor.query(sql, params);
    const partner = this.mapPartnerRow(result.rows[0]);

    // Insert addresses if provided
    if (input.addresses && input.addresses.length > 0) {
      partner.addresses = [];
      for (const addr of input.addresses) {
        const addrSql = `
          INSERT INTO business_partner_addresses (
            partner_id, address_type, address_line1, address_line2, city, state_province, postal_code, country_code, is_default, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *
        `;
        const addrRes = await executor.query(addrSql, [
          partner.id,
          addr.addressType,
          addr.addressLine1,
          addr.addressLine2 || null,
          addr.city || null,
          addr.stateProvince || null,
          addr.postalCode || null,
          (addr.countryCode || 'US').toUpperCase(),
          addr.isDefault ?? false,
        ]);
        partner.addresses.push(this.mapAddressRow(addrRes.rows[0]));
      }
    }

    // Insert contacts if provided
    if (input.contacts && input.contacts.length > 0) {
      partner.contacts = [];
      for (const contact of input.contacts) {
        const cSql = `
          INSERT INTO business_partner_contacts (
            partner_id, contact_name, designation, email, phone, is_primary, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *
        `;
        const cRes = await executor.query(cSql, [
          partner.id,
          contact.contactName,
          contact.designation || null,
          contact.email || null,
          contact.phone || null,
          contact.isPrimary ?? false,
        ]);
        partner.contacts.push(this.mapContactRow(cRes.rows[0]));
      }
    }

    return partner;
  }

  async update(id: string, companyId: string, input: UpdatePartnerInput, client?: pg.PoolClient): Promise<BusinessPartner | null> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.legalName !== undefined) {
      fields.push(`legal_name = $${idx++}`);
      params.push(input.legalName);
    }
    if (input.tradeName !== undefined) {
      fields.push(`trade_name = $${idx++}`);
      params.push(input.tradeName);
    }
    if (input.partnerType !== undefined) {
      fields.push(`partner_type = $${idx++}`);
      params.push(input.partnerType);
    }
    if (input.taxIdentifier !== undefined) {
      fields.push(`tax_identifier = $${idx++}`);
      params.push(input.taxIdentifier);
    }
    if (input.email !== undefined) {
      fields.push(`email = $${idx++}`);
      params.push(input.email || null);
    }
    if (input.phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      params.push(input.phone || null);
    }
    if (input.countryCode !== undefined) {
      fields.push(`country_code = $${idx++}`);
      params.push(input.countryCode.toUpperCase());
    }
    if (input.currencyCode !== undefined) {
      fields.push(`currency_code = $${idx++}`);
      params.push(input.currencyCode.toUpperCase());
    }
    if (input.isCustomer !== undefined) {
      fields.push(`is_customer = $${idx++}`);
      params.push(input.isCustomer);
    }
    if (input.isSupplier !== undefined) {
      fields.push(`is_supplier = $${idx++}`);
      params.push(input.isSupplier);
    }
    if (input.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      params.push(input.isActive);
    }

    if (fields.length > 0) {
      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(id, companyId);

      const sql = `
        UPDATE business_partners
        SET ${fields.join(', ')}
        WHERE id = $${idx++} AND company_id = $${idx++}
        RETURNING *
      `;
      const res = await executor.query(sql, params);
      if (res.rows.length === 0) return null;
    }

    // If addresses provided, replace/sync
    if (input.addresses !== undefined) {
      await executor.query('DELETE FROM business_partner_addresses WHERE partner_id = $1', [id]);
      for (const addr of input.addresses) {
        await executor.query(
          `INSERT INTO business_partner_addresses (
            partner_id, address_type, address_line1, address_line2, city, state_province, postal_code, country_code, is_default, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            id,
            addr.addressType,
            addr.addressLine1,
            addr.addressLine2 || null,
            addr.city || null,
            addr.stateProvince || null,
            addr.postalCode || null,
            (addr.countryCode || 'US').toUpperCase(),
            addr.isDefault ?? false,
          ]
        );
      }
    }

    // If contacts provided, replace/sync
    if (input.contacts !== undefined) {
      await executor.query('DELETE FROM business_partner_contacts WHERE partner_id = $1', [id]);
      for (const c of input.contacts) {
        await executor.query(
          `INSERT INTO business_partner_contacts (
            partner_id, contact_name, designation, email, phone, is_primary, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            id,
            c.contactName,
            c.designation || null,
            c.email || null,
            c.phone || null,
            c.isPrimary ?? false,
          ]
        );
      }
    }

    return this.findById(id, companyId, client);
  }

  async softDelete(id: string, companyId: string, client?: pg.PoolClient): Promise<BusinessPartner | null> {
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const sql = `
      UPDATE business_partners
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND company_id = $2
      RETURNING *
    `;
    const res = await executor.query(sql, [id, companyId]);
    if (res.rows.length === 0) return null;
    return this.mapPartnerRow(res.rows[0]);
  }
}
