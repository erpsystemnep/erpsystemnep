# Database Design & Schema Evolution Strategy

**Status**: Active / Foundational Schema  
**Database Engine**: PostgreSQL 15+ compatible relational database  
**Isolation Strategy**: Multi-Tenant Discriminator Column (`company_id`) with Foreign Key Referential Integrity

---

## 1. Foundational Entity Relationship Overview

```
                      ┌────────────────────────┐
                      │       COMPANIES        │
                      │ ────────────────────── │
                      │ id (PK, UUID)          │
                      │ code (UNIQUE)          │
                      │ legal_name             │
                      │ base_currency          │
                      │ fiscal_year_start      │
                      │ tax_id                 │
                      │ is_active              │
                      │ created_at             │
                      └───────────┬────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │ 1:N                    │ 1:N                    │ 1:N
┌────────▼───────────────┐ ┌──────▼────────────────┐ ┌─────▼──────────────────┐
│        BRANCHES        │ │      WAREHOUSES       │ │     USERS & ROLES      │
│ ────────────────────── │ │ ───────────────────── │ │ ────────────────────── │
│ id (PK, UUID)          │ │ id (PK, UUID)         │ │ user_id (PK, UUID)     │
│ company_id (FK)        │ │ company_id (FK)       │ │ email (UNIQUE)         │
│ code (UNIQUE in comp)  │ │ branch_id (FK, opt)   │ │ full_name              │
│ name                   │ │ code (UNIQUE in comp) │ │ is_superadmin          │
│ is_head_office         │ │ name                  │ │ is_active              │
│ timezone               │ │ is_quarantine         │ └──────────┬─────────────┘
└────────────────────────┘ └───────────────────────┘            │ 1:N
                                                                │
                                                   ┌────────────▼─────────────┐
                                                   │   USER_COMPANY_ROLES     │
                                                   │ ──────────────────────── │
                                                   │ id (PK, UUID)            │
                                                   │ user_id (FK)             │
                                                   │ company_id (FK)          │
                                                   │ branch_id (FK, nullable) │
                                                   │ role_id (FK)             │
                                                   └──────────────────────────┘
```

---

## 2. Core Foundational Tables DDL Specification

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. COMPANIES (Legal and accounting entity root)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 2. BRANCHES (Operating units, tax points, and sales offices)
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 3. WAREHOUSES (Physical or virtual storage facilities, company-level or branch-level)
CREATE TYPE warehouse_type_enum AS ENUM (
    'PHYSICAL', 
    'CENTRAL_DC', 
    'QUARANTINE', 
    'IN_TRANSIT', 
    'WIP_PRODUCTION', 
    'VIRTUAL_CONSIGNMENT'
);

CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 3b. NUMBERING_SERIES (Centralized Document Sequence Engine)
CREATE TYPE numbering_reset_freq_enum AS ENUM ('NEVER', 'ANNUAL', 'MONTHLY');

CREATE TABLE numbering_series (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 4. USERS (Global identity table)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. ROLES (Company-specific or system default roles)
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE, -- NULL represents system-wide template role
    code VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_role_company_code UNIQUE (company_id, code)
);

-- 6. PERMISSIONS (Atomic system permissions)
CREATE TABLE permissions (
    id VARCHAR(64) PRIMARY KEY, -- e.g., 'sales.order.create', 'gl.journal.post'
    module VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. ROLE_PERMISSIONS
CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(64) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 8. USER_COMPANY_ROLES (Multi-tenant user assignment)
CREATE TABLE user_company_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE, -- NULL means access to all branches in company
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_company_branch_role UNIQUE (user_id, company_id, branch_id, role_id)
);

-- 9. AUDIT_LOGS (Immutable event store for all data mutations)
CREATE TYPE audit_action_enum AS ENUM (
    'CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT', 
    'APPROVE', 'REJECT', 'POST', 'CANCEL', 'REVERSE', 
    'LOGIN', 'LOGOUT', 'PERMISSION_CHANGE'
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action audit_action_enum NOT NULL,
    module VARCHAR(64) NOT NULL, -- e.g., 'org', 'auth', 'inventory', 'accounting'
    entity_name VARCHAR(64) NOT NULL, -- e.g., 'company', 'warehouse', 'sales_order'
    entity_id VARCHAR(64) NOT NULL,
    reason_code VARCHAR(64),
    reason_text TEXT,
    changes JSONB, -- { old: {...}, new: {...} }
    ip_address VARCHAR(45),
    user_agent TEXT,
    session_id VARCHAR(128),
    correlation_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Immutability Protection Trigger
CREATE OR REPLACE FUNCTION protect_audit_logs_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are strictly immutable and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION protect_audit_logs_immutability();

CREATE INDEX idx_audit_company_module ON audit_logs (company_id, module, entity_name, entity_id);
CREATE INDEX idx_audit_created_at ON audit_logs (created_at DESC);
```

---

## 3. Database Migration & Schema Evolution Strategy

1. **Numbered, Forward-Only Migrations**:
   - Each migration file resides in `/src/server/db/migrations/` using timestamp/numeric prefixes (e.g., `0001_foundation_schema.sql`, `0002_add_customer_master.sql`).
   - Every migration must be idempotent or managed via a `schema_migrations` tracking table.
2. **Zero Destructive Alterations**:
   - Never run `DROP COLUMN` or `ALTER COLUMN ... DROP NOT NULL` without a two-step release lifecycle.
   - When renaming fields, introduce the new column, dual-write during transition, backfill data, and deprecate the old column in subsequent cycles.
3. **Foreign Key Integrity**:
   - `ON DELETE RESTRICT` is the standard for operational master data (companies, branches, GL accounts, inventory items) to protect referential history.
   - `ON DELETE CASCADE` is only used for dependent item lines (e.g., `order_items` belonging to an unposted `order`).
