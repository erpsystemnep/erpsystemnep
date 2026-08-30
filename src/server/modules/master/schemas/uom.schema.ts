import { z } from 'zod';

export const uomTypeSchema = z.enum(['WEIGHT', 'VOLUME', 'LENGTH', 'AREA', 'COUNT', 'TIME', 'OTHER']);

export const createUomSchema = z.object({
  code: z.string().min(1, 'UOM code is required').max(32).regex(/^[A-Za-z0-9_-]+$/, 'UOM code must be alphanumeric with underscores or hyphens'),
  name: z.string().min(1, 'UOM name is required').max(128),
  symbol: z.string().min(1, 'UOM symbol is required').max(16),
  uomType: uomTypeSchema.default('COUNT'),
  conversionPrecision: z.number().int().min(0).max(8).default(4),
  isActive: z.boolean().default(true),
});

export const updateUomSchema = z.object({
  name: z.string().min(1, 'UOM name is required').max(128).optional(),
  symbol: z.string().min(1, 'UOM symbol is required').max(16).optional(),
  uomType: uomTypeSchema.optional(),
  conversionPrecision: z.number().int().min(0).max(8).optional(),
  isActive: z.boolean().optional(),
});

export const uomQuerySchema = z.object({
  search: z.string().optional(),
  code: z.string().optional(),
  name: z.string().optional(),
  uomType: uomTypeSchema.optional(),
  isActive: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  page: z.preprocess((val) => (val ? parseInt(String(val), 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val ? parseInt(String(val), 10) : 100), z.number().int().min(1).max(200).default(100)),
});

export type CreateUomInput = z.infer<typeof createUomSchema>;
export type UpdateUomInput = z.infer<typeof updateUomSchema>;
export type UomQueryInput = z.infer<typeof uomQuerySchema>;
