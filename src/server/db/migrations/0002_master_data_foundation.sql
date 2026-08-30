-- ====================================================================
-- MIGRATION: 0002_master_data_foundation.sql
-- DESCRIPTION: Establishes Master Data foundation schema:
--              - business_partners, business_partner_addresses, business_partner_contacts
--              - item_categories
--              - uoms
--              - items
--              - item_uom_conversions
-- ====================================================================

-- 1. BUSINESS PARTNERS (Customers, Suppliers, or dual-role commercial partners)
CREATE TABLE IF NOT EXISTS business_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    partner_code VARCHAR(64) NOT NULL,
    legal_name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255),
    partner_type VARCHAR(32) NOT NULL DEFAULT 'ORGANIZATION', -- 'ORGANIZATION', 'INDIVIDUAL'
    tax_identifier VARCHAR(64),
    email VARCHAR(255),
    phone VARCHAR(64),
    country_code VARCHAR(2) NOT NULL DEFAULT 'US',
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    is_customer BOOLEAN NOT NULL DEFAULT FALSE,
    is_supplier BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_partner_company_code UNIQUE (company_id, partner_code)
);

-- 2. BUSINESS PARTNER ADDRESSES (Multi-location shipping/billing registry)
CREATE TABLE IF NOT EXISTS business_partner_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
    address_type VARCHAR(32) NOT NULL DEFAULT 'SHIPPING', -- 'BILLING', 'SHIPPING', 'REGISTERED', 'OTHER'
    address_line1 VARCHAR(255) NOT NULL,
    address_line2 VARCHAR(255),
    city VARCHAR(128),
    state_province VARCHAR(128),
    postal_code VARCHAR(32),
    country_code VARCHAR(2) NOT NULL DEFAULT 'US',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. BUSINESS PARTNER CONTACTS (Named contacts and representatives)
CREATE TABLE IF NOT EXISTS business_partner_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
    contact_name VARCHAR(255) NOT NULL,
    designation VARCHAR(128),
    email VARCHAR(255),
    phone VARCHAR(64),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. ITEM CATEGORIES (Hierarchical product and material taxonomy)
CREATE TABLE IF NOT EXISTS item_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_category_id UUID REFERENCES item_categories(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_category_company_code UNIQUE (company_id, code)
);

-- 5. UNITS OF MEASURE (UOMs - Base and alternate measure definitions)
CREATE TABLE IF NOT EXISTS uoms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    symbol VARCHAR(16) NOT NULL,
    uom_type VARCHAR(32) NOT NULL DEFAULT 'COUNT', -- 'WEIGHT', 'VOLUME', 'LENGTH', 'AREA', 'COUNT', 'TIME', 'OTHER'
    conversion_precision SMALLINT NOT NULL DEFAULT 4,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_uom_company_code UNIQUE (company_id, code)
);

-- 6. ITEMS (Master catalog for raw materials, WIP, packaging, and finished products)
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    sku VARCHAR(64) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    description TEXT,
    category_id UUID REFERENCES item_categories(id) ON DELETE RESTRICT,
    item_type VARCHAR(64) NOT NULL DEFAULT 'RAW_MATERIAL', -- 'RAW_MATERIAL', 'INGREDIENT', 'FINISHED_GOOD', 'SEMI_FINISHED_GOOD', 'PACKAGING', 'CONSUMABLE', 'SERVICE', 'OTHER'
    base_uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    is_stock_item BOOLEAN NOT NULL DEFAULT TRUE,
    is_saleable BOOLEAN NOT NULL DEFAULT FALSE,
    is_purchasable BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_item_company_sku UNIQUE (company_id, sku)
);

-- 7. ITEM UOM CONVERSIONS (Item-specific alternate unit conversion ratios)
CREATE TABLE IF NOT EXISTS item_uom_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    from_uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    to_uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    conversion_factor NUMERIC(18, 6) NOT NULL CHECK (conversion_factor > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_item_uom_conversion UNIQUE (item_id, from_uom_id, to_uom_id)
);

-- 8. INDEXES FOR PERFORMANCE AND TENANT ISOLATION
CREATE INDEX IF NOT EXISTS idx_business_partners_company ON business_partners(company_id);
CREATE INDEX IF NOT EXISTS idx_partner_addresses_partner ON business_partner_addresses(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_contacts_partner ON business_partner_contacts(partner_id);
CREATE INDEX IF NOT EXISTS idx_item_categories_company ON item_categories(company_id);
CREATE INDEX IF NOT EXISTS idx_item_categories_parent ON item_categories(parent_category_id);
CREATE INDEX IF NOT EXISTS idx_uoms_company ON uoms(company_id);
CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_base_uom ON items(base_uom_id);
CREATE INDEX IF NOT EXISTS idx_item_uom_conversions_item ON item_uom_conversions(item_id);
