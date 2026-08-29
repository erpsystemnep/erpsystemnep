# ERP Module Registry & Dependency Graph

**Status**: Active / Foundational Blueprint  
**Phase**: Phase 0 — Core Architecture & System Foundation

---

## 1. Modular Hierarchy & Dependency Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LEVEL 0: SYSTEM & SECURITY FOUNDATION                    │
│  [CORE-ORG] Multi-Company, Branch & Warehouse Structure                     │
│  [CORE-AUTH] Identity, Role-Based Access Control & Scoping                  │
│  [CORE-AUDIT] Immutable Event & Compliance Audit Trail                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    LEVEL 1: MASTER DATA & NUMBERING ENGINES                 │
│  [MD-PARTIES] Business Partners (Customers, Vendors, Subcontractors)        │
│  [MD-ITEMS] Item Master, Units of Measure (UoM), Lot/Serial Categories      │
│  [MD-SERIES] Configurable Document Numbering & Series Engine                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    LEVEL 2: OPERATIONAL WORKFLOW MODULES                    │
│  [OPS-INV] Inventory Ledger, Stock Movements, Transfers & Valuations        │
│  [OPS-PROC] Procurement, Purchase Orders, Goods Receipt (GRN) & Vendor Bills│
│  [OPS-SALES] Sales Quotations, Sales Orders, Deliveries & Invoicing         │
│  [OPS-MFG] Bills of Materials (BOM), Work Orders, WIP, Batch Genealogy      │
│  [OPS-QC] Quality Inspection, Release Holds & Quarantine Management         │
│  [OPS-HR] Employee Registry, Departments, Positions & Payroll Engine        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    LEVEL 3: FINANCIAL ACCOUNTING & GOVERNANCE               │
│  [FIN-GL] General Ledger, Chart of Accounts, Journal Entries                │
│  [FIN-AR-AP] Subledgers: Accounts Receivable & Accounts Payable             │
│  [FIN-TAX] Tax Rules, Multi-Jurisdiction VAT/GST Engines                    │
│  [FIN-REP] Financial Reporting: Balance Sheet, P&L, Trial Balance, Consol.  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Registry Specification

| Module Code | Module Name | Primary Entities | Direct Dependencies | Current Status |
| :--- | :--- | :--- | :--- | :--- |
| **`CORE-ORG`** | Organization Management | Companies, Branches, Warehouses | *None (Root)* | **Active / Foundation** |
| **`CORE-AUTH`** | Identity & Access Control | Users, Roles, Permissions, UserRoles | `CORE-ORG` | **Active / Foundation** |
| **`CORE-AUDIT`**| Audit & Event Logging | AuditLogs, SecurityEvents | `CORE-AUTH`, `CORE-ORG` | **Active / Foundation** |
| **`MD-PARTIES`**| Business Partners Master | Partners, Addresses, Contacts, TaxProfiles | `CORE-ORG` | Backlog (Phase 1) |
| **`MD-ITEMS`**  | Item Master & UoM | Items, Categories, UoM, ConversionRates | `CORE-ORG` | Backlog (Phase 1) |
| **`MD-SERIES`** | Document Numbering Series| DocumentTypes, SeriesDefinitions, Counters | `CORE-ORG` | Backlog (Phase 1) |
| **`OPS-INV`**   | Inventory & Stock Ledger | StockLedger, Lots, SerialNumbers, Transfers | `MD-ITEMS`, `CORE-ORG` | Backlog (Phase 2) |
| **`OPS-PROC`**  | Procurement & Purchasing | PurchaseOrders, GRN, VendorInvoices | `MD-PARTIES`, `MD-ITEMS` | Backlog (Phase 3) |
| **`OPS-SALES`** | Sales & Distribution | Quotations, SalesOrders, DeliveryNotes, Inv | `MD-PARTIES`, `MD-ITEMS` | Backlog (Phase 3) |
| **`OPS-QC`**    | Quality Control | InspectionPlans, InspectionResults, Holds | `OPS-INV`, `MD-ITEMS` | Backlog (Phase 4) |
| **`OPS-MFG`**   | Manufacturing & BOM | BOM, Routing, WorkOrders, ProductionOutput | `OPS-INV`, `MD-ITEMS` | Backlog (Phase 4) |
| **`OPS-HR`**    | HR & Payroll | Employees, Departments, PayrollCycles, Payslips| `CORE-ORG` | Backlog (Phase 5) |
| **`FIN-GL`**    | General Ledger & Chart | Accounts, FiscalPeriods, JournalEntries | `CORE-ORG` | Backlog (Phase 6) |
| **`FIN-AR-AP`** | Receivables & Payables | CustomerLedger, VendorLedger, Payments | `FIN-GL`, `OPS-SALES` | Backlog (Phase 6) |
| **`FIN-TAX`**   | Tax & Regulatory Engine | TaxCodes, TaxRules, Jurisdictions | `CORE-ORG` | Backlog (Phase 6) |
| **`FIN-REP`**   | Financial & Consolidated | TrialBalance, BalanceSheet, ConsolidatedP&L| `FIN-GL`, `FIN-AR-AP` | Backlog (Phase 7) |

---

## 3. Strict Module Integration Rules

1. **No Circular Dependencies**: Modules lower in the stack must never depend on higher-level modules. For example, `OPS-INV` must not directly call `OPS-SALES`.
2. **Event-Driven & Inversion of Control**: Cross-module side effects (such as updating the General Ledger when a Goods Receipt Note is posted) must occur through explicit domain orchestrator services or domain events, keeping operational sub-modules decoupled.
3. **No Direct Table Mutation Across Module Boundaries**: A module cannot run direct SQL updates against another module's internal state tables. All mutations pass through the owning module's public service contract.
