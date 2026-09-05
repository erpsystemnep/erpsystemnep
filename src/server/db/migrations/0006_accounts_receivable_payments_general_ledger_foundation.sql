-- ====================================================================
-- MIGRATION: 0006_accounts_receivable_payments_general_ledger_foundation.sql
-- DESCRIPTION: Establishes Chart of Accounts, Double-Entry Accounting
--              Journals & Lines, Customer Payments, and Receivable
--              Settlement Allocations.
-- ====================================================================

-- 1. CHART OF ACCOUNTS (Company-Scoped General Ledger Master)
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    account_code VARCHAR(32) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(32) NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    parent_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    is_group BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_account_company_code UNIQUE (company_id, account_code)
);

-- 2. ACCOUNTING JOURNALS (Authoritative General Ledger Journal Header)
CREATE TABLE IF NOT EXISTS accounting_journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    journal_number VARCHAR(64) NOT NULL,
    posting_date DATE NOT NULL DEFAULT CURRENT_DATE,
    source_document_type VARCHAR(64) NOT NULL,
    source_document_id UUID,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED', 'CANCELLED')),
    total_debit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (total_debit >= 0),
    total_credit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (total_credit >= 0),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    reversal_journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_journal_company_number UNIQUE (company_id, journal_number),
    CONSTRAINT chk_journal_balanced_when_posted CHECK (status != 'POSTED' OR total_debit = total_credit)
);

-- 3. ACCOUNTING JOURNAL LINES (Double-Entry Balanced Debit/Credit Line Records)
CREATE TABLE IF NOT EXISTS accounting_journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id UUID NOT NULL REFERENCES accounting_journals(id) ON DELETE CASCADE,
    line_number SMALLINT NOT NULL CHECK (line_number > 0),
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    partner_id UUID REFERENCES business_partners(id) ON DELETE SET NULL,
    debit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    base_debit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (base_debit >= 0),
    base_credit NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (base_credit >= 0),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_not_both_debit_credit CHECK (NOT (debit > 0 AND credit > 0)),
    CONSTRAINT chk_at_least_one_debit_credit CHECK (debit > 0 OR credit > 0),
    CONSTRAINT uq_journal_line UNIQUE (journal_id, line_number)
);

-- 4. CUSTOMER PAYMENTS (Financial Inward Settlement Header)
CREATE TABLE IF NOT EXISTS customer_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT,
    payment_number VARCHAR(64) NOT NULL,
    customer_id UUID NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.0 CHECK (exchange_rate > 0),
    base_amount NUMERIC(18, 4) NOT NULL CHECK (base_amount > 0),
    payment_method VARCHAR(32) NOT NULL DEFAULT 'BANK' CHECK (payment_method IN ('CASH', 'BANK', 'CHECK', 'CREDIT_CARD', 'OTHER')),
    deposit_account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    ar_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    reference_number VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED', 'CANCELLED')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_company_number UNIQUE (company_id, payment_number)
);

-- 5. CUSTOMER PAYMENT ALLOCATIONS (Receivable Multi-Settlement Ledger Binding)
CREATE TABLE IF NOT EXISTS customer_payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
    receivable_id UUID NOT NULL REFERENCES customer_receivables(id) ON DELETE RESTRICT,
    allocated_amount NUMERIC(18, 4) NOT NULL CHECK (allocated_amount > 0),
    allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_receivable_alloc UNIQUE (payment_id, receivable_id)
);

-- 6. INDEXES FOR PERFORMANCE, MULTI-TENANT ISOLATION & GL REPORTING
CREATE INDEX IF NOT EXISTS idx_coa_company ON chart_of_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_coa_type ON chart_of_accounts(company_id, account_type);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON chart_of_accounts(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_coa_active ON chart_of_accounts(company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_journals_company ON accounting_journals(company_id);
CREATE INDEX IF NOT EXISTS idx_journals_status ON accounting_journals(company_id, status);
CREATE INDEX IF NOT EXISTS idx_journals_posting_date ON accounting_journals(company_id, posting_date);
CREATE INDEX IF NOT EXISTS idx_journals_source ON accounting_journals(source_document_type, source_document_id);

CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON accounting_journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON accounting_journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_partner ON accounting_journal_lines(partner_id);

CREATE INDEX IF NOT EXISTS idx_payments_company ON customer_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON customer_payments(company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON customer_payments(company_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_date ON customer_payments(company_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_journal ON customer_payments(journal_id);

CREATE INDEX IF NOT EXISTS idx_allocations_payment ON customer_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_allocations_receivable ON customer_payment_allocations(receivable_id);
