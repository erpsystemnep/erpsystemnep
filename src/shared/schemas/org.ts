import { z } from 'zod';

/**
 * Organization Foundation Validation Schemas
 */

// 1. Company Schemas
export const createCompanySchema = z.object({
  code: z
    .string()
    .min(2, 'Company code must be at least 2 characters')
    .max(32, 'Company code must not exceed 32 characters')
    .regex(/^[A-Z0-9_-]+$/, 'Company code must be uppercase alphanumeric with optional underscores or hyphens'),
  legalName: z
    .string()
    .min(2, 'Legal name must be at least 2 characters')
    .max(255, 'Legal name must not exceed 255 characters'),
  tradeName: z.string().max(255).optional(),
  baseCurrency: z
    .string()
    .length(3, 'Base currency must be a 3-letter ISO code')
    .regex(/^[A-Z]{3}$/, 'Base currency must be 3 uppercase letters'),
  taxIdentifier: z.string().max(64).optional(),
  fiscalYearStartMonth: z
    .number()
    .int()
    .min(1, 'Fiscal year start month must be between 1 and 12')
    .max(12, 'Fiscal year start month must be between 1 and 12')
    .default(1),
  isActive: z.boolean().default(true),
});

export const updateCompanySchema = createCompanySchema.partial();

// 2. Branch Schemas
export const createBranchSchema = z.object({
  companyId: z.string().uuid('Invalid company ID format'),
  code: z
    .string()
    .min(2, 'Branch code must be at least 2 characters')
    .max(32, 'Branch code must not exceed 32 characters')
    .regex(/^[A-Z0-9_-]+$/, 'Branch code must be uppercase alphanumeric with optional underscores or hyphens'),
  name: z
    .string()
    .min(2, 'Branch name must be at least 2 characters')
    .max(255, 'Branch name must not exceed 255 characters'),
  isHeadOffice: z.boolean().default(false),
  addressLine1: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  stateProvince: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  countryCode: z
    .string()
    .length(2, 'Country code must be a 2-letter ISO code')
    .regex(/^[A-Z]{2}$/, 'Country code must be 2 uppercase letters')
    .default('US'),
  timezone: z.string().min(1, 'Timezone is required').default('UTC'),
  isActive: z.boolean().default(true),
});

export const updateBranchSchema = createBranchSchema.omit({ companyId: true }).partial();

// 3. Warehouse Schemas
export const warehouseTypeEnumSchema = z.enum([
  'PHYSICAL',
  'CENTRAL_DC',
  'QUARANTINE',
  'IN_TRANSIT',
  'WIP_PRODUCTION',
  'VIRTUAL_CONSIGNMENT',
]);

export const createWarehouseSchema = z.object({
  companyId: z.string().uuid('Invalid company ID format'),
  branchId: z.string().uuid('Invalid branch ID format').nullable().optional(), // Nullable represents company-level warehouse/DC
  code: z
    .string()
    .min(2, 'Warehouse code must be at least 2 characters')
    .max(32, 'Warehouse code must not exceed 32 characters')
    .regex(/^[A-Z0-9_-]+$/, 'Warehouse code must be uppercase alphanumeric with optional underscores or hyphens'),
  name: z
    .string()
    .min(2, 'Warehouse name must be at least 2 characters')
    .max(255, 'Warehouse name must not exceed 255 characters'),
  warehouseType: warehouseTypeEnumSchema.default('PHYSICAL'),
  isActive: z.boolean().default(true),
});

export const updateWarehouseSchema = createWarehouseSchema.omit({ companyId: true }).partial();

// 4. Numbering Series Schemas
export const numberingResetFreqEnumSchema = z.enum(['NEVER', 'ANNUAL', 'MONTHLY']);

export const createNumberingSeriesSchema = z.object({
  companyId: z.string().uuid('Invalid company ID format'),
  branchId: z.string().uuid('Invalid branch ID format').nullable().optional(),
  documentType: z
    .string()
    .min(2, 'Document type must be at least 2 characters')
    .max(64, 'Document type must not exceed 64 characters')
    .regex(/^[A-Z0-9_]+$/, 'Document type must be uppercase alphanumeric with underscores'),
  prefix: z
    .string()
    .min(1, 'Prefix must be at least 1 character')
    .max(32, 'Prefix must not exceed 32 characters'),
  suffix: z.string().max(32).optional(),
  minDigits: z
    .number()
    .int()
    .min(3, 'Minimum digits must be at least 3')
    .max(10, 'Minimum digits cannot exceed 10')
    .default(5),
  currentNumber: z.number().int().nonnegative().default(0),
  resetFrequency: numberingResetFreqEnumSchema.default('NEVER'),
  isActive: z.boolean().default(true),
});

export const updateNumberingSeriesSchema = createNumberingSeriesSchema.omit({ companyId: true, documentType: true }).partial();

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;
export type CreateNumberingSeriesInput = z.infer<typeof createNumberingSeriesSchema>;
export type UpdateNumberingSeriesInput = z.infer<typeof updateNumberingSeriesSchema>;
