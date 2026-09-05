-- ====================================================================
-- MIGRATION: 0007_accounts_payable_purchase_invoicing_supplier_settlement.sql
-- DESCRIPTION: Establishes Purchase Invoices (Supplier Bills), 
--              Purchase Invoice Lines (3-Way Matching),
--              Supplier Payables (AP), Supplier Payments,
--              and Payment Settlement Allocations.
-- ====================================================================

-- 1. PURCHASE INVOICES (Supplier Bills & Accounts Payable Document Header)
CREATE TABLE IF NOT EXISTS purchase_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(64) NOT NULL,
    supplier_invoice_ref VARCHAR(64),
    supplier_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    receipt_id UUID REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED', 'CANCELLED')),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_total NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
    tax_total NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
    grand_total NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reversed_at TIMESTAMPTZ,
    journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_purchase_invoice_company_number UNIQUE (company_id, invoice_number)
);

-- 2. PURCHASE INVOICE LINES (Itemized Received Material Invoicing, 3-Way Match & Expense Binding)
CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    purchase_receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id) ON DELETE RESTRICT,
    po_line_id UUID REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
    line_number SMALLINT NOT NULL CHECK (line_number > 0),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
    uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
    quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
    conversion_factor NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (conversion_factor > 0),
    base_quantity NUMERIC(18, 4) NOT NULL CHECK (base_quantity > 0),
    unit_price NUMERIC(18, 4) NOT NULL CHECK (unit_price >= 0),
    discount_rate NUMERIC(8, 4) NOT NULL DEFAULT 0 CHECK (discount_rate >= 0 AND discount_rate <= 100),
    discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    line_net NUMERIC(18, 4) NOT NULL CHECK (line_net >= 0),
    line_total NUMERIC(18, 4) NOT NULL CHECK (line_total >= 0),
    expense_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_purchase_invoice_line UNIQUE (purchase_invoice_id, line_number)
);

-- 3. SUPPLIER PAYABLES (Authoritative Accounts Payable Financial Obligations)
CREATE TABLE IF NOT EXISTS supplier_payables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    supplier_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    purchase_invoice_id UUID NOT NULL REFERENCES purchase_invoices(id) ON DELETE RESTRICT,
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    invoice_amount NUMERIC(18, 4) NOT NULL CHECK (invoice_amount >= 0),
    paid_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    outstanding_amount NUMERIC(18, 4) NOT NULL CHECK (outstanding_amount >= 0),
    invoice_date DATE NOT NULL,
    due_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'REVERSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payable_company_invoice UNIQUE (company_id, purchase_invoice_id),
    CONSTRAINT chk_payable_balance CHECK (outstanding_amount = invoice_amount - paid_amount)
);

-- 4. SUPPLIER PAYMENTS (Financial Outward Disbursement Header)
CREATE TABLE IF NOT EXISTS supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    payment_number VARCHAR(64) NOT NULL,
    supplier_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    base_amount NUMERIC(18, 4) NOT NULL CHECK (base_amount > 0),
    payment_method VARCHAR(32) NOT NULL DEFAULT 'BANK' CHECK (payment_method IN ('CASH', 'BANK', 'CHECK', 'CREDIT_CARD', 'OTHER')),
    disbursement_account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    ap_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    reference_number VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED', 'CANCELLED')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reversed_at TIMESTAMPTZ,
    journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_supplier_payment_company_number UNIQUE (company_id, payment_number)
);

-- 5. SUPPLIER PAYMENT ALLOCATIONS (Payable Multi-Settlement Ledger Binding)
CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
    payable_id UUID NOT NULL REFERENCES supplier_payables(id) ON DELETE RESTRICT,
    allocated_amount NUMERIC(18, 4) NOT NULL CHECK (allocated_amount > 0),
    allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_supplier_payment_payable_alloc UNIQUE (payment_id, payable_id)
);

-- 6. INDEXES FOR PERFORMANCE, MULTI-TENANT ISOLATION & AP REPORTING
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_company ON purchase_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_po ON purchase_invoices(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_receipt ON purchase_invoices(receipt_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_status ON purchase_invoices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(company_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_due ON purchase_invoices(company_id, due_date);

CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_invoice ON purchase_invoice_lines(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_receipt_line ON purchase_invoice_lines(purchase_receipt_line_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_po_line ON purchase_invoice_lines(po_line_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_item ON purchase_invoice_lines(item_id);

CREATE INDEX IF NOT EXISTS idx_supplier_payables_company ON supplier_payables(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payables_supplier ON supplier_payables(company_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payables_status ON supplier_payables(company_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_payables_invoice ON supplier_payables(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payables_due ON supplier_payables(company_id, due_date);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_company ON supplier_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(company_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_status ON supplier_payments(company_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON supplier_payments(company_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_journal ON supplier_payments(journal_id);

CREATE INDEX IF NOT EXISTS idx_supplier_allocations_payment ON supplier_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_supplier_allocations_payable ON supplier_payment_allocations(payable_id);
