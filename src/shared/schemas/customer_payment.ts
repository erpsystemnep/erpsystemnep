import { z } from 'zod';

export const PaymentMethodSchema = z.enum(['CASH', 'BANK', 'CHECK', 'CREDIT_CARD', 'OTHER']);

export const PaymentAllocationSchema = z.object({
  receivableId: z.string().uuid('Valid receivable ID is required'),
  allocatedAmount: z.number().positive('Allocated amount must be greater than 0'),
});

export const CreateCustomerPaymentSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid('Valid customer ID is required'),
  paymentDate: z.string().optional(),
  amount: z.number().positive('Payment amount must be greater than 0'),
  currencyCode: z.string().min(3).max(3).default('USD'),
  exchangeRate: z.number().positive('Exchange rate must be positive').default(1.0),
  paymentMethod: PaymentMethodSchema.default('BANK'),
  depositAccountId: z.string().uuid('Deposit account ID is required'),
  arAccountId: z.string().uuid().optional().nullable(),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  allocations: z.array(PaymentAllocationSchema).optional().default([]),
});

export const UpdateCustomerPaymentSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  paymentDate: z.string().optional(),
  amount: z.number().positive().optional(),
  currencyCode: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  depositAccountId: z.string().uuid().optional(),
  arAccountId: z.string().uuid().optional().nullable(),
  referenceNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  allocations: z.array(PaymentAllocationSchema).optional(),
});

export type CreateCustomerPaymentInput = z.infer<typeof CreateCustomerPaymentSchema>;
export type UpdateCustomerPaymentInput = z.infer<typeof UpdateCustomerPaymentSchema>;
export type PaymentAllocationInput = z.infer<typeof PaymentAllocationSchema>;

// Aliases
export const createCustomerPaymentSchema = CreateCustomerPaymentSchema;
export const updateCustomerPaymentSchema = UpdateCustomerPaymentSchema;
export const paymentAllocationSchema = PaymentAllocationSchema;
