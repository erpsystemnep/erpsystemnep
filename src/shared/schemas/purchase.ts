import { z } from 'zod';

export const createPurchaseOrderLineSchema = z.object({
  lineNumber: z.number().int().positive().optional(),
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  uomId: z.string().uuid(),
  orderedQuantity: z.number().positive(),
  conversionFactor: z.number().positive().default(1.0),
  baseQuantity: z.number().positive().optional(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().nonnegative().default(0),
  taxAmount: z.number().nonnegative().default(0),
  lineTotal: z.number().nonnegative().optional(),
});

export const createPurchaseOrderSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  poNumber: z.string().min(1).max(64).optional(), // auto-generated if omitted
  supplierId: z.string().uuid(),
  orderDate: z.string().min(10).max(30).optional(),
  expectedDeliveryDate: z.string().min(10).max(30).nullable().optional(),
  currencyCode: z.string().min(3).max(3).default('USD'),
  exchangeRate: z.number().positive().default(1.0),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(createPurchaseOrderLineSchema).min(1, 'Purchase order must have at least one line item'),
});

export const updatePurchaseOrderSchema = z.object({
  branchId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().optional(),
  orderDate: z.string().min(10).max(30).optional(),
  expectedDeliveryDate: z.string().min(10).max(30).nullable().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(createPurchaseOrderLineSchema).min(1).optional(),
});

export const createPurchaseReceiptBatchAllocationSchema = z.object({
  batchNumber: z.string().min(1).max(64),
  supplierBatchNumber: z.string().max(64).nullable().optional(),
  manufacturingDate: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative(),
});

export const createPurchaseReceiptLineSchema = z.object({
  lineNumber: z.number().int().positive().optional(),
  poLineId: z.string().uuid().nullable().optional(),
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  uomId: z.string().uuid(),
  receivedQuantity: z.number().positive(),
  conversionFactor: z.number().positive().default(1.0),
  baseQuantity: z.number().positive().optional(),
  unitRate: z.number().nonnegative(),
  totalAmount: z.number().nonnegative().optional(),
  batchAllocations: z.array(createPurchaseReceiptBatchAllocationSchema).min(1, 'Each receipt line must allocate at least one batch'),
});

export const createPurchaseReceiptSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  receiptNumber: z.string().min(1).max(64).optional(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid(),
  receiptDate: z.string().min(10).max(30).optional(),
  supplierDeliveryNote: z.string().max(64).nullable().optional(),
  qcRequired: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(createPurchaseReceiptLineSchema).min(1, 'Purchase receipt must have at least one line item'),
});

export const createPurchaseReturnLineSchema = z.object({
  qcLineId: z.string().uuid().nullable().optional(),
  receiptLineId: z.string().uuid(),
  batchId: z.string().uuid(),
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  returnQuantity: z.number().positive(),
  unitRate: z.number().nonnegative(),
  totalAmount: z.number().nonnegative().optional(),
});

export const createPurchaseReturnSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  returnNumber: z.string().min(1).max(64).optional(),
  supplierId: z.string().uuid(),
  receiptId: z.string().uuid().nullable().optional(),
  qcInspectionId: z.string().uuid().nullable().optional(),
  returnDate: z.string().min(10).max(30).optional(),
  reason: z.string().max(1000).nullable().optional(),
  lines: z.array(createPurchaseReturnLineSchema).min(1, 'Purchase return must have at least one line item'),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type CreatePurchaseReceiptInput = z.infer<typeof createPurchaseReceiptSchema>;
export type CreatePurchaseReturnInput = z.infer<typeof createPurchaseReturnSchema>;
