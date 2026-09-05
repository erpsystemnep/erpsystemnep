import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  PurchaseInvoice,
  PurchaseReceipt,
  BusinessPartner,
} from '../../../shared/types/index.js';
import {
  FileText,
  Plus,
  CheckCircle,
  XCircle,
  Send,
  RotateCcw,
  AlertTriangle,
  ShieldCheck,
  Building2,
  Calendar,
  Layers,
} from 'lucide-react';

interface PurchaseInvoicesTabProps {
  onRefreshNeeded: () => void;
}

export const PurchaseInvoicesTab: React.FC<PurchaseInvoicesTabProps> = ({ onRefreshNeeded }) => {
  const { activeCompany, token, user } = useAuth();
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [suppliers, setSuppliers] = useState<BusinessPartner[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [selectedReceiptId, setSelectedReceiptId] = useState('');
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState(1.0);
  const [invoiceLines, setInvoiceLines] = useState<
    Array<{
      purchaseReceiptLineId: string;
      poLineId?: string | null;
      itemId: string;
      itemName: string;
      itemSku: string;
      warehouseId?: string | null;
      uomId: string;
      uomCode: string;
      receivedQuantity: number;
      availableQuantity: number;
      quantity: number;
      unitPrice: number;
      discountRate: number;
      taxRate: number;
    }>
  >([]);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
    'x-company-id': activeCompany?.id || '',
  };

  const fetchInvoices = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      const [invRes, recRes, bpRes] = await Promise.all([
        fetch(`/api/v1/purchase/invoices?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/purchase/receipts?companyId=${activeCompany.id}&status=POSTED`, { headers }),
        fetch(`/api/v1/business-partners?companyId=${activeCompany.id}&partnerType=SUPPLIER`, { headers }),
      ]);

      if (invRes.ok) {
        const d = await invRes.json();
        setInvoices(d.data || []);
      }
      if (recRes.ok) {
        const d = await recRes.json();
        setReceipts(d.data || []);
      }
      if (bpRes.ok) {
        const d = await bpRes.json();
        setSuppliers(d.data || []);
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to load purchase invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [activeCompany?.id]);

  // When a GRN / Receipt is selected in the creation form
  const handleSelectReceipt = (receiptId: string) => {
    setSelectedReceiptId(receiptId);
    const receipt = receipts.find((r) => r.id === receiptId);
    if (!receipt) {
      setInvoiceLines([]);
      return;
    }
    if (receipt.supplierId) {
      setSelectedSupplierId(receipt.supplierId);
    }
    if ((receipt as any).currencyCode) {
      setCurrencyCode((receipt as any).currencyCode);
    }

    const lines = (receipt.lines || []).map((rl: any) => ({
      purchaseReceiptLineId: rl.id,
      poLineId: rl.poLineId || null,
      itemId: rl.itemId,
      itemName: rl.item?.name || rl.itemName || 'Material Item',
      itemSku: rl.item?.sku || rl.itemSku || 'SKU',
      warehouseId: rl.warehouseId || null,
      uomId: rl.uomId,
      uomCode: rl.uom?.code || rl.uomCode || 'PCS',
      receivedQuantity: Number(rl.receivedQuantity || 0),
      availableQuantity: Number(rl.receivedQuantity || 0), // Will be capped by backend check
      quantity: Number(rl.receivedQuantity || 0),
      unitPrice: Number(rl.unitCost || 100),
      discountRate: 0,
      taxRate: 10,
    }));
    setInvoiceLines(lines);
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId || invoiceLines.length === 0) {
      setActionError('Supplier and at least one invoice line are required');
      return;
    }

    setActionError(null);
    setActionSuccess(null);
    try {
      const payload = {
        supplierId: selectedSupplierId,
        receiptId: selectedReceiptId || undefined,
        supplierInvoiceRef: supplierInvoiceRef || undefined,
        invoiceDate,
        dueDate: dueDate || undefined,
        currencyCode,
        exchangeRate: Number(exchangeRate),
        lines: invoiceLines.map((l) => ({
          purchaseReceiptLineId: l.purchaseReceiptLineId,
          poLineId: l.poLineId,
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          uomId: l.uomId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountRate: Number(l.discountRate),
          taxRate: Number(l.taxRate),
        })),
      };

      const res = await fetch('/api/v1/purchase/invoices', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to create invoice');
      }

      setActionSuccess(`Purchase Invoice ${data.data.invoiceNumber} created successfully`);
      setShowCreateModal(false);
      fetchInvoices();
      onRefreshNeeded();
    } catch (err: any) {
      setActionError(err.message || 'Error creating purchase invoice');
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
      fetchInvoices();
      onRefreshNeeded();
    } catch (err: any) {
      setActionError(err.message || 'Action failed');
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Messages */}
      {actionError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
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
              <FileText className="w-4 h-4 text-indigo-600" />
              Purchase Invoices (Supplier Bills)
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Three-way matching against material receipts (GRN), SoD controls, and General Ledger posting.
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Purchase Invoice
          </button>
        </div>

        {/* Invoice Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="p-3">Invoice #</th>
                <th className="p-3">Supplier</th>
                <th className="p-3">Invoice Date</th>
                <th className="p-3">Total Amount</th>
                <th className="p-3">AP / GL Status</th>
                <th className="p-3">Workflow Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No purchase invoices recorded yet. Create an invoice matched from a posted GRN.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const isCreator = user?.id && inv.createdBy === user.id;
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono font-bold text-indigo-600">
                        {inv.invoiceNumber}
                        {inv.supplierInvoiceRef && (
                          <div className="text-[10px] font-normal text-slate-400">
                            Ref: {inv.supplierInvoiceRef}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-800">
                          {inv.supplier?.legalName || inv.supplierId}
                        </div>
                      </td>
                      <td className="p-3 text-slate-600">{inv.invoiceDate}</td>
                      <td className="p-3 font-bold text-slate-900">
                        {Number(inv.grandTotal).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <span className="text-[10px] text-slate-500">{inv.currencyCode}</span>
                      </td>
                      <td className="p-3">
                        {inv.payable ? (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              inv.payable.status === 'PAID'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inv.payable.status === 'PARTIALLY_PAID'
                                ? 'bg-amber-100 text-amber-800'
                                : inv.payable.status === 'OPEN'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            AP: {inv.payable.status}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Unposted</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            inv.status === 'POSTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : inv.status === 'APPROVED'
                              ? 'bg-blue-100 text-blue-800'
                              : inv.status === 'REVERSED'
                              ? 'bg-purple-100 text-purple-800'
                              : inv.status === 'REJECTED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                        {inv.status === 'DRAFT' && (
                          <button
                            onClick={() =>
                              executeAction(`/api/v1/purchase/invoices/${inv.id}/submit`)
                            }
                            className="px-2.5 py-1 bg-blue-600 text-white rounded text-[11px] font-medium hover:bg-blue-700"
                          >
                            Submit
                          </button>
                        )}

                        {inv.status === 'SUBMITTED' && (
                          <>
                            {isCreator ? (
                              <span
                                title="SoD Enforced: Creator cannot approve own purchase invoice"
                                className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[10px] font-medium"
                              >
                                <ShieldCheck className="w-3 h-3 text-amber-600" />
                                SoD: Awaiting Manager
                              </span>
                            ) : (
                              <button
                                onClick={() =>
                                  executeAction(`/api/v1/purchase/invoices/${inv.id}/approve`)
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
                                    `/api/v1/purchase/invoices/${inv.id}/reject`,
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

                        {inv.status === 'APPROVED' && (
                          <button
                            onClick={() =>
                              executeAction(`/api/v1/purchase/invoices/${inv.id}/post`)
                            }
                            className="px-3 py-1 bg-emerald-600 text-white font-bold rounded text-[11px] hover:bg-emerald-700 shadow-sm"
                          >
                            Post AP & GL
                          </button>
                        )}

                        {inv.status === 'POSTED' && (
                          <button
                            onClick={() => {
                              const reason = prompt('Reason for reversing purchase invoice:');
                              if (reason) {
                                executeAction(
                                  `/api/v1/purchase/invoices/${inv.id}/reverse`,
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

                        {['DRAFT', 'SUBMITTED'].includes(inv.status) && (
                          <button
                            onClick={() => {
                              const reason = prompt('Reason for cancellation:');
                              if (reason) {
                                executeAction(
                                  `/api/v1/purchase/invoices/${inv.id}/cancel`,
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

      {/* Modal: Create Purchase Invoice */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl my-8 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                Match & Create Purchase Invoice (Supplier Bill)
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInvoice} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Material Receipt (GRN)
                  </label>
                  <select
                    value={selectedReceiptId}
                    onChange={(e) => handleSelectReceipt(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Choose Posted GRN --</option>
                    {receipts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.receiptNumber} ({r.supplier?.legalName || 'Supplier'} - {r.receiptDate})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Supplier Business Partner *
                  </label>
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    required
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- Select Supplier --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.legalName} ({s.taxIdentifier || 'No Tax ID'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Supplier External Bill / Invoice Ref #
                  </label>
                  <input
                    type="text"
                    value={supplierInvoiceRef}
                    onChange={(e) => setSupplierInvoiceRef(e.target.value)}
                    placeholder="e.g. INV-2026-9812"
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Invoice Date
                    </label>
                    <input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Matched Receipt Lines with Ceilings */}
              <div className="border border-slate-200 rounded-xl overflow-hidden mt-4">
                <div className="bg-slate-50 p-2.5 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">
                    Line Matching & Quantity Invariant Ceilings
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Total Lines: {invoiceLines.length}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-60">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="p-2">Item / SKU</th>
                        <th className="p-2">Received Qty</th>
                        <th className="p-2">Invoice Qty</th>
                        <th className="p-2">Unit Price</th>
                        <th className="p-2">Disc %</th>
                        <th className="p-2">Tax %</th>
                        <th className="p-2 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoiceLines.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-4 text-center text-slate-400">
                            Select a Material Receipt (GRN) above to populate matching lines.
                          </td>
                        </tr>
                      ) : (
                        invoiceLines.map((l, idx) => {
                          const net = l.quantity * l.unitPrice * (1 - l.discountRate / 100);
                          const tax = net * (l.taxRate / 100);
                          const lineTotal = net + tax;
                          return (
                            <tr key={idx}>
                              <td className="p-2">
                                <div className="font-semibold text-slate-800">{l.itemName}</div>
                                <div className="text-[10px] text-slate-400">{l.itemSku}</div>
                              </td>
                              <td className="p-2 font-mono">
                                {l.receivedQuantity} {l.uomCode}
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0.0001"
                                  max={l.receivedQuantity}
                                  step="any"
                                  value={l.quantity}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    const updated = [...invoiceLines];
                                    updated[idx].quantity = val;
                                    setInvoiceLines(updated);
                                  }}
                                  className="w-20 p-1 border rounded text-xs font-mono font-bold text-slate-800"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={l.unitPrice}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    const updated = [...invoiceLines];
                                    updated[idx].unitPrice = val;
                                    setInvoiceLines(updated);
                                  }}
                                  className="w-20 p-1 border rounded text-xs font-mono"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={l.discountRate}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    const updated = [...invoiceLines];
                                    updated[idx].discountRate = val;
                                    setInvoiceLines(updated);
                                  }}
                                  className="w-14 p-1 border rounded text-xs font-mono"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="0"
                                  value={l.taxRate}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    const updated = [...invoiceLines];
                                    updated[idx].taxRate = val;
                                    setInvoiceLines(updated);
                                  }}
                                  className="w-14 p-1 border rounded text-xs font-mono"
                                />
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-slate-800">
                                {lineTotal.toFixed(2)}
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
                  disabled={invoiceLines.length === 0}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm"
                >
                  Create Purchase Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
