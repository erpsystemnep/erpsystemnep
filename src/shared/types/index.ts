/**
 * Core Domain Interfaces & Shared Types for Multi-Company ERP Foundation
 */

export interface Company {
  id: string;
  code: string;
  legalName: string;
  tradeName?: string;
  baseCurrency: string;
  taxIdentifier?: string;
  fiscalYearStartMonth: number; // 1 - 12
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  companyId: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  addressLine1?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  countryCode: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WarehouseType = 
  | 'PHYSICAL' 
  | 'CENTRAL_DC' 
  | 'QUARANTINE' 
  | 'IN_TRANSIT' 
  | 'WIP_PRODUCTION' 
  | 'VIRTUAL_CONSIGNMENT';

export interface Warehouse {
  id: string;
  companyId: string;
  branchId?: string | null; // null = company-wide warehouse/DC
  code: string;
  name: string;
  warehouseType: WarehouseType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NumberingSeries {
  id: string;
  companyId: string;
  branchId?: string | null;
  documentType: string;
  prefix: string;
  suffix?: string;
  minDigits: number;
  currentNumber: number;
  resetFrequency: 'NEVER' | 'ANNUAL' | 'MONTHLY';
  lastResetDate?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  isSuperadmin: boolean;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface Role {
  id: string;
  companyId?: string | null; // null = system template role
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
}

export type ActionPrimitive = 
  | 'view' 
  | 'create' 
  | 'edit' 
  | 'delete' 
  | 'export' 
  | 'approve' 
  | 'reject' 
  | 'post' 
  | 'cancel' 
  | 'reverse' 
  | 'print';

export interface Permission {
  id: string; // e.g. 'org.company.view', 'sales.order.approve'
  module: string;
  resource: string;
  action: ActionPrimitive;
  description: string;
}

export interface UserCompanyRole {
  id: string;
  userId: string;
  companyId: string;
  branchId?: string | null; // null = all branches
  roleId: string;
}

export type AuditAction = 
  | 'CREATE' 
  | 'UPDATE' 
  | 'DELETE' 
  | 'VIEW' 
  | 'EXPORT' 
  | 'APPROVE' 
  | 'REJECT' 
  | 'POST' 
  | 'CANCEL' 
  | 'REVERSE' 
  | 'LOGIN' 
  | 'LOGOUT' 
  | 'PERMISSION_CHANGE';

export type DocumentState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'CANCELLED'
  | 'REVERSED';

export interface StateTransitionDefinition {
  from: DocumentState;
  to: DocumentState;
  action: string;
  requiredPermission?: string;
  requiresSoD?: boolean; // When true, creator cannot execute this transition (e.g. approve/post)
  description?: string;
}

export interface StateMachineConfig {
  documentType: string;
  initialState: DocumentState;
  allowedTransitions: StateTransitionDefinition[];
  allowReversal?: boolean; // When true, POSTED documents can transition to REVERSED
}

export interface GenerateNumberParams {
  companyId: string;
  branchId?: string | null;
  documentType: string;
}

export interface GeneratedNumberResult {
  formattedNumber: string;
  seriesId: string;
  sequenceNumber: number;
  prefix: string;
  suffix?: string;
}

export interface ValidateApprovalAuthorityParams {
  ctx: SecurityContext;
  companyId: string;
  branchId?: string | null;
  requiredPermission?: string;
  creatorId?: string;
  documentType?: string;
  documentId?: string;
  strictSoD?: boolean;
}

export interface AuditLog {
  id: string;
  companyId?: string | null;
  branchId?: string | null;
  warehouseId?: string | null;
  userId?: string | null;
  action: AuditAction;
  module: string;
  entityName: string;
  entityId: string;
  reasonCode?: string;
  reasonText?: string;
  changes?: {
    old?: Record<string, unknown>;
    new?: Record<string, unknown>;
  };
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  correlationId?: string;
  createdAt: string;
}

export interface OrgContextState {
  activeCompanyId: string | null;
  activeBranchId: string | null;
  activeWarehouseId: string | null;
}

export interface SecurityContext {
  userId: string;
  email: string;
  fullName: string;
  isSuperadmin: boolean;
  activeCompanyId?: string | null;
  activeBranchId?: string | null;
  effectivePermissions: string[]; // List of atomic permissions, e.g. ['org.company.view', 'sales.order.create']
  sessionId?: string;
  correlationId?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    [key: string]: unknown;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
