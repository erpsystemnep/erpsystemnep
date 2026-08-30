import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../api/client.js';
import { Company, Branch, Warehouse } from '../../../shared/types/index.js';
import { Building2, GitBranch, Warehouse as WarehouseIcon, RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';

export const OrgHierarchyView: React.FC = () => {
  const { activeCompany, isAuthenticated } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Record<string, Branch[]>>({});
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse[]>>({});
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHierarchy = async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch Companies
      const compRes = await api.get<Company[]>('/api/v1/org/companies');
      const compList = compRes.data || [];
      setCompanies(compList);

      const targetCompId = activeCompany?.id || (compList.length > 0 ? compList[0].id : null);
      setSelectedCompanyId(targetCompId);

      if (targetCompId) {
        // 2. Fetch Branches for active company
        const branchRes = await api.get<Branch[]>(`/api/v1/org/branches?companyId=${targetCompId}`);
        setBranches((prev) => ({ ...prev, [targetCompId]: branchRes.data || [] }));

        // 3. Fetch Warehouses for active company
        const whRes = await api.get<Warehouse[]>(`/api/v1/org/warehouses?companyId=${targetCompId}`);
        setWarehouses((prev) => ({ ...prev, [targetCompId]: whRes.data || [] }));
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load organization hierarchy');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHierarchy();
  }, [isAuthenticated, activeCompany?.id]);

  const handleSelectCompany = async (companyId: string) => {
    setSelectedCompanyId(companyId);
    try {
      const [branchRes, whRes] = await Promise.all([
        api.get<Branch[]>(`/api/v1/org/branches?companyId=${companyId}`),
        api.get<Warehouse[]>(`/api/v1/org/warehouses?companyId=${companyId}`),
      ]);
      setBranches((prev) => ({ ...prev, [companyId]: branchRes.data || [] }));
      setWarehouses((prev) => ({ ...prev, [companyId]: whRes.data || [] }));
    } catch (err: any) {
      setError(err?.message || 'Failed to load branch/warehouse data');
    }
  };

  const currentBranches = selectedCompanyId ? branches[selectedCompanyId] || [] : [];
  const currentWarehouses = selectedCompanyId ? warehouses[selectedCompanyId] || [] : [];

  return (
    <div className="space-y-6" id="org-hierarchy-view">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            Organization Hierarchy Explorer
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Explore multi-tenant boundary isolation: Companies, Operating Branches, and Physical/Central Warehouses.
          </p>
        </div>
        <button
          onClick={fetchHierarchy}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh Structure
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-rose-800">Organization Access Error</p>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Main Multi-Tenant View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Company List */}
        <div className="lg:col-span-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center justify-between">
            <span>Registered Companies</span>
            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">{companies.length} Tenants</span>
          </h3>

          <div className="space-y-2">
            {companies.map((comp) => {
              const isSelected = comp.id === selectedCompanyId;
              const isSessionActive = comp.id === activeCompany?.id;
              return (
                <div
                  key={comp.id}
                  onClick={() => handleSelectCompany(comp.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500'
                      : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-900">{comp.legalName || (comp as any).name}</span>
                      <p className="text-[11px] font-mono text-slate-500">Code: {comp.code}</p>
                    </div>
                    {isSessionActive && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        Session Active
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-600">
                    <span className="font-mono">Currency: {comp.baseCurrency}</span>
                    <span>•</span>
                    <span className="font-mono">Fiscal Start: Month {comp.fiscalYearStartMonth}</span>
                  </div>
                </div>
              );
            })}
            {companies.length === 0 && !isLoading && (
              <p className="text-xs text-slate-500 text-center py-6">No companies found in database.</p>
            )}
          </div>
        </div>

        {/* Branches and Warehouses of Selected Company */}
        <div className="lg:col-span-8 space-y-6">
          {/* Branches */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <GitBranch className="w-4 h-4 text-indigo-600" />
                Operating Branches ({currentBranches.length})
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Scoped by Company</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {currentBranches.map((branch) => (
                <div key={branch.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">{branch.name}</span>
                    {branch.isHeadOffice && (
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold">
                        Head Office
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-600 space-y-0.5 font-mono">
                    <p>Code: {branch.code}</p>
                    <p>Timezone: {branch.timezone || 'UTC'}</p>
                    <p>Country: {branch.countryCode || 'N/A'}</p>
                  </div>
                </div>
              ))}
              {currentBranches.length === 0 && (
                <p className="text-xs text-slate-500 col-span-2 py-4 text-center">
                  No branches configured for this company.
                </p>
              )}
            </div>
          </div>

          {/* Warehouses */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <WarehouseIcon className="w-4 h-4 text-emerald-600" />
                Warehouses & Storage Facilities ({currentWarehouses.length})
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Physical & Virtual Types</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {currentWarehouses.map((wh) => (
                <div key={wh.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">{wh.name}</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-mono">
                      {wh.warehouseType}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 space-y-0.5 font-mono">
                    <p>Code: {wh.code}</p>
                    <p>Scope: {wh.branchId ? 'Branch Scoped' : 'Company-Wide Central DC'}</p>
                  </div>
                </div>
              ))}
              {currentWarehouses.length === 0 && (
                <p className="text-xs text-slate-500 col-span-2 py-4 text-center">
                  No warehouses configured for this company.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
