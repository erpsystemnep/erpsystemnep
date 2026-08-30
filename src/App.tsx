import React, { useState } from 'react';
import { AuthProvider, useAuth } from './client/context/AuthContext.js';
import { AuthSessionView } from './client/components/auth/AuthSessionView.js';
import { OrgHierarchyView } from './client/components/org/OrgHierarchyView.js';
import { RbacMatrixView } from './client/components/rbac/RbacMatrixView.js';
import { NumberingSeriesView } from './client/components/numbering/NumberingSeriesView.js';
import { WorkflowSimulatorView } from './client/components/workflow/WorkflowSimulatorView.js';
import { AuditTrailView } from './client/components/audit/AuditTrailView.js';
import { SystemHealthView } from './client/components/diagnostics/SystemHealthView.js';
import {
  Shield,
  Building2,
  KeyRound,
  Hash,
  GitCommit,
  FileText,
  Activity,
  Layers,
  Lock,
  CheckCircle2,
} from 'lucide-react';

type NavTab = 'session' | 'org' | 'rbac' | 'numbering' | 'workflow' | 'audit' | 'health';

const MainLayout: React.FC = () => {
  const { user, isAuthenticated, activeCompany, activeBranch, isSuperadmin } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('session');

  const navItems: { id: NavTab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'session', label: 'Identity & Session', icon: Shield },
    { id: 'org', label: 'Organization Hierarchy', icon: Building2 },
    { id: 'rbac', label: 'RBAC & Permissions', icon: KeyRound },
    { id: 'numbering', label: 'Numbering Series', icon: Hash },
    { id: 'workflow', label: 'Workflow & SoD', icon: GitCommit },
    { id: 'audit', label: 'Audit Trail', icon: FileText },
    { id: 'health', label: 'System Health', icon: Activity },
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Top Enterprise Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                Multi-Company ERP Core
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  v0.7.0 Foundation
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">Enterprise Platform & Governance Control Plane</p>
            </div>
          </div>

          {/* User & Tenant Badges */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <div className="flex items-center gap-2 text-xs">
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 rounded-md border border-slate-700">
                  <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="font-mono text-slate-300">{activeCompany?.code || 'No Company Context'}</span>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 rounded-md border border-slate-700">
                  <span className="font-mono text-slate-300">{activeBranch?.code || 'Company-Wide'}</span>
                </div>
                <div className="px-2.5 py-1 bg-indigo-950 border border-indigo-800 rounded-md text-indigo-300 font-bold font-mono">
                  {isSuperadmin ? 'SUPERADMIN' : user?.fullName || 'USER'}
                </div>
              </div>
            ) : (
              <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-md">
                Unauthenticated (Public Mode)
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main App Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full flex flex-col md:flex-row gap-6">
        {/* Navigation Sidebar */}
        <aside className="w-full md:w-64 shrink-0 space-y-1">
          <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm space-y-1">
            <span className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Foundation Consoles
            </span>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Quick Platform Invariants Card */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-xs space-y-2 text-slate-600">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Security Invariants
            </span>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Zero Client Trust</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Immutable Audit Trigger</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>SELECT FOR UPDATE Locks</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>SoD Creator Separation</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 bg-transparent">
          {activeTab === 'session' && <AuthSessionView />}
          {activeTab === 'org' && <OrgHierarchyView />}
          {activeTab === 'rbac' && <RbacMatrixView />}
          {activeTab === 'numbering' && <NumberingSeriesView />}
          {activeTab === 'workflow' && <WorkflowSimulatorView />}
          {activeTab === 'audit' && <AuditTrailView />}
          {activeTab === 'health' && <SystemHealthView />}
        </main>
      </div>
    </div>
  );
};

export function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}

export default App;
