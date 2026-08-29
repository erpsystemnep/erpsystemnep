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

---

## ADR 007: Security Context Extraction, Development Mock Harness, and Production Safe Fail-Closed Boundary

### Status
Accepted

### Context
During Increment 0.3, authorization middleware and security contexts were introduced prior to the implementation of cryptographic JWT authentication (Increment 0.4) and the database-backed RBAC resolution engine (Increment 0.5). If client HTTP request headers (such as `x-permissions` or `x-is-superadmin`) are naively accepted in production, an untrusted client could spoof elevated privileges.

### Decision
1. **Strictly isolate development simulation from production security**:
   - In `development` and `test` environments (`NODE_ENV !== 'production'`), request headers are accepted strictly as an explicit development mock simulation harness to allow unit testing and local service execution.
   - In `production` (`NODE_ENV === 'production'`), client-supplied privilege headers (`x-permissions`, `x-is-superadmin`, and arbitrary `x-user-id`) are completely ignored. Unauthenticated requests receive an anonymous security context with zero permissions (`effectivePermissions: []`), failing closed at all permission gates.
2. **Clarify Context Selectors vs Authorization Proof**:
   - Client headers `x-company-id` and `x-branch-id` are captured as *unverified requested context selectors* (`req.requestedTenantContext`). In Increment 0.5, the RBAC engine will verify these requested selectors against database `user_company_roles` before establishing an authorized tenant context.
3. **Preserve pre-auth Increment 0.3 contracts**:
   - Zero changes to domain service layer or database schemas; permission gates (`requirePermission`, `requireActiveCompany`) remain identical in interface so Increment 0.4 (Auth) and Increment 0.5 (RBAC) can plug in seamlessly.

### Consequences
- **Positive**: Eliminates privilege spoofing vulnerabilities in production, maintains complete testability and developer ergonomic testing in pre-auth development mode, and establishes a clear contract for Increments 0.4 and 0.5.
- **Negative**: Endpoints cannot be invoked in production mode without the upcoming Increment 0.4 authentication middleware (intended design).

---

## ADR 008: Authentication & Identity Core Architecture

### Status
Accepted

### Context
Phase 0 Increment 0.4 requires establishing a production-ready authentication and identity verification subsystem. The subsystem must securely hash passwords, verify credentials without user enumeration, issue authenticated JWT tokens, maintain safe user provisioning, protect current-user profile retrieval (`/me`), and uphold strict separation between Authentication (identity) and Authorization/RBAC (permissions and tenant boundaries).

### Decision
1. **Password Security**:
   - Utilize standard Bcrypt password hashing with configurable salt rounds (default: 10/12).
   - Ensure plaintext passwords and password hashes are never persisted in plaintext, never logged, never returned in API payloads, never embedded in JWT claims, and never leaked to the client.
2. **Generic Authentication Failures**:
   - Both invalid passwords and non-existent emails return identical generic 401 `AppError.unauthorized('Invalid email or password')` responses to prevent user enumeration attacks. Deactivated accounts fail with the identical message.
3. **Stateless Identity JWT Tokens**:
   - Token payloads contain only verified user identity claims (`userId`, `email`).
   - Dynamic permissions, company/branch authorizations, and `isSuperadmin` privileges are explicitly excluded from the JWT token to maintain the architectural boundary between Identity (Increment 0.4) and RBAC resolution (Increment 0.5).
4. **Middleware Security & Separation**:
   - `extractSecurityContext` verifies incoming `Authorization: Bearer <token>` headers using `TokenService`.
   - `requireAuth` guard ensures endpoints require a verified identity before accessing protected resources.
   - Development mock header simulation remains isolated to non-production environments when no Bearer token is supplied.

### Consequences
- **Positive**: Zero trust in client privilege headers in production, robust anti-tampering protection via cryptographic signatures, prevention of user enumeration, and a clean interface for Increment 0.5 RBAC membership resolution.
- **Negative**: Stateless JWT tokens cannot be individually invalidated server-side without a secondary revocation list (acceptable for current phase).

---

## ADR 009: Database-Backed RBAC Engine & Scoped Effective Permission Resolution

### Status
Accepted

### Context
Phase 0 Increment 0.5 requires establishing the database-backed Role-Based Access Control (RBAC) subsystem. The engine must support the 11 approved action primitives, resolve permissions across company-wide and branch-scoped assignments, enforce strict multi-tenant boundary isolation, handle superadministrator authority securely, and integrate seamlessly with security middleware without placing dynamic permissions into JWT claims.

### Decision
1. **11 Approved Action Primitives**:
   - Enforce the approved standard verbs: `view`, `create`, `edit`, `delete`, `export`, `approve`, `reject`, `post`, `cancel`, `reverse`, `print`.
   - All permission identifiers strictly follow `<module>.<resource>.<action>` format.
2. **Permission Catalogue & Standard System Roles**:
   - Seed foundational standard permissions across `org`, `auth`, `audit`, and `system` domains.
   - Seed 5 approved system roles: `SUPERADMIN`, `COMPANY_ADMIN`, `BRANCH_MANAGER`, `WAREHOUSE_OPERATOR`, `AUDITOR_READONLY`.
3. **Database-Backed Scoped Permission Resolution**:
   - Authentication (JWT) proves user identity only.
   - Dynamic permissions are resolved server-side from PostgreSQL via `RbacService.resolveEffectivePermissions(userId, companyId, branchId)`.
   - **Resolution Rules**:
     - *User Active Check*: Inactive or non-existent users immediately resolve to zero permissions (fail closed).
     - *Superadmin Authority*: If `users.is_superadmin` is true in PostgreSQL, resolves `['*']` unconditionally. Client claims of superadmin are never trusted.
     - *Company-Wide Scoping*: Role assignments with `branch_id IS NULL` apply to the company and all child branches.
     - *Branch Scoping*: Role assignments with a specific `branch_id` apply strictly when that branch is requested; they do not apply company-wide or to sibling branches.
     - *Tenant Isolation*: Cross-company context requests yield empty permissions.
     - *Role Aggregation*: Permissions from all valid matching roles are combined and deduplicated.
4. **Middleware Security Integration**:
   - `extractSecurityContext` verifies the Bearer token identity, evaluates requested tenant context (`x-company-id`, `x-branch-id`), and queries `RbacService` to populate `req.securityContext.effectivePermissions`.
   - `requirePermission(permKey)` checks the caller's server-resolved permissions against the required key or wildcard `*`.

### Consequences
- **Positive**: Strict tenant isolation, complete elimination of client privilege tampering in production, no stale permission claims in JWTs, and deterministic scoping inheritance.
- **Negative**: Database lookup required during token verification (mitigated by indexed query patterns).



