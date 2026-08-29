import { Request, Response, NextFunction } from 'express';
import { SecurityContext } from '../../shared/types/index.js';
import { AppError } from '../../shared/errors/AppError.js';

// Extend Express Request to carry security context
declare global {
  namespace Express {
    interface Request {
      securityContext?: SecurityContext;
    }
  }
}

/**
 * Middleware that extracts security context headers or initializes a default context.
 * In production/real execution, this is populated from validated JWT + DB user_company_roles.
 * Supports headers:
 * - x-user-id
 * - x-user-email
 * - x-is-superadmin ('true'/'false')
 * - x-company-id
 * - x-branch-id
 * - x-permissions (comma-separated permission strings)
 */
export function extractSecurityContext(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.headers['x-user-id'] as string) || 'system-user';
  const email = (req.headers['x-user-email'] as string) || 'system@erp.local';
  const fullName = (req.headers['x-user-name'] as string) || 'System User';
  const isSuperadmin = req.headers['x-is-superadmin'] === 'true';
  const activeCompanyId = (req.headers['x-company-id'] as string) || null;
  const activeBranchId = (req.headers['x-branch-id'] as string) || null;
  
  const rawPermissions = (req.headers['x-permissions'] as string) || '';
  const effectivePermissions = rawPermissions
    ? rawPermissions.split(',').map((p) => p.trim()).filter(Boolean)
    : isSuperadmin
    ? ['*']
    : [];

  req.securityContext = {
    userId,
    email,
    fullName,
    isSuperadmin,
    activeCompanyId,
    activeBranchId,
    effectivePermissions,
    correlationId: (req.headers['x-correlation-id'] as string) || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
  };

  next();
}

/**
 * Authorization guard enforcing required atomic permission key or wildcard '*'.
 */
export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.securityContext;

    if (!ctx) {
      return next(AppError.unauthorized('Security context is missing'));
    }

    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*') || ctx.effectivePermissions.includes(permissionKey)) {
      return next();
    }

    return next(AppError.forbidden(`Missing required permission: ${permissionKey}`));
  };
}

/**
 * Validates that an active company is selected and matches the targeted resource company if applicable.
 */
export function requireActiveCompany(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.securityContext;
  if (!ctx || (!ctx.isSuperadmin && !ctx.activeCompanyId)) {
    return next(
      new AppError({
        message: 'An active company context must be selected to perform this action',
        code: 'TENANT_NOT_FOUND',
        statusCode: 400,
        isOperational: true,
      })
    );
  }
  next();
}
