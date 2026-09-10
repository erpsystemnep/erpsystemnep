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
  | 'REVERSED'
  | 'CLOSED';

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

// ============================================================================
// PURCHASING, BATCH, QC & INVENTORY STOCK LEDGER (Increment 0.9)
// ============================================================================

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'CLOSED';

export interface PurchaseOrder {
  id: string;
  companyId: string;
  branchId?: string | null;
  poNumber: string;
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate?: string | null;
  status: PurchaseOrderStatus;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: BusinessPartner | null;
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  uomId: string;
  orderedQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
  createdAt: string;
  updatedAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
  uom?: UnitOfMeasure | null;
}

export interface InventoryBatch {
  id: string;
  companyId: string;
  itemId: string;
  batchNumber: string;
  supplierId?: string | null;
  supplierBatchNumber?: string | null;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  unitCost: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  item?: Item | null;
  supplier?: BusinessPartner | null;
}

export type PurchaseReceiptStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

export interface PurchaseReceipt {
  id: string;
  companyId: string;
  branchId?: string | null;
  receiptNumber: string;
  purchaseOrderId?: string | null;
  supplierId: string;
  receiptDate: string;
  status: PurchaseReceiptStatus;
  supplierDeliveryNote?: string | null;
  qcRequired: boolean;
  totalAmount: number;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  journalId?: string | null;
  reversedBy?: string | null;
  reversedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: BusinessPartner | null;
  purchaseOrder?: PurchaseOrder | null;
  lines?: PurchaseReceiptLine[];
}

export interface PurchaseReceiptLine {
  id: string;
  receiptId: string;
  lineNumber: number;
  poLineId?: string | null;
  itemId: string;
  warehouseId: string;
  uomId: string;
  receivedQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitRate: number;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
  uom?: UnitOfMeasure | null;
  batchAllocations?: PurchaseReceiptBatchAllocation[];
}

export interface PurchaseReceiptBatchAllocation {
  id: string;
  receiptLineId: string;
  batchId: string;
  quantity: number;
  unitCost: number;
  createdAt: string;
  batch?: InventoryBatch | null;
}

export type QcInspectionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'POSTED'
  | 'CANCELLED';

export interface QcInspection {
  id: string;
  companyId: string;
  branchId?: string | null;
  inspectionNumber: string;
  receiptId: string;
  inspectionDate: string;
  status: QcInspectionStatus;
  inspectorId?: string | null;
  remarks?: string | null;
  createdBy?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  receipt?: PurchaseReceipt | null;
  lines?: QcInspectionLine[];
}

export interface QcInspectionLine {
  id: string;
  inspectionId: string;
  receiptLineId: string;
  batchId: string;
  itemId: string;
  warehouseId: string;
  receivedQuantity: number;
  passedQuantity: number;
  failedQuantity: number;
  rejectionReason?: string | null;
  remarks?: string | null;
  createdAt: string;
  updatedAt: string;
  item?: Item | null;
  batch?: InventoryBatch | null;
  warehouse?: Warehouse | null;
}

export type PurchaseReturnStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

export interface PurchaseReturn {
  id: string;
  companyId: string;
  branchId?: string | null;
  returnNumber: string;
  supplierId: string;
  receiptId?: string | null;
  qcInspectionId?: string | null;
  returnDate: string;
  status: PurchaseReturnStatus;
  reason?: string | null;
  totalAmount: number;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: BusinessPartner | null;
  receipt?: PurchaseReceipt | null;
  qcInspection?: QcInspection | null;
  lines?: PurchaseReturnLine[];
}

export interface PurchaseReturnLine {
  id: string;
  returnId: string;
  qcLineId?: string | null;
  receiptLineId: string;
  batchId: string;
  itemId: string;
  warehouseId: string;
  returnQuantity: number;
  unitRate: number;
  totalAmount: number;
  createdAt: string;
  item?: Item | null;
  batch?: InventoryBatch | null;
  warehouse?: Warehouse | null;
}

export type StockStatus = 'AVAILABLE' | 'QC_PENDING' | 'QC_FAILED' | 'RESERVED';

export type StockMovementType =
  | 'PURCHASE_RECEIPT'
  | 'GOODS_RECEIPT'
  | 'QC_RELEASE'
  | 'QC_RESTRICTION'
  | 'PURCHASE_RETURN'
  | 'SALES_DELIVERY'
  | 'SALES_RESERVATION'
  | 'SALES_RESERVATION_RELEASE'
  | 'SALES_DELIVERY_REVERSAL'
  | 'REVERSAL';

export interface StockLedgerEntry {
  id: string;
  companyId: string;
  branchId?: string | null;
  warehouseId: string;
  itemId: string;
  batchId?: string | null;
  uomId: string;
  quantity: number;
  stockStatus: StockStatus;
  movementType: StockMovementType;
  unitCost: number;
  totalCost: number;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
  batch?: InventoryBatch | null;
  uom?: UnitOfMeasure | null;
}

export interface StockBalanceSummary {
  companyId: string;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName?: string;
  itemId: string;
  itemSku?: string;
  itemName?: string;
  batchId?: string | null;
  batchNumber?: string | null;
  uomId: string;
  uomCode?: string;
  uomSymbol?: string;
  availableQuantity: number;
  qcPendingQuantity: number;
  qcFailedQuantity: number;
  reservedQuantity?: number;
  quarantineQuantity?: number;
  totalQuantity?: number;
  totalPhysicalQuantity?: number;
  totalValuation?: number;
}

// ==========================================
// SALES & FULFILLMENT DOMAIN TYPES (INCREMENT 1.0)
// ==========================================

export type SalesOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'POSTED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'CLOSED';

export interface SalesOrder {
  id: string;
  companyId: string;
  branchId?: string | null;
  soNumber: string;
  customerId: string;
  orderDate: string;
  expectedDeliveryDate?: string | null;
  status: SalesOrderStatus;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: BusinessPartner | null;
  branch?: Branch | null;
  lines?: SalesOrderLine[];
}

export interface SalesOrderLine {
  id: string;
  salesOrderId: string;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  uomId: string;
  orderedQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitPrice: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
  deliveredQuantity?: number;
  reservedQuantity?: number;
  remainingQuantity?: number;
  createdAt: string;
  updatedAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
  uom?: UnitOfMeasure | null;
}

export type SalesReservationStatus =
  | 'ACTIVE'
  | 'FULFILLED'
  | 'RELEASED'
  | 'CANCELLED';

export interface SalesReservation {
  id: string;
  companyId: string;
  branchId?: string | null;
  salesOrderId: string;
  salesOrderLineId: string;
  itemId: string;
  warehouseId: string;
  batchId?: string | null;
  uomId: string;
  reservedQuantity: number;
  fulfilledQuantity: number;
  releasedQuantity: number;
  status: SalesReservationStatus;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  salesOrder?: SalesOrder | null;
  item?: Item | null;
  warehouse?: Warehouse | null;
  batch?: InventoryBatch | null;
  uom?: UnitOfMeasure | null;
}

export type SalesDeliveryStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

export interface SalesDelivery {
  id: string;
  companyId: string;
  branchId?: string | null;
  deliveryNumber: string;
  salesOrderId?: string | null;
  customerId: string;
  deliveryDate: string;
  status: SalesDeliveryStatus;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  journalId?: string | null;
  reversedBy?: string | null;
  reversedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: BusinessPartner | null;
  salesOrder?: SalesOrder | null;
  lines?: SalesDeliveryLine[];
}

export interface SalesDeliveryLine {
  id: string;
  deliveryId: string;
  salesOrderLineId?: string | null;
  lineNumber: number;
  itemId: string;
  warehouseId: string;
  uomId: string;
  deliveredQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  isReserved: boolean;
  createdAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
  uom?: UnitOfMeasure | null;
  batchAllocations?: SalesDeliveryBatchAllocation[];
}

export interface SalesDeliveryBatchAllocation {
  id: string;
  deliveryLineId: string;
  batchId: string;
  quantity: number;
  createdAt: string;
  batch?: InventoryBatch | null;
}

export type SalesInvoiceStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

export interface SalesInvoice {
  id: string;
  companyId: string;
  branchId?: string | null;
  invoiceNumber: string;
  customerId: string;
  salesOrderId?: string | null;
  deliveryId?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  status: SalesInvoiceStatus;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  reversedBy?: string | null;
  reversedAt?: string | null;
  journalId?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: BusinessPartner | null;
  salesOrder?: SalesOrder | null;
  delivery?: SalesDelivery | null;
  lines?: SalesInvoiceLine[];
  journal?: AccountingJournal | null;
  receivable?: CustomerReceivable | null;
}

export interface SalesInvoiceLine {
  id: string;
  salesInvoiceId: string;
  salesOrderLineId?: string | null;
  deliveryLineId?: string | null;
  lineNumber: number;
  itemId: string;
  warehouseId?: string | null;
  uomId: string;
  quantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitPrice: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineNet: number;
  lineTotal: number;
  revenueAccountId?: string | null;
  createdAt: string;
  updatedAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
  uom?: UnitOfMeasure | null;
  revenueAccount?: ChartOfAccount | null;
}

export type CustomerReceivableStatus =
  | 'OPEN'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED'
  | 'REVERSED';

export interface CustomerReceivable {
  id: string;
  companyId: string;
  branchId?: string | null;
  customerId: string;
  salesInvoiceId: string;
  currencyCode: string;
  invoiceAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  invoiceDate: string;
  dueDate?: string | null;
  status: CustomerReceivableStatus;
  createdAt: string;
  updatedAt: string;
  customer?: BusinessPartner | null;
  invoice?: SalesInvoice | null;
}

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface ChartOfAccount {
  id: string;
  companyId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  parentAccountId?: string | null;
  isGroup: boolean;
  isActive: boolean;
  currencyCode: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  parentAccount?: ChartOfAccount | null;
  childAccounts?: ChartOfAccount[];
}

export type JournalStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

export interface AccountingJournal {
  id: string;
  companyId: string;
  branchId?: string | null;
  journalNumber: string;
  postingDate: string;
  sourceDocumentType: string;
  sourceDocumentId?: string | null;
  description?: string | null;
  status: JournalStatus;
  totalDebit: number;
  totalCredit: number;
  currencyCode: string;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  reversalJournalId?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: AccountingJournalLine[];
}

export interface AccountingJournalLine {
  id: string;
  journalId: string;
  lineNumber: number;
  accountId: string;
  partnerId?: string | null;
  debit: number;
  credit: number;
  currencyCode: string;
  exchangeRate: number;
  baseDebit: number;
  baseCredit: number;
  description?: string | null;
  createdAt: string;
  account?: ChartOfAccount | null;
  partner?: BusinessPartner | null;
}

export type PaymentMethod = 'CASH' | 'BANK' | 'CHECK' | 'CREDIT_CARD' | 'OTHER';

export type CustomerPaymentStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

export interface CustomerPaymentAllocation {
  id: string;
  paymentId: string;
  receivableId: string;
  allocatedAmount: number;
  allocationDate: string;
  createdAt: string;
  receivable?: CustomerReceivable | null;
}

export interface CustomerPayment {
  id: string;
  companyId: string;
  branchId?: string | null;
  paymentNumber: string;
  customerId: string;
  paymentDate: string;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
  baseAmount: number;
  paymentMethod: PaymentMethod;
  depositAccountId: string;
  arAccountId?: string | null;
  referenceNumber?: string | null;
  status: CustomerPaymentStatus;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  journalId?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: BusinessPartner | null;
  depositAccount?: ChartOfAccount | null;
  arAccount?: ChartOfAccount | null;
  allocations?: CustomerPaymentAllocation[];
  journal?: AccountingJournal | null;
}

// ----------------------------------------------------------------------------
// Increment 1.3: Accounts Payable & Purchase Invoicing Domain Interfaces
// ----------------------------------------------------------------------------

export type PurchaseInvoiceStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

export interface PurchaseInvoiceLine {
  id: string;
  purchaseInvoiceId: string;
  purchaseReceiptLineId: string;
  poLineId?: string | null;
  lineNumber: number;
  itemId: string;
  warehouseId?: string | null;
  uomId: string;
  quantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitPrice: number;
  discountRate: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineNet: number;
  lineTotal: number;
  expenseAccountId?: string | null;
  createdAt: string;
  updatedAt: string;
  item?: Item | null;
  uom?: UnitOfMeasure | null;
  warehouse?: Warehouse | null;
  purchaseReceiptLine?: PurchaseReceiptLine | null;
  poLine?: PurchaseOrderLine | null;
  expenseAccount?: ChartOfAccount | null;
}

export interface PurchaseInvoice {
  id: string;
  companyId: string;
  branchId?: string | null;
  invoiceNumber: string;
  supplierInvoiceRef?: string | null;
  supplierId: string;
  purchaseOrderId?: string | null;
  receiptId?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  status: PurchaseInvoiceStatus;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  reversedBy?: string | null;
  reversedAt?: string | null;
  journalId?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: BusinessPartner | null;
  purchaseOrder?: PurchaseOrder | null;
  receipt?: PurchaseReceipt | null;
  lines?: PurchaseInvoiceLine[];
  journal?: AccountingJournal | null;
  payable?: SupplierPayable | null;
}

export type SupplierPayableStatus =
  | 'OPEN'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED'
  | 'REVERSED';

export interface SupplierPayable {
  id: string;
  companyId: string;
  branchId?: string | null;
  supplierId: string;
  purchaseInvoiceId: string;
  currencyCode: string;
  invoiceAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  invoiceDate: string;
  dueDate?: string | null;
  status: SupplierPayableStatus;
  createdAt: string;
  updatedAt: string;
  supplier?: BusinessPartner | null;
  invoice?: PurchaseInvoice | null;
}

export type SupplierPaymentStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED';

export interface SupplierPaymentAllocation {
  id: string;
  paymentId: string;
  payableId: string;
  allocatedAmount: number;
  allocationDate: string;
  createdAt: string;
  payable?: SupplierPayable | null;
}

export interface SupplierPayment {
  id: string;
  companyId: string;
  branchId?: string | null;
  paymentNumber: string;
  supplierId: string;
  paymentDate: string;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
  baseAmount: number;
  paymentMethod: PaymentMethod;
  disbursementAccountId: string;
  apAccountId?: string | null;
  referenceNumber?: string | null;
  status: SupplierPaymentStatus;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  reversedBy?: string | null;
  reversedAt?: string | null;
  journalId?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: BusinessPartner | null;
  disbursementAccount?: ChartOfAccount | null;
  apAccount?: ChartOfAccount | null;
  allocations?: SupplierPaymentAllocation[];
  journal?: AccountingJournal | null;
}

// ----------------------------------------------------------------------------
// Increment 1.4: Tax Subledger, Tax Reconciliation & Trial Balance Domain Interfaces
// ----------------------------------------------------------------------------

export type TaxType = 'INPUT_TAX' | 'OUTPUT_TAX';
export type TaxSourceType = 'SALES_INVOICE' | 'PURCHASE_INVOICE';
export type TaxTransactionStatus = 'POSTED' | 'REVERSED' | 'CANCELLED';

export interface TaxTransaction {
  id: string;
  companyId: string;
  branchId?: string | null;
  taxType: TaxType;
  sourceType: TaxSourceType;
  sourceId: string;
  sourceLineId?: string | null;
  taxCode?: string | null;
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  currencyCode: string;
  exchangeRate: number;
  baseTaxableAmount: number;
  baseTaxAmount: number;
  accountingDate: string;
  journalId?: string | null;
  journalLineId?: string | null;
  status: TaxTransactionStatus;
  reversalJournalId?: string | null;
  createdAt: string;
  updatedAt: string;
  journal?: AccountingJournal | null;
}

export interface TrialBalanceItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  isGroup: boolean;
  debitTotal: number;
  creditTotal: number;
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalanceReport {
  companyId: string;
  asOfDate: string;
  startDate?: string | null;
  branchId?: string | null;
  generatedAt: string;
  items: TrialBalanceItem[];
  totalDebit: number;
  totalCredit: number;
  totalDebitBalance: number;
  totalCreditBalance: number;
  isBalanced: boolean;
}

export interface TaxReconciliationReport {
  companyId: string;
  asOfDate?: string | null;
  generatedAt: string;
  outputTaxSubledgerTotal: number;
  outputTaxGlTotal: number;
  outputTaxDiscrepancy: number;
  isOutputTaxReconciled: boolean;
  inputTaxSubledgerTotal: number;
  inputTaxGlTotal: number;
  inputTaxDiscrepancy: number;
  isInputTaxReconciled: boolean;
  netTaxPosition: number;
  isFullyReconciled: boolean;
}

export interface TaxSummaryReport {
  companyId: string;
  asOfDate?: string | null;
  generatedAt: string;
  totalOutputTaxable: number;
  totalOutputTax: number;
  totalInputTaxable: number;
  totalInputTax: number;
  netTaxPosition: number;
  taxCodeBreakdown: Array<{
    taxCode: string;
    taxType: TaxType;
    taxRate: number;
    taxableAmount: number;
    taxAmount: number;
    transactionCount: number;
  }>;
}

export interface InventoryCostLayer {
  id: string;
  companyId: string;
  branchId?: string | null;
  warehouseId: string;
  itemId: string;
  batchId: string;
  uomId: string;
  initialQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  totalCost: number;
  remainingValue: number;
  currencyCode: string;
  exchangeRate: number;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  accountingDate: string;
  isExhausted: boolean;
  createdAt: string;
  updatedAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
  batch?: InventoryBatch | null;
  uom?: UnitOfMeasure | null;
}

export type InventoryValuationTransactionType = 'RECEIPT' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT' | 'REVERSAL';

export interface InventoryValuationTransaction {
  id: string;
  companyId: string;
  branchId?: string | null;
  warehouseId: string;
  itemId: string;
  batchId: string;
  costLayerId?: string | null;
  transactionType: InventoryValuationTransactionType;
  sourceType: string;
  sourceId: string;
  sourceLineId?: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  currencyCode: string;
  exchangeRate: number;
  baseUnitCost: number;
  baseTotalCost: number;
  accountingDate: string;
  journalId?: string | null;
  status: 'POSTED' | 'REVERSED';
  reversalJournalId?: string | null;
  createdAt: string;
  item?: Item | null;
  warehouse?: Warehouse | null;
  batch?: InventoryBatch | null;
}

export interface InventoryValuationReportItem {
  itemId: string;
  itemCode: string;
  itemName: string;
  categoryName?: string | null;
  uomCode: string;
  totalQuantity: number;
  totalValue: number;
  averageCost: number;
  layersCount: number;
  layers?: InventoryCostLayer[];
}

export interface InventoryValuationReportSummary {
  companyId: string;
  asOfDate: string;
  warehouseId?: string | null;
  totalItems: number;
  totalQuantity: number;
  totalValuation: number;
  currencyCode: string;
  items: InventoryValuationReportItem[];
}

export interface CogsReportLine {
  id: string;
  accountingDate: string;
  sourceType: string;
  sourceId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchNumber: string;
  warehouseName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  journalId?: string | null;
  status: string;
}

export interface CogsReportSummary {
  companyId: string;
  startDate?: string | null;
  endDate?: string | null;
  totalCogs: number;
  totalQuantity: number;
  transactionCount: number;
  transactions: CogsReportLine[];
}

export interface InventoryGlReconciliation {
  companyId: string;
  asOfDate: string;
  subledgerTotal: number;
  glAccount1400Balance: number;
  discrepancy: number;
  isReconciled: boolean;
  details: {
    activeCostLayersTotal: number;
    valuationTransactionsNetTotal: number;
    glDebitsTotal: number;
    glCreditsTotal: number;
  };
}

export type FiscalYearStatus = 'OPEN' | 'CLOSED';

export interface FiscalYear {
  id: string;
  companyId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  closedAt?: string | null;
  closedBy?: string | null;
  reopenedAt?: string | null;
  reopenedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AccountingPeriodStatus = 'OPEN' | 'CLOSED';

export interface AccountingPeriod {
  id: string;
  companyId: string;
  fiscalYearId?: string | null;
  periodName: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  closedAt?: string | null;
  closedBy?: string | null;
  reopenedAt?: string | null;
  reopenedBy?: string | null;
  closingNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneralLedgerLine {
  id: string;
  journalId: string;
  journalNumber: string;
  postingDate: string;
  sourceDocumentType: string;
  sourceDocumentId?: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  partnerId?: string | null;
  partnerName?: string | null;
  partnerCode?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface GeneralLedgerReport {
  companyId: string;
  startDate: string;
  endDate: string;
  branchId?: string | null;
  accountId?: string | null;
  generatedAt: string;
  totalDebit: number;
  totalCredit: number;
  lines: GeneralLedgerLine[];
}

export interface AccountLedgerLine {
  id: string;
  journalId: string;
  journalNumber: string;
  postingDate: string;
  sourceDocumentType: string;
  description?: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountLedgerReport {
  companyId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  startDate: string;
  endDate: string;
  currencyCode: string;
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  lines: AccountLedgerLine[];
}

export interface ProfitLossAccountItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

export interface ProfitLossReport {
  companyId: string;
  startDate: string;
  endDate: string;
  branchId?: string | null;
  generatedAt: string;
  currencyCode: string;
  operatingRevenue: {
    accounts: ProfitLossAccountItem[];
    total: number;
  };
  costOfGoodsSold: {
    accounts: ProfitLossAccountItem[];
    total: number;
  };
  grossProfit: number;
  operatingExpenses: {
    accounts: ProfitLossAccountItem[];
    total: number;
  };
  operatingProfit: number;
  otherIncome: {
    accounts: ProfitLossAccountItem[];
    total: number;
  };
  otherExpenses: {
    accounts: ProfitLossAccountItem[];
    total: number;
  };
  netProfit: number;
}

export interface BalanceSheetAccountItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  balance: number;
}

export interface BalanceSheetReport {
  companyId: string;
  asOfDate: string;
  branchId?: string | null;
  generatedAt: string;
  currencyCode: string;
  assets: {
    currentAssets: BalanceSheetAccountItem[];
    nonCurrentAssets: BalanceSheetAccountItem[];
    totalCurrentAssets: number;
    totalNonCurrentAssets: number;
    totalAssets: number;
  };
  liabilities: {
    currentLiabilities: BalanceSheetAccountItem[];
    nonCurrentLiabilities: BalanceSheetAccountItem[];
    totalCurrentLiabilities: number;
    totalNonCurrentLiabilities: number;
    totalLiabilities: number;
  };
  equity: {
    accounts: BalanceSheetAccountItem[];
    totalAccounts: number;
    currentPeriodNetProfit: number;
    totalEquity: number;
  };
  totalLiabilitiesAndEquity: number;
  discrepancy: number;
  isBalanced: boolean;
}

export interface ArAgingItem {
  receivableId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  salesInvoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  currencyCode: string;
  invoiceAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  daysOverdue: number;
  bucket: 'CURRENT' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_91_120' | 'DAYS_OVER_120';
}

export interface ArAgingCustomerSummary {
  customerId: string;
  customerCode: string;
  customerName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days91To120: number;
  daysOver120: number;
  totalOutstanding: number;
}

export interface ArAgingReport {
  companyId: string;
  asOfDate: string;
  generatedAt: string;
  currencyCode: string;
  items: ArAgingItem[];
  customers: ArAgingCustomerSummary[];
  totalCurrent: number;
  totalDays1To30: number;
  totalDays31To60: number;
  totalDays61To90: number;
  totalDays91To120: number;
  totalDaysOver120: number;
  grandTotalOutstanding: number;
  glAccountBalance: number;
  discrepancy: number;
  isReconciled: boolean;
}

export interface ApAgingItem {
  payableId: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  purchaseInvoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  currencyCode: string;
  invoiceAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  daysOverdue: number;
  bucket: 'CURRENT' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_91_120' | 'DAYS_OVER_120';
}

export interface ApAgingSupplierSummary {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days91To120: number;
  daysOver120: number;
  totalOutstanding: number;
}

export interface ApAgingReport {
  companyId: string;
  asOfDate: string;
  generatedAt: string;
  currencyCode: string;
  items: ApAgingItem[];
  suppliers: ApAgingSupplierSummary[];
  totalCurrent: number;
  totalDays1To30: number;
  totalDays31To60: number;
  totalDays61To90: number;
  totalDays91To120: number;
  totalDaysOver120: number;
  grandTotalOutstanding: number;
  glAccountBalance: number;
  discrepancy: number;
  isReconciled: boolean;
}

export interface CashBankAccountSummary {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  openingBalance: number;
  totalReceipts: number;
  totalPayments: number;
  closingBalance: number;
  transactions: Array<{
    journalId: string;
    journalNumber: string;
    postingDate: string;
    sourceDocumentType: string;
    description?: string | null;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
}

export interface CashBankReport {
  companyId: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  currencyCode: string;
  accounts: CashBankAccountSummary[];
  totalOpeningBalance: number;
  totalReceipts: number;
  totalPayments: number;
  totalClosingBalance: number;
}



