# ERP Project Constitution & Governing Principles

**Status**: Active / Foundational  
**Author**: Lead Software Architect  
**Scope**: Multi-Company, Multi-Branch, Multi-Warehouse ERP System

---

## 1. Core Mission & Non-Negotiable Directives

This project is a long-term, production-grade, multi-company Enterprise Resource Planning (ERP) platform developed through strict, incremental, AI-assisted engineering.

### Inviolable Rules of Engagement
1. **Incremental Progression Only**: Never attempt to build the entire ERP at once. Every phase delivers verified, production-ready increments.
2. **Zero Disposable Prototypes**: All code written must meet production standards: strongly typed, validated, tested, transactionally safe, and documented.
3. **Additive Architecture & Preservation**: Existing functionality must never be broken, rewritten, or discarded because a new feature is requested. Extend the existing architecture through modular abstractions and interfaces.
4. **Inspect Before Modifying**: Prior to any modification, inspect existing structures, interfaces, business rules, and schemas.
5. **No Silent Changes**: Never silently remove functionality, alter database constraints, or mutate existing business rules.
6. **Conflict Stop Rule**: If a new requirement conflicts with existing domain rules or structural constraints, stop immediately, formulate the exact conflict, and request confirmation before proceeding.
7. **No Unconfirmed Business Rule Assumptions (Backlog Isolation)**: Do not invent or assume accounting standards, tax formulas, inventory valuation methods (FIFO/LIFO/Weighted Average), credit limits, or payroll calculations. When a requirement is not confirmed, mark it as `UNCONFIRMED REQUIREMENT` and place it in the backlog.
8. **Segregation of Duties (SoD / Four-Eyes Principle)**: The creator of a business transaction must never be permitted to approve or post that same document when an independent approval workflow is defined.
9. **Layer Separation**:
   - **Presentation Layer**: UI components solely handle rendering, local form state, and interaction.
   - **Domain / Service Layer**: Business logic, workflow state machines, and rule validations reside in reusable server-side services.
   - **Data Access / Repository Layer**: Database queries, joins, mutations, and transaction management are isolated from services and UI.
10. **Atomic Transactions & Unit of Work**: All business operations affecting multiple records must execute inside ACID database transactions managed via a Unit of Work abstraction.
11. **Organizational Scoping**: Every tenant record must carry organizational ownership (`company_id`, and optional `branch_id`/`warehouse_id`). Server-side authorization must strictly enforce multi-tenant and branch boundaries.
12. **Immutable Ledger & Audit Trail**: Posted transactions are immutable. Corrections occur via reversal entries, credit notes, or explicit adjustment records. Audit logs are protected against mutation.

---

## 2. Backward Compatibility & Evolution Protocol

When adding new capabilities or altering interfaces:
- **Contract Versioning**: REST/RPC endpoints must maintain API versioning (e.g., `/api/v1/...`).
- **Database Schema Expansion**: Schema alterations must be additive (nullable new columns, additive lookup tables, or migration-managed default values). Columns must never be dropped without a deprecation lifecycle.
- **Service Interfaces**: Core service methods must accept options objects with extensible schemas rather than rigid positional parameters.

---

## 3. Organizational Hierarchy & Data Boundaries

```
[System Platform / Tenant Group]
       │
       └── [Company (Legal Entity / Fiscal Unit)]
             │
             ├── [Branch (Operating Office / Tax Registration)]
             │     │
             │     └── [Warehouse / Storage Location]
             │
             ├── [Chart of Accounts & Fiscal Calendars]
             └── [Org Roles, Employees, Cost Centers]
```

- **Company Level**: Defines the legal entity, base currency, fiscal calendar, chart of accounts, tax configurations, and consolidation rules.
- **Branch Level**: Operational division with localized series numbering, physical address, and departmental cost centers.
- **Warehouse Level**: Physical or logical inventory holding areas with distinct bins, quarantine zones, and picking locations.

---

## 4. Development & Verification Lifecycle

Every feature increment must proceed through four distinct gates:
1. **Architectural Review & Schema Definition**: Confirm domain models and organization boundary alignment.
2. **Domain Service & Unit Verification**: Implement strongly typed domain logic with validation and automated unit test fixtures.
3. **Data Access & Transaction Integration**: Implement transactional repositories and audit event emission.
4. **Presentation & Operational Controls**: Build accessible, high-contrast, responsive UI screens strictly wired to domain contracts.
