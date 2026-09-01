import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import {
  Package2,
  Users,
  Ruler,
  FolderTree,
  RefreshCw,
  CheckCircle,
  XCircle,
} from 'lucide-react';

export const MasterDataView: React.FC = () => {
  const { activeCompany, token } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'items' | 'partners' | 'uoms' | 'categories'>('items');

  const [items, setItems] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [uoms, setUoms] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMasterData = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        'x-company-id': activeCompany.id,
      };

      const [itemRes, partRes, uomRes, catRes] = await Promise.all([
        fetch(`/api/v1/master/items?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/master/partners?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/master/uoms?companyId=${activeCompany.id}`, { headers }),
        fetch(`/api/v1/master/categories?companyId=${activeCompany.id}`, { headers }),
      ]);

      if (itemRes.ok) {
        const d = await itemRes.json();
        setItems(d.data || []);
      }
      if (partRes.ok) {
        const d = await partRes.json();
        setPartners(d.data || []);
      }
      if (uomRes.ok) {
        const d = await uomRes.json();
        setUoms(d.data || []);
      }
      if (catRes.ok) {
        const d = await catRes.json();
        setCategories(d.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch master data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMasterData();
  }, [activeCompany?.id]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Package2 className="w-5 h-5 text-indigo-600" />
            Master Data Foundation
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Central catalog of Items, Categories, Units of Measure, and Business Partners (Customers & Suppliers).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchMasterData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex border-b border-slate-200 gap-4">
        <button
          onClick={() => setActiveSubTab('items')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'items'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Package2 className="w-4 h-4" />
          Items Catalog ({items.length})
        </button>
        <button
          onClick={() => setActiveSubTab('partners')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'partners'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users className="w-4 h-4" />
          Business Partners ({partners.length})
        </button>
        <button
          onClick={() => setActiveSubTab('uoms')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'uoms'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Ruler className="w-4 h-4" />
          Units of Measure ({uoms.length})
        </button>
        <button
          onClick={() => setActiveSubTab('categories')}
          className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
            activeSubTab === 'categories'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FolderTree className="w-4 h-4" />
          Item Categories ({categories.length})
        </button>
      </div>

      {/* Tab: Items */}
      {activeSubTab === 'items' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">SKU</th>
                  <th className="p-3">Item Name</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Stock Item</th>
                  <th className="p-3">Purchasable</th>
                  <th className="p-3">Saleable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      No items found.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{item.sku}</td>
                      <td className="p-3 font-medium text-slate-900">{item.itemName}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 font-mono text-[10px]">
                          {item.itemType}
                        </span>
                      </td>
                      <td className="p-3">{item.isStockItem ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-slate-300" />}</td>
                      <td className="p-3">{item.isPurchasable ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-slate-300" />}</td>
                      <td className="p-3">{item.isSaleable ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-slate-300" />}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Partners */}
      {activeSubTab === 'partners' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Code</th>
                  <th className="p-3">Legal Name</th>
                  <th className="p-3">Supplier</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {partners.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      No business partners found.
                    </td>
                  </tr>
                ) : (
                  partners.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{p.partnerCode}</td>
                      <td className="p-3 font-medium text-slate-900">{p.legalName}</td>
                      <td className="p-3">{p.isSupplier ? <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold">SUPPLIER</span> : '-'}</td>
                      <td className="p-3">{p.isCustomer ? <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">CUSTOMER</span> : '-'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                          {p.isActive ? 'ACTIVE' : 'INACTIVE'}
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

      {/* Tab: UOMs */}
      {activeSubTab === 'uoms' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">UOM Code</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Decimal Precision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uoms.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-slate-400">
                      No units of measure found.
                    </td>
                  </tr>
                ) : (
                  uoms.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{u.code}</td>
                      <td className="p-3 font-medium text-slate-900">{u.name}</td>
                      <td className="p-3 font-mono">{u.precision}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Categories */}
      {activeSubTab === 'categories' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Category Code</th>
                  <th className="p-3">Category Name</th>
                  <th className="p-3">Parent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-slate-400">
                      No categories found.
                    </td>
                  </tr>
                ) : (
                  categories.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold text-indigo-600">{c.code}</td>
                      <td className="p-3 font-medium text-slate-900">{c.name}</td>
                      <td className="p-3 text-slate-500">{c.parentCode || '-'}</td>
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
