# ERP System Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] - 2026-08-29

### Added
- **Organization Structure Repositories**:
  - `CompanyRepository` (`src/server/modules/org/repositories/company.repository.ts`): Company lookup by ID/code, active listing, creation, and updating.
  - `BranchRepository` (`src/server/modules/org/repositories/branch.repository.ts`): Branch lookup, company-scoped listing, head office handling, and address parameters.
  - `WarehouseRepository` (`src/server/modules/org/repositories/warehouse.repository.ts`): Warehouse lookup, company-scoped queries, warehouse types (`PHYSICAL`, `CENTRAL_DC`, `QUARANTINE`, etc.), and support for company-level DCs where `branch_id = null`.
- **Organization Domain Service (`OrgService`) (`src/server/modules/org/services/org.service.ts`)**:
  - Encapsulates organizational business logic, parent company verification, duplicate code detection, and cross-tenant isolation enforcement (`assertCompanyAccess`).
- **Security & Authorization Middleware (`src/server/middleware/auth.ts`)**:
  - `extractSecurityContext`: Extracts identity, company scope, branch scope, and permission sets from request headers.
  - `requirePermission`: Enforces atomic permission checks (e.g., `org.company.view`, `org.branch.create`).
  - `requireActiveCompany`: Enforces presence of active company context for tenant-scoped operations.
- **Organization REST API Router (`src/server/modules/org/routes/org.routes.ts`)**:
  - Mounted at `/api/org`:
    - `GET /api/org/companies`, `GET /api/org/companies/:id`, `POST /api/org/companies`, `PATCH /api/org/companies/:id`
    - `GET /api/org/branches`, `GET /api/org/branches/:id`, `POST /api/org/branches`, `PATCH /api/org/branches/:id`
    - `GET /api/org/warehouses`, `GET /api/org/warehouses/:id`, `POST /api/org/warehouses`, `PATCH /api/org/warehouses/:id`
- **Application Factory & Server Integration (`src/server/app.ts`, `server.ts`)**:
  - Modular Express app factory with clean route registration and global error handling via `AppError`.
- **Automated Test Suite (`tests/unit/increment_0_3.test.ts`)**:
  - 13 unit tests covering company creation/updating, multi-tenant isolation boundaries, branch scoping, company-wide vs branch warehouses, cross-company branch reference rejection, and REST API mounting.

---

## [0.2.0] - 2026-08-29

### Added
- **Database Driver & Pooling (`src/server/db/connection.ts`)**:
  - Centralized connection pooling with lazy initialization from validated configuration.
  - Parameterized query interface wrapped in operational `AppError`.
  - Transaction executor `withTransaction` supporting nested callbacks, auto-commit, and safe rollback.
  - Database health check diagnostic function.
- **Forward-Only Migration Engine (`src/server/db/migrator.ts`)**:
  - Deterministic migration loader and SHA-256 checksum calculator.
  - `schema_migrations` tracking table recording migration ID, filename, checksum, and applied timestamp.
  - Strict immutability protection throwing `IMMUTABILITY_VIOLATION` on checksum tampering.
  - Migration status inspector (`getMigrationStatus`).
- **Initial Foundation Migration (`0001_initial_foundation.sql`)**:
  - Core tables: `companies`, `branches`, `warehouses`, `numbering_series`, `users`, `roles`, `permissions`, `role_permissions`, `user_company_roles`, and `audit_logs`.
  - Enums: `warehouse_type_enum`, `numbering_reset_freq_enum`, `audit_action_enum`.
  - Immutability trigger (`trg_audit_logs_immutable`) on `audit_logs`.
  - Performance indexes on company and tenant foreign keys.
- **Health Check API Endpoint**:
  - `GET /api/health` in `server.ts` checking DB connectivity and reporting service status.
- **Automated Test Suite (`tests/unit/increment_0_2.test.ts`)**:
  - 12 comprehensive unit tests covering migration loading, checksum normalization, schema constraints, idempotency, checksum tampering rejection, transaction rollback, and health diagnostics.

---

## [0.1.0] - 2026-08-29

### Added
- **Foundational Architecture Documentation**:
  - `PROJECT-CONSTITUTION.md`: Governing principles, anti-corruption layers, backward compatibility mandates.
  - `SYSTEM-ARCHITECTURE.md`: Layered modular monolith topology, context propagation, and directory structures.
  - `DATABASE-DESIGN.md`: Relational DDL specifications for companies, branches, warehouses, users, roles, permissions, and immutable audit logs.
  - `MODULE-REGISTRY.md`: Multi-tier module dependency graph and registry.
  - `PERMISSION-MATRIX.md`: Granular RBAC specifications with hierarchical company/branch scoping.
  - `WORKFLOW-REGISTRY.md`: Unified document lifecycle state machine and reversal protocols.
  - `BUSINESS-RULES.md`: Invariants, double-entry guarantees, and configurable policy definitions.
  - `ACCOUNTING-RULES.md`: Double-entry rules, posting patterns (GRN, billing, fulfillment), and currency standards.
  - `DECISION-LOG.md`: ADR 001 (Monolithic Architecture), ADR 002 (Audit Ledger), ADR 003 (Server Authorization).
  - `TEST-PLAN.md`: Quality gates, unit test patterns, and transactional test isolation.
  - `REQUIREMENT-BACKLOG.md`: Phased roadmap from Foundation (Phase 0) to Consolidated Reporting (Phase 7).
- **Core Architecture & Scaffolding**:
  - Standardized application folder structure for services, repositories, middleware, and domain models.
  - System architecture registry dashboard for foundational inspection and governance.
