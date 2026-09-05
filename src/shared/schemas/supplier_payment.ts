import { z } from 'zod';
import { PaymentMethodSchema } from './customer_payment.js';

export const SupplierPaymentAllocationSchema = z.object({
  payableId: z.string().uuid('Valid payable ID is required'),
  allocatedAmount: z.number().positive('Allocated amount must be greater than 0'),
});

export const CreateSupplierPaymentSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid('Valid supplier ID is required'),
  paymentDate: z.string().optional(),
  amount: z.number().positive('Payment amount must be greater than 0'),
  currencyCode: z.string().min(3).max(3).default('USD'),
  exchangeRate: z.number().positive('Exchange rate must be positive').default(1.0),
  paymentMethod: PaymentMethodSchema.default('BANK'),
  disbursementAccountId: z.string().uuid('Disbursement account ID is required'),
  apAccountId: z.string().uuid().optional().nullable(),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  allocations: z.array(SupplierPaymentAllocationSchema).optional().default([]),
});

export const UpdateSupplierPaymentSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  paymentDate: z.string().optional(),
  amount: z.number().positive().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  disbursementAccountId: z.string().uuid().optional(),
  apAccountId: z.string().uuid().optional().nullable(),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  allocations: z.array(SupplierPaymentAllocationSchema).optional(),
});

export type CreateSupplierPaymentInput = z.infer<typeof CreateSupplierPaymentSchema>;
export type UpdateSupplierPaymentInput = z.infer<typeof UpdateSupplierPaymentSchema>;
export type SupplierPaymentAllocationInput = z.infer<typeof SupplierPaymentAllocationSchema>;

// Aliases
export const createSupplierPaymentSchema = CreateSupplierPaymentSchema;
export const updateSupplierPaymentSchema = UpdateSupplierPaymentSchema;
export const supplierPaymentAllocationSchema = SupplierPaymentAllocationSchema;
