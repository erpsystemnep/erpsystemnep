import { z } from 'zod';

/**
 * Audit Logging Validation Schemas
 */

export const auditActionSchema = z.enum([
  'CREATE',
  'UPDATE',
  'DELETE',
  'VIEW',
  'EXPORT',
  'APPROVE',
  'REJECT',
  'POST',
  'CANCEL',
  'REVERSE',
  'LOGIN',
  'LOGOUT',
  'PERMISSION_CHANGE',
]);

export const createAuditLogSchema = z.object({
  companyId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  action: auditActionSchema,
  module: z
    .string()
    .min(2, 'Module name must be at least 2 characters')
    .max(64, 'Module name must not exceed 64 characters'),
  entityName: z
    .string()
    .min(2, 'Entity name must be at least 2 characters')
    .max(64, 'Entity name must not exceed 64 characters'),
  entityId: z.string().min(1, 'Entity ID is required').max(64),
  reasonCode: z.string().max(64).optional(),
  reasonText: z.string().max(1000).optional(),
  changes: z
    .object({
      old: z.record(z.string(), z.unknown()).optional(),
      new: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  ipAddress: z.string().max(45).optional(),
  userAgent: z.string().max(500).optional(),
  sessionId: z.string().max(128).optional(),
  correlationId: z.string().max(64).optional(),
});

export const auditQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  action: auditActionSchema.optional(),
  module: z.string().optional(),
  entityName: z.string().optional(),
  entityId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export type CreateAuditLogInput = z.infer<typeof createAuditLogSchema>;
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
