import { z } from 'zod';

export const addressTypeSchema = z.enum(['BILLING', 'SHIPPING', 'REGISTERED', 'OTHER']);
export const partnerTypeSchema = z.enum(['ORGANIZATION', 'INDIVIDUAL']);

export const partnerAddressInputSchema = z.object({
  id: z.string().uuid().optional(),
  addressType: addressTypeSchema.default('SHIPPING'),
  addressLine1: z.string().min(1, 'Address line 1 is required').max(255),
  addressLine2: z.string().max(255).nullish(),
  city: z.string().max(128).nullish(),
  stateProvince: z.string().max(128).nullish(),
  postalCode: z.string().max(32).nullish(),
  countryCode: z.string().length(2, 'Country code must be 2 characters (ISO-3166)').default('US'),
  isDefault: z.boolean().default(false),
});

export const partnerContactInputSchema = z.object({
  id: z.string().uuid().optional(),
  contactName: z.string().min(1, 'Contact name is required').max(255),
  designation: z.string().max(128).nullish(),
  email: z.string().email('Invalid email address').max(255).nullish().or(z.literal('')),
  phone: z.string().max(64).nullish(),
  isPrimary: z.boolean().default(false),
});

export const createPartnerSchema = z.object({
  partnerCode: z.string().min(1, 'Partner code is required').max(64).regex(/^[A-Za-z0-9_-]+$/, 'Partner code must be alphanumeric with underscores or hyphens'),
  legalName: z.string().min(1, 'Legal name is required').max(255),
  tradeName: z.string().max(255).nullish(),
  partnerType: partnerTypeSchema.default('ORGANIZATION'),
  taxIdentifier: z.string().max(64).nullish(),
  email: z.string().email('Invalid email address').max(255).nullish().or(z.literal('')),
  phone: z.string().max(64).nullish(),
  countryCode: z.string().length(2, 'Country code must be 2 characters').default('US'),
  currencyCode: z.string().length(3, 'Currency code must be 3 characters (e.g. USD)').default('USD'),
  isCustomer: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
  isActive: z.boolean().default(true),
  addresses: z.array(partnerAddressInputSchema).optional(),
  contacts: z.array(partnerContactInputSchema).optional(),
}).refine(data => data.isCustomer || data.isSupplier, {
  message: 'Partner must be flagged as a Customer, Supplier, or both',
  path: ['isCustomer'],
});

export const updatePartnerSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required').max(255).optional(),
  tradeName: z.string().max(255).nullish(),
  partnerType: partnerTypeSchema.optional(),
  taxIdentifier: z.string().max(64).nullish(),
  email: z.string().email('Invalid email address').max(255).nullish().or(z.literal('')),
  phone: z.string().max(64).nullish(),
  countryCode: z.string().length(2).optional(),
  currencyCode: z.string().length(3).optional(),
  isCustomer: z.boolean().optional(),
  isSupplier: z.boolean().optional(),
  isActive: z.boolean().optional(),
  addresses: z.array(partnerAddressInputSchema).optional(),
  contacts: z.array(partnerContactInputSchema).optional(),
});

export const partnerQuerySchema = z.object({
  search: z.string().optional(),
  partnerCode: z.string().optional(),
  legalName: z.string().optional(),
  taxIdentifier: z.string().optional(),
  isCustomer: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  isSupplier: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  isActive: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  page: z.preprocess((val) => (val ? parseInt(String(val), 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val ? parseInt(String(val), 10) : 50), z.number().int().min(1).max(200).default(50)),
});

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;
export type PartnerQueryInput = z.infer<typeof partnerQuerySchema>;
