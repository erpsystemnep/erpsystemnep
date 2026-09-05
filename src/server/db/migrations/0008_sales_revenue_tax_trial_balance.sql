-- ====================================================================
-- MIGRATION: 0008_sales_revenue_tax_trial_balance.sql
-- DESCRIPTION: Establishes Authoritative Tax Subledger (Tax Transactions),
--              Tax Reporting & Reconciliation Support,
--              Sales Invoice General Ledger Linkage,
--              and Line-Level Revenue Account Allocation.
-- ====================================================================

-- 1. TAX TRANSACTIONS (Authoritative Tax Subledger Register)
CREATE TABLE IF NOT EXISTS tax_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    tax_type VARCHAR(32) NOT NULL CHECK (tax_type IN ('INPUT_TAX', 'OUTPUT_TAX')),
    source_type VARCHAR(64) NOT NULL CHECK (source_type IN ('SALES_INVOICE', 'PURCHASE_INVOICE')),
    source_id UUID NOT NULL,
    source_line_id UUID,
    tax_code VARCHAR(32),
    tax_rate NUMERIC(8, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    taxable_amount NUMERIC(18, 4) NOT NULL CHECK (taxable_amount >= 0),
    tax_amount NUMERIC(18, 4) NOT NULL CHECK (tax_amount >= 0),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    base_taxable_amount NUMERIC(18, 4) NOT NULL CHECK (base_taxable_amount >= 0),
    base_tax_amount NUMERIC(18, 4) NOT NULL CHECK (base_tax_amount >= 0),
    accounting_date DATE NOT NULL,
    journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL,
    journal_line_id UUID REFERENCES accounting_journal_lines(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED', 'CANCELLED')),
    reversal_journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. INDEXES FOR PERFORMANCE, MULTI-TENANCY & TAX REPORTING / RECONCILIATION
CREATE INDEX IF NOT EXISTS idx_tax_tx_company ON tax_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_tax_tx_type ON tax_transactions(company_id, tax_type);
CREATE INDEX IF NOT EXISTS idx_tax_tx_source ON tax_transactions(company_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_tax_tx_date ON tax_transactions(company_id, accounting_date);
CREATE INDEX IF NOT EXISTS idx_tax_tx_status ON tax_transactions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_tax_tx_journal ON tax_transactions(journal_id);

-- 3. EXTEND SALES INVOICES & LINES FOR REVENUE GL JOURNAL & REVERSAL AUDITING
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS revenue_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_journal ON sales_invoices(journal_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_rev_acc ON sales_invoice_lines(revenue_account_id);
