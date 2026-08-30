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

// ============================================================================
// MASTER DATA DOMAIN INTERFACES (Increment 0.8)
// ============================================================================

export type BusinessPartnerType = 'ORGANIZATION' | 'INDIVIDUAL';

export interface BusinessPartner {
  id: string;
  companyId: string;
  partnerCode: string;
  legalName: string;
  tradeName?: string | null;
  partnerType: BusinessPartnerType;
  taxIdentifier?: string | null;
  email?: string | null;
  phone?: string | null;
  countryCode: string;
  currencyCode: string;
  isCustomer: boolean;
  isSupplier: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  addresses?: BusinessPartnerAddress[];
  contacts?: BusinessPartnerContact[];
}

export type AddressType = 'BILLING' | 'SHIPPING' | 'REGISTERED' | 'OTHER';

export interface BusinessPartnerAddress {
  id: string;
  partnerId: string;
  addressType: AddressType;
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  countryCode: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessPartnerContact {
  id: string;
  partnerId: string;
  contactName: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemCategory {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  parentCategoryId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  parentCode?: string;
  parentName?: string;
}

export type UomType = 'WEIGHT' | 'VOLUME' | 'LENGTH' | 'AREA' | 'COUNT' | 'TIME' | 'OTHER';

export interface UnitOfMeasure {
  id: string;
  companyId: string;
  code: string;
  name: string;
  symbol: string;
  uomType: UomType;
  conversionPrecision: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ItemType =
  | 'RAW_MATERIAL'
  | 'INGREDIENT'
  | 'FINISHED_GOOD'
  | 'SEMI_FINISHED_GOOD'
  | 'PACKAGING'
  | 'CONSUMABLE'
  | 'SERVICE'
  | 'OTHER';

export interface Item {
  id: string;
  companyId: string;
  sku: string;
  itemName: string;
  description?: string | null;
  categoryId?: string | null;
  itemType: ItemType;
  baseUomId: string;
  isStockItem: boolean;
  isSaleable: boolean;
  isPurchasable: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category?: ItemCategory | null;
  baseUom?: UnitOfMeasure | null;
  conversions?: ItemUomConversion[];
}

export interface ItemUomConversion {
  id: string;
  itemId: string;
  fromUomId: string;
  toUomId: string;
  conversionFactor: number;
  createdAt: string;
  updatedAt: string;
  fromUomCode?: string;
  toUomCode?: string;
}

