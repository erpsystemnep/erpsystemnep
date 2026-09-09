import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  TaxReconciliationReport,
  TaxTransaction,
  TaxSummaryReport,
} from '../../../shared/types/index.js';
import {
  FileCheck2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Layers,
  ArrowRight,
  TrendingUp,
  Receipt,
  FileSpreadsheet,
  RotateCcw,
} from 'lucide-react';

export const TaxReconciliationView: React.FC = () => {
  const { activeCompany, token } = useAuth();
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reconciliation, setReconciliation] = useState<TaxReconciliationReport | null>(null);
  const [summary, setSummary] = useState<TaxSummaryReport | null>(null);
  const [transactions, setTransactions] = useState<TaxTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state for transactions audit list
  const [filterTaxType, setFilterTaxType] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const fetchData = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    setError(null);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      'x-company-id': activeCompany.id,
    };

    try {
      const reconUrl = `/api/v1/accounting/tax/reconciliation?asOfDate=${asOfDate}`;
      const summaryUrl = `/api/v1/accounting/tax/summary?toDate=${asOfDate}`;
      
      const txParams = new URLSearchParams();
      if (filterTaxType !== 'ALL') txParams.append('taxType', filterTaxType);
      if (filterStatus !== 'ALL') txParams.append('status', filterStatus);
      txParams.append('toDate', asOfDate);
      txParams.append('limit', '100');
      const txUrl = `/api/v1/accounting/tax/transactions?${txParams.toString()}`;

      const [reconRes, summaryRes, txRes] = await Promise.all([
        fetch(reconUrl, { headers }),
        fetch(summaryUrl, { headers }),
        fetch(txUrl, { headers }),
      ]);

      if (reconRes.ok) {
        const d = await reconRes.json();
        setReconciliation(d.data || null);
      }
      if (summaryRes.ok) {
        const d = await summaryRes.json();
        setSummary(d.data || null);
      }
      if (txRes.ok) {
        const d = await txRes.json();
        setTransactions(d.data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch tax reconciliation data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeCompany?.id, asOfDate, filterTaxType, filterStatus]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'POSTED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            POSTED
          </span>
        );
      case 'REVERSED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            REVERSED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200">
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-600 border border-slate-200">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileCheck2 className="w-5 h-5 text-indigo-600" />
              Tax Subledger & General Ledger Reconciliation
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Audits Authoritative Tax Subledger records against Output Tax (2200) and Input Tax (1150) GL journals
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <label className="font-semibold text-slate-600 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                As of Date:
              </label>
              <input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg font-mono text-xs"
              />
            </div>
            <button
              id="refresh-tax-recon-btn"
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Reconcile
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Global Status Banner */}
      {reconciliation && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between ${
            reconciliation.isFullyReconciled
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              : 'bg-amber-50/80 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-3">
            {reconciliation.isFullyReconciled ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0" />
            )}
            <div>
              <div className="font-bold text-sm">
                {reconciliation.isFullyReconciled
                  ? 'Authoritative Tax Reconciliation: 100% In Equilibrium'
                  : 'Reconciliation Discrepancy Detected Between Subledger and General Ledger'}
              </div>
              <div className="text-xs opacity-90 mt-0.5">
                {reconciliation.isFullyReconciled
                  ? 'All Output Tax and Input Tax subledger registers exactly equal General Ledger postings.'
                  : 'Verify unposted journals, manual voucher adjustments, or missing subledger sync.'}
              </div>
            </div>
          </div>
          <div className="text-right">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold border ${
                reconciliation.isFullyReconciled
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  : 'bg-amber-100 text-amber-800 border-amber-300'
              }`}
            >
              {reconciliation.isFullyReconciled ? 'RECONCILED' : 'DISCREPANCY'}
            </span>
          </div>
        </div>
      )}

      {/* 3-Way Reconciliation Comparison Cards */}
      {reconciliation && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Output Tax (Sales) */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Output Tax (Payable)
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  reconciliation.isOutputTaxReconciled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {reconciliation.isOutputTaxReconciled ? 'IN SYNC' : 'VARIANCE'}
              </span>
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-100 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Tax Subledger Total:</span>
                <span className="font-mono font-bold text-slate-800">
                  ${reconciliation.outputTaxSubledgerTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">General Ledger Total (2200):</span>
                <span className="font-mono font-bold text-slate-800">
                  ${reconciliation.outputTaxGlTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
                <span className="font-semibold text-slate-700">Variance / Delta:</span>
                <span
                  className={`font-mono font-bold ${
                    reconciliation.isOutputTaxReconciled ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  ${reconciliation.outputTaxDiscrepancy.toLocaleString(undefined, { minimumFractionDigits: 4 })}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Input Tax (Purchases) */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Input Tax (Receivable)
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  reconciliation.isInputTaxReconciled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {reconciliation.isInputTaxReconciled ? 'IN SYNC' : 'VARIANCE'}
              </span>
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-100 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Tax Subledger Total:</span>
                <span className="font-mono font-bold text-slate-800">
                  ${reconciliation.inputTaxSubledgerTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">General Ledger Total (1150):</span>
                <span className="font-mono font-bold text-slate-800">
                  ${reconciliation.inputTaxGlTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
                <span className="font-semibold text-slate-700">Variance / Delta:</span>
                <span
                  className={`font-mono font-bold ${
                    reconciliation.isInputTaxReconciled ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  ${reconciliation.inputTaxDiscrepancy.toLocaleString(undefined, { minimumFractionDigits: 4 })}
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Net Tax Position */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Net Tax Position
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {reconciliation.netTaxPosition >= 0 ? 'NET PAYABLE' : 'NET REFUND'}
              </span>
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-100 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Output Tax (Sales):</span>
                <span className="font-mono text-slate-700">
                  ${reconciliation.outputTaxSubledgerTotal.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Less Input Tax (Purchases):</span>
                <span className="font-mono text-slate-700">
                  (${reconciliation.inputTaxSubledgerTotal.toFixed(2)})
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200">
                <span className="font-semibold text-slate-700">Settlement Obligation:</span>
                <span className="font-mono font-bold text-indigo-700 text-sm">
                  ${Math.abs(reconciliation.netTaxPosition).toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                  {reconciliation.netTaxPosition >= 0 ? 'Payable' : 'Credit'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tax Subledger Transactions Register */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-0">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h4 className="font-semibold text-slate-800 text-sm">Authoritative Tax Subledger Register</h4>
            <p className="text-xs text-slate-400">
              Individual tax line records generated during invoice posting and reversal workflows
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-500">Tax Type:</span>
              <select
                value={filterTaxType}
                onChange={(e) => setFilterTaxType(e.target.value)}
                className="px-2 py-1 border border-slate-200 rounded text-xs"
              >
                <option value="ALL">All Types</option>
                <option value="OUTPUT_TAX">Output Tax (Sales)</option>
                <option value="INPUT_TAX">Input Tax (Purchases)</option>
              </select>
            </div>

            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-500">Status:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-2 py-1 border border-slate-200 rounded text-xs"
              >
                <option value="ALL">All Statuses</option>
                <option value="POSTED">POSTED</option>
                <option value="REVERSED">REVERSED</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Tax Type</th>
                <th className="py-3 px-4">Source Document</th>
                <th className="py-3 px-4">Tax Code</th>
                <th className="py-3 px-4 text-right">Tax Rate</th>
                <th className="py-3 px-4 text-right">Taxable Base</th>
                <th className="py-3 px-4 text-right font-bold">Tax Amount</th>
                <th className="py-3 px-4">GL Journal</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    Loading tax subledger entries...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No tax subledger transactions recorded. Post Sales or Purchase Invoices to establish tax registers.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-4 font-mono text-slate-600">{tx.accountingDate}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          tx.taxType === 'OUTPUT_TAX'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}
                      >
                        {tx.taxType === 'OUTPUT_TAX' ? 'Output Tax' : 'Input Tax'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-slate-800">
                        {tx.sourceType === 'SALES_INVOICE' ? 'Sales Inv' : 'Purchase Inv'}:{' '}
                        <span className="text-indigo-600 font-semibold">{tx.sourceId.slice(0, 8)}...</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">{tx.taxCode || 'VAT-STD'}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-600">{tx.taxRate}%</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-700">
                      ${tx.taxableAmount.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                      ${tx.taxAmount.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500">
                      {tx.journalId ? (
                        <span className="text-slate-600 font-mono">
                          {tx.journal?.journalNumber || tx.journalId.slice(0, 8)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-center">{getStatusBadge(tx.status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
