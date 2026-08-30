/**
 * Authentication & Active Tenant Context Management
 *
 * Manages:
 * - JWT storage and retrieval
 * - Authenticated user identity
 * - Dynamic Company and Branch context selectors
 * - Server-authoritative effective permissions
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Company, Branch, SecurityContext } from '../../shared/types/index.js';
import { api, ApiError } from '../api/client.js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  activeCompany: Company | null;
  activeBranch: Branch | null;
  availableCompanies: Company[];
  availableBranches: Branch[];
  effectivePermissions: string[];
  isSuperadmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectCompany: (company: Company | null) => void;
  selectBranch: (branch: Branch | null) => void;
  refreshProfile: () => Promise<void>;
  refreshTenantData: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_STORAGE_KEY = 'erp_auth_token';
const COMPANY_STORAGE_KEY = 'erp_active_company_id';
const BRANCH_STORAGE_KEY = 'erp_active_branch_id';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null);
  const [availableCompanies, setAvailableCompanies] = useState<Company[]>([]);
  const [availableBranches, setAvailableBranches] = useState<Branch[]>([]);
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  const [isSuperadmin, setIsSuperadmin] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Bind API Client getters
  useEffect(() => {
    api.setTokenGetter(() => token);
    api.setCompanyIdGetter(() => activeCompany?.id || null);
    api.setBranchIdGetter(() => activeBranch?.id || null);
  }, [token, activeCompany, activeBranch]);

  const clearError = () => setError(null);

  // Load companies for the authenticated user
  const loadCompanies = useCallback(async () => {
    if (!token) return [];
    try {
      const res = await api.get<Company[]>('/api/v1/org/companies');
      const list = res.data || [];
      setAvailableCompanies(list);
      return list;
    } catch (err: any) {
      console.warn('Failed to load companies:', err?.message);
      return [];
    }
  }, [token]);

  // Load branches for a given company
  const loadBranches = useCallback(async (companyId: string) => {
    if (!token || !companyId) {
      setAvailableBranches([]);
      return [];
    }
    try {
      const res = await api.get<Branch[]>(`/api/v1/org/branches?companyId=${companyId}`);
      const list = res.data || [];
      setAvailableBranches(list);
      return list;
    } catch (err: any) {
      console.warn('Failed to load branches:', err?.message);
      setAvailableBranches([]);
      return [];
    }
  }, [token]);

  // Fetch current user profile & refresh context
  const refreshProfile = useCallback(async () => {
    if (!token) {
      setUser(null);
      setIsSuperadmin(false);
      setEffectivePermissions([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const res = await api.get<{
        id: string;
        email: string;
        fullName: string;
        isSuperadmin: boolean;
        isActive: boolean;
        lastLoginAt?: string;
        createdAt: string;
      }>('/api/v1/auth/me');

      if (res.data) {
        setUser(res.data as User);
        setIsSuperadmin(res.data.isSuperadmin);

        // Fetch company list
        const companies = await loadCompanies();

        // Restore or initialize active company
        const savedCompanyId = localStorage.getItem(COMPANY_STORAGE_KEY);
        let selectedComp = companies.find((c) => c.id === savedCompanyId) || (companies.length > 0 ? companies[0] : null);
        setActiveCompany(selectedComp);

        if (selectedComp) {
          const branches = await loadBranches(selectedComp.id);
          const savedBranchId = localStorage.getItem(BRANCH_STORAGE_KEY);
          const selectedBr = branches.find((b) => b.id === savedBranchId) || null;
          setActiveBranch(selectedBr);
        }
      }
    } catch (err: any) {
      console.error('Session validation failed:', err);
      // If token expired/invalid, clear session
      if (err instanceof ApiError && err.statusCode === 401) {
        logout();
      } else {
        setError(err?.message || 'Failed to refresh profile');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, loadCompanies, loadBranches]);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  // Login handler
  const login = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.post<{
        token: string;
        user: User;
      }>('/api/v1/auth/login', { email, password });

      if (res.data) {
        const { token: newToken, user: newUser } = res.data;
        localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
        setToken(newToken);
        setUser(newUser);
        setIsSuperadmin(newUser.isSuperadmin);
      }
    } catch (err: any) {
      const msg = err?.message || 'Authentication failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Logout handler
  const logout = async () => {
    try {
      if (token) {
        await api.post('/api/v1/auth/logout').catch(() => {});
      }
    } finally {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(COMPANY_STORAGE_KEY);
      localStorage.removeItem(BRANCH_STORAGE_KEY);
      setToken(null);
      setUser(null);
      setActiveCompany(null);
      setActiveBranch(null);
      setAvailableCompanies([]);
      setAvailableBranches([]);
      setEffectivePermissions([]);
      setIsSuperadmin(false);
    }
  };

  // Company selection
  const selectCompany = (company: Company | null) => {
    setActiveCompany(company);
    setActiveBranch(null);
    if (company) {
      localStorage.setItem(COMPANY_STORAGE_KEY, company.id);
      localStorage.removeItem(BRANCH_STORAGE_KEY);
      loadBranches(company.id);
    } else {
      localStorage.removeItem(COMPANY_STORAGE_KEY);
      localStorage.removeItem(BRANCH_STORAGE_KEY);
      setAvailableBranches([]);
    }
  };

  // Branch selection
  const selectBranch = (branch: Branch | null) => {
    setActiveBranch(branch);
    if (branch) {
      localStorage.setItem(BRANCH_STORAGE_KEY, branch.id);
    } else {
      localStorage.removeItem(BRANCH_STORAGE_KEY);
    }
  };

  const refreshTenantData = async () => {
    if (activeCompany) {
      await loadBranches(activeCompany.id);
    }
    await loadCompanies();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token && !!user,
        isLoading,
        activeCompany,
        activeBranch,
        availableCompanies,
        availableBranches,
        effectivePermissions,
        isSuperadmin,
        login,
        logout,
        selectCompany,
        selectBranch,
        refreshProfile,
        refreshTenantData,
        error,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
