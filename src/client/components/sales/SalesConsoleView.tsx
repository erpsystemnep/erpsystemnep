import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  SalesInvoice,
  CustomerReceivable,
  SalesOrder,
  SalesDelivery,
  CustomerPayment,
  ChartOfAccount,
  PaymentMethod,
} from '../../../shared/types/index.js';
import {
  FileText,
  DollarSign,
  Plus,
  CheckCircle,
  XCircle,
  Send,
  RotateCcw,
  Ban,
  Eye,
  RefreshCw,
  Clock,
  Layers,
  ArrowRight,
  TrendingUp,
  CreditCard,
  Building2,
} from 'lucide-react';

export const SalesConsoleView: React.FC = () => {
  const { activeCompany, token, user } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<
    'invoices' | 'receivables' | 'payments' | 'new_invoice' | 'new_payment'
  >('invoices');

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [receivables, setReceivables] = useState<CustomerReceivable[]>([]);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [depositAccounts, setDepositAccounts] = useState<ChartOfAccount[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [deliveries, setDeliveries] = useState<SalesDelivery[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<SalesInvoice | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<CustomerPayment | null>(null);

  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // New Invoice Form State
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedDeliveryId, setSelectedDeliveryId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState(1.0);
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<
    Array<{
      itemId: string;
      warehouseId?: string;
      uomId: string;
      quantity: number;
      unitPrice: number;
      discountRate: number;
      taxRate: number;
      salesDeliveryLineId?: string;
      salesOrderLineId?: string;
    }>
  >([
    {
      itemId: '',
      uomId: '',
      quantity: 1,
      unitPrice: 0,
      discountRate: 0,
      taxRate: 0,
    },
  ]);

  // New Payment Form State
  const [payCustomerId, setPayCustomerId] = useState('');
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('BANK');
  const [payDepositAccountId, setPayDepositAccountId] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payAllocations, setPayAllocations] = useState<Record<string, number>>({});

  const fetchData = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    setActionError(null);
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        'x-company-id': activeCompany.id,
      };

      const [invRes, recRes, ordRes, delRes, payRes, accRes] = await Promise.all([
        fetch(`/api/v1/sales/invoices?limit=50`, { headers }),
        fetch(`/api/v1/sales/receivables?limit=50`, { headers }),
        fetch(`/api/v1/sales/orders?limit=50`, { headers }),
        fetch(`/api/v1/sales/deliveries?limit=50`, { headers }),
        fetch(`/api/v1/sales/payments?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/accounting/accounts?companyId=${activeCompany.id}&accountType=ASSET&isActive=true`, { headers }),
      ]);

      if (invRes.ok) {
        const d = await invRes.json();
        setInvoices(d.items || []);
      }
      if (recRes.ok) {
        const d = await recRes.json();
        setReceivables(d.items || []);
      }
      if (ordRes.ok) {
        const d = await ordRes.json();
        setOrders(d.items || []);
      }
      if (delRes.ok) {
        const d = await delRes.json();
        setDeliveries(d.items || []);
      }
      if (payRes.ok) {
        const d = await payRes.json();
        setPayments(d.data || []);
      }
      if (accRes.ok) {
        const d = await accRes.json();
        setDepositAccounts((d.data || []).filter((a: ChartOfAccount) => !a.isGroup));
      }
    } catch (err: any) {
      setActionError(err.message || 'Failed to fetch sales data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
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
      if (selectedInvoice && data.data) {
        setSelectedInvoice(data.data);
      }
      if (selectedPayment && data.data) {
        setSelectedPayment(data.data);
      }
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Action failed');
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      setActionError('Customer ID is required');
      return;
    }
    setActionError(null);
    setActionSuccess(null);

    const payload = {
      customerId: selectedCustomer,
      salesOrderId: selectedOrderId || undefined,
      deliveryId: selectedDeliveryId || undefined,
      currencyCode,
      exchangeRate: Number(exchangeRate),
      remarks: remarks || undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        warehouseId: l.warehouseId || undefined,
        uomId: l.uomId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountRate: Number(l.discountRate),
        taxRate: Number(l.taxRate),
        salesDeliveryLineId: l.salesDeliveryLineId || undefined,
        salesOrderLineId: l.salesOrderLineId || undefined,
      })),
    };

    try {
      const res = await fetch('/api/v1/sales/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
          'x-company-id': activeCompany?.id || '',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Creation failed');
      }
      setActionSuccess(`Invoice ${data.data.invoiceNumber} created as DRAFT`);
      setActiveSubTab('invoices');
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create invoice');
    }
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payCustomerId) {
      setActionError('Customer ID is required');
      return;
    }
    if (!payDepositAccountId) {
      setActionError('Deposit Account (Cash/Bank) is required');
      return;
    }
    if (payAmount <= 0) {
      setActionError('Payment amount must be greater than 0');
      return;
    }

    const allocationsList = Object.entries(payAllocations)
      .filter(([_, amt]) => amt > 0)
      .map(([recId, amt]) => ({
        receivableId: recId,
        allocatedAmount: amt,
      }));

    const totalAllocated = allocationsList.reduce((acc, a) => acc + a.allocatedAmount, 0);
    if (totalAllocated > payAmount) {
      setActionError(`Total allocated (${totalAllocated}) cannot exceed payment amount (${payAmount})`);
      return;
    }

    setActionError(null);
    setActionSuccess(null);

    const payload = {
      customerId: payCustomerId,
      depositAccountId: payDepositAccountId,
      amount: Number(payAmount),
      paymentDate: payDate,
      paymentMethod: payMethod,
      referenceNumber: payRef || undefined,
      notes: payNotes || undefined,
      allocations: allocationsList.length > 0 ? allocationsList : undefined,
    };

    try {
      const res = await fetch('/api/v1/sales/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
          'x-company-id': activeCompany?.id || '',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Creation failed');
      }
      setActionSuccess(`Payment receipt ${data.data.paymentNumber} created as DRAFT`);
      setActiveSubTab('payments');
      fetchData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create payment receipt');
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; border: string }> = {
      DRAFT: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
      SUBMITTED: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
      APPROVED: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
      REJECTED: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
      POSTED: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
      REVERSED: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
      CANCELLED: { bg: 'bg-slate-200', text: 'text-slate-600', border: 'border-slate-400' },
      OPEN: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
      UNPAID: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
      PARTIALLY_PAID: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
      PAID: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    };
    const c = map[status] || { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' };
    return (
      <span
        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}
      >
        {status}
      </span>
    );
  };

  const customerOpenReceivables = receivables.filter(
    (r) => r.customerId === payCustomerId && r.status !== 'PAID' && r.outstandingAmount > 0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">Sales Invoicing & Customer Payments</h2>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              Increment 1.2 Full AR & Payments
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Authoritative billing workflow, delivery ceiling controls, AR ledger, customer payments, and double-entry GL orchestration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="refresh-sales-btn"
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            id="new-invoice-tab-btn"
            onClick={() => {
              setSelectedInvoice(null);
              setSelectedPayment(null);
              setActiveSubTab('new_invoice');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New Sales Invoice
          </button>
          <button
            id="new-payment-tab-btn"
            onClick={() => {
              setSelectedInvoice(null);
              setSelectedPayment(null);
              setActiveSubTab('new_payment');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New Customer Payment
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm flex items-start gap-2">
          <XCircle className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" />
          <div>
            <p className="font-semibold">Operation Error</p>
            <p>{actionError}</p>
          </div>
        </div>
      )}
      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm flex items-start gap-2">
          <CheckCircle className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" />
          <div>
            <p className="font-semibold">Success</p>
            <p>{actionSuccess}</p>
          </div>
        </div>
      )}

      {/* Sub Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          id="tab-invoices"
          onClick={() => {
            setSelectedInvoice(null);
            setSelectedPayment(null);
            setActiveSubTab('invoices');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition ${
            activeSubTab === 'invoices'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          Sales Invoices ({invoices.length})
        </button>
        <button
          id="tab-receivables"
          onClick={() => {
            setSelectedInvoice(null);
            setSelectedPayment(null);
            setActiveSubTab('receivables');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition ${
            activeSubTab === 'receivables'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          Accounts Receivable Ledger ({receivables.length})
        </button>
        <button
          id="tab-payments"
          onClick={() => {
            setSelectedInvoice(null);
            setSelectedPayment(null);
            setActiveSubTab('payments');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition ${
            activeSubTab === 'payments'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          Customer Payments ({payments.length})
        </button>
      </div>

      {/* VIEW 1: Sales Invoices List */}
      {activeSubTab === 'invoices' && !selectedInvoice && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-sm">Customer Invoices</h3>
            <span className="text-xs text-slate-500">Showing {invoices.length} invoices</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Invoice Date</th>
                  <th className="py-3 px-4">Source References</th>
                  <th className="py-3 px-4 text-right">Subtotal</th>
                  <th className="py-3 px-4 text-right">Tax</th>
                  <th className="py-3 px-4 text-right">Grand Total</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-slate-400">
                      No sales invoices recorded yet. Click "New Sales Invoice" to draft one.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-mono font-bold text-indigo-600">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">{inv.customer?.tradeName || inv.customerId}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{inv.customer?.partnerCode}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{inv.invoiceDate}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {inv.salesOrder?.soNumber && <div>SO: {inv.salesOrder.soNumber}</div>}
                        {inv.deliveryId && <div>GDN: {inv.deliveryId.slice(0, 8)}...</div>}
                        {!inv.salesOrder?.soNumber && !inv.deliveryId && <span className="text-slate-400">Direct</span>}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        {Number(inv.subtotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500">
                        {Number(inv.taxTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {Number(inv.grandTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                        {inv.currencyCode}
                      </td>
                      <td className="py-3 px-4 text-center">{getStatusBadge(inv.status)}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          id={`view-invoice-${inv.id}`}
                          onClick={() => setSelectedInvoice(inv)}
                          className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded border border-indigo-200 transition inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW: Invoice Detail & Workflow Actions */}
      {selectedInvoice && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-slate-900 font-mono">
                    {selectedInvoice.invoiceNumber}
                  </h3>
                  {getStatusBadge(selectedInvoice.status)}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Created: {new Date(selectedInvoice.createdAt).toLocaleString()} | Currency: {selectedInvoice.currencyCode}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                >
                  Back to List
                </button>

                {selectedInvoice.status === 'DRAFT' && (
                  <button
                    id="submit-invoice-btn"
                    onClick={() => executeAction(`/api/v1/sales/invoices/${selectedInvoice.id}/submit`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Submit for Approval
                  </button>
                )}

                {selectedInvoice.status === 'SUBMITTED' && (
                  <>
                    <button
                      id="approve-invoice-btn"
                      onClick={() => executeAction(`/api/v1/sales/invoices/${selectedInvoice.id}/approve`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      id="reject-invoice-btn"
                      onClick={() => {
                        const reason = prompt('Enter rejection reason:');
                        if (reason) {
                          executeAction(`/api/v1/sales/invoices/${selectedInvoice.id}/reject`, 'POST', { reason });
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </>
                )}

                {selectedInvoice.status === 'APPROVED' && (
                  <button
                    id="post-invoice-btn"
                    onClick={() => executeAction(`/api/v1/sales/invoices/${selectedInvoice.id}/post`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Post (Lock & Post to AR)
                  </button>
                )}

                {selectedInvoice.status === 'POSTED' && (
                  <button
                    id="reverse-invoice-btn"
                    onClick={() => executeAction(`/api/v1/sales/invoices/${selectedInvoice.id}/reverse`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reverse Invoice
                  </button>
                )}
              </div>
            </div>

            {/* Line items table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Item</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Unit Price</th>
                    <th className="py-2.5 px-3 text-right">Discount</th>
                    <th className="py-2.5 px-3 text-right">Tax</th>
                    <th className="py-2.5 px-3 text-right">Net Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedInvoice.lines?.map((line) => (
                    <tr key={line.id}>
                      <td className="py-2.5 px-3 text-slate-400">{line.lineNumber}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800">{line.item?.itemName || line.itemId}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{line.item?.sku}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {line.quantity} {line.uom?.symbol || ''}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {Number(line.unitPrice).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                        {Number(line.discountAmount).toFixed(2)} ({line.discountRate}%)
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                        {Number(line.taxAmount).toFixed(2)} ({line.taxRate}%)
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {Number(line.lineNet).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Summary */}
            <div className="flex justify-end pt-4 border-t border-slate-100">
              <div className="w-64 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-mono">{Number(selectedInvoice.subtotal).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Discount:</span>
                  <span className="font-mono">-{Number(selectedInvoice.discountTotal).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tax:</span>
                  <span className="font-mono">+{Number(selectedInvoice.taxTotal).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Grand Total:</span>
                  <span className="font-mono">{Number(selectedInvoice.grandTotal).toFixed(2)} {selectedInvoice.currencyCode}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: Accounts Receivable Ledger */}
      {activeSubTab === 'receivables' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800 text-sm">Customer Receivables Ledger</h3>
              <p className="text-xs text-slate-400">Authoritative open financial obligations created by posted sales invoices</p>
            </div>
            <span className="text-xs text-slate-500">Showing {receivables.length} records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Receivable ID</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4 text-right">Invoice Amount</th>
                  <th className="py-3 px-4 text-right">Paid Amount</th>
                  <th className="py-3 px-4 text-right">Outstanding Balance</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receivables.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-400">
                      No customer receivables recorded. Post a Sales Invoice to establish AR obligations.
                    </td>
                  </tr>
                ) : (
                  receivables.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                        {rec.id.slice(0, 8)}...
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">{rec.customer?.tradeName || rec.customerId}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{rec.customer?.partnerCode}</div>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-indigo-600">
                        {rec.invoice?.invoiceNumber || rec.salesInvoiceId}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{rec.dueDate || 'Immediate'}</td>
                      <td className="py-3 px-4 text-right font-mono">
                        {Number(rec.invoiceAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-600">
                        {Number(rec.paidAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-700">
                        {Number(rec.outstandingAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                        {rec.currencyCode}
                      </td>
                      <td className="py-3 px-4 text-center">{getStatusBadge(rec.status)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: Customer Payments List */}
      {activeSubTab === 'payments' && !selectedPayment && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800 text-sm">Customer Payment Receipts</h3>
              <p className="text-xs text-slate-400">Cash, bank, and electronic settlements with automated GL journal entries</p>
            </div>
            <span className="text-xs text-slate-500">Showing {payments.length} payments</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Payment #</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Deposit Account</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-400">
                      No payment receipts found. Click "New Customer Payment" to record a payment.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-mono font-bold text-indigo-600">{p.paymentNumber}</td>
                      <td className="py-3 px-4 font-mono">{p.paymentDate}</td>
                      <td className="py-3 px-4 font-medium text-slate-800">{p.customer?.legalName || p.customerId}</td>
                      <td className="py-3 px-4 font-semibold text-slate-700">{p.paymentMethod}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">
                        {p.depositAccount?.accountCode} - {p.depositAccount?.accountName}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        ${Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                        {p.currencyCode}
                      </td>
                      <td className="py-3 px-4 text-center">{getStatusBadge(p.status)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {p.status === 'DRAFT' && (
                            <button
                              onClick={() => executeAction(`/api/v1/sales/payments/${p.id}/submit`)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                            >
                              <Send className="w-3.5 h-3.5 inline mr-1" />
                              Submit
                            </button>
                          )}
                          {p.status === 'SUBMITTED' && (
                            <button
                              onClick={() => executeAction(`/api/v1/sales/payments/${p.id}/approve`)}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded"
                            >
                              <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
                              Approve
                            </button>
                          )}
                          {p.status === 'APPROVED' && (
                            <button
                              onClick={() => executeAction(`/api/v1/sales/payments/${p.id}/post`)}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-sm"
                            >
                              <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
                              Post to GL & AR
                            </button>
                          )}
                          {p.status === 'POSTED' && (
                            <button
                              onClick={() => executeAction(`/api/v1/sales/payments/${p.id}/reverse`)}
                              className="px-2.5 py-1 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded"
                            >
                              <RotateCcw className="w-3.5 h-3.5 inline mr-1" />
                              Reverse
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 4: New Customer Payment Form */}
      {activeSubTab === 'new_payment' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-base font-bold text-slate-900">Record Customer Payment</h3>
            <p className="text-xs text-slate-500 mt-1">
              Process customer receipts, allocate payments to outstanding invoices, and prepare GL entries
            </p>
          </div>

          <form onSubmit={handleCreatePayment} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Customer ID *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. PARTNER-UUID"
                  value={payCustomerId}
                  onChange={(e) => setPayCustomerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deposit Account (Cash/Bank) *</label>
                <select
                  required
                  value={payDepositAccountId}
                  onChange={(e) => setPayDepositAccountId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                >
                  <option value="">-- Select Cash/Bank Account --</option>
                  {depositAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountCode} - {a.accountName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Method *</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                >
                  <option value="BANK">Bank Transfer</option>
                  <option value="CASH">Cash</option>
                  <option value="CREDIT_CARD">Credit Card</option>
                  <option value="CHECK">Check</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Receipt Amount ($) *</label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0.01"
                  value={payAmount || ''}
                  onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Date *</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Reference / Check #</label>
                <input
                  type="text"
                  placeholder="e.g. TXN-998823"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            {/* Receivables Settlement Allocation */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Allocate against Open Receivables for Customer
                </h4>
                {customerOpenReceivables.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      let remaining = payAmount;
                      const allocs: Record<string, number> = {};
                      for (const rec of customerOpenReceivables) {
                        if (remaining <= 0) break;
                        const take = Math.min(remaining, rec.outstandingAmount);
                        allocs[rec.id] = take;
                        remaining -= take;
                      }
                      setPayAllocations(allocs);
                    }}
                    className="px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded"
                  >
                    Auto-Allocate Full Amount
                  </button>
                )}
              </div>

              {payCustomerId ? (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Invoice #</th>
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3 text-right">Invoice Total</th>
                        <th className="py-2 px-3 text-right">Outstanding</th>
                        <th className="py-2 px-3 text-right w-44">Allocated Amount ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {customerOpenReceivables.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-slate-400">
                            No open receivables found for customer ID '{payCustomerId}'. Payment can be recorded as unallocated advance.
                          </td>
                        </tr>
                      ) : (
                        customerOpenReceivables.map((rec) => (
                          <tr key={rec.id}>
                            <td className="py-2 px-3 font-mono font-bold text-indigo-600">
                              {rec.invoice?.invoiceNumber || rec.salesInvoiceId}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{rec.invoiceDate}</td>
                            <td className="py-2 px-3 text-right font-mono">${rec.invoiceAmount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right font-mono font-semibold text-amber-700">
                              ${rec.outstandingAmount.toFixed(2)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max={rec.outstandingAmount}
                                value={payAllocations[rec.id] || ''}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setPayAllocations({ ...payAllocations, [rec.id]: val });
                                }}
                                className="w-full px-2 py-1 border border-slate-300 rounded text-right font-mono"
                              />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 rounded-lg text-slate-400 text-xs text-center border border-dashed border-slate-200">
                  Enter a Customer ID above to load open receivables for settlement.
                </div>
              )}
            </div>

            <div>
              <label className="block font-semibold text-slate-700 text-xs mb-1">Notes / Remarks</label>
              <textarea
                rows={2}
                placeholder="Payment memo or reference note..."
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setActiveSubTab('payments')}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
              >
                Create Draft Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* VIEW 5: New Sales Invoice Form */}
      {activeSubTab === 'new_invoice' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-base font-bold text-slate-900">Create New Sales Invoice</h3>
            <p className="text-xs text-slate-500 mt-1">
              Draft customer billing with strict delivery quantity ceiling checks
            </p>
          </div>

          <form onSubmit={handleCreateInvoice} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Customer ID *</label>
                <input
                  id="invoice-customer-input"
                  type="text"
                  required
                  placeholder="e.g. PARTNER-UUID"
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Sales Order (Optional)</label>
                <select
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                >
                  <option value="">-- No Direct Order Link --</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.soNumber} ({o.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Delivery / GDN ID (Optional)</label>
                <select
                  value={selectedDeliveryId}
                  onChange={(e) => setSelectedDeliveryId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                >
                  <option value="">-- Direct / Non-Fulfillment --</option>
                  {deliveries.map((d) => (
                    <option key={d.id} value={d.id}>
                      GDN: {d.id.slice(0, 8)}... ({d.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Currency Code</label>
                <input
                  type="text"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Exchange Rate</label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 1.0)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            {/* Lines Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Invoice Lines</h4>
                <button
                  type="button"
                  onClick={() =>
                    setLines([
                      ...lines,
                      {
                        itemId: '',
                        uomId: '',
                        quantity: 1,
                        unitPrice: 0,
                        discountRate: 0,
                        taxRate: 0,
                      },
                    ])
                  }
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Line
                </button>
              </div>

              <div className="space-y-3">
                {lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-200 grid grid-cols-2 sm:grid-cols-7 gap-2 items-center"
                  >
                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-400 block mb-0.5">Item ID *</label>
                      <input
                        type="text"
                        required
                        placeholder="ITEM-UUID"
                        value={line.itemId}
                        onChange={(e) => {
                          const updated = [...lines];
                          updated[idx].itemId = e.target.value;
                          setLines(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">UOM ID *</label>
                      <input
                        type="text"
                        required
                        placeholder="UOM-UUID"
                        value={line.uomId}
                        onChange={(e) => {
                          const updated = [...lines];
                          updated[idx].uomId = e.target.value;
                          setLines(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Quantity *</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0.001"
                        required
                        value={line.quantity}
                        onChange={(e) => {
                          const updated = [...lines];
                          updated[idx].quantity = parseFloat(e.target.value) || 0;
                          setLines(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Unit Price ($) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={line.unitPrice}
                        onChange={(e) => {
                          const updated = [...lines];
                          updated[idx].unitPrice = parseFloat(e.target.value) || 0;
                          setLines(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Discount (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={line.discountRate}
                        onChange={(e) => {
                          const updated = [...lines];
                          updated[idx].discountRate = parseFloat(e.target.value) || 0;
                          setLines(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Tax Rate (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={line.taxRate}
                        onChange={(e) => {
                          const updated = [...lines];
                          updated[idx].taxRate = parseFloat(e.target.value) || 0;
                          setLines(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Remarks */}
            <div>
              <label className="block font-semibold text-slate-700 text-xs mb-1">Remarks / Terms</label>
              <textarea
                rows={2}
                placeholder="Invoice notes, payment terms, or reference details..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
              />
            </div>

            {/* Submit Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setActiveSubTab('invoices')}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                id="submit-create-invoice-btn"
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition"
              >
                Create Draft Invoice
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
