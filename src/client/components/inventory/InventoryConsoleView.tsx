import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  StockBalanceSummary,
  StockLedgerEntry,
  QcInspection,
  InventoryBatch,
} from '../../../shared/types/index.js';
import {
  Boxes,
  ClipboardCheck,
  Layers,
  History,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';

export const InventoryConsoleView: React.FC = () => {
  const { activeCompany, token } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'balances' | 'ledger' | 'qc' | 'batches'>('balances');

  const [balances, setBalances] = useState<StockBalanceSummary[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<StockLedgerEntry[]>([]);
  const [qcInspections, setQcInspections] = useState<QcInspection[]>([]);
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchInventoryData = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    setActionError(null);
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        'x-company-id': activeCompany.id,
      };

      const [balRes, ledRes, qcRes, batchRes] = await Promise.all([
        fetch(`/api/v1/inventory/stock-balances?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/inventory/stock-ledger?companyId=${activeCompany.id}&limit=50`, { headers }),
        fetch(`/api/v1/inventory/qc-inspections?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/inventory/batches?companyId=${activeCompany.id}`, { headers }),
      ]);

      if (balRes.ok) {
        const d = await balRes.json();
        setBalances(d.data || []);
      }
      if (ledRes.ok) {
        const d = await ledRes.json();
        setLedgerEntries(d.data || []);
      }
      if (qcRes.ok) {
        const d = await qcRes.json();
        setQcInspections(d.data || []);
      }
      if (batchRes.ok) {
        const d = await batchRes.json();
        setBatches(d.data || []);
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to fetch inventory data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventoryData();
  }, [activeCompany?.id]);

  const executeAction = async (endpoint: string, method: string = 'POST', body?: any) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
          'x-company-id': activeCompany?.id || '',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Action failed');
      }
      setActionSuccess('Action executed successfully');
      fetchInventoryData();
    } catch (err: any) {
      setActionError(err.message || 'Action failed');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-indigo-600" />
            Inventory Valuation & Stock Ledger Control
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable single-source-of-truth stock movements, multi-status inventory buckets, batch traceability, and QC inspection controls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchInventoryData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}
      {actionSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Sub tabs */}
      <div className="flex border-b border-slate-200 gap-4">
        <button
          onClick={() => setActiveSubTab('balances')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'balances'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Layers className="w-4 h-4" />
          Stock Status Matrix ({balances.length})
        </button>
        <button
          onClick={() => setActiveSubTab('ledger')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'ledger'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <History className="w-4 h-4" />
          Immutable Stock Ledger ({ledgerEntries.length})
        </button>
        <button
          onClick={() => setActiveSubTab('qc')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'qc'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ClipboardCheck className="w-4 h-4" />
          QC Inspections ({qcInspections.length})
        </button>
        <button
          onClick={() => setActiveSubTab('batches')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'batches'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Boxes className="w-4 h-4" />
          Batch Traceability ({batches.length})
        </button>
      </div>

      {/* Tab: Stock Balances */}
      {activeSubTab === 'balances' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Warehouse Stock Balance Matrix (Categorized by Physical & Quality Status)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Warehouse</th>
                  <th className="p-3">SKU & Item Name</th>
                  <th className="p-3 text-right">Available (Commercial)</th>
                  <th className="p-3 text-right">QC Pending</th>
                  <th className="p-3 text-right">QC Failed (Restricted)</th>
                  <th className="p-3 text-right">Total Physical Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {balances.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      No stock balances registered yet in this company.
                    </td>
                  </tr>
                ) : (
                  balances.map((b, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-3 font-medium text-slate-900">{b.warehouseCode} - {b.warehouseName}</td>
                      <td className="p-3">
                        <span className="font-mono font-bold text-indigo-600">{b.itemSku}</span>
                        <span className="text-slate-500 ml-1.5">({b.itemName})</span>
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-600">
                        {b.availableQuantity.toLocaleString()}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-purple-600">
                        {b.qcPendingQuantity.toLocaleString()}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-rose-600">
                        {b.qcFailedQuantity.toLocaleString()}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">
                        {((b.totalQuantity ?? b.totalPhysicalQuantity ?? (b.availableQuantity + b.qcPendingQuantity + b.qcFailedQuantity))).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Stock Ledger */}
      {activeSubTab === 'ledger' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Stock Movement Journal (Append-Only Immutable Ledger)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Item</th>
                  <th className="p-3">Batch</th>
                  <th className="p-3">Movement Type</th>
                  <th className="p-3">Stock Bucket</th>
                  <th className="p-3 text-right">Quantity</th>
                  <th className="p-3">Source Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      No stock movements recorded yet.
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-500">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="p-3 font-medium text-slate-900">{entry.item?.sku || entry.itemId}</td>
                      <td className="p-3 font-mono text-slate-700">{entry.batch?.batchNumber || '-'}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-[10px] font-semibold">
                          {entry.movementType}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            entry.stockStatus === 'AVAILABLE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : entry.stockStatus === 'QC_PENDING'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {entry.stockStatus}
                        </span>
                      </td>
                      <td className={`p-3 text-right font-mono font-bold ${entry.quantity >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {entry.quantity > 0 ? `+${entry.quantity}` : entry.quantity}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-indigo-600">
                        {entry.sourceDocumentType}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: QC Inspections */}
      {activeSubTab === 'qc' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Quality Control (QC) Inspection Orders
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Inspection #</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Receipt Ref</th>
                  <th className="p-3">Remarks</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {qcInspections.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      No QC inspections recorded yet.
                    </td>
                  </tr>
                ) : (
                  qcInspections.map((qc) => (
                    <tr key={qc.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{qc.inspectionNumber}</td>
                      <td className="p-3">{new Date(qc.inspectionDate).toLocaleDateString()}</td>
                      <td className="p-3 font-mono text-slate-700">{qc.receiptId}</td>
                      <td className="p-3 text-slate-500">{qc.remarks || '-'}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            qc.status === 'POSTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : qc.status === 'APPROVED'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {qc.status}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-1.5">
                        {qc.status === 'DRAFT' && (
                          <button
                            onClick={() => executeAction(`/api/v1/inventory/qc-inspections/${qc.id}/submit`)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] hover:bg-blue-700"
                          >
                            Submit
                          </button>
                        )}
                        {qc.status === 'SUBMITTED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/inventory/qc-inspections/${qc.id}/approve`)}
                            className="px-2 py-1 bg-indigo-600 text-white rounded text-[11px] hover:bg-indigo-700"
                          >
                            Approve
                          </button>
                        )}
                        {qc.status === 'APPROVED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/inventory/qc-inspections/${qc.id}/post`)}
                            className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded text-[11px] hover:bg-emerald-700 shadow-sm"
                          >
                            Post Inspection & Release Stock
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Batches */}
      {activeSubTab === 'batches' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Batch Master & Supplier Lot Traceability
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Batch Number</th>
                  <th className="p-3">Item SKU</th>
                  <th className="p-3">Supplier Lot #</th>
                  <th className="p-3">Mfg Date</th>
                  <th className="p-3">Expiry Date</th>
                  <th className="p-3 text-right">Unit Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      No batches recorded yet.
                    </td>
                  </tr>
                ) : (
                  batches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{batch.batchNumber}</td>
                      <td className="p-3 font-medium text-slate-900">{batch.item?.sku || batch.itemId}</td>
                      <td className="p-3 font-mono text-slate-600">{batch.supplierBatchNumber || '-'}</td>
                      <td className="p-3">{batch.manufacturingDate || '-'}</td>
                      <td className="p-3">{batch.expiryDate || '-'}</td>
                      <td className="p-3 text-right font-mono font-semibold">${batch.unitCost.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
