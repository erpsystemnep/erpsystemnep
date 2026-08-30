import { z } from 'zod';

export const itemTypeSchema = z.enum([
  'RAW_MATERIAL',
  'INGREDIENT',
  'FINISHED_GOOD',
  'SEMI_FINISHED_GOOD',
  'PACKAGING',
  'CONSUMABLE',
  'SERVICE',
  'OTHER',
]);

export const itemUomConversionInputSchema = z.object({
  fromUomId: z.string().uuid('Invalid fromUomId UUID'),
  toUomId: z.string().uuid('Invalid toUomId UUID'),
  conversionFactor: z.number().positive('Conversion factor must be greater than 0'),
}).refine(data => data.fromUomId !== data.toUomId, {
  message: 'From UOM and To UOM cannot be the same',
  path: ['toUomId'],
});

export const createItemSchema = z.object({
  sku: z.string().min(1, 'SKU is required').max(64).regex(/^[A-Za-z0-9_.-]+$/, 'SKU must contain only alphanumeric characters, underscores, dots, or hyphens'),
  itemName: z.string().min(1, 'Item name is required').max(255),
  description: z.string().nullish(),
  categoryId: z.string().uuid('Invalid category UUID').nullish(),
  itemType: itemTypeSchema.default('RAW_MATERIAL'),
  baseUomId: z.string().uuid('Invalid base UOM UUID'),
  isStockItem: z.boolean().default(true),
  isSaleable: z.boolean().default(false),
  isPurchasable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  conversions: z.array(itemUomConversionInputSchema).optional(),
});

export const updateItemSchema = z.object({
  itemName: z.string().min(1, 'Item name is required').max(255).optional(),
  description: z.string().nullish(),
  categoryId: z.string().uuid('Invalid category UUID').nullish(),
  itemType: itemTypeSchema.optional(),
  baseUomId: z.string().uuid('Invalid base UOM UUID').optional(),
  isStockItem: z.boolean().optional(),
  isSaleable: z.boolean().optional(),
  isPurchasable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  conversions: z.array(itemUomConversionInputSchema).optional(),
});

export const itemQuerySchema = z.object({
  search: z.string().optional(),
  sku: z.string().optional(),
  itemName: z.string().optional(),
  categoryId: z.string().uuid().nullish(),
  itemType: itemTypeSchema.optional(),
  baseUomId: z.string().uuid().nullish(),
  isStockItem: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  isSaleable: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  isPurchasable: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  isActive: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  page: z.preprocess((val) => (val ? parseInt(String(val), 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val ? parseInt(String(val), 10) : 50), z.number().int().min(1).max(200).default(50)),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ItemQueryInput = z.infer<typeof itemQuerySchema>;
export type ItemUomConversionInput = z.infer<typeof itemUomConversionInputSchema>;
