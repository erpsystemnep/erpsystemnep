# Architecture Decision Log (ADR)

**Format**: MADR (Markdown Architectural Decision Records)  
**Maintained By**: Lead Software Architect

---

## ADR 001: Incremental Multi-Company Monolithic Modular Architecture

### Status
Accepted

### Context
The ERP project requires broad capabilities spanning CRM, Procurement, Inventory, Manufacturing, HR, and Accounting across multiple independent companies, branches, and warehouses. Attempting a big-bang or microservices build introduces excessive network latency, distributed transaction complexity, and risk of architectural failure.

### Decision
We adopt a **modular layered monolith** in TypeScript/React/PostgreSQL. Multi-tenancy is implemented via discriminator columns (`company_id`, `branch_id`, `warehouse_id`) on a shared relational schema with strict server-side middleware and foreign key constraints.

### Consequences
- **Positive**: Single deployable unit, ACID transactions across modules, strong type sharing between frontend and backend, instant query performance without RPC overhead.
- **Negative**: Requires strict discipline to prevent direct database coupling across modules; enforced by modular service boundaries and code reviews.

---

## ADR 002: Immutable Audit Ledger and Document State Machine

### Status
Accepted

### Context
Enterprise compliance (SOX, IFRS, GAAP) mandates that financial and operational transactions cannot be silently updated or deleted.

### Decision
All business documents transition through a formal state machine (`DRAFT` -> `PENDING` -> `APPROVED` -> `POSTED`). Once `POSTED`, documents are locked against updates. Any changes require reversing or adjustment documents. All mutations emit structured records to `audit_logs`.

### Consequences
- **Positive**: Complete compliance, zero data loss, traceable accountability.
- **Negative**: Extra storage for audit logs and reversal records, handled with indexed log partitioning.

---

## ADR 003: Server-Side Authorization and Tenant Isolation

### Status
Accepted

### Context
Client-side permission checks are insufficient for enterprise security.

### Decision
Authorization must be enforced on every server-side API endpoint using JWT bearer tokens and `X-Company-Id`/`X-Branch-Id` headers validated against the user's role-permission matrix.

### Consequences
- **Positive**: High security, zero cross-company data leakage.
- **Negative**: Slight middleware lookup overhead, optimized with in-memory caching where appropriate.

---

## ADR 004: Shared Contract Validation and Standardized Application Error Architecture

### Status
Accepted

### Context
Building a multi-tier modular ERP requires shared, isomorphic validation rules and consistent error contracts between client UI forms, server middleware, and domain services. Inconsistent error envelopes lead to fragile client-side handling and inconsistent API responses.

### Decision
1. Use **Zod** as the single source of truth for runtime validation contracts (`src/shared/schemas/`), shared directly between React and Node.js.
2. Implement **`AppError`** (`src/shared/errors/AppError.ts`) as a standardized error class with typed error codes (including Segregation of Duties and domain invariant violations), HTTP status mappings, operational flags, and correlation tracking.
3. Centralize server configuration validation in `src/server/config.ts` using schema parsing at startup to fail fast on invalid environments.

### Consequences
- **Positive**: Single definition for validation rules, type inference (`z.infer`), predictable API error envelopes, safe fail-fast bootstrap.
- **Negative**: Adds Zod runtime validation overhead (negligible for web request payloads).

---

## ADR 005: Forward-Only Database Migrations and Low-Level Transaction Driver

### Status
Accepted

### Context
Enterprise systems require deterministic, immutable database schema evolution without runtime discrepancies across environments. Using heavy ORM auto-sync introduces risky schema drift, hidden queries, and transaction management ambiguities.

### Decision
1. Implement a lightweight PostgreSQL connection pool (`pg`) and transactional query runner (`withTransaction`) avoiding heavy ORM dependencies.
2. Adopt a **forward-only migration runner** (`src/server/db/migrator.ts`) with SHA-256 checksum verification, tracking all executions in `schema_migrations`.
3. Applied migrations are strictly immutable: modifying previously executed migration scripts throws a fatal `IMMUTABILITY_VIOLATION` error.
4. Establish the foundational multi-tenant relational schema (`0001_initial_foundation.sql`) covering companies, branches, warehouses, numbering_series, users, roles, permissions, user_company_roles, and immutable audit logs.

### Consequences
- **Positive**: Zero hidden query overhead, strict schema auditability, safe transactional migrations, guaranteed immutability of applied changes.
- **Negative**: Schema changes require manual forward SQL scripts instead of automatic ORM diffs (intentional for enterprise stability).

---

## ADR 006: Organization Structure Domain Repositories and Tenant Scoping

### Status
Accepted

### Context
Phase 0 Increment 0.3 requires establishing the operational entity hierarchy: Companies (accounting roots), Branches (operating locations), and Warehouses (physical/virtual storage facilities). Central distribution centers and company-level warehouses must be supported without mandating a branch assignment (`branch_id = null`). Cross-tenant leakage must be prevented at the domain service layer.

### Decision
1. Implement discrete repositories (`CompanyRepository`, `BranchRepository`, `WarehouseRepository`) with clean mapping between SQL snake_case columns and domain camelCase interfaces.
2. Encapsulate multi-company business invariants within `OrgService`:
   - Company codes are globally unique.
   - Branch codes are unique within a company (`(company_id, code)`).
   - Warehouse codes are unique within a company (`(company_id, code)`).
   - Warehouse `branch_id` is optional/nullable, enabling company-level Central Distribution Centers while verifying branch ownership when a branch is assigned.
3. Integrate security context assertions (`assertCompanyAccess`) and atomic permission gates (`org.company.*`, `org.branch.*`, `org.warehouse.*`) on all REST routes.

### Consequences
- **Positive**: Clean separation of concerns, strong tenant isolation, strict validation before persistence, seamless support for both company-level and branch-level warehouses.
- **Negative**: Requires passing `SecurityContext` through all service-layer entry points (designed intentionally for zero-trust authorization).


