import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../api/client.js';
import { NumberingSeries } from '../../../shared/types/index.js';
import { Hash, RefreshCw, Eye, AlertTriangle, Layers, Building2 } from 'lucide-react';

export const NumberingSeriesView: React.FC = () => {
  const { activeCompany, isAuthenticated } = useAuth();
  const [seriesList, setSeriesList] = useState<NumberingSeries[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSeries = async () => {
    if (!isAuthenticated || !activeCompany) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<NumberingSeries[]>(`/api/v1/numbering/series`);
      setSeriesList(res.data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load numbering series');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSeries();
  }, [isAuthenticated, activeCompany?.id]);

  // Safe client-side preview calculator that DOES NOT consume database sequences
  const computeSafePreview = (series: NumberingSeries) => {
    const nextSeq = series.currentNumber + 1;
    const padded = String(nextSeq).padStart(series.minDigits, '0');
    const suffix = series.suffix ? `-${series.suffix}` : '';
    return `${series.prefix}-${padded}${suffix}`;
  };

  return (
    <div className="space-y-6" id="numbering-series-view">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Hash className="w-5 h-5 text-indigo-600" />
            Numbering Series & Sequence Engine
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Gapless transactional sequence generation, prefix templates, zero-padding, reset frequencies, and branch overrides.
          </p>
        </div>
        <button
          onClick={fetchSeries}
          disabled={isLoading || !activeCompany}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:bg-slate-100 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh Series
        </button>
      </div>

      {!activeCompany && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <Building2 className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-xs text-amber-800">
            Please select an <strong>Active Company</strong> in Identity & Session Context to inspect tenant numbering sequences.
          </p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Notice on Non-Consuming Previews */}
      <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-start gap-3">
        <Eye className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
        <div className="text-xs text-indigo-950 space-y-1">
          <p className="font-semibold">Safe Sequence Preview Policy</p>
          <p>
            The previews below are computed purely client-side (<span className="font-mono">current + 1</span>) to avoid
            consuming database sequence counters. Sequence consumption only occurs during atomic document persistence
            via transactional <span className="font-mono">SELECT ... FOR UPDATE</span> locks.
          </p>
        </div>
      </div>

      {/* Series Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {seriesList.map((series) => {
          const preview = computeSafePreview(series);
          return (
            <div key={series.id} className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">{series.documentType}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-700">
                  {series.branchId ? 'Branch Override' : 'Company-Wide'}
                </span>
              </div>

              {/* Safe Preview Box */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                <span className="text-[10px] uppercase font-semibold text-slate-500 block">Next Number Preview</span>
                <span className="text-sm font-mono font-bold text-indigo-600">{preview}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1 font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 block">Prefix:</span>
                  <span>{series.prefix}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Suffix:</span>
                  <span>{series.suffix || 'None'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Min Digits:</span>
                  <span>{series.minDigits}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Current Counter:</span>
                  <span className="font-bold text-slate-900">{series.currentNumber}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Reset Period:</span>
                  <span>{series.resetFrequency}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Status:</span>
                  <span className={series.isActive ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                    {series.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {seriesList.length === 0 && activeCompany && !isLoading && (
          <div className="col-span-3 p-8 bg-white rounded-xl border border-slate-200 text-center text-xs text-slate-500">
            No numbering series configured for company {activeCompany.code}.
          </div>
        )}
      </div>
    </div>
  );
};
