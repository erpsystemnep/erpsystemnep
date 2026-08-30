import { z } from 'zod';

export const createCategorySchema = z.object({
  code: z.string().min(1, 'Category code is required').max(64).regex(/^[A-Za-z0-9_-]+$/, 'Category code must be alphanumeric with underscores or hyphens'),
  name: z.string().min(1, 'Category name is required').max(255),
  description: z.string().nullish(),
  parentCategoryId: z.string().uuid('Invalid parent category UUID').nullish(),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(255).optional(),
  description: z.string().nullish(),
  parentCategoryId: z.string().uuid('Invalid parent category UUID').nullish(),
  isActive: z.boolean().optional(),
});

export const categoryQuerySchema = z.object({
  search: z.string().optional(),
  code: z.string().optional(),
  name: z.string().optional(),
  parentCategoryId: z.string().uuid().nullish(),
  isActive: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  page: z.preprocess((val) => (val ? parseInt(String(val), 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((val) => (val ? parseInt(String(val), 10) : 100), z.number().int().min(1).max(200).default(100)),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CategoryQueryInput = z.infer<typeof categoryQuerySchema>;
