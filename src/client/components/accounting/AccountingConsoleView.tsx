import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  ChartOfAccount,
  AccountingJournal,
  AccountType,
} from '../../../shared/types/index.js';
import {
  BookOpen,
  List,
  Plus,
  CheckCircle,
  XCircle,
  RotateCcw,
  Send,
  RefreshCw,
  FolderTree,
  Scale,
  DollarSign,
  Layers,
  ArrowRight,
} from 'lucide-react';

export const AccountingConsoleView: React.FC = () => {
  const { activeCompany, token } = useAuth();
  const [activeTab, setActiveTab] = useState<'accounts' | 'journals' | 'new_journal' | 'new_account'>('accounts');

  // Accounts state
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [accountFilterType, setAccountFilterType] = useState<string>('ALL');

  // Journals state
  const [journals, setJournals] = useState<AccountingJournal[]>([]);
  const [selectedJournal, setSelectedJournal] = useState<AccountingJournal | null>(null);
  const [journalFilterStatus, setJournalFilterStatus] = useState<string>('ALL');

  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // New Account form state
  const [accCode, setAccCode] = useState('');
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('ASSET');
  const [accParentId, setAccParentId] = useState('');
  const [accIsGroup, setAccIsGroup] = useState(false);
  const [accDesc, setAccDesc] = useState('');

  // New Journal form state
  const [jPostingDate, setJPostingDate] = useState(new Date().toISOString().split('T')[0]);
  const [jDescription, setJDescription] = useState('');
  const [jLines, setJLines] = useState<
    Array<{
      accountId: string;
      debit: number;
      credit: number;
      description: string;
    }>
  >([
    { accountId: '', debit: 0, credit: 0, description: '' },
    { accountId: '', debit: 0, credit: 0, description: '' },
  ]);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
  };

  const fetchAccounts = async () => {
    if (!activeCompany) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/v1/accounting/accounts?companyId=${activeCompany.id}`, { headers });
      const json = await res.json();
      if (json.success) {
        setAccounts(json.data || []);
      }
    } catch (err: any) {
      console.error('Error fetching chart of accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchJournals = async () => {
    if (!activeCompany) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/v1/accounting/journals?companyId=${activeCompany.id}`, { headers });
      const json = await res.json();
      if (json.success) {
        setJournals(json.data || []);
      }
    } catch (err: any) {
      console.error('Error fetching journals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    fetchJournals();
  }, [activeCompany]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    try {
      setLoading(true);
      const payload = {
        accountCode: accCode.trim(),
        accountName: accName.trim(),
        accountType: accType,
        parentAccountId: accParentId || undefined,
        isGroup: accIsGroup,
        description: accDesc.trim() || undefined,
      };

      const res = await fetch('/api/v1/accounting/accounts', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to create account');
      }

      setActionSuccess(`Account ${data.data.accountCode} - ${data.data.accountName} created successfully.`);
      setAccCode('');
      setAccName('');
      setAccDesc('');
      setAccParentId('');
      setAccIsGroup(false);
      setActiveTab('accounts');
      fetchAccounts();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    const totalDebit = jLines.reduce((acc, l) => acc + (Number(l.debit) || 0), 0);
    const totalCredit = jLines.reduce((acc, l) => acc + (Number(l.credit) || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      setActionError(`Journal out of balance: Total Debit (${totalDebit}) != Total Credit (${totalCredit})`);
      return;
    }

    try {
      setLoading(true);
      const payload = {
        postingDate: jPostingDate,
        description: jDescription,
        lines: jLines.map((l, idx) => ({
          lineNumber: idx + 1,
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || undefined,
        })),
      };

      const res = await fetch('/api/v1/accounting/journals', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to create journal entry');
      }

      setActionSuccess(`Journal Voucher ${data.data.journalNumber} created.`);
      setActiveTab('journals');
      fetchJournals();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJournalAction = async (journalId: string, action: 'submit' | 'approve' | 'post' | 'reverse') => {
    setActionError(null);
    setActionSuccess(null);
    try {
      setLoading(true);
      const res = await fetch(`/api/v1/accounting/journals/${journalId}/${action}`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || `Failed to ${action} journal`);
      }
      setActionSuccess(`Journal ${action} completed successfully.`);
      fetchJournals();
      setSelectedJournal(null);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredAccounts = accounts.filter((acc) => {
    if (accountFilterType !== 'ALL' && acc.accountType !== accountFilterType) return false;
    return true;
  });

  const filteredJournals = journals.filter((j) => {
    if (journalFilterStatus !== 'ALL' && j.status !== journalFilterStatus) return false;
    return true;
  });

  const totalDebitSum = jLines.reduce((acc, l) => acc + (Number(l.debit) || 0), 0);
  const totalCreditSum = jLines.reduce((acc, l) => acc + (Number(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebitSum - totalCreditSum) < 0.0001 && totalDebitSum > 0;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-7 h-7 text-indigo-600" />
            General Ledger & Chart of Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Authoritative double-entry general ledger, chart of accounts catalog, and journal vouchers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              fetchAccounts();
              fetchJournals();
            }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setActiveTab('new_account')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Account
          </button>
          <button
            onClick={() => setActiveTab('new_journal')}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Journal Entry
          </button>
        </div>
      </div>

      {/* Action Banners */}
      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-600 hover:text-emerald-900">
            &times;
          </button>
        </div>
      )}
      {actionError && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-600 hover:text-rose-900">
            &times;
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => setActiveTab('accounts')}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'accounts'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FolderTree className="w-4 h-4" />
          Chart of Accounts ({accounts.length})
        </button>
        <button
          onClick={() => setActiveTab('journals')}
          className={`pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'journals'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <List className="w-4 h-4" />
          Journal Vouchers ({journals.length})
        </button>
      </div>

      {/* TAB 1: CHART OF ACCOUNTS */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Account Type:</span>
            {['ALL', 'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((t) => (
              <button
                key={t}
                onClick={() => setAccountFilterType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  accountFilterType === t
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-700 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3.5">Code</th>
                  <th className="px-6 py-3.5">Account Name</th>
                  <th className="px-6 py-3.5">Type</th>
                  <th className="px-6 py-3.5">Category</th>
                  <th className="px-6 py-3.5">Currency</th>
                  <th className="px-6 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                      No accounts found. Click "New Account" to configure standard general ledger accounts.
                    </td>
                  </tr>
                ) : (
                  filteredAccounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-mono font-bold text-slate-900">{acc.accountCode}</td>
                      <td className="px-6 py-4 font-medium text-slate-800">
                        {acc.isGroup ? <span className="font-bold text-indigo-900">{acc.accountName}</span> : acc.accountName}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            acc.accountType === 'ASSET'
                              ? 'bg-blue-50 text-blue-700'
                              : acc.accountType === 'LIABILITY'
                              ? 'bg-amber-50 text-amber-700'
                              : acc.accountType === 'EQUITY'
                              ? 'bg-purple-50 text-purple-700'
                              : acc.accountType === 'REVENUE'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {acc.accountType}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {acc.isGroup ? (
                          <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">Group Header</span>
                        ) : (
                          <span className="text-xs text-slate-500">Posting Ledger</span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs">{acc.currencyCode}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            acc.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {acc.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: JOURNAL VOUCHERS */}
      {activeTab === 'journals' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status:</span>
            {['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED'].map((s) => (
              <button
                key={s}
                onClick={() => setJournalFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  journalFilterStatus === s
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-700 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3.5">Journal #</th>
                  <th className="px-6 py-3.5">Date</th>
                  <th className="px-6 py-3.5">Source Type</th>
                  <th className="px-6 py-3.5">Description</th>
                  <th className="px-6 py-3.5 text-right">Debit</th>
                  <th className="px-6 py-3.5 text-right">Credit</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredJournals.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-slate-400">
                      No journals found.
                    </td>
                  </tr>
                ) : (
                  filteredJournals.map((j) => (
                    <tr key={j.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-mono font-bold text-slate-900">{j.journalNumber}</td>
                      <td className="px-6 py-4 font-mono text-xs">{j.postingDate}</td>
                      <td className="px-6 py-4 text-xs font-medium text-slate-700">{j.sourceDocumentType}</td>
                      <td className="px-6 py-4 max-w-xs truncate">{j.description || '-'}</td>
                      <td className="px-6 py-4 text-right font-mono font-medium text-slate-900">
                        ${j.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-medium text-slate-900">
                        ${j.totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            j.status === 'POSTED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : j.status === 'APPROVED'
                              ? 'bg-blue-100 text-blue-800'
                              : j.status === 'SUBMITTED'
                              ? 'bg-amber-100 text-amber-800'
                              : j.status === 'REVERSED'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {j.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {j.status === 'DRAFT' && (
                            <button
                              onClick={() => handleJournalAction(j.id, 'submit')}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                            >
                              <Send className="w-3.5 h-3.5 inline mr-1" />
                              Submit
                            </button>
                          )}
                          {j.status === 'SUBMITTED' && (
                            <button
                              onClick={() => handleJournalAction(j.id, 'approve')}
                              className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded"
                            >
                              <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
                              Approve
                            </button>
                          )}
                          {j.status === 'APPROVED' && (
                            <button
                              onClick={() => handleJournalAction(j.id, 'post')}
                              className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded"
                            >
                              <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
                              Post
                            </button>
                          )}
                          {j.status === 'POSTED' && (
                            <button
                              onClick={() => handleJournalAction(j.id, 'reverse')}
                              className="px-2.5 py-1 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded"
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

      {/* TAB 3: NEW ACCOUNT MODAL / FORM */}
      {activeTab === 'new_account' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm max-w-2xl mx-auto space-y-6">
          <div className="flex justify-between items-center border-b border-slate-200 pb-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-indigo-600" />
              Add Chart of Accounts Node
            </h2>
            <button
              onClick={() => setActiveTab('accounts')}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleCreateAccount} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Account Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 1010"
                  value={accCode}
                  onChange={(e) => setAccCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Account Type *</label>
                <select
                  value={accType}
                  onChange={(e) => setAccType(e.target.value as AccountType)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="ASSET">ASSET</option>
                  <option value="LIABILITY">LIABILITY</option>
                  <option value="EQUITY">EQUITY</option>
                  <option value="REVENUE">REVENUE</option>
                  <option value="EXPENSE">EXPENSE</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Account Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Main Operating Cash Account"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Parent Group Account</label>
              <select
                value={accParentId}
                onChange={(e) => setAccParentId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- No Parent (Top Level) --</option>
                {accounts
                  .filter((a) => a.isGroup)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountCode} - {a.accountName}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="isGroup"
                checked={accIsGroup}
                onChange={(e) => setAccIsGroup(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="isGroup" className="text-sm font-medium text-slate-700">
                Is Group Header (Contains subordinate accounts, cannot accept direct journal postings)
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Description / Notes</label>
              <textarea
                rows={2}
                value={accDesc}
                onChange={(e) => setAccDesc(e.target.value)}
                placeholder="Purpose or compliance notes..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab('accounts')}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
              >
                {loading ? 'Creating...' : 'Save Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: NEW JOURNAL ENTRY FORM */}
      {activeTab === 'new_journal' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6">
          <div className="flex justify-between items-center border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Scale className="w-5 h-5 text-indigo-600" />
                Create Manual Journal Voucher
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Every journal entry must strictly balance: Total Debit must equal Total Credit.
              </p>
            </div>
            <button
              onClick={() => setActiveTab('journals')}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleCreateJournal} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Posting Date *</label>
                <input
                  type="date"
                  required
                  value={jPostingDate}
                  onChange={(e) => setJPostingDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Description / Memo</label>
                <input
                  type="text"
                  placeholder="e.g. Month-end adjustment or manual entry"
                  value={jDescription}
                  onChange={(e) => setJDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Line items editor */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Debit & Credit Lines</h3>
                <button
                  type="button"
                  onClick={() =>
                    setJLines([...jLines, { accountId: '', debit: 0, credit: 0, description: '' }])
                  }
                  className="px-3 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md"
                >
                  <Plus className="w-3.5 h-3.5 inline mr-1" /> Add Line
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-700 text-xs uppercase font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">Account *</th>
                      <th className="px-4 py-2.5">Memo</th>
                      <th className="px-4 py-2.5 text-right w-36">Debit ($)</th>
                      <th className="px-4 py-2.5 text-right w-36">Credit ($)</th>
                      <th className="px-4 py-2.5 text-center w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {jLines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2">
                          <select
                            required
                            value={line.accountId}
                            onChange={(e) => {
                              const updated = [...jLines];
                              updated[idx].accountId = e.target.value;
                              setJLines(updated);
                            }}
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="">-- Select Account --</option>
                            {accounts
                              .filter((a) => !a.isGroup && a.isActive)
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.accountCode} - {a.accountName} ({a.accountType})
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            placeholder="Line memo"
                            value={line.description}
                            onChange={(e) => {
                              const updated = [...jLines];
                              updated[idx].description = e.target.value;
                              setJLines(updated);
                            }}
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.debit || ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const updated = [...jLines];
                              updated[idx].debit = val;
                              if (val > 0) updated[idx].credit = 0;
                              setJLines(updated);
                            }}
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm text-right font-mono focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.credit || ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              const updated = [...jLines];
                              updated[idx].credit = val;
                              if (val > 0) updated[idx].debit = 0;
                              setJLines(updated);
                            }}
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm text-right font-mono focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-4 py-2 text-center">
                          {jLines.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setJLines(jLines.filter((_, i) => i !== idx))}
                              className="text-rose-500 hover:text-rose-700 font-bold"
                            >
                              &times;
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold text-sm">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 text-right">
                        Totals:
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                        ${totalDebitSum.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                        ${totalCreditSum.toFixed(2)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Invariant indicator */}
              <div
                className={`p-3 rounded-lg text-xs font-semibold flex items-center gap-2 ${
                  isBalanced
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {isBalanced ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span>Balanced: Total Debits equal Total Credits.</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                    <span>
                      Out of Balance: Difference is ${(Math.abs(totalDebitSum - totalCreditSum)).toFixed(2)}.
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab('journals')}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !isBalanced}
                className={`px-5 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors ${
                  isBalanced && !loading ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-400 cursor-not-allowed'
                }`}
              >
                {loading ? 'Creating...' : 'Create Draft Journal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
