import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../api/client.js';
import { AuditLog } from '../../../shared/types/index.js';
import { FileText, Filter, RefreshCw, Lock, Search, Calendar, User, Tag } from 'lucide-react';

export const AuditTrailView: React.FC = () => {
  const { activeCompany, isAuthenticated } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('');
  const [moduleFilter, setModuleFilter] = useState<string>('');
  const [entityFilter, setEntityFilter] = useState<string>('');

  const fetchLogs = async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      if (actionFilter) queryParams.set('action', actionFilter);
      if (moduleFilter) queryParams.set('module', moduleFilter);
      if (entityFilter) queryParams.set('entityName', entityFilter);
      if (activeCompany) queryParams.set('companyId', activeCompany.id);

      const res = await api.get<AuditLog[]>(`/api/v1/audit/logs?${queryParams.toString()}`);
      const list = res.data || [];
      setLogs(list);
      if (list.length > 0 && !selectedLog) {
        setSelectedLog(list[0]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to query audit logs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [isAuthenticated, activeCompany?.id, actionFilter, moduleFilter, entityFilter]);

  return (
    <div className="space-y-6" id="audit-trail-view">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            Immutable Audit Trail & Compliance Ledger
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Tamper-proof append-only audit records protected by PostgreSQL immutability database triggers.
          </p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh Ledger
        </button>
      </div>

      {/* Immutability Banner */}
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Lock className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="text-xs text-emerald-950">
            <span className="font-bold uppercase tracking-wider block">Database-Level Append-Only Guarantee</span>
            <span>All UPDATE and DELETE operations are permanently blocked by PostgreSQL trigger prevent_audit_log_modification.</span>
          </div>
        </div>
        <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 px-2 py-1 rounded">
          ACTIVE TRIGGER
        </span>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Filter Controls */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Action Filter</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
          >
            <option value="">-- All Actions --</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="APPROVE">APPROVE</option>
            <option value="REJECT">REJECT</option>
            <option value="POST">POST</option>
            <option value="REVERSE">REVERSE</option>
            <option value="LOGIN">LOGIN</option>
            <option value="LOGOUT">LOGOUT</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Module Filter</label>
          <input
            type="text"
            placeholder="e.g. org, auth, sales, accounting"
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded-lg p-2"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-600 uppercase mb-1">Entity Name</label>
          <input
            type="text"
            placeholder="e.g. company, branch, voucher"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded-lg p-2"
          />
        </div>
      </div>

      {/* Audit Log Entries & JSON Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Log Entries List */}
        <div className="lg:col-span-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2 max-h-[500px] overflow-y-auto">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Audit Entries ({logs.length})</span>
            <span className="text-[10px] text-slate-500 font-mono">Scoped by Tenant</span>
          </h3>

          {logs.map((log) => {
            const isSelected = selectedLog?.id === log.id;
            return (
              <div
                key={log.id}
                onClick={() => setSelectedLog(log)}
                className={`p-3 rounded-lg border cursor-pointer transition-all space-y-1.5 ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold px-1.5 py-0.2 bg-slate-200 text-slate-800 rounded">
                      {log.action}
                    </span>
                    <span className="text-xs font-bold text-slate-900">
                      {log.module}.{log.entityName}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-600 font-mono">
                  <span>ID: {log.entityId.substring(0, 12)}...</span>
                  <span>User: {log.userId?.substring(0, 8) || 'SYSTEM'}</span>
                </div>
              </div>
            );
          })}
          {logs.length === 0 && !isLoading && (
            <p className="text-xs text-slate-500 text-center py-8">No audit log records found for this criteria.</p>
          )}
        </div>

        {/* Selected Record Detail & JSON Diff */}
        <div className="lg:col-span-6 bg-slate-900 p-4 rounded-xl text-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Audit Event Payload Inspector
            </span>
            <span className="text-[10px] font-mono text-emerald-400">ID: {selectedLog?.id || 'None'}</span>
          </div>

          {selectedLog ? (
            <div className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950 p-3 rounded border border-slate-800">
                <div>
                  <span className="text-slate-500 block">Action:</span>
                  <span className="text-emerald-400 font-bold">{selectedLog.action}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Module:</span>
                  <span className="text-slate-200">{selectedLog.module}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Entity Name:</span>
                  <span className="text-slate-200">{selectedLog.entityName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Entity ID:</span>
                  <span className="text-slate-200">{selectedLog.entityId}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Company ID:</span>
                  <span className="text-slate-200">{selectedLog.companyId || 'Global (None)'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Timestamp:</span>
                  <span className="text-slate-200">{new Date(selectedLog.createdAt).toISOString()}</span>
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 uppercase font-bold block mb-1">State Snapshot & Changes</span>
                <pre className="p-3 bg-slate-950 rounded border border-slate-800 text-[11px] text-indigo-300 overflow-x-auto max-h-[220px]">
                  {JSON.stringify(selectedLog.changes || {}, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-12">Select an audit log record to inspect.</p>
          )}
        </div>
      </div>
    </div>
  );
};
