-- ====================================================================
-- MIGRATION: 0004_sales_fulfillment_foundation.sql
-- DESCRIPTION: Establishes Transactional Sales Orders, Stock Reservations,
--              Goods Deliveries (Delivery Notes), Batch Allocations, and
--              Sales-related Stock Movements in the Authoritative Stock Ledger.
-- ====================================================================

-- 1. SALES ORDERS (Commercial sale agreement with customers)
CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    so_number VARCHAR(64) NOT NULL,
    customer_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED', 'CLOSED')),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_total NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
    grand_total NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_so_company_number UNIQUE (company_id, so_number)
);

-- 2. SALES ORDER LINES (Itemized quantities, prices, taxes, and discounts)
CREATE TABLE IF NOT EXISTS sales_order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    line_number SMALLINT NOT NULL CHECK (line_number > 0),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    ordered_quantity NUMERIC(18, 4) NOT NULL CHECK (ordered_quantity > 0),
    conversion_factor NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (conversion_factor > 0),
    base_quantity NUMERIC(18, 4) NOT NULL CHECK (base_quantity > 0),
    unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    discount_rate NUMERIC(8, 4) NOT NULL DEFAULT 0 CHECK (discount_rate >= 0 AND discount_rate <= 100),
    discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    line_total NUMERIC(18, 4) NOT NULL CHECK (line_total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_so_line UNIQUE (sales_order_id, line_number)
);

-- 3. SALES RESERVATIONS (Traceable allocations reserving physical stock for approved sales orders)
CREATE TABLE IF NOT EXISTS sales_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
    sales_order_line_id UUID NOT NULL REFERENCES sales_order_lines(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES inventory_batches(id) ON DELETE RESTRICT,
    uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    reserved_quantity NUMERIC(18, 4) NOT NULL CHECK (reserved_quantity > 0),
    fulfilled_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
    released_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FULFILLED', 'RELEASED', 'CANCELLED')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_reservation_quantities CHECK (fulfilled_quantity + released_quantity <= reserved_quantity)
);

-- 4. SALES DELIVERIES / GOODS DELIVERY NOTES (Physical fulfillment to customer)
CREATE TABLE IF NOT EXISTS sales_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    delivery_number VARCHAR(64) NOT NULL,
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    delivery_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_delivery_company_number UNIQUE (company_id, delivery_number)
);

-- 5. SALES DELIVERY LINES (Itemized shipment lines)
CREATE TABLE IF NOT EXISTS sales_delivery_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES sales_deliveries(id) ON DELETE CASCADE,
    sales_order_line_id UUID REFERENCES sales_order_lines(id) ON DELETE RESTRICT,
    line_number SMALLINT NOT NULL CHECK (line_number > 0),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    delivered_quantity NUMERIC(18, 4) NOT NULL CHECK (delivered_quantity > 0),
    conversion_factor NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (conversion_factor > 0),
    base_quantity NUMERIC(18, 4) NOT NULL CHECK (base_quantity > 0),
    is_reserved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_delivery_line UNIQUE (delivery_id, line_number)
);

-- 6. SALES DELIVERY BATCH ALLOCATIONS (Batch/Lot level fulfillment breakdown)
CREATE TABLE IF NOT EXISTS sales_delivery_batch_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_line_id UUID NOT NULL REFERENCES sales_delivery_lines(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. EXTEND STOCK LEDGER CHECK CONSTRAINT FOR SALES MOVEMENT TYPES
DO $$
BEGIN
    ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_movement_type_check;
    ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_movement_type_check 
        CHECK (movement_type IN (
            'PURCHASE_RECEIPT',
            'QC_RELEASE',
            'QC_RESTRICTION',
            'PURCHASE_RETURN',
            'SALES_DELIVERY',
            'SALES_RESERVATION',
            'SALES_RESERVATION_RELEASE',
            'SALES_DELIVERY_REVERSAL',
            'REVERSAL'
        ));
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;

-- 8. INDEXES FOR PERFORMANCE, TENANT ISOLATION & AUDIT
CREATE INDEX IF NOT EXISTS idx_so_company ON sales_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_so_customer ON sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_so_status ON sales_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_so_lines_so ON sales_order_lines(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_so_lines_item ON sales_order_lines(item_id);

CREATE INDEX IF NOT EXISTS idx_reservations_company ON sales_reservations(company_id);
CREATE INDEX IF NOT EXISTS idx_reservations_so ON sales_reservations(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_item ON sales_reservations(company_id, warehouse_id, item_id, status);

CREATE INDEX IF NOT EXISTS idx_deliveries_company ON sales_deliveries(company_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_so ON sales_deliveries(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_customer ON sales_deliveries(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_lines_delivery ON sales_delivery_lines(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_lines_so_line ON sales_delivery_lines(sales_order_line_id);
CREATE INDEX IF NOT EXISTS idx_delivery_batches_line ON sales_delivery_batch_allocations(delivery_line_id);
