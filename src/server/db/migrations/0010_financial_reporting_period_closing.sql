-- ====================================================================
-- MIGRATION: 0010_financial_reporting_period_closing.sql
-- DESCRIPTION: Establishes Fiscal Years, Accounting Periods,
--              Period Close/Reopen Audit Records, and Year-End Closing.
-- ====================================================================

-- 1. FISCAL YEARS
CREATE TABLE IF NOT EXISTS fiscal_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    name VARCHAR(64) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reopened_at TIMESTAMPTZ,
    reopened_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_fiscal_year_company_name UNIQUE (company_id, name),
    CONSTRAINT chk_fiscal_year_dates CHECK (start_date <= end_date)
);

-- 2. ACCOUNTING PERIODS
CREATE TABLE IF NOT EXISTS accounting_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    fiscal_year_id UUID REFERENCES fiscal_years(id) ON DELETE SET NULL,
    period_name VARCHAR(64) NOT NULL,
    period_number SMALLINT NOT NULL DEFAULT 1 CHECK (period_number BETWEEN 1 AND 13),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reopened_at TIMESTAMPTZ,
    reopened_by UUID REFERENCES users(id) ON DELETE SET NULL,
    closing_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_period_company_name UNIQUE (company_id, period_name),
    CONSTRAINT chk_period_dates CHECK (start_date <= end_date)
);

-- 3. INDEXES FOR PERFORMANCE, MULTI-TENANT ISOLATION & PERIOD LOOKUP
CREATE INDEX IF NOT EXISTS idx_fiscal_years_company ON fiscal_years(company_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_dates ON fiscal_years(company_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_company ON accounting_periods(company_id);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_dates ON accounting_periods(company_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_status ON accounting_periods(company_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_fy ON accounting_periods(fiscal_year_id);
