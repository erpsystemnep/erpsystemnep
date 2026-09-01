import { z } from 'zod';

export const createInventoryBatchSchema = z.object({
  companyId: z.string().uuid(),
  itemId: z.string().uuid(),
  batchNumber: z.string().min(1).max(64),
  supplierId: z.string().uuid().nullable().optional(),
  supplierBatchNumber: z.string().max(64).nullable().optional(),
  manufacturingDate: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  unitCost: z.number().nonnegative().default(0),
});

export const createQcInspectionLineSchema = z.object({
  receiptLineId: z.string().uuid(),
  batchId: z.string().uuid(),
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  receivedQuantity: z.number().positive(),
  passedQuantity: z.number().nonnegative(),
  failedQuantity: z.number().nonnegative(),
  rejectionReason: z.string().max(255).nullable().optional(),
  remarks: z.string().max(1000).nullable().optional(),
}).refine(
  (data) => data.passedQuantity + data.failedQuantity <= data.receivedQuantity,
  {
    message: 'Sum of passed and failed quantity cannot exceed received quantity',
    path: ['failedQuantity'],
  }
);

export const createQcInspectionSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  inspectionNumber: z.string().min(1).max(64).optional(),
  receiptId: z.string().uuid(),
  inspectionDate: z.string().min(10).max(30).optional(),
  remarks: z.string().max(2000).nullable().optional(),
  lines: z.array(createQcInspectionLineSchema).min(1, 'QC inspection must have at least one line item'),
});

export const stockLedgerFilterSchema = z.object({
  companyId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  stockStatus: z.enum(['AVAILABLE', 'QC_PENDING', 'QC_FAILED', 'RESERVED']).optional(),
  movementType: z.enum(['PURCHASE_RECEIPT', 'QC_RELEASE', 'QC_RESTRICTION', 'PURCHASE_RETURN', 'REVERSAL']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

export const stockBalanceFilterSchema = z.object({
  companyId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
});

export type CreateInventoryBatchInput = z.infer<typeof createInventoryBatchSchema>;
export type CreateQcInspectionLineInput = z.infer<typeof createQcInspectionLineSchema>;
export type CreateQcInspectionInput = z.infer<typeof createQcInspectionSchema>;
export type StockLedgerFilterInput = z.infer<typeof stockLedgerFilterSchema>;
export type StockBalanceFilterInput = z.infer<typeof stockBalanceFilterSchema>;
