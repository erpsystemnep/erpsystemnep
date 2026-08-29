# System Architecture Specification

**Status**: Active / Baseline Blueprint  
**Architecture Pattern**: Layered Modular Monolith / Clean Architecture with Domain Services  
**Target Runtime**: Full-Stack TypeScript (Node.js/Express Backend + React/Tailwind Frontend) on PostgreSQL

---

## 1. High-Level Architectural Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT LAYER (React 19)                         │
│  - Organization Context Switcher (Company / Branch / Warehouse)             │
│  - Domain Views (Foundation, Master Data, Governance, Audit, Modules)       │
│  - Typed API Clients & Reactive Query Hooks                                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS / JSON (Bearer JWT Auth)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                           APPLICATION / API GATEWAY                         │
│  - Authentication Middleware (JWT verification, User identity extraction)   │
│  - Org Scoping & RBAC Middleware (Company/Branch/Warehouse context guards)  │
│  - Request Validation Layer (Zod Schemas)                                   │
│  - Audit Context Hydration (User ID, IP, User-Agent, Correlation ID)        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                             DOMAIN SERVICE LAYER                            │
│  - Organization & Tenant Service (Companies, Branches, Warehouses)          │
│  - Identity & Access Service (Users, Roles, Permission Engine)              │
│  - Workflow State Machine Service (Draft -> Pending -> Approved -> Posted)  │
│  - Audit & Event Logging Engine                                             │
│  - [Future Plug-ins: Procurement, Inventory, Sales, Accounting, BOM, etc.]  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                        DATA ACCESS & REPOSITORY LAYER                       │
│  - Transaction Manager (ACID Units of Work)                                 │
│  - Query Builders & Repositories (Parameterized, SQL-injection safe)        │
│  - Multi-Tenant Row-Level & Scoped Filters                                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    PERSISTENCE LAYER (PostgreSQL Engine)                    │
│  - Core Tables with company_id, branch_id foreign keys                      │
│  - Immutable Audit Log Table (audit_logs)                                   │
│  - Strict Foreign Key Referential Integrity & Unique Multi-Col Constraints  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer Responsibilities & Isolation Boundaries

### A. Presentation Layer (`/src/client` / `/src/components`)
- Pure UI components, form controls, data tables, filter toolbars, and modal dialogs.
- No direct database access or business formula calculations (e.g., tax calculation, inventory allocation logic).
- Handles user notifications, optimism state, and context selection.

### B. Transport & Controller Layer (`/src/server/api`)
- Express route definitions and handlers.
- Parameter extraction, type coercion, and Zod schema validation.
- Transforms domain exceptions into standard RFC 7807 problem details or clean JSON error envelopes.

### C. Domain & Business Service Layer (`/src/server/services`)
- The central brain of the ERP.
- Enforces organizational rules, status transitions, authorization policies, and invariant checks.
- Interacts with multiple repositories within transactional scopes.
- Emits structured audit records for all significant mutations.

### D. Repository & Data Access Layer (`/src/server/repositories`)
- Encapsulates SQL queries and data mapping.
- Ensures all SELECT, UPDATE, and DELETE operations implicitly scope by `company_id` and optional `branch_id`.
- Never allows raw string concatenation for query building.

---

## 3. Organizational Multi-Tenancy Architecture

The ERP uses **Shared Database, Row-Level Partitioning with Discriminator Columns**:
- Every business table contains `company_id UUID NOT NULL REFERENCES companies(id)`.
- Operational transaction tables contain `branch_id UUID REFERENCES branches(id)`.
- Physical movement tables contain `warehouse_id UUID REFERENCES warehouses(id)`.

### Context Propagation
Each incoming API request carries:
1. `Authorization: Bearer <token>` (identifying the user).
2. `X-Company-Id: <uuid>` (active operating company context).
3. `X-Branch-Id: <uuid>` (active operating branch context - optional or mandatory depending on module).

The server-side security middleware validates:
- Does the user possess a valid membership in `company_id`?
- Does the user have assigned roles with required permissions for the given resource within that company/branch?

---

## 4. Application Directory Structure

```
/
├── docs/                      # Architectural, business, and schema governance documents
│   ├── PROJECT-CONSTITUTION.md
│   ├── SYSTEM-ARCHITECTURE.md
│   ├── DATABASE-DESIGN.md
│   ├── MODULE-REGISTRY.md
│   ├── PERMISSION-MATRIX.md
│   ├── WORKFLOW-REGISTRY.md
│   ├── BUSINESS-RULES.md
│   ├── ACCOUNTING-RULES.md
│   ├── DECISION-LOG.md
│   ├── CHANGELOG.md
│   ├── TEST-PLAN.md
│   └── REQUIREMENT-BACKLOG.md
├── src/
│   ├── client/                # Frontend application code
│   │   ├── components/        # Reusable UI library (buttons, tables, forms, modals)
│   │   ├── context/           # React context (AuthContext, OrgContext, Theme)
│   │   ├── hooks/             # Custom hooks for querying, permissions, and state
│   │   ├── views/             # Screen modules (System Registry, Org Architecture, Governance)
│   │   └── lib/               # Client utilities, API client, formatting helpers
│   ├── server/                # Backend application code
│   │   ├── api/               # Express routes and controllers
│   │   ├── middleware/        # Auth, org context scoping, error handlers
│   │   ├── services/          # Pure domain business services
│   │   ├── repositories/      # Database access and query abstractions
│   │   ├── db/                # Schema definitions, migrations, seed runners
│   │   │   └── migrations/    # Version-controlled SQL / TS migrations
│   │   └── types/             # Shared TypeScript schemas and interfaces
│   ├── shared/                # Shared types, Zod schemas, constants, and permission enum
│   ├── App.tsx                # Client root component
│   ├── main.tsx               # Client entry point
│   └── index.css              # Global styles & Tailwind entry
├── server.ts                  # Server entry point (Express dev & prod server)
├── metadata.json
├── package.json
└── tsconfig.json
```
