-- ====================================================================
-- MIGRATION: 0001_initial_foundation.sql
-- DESCRIPTION: Establishes the initial foundation schema (companies, branches,
--              warehouses, numbering_series, users, roles, permissions,
--              role_permissions, user_company_roles, and audit_logs).
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'warehouse_type_enum') THEN
        CREATE TYPE warehouse_type_enum AS ENUM (
            'PHYSICAL', 
            'CENTRAL_DC', 
            'QUARANTINE', 
            'IN_TRANSIT', 
            'WIP_PRODUCTION', 
            'VIRTUAL_CONSIGNMENT'
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'numbering_reset_freq_enum') THEN
        CREATE TYPE numbering_reset_freq_enum AS ENUM (
            'NEVER', 
            'ANNUAL', 
            'MONTHLY'
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action_enum') THEN
        CREATE TYPE audit_action_enum AS ENUM (
            'CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT', 
            'APPROVE', 'REJECT', 'POST', 'CANCEL', 'REVERSE', 
            'LOGIN', 'LOGOUT', 'PERMISSION_CHANGE'
        );
    END IF;
END $$;

-- 3. COMPANIES (Legal and accounting entity root)
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    legal_name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255),
    base_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    tax_identifier VARCHAR(64),
    fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. BRANCHES (Operating units, tax points, and sales offices)
CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
    address_line1 VARCHAR(255),
    city VARCHAR(128),
    state_province VARCHAR(128),
    postal_code VARCHAR(32),
    country_code VARCHAR(2) NOT NULL DEFAULT 'US',
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_branch_company_code UNIQUE (company_id, code)
);

-- 5. WAREHOUSES (Physical or virtual storage facilities, company-level or branch-level)
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT, -- NULL represents company-wide warehouse/DC
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    warehouse_type warehouse_type_enum NOT NULL DEFAULT 'PHYSICAL',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_warehouse_company_code UNIQUE (company_id, code)
);

-- 6. NUMBERING_SERIES (Centralized Document Sequence Engine)
CREATE TABLE IF NOT EXISTS numbering_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES branches(id) ON DELETE RESTRICT, -- NULL represents company-wide series
    document_type VARCHAR(64) NOT NULL, -- e.g., 'SALES_ORDER', 'INVOICE', 'GRN', 'JOURNAL'
    prefix VARCHAR(32) NOT NULL,
    suffix VARCHAR(32),
    min_digits SMALLINT NOT NULL DEFAULT 5,
    current_number BIGINT NOT NULL DEFAULT 0,
    reset_frequency numbering_reset_freq_enum NOT NULL DEFAULT 'NEVER',
    last_reset_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_series_company_branch_doc UNIQUE (company_id, branch_id, document_type)
);

-- 7. USERS (Global identity table)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. ROLES (Company-specific or system default roles)
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE, -- NULL represents system-wide template role
    code VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_role_company_code UNIQUE (company_id, code)
);

-- 9. PERMISSIONS (Atomic system permissions)
CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(64) PRIMARY KEY, -- e.g., 'org.company.view', 'sales.order.approve'
    module VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. ROLE_PERMISSIONS
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(64) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 11. USER_COMPANY_ROLES (Multi-tenant user assignment)
CREATE TABLE IF NOT EXISTS user_company_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE, -- NULL means access to all branches in company
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_company_branch_role UNIQUE (user_id, company_id, branch_id, role_id)
);

-- 12. AUDIT_LOGS (Immutable event store for all data mutations)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action audit_action_enum NOT NULL,
    module VARCHAR(64) NOT NULL,
    entity_name VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    reason_code VARCHAR(64),
    reason_text TEXT,
    changes JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    session_id VARCHAR(128),
    correlation_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 13. IMMUTABILITY TRIGGER FOR AUDIT LOGS
CREATE OR REPLACE FUNCTION protect_audit_logs_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are strictly immutable and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_immutable'
    ) THEN
        CREATE TRIGGER trg_audit_logs_immutable
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION protect_audit_logs_immutability();
    END IF;
END $$;

-- 14. INDEXES FOR PERFORMANCE & ISOLATION
CREATE INDEX IF NOT EXISTS idx_branches_company_id ON branches(company_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_company_id ON warehouses(company_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch_id ON warehouses(branch_id);
CREATE INDEX IF NOT EXISTS idx_user_company_roles_lookup ON user_company_roles(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_audit_company_module ON audit_logs(company_id, module, entity_name, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
