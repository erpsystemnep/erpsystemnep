import { z } from 'zod';

/**
 * Authentication & RBAC Foundation Validation Schemas
 */

// 1. Action Primitives & Permission Schemas
export const actionPrimitiveSchema = z.enum([
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'approve',
  'reject',
  'post',
  'cancel',
  'reverse',
  'print',
]);

export const permissionKeySchema = z
  .string()
  .regex(/^[a-z0-9_]+\.[a-z0-9_]+\.(view|create|edit|delete|export|approve|reject|post|cancel|reverse|print)$/, {
    message: 'Permission key must follow the format: <module>.<resource>.<action_primitive>',
  });

// 2. Authentication Request/Response Schemas
export const loginRequestSchema = z.object({
  email: z.string().email('Invalid email address format').min(5).max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const authResponseSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    fullName: z.string(),
    isSuperadmin: z.boolean(),
    isActive: z.boolean(),
  }),
  companies: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      legalName: z.string(),
      roles: z.array(
        z.object({
          id: z.string().uuid(),
          code: z.string(),
          name: z.string(),
          branchId: z.string().uuid().nullable().optional(),
        })
      ),
    })
  ),
});

// 3. User Identity Schemas
export const createUserSchema = z.object({
  email: z.string().email('Invalid email address').min(5).max(255),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  isSuperadmin: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(2).max(255).optional(),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .optional(),
  isActive: z.boolean().optional(),
});

// 4. Role Management Schemas
export const createRoleSchema = z.object({
  companyId: z.string().uuid('Invalid company ID').nullable().optional(), // Nullable indicates system-wide role template
  code: z
    .string()
    .min(2, 'Role code must be at least 2 characters')
    .max(64, 'Role code must not exceed 64 characters')
    .regex(/^[A-Z0-9_]+$/, 'Role code must be uppercase alphanumeric with underscores'),
  name: z.string().min(2, 'Role name must be at least 2 characters').max(255),
  description: z.string().max(1000).default(''),
  permissionIds: z.array(permissionKeySchema).min(1, 'Role must contain at least one permission'),
});

export const updateRoleSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  description: z.string().max(1000).optional(),
  permissionIds: z.array(permissionKeySchema).optional(),
});

// 5. User-Company-Role Assignment Schema
export const assignUserRoleSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  companyId: z.string().uuid('Invalid company ID format'),
  branchId: z.string().uuid('Invalid branch ID format').nullable().optional(), // Nullable = all branches in company
  roleId: z.string().uuid('Invalid role ID format'),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type CreateUserInput = z.input<typeof createUserSchema>;
export type CreateUserOutput = z.output<typeof createUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;
export type CreateRoleInput = z.input<typeof createRoleSchema>;
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;
export type AssignUserRoleInput = z.input<typeof assignUserRoleSchema>;
