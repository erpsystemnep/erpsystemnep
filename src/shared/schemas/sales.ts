import { z } from 'zod';

export const SalesOrderLineSchema = z.object({
  lineNumber: z.number().int().positive().optional(),
  itemId: z.string().uuid('Valid item ID is required'),
  warehouseId: z.string().uuid('Valid warehouse ID is required'),
  uomId: z.string().uuid('Valid UOM ID is required'),
  orderedQuantity: z.number().positive('Ordered quantity must be greater than 0'),
  conversionFactor: z.number().positive().default(1.0),
  baseQuantity: z.number().positive().optional(),
  unitPrice: z.number().min(0, 'Unit price must be non-negative'),
  discountRate: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).default(0),
});

export const CreateSalesOrderSchema = z.object({
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid('Valid customer business partner ID is required'),
  orderDate: z.string().optional(),
  expectedDeliveryDate: z.string().optional().nullable(),
  currencyCode: z.string().min(3).max(3).default('USD'),
  exchangeRate: z.number().positive().default(1.0),
  notes: z.string().optional().nullable(),
  lines: z.array(SalesOrderLineSchema).min(1, 'At least one order line is required'),
});

export const UpdateSalesOrderSchema = z.object({
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  orderDate: z.string().optional(),
  expectedDeliveryDate: z.string().optional().nullable(),
  currencyCode: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  notes: z.string().optional().nullable(),
  lines: z.array(SalesOrderLineSchema).min(1).optional(),
});

export const CreateSalesReservationSchema = z.object({
  salesOrderId: z.string().uuid('Valid Sales Order ID is required'),
  salesOrderLineId: z.string().uuid('Valid Sales Order Line ID is required'),
  warehouseId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional().nullable(),
  reservedQuantity: z.number().positive('Reserved quantity must be greater than 0'),
});

export const ReleaseSalesReservationSchema = z.object({
  quantity: z.number().positive('Release quantity must be greater than 0').optional(),
});

export const SalesDeliveryBatchAllocationSchema = z.object({
  batchId: z.string().uuid('Valid Batch ID is required'),
  quantity: z.number().positive('Batch quantity must be greater than 0'),
});

export const SalesDeliveryLineSchema = z
  .object({
    salesOrderLineId: z.string().uuid().optional().nullable(),
    lineNumber: z.number().int().positive().optional(),
    itemId: z.string().uuid('Valid Item ID is required'),
    warehouseId: z.string().uuid('Valid Warehouse ID is required'),
    uomId: z.string().uuid('Valid UOM ID is required'),
    deliveredQuantity: z.number().positive('Delivered quantity must be greater than 0'),
    conversionFactor: z.number().positive().default(1.0),
    baseQuantity: z.number().positive().optional(),
    isReserved: z.boolean().default(false),
    batchAllocations: z.array(SalesDeliveryBatchAllocationSchema).min(1, 'At least one batch allocation is required'),
  })
  .refine(
    (line) => {
      const allocatedTotal不易 = line.batchAllocations.reduce((sum, b) => sum + b.quantity, 0);
      return Math.abs(allocatedTotal不易 - line.deliveredQuantity) < 0.00001;
    },
    {
      message: 'Sum of batch allocated quantities must exactly equal delivered quantity',
      path: ['batchAllocations'],
    }
  );

export const CreateSalesDeliverySchema = z.object({
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  salesOrderId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid('Valid customer business partner ID is required'),
  deliveryDate: z.string().optional(),
  notes: z.string().optional().nullable(),
  lines: z.array(SalesDeliveryLineSchema).min(1, 'At least one delivery line is required'),
});

export const UpdateSalesDeliverySchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  deliveryDate: z.string().optional(),
  notes: z.string().optional().nullable(),
  lines: z.array(SalesDeliveryLineSchema).min(1).optional(),
});

export type CreateSalesOrderInput = z.infer<typeof CreateSalesOrderSchema>;
export type UpdateSalesOrderInput = z.infer<typeof UpdateSalesOrderSchema>;
export type CreateSalesOrderLineInput = z.infer<typeof SalesOrderLineSchema>;

export type CreateSalesReservationInput = z.infer<typeof CreateSalesReservationSchema>;
export type ReleaseSalesReservationInput = z.infer<typeof ReleaseSalesReservationSchema>;

export type CreateSalesDeliveryInput = z.infer<typeof CreateSalesDeliverySchema>;
export type UpdateSalesDeliveryInput = z.infer<typeof UpdateSalesDeliverySchema>;
export type CreateSalesDeliveryLineInput = z.infer<typeof SalesDeliveryLineSchema>;
export type CreateSalesDeliveryBatchAllocationInput = z.infer<typeof SalesDeliveryBatchAllocationSchema>;

// CamelCase aliases for consistent imports
export const createSalesOrderSchema = CreateSalesOrderSchema;
export const updateSalesOrderSchema = UpdateSalesOrderSchema;
export const salesOrderLineSchema = SalesOrderLineSchema;
export const createSalesReservationSchema = CreateSalesReservationSchema;
export const releaseSalesReservationSchema = ReleaseSalesReservationSchema;
export const createSalesDeliverySchema = CreateSalesDeliverySchema;
export const updateSalesDeliverySchema = UpdateSalesDeliverySchema;
export const salesDeliveryLineSchema = SalesDeliveryLineSchema;
export const salesDeliveryBatchAllocationSchema = SalesDeliveryBatchAllocationSchema;

export * from './sales_invoice.js';


