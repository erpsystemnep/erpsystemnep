import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  TrialBalanceReport,
  AccountType,
} from '../../../shared/types/index.js';
import {
  Scale,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Filter,
  Calendar,
  Layers,
} from 'lucide-react';

export const TrialBalanceView: React.FC = () => {
  const { activeCompany, token } = useAuth();
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState<string>('');
  const [accountType, setAccountType] = useState<string>('ALL');
  const [includeZeroBalance, setIncludeZeroBalance] = useState<boolean>(true);

  const fetchTrialBalance = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (asOfDate) params.append('asOfDate', asOfDate);
      if (startDate) params.append('startDate', startDate);
      if (accountType !== 'ALL') params.append('accountType', accountType);
      params.append('includeZeroBalance', String(includeZeroBalance));

      const res = await fetch(`/api/v1/accounting/trial-balance?${params.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
          'x-company-id': activeCompany.id,
        },
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || json.message || 'Failed to load Trial Balance');
      }
      setReport(json.data);
    } catch (err: any) {
      setError(err.message || 'Error loading Trial Balance report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrialBalance();
  }, [activeCompany?.id]);

  const handleExportCsv = () => {
    if (!activeCompany?.id) return;
    const params = new URLSearchParams();
    if (asOfDate) params.append('asOfDate', asOfDate);
    if (startDate) params.append('startDate', startDate);
    if (accountType !== 'ALL') params.append('accountType', accountType);
    params.append('includeZeroBalance', String(includeZeroBalance));
    params.append('format', 'csv');

    // Trigger direct download via fetch with bearer token
    fetch(`/api/v1/accounting/trial-balance?${params.toString()}`, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
        'x-company-id': activeCompany.id,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trial-balance-${asOfDate || 'current'}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch((err) => {
        alert(err.message || 'Failed to export CSV');
      });
  };

  const getTypeBadge = (type: AccountType) => {
    const styles: Record<AccountType, string> = {
      ASSET: 'bg-blue-50 text-blue-700 border-blue-200',
      LIABILITY: 'bg-amber-50 text-amber-700 border-amber-200',
      EQUITY: 'bg-purple-50 text-purple-700 border-purple-200',
      REVENUE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      EXPENSE: 'bg-rose-50 text-rose-700 border-rose-200',
    };
    return (
      <span
        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
          styles[type] || 'bg-slate-50 text-slate-700 border-slate-200'
        }`}
      >
        {type}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Control & Filter Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Scale className="w-5 h-5 text-indigo-600" />
              Authoritative General Ledger Trial Balance
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Calculated strictly from POSTED accounting journals with real-time double-entry equilibrium verification
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="export-tb-csv-btn"
              onClick={handleExportCsv}
              disabled={loading || !report}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-sm transition"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              id="refresh-tb-btn"
              onClick={fetchTrialBalance}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Generate
            </button>
          </div>
        </div>

        {/* Filters Form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div>
            <label className="block font-semibold text-slate-600 mb-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              As of Date *
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg font-mono text-xs"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              Start Date (Optional)
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg font-mono text-xs"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-600 mb-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              Account Type
            </label>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs"
            >
              <option value="ALL">All Account Types</option>
              <option value="ASSET">Assets</option>
              <option value="LIABILITY">Liabilities</option>
              <option value="EQUITY">Equity</option>
              <option value="REVENUE">Revenue</option>
              <option value="EXPENSE">Expenses</option>
            </select>
          </div>

          <div className="flex items-center pt-5">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
              <input
                type="checkbox"
                checked={includeZeroBalance}
                onChange={(e) => setIncludeZeroBalance(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
              />
              Include Zero Balances
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Metric Summary Cards */}
      {report && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Total Debit Balance
            </div>
            <div className="text-xl font-bold font-mono text-slate-900 mt-1">
              ${report.totalDebitBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Sum of net debit balances (Assets, Expenses)
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Total Credit Balance
            </div>
            <div className="text-xl font-bold font-mono text-slate-900 mt-1">
              ${report.totalCreditBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Sum of net credit balances (Liabilities, Equity, Revenue)
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Equilibrium Variance
            </div>
            <div
              className={`text-xl font-bold font-mono mt-1 ${
                report.isBalanced ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              ${Math.abs(report.totalDebitBalance - report.totalCreditBalance).toLocaleString(undefined, {
                minimumFractionDigits: 4,
              })}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Authoritative mathematical delta
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Ledger State
            </div>
            <div className="mt-1">
              {report.isBalanced ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  BALANCED & AUDITED
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-bold">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  OUT OF EQUILIBRIUM
                </div>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Generated: {new Date(report.generatedAt).toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}

      {/* Trial Balance Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-slate-800 text-sm">Trial Balance Detail</h4>
            <p className="text-xs text-slate-400">
              Showing {report?.items.length || 0} accounts as of {asOfDate || 'current'}
            </p>
          </div>
          {report?.isBalanced && (
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              Debits equal Credits
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 w-28">Account Code</th>
                <th className="py-3 px-4">Account Name</th>
                <th className="py-3 px-4 w-24">Type</th>
                <th className="py-3 px-4 text-right font-mono w-32">Turnover Debit</th>
                <th className="py-3 px-4 text-right font-mono w-32">Turnover Credit</th>
                <th className="py-3 px-4 text-right font-mono w-36">Ending Debit</th>
                <th className="py-3 px-4 text-right font-mono w-36">Ending Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (!report || report.items.length === 0) ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    Calculating Trial Balance from general ledger...
                  </td>
                </tr>
              ) : !report || report.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No account movements found for the selected criteria.
                  </td>
                </tr>
              ) : (
                report.items.map((item) => (
                  <tr
                    key={item.accountId}
                    className={`hover:bg-slate-50/80 transition ${
                      item.isGroup ? 'bg-slate-50/40 font-semibold' : ''
                    }`}
                  >
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-800">
                      {item.accountCode}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-slate-800">{item.accountName}</div>
                      {item.isGroup && (
                        <span className="text-[10px] text-slate-400 font-normal">Header Group</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">{getTypeBadge(item.accountType)}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                      {item.debitTotal > 0 ? `$${item.debitTotal.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                      {item.creditTotal > 0 ? `$${item.creditTotal.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                      {item.debitBalance > 0 ? `$${item.debitBalance.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                      {item.creditBalance > 0 ? `$${item.creditBalance.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {report && report.items.length > 0 && (
              <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-300">
                <tr>
                  <td colSpan={3} className="py-3 px-4 text-slate-800 uppercase tracking-wider text-xs">
                    Grand Total
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-700">
                    ${report.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-700">
                    ${report.totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-indigo-700 text-sm">
                    ${report.totalDebitBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-indigo-700 text-sm">
                    ${report.totalCreditBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
