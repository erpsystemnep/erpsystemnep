import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { Shield, Key, Mail, Lock, LogOut, CheckCircle2, User as UserIcon, Building2, GitBranch, RefreshCw, AlertCircle } from 'lucide-react';

export const AuthSessionView: React.FC = () => {
  const {
    user,
    token,
    isAuthenticated,
    isLoading,
    activeCompany,
    activeBranch,
    availableCompanies,
    availableBranches,
    isSuperadmin,
    login,
    logout,
    selectCompany,
    selectBranch,
    refreshProfile,
    error,
    clearError,
  } = useAuth();

  const [email, setEmail] = useState('admin@system.local');
  const [password, setPassword] = useState('SuperAdmin#2026!');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch {
      // Error handled in AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickFill = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    clearError();
  };

  return (
    <div className="space-y-6" id="auth-session-view">
      {/* Header Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            Identity & Session Context
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Server-side token verification, authenticated user profile, and active company/branch context management.
          </p>
        </div>
        {isAuthenticated && (
          <button
            onClick={() => refreshProfile()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh /me
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-800">Authentication Error</p>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="text-xs text-rose-600 hover:text-rose-800 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {!isAuthenticated ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Login Form */}
          <div className="lg:col-span-7 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Lock className="w-4 h-4 text-indigo-600" />
              Sign In to ERP System
            </h3>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="user@company.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="••••••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || isLoading}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  'Sign In & Obtain JWT Token'
                )}
              </button>
            </form>
          </div>

          {/* Quick Demo Credentials */}
          <div className="lg:col-span-5 bg-slate-50 p-6 rounded-xl border border-slate-200">
            <h4 className="text-xs font-semibold text-slate-900 uppercase tracking-wider mb-3">
              Standard Seed Accounts
            </h4>
            <div className="space-y-3">
              <div
                onClick={() => handleQuickFill('admin@system.local', 'SuperAdmin#2026!')}
                className="p-3 bg-white rounded-lg border border-slate-200 hover:border-indigo-400 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-700">SUPERADMIN</span>
                  <span className="text-[10px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-mono">Global Wildcard *</span>
                </div>
                <p className="text-xs text-slate-600 mt-1 font-mono">admin@system.local</p>
              </div>

              <div
                onClick={() => handleQuickFill('admin@acme.com', 'AdminAcme#2026!')}
                className="p-3 bg-white rounded-lg border border-slate-200 hover:border-indigo-400 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-700">COMPANY ADMIN</span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-mono">Tenant Scoped</span>
                </div>
                <p className="text-xs text-slate-600 mt-1 font-mono">admin@acme.com</p>
              </div>

              <div
                onClick={() => handleQuickFill('manager@acme.com', 'BranchManager#2026!')}
                className="p-3 bg-white rounded-lg border border-slate-200 hover:border-indigo-400 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-700">BRANCH MANAGER</span>
                  <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-mono">Branch Scoped</span>
                </div>
                <p className="text-xs text-slate-600 mt-1 font-mono">manager@acme.com</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active User Card & Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold">
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{user?.fullName || 'User'}</h3>
                    <p className="text-xs text-slate-500 font-mono">{user?.email}</p>
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md hover:bg-rose-100 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Logout
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
                <div className="p-2.5 bg-slate-50 rounded-lg">
                  <span className="text-[11px] text-slate-500 block">User ID</span>
                  <span className="text-xs font-mono font-medium text-slate-800 truncate block">{user?.id}</span>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg">
                  <span className="text-[11px] text-slate-500 block">Role Authority</span>
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1 mt-0.5">
                    {isSuperadmin ? (
                      <span className="text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded text-[11px] font-bold">SUPERADMIN</span>
                    ) : (
                      <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px] font-bold">TENANT USER</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Tenant Context Selector */}
            <div className="lg:col-span-6 bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                Active Tenant Context Selector
              </h4>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Company Context</label>
                  <select
                    value={activeCompany?.id || ''}
                    onChange={(e) => {
                      const comp = availableCompanies.find((c) => c.id === e.target.value) || null;
                      selectCompany(comp);
                    }}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- No Company Context (Global/All) --</option>
                    {availableCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legalName} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
                    <GitBranch className="w-3 h-3 text-slate-500" />
                    Branch Context (Scoped)
                  </label>
                  <select
                    disabled={!activeCompany || availableBranches.length === 0}
                    value={activeBranch?.id || ''}
                    onChange={(e) => {
                      const br = availableBranches.find((b) => b.id === e.target.value) || null;
                      selectBranch(br);
                    }}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- Company-Wide (All Branches) --</option>
                    {availableBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code}) {b.isHeadOffice ? '★ Head Office' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Active JWT Inspector */}
          <div className="p-4 bg-slate-900 rounded-xl text-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Active Signed Bearer JWT
              </span>
              <span className="text-[10px] font-mono text-slate-400">HMAC-SHA256 Signed</span>
            </div>
            <p className="text-xs font-mono break-all text-emerald-400 bg-slate-950 p-2.5 rounded border border-slate-800">
              {token}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
