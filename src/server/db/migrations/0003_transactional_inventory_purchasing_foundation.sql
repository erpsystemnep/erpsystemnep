-- ====================================================================
-- MIGRATION: 0003_transactional_inventory_purchasing_foundation.sql
-- DESCRIPTION: Establishes Transactional Purchasing, Inventory Batch/Lot,
--              Quality Control (QC), Purchase Returns, and Immutable Stock Ledger.
-- ====================================================================

-- 1. PURCHASE ORDERS (Commercial procurement agreement with suppliers)
CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    po_number VARCHAR(64) NOT NULL,
    supplier_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_delivery_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'CLOSED')),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_total NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
    grand_total NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_po_company_number UNIQUE (company_id, po_number)
);

-- 2. PURCHASE ORDER LINES (Itemized order quantities and rates)
CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number SMALLINT NOT NULL CHECK (line_number > 0),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    ordered_quantity NUMERIC(18, 4) NOT NULL CHECK (ordered_quantity > 0),
    conversion_factor NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (conversion_factor > 0),
    base_quantity NUMERIC(18, 4) NOT NULL CHECK (base_quantity > 0),
    unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    line_total NUMERIC(18, 4) NOT NULL CHECK (line_total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_po_line UNIQUE (purchase_order_id, line_number)
);

-- 3. INVENTORY BATCHES (Lot and batch level identification, supplier source, and cost layer)
CREATE TABLE IF NOT EXISTS inventory_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    batch_number VARCHAR(64) NOT NULL,
    supplier_id UUID REFERENCES business_partners(id) ON DELETE RESTRICT,
    supplier_batch_number VARCHAR(64),
    manufacturing_date DATE,
    expiry_date DATE,
    unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_batch_company_item_number UNIQUE (company_id, item_id, batch_number)
);

-- 4. PURCHASE RECEIPTS (Goods Receipt Note / Material Inward Receipt)
CREATE TABLE IF NOT EXISTS purchase_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    receipt_number VARCHAR(64) NOT NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    supplier_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    receipt_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED')),
    supplier_delivery_note VARCHAR(64),
    qc_required BOOLEAN NOT NULL DEFAULT TRUE,
    total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_receipt_company_number UNIQUE (company_id, receipt_number)
);

-- 5. PURCHASE RECEIPT LINES (Line items received against PO or independent)
CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
    line_number SMALLINT NOT NULL CHECK (line_number > 0),
    po_line_id UUID REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    received_quantity NUMERIC(18, 4) NOT NULL CHECK (received_quantity > 0),
    conversion_factor NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (conversion_factor > 0),
    base_quantity NUMERIC(18, 4) NOT NULL CHECK (base_quantity > 0),
    unit_rate NUMERIC(18, 4) NOT NULL CHECK (unit_rate >= 0),
    total_amount NUMERIC(18, 4) NOT NULL CHECK (total_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_receipt_line UNIQUE (receipt_id, line_number)
);

-- 6. PURCHASE RECEIPT BATCH ALLOCATIONS (Multi-batch split per receipt line)
CREATE TABLE IF NOT EXISTS purchase_receipt_batch_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(18, 4) NOT NULL CHECK (unit_cost >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_receipt_line_batch UNIQUE (receipt_line_id, batch_id)
);

-- 7. QC INSPECTIONS (Quality Control inspection of received material)
CREATE TABLE IF NOT EXISTS qc_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    inspection_number VARCHAR(64) NOT NULL,
    receipt_id UUID NOT NULL REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
    inspection_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED')),
    inspector_id UUID REFERENCES users(id) ON DELETE SET NULL,
    remarks TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_qc_company_number UNIQUE (company_id, inspection_number)
);

-- 8. QC INSPECTION LINES (Batch-level inspection breakdown into Passed and Failed)
CREATE TABLE IF NOT EXISTS qc_inspection_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES qc_inspections(id) ON DELETE CASCADE,
    receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    received_quantity NUMERIC(18, 4) NOT NULL CHECK (received_quantity > 0),
    passed_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (passed_quantity >= 0),
    failed_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (failed_quantity >= 0),
    rejection_reason VARCHAR(255),
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_qc_quantities CHECK (passed_quantity + failed_quantity <= received_quantity)
);

-- 9. PURCHASE RETURNS (Return of QC Failed / Rejected materials to supplier)
CREATE TABLE IF NOT EXISTS purchase_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    return_number VARCHAR(64) NOT NULL,
    supplier_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    receipt_id UUID REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
    qc_inspection_id UUID REFERENCES qc_inspections(id) ON DELETE RESTRICT,
    return_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED')),
    reason TEXT,
    total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_return_company_number UNIQUE (company_id, return_number)
);

-- 10. PURCHASE RETURN LINES (Item and batch level return quantities)
CREATE TABLE IF NOT EXISTS purchase_return_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    qc_line_id UUID REFERENCES qc_inspection_lines(id) ON DELETE RESTRICT,
    receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    return_quantity NUMERIC(18, 4) NOT NULL CHECK (return_quantity > 0),
    unit_rate NUMERIC(18, 4) NOT NULL CHECK (unit_rate >= 0),
    total_amount NUMERIC(18, 4) NOT NULL CHECK (total_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 11. STOCK LEDGER (Authoritative, immutable transaction log of all inventory movements)
CREATE TABLE IF NOT EXISTS stock_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES inventory_batches(id) ON DELETE RESTRICT,
    uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 4) NOT NULL, -- Positive for stock increase, negative for decrease
    stock_status VARCHAR(32) NOT NULL CHECK (stock_status IN ('AVAILABLE', 'QC_PENDING', 'QC_FAILED', 'RESERVED')),
    movement_type VARCHAR(64) NOT NULL CHECK (movement_type IN ('PURCHASE_RECEIPT', 'QC_RELEASE', 'QC_RESTRICTION', 'PURCHASE_RETURN', 'REVERSAL')),
    unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    total_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
    source_document_type VARCHAR(64) NOT NULL, -- 'PURCHASE_RECEIPT', 'QC_INSPECTION', 'PURCHASE_RETURN'
    source_document_id UUID NOT NULL,
    source_document_line_id UUID,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 12. IMMUTABILITY TRIGGER ON STOCK LEDGER
CREATE OR REPLACE FUNCTION prevent_stock_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Stock ledger records are strictly immutable and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_ledger_immutable ON stock_ledger;
CREATE TRIGGER trg_stock_ledger_immutable
BEFORE UPDATE OR DELETE ON stock_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_stock_ledger_mutation();

-- 13. INDEXES FOR PERFORMANCE, MULTI-TENANT ISOLATION AND LEDGER RECONCILIATION
CREATE INDEX IF NOT EXISTS idx_po_company ON purchase_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_item ON purchase_order_lines(item_id);

CREATE INDEX IF NOT EXISTS idx_batches_company_item ON inventory_batches(company_id, item_id);
CREATE INDEX IF NOT EXISTS idx_batches_number ON inventory_batches(batch_number);

CREATE INDEX IF NOT EXISTS idx_receipts_company ON purchase_receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_receipts_po ON purchase_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_supplier ON purchase_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_receipt_lines_receipt ON purchase_receipt_lines(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_lines_po_line ON purchase_receipt_lines(po_line_id);
CREATE INDEX IF NOT EXISTS idx_receipt_lines_item ON purchase_receipt_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_receipt_batches_line ON purchase_receipt_batch_allocations(receipt_line_id);

CREATE INDEX IF NOT EXISTS idx_qc_company ON qc_inspections(company_id);
CREATE INDEX IF NOT EXISTS idx_qc_receipt ON qc_inspections(receipt_id);
CREATE INDEX IF NOT EXISTS idx_qc_lines_inspection ON qc_inspection_lines(inspection_id);
CREATE INDEX IF NOT EXISTS idx_qc_lines_receipt_line ON qc_inspection_lines(receipt_line_id);
CREATE INDEX IF NOT EXISTS idx_qc_lines_batch ON qc_inspection_lines(batch_id);

CREATE INDEX IF NOT EXISTS idx_returns_company ON purchase_returns(company_id);
CREATE INDEX IF NOT EXISTS idx_returns_supplier ON purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_returns_receipt ON purchase_returns(receipt_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_return ON purchase_return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_qc_line ON purchase_return_lines(qc_line_id);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_company ON stock_ledger(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_balance ON stock_ledger(company_id, warehouse_id, item_id, batch_id, stock_status);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_source ON stock_ledger(source_document_type, source_document_id);
