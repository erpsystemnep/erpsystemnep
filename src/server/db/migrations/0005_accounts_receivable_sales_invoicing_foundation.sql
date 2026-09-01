-- ====================================================================
-- MIGRATION: 0005_accounts_receivable_sales_invoicing_foundation.sql
-- DESCRIPTION: Establishes Sales Invoices, Sales Invoice Lines, and
--              Customer Receivables (AR) financial obligations.
-- ====================================================================

-- 1. SALES INVOICES (Customer Billing Document)
CREATE TABLE IF NOT EXISTS sales_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(64) NOT NULL,
    customer_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE RESTRICT,
    delivery_id UUID REFERENCES sales_deliveries(id) ON DELETE RESTRICT,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_invoice_company_number UNIQUE (company_id, invoice_number)
);

-- 2. SALES INVOICE LINES (Itemized Quantities, Pricing, Discounts, and Taxes)
CREATE TABLE IF NOT EXISTS sales_invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    sales_order_line_id UUID REFERENCES sales_order_lines(id) ON DELETE RESTRICT,
    delivery_line_id UUID REFERENCES sales_delivery_lines(id) ON DELETE RESTRICT,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_invoice_line UNIQUE (sales_invoice_id, line_number)
);

-- 3. CUSTOMER RECEIVABLES (Financial Accounts Receivable Obligation)
CREATE TABLE IF NOT EXISTS customer_receivables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    sales_invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    invoice_amount NUMERIC(18, 4) NOT NULL CHECK (invoice_amount >= 0),
    paid_amount NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    outstanding_amount NUMERIC(18, 4) NOT NULL CHECK (outstanding_amount >= 0),
    invoice_date DATE NOT NULL,
    due_date DATE,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'REVERSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_receivable_company_invoice UNIQUE (company_id, sales_invoice_id),
    CONSTRAINT chk_receivable_balance CHECK (outstanding_amount = invoice_amount - paid_amount)
);

-- 4. INDEXES FOR PERFORMANCE, MULTI-TENANT ISOLATION & AR REPORTING
CREATE INDEX IF NOT EXISTS idx_invoices_company ON sales_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_so ON sales_invoices(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_delivery ON sales_invoices(delivery_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON sales_invoices(company_id, status);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON sales_invoice_lines(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_so_line ON sales_invoice_lines(sales_order_line_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_delivery_line ON sales_invoice_lines(delivery_line_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_item ON sales_invoice_lines(item_id);

CREATE INDEX IF NOT EXISTS idx_receivables_company ON customer_receivables(company_id);
CREATE INDEX IF NOT EXISTS idx_receivables_customer ON customer_receivables(company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_receivables_status ON customer_receivables(company_id, status);
CREATE INDEX IF NOT EXISTS idx_receivables_invoice ON customer_receivables(sales_invoice_id);
