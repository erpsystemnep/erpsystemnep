/**
 * Centralized API Client for Multi-Company ERP Platform
 *
 * Enforces:
 * - Bearer JWT authentication header
 * - Dynamic tenant context headers (X-Company-Id, X-Branch-Id)
 * - Standard AppError / ApiResponse normalization
 * - Strict adherence to server-side authority (never sends spoofed permission headers)
 */

import { ApiResponse } from '../../shared/types/index.js';

export interface ApiClientConfig {
  baseUrl?: string;
  getToken?: () => string | null;
  getCompanyId?: () => string | null;
  getBranchId?: () => string | null;
}

export class ApiError extends Error {
  public code: string;
  public statusCode: number;
  public details?: unknown;
  public correlationId?: string;

  constructor(code: string, message: string, statusCode: number, details?: unknown, correlationId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.correlationId = correlationId;
  }
}

class ApiClient {
  private baseUrl: string;
  private getTokenFn: () => string | null = () => null;
  private getCompanyIdFn: () => string | null = () => null;
  private getBranchIdFn: () => string | null = () => null;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl || '';
    if (config.getToken) this.getTokenFn = config.getToken;
    if (config.getCompanyId) this.getCompanyIdFn = config.getCompanyId;
    if (config.getBranchId) this.getBranchIdFn = config.getBranchId;
  }

  public setTokenGetter(fn: () => string | null) {
    this.getTokenFn = fn;
  }

  public setCompanyIdGetter(fn: () => string | null) {
    this.getCompanyIdFn = fn;
  }

  public setBranchIdGetter(fn: () => string | null) {
    this.getBranchIdFn = fn;
  }

  public async request<T = unknown>(
    endpoint: string,
    options: RequestInit & {
      skipTenantHeaders?: boolean;
      companyIdOverride?: string | null;
      branchIdOverride?: string | null;
    } = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    // Attach Bearer Token
    const token = this.getTokenFn();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Attach Tenant Context Headers
    if (!options.skipTenantHeaders) {
      const companyId = options.companyIdOverride !== undefined ? options.companyIdOverride : this.getCompanyIdFn();
      const branchId = options.branchIdOverride !== undefined ? options.branchIdOverride : this.getBranchIdFn();

      if (companyId) {
        headers['X-Company-Id'] = companyId;
      }
      if (branchId) {
        headers['X-Branch-Id'] = branchId;
      }
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    let payload: any;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errorCode = payload?.error?.code || payload?.code || `HTTP_${response.status}`;
      const errorMessage = payload?.error?.message || payload?.message || `Request failed with status ${response.status}`;
      const details = payload?.error?.details || payload?.details;
      const correlationId = payload?.error?.correlationId || payload?.correlationId;

      throw new ApiError(errorCode, errorMessage, response.status, details, correlationId);
    }

    // Standardize structure
    if (payload && typeof payload === 'object') {
      if ('success' in payload) {
        return payload as ApiResponse<T>;
      }
      if ('data' in payload) {
        return {
          success: true,
          data: payload.data,
          meta: payload.meta,
        };
      }
      return {
        success: true,
        data: payload as T,
      };
    }

    return {
      success: true,
      data: payload as T,
    };
  }

  // HTTP Verbs Helpers
  public get<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  public post<T = unknown>(endpoint: string, body?: unknown, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public patch<T = unknown>(endpoint: string, body?: unknown, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  public delete<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const api = new ApiClient();
