import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  PurchaseOrder,
  PurchaseReceipt,
  PurchaseReturn,
} from '../../../shared/types/index.js';
import {
  ShoppingCart,
  Receipt,
  RotateCcw,
  Plus,
  CheckCircle,
  XCircle,
  Send,
  FileText,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

export const PurchasingConsoleView: React.FC = () => {
  const { activeCompany, token } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'orders' | 'receipts' | 'returns'>('orders');

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchPurchasingData = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    setActionError(null);
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        'x-company-id': activeCompany.id,
      };

      const [orderRes, receiptRes, returnRes] = await Promise.all([
        fetch(`/api/v1/purchase/orders?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/purchase/receipts?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/purchase/returns?companyId=${activeCompany.id}`, { headers }),
      ]);

      if (orderRes.ok) {
        const d = await orderRes.json();
        setOrders(d.data || []);
      }
      if (receiptRes.ok) {
        const d = await receiptRes.json();
        setReceipts(d.data || []);
      }
      if (returnRes.ok) {
        const d = await returnRes.json();
        setReturns(d.data || []);
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to fetch purchasing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPurchasingData();
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
      fetchPurchasingData();
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
            <ShoppingCart className="w-5 h-5 text-indigo-600" />
            Purchasing & Procurement Operations
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage commercial purchase orders, goods receipt notes (GRN), and supplier returns with Segregation of Duties.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchPurchasingData}
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
          onClick={() => setActiveSubTab('orders')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'orders'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          Purchase Orders ({orders.length})
        </button>
        <button
          onClick={() => setActiveSubTab('receipts')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'receipts'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Receipt className="w-4 h-4" />
          Material Receipts / GRN ({receipts.length})
        </button>
        <button
          onClick={() => setActiveSubTab('returns')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'returns'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          Purchase Returns ({returns.length})
        </button>
      </div>

      {/* Tab: Purchase Orders */}
      {activeSubTab === 'orders' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Purchase Order Register</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">PO Number</th>
                  <th className="p-3">Supplier</th>
                  <th className="p-3">Order Date</th>
                  <th className="p-3">Total Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Workflow Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      No purchase orders recorded yet in this company.
                    </td>
                  </tr>
                ) : (
                  orders.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{po.poNumber}</td>
                      <td className="p-3 font-medium text-slate-900">{po.supplier?.legalName || po.supplierId}</td>
                      <td className="p-3">{po.orderDate}</td>
                      <td className="p-3 font-mono font-semibold">
                        {po.currencyCode} {po.grandTotal.toFixed(2)}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            po.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : po.status === 'SUBMITTED'
                              ? 'bg-blue-100 text-blue-800'
                              : po.status === 'REJECTED'
                              ? 'bg-red-100 text-red-800'
                              : po.status === 'CANCELLED'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {po.status}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-1.5">
                        {po.status === 'DRAFT' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/orders/${po.id}/submit`)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] hover:bg-blue-700"
                          >
                            Submit
                          </button>
                        )}
                        {po.status === 'SUBMITTED' && (
                          <>
                            <button
                              onClick={() => executeAction(`/api/v1/purchase/orders/${po.id}/approve`)}
                              className="px-2 py-1 bg-emerald-600 text-white rounded text-[11px] hover:bg-emerald-700"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => executeAction(`/api/v1/purchase/orders/${po.id}/reject`, 'POST', { reason: 'Commercial rejection' })}
                              className="px-2 py-1 bg-red-600 text-white rounded text-[11px] hover:bg-red-700"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {po.status !== 'CANCELLED' && po.status !== 'CLOSED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/orders/${po.id}/cancel`)}
                            className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-[11px] hover:bg-slate-300"
                          >
                            Cancel
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

      {/* Tab: Material Receipts */}
      {activeSubTab === 'receipts' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Goods Receipt Note (GRN) Register</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Receipt Number</th>
                  <th className="p-3">Supplier</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">QC Mandatory</th>
                  <th className="p-3">Total Val</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Workflow & Ledger Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receipts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      No material receipts recorded yet in this company.
                    </td>
                  </tr>
                ) : (
                  receipts.map((rc) => (
                    <tr key={rc.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{rc.receiptNumber}</td>
                      <td className="p-3 font-medium text-slate-900">{rc.supplier?.legalName || rc.supplierId}</td>
                      <td className="p-3">{new Date(rc.receiptDate).toLocaleDateString()}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            rc.qcRequired ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {rc.qcRequired ? 'QC REQUIRED (Pending)' : 'DIRECT RELEASE'}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-semibold">${rc.totalAmount.toFixed(2)}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            rc.status === 'POSTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : rc.status === 'APPROVED'
                              ? 'bg-blue-100 text-blue-800'
                              : rc.status === 'REVERSED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {rc.status}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-1.5">
                        {rc.status === 'DRAFT' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/receipts/${rc.id}/submit`)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] hover:bg-blue-700"
                          >
                            Submit
                          </button>
                        )}
                        {rc.status === 'SUBMITTED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/receipts/${rc.id}/approve`)}
                            className="px-2 py-1 bg-indigo-600 text-white rounded text-[11px] hover:bg-indigo-700"
                          >
                            Approve
                          </button>
                        )}
                        {rc.status === 'APPROVED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/receipts/${rc.id}/post`)}
                            className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded text-[11px] hover:bg-emerald-700 shadow-sm"
                          >
                            Post to Ledger
                          </button>
                        )}
                        {rc.status === 'POSTED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/receipts/${rc.id}/reverse`, 'POST', { reason: 'Material error' })}
                            className="px-2 py-1 bg-amber-600 text-white rounded text-[11px] hover:bg-amber-700"
                          >
                            Reverse
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

      {/* Tab: Purchase Returns */}
      {activeSubTab === 'returns' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Purchase Return Register (QC Rejections)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Return Number</th>
                  <th className="p-3">Supplier</th>
                  <th className="p-3">Reason</th>
                  <th className="p-3">Debit Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Workflow & Ledger Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {returns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      No purchase returns recorded yet in this company.
                    </td>
                  </tr>
                ) : (
                  returns.map((ret) => (
                    <tr key={ret.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{ret.returnNumber}</td>
                      <td className="p-3 font-medium text-slate-900">{ret.supplier?.legalName || ret.supplierId}</td>
                      <td className="p-3 text-slate-700">{ret.reason || 'QC Inspection Failure'}</td>
                      <td className="p-3 font-mono font-semibold">${ret.totalAmount.toFixed(2)}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            ret.status === 'POSTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : ret.status === 'APPROVED'
                              ? 'bg-blue-100 text-blue-800'
                              : ret.status === 'REVERSED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {ret.status}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-1.5">
                        {ret.status === 'DRAFT' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/returns/${ret.id}/submit`)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] hover:bg-blue-700"
                          >
                            Submit
                          </button>
                        )}
                        {ret.status === 'SUBMITTED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/returns/${ret.id}/approve`)}
                            className="px-2 py-1 bg-indigo-600 text-white rounded text-[11px] hover:bg-indigo-700"
                          >
                            Approve
                          </button>
                        )}
                        {ret.status === 'APPROVED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/returns/${ret.id}/post`)}
                            className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded text-[11px] hover:bg-emerald-700 shadow-sm"
                          >
                            Post Return
                          </button>
                        )}
                        {ret.status === 'POSTED' && (
                          <button
                            onClick={() => executeAction(`/api/v1/purchase/returns/${ret.id}/reverse`, 'POST', { reason: 'Supplier adjustment' })}
                            className="px-2 py-1 bg-amber-600 text-white rounded text-[11px] hover:bg-amber-700"
                          >
                            Reverse
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
    </div>
  );
};
