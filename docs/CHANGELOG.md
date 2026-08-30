# ERP System Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.7.0] - 2026-08-30

### Added
- **Authenticated System Foundation Console (React 19 & Tailwind CSS)**:
  - **API Client Infrastructure (`src/client/api/client.ts`)**:
    - Centralized HTTP client managing Bearer JWT injection, dynamic tenant context headers (`X-Company-Id`, `X-Branch-Id`), and AppError status normalization.
    - Zero client trust: strictly omits client-supplied permission claims (`x-permissions`, `x-is-superadmin`).
  - **Authentication Context & Tenant Switcher (`src/client/context/AuthContext.tsx`)**:
    - Session lifecycle management, login/logout, profile refresh (`/me`), and active company/branch state synchronization with automatic permission re-resolution.
  - **Interactive Foundation Consoles (`src/client/components/`)**:
    - `AuthSessionView`: Live user authentication, signed Bearer JWT inspector, profile metadata, and tenant context switcher.
    - `OrgHierarchyView`: Interactive multi-tenant explorer for Companies, Operating Branches, and Physical/Virtual Warehouses.
    - `RbacMatrixView`: System role catalogue, 11 enterprise action primitives, and server-authoritative effective permission inspector.
    - `NumberingSeriesView`: Safe, non-consuming sequence preview calculator and series configuration manager.
    - `WorkflowSimulatorView`: Interactive state machine and Segregation of Duties (SoD) simulator testing transition rules, terminal states, and POSTED immutability without mutating production data.
    - `AuditTrailView`: Searchable, filterable audit ledger with JSON state diff inspector backed by PostgreSQL immutability triggers.
    - `SystemHealthView`: Real-time Supabase PostgreSQL connection status, pool latency metrics, and migration checksum verifier.
  - **Upgraded Main Layout (`src/App.tsx`)**: Responsive, accessible foundation control plane with active tenant badge indicators.
- **Automated Test Suite (`tests/unit/increment_0_7.test.ts`)**:
  - 10 unit tests validating token attachment, context propagation, error standardization, non-consuming preview math, terminal states, POSTED immutability, SoD violation detection, audit filter formatting, and 401 fail-closed handling.

---

## [0.6.0] - 2026-08-30

### Added
- **Shared Transaction Infrastructure Domain**:
  - **Numbering Series Engine** (`src/server/modules/numbering/`):
    - `NumberingSeriesRepository`: Data access layer for numbering series with optimistic/row-level lock patterns (`findForUpdate`).
    - `NumberingService`: Gapless sequence generator supporting prefix/suffix templates, zero-padding, reset frequencies (`NONE`, `ANNUAL`, `MONTHLY`), branch-specific overrides with company fallback, and multi-tenant isolation.
    - `numbering.routes.ts`: REST endpoints mounted at `/api/v1/numbering-series` and `/api/numbering-series`.
  - **Workflow & Segregation of Duties Engine** (`src/server/modules/workflow/`):
    - `SodService`: Strict creator-approver separation enforcement and approval authority verification (`validateApprovalAuthority`) checking identity, tenant isolation, branch scoping, and required RBAC permissions.
    - `StateMachineEngine`: Configurable transition matrix validator across standard document states (`DRAFT` -> `SUBMITTED` -> `APPROVED` -> `POSTED` -> `REVERSED` / `CANCELLED`). Enforces `POSTED` document immutability and terminal state restrictions.
  - **Audit Ledger & Security Dispatcher** (`src/server/modules/audit/`):
    - `AuditRepository`: Data access for audit records supporting multi-criteria tenant-scoped filtering and pagination.
    - `AuditService`: Identity-bound event dispatcher (`logCreate`, `logUpdate`, `logDelete`, `logApprove`, `logReject`, `logPost`, `logReverse`, `logCancel`) preventing tenant/user spoofing.
    - `audit.routes.ts`: REST endpoints mounted at `/api/v1/audit-logs` and `/api/audit-logs`.
- **Automated Test Suite (`tests/unit/increment_0_6.test.ts`)**:
  - 19 comprehensive unit tests covering atomic numbering generation, concurrency locking, reset periods, branch overrides, SoD creator-approver separation, approval authority validation, state machine transition validation, posted document immutability, reversal flows, terminal state handling, audit log dispatching, anti-spoofing tenant security, and an end-to-end transactional document lifecycle simulation.

---

## [0.5.0] - 2026-08-29

### Added
- **RBAC & Permission Catalogue Domain**:
  - `APPROVED_ACTION_PRIMITIVES` (`src/server/modules/auth/seed/defaultRoles.ts`): Enforced the 11 approved action verbs (`view`, `create`, `edit`, `delete`, `export`, `approve`, `reject`, `post`, `cancel`, `reverse`, `print`).
  - `STANDARD_PERMISSIONS`: Seed catalogue covering foundational enterprise domains (`org.*`, `auth.*`, `audit.*`, `system.*`).
  - `STANDARD_ROLES`: Seed definitions for 5 system roles (`SUPERADMIN`, `COMPANY_ADMIN`, `BRANCH_MANAGER`, `WAREHOUSE_OPERATOR`, `AUDITOR_READONLY`).
- **RBAC Repositories**:
  - `PermissionRepository` (`src/server/modules/auth/repositories/permission.repository.ts`): Atomic permission queries and idempotent upsert batching.
  - `RoleRepository` (`src/server/modules/auth/repositories/role.repository.ts`): Role management, permission set binding, user company/branch role assignment, and user role listing.
- **RBAC Engine & Resolution Service (`RbacService`)**:
  - `RbacService` (`src/server/modules/auth/services/rbac.service.ts`):
    - `seedDefaults`: Seeds standard system roles and permissions idempotently.
    - `assignRole`: Assigns company-wide (`branchId: null`) or branch-scoped roles with parent company constraint verification.
    - `resolveEffectivePermissions`: Deterministic effective permission resolver evaluating user active state, superadmin status, company scoping, branch scoping, role aggregation, and strict cross-tenant isolation.
- **Security Middleware Integration**:
  - `extractSecurityContext` (`src/server/middleware/auth.ts`): Integrates JWT cryptographic identity with database-backed RBAC permission resolution. Rejects client-supplied privilege tampering in production.
- **Automated Test Suite (`tests/unit/increment_0_5.test.ts`)**:
  - 17 comprehensive automated tests covering action primitives, catalogue seeding, system roles, company vs branch scoping, role combination, cross-tenant isolation, superadmin wildcard authority, and security middleware gates.

---

## [0.4.0] - 2026-08-29

### Added
- **Authentication & Identity Repositories**:
  - `UserRepository` (`src/server/modules/auth/repositories/user.repository.ts`): User persistence, email lookup, secure creation, last login timestamp recording, and safe profile mapping (excluding password hashes).
- **Core Security Services**:
  - `PasswordService` (`src/server/modules/auth/services/password.service.ts`): Bcrypt password hashing and comparison with configurable salt rounds and safe parameter handling.
  - `TokenService` (`src/server/modules/auth/services/token.service.ts`): Cryptographic JWT token signing and verification with expiration, anti-tampering verification, and explicit exclusion of dynamic authorization claims.
  - `AuthService` (`src/server/modules/auth/services/auth.service.ts`): User provisioning, credential authentication with anti-enumeration generic 401 handling, active account enforcement, current user lookup (`/me`), and logout.
- **Authentication Routes & Middleware**:
  - `createAuthRouter` (`src/server/modules/auth/routes/auth.routes.ts`): Mounted at `/api/v1/auth` and `/api/auth`:
    - `POST /api/v1/auth/login`: User login returning JWT token and safe user profile.
    - `POST /api/v1/auth/users`: User provisioning with password hashing and email uniqueness enforcement.
    - `GET /api/v1/auth/me`: Authenticated current user profile lookup.
    - `POST /api/v1/auth/logout`: Session termination.
  - `extractSecurityContext` (`src/server/middleware/auth.ts`): Bearer token parsing and identity resolution; production security fail-closed gate.
  - `requireAuth`: Middleware guard enforcing authenticated user presence.
- **Automated Test Suite (`tests/unit/increment_0_4.test.ts`)**:
  - 22 comprehensive unit and security tests covering bcrypt hashing, account invariants, login anti-enumeration, token validation and anti-tampering, `/me` profile retrieval, logout, and middleware integration.

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
