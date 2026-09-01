import { z } from 'zod';

export const SalesInvoiceLineSchema = z.object({
  salesOrderLineId: z.string().uuid().optional().nullable(),
  deliveryLineId: z.string().uuid().optional().nullable(),
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
});

export const CreateSalesInvoiceSchema = z.object({
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid('Valid customer business partner ID is required'),
  salesOrderId: z.string().uuid().optional().nullable(),
  deliveryId: z.string().uuid().optional().nullable(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  currencyCode: z.string().min(3).max(3).default('USD'),
  exchangeRate: z.number().positive().default(1.0),
  notes: z.string().optional().nullable(),
  lines: z.array(SalesInvoiceLineSchema).min(1, 'At least one invoice line is required'),
});

export const UpdateSalesInvoiceSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  currencyCode: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  notes: z.string().optional().nullable(),
  lines: z.array(SalesInvoiceLineSchema).min(1).optional(),
});

export type CreateSalesInvoiceInput = z.infer<typeof CreateSalesInvoiceSchema>;
export type UpdateSalesInvoiceInput = z.infer<typeof UpdateSalesInvoiceSchema>;
export type CreateSalesInvoiceLineInput = z.infer<typeof SalesInvoiceLineSchema>;

// CamelCase aliases
export const createSalesInvoiceSchema = CreateSalesInvoiceSchema;
export const updateSalesInvoiceSchema = UpdateSalesInvoiceSchema;
export const salesInvoiceLineSchema = SalesInvoiceLineSchema;
