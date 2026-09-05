import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  SupplierPayment,
  SupplierPayable,
  BusinessPartner,
  ChartOfAccount,
} from '../../../shared/types/index.js';
import {
  Send,
  Plus,
  CheckCircle,
  XCircle,
  RotateCcw,
  AlertCircle,
  ShieldCheck,
  CreditCard,
  Building,
} from 'lucide-react';

interface SupplierPaymentsTabProps {
  onRefreshNeeded: () => void;
}

export const SupplierPaymentsTab: React.FC<SupplierPaymentsTabProps> = ({ onRefreshNeeded }) => {
  const { activeCompany, token, user } = useAuth();
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [suppliers, setSuppliers] = useState<BusinessPartner[]>([]);
  const [bankAccounts, setBankAccounts] = useState<ChartOfAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<'BANK' | 'CASH' | 'CHECK'>('BANK');
  const [disbursementAccountId, setDisbursementAccountId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [openPayables, setOpenPayables] = useState<SupplierPayable[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  const headers = {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
    'x-company-id': activeCompany?.id || '',
  };

  const fetchPayments = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      const [payRes, bpRes, coaRes] = await Promise.all([
        fetch(`/api/v1/purchase/payments?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/business-partners?companyId=${activeCompany.id}&partnerType=SUPPLIER`, { headers }),
        fetch(`/api/v1/accounting/accounts?companyId=${activeCompany.id}&accountType=ASSET`, { headers }),
      ]);

      if (payRes.ok) {
        const d = await payRes.json();
        setPayments(d.data || []);
      }
      if (bpRes.ok) {
        const d = await bpRes.json();
        setSuppliers(d.data || []);
      }
      if (coaRes.ok) {
        const d = await coaRes.json();
        const accounts: ChartOfAccount[] = d.data || [];
        const liquid = accounts.filter((a) => !a.isGroup && a.isActive);
        setBankAccounts(liquid);
        if (liquid.length > 0 && !disbursementAccountId) {
          setDisbursementAccountId(liquid[0].id);
        }
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to fetch payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [activeCompany?.id]);

  // When supplier is selected, fetch open payables for allocation
  const handleSelectSupplier = async (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setOpenPayables([]);
    setAllocations({});
    if (!supplierId || !activeCompany?.id) return;

    try {
      const res = await fetch(`/api/v1/purchase/payables/supplier/${supplierId}/open`, { headers });
      if (res.ok) {
        const d = await res.json();
        setOpenPayables(d.data || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId || !disbursementAccountId || paymentAmount <= 0) {
      setActionError('Please specify supplier, amount, and disbursement account');
      return;
    }

    const allocList = Object.entries(allocations)
      .filter(([_, amt]) => amt > 0)
      .map(([payableId, allocatedAmount]) => ({
        payableId,
        allocatedAmount: Number(allocatedAmount),
      }));

    const totalAllocated = allocList.reduce((acc, a) => acc + a.allocatedAmount, 0);
    if (totalAllocated > paymentAmount) {
      setActionError(`Total allocations (${totalAllocated}) cannot exceed payment amount (${paymentAmount})`);
      return;
    }

    setActionError(null);
    setActionSuccess(null);
    try {
      const payload = {
        supplierId: selectedSupplierId,
        paymentDate,
        amount: Number(paymentAmount),
        currencyCode: 'USD',
        exchangeRate: 1.0,
        paymentMethod,
        disbursementAccountId,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
        allocations: allocList,
      };

      const res = await fetch('/api/v1/purchase/payments', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Payment creation failed');
      }

      setActionSuccess(`Supplier Payment ${data.data.paymentNumber} created successfully`);
      setShowCreateModal(false);
      fetchPayments();
      onRefreshNeeded();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create payment');
    }
  };

  const executeAction = async (endpoint: string, method: string = 'POST', body?: any) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Action failed');
      }
      setActionSuccess('Action executed successfully');
      fetchPayments();
      onRefreshNeeded();
    } catch (err: any) {
      setActionError(err.message || 'Action failed');
    }
  };

  return (
    <div className="space-y-4">
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

      {/* Header bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Send className="w-4 h-4 text-indigo-600" />
              Supplier Payments & Disbursements
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Multi-payable settlement, SoD dual control approval, and double-entry General Ledger posting.
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Supplier Payment
          </button>
        </div>

        {/* Payments Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3">Payment #</th>
                <th className="p-3">Supplier</th>
                <th className="p-3">Payment Date</th>
                <th className="p-3">Method</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Workflow Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No supplier payments recorded yet. Draft a payment to allocate against open payables.
                  </td>
                </tr>
              ) : (
                payments.map((pmt) => {
                  const isCreator = user?.id && pmt.createdBy === user.id;
                  return (
                    <tr key={pmt.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono font-bold text-indigo-600">{pmt.paymentNumber}</td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-800">
                          {pmt.supplier?.legalName || pmt.supplierId}
                        </div>
                      </td>
                      <td className="p-3 text-slate-600">{pmt.paymentDate}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-semibold text-slate-700">
                          {pmt.paymentMethod}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-emerald-600 font-mono">
                        ${Number(pmt.amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <span className="text-[10px] text-slate-400">{pmt.currencyCode}</span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            pmt.status === 'POSTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : pmt.status === 'APPROVED'
                              ? 'bg-blue-100 text-blue-800'
                              : pmt.status === 'REVERSED'
                              ? 'bg-purple-100 text-purple-800'
                              : pmt.status === 'REJECTED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {pmt.status}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                        {pmt.status === 'DRAFT' && (
                          <button
                            onClick={() =>
                              executeAction(`/api/v1/purchase/payments/${pmt.id}/submit`)
                            }
                            className="px-2.5 py-1 bg-blue-600 text-white rounded text-[11px] font-medium hover:bg-blue-700"
                          >
                            Submit
                          </button>
                        )}

                        {pmt.status === 'SUBMITTED' && (
                          <>
                            {isCreator ? (
                              <span
                                title="SoD Enforced: Creator cannot approve own supplier payment"
                                className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[10px] font-medium"
                              >
                                <ShieldCheck className="w-3 h-3 text-amber-600" />
                                SoD: Awaiting Manager
                              </span>
                            ) : (
                              <button
                                onClick={() =>
                                  executeAction(`/api/v1/purchase/payments/${pmt.id}/approve`)
                                }
                                className="px-2.5 py-1 bg-indigo-600 text-white rounded text-[11px] font-medium hover:bg-indigo-700"
                              >
                                Approve
                              </button>
                            )}
                            <button
                              onClick={() => {
                                const reason = prompt('Reason for rejection:');
                                if (reason) {
                                  executeAction(
                                    `/api/v1/purchase/payments/${pmt.id}/reject`,
                                    'POST',
                                    { reason }
                                  );
                                }
                              }}
                              className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-[11px] hover:bg-slate-300"
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {pmt.status === 'APPROVED' && (
                          <button
                            onClick={() =>
                              executeAction(`/api/v1/purchase/payments/${pmt.id}/post`)
                            }
                            className="px-3 py-1 bg-emerald-600 text-white font-bold rounded text-[11px] hover:bg-emerald-700 shadow-sm"
                          >
                            Post Settlement & GL
                          </button>
                        )}

                        {pmt.status === 'POSTED' && (
                          <button
                            onClick={() => {
                              const reason = prompt('Reason for reversing supplier payment:');
                              if (reason) {
                                executeAction(
                                  `/api/v1/purchase/payments/${pmt.id}/reverse`,
                                  'POST',
                                  { reason }
                                );
                              }
                            }}
                            className="px-2 py-1 bg-purple-600 text-white rounded text-[11px] hover:bg-purple-700"
                          >
                            Reverse
                          </button>
                        )}

                        {['DRAFT', 'SUBMITTED'].includes(pmt.status) && (
                          <button
                            onClick={() => {
                              const reason = prompt('Reason for cancellation:');
                              if (reason) {
                                executeAction(
                                  `/api/v1/purchase/payments/${pmt.id}/cancel`,
                                  'POST',
                                  { reason }
                                );
                              }
                            }}
                            className="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-[11px]"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: New Supplier Payment & Allocation */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl my-8 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Send className="w-4 h-4 text-indigo-600" />
                Disburse Supplier Payment & Allocate Payables
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePayment} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Supplier Business Partner *
                  </label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => handleSelectSupplier(e.target.value)}
                    required
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Select Supplier --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.legalName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Amount ($) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={paymentAmount || ''}
                    onChange={(e) => setPaymentAmount(Number(e.target.value))}
                    required
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Disbursement Account (Cash / Bank) *
                  </label>
                  <select
                    value={disbursementAccountId}
                    onChange={(e) => setDisbursementAccountId(e.target.value)}
                    required
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Select Disbursing Account --</option>
                    {bankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} - {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Date
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Open Payables Allocation Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden mt-4">
                <div className="bg-slate-50 p-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">
                    Allocate to Open Supplier Invoices
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Open Invoices: {openPayables.length}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-52">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="p-2">Invoice #</th>
                        <th className="p-2">Invoice Date</th>
                        <th className="p-2">Total Invoiced</th>
                        <th className="p-2">Outstanding</th>
                        <th className="p-2 text-right">Allocate ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {openPayables.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-4 text-center text-slate-400">
                            {selectedSupplierId
                              ? 'No open payables found for this supplier.'
                              : 'Select a supplier to view open invoices for allocation.'}
                          </td>
                        </tr>
                      ) : (
                        openPayables.map((p) => {
                          const currentAlloc = allocations[p.id] || 0;
                          return (
                            <tr key={p.id}>
                              <td className="p-2 font-mono font-bold text-indigo-600">
                                {p.invoice?.invoiceNumber || p.purchaseInvoiceId.substring(0, 8)}
                              </td>
                              <td className="p-2 text-slate-600">{p.invoiceDate}</td>
                              <td className="p-2 font-mono">${Number(p.invoiceAmount).toFixed(2)}</td>
                              <td className="p-2 font-mono font-bold text-amber-700">
                                ${Number(p.outstandingAmount).toFixed(2)}
                              </td>
                              <td className="p-2 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  max={p.outstandingAmount}
                                  step="any"
                                  value={currentAlloc || ''}
                                  placeholder="0.00"
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setAllocations({
                                      ...allocations,
                                      [p.id]: val,
                                    });
                                  }}
                                  className="w-24 p-1 border rounded text-xs text-right font-mono font-bold text-slate-800"
                                />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paymentAmount <= 0}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm"
                >
                  Create & Record Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
