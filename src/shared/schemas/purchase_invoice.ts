import { z } from 'zod';

export const PurchaseInvoiceLineSchema = z.object({
  purchaseReceiptLineId: z.string().uuid('Valid purchase receipt line ID is required'),
  poLineId: z.string().uuid().optional().nullable(),
  lineNumber: z.number().int().positive().optional(),
  itemId: z.string().uuid('Valid item ID is required'),
  warehouseId: z.string().uuid().optional().nullable(),
  uomId: z.string().uuid('Valid UOM ID is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  conversionFactor: z.number().positive().default(1.0),
  baseQuantity: z.number().positive().optional(),
  unitPrice: z.number().min(0, 'Unit price must be non-negative'),
  discountRate: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).default(0),
  expenseAccountId: z.string().uuid().optional().nullable(),
});

export const CreatePurchaseInvoiceSchema = z.object({
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid('Valid supplier business partner ID is required'),
  purchaseOrderId: z.string().uuid().optional().nullable(),
  receiptId: z.string().uuid().optional().nullable(),
  supplierInvoiceRef: z.string().max(64).optional().nullable(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  currencyCode: z.string().min(3).max(3).default('USD'),
  exchangeRate: z.number().positive().default(1.0),
  notes: z.string().optional().nullable(),
  lines: z.array(PurchaseInvoiceLineSchema).min(1, 'At least one invoice line is required'),
});

export const UpdatePurchaseInvoiceSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  supplierInvoiceRef: z.string().max(64).optional().nullable(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  currencyCode: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  notes: z.string().optional().nullable(),
  lines: z.array(PurchaseInvoiceLineSchema).min(1).optional(),
});

export type CreatePurchaseInvoiceInput = z.infer<typeof CreatePurchaseInvoiceSchema>;
export type UpdatePurchaseInvoiceInput = z.infer<typeof UpdatePurchaseInvoiceSchema>;
export type CreatePurchaseInvoiceLineInput = z.infer<typeof PurchaseInvoiceLineSchema>;

// CamelCase aliases
export const createPurchaseInvoiceSchema = CreatePurchaseInvoiceSchema;
export const updatePurchaseInvoiceSchema = UpdatePurchaseInvoiceSchema;
export const purchaseInvoiceLineSchema = PurchaseInvoiceLineSchema;
