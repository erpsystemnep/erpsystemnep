# ERP Phased Requirement Backlog & Implementation Roadmap

**Status**: Active / Phased Strategy  
**Execution Rule**: Strictly sequential, incremental, and non-destructive.

---

## Roadmap Overview

```
[Phase 0: Foundation] ──► [Phase 1: Master Data] ──► [Phase 2: Inventory]
                                                            │
┌───────────────────────────────────────────────────────────┘
▼
[Phase 3: Sales & Procurement] ──► [Phase 4: QC & Manufacturing]
                                             │
┌────────────────────────────────────────────┘
▼
[Phase 5: HR & Payroll] ──► [Phase 6: Financial Accounting] ──► [Phase 7: Consolidation]
```

---

## Phase Breakdown

### Phase 0: System Foundation & Governance (Current Phase)
- [x] Project Constitution & Architectural Directives
- [x] Multi-Company / Multi-Branch / Multi-Warehouse Schema Specifications
- [x] Granular RBAC Permission Matrix & Scope Rules
- [x] Document Workflow State Machine & Reversal Protocol
- [x] Audit Logging Framework & Decision Logs
- [x] Standard Directory Structure & Layered Scaffolding
- [ ] Database Migration & Seed Fixtures Runner
- [ ] Core Organization Management Services (Company/Branch/Warehouse CRUD + Tests)
- [ ] Authentication, Session & Context Switching Services

### Phase 1: Master Data & Numbering Engines
- [ ] Document Numbering Series Engine (Custom prefix, suffix, sequence counter by branch/company)
- [ ] Business Partners Registry (Customers, Vendors with multi-currency, credit limits, payment terms)
- [ ] Item Master & Unit of Measure (UoM) Conversion Matrix (Lot/Serial tracking flags, default accounts)
- [ ] Price Lists & Discount Matrices

### Phase 2: Inventory Core & Stock Ledger
- [ ] Immutable Stock Ledger Engine (FIFO / Moving Average cost tracking)
- [ ] Warehouse Locations & Bin Management
- [ ] Stock Adjustments, Opening Balances & Revaluations
- [ ] Inter-Warehouse Transfers with In-Transit Status

### Phase 3: Procurement & Sales Cycles
- [ ] Purchase Orders -> Goods Receipt Note (GRN) -> Vendor Bill
- [ ] Sales Quotations -> Sales Orders -> Delivery Notes -> Customer Invoices
- [ ] Three-Way Matching (PO vs. GRN vs. Vendor Bill)
- [ ] Customer Returns & Credit Notes / Vendor Debit Notes

### Phase 4: Quality Control & Manufacturing
- [ ] Quality Control Inspection Plans, Samples & Quarantine Holds
- [ ] Bill of Materials (BOM) & Routing Operations
- [ ] Work Orders, Material Consumption & WIP Tracking
- [ ] Finished Goods Output & Multi-Level Batch Genealogy

### Phase 5: HR & Payroll Subsystem
- [ ] Employee Directory, Department & Position Hierarchy
- [ ] Attendance, Leave & Shift Management
- [ ] Configurable Earnings/Deduction Salary Structures
- [ ] Payroll Processing & Automated Payslip Generation

### Phase 6: Financial Accounting & Subledgers
- [ ] Multi-Company Chart of Accounts & Fiscal Period Calendars
- [ ] General Ledger Double-Entry Engine & Journal Vouchers
- [ ] Accounts Receivable & Accounts Payable Subledgers with Payment Reconciliation
- [ ] Multi-Jurisdiction Tax & VAT Engine

### Phase 7: Financial Reporting & Consolidation
- [ ] Financial Statements: Trial Balance, Balance Sheet, Income Statement (P&L), Cash Flow
- [ ] Multi-Branch Cost Center Profitability
- [ ] Multi-Company Financial Consolidation with Inter-Company Elimination Entries
- [ ] Audit & Compliance Reporting
