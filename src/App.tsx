import React, { useState } from 'react';
import { 
  Building2, 
  GitFork, 
  Warehouse as WarehouseIcon, 
  ShieldCheck, 
  FileText, 
  Layers, 
  Database, 
  History, 
  CheckCircle2, 
  BookOpen,
  ArrowRight,
  Server,
  Lock,
  Cpu,
  Workflow
} from 'lucide-react';

interface DocItem {
  id: string;
  title: string;
  filename: string;
  category: 'Foundation' | 'Governance' | 'Technical' | 'Roadmap';
  summary: string;
  content: string;
}

const DOCUMENTATION_REGISTRY: DocItem[] = [
  {
    id: 'constitution',
    title: 'Project Constitution & Principles',
    filename: 'PROJECT-CONSTITUTION.md',
    category: 'Governance',
    summary: '28 Non-negotiable architectural laws, incremental directives, zero disposable prototypes, and conflict-stop rules.',
    content: `# ERP Project Constitution & Governing Principles
- **Incremental Progression Only**: Never attempt to build the entire ERP at once.
- **Zero Disposable Prototypes**: All code written meets production standards: strongly typed, validated, tested, and documented.
- **Additive Architecture**: Never break or rewrite existing modules when adding features.
- **Conflict Stop Rule**: If a requirement conflicts with existing domain rules, STOP and explain before proceeding.
- **No Unconfirmed Business Rule Assumptions**: Unknown accounting, tax, valuation, and payroll rules must be configurable.
- **Layer Separation**: Strict boundaries between UI, Domain Services, and Data Repositories.
- **Atomic Transactions**: All multi-record mutations execute in ACID transactions.
- **Organizational Scoping**: Every operational record carries company, branch, or warehouse context.
- **Immutable Ledger**: Posted transactions are immutable; adjustments happen via reversals and credit notes.`
  },
  {
    id: 'architecture',
    title: 'System Architecture Specification',
    filename: 'SYSTEM-ARCHITECTURE.md',
    category: 'Technical',
    summary: 'Layered modular monolith blueprint, context propagation, Zod validation, and directory layout.',
    content: `# System Architecture Specification
- **Architecture Pattern**: Layered Modular Monolith with Clean Architecture principles.
- **Runtime**: Full-Stack TypeScript (Node.js/Express Backend + React 19 / Tailwind Frontend).
- **Database Engine**: PostgreSQL relational schema with discriminator-based multi-tenancy.
- **Application Directory Topology**:
  - \`/docs/\`: Architectural, business rule, and schema documentation.
  - \`/src/server/\`: Domain services, transactional repositories, Express API routes, and DB migrations.
  - \`/src/client/\`: Context providers, UI design system, and screen components.
  - \`/src/shared/\`: Shared types, enums, validation schemas, and permission constants.`
  },
  {
    id: 'database',
    title: 'Database Design & Schema Evolution',
    filename: 'DATABASE-DESIGN.md',
    category: 'Technical',
    summary: 'DDL for Companies, Branches, Warehouses, Users, Roles, Permissions, and Immutable Audit Logs.',
    content: `# Database Design & Schema Evolution Strategy
- **Core Entities**:
  - \`companies\`: Legal entity root, base currency, tax identifier, fiscal calendar.
  - \`branches\`: Operating units, regional tax registrations, local timezones.
  - \`warehouses\`: Storage locations, quarantine zones, in-transit storage.
  - \`users\`, \`roles\`, \`permissions\`, \`user_company_roles\`: Granular RBAC.
  - \`audit_logs\`: Immutable event store recording every mutation with old/new state diffs.
- **Migration Strategy**: Numbered, forward-only migrations (\`0001_initial.sql\`) with zero destructive alterations.`
  },
  {
    id: 'modules',
    title: 'Module Registry & Dependency Graph',
    filename: 'MODULE-REGISTRY.md',
    category: 'Foundation',
    summary: 'Phased module topology from Level 0 (System Foundation) up to Level 3 (Financial Accounting).',
    content: `# ERP Module Registry & Dependency Graph
- **Level 0 (Foundation)**: CORE-ORG, CORE-AUTH, CORE-AUDIT (Current focus).
- **Level 1 (Master Data)**: MD-PARTIES (Partners), MD-ITEMS (Items & UoM), MD-SERIES (Numbering Engine).
- **Level 2 (Operations)**: OPS-INV (Inventory), OPS-PROC (Procurement), OPS-SALES (Sales), OPS-QC, OPS-MFG, OPS-HR.
- **Level 3 (Finance)**: FIN-GL (General Ledger), FIN-AR-AP (Subledgers), FIN-TAX, FIN-REP (Consolidation).
- **Integration Rule**: No circular dependencies. Cross-module orchestration via domain events.`
  },
  {
    id: 'permissions',
    title: 'Permission Matrix & Access Control',
    filename: 'PERMISSION-MATRIX.md',
    category: 'Governance',
    summary: 'Granular RBAC model (<module>.<resource>.<action>) with server-side tenant and branch enforcement.',
    content: `# Permission Matrix & Access Control Policy
- **Standard Format**: \`<module>.<resource>.<action>\` (e.g. \`org.company.manage\`, \`inv.transfer.post\`).
- **Standard Roles**:
  - \`SUPERADMIN\`: Global platform oversight.
  - \`COMPANY_ADMIN\`: Full administrative control within a company.
  - \`BRANCH_MANAGER\`: Operations management for a designated branch.
  - \`WAREHOUSE_OPERATOR\`: Physical stock movements and picking.
  - \`AUDITOR_READONLY\`: Strict read-only inspection access.
- **Server Enforcement**: Validated on every API call via JWT bearer and X-Company-Id headers.`
  },
  {
    id: 'workflows',
    title: 'Document & Workflow Registry',
    filename: 'WORKFLOW-REGISTRY.md',
    category: 'Governance',
    summary: 'Unified state machine (Draft -> Pending -> Approved -> Posted) and transaction correction protocol.',
    content: `# Document & Transaction Workflow Registry
- **State Lifecycle**:
  - \`DRAFT\`: Full line/header edits allowed. Zero ledger impact.
  - \`PENDING_APPROVAL\`: Locked for review by authorized approvers.
  - \`APPROVED\`: Verified for execution.
  - \`POSTED\`: IMMUTABLE. Real-time General Ledger and Inventory updates.
  - \`REVERSED\`: Cancelled via an explicit compensating reversal document.`
  },
  {
    id: 'business-rules',
    title: 'Business Rules & Invariant Register',
    filename: 'BUSINESS-RULES.md',
    category: 'Governance',
    summary: 'Multi-company isolation, configurable policy flags (Valuation, Negative Stock), and validation invariants.',
    content: `# Domain Business Rules & Invariant Register
- **Invariants**:
  - Double-Entry Balance: \`SUM(Debits) == SUM(Credits)\` on every financial post.
  - Header-to-Line mathematical reconciliation on all operational documents.
  - Closed fiscal period locking.
- **Configurable Flags (Pending User Confirmation)**:
  - Inventory Valuation: FIFO vs. Weighted Average vs. Standard Cost.
  - Negative Inventory: Strict Disallow vs. Allow with Warning.
  - Revenue Recognition: On Delivery vs. On Invoice vs. On Payment.`
  },
  {
    id: 'accounting-rules',
    title: 'Accounting Rules & Financial Subsystem',
    filename: 'ACCOUNTING-RULES.md',
    category: 'Governance',
    summary: 'Double-entry bookkeeping, subledger decoupling, period locking, and multi-currency handling.',
    content: `# Accounting Rules & Financial Subsystem Blueprint
- **Control Accounts**: Trade Receivables and Inventory Control accounts mutate ONLY via system subledger postings.
- **Standard Posting Workflows**:
  - Goods Receipt (GRN): \`Debit Inventory\`, \`Credit GRIR Clearing\`.
  - Vendor Bill: \`Debit GRIR Clearing\`, \`Debit Tax Recoverable\`, \`Credit Accounts Payable\`.
  - Fulfillment: \`Debit COGS\`, \`Credit Inventory\`.
  - Sales Invoice: \`Debit Accounts Receivable\`, \`Credit Revenue\`, \`Credit Tax Payable\`.`
  },
  {
    id: 'decisions',
    title: 'Architecture Decision Log (ADRs)',
    filename: 'DECISION-LOG.md',
    category: 'Technical',
    summary: 'ADR 001 (Modular Monolith), ADR 002 (Immutable Audit Ledger), ADR 003 (Server-Side Authorization).',
    content: `# Architecture Decision Log (ADR)
- **ADR 001**: Incremental Multi-Company Monolithic Modular Architecture (PostgreSQL + Express + React).
- **ADR 002**: Immutable Audit Ledger and Document State Machine for enterprise compliance.
- **ADR 003**: Server-Side Authorization and Tenant Isolation using discriminator columns and request headers.`
  },
  {
    id: 'changelog',
    title: 'System Changelog & Version History',
    filename: 'CHANGELOG.md',
    category: 'Roadmap',
    summary: 'Semantic version tracking starting with [0.1.0] foundational architecture.',
    content: `# ERP System Changelog (SemVer)
- **v0.1.0 (Current)**:
  - Created 12 foundational governance, architecture, and schema specifications in \`/docs/\`.
  - Established shared domain types for Companies, Branches, Warehouses, Users, and Roles.
  - Established architectural inspection console and foundation registry.`
  },
  {
    id: 'test-plan',
    title: 'Automated Testing & QA Plan',
    filename: 'TEST-PLAN.md',
    category: 'Technical',
    summary: 'Testing pyramid (60% Domain Unit, 30% Integration/Tenant Isolation, 10% E2E).',
    content: `# Automated Testing & Quality Assurance Plan
- **Domain Service Unit Tests (60%)**: In-memory verification of domain logic, state transitions, and tax math.
- **Multi-Tenant Isolation Integration Tests (30%)**: Cross-tenant data boundary penetration testing.
- **Transaction Rollback Tests**: Verification of atomic rollback during partial mutation failures.
- **Audit Trail Coverage**: 100% test coverage for audit log emission on mutations.`
  },
  {
    id: 'roadmap',
    title: 'Phased Requirement Backlog',
    filename: 'REQUIREMENT-BACKLOG.md',
    category: 'Roadmap',
    summary: '8-Phase incremental roadmap from Foundation (Phase 0) to Consolidated Reporting (Phase 7).',
    content: `# Phased Requirement Backlog
- **Phase 0**: System Foundation & Governance (In Progress).
- **Phase 1**: Master Data & Numbering Engines (Partners, Items, Series).
- **Phase 2**: Inventory Core & Stock Ledger.
- **Phase 3**: Procurement & Sales Cycles.
- **Phase 4**: Quality Control & Manufacturing BOM.
- **Phase 5**: HR & Payroll.
- **Phase 6**: Financial Accounting & Subledgers.
- **Phase 7**: Financial Reporting & Multi-Company Consolidation.`
  }
];

export default function App() {
  const [selectedDocId, setSelectedDocId] = useState<string>('constitution');
  const [activeTab, setActiveTab] = useState<'docs' | 'architecture' | 'database' | 'roadmap'>('architecture');

  const selectedDoc = DOCUMENTATION_REGISTRY.find(d => d.id === selectedDocId) || DOCUMENTATION_REGISTRY[0];

  return (
    <div id="erp-app-root" className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Header */}
      <header id="erp-header" className="bg-slate-900 text-white border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-lg text-white shadow-sm">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Multi-Company ERP Core</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                  Phase 0: Foundation
                </span>
              </div>
              <p className="text-xs text-slate-400">Enterprise Architectural Foundation & Governance Registry</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              id="tab-architecture-btn"
              onClick={() => setActiveTab('architecture')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'architecture' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" /> Architecture Plan
              </span>
            </button>
            <button
              id="tab-database-btn"
              onClick={() => setActiveTab('database')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'database' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" /> Database & Scoping
              </span>
            </button>
            <button
              id="tab-docs-btn"
              onClick={() => setActiveTab('docs')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'docs' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" /> Governance Docs (12)
              </span>
            </button>
            <button
              id="tab-roadmap-btn"
              onClick={() => setActiveTab('roadmap')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'roadmap' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Workflow className="w-3.5 h-3.5" /> Phased Roadmap
              </span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {/* TAB 1: ARCHITECTURE OVERVIEW */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            {/* Core Principle Banner */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Foundational Architectural Directives Confirmed</h2>
                  <p className="text-sm text-slate-600 mt-1">
                    In compliance with lead architect directives: no premature mock screens (CRM, Sales, Accounting) have been generated. 
                    The foundational documentation, entity schemas, multi-tenant scoping mechanisms, and directory topologies are established.
                  </p>
                </div>
              </div>
            </div>

            {/* 3 Pillar Architectural Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-indigo-600 font-semibold text-sm mb-3">
                    <Server className="w-4 h-4" /> Layered Monolith Strategy
                  </div>
                  <h3 className="text-base font-medium text-slate-900 mb-2">Separation of Concerns</h3>
                  <p className="text-xs text-slate-600 leading-relaxed mb-4">
                    Strict boundary isolation across Presentation (React), Transport/API (Express routes with Zod validation), 
                    Domain Services (business rules and state machines), and Data Repositories (ACID transactions).
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 font-mono">
                  /src/server/services + /src/client
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-blue-600 font-semibold text-sm mb-3">
                    <Building2 className="w-4 h-4" /> Multi-Company Scoping
                  </div>
                  <h3 className="text-base font-medium text-slate-900 mb-2">Hierarchical Tenancy</h3>
                  <p className="text-xs text-slate-600 leading-relaxed mb-4">
                    Company (legal root, base currency, chart of accounts) → Branch (operating tax units) → Warehouse (physical/quarantine storage). 
                    Server-side authorization guarantees total isolation.
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 font-mono">
                  company_id / branch_id / warehouse_id
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-amber-600 font-semibold text-sm mb-3">
                    <History className="w-4 h-4" /> Audit & Immutability
                  </div>
                  <h3 className="text-base font-medium text-slate-900 mb-2">Compliance Ledger</h3>
                  <p className="text-xs text-slate-600 leading-relaxed mb-4">
                    Posted transactions are immutable. No direct UPDATE on finalized financial documents. 
                    Every mutation emits structured audit entries with old/new state snapshots.
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 font-mono">
                  audit_logs + State Machine Engine
                </div>
              </div>
            </div>

            {/* Application Directory Structure Preview */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Application Directory Scaffolding</h3>
              <div className="bg-slate-900 text-slate-200 rounded-lg p-4 font-mono text-xs overflow-x-auto leading-relaxed">
{`├── docs/                      # 12 Foundation & Governance Markdown Documents
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
│   ├── client/                # React 19 Frontend (Contexts, Custom Hooks, UI components)
│   ├── server/                # Express Backend
│   │   ├── api/               # API route controllers with Zod request validation
│   │   ├── middleware/        # JWT Auth, Organization Scoping, Error Handling
│   │   ├── services/          # Domain Services & Transaction State Machines
│   │   ├── repositories/      # SQL Data Access & Query Repositories
│   │   └── db/migrations/     # Numbered, forward-only PostgreSQL migrations
│   ├── shared/                # Shared TypeScript types, permission constants, Zod schemas
│   ├── App.tsx                # Architectural Registry Explorer
│   └── main.tsx               # Client entry point
├── server.ts                  # Backend server entry point
├── metadata.json              # Platform metadata
└── package.json`}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: DATABASE & SCOPING */}
        {activeTab === 'database' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">Organizational Tenancy Architecture</h2>
              <p className="text-sm text-slate-600 mb-6">
                The database design establishes strict referential integrity across the three organizational tiers, ensuring all future operational transactions are context-aware.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm mb-2">
                    <Building2 className="w-4 h-4 text-indigo-600" /> 1. Companies Entity
                  </div>
                  <ul className="text-xs text-slate-600 space-y-1.5 font-mono">
                    <li>- id: UUID (PK)</li>
                    <li>- code: VARCHAR(32) UNIQUE</li>
                    <li>- legal_name: VARCHAR(255)</li>
                    <li>- base_currency: VARCHAR(3)</li>
                    <li>- fiscal_year_start: SMALLINT</li>
                    <li>- tax_identifier: VARCHAR(64)</li>
                  </ul>
                </div>

                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm mb-2">
                    <GitFork className="w-4 h-4 text-blue-600" /> 2. Branches Entity
                  </div>
                  <ul className="text-xs text-slate-600 space-y-1.5 font-mono">
                    <li>- id: UUID (PK)</li>
                    <li>- company_id: UUID (FK)</li>
                    <li>- code: VARCHAR(32)</li>
                    <li>- name: VARCHAR(255)</li>
                    <li>- is_head_office: BOOLEAN</li>
                    <li>- timezone: VARCHAR(64)</li>
                  </ul>
                </div>

                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm mb-2">
                    <WarehouseIcon className="w-4 h-4 text-emerald-600" /> 3. Warehouses Entity
                  </div>
                  <ul className="text-xs text-slate-600 space-y-1.5 font-mono">
                    <li>- id: UUID (PK)</li>
                    <li>- company_id: UUID (FK)</li>
                    <li>- branch_id: UUID (FK, opt)</li>
                    <li>- code: VARCHAR(32)</li>
                    <li>- is_quarantine: BOOLEAN</li>
                    <li>- is_transit: BOOLEAN</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Immutable Audit Log Architecture */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-base mb-2">
                <Lock className="w-5 h-5 text-indigo-600" /> Immutable Audit Trail Schema (\`audit_logs\`)
              </div>
              <p className="text-xs text-slate-600 mb-4">
                Every state modification captures user context, IP address, correlation ID, and JSONB old/new snapshots for compliance.
              </p>
              <div className="bg-slate-900 text-emerald-400 rounded-lg p-4 font-mono text-xs overflow-x-auto">
{`CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL, -- CREATE, UPDATE, DELETE, POST, REVERSE
    entity_name VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    changes JSONB, -- { old: {...}, new: {...} }
    ip_address VARCHAR(45),
    user_agent TEXT,
    correlation_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);`}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DOCUMENTATION BROWSER */}
        {activeTab === 'docs' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left Sidebar Document List */}
            <div className="md:col-span-4 bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 px-2 mb-3">
                Foundational Documents ({DOCUMENTATION_REGISTRY.length})
              </h2>
              <div className="space-y-1">
                {DOCUMENTATION_REGISTRY.map((doc) => (
                  <button
                    key={doc.id}
                    id={`doc-btn-${doc.id}`}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-all flex flex-col gap-1 ${
                      selectedDocId === doc.id
                        ? 'bg-indigo-50 border border-indigo-200 text-indigo-950 font-medium'
                        : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{doc.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                        doc.category === 'Governance' ? 'bg-amber-100 text-amber-800' :
                        doc.category === 'Technical' ? 'bg-blue-100 text-blue-800' :
                        doc.category === 'Roadmap' ? 'bg-purple-100 text-purple-800' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {doc.category}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">{doc.filename}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Right Preview Panel */}
            <div className="md:col-span-8 bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <div className="border-b border-slate-200 pb-4 mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{selectedDoc.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                      /docs/{selectedDoc.filename}
                    </span>
                    <span className="text-xs text-slate-500">· Ready for phased implementation</span>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 mb-4">
                <span className="font-semibold text-slate-900">Summary: </span>{selectedDoc.summary}
              </div>

              <div className="bg-slate-900 text-slate-100 rounded-lg p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-[480px]">
                {selectedDoc.content}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: ROADMAP */}
        {activeTab === 'roadmap' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Incremental Phase Execution Roadmap</h2>
              <p className="text-sm text-slate-600 mb-6">
                Following the non-negotiable principle of incremental progression, each module builds additively upon verified foundational contracts.
              </p>

              <div className="space-y-4">
                <div className="border-2 border-indigo-500 bg-indigo-50/50 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-indigo-600 text-white">Phase 0</span>
                      <h3 className="font-semibold text-slate-900">System Foundation & Governance (Active Phase)</h3>
                    </div>
                    <span className="text-xs font-medium text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-full">
                      Documentation & Schema Defined
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed mb-3">
                    Establish 12 governance docs, multi-tenant schemas (Company/Branch/Warehouse/User/Role/Audit), 
                    service and repository interfaces, and state machine definitions.
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px] font-mono text-indigo-900">
                    <span className="bg-white px-2 py-1 rounded border border-indigo-200">CORE-ORG</span>
                    <span className="bg-white px-2 py-1 rounded border border-indigo-200">CORE-AUTH</span>
                    <span className="bg-white px-2 py-1 rounded border border-indigo-200">CORE-AUDIT</span>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl p-5 opacity-80 hover:opacity-100 transition-opacity">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-800">Phase 1</span>
                      <h3 className="font-semibold text-slate-900">Master Data & Numbering Engines</h3>
                    </div>
                    <span className="text-xs font-medium text-slate-500">Pending Phase 0 Completion</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Document numbering engine, Business Partners registry (Customers, Vendors), Item Master, Units of Measure (UoM) conversion matrix.
                  </p>
                </div>

                <div className="border border-slate-200 rounded-xl p-5 opacity-80 hover:opacity-100 transition-opacity">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-800">Phase 2</span>
                      <h3 className="font-semibold text-slate-900">Inventory Core & Stock Ledger</h3>
                    </div>
                    <span className="text-xs font-medium text-slate-500">Backlog</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Immutable stock ledger, batch/serial tracking, warehouse transfers with in-transit status, and valuation engines.
                  </p>
                </div>

                <div className="border border-slate-200 rounded-xl p-5 opacity-80 hover:opacity-100 transition-opacity">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-800">Phase 3 - 7</span>
                      <h3 className="font-semibold text-slate-900">Procurement, Sales, QC/BOM, HR/Payroll & Financial Accounting</h3>
                    </div>
                    <span className="text-xs font-medium text-slate-500">Long-Term Incremental Pipeline</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Full document cycle with 3-way matching, double-entry General Ledger, multi-currency posting, and consolidated corporate reporting.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer id="erp-footer" className="bg-white border-t border-slate-200 px-6 py-4 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Architecture & Documentation Baseline Complete</span>
          </div>
          <div className="font-mono">
            All 18 architectural directives codified in /docs/
          </div>
        </div>
      </footer>
    </div>
  );
}
