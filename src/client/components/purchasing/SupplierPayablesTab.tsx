import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { SupplierPayable, BusinessPartner } from '../../../shared/types/index.js';
import {
  CreditCard,
  Building2,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
  Search,
} from 'lucide-react';

export const SupplierPayablesTab: React.FC = () => {
  const { activeCompany, token } = useAuth();
  const [payables, setPayables] = useState<SupplierPayable[]>([]);
  const [suppliers, setSuppliers] = useState<BusinessPartner[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
    'x-company-id': activeCompany?.id || '',
  };

  const fetchPayables = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      let url = `/api/v1/purchase/payables?companyId=${activeCompany.id}`;
      if (filterSupplier) url += `&supplierId=${filterSupplier}`;
      if (filterStatus) url += `&status=${filterStatus}`;

      const [payRes, bpRes] = await Promise.all([
        fetch(url, { headers }),
        fetch(`/api/v1/business-partners?companyId=${activeCompany.id}&partnerType=SUPPLIER`, { headers }),
      ]);

      if (payRes.ok) {
        const d = await payRes.json();
        setPayables(d.data || []);
      }
      if (bpRes.ok) {
        const d = await bpRes.json();
        setSuppliers(d.data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayables();
  }, [activeCompany?.id, filterSupplier, filterStatus]);

  // Aggregate metrics
  const totalInvoiced = payables.reduce((acc, p) => acc + Number(p.invoiceAmount), 0);
  const totalPaid = payables.reduce((acc, p) => acc + Number(p.paidAmount), 0);
  const totalOutstanding = payables.reduce(
    (acc, p) => (p.status !== 'REVERSED' && p.status !== 'CANCELLED' ? acc + Number(p.outstandingAmount) : acc),
    0
  );
  const openCount = payables.filter((p) => p.status === 'OPEN' || p.status === 'PARTIALLY_PAID').length;

  return (
    <div className="space-y-4">
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Total AP Obligations</span>
            <DollarSign className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 font-mono">
            ${totalInvoiced.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Total invoiced payables</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Settled Disbursements</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold text-emerald-600 font-mono">
            ${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Paid to suppliers</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Outstanding Net Balance</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold text-amber-600 font-mono">
            ${totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Open payables balance</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Open Invoices</span>
            <AlertCircle className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 font-mono">{openCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Awaiting complete settlement</div>
        </div>
      </div>

      {/* Payables Register */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard className="w-4 h-4 text-indigo-600" />
              Accounts Payable (AP) Ledger & Balances
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Authoritative supplier open item register, settlement history, and remaining balances.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
              className="text-xs p-1.5 rounded-lg border border-slate-300 focus:outline-none"
            >
              <option value="">All Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.legalName}
                </option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-xs p-1.5 rounded-lg border border-slate-300 focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="OPEN">OPEN</option>
              <option value="PARTIALLY_PAID">PARTIALLY_PAID</option>
              <option value="PAID">PAID</option>
              <option value="REVERSED">REVERSED</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3">Invoice Ref</th>
                <th className="p-3">Supplier</th>
                <th className="p-3">Invoice Date</th>
                <th className="p-3">Due Date</th>
                <th className="p-3">Invoice Amount</th>
                <th className="p-3">Paid Amount</th>
                <th className="p-3">Outstanding Balance</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payables.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    No supplier payables matching filter criteria.
                  </td>
                </tr>
              ) : (
                payables.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-bold text-indigo-600">
                      {p.invoice?.invoiceNumber || p.purchaseInvoiceId.substring(0, 8)}
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-800">
                        {p.supplier?.legalName || p.supplierId}
                      </div>
                    </td>
                    <td className="p-3 text-slate-600">{p.invoiceDate}</td>
                    <td className="p-3 text-slate-600">{p.dueDate || '-'}</td>
                    <td className="p-3 font-mono text-slate-900 font-semibold">
                      {Number(p.invoiceAmount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      <span className="text-[10px] text-slate-400">{p.currencyCode}</span>
                    </td>
                    <td className="p-3 font-mono text-emerald-600 font-semibold">
                      {Number(p.paidAmount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      <span className="text-[10px] text-slate-400">{p.currencyCode}</span>
                    </td>
                    <td className="p-3 font-mono text-amber-700 font-bold">
                      {Number(p.outstandingAmount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      <span className="text-[10px] text-slate-400">{p.currencyCode}</span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          p.status === 'PAID'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.status === 'PARTIALLY_PAID'
                            ? 'bg-amber-100 text-amber-800'
                            : p.status === 'OPEN'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
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
