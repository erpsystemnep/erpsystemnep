import React from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { KeyRound, Shield, Check, Lock, Layers } from 'lucide-react';
import { APPROVED_ACTION_PRIMITIVES } from '../../../server/modules/auth/seed/defaultRoles.js';

interface SystemRoleDef {
  code: string;
  name: string;
  description: string;
  scope: string;
  keyPermissions: string[];
}

const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    code: 'SUPERADMIN',
    name: 'Superadministrator',
    description: 'Full, unrestricted global access across all multi-tenant companies and branches with wildcard authority.',
    scope: 'Global (All Tenants)',
    keyPermissions: ['* (Wildcard Bypass)'],
  },
  {
    code: 'COMPANY_ADMIN',
    name: 'Company Administrator',
    description: 'Full administrative control over a specific tenant company, including branches, warehouses, users, and numbering.',
    scope: 'Company-Wide',
    keyPermissions: ['org.company.*', 'org.branch.*', 'org.warehouse.*', 'auth.user.*', 'rbac.role.*', 'numbering.*'],
  },
  {
    code: 'BRANCH_MANAGER',
    name: 'Branch Manager',
    description: 'Operational manager with approval authority over branch-scoped documents (quotations, orders, movements).',
    scope: 'Branch-Scoped',
    keyPermissions: ['org.branch.view', 'sales.quotation.approve', 'sales.order.approve', 'purchase.order.approve', 'inventory.movement.approve'],
  },
  {
    code: 'WAREHOUSE_OPERATOR',
    name: 'Warehouse Operator',
    description: 'Execution authority over stock entries, goods receipts, warehouse dispatches, and inventory counts.',
    scope: 'Branch/Warehouse Scoped',
    keyPermissions: ['inventory.movement.create', 'inventory.movement.view', 'inventory.stock.view'],
  },
  {
    code: 'AUDITOR_READONLY',
    name: 'System / Compliance Auditor',
    description: 'Strictly read-only access to immutable audit logs, general ledger entries, and historical snapshots.',
    scope: 'Company or Branch',
    keyPermissions: ['audit.log.view', 'audit.log.export', 'org.company.view', 'accounting.report.view'],
  },
];

export const RbacMatrixView: React.FC = () => {
  const { user, isSuperadmin, activeCompany, activeBranch } = useAuth();

  return (
    <div className="space-y-6" id="rbac-matrix-view">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-indigo-600" />
          RBAC & Permission Inspector
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Standard enterprise role catalogue, approved action primitives, and server-authoritative effective permission resolver.
        </p>
      </div>

      {/* Active User Authority Banner */}
      <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs font-semibold text-indigo-900 uppercase tracking-wider block">
              Current Session Authority
            </span>
            <span className="text-sm font-medium text-slate-900">
              User: <span className="font-mono">{user?.email}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600 font-mono">
            Company: <strong className="text-slate-900">{activeCompany?.code || 'None'}</strong>
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-xs text-slate-600 font-mono">
            Branch: <strong className="text-slate-900">{activeBranch?.code || 'All (Company-Wide)'}</strong>
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-indigo-100 text-indigo-800">
            {isSuperadmin ? 'SUPERADMIN (*)' : 'TENANT SCOPED'}
          </span>
        </div>
      </div>

      {/* 11 Enterprise Action Primitives */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-600" />
          Approved Action Primitives (11 Enterprise Verbs)
        </h3>
        <p className="text-xs text-slate-500">
          Atomic operation verbs enforced across all ERP domain permission nodes.
        </p>

        <div className="flex flex-wrap gap-2 pt-2">
          {APPROVED_ACTION_PRIMITIVES.map((verb: string) => (
            <span
              key={verb}
              className="px-2.5 py-1 text-xs font-mono font-medium bg-slate-100 text-slate-800 rounded-md border border-slate-200"
            >
              {verb}
            </span>
          ))}
        </div>
      </div>

      {/* System Default Roles Catalogue */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
          Standard System Roles Catalogue
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SYSTEM_ROLES.map((role) => (
            <div key={role.code} className="p-4 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">{role.name}</span>
                <span className="text-[10px] font-mono font-semibold bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded">
                  {role.code}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{role.description}</p>
              <div className="pt-2 border-t border-slate-200">
                <span className="text-[11px] font-semibold text-slate-700 block mb-1">Scope: {role.scope}</span>
                <div className="space-y-1">
                  {role.keyPermissions.map((perm) => (
                    <div key={perm} className="flex items-center gap-1 text-[11px] text-slate-600 font-mono">
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span>{perm}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Security Architecture Notice */}
      <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-xs text-amber-900 space-y-1">
          <p className="font-semibold">Server-Authoritative RBAC Guard Invariant</p>
          <p>
            Client browsers never determine authorization. All API calls transmit signed Bearer JWTs; the backend extracts
            verified identity, asserts company/branch tenant membership, and evaluates effective permissions directly in PostgreSQL.
          </p>
        </div>
      </div>
    </div>
  );
};
