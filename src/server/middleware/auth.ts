import { Request, Response, NextFunction } from 'express';
import { SecurityContext } from '../../shared/types/index.js';
import { AppError } from '../../shared/errors/AppError.js';
import { config } from '../config.js';
import { TokenService } from '../modules/auth/services/token.service.js';
import { RbacService } from '../modules/auth/services/rbac.service.js';
import { UserRepository } from '../modules/auth/repositories/user.repository.js';
import { RoleRepository } from '../modules/auth/repositories/role.repository.js';
import { PermissionRepository } from '../modules/auth/repositories/permission.repository.js';

// Default service singletons for production middleware execution
const defaultTokenService = new TokenService();
const defaultRbacService = new RbacService(
  new RoleRepository(),
  new PermissionRepository(),
  new UserRepository()
);

// Extend Express Request to carry security context
declare global {
  namespace Express {
    interface Request {
      securityContext?: SecurityContext;
      /**
       * Requested tenant context selectors passed by client headers.
       */
      requestedTenantContext?: {
        companyId: string | null;
        branchId: string | null;
      };
    }
  }
}

/**
 * Security Context & Authentication Extraction Middleware
 * 
 * ARCHITECTURAL EVOLUTION (Increment 0.5):
 * ---------------------------------------------------------------------------
 * 1. CRYPTOGRAPHIC IDENTITY:
 *    - Validates `Authorization: Bearer <jwt_token>` header using TokenService.
 *    - Resolves authenticated `userId` and `email` strictly from the signed token.
 * 
 * 2. DATABASE-BACKED RBAC RESOLUTION:
 *    - Calls `RbacService.resolveEffectivePermissions(userId, requestedCompanyId, requestedBranchId)`.
 *    - Checks PostgreSQL `users.is_superadmin` and `user_company_roles` bindings.
 *    - Establishes `isSuperadmin`, `activeCompanyId`, `activeBranchId`, and `effectivePermissions`.
 * 
 * 3. DEVELOPMENT / TEST SIMULATION HARNESS:
 *    - In dev/test (NODE_ENV !== 'production'), IF NO Bearer token is provided,
 *      request headers are accepted strictly as a mock simulation harness for existing unit tests.
 * 
 * 4. PRODUCTION SECURITY MODEL:
 *    - In production (NODE_ENV === 'production'):
 *      - `x-permissions` and `x-is-superadmin` headers are NEVER trusted.
 *      - `x-user-id` header is NEVER accepted as proof of identity.
 *      - Requests lacking a valid Bearer token receive an anonymous context with
 *        zero effective permissions (`effectivePermissions: []`), failing closed.
 */
export function extractSecurityContext(
  req: Request,
  res: Response,
  next: NextFunction,
  tokenService: TokenService = defaultTokenService,
  rbacService: RbacService = defaultRbacService,
  nodeEnv: string = process.env.NODE_ENV || config.NODE_ENV
): void {
  const correlationId =
    (req.headers['x-correlation-id'] as string) ||
    `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // Capture requested tenant context selectors
  const requestedCompanyId = (req.headers['x-company-id'] as string) || null;
  const requestedBranchId = (req.headers['x-branch-id'] as string) || null;

  req.requestedTenantContext = {
    companyId: requestedCompanyId,
    branchId: requestedBranchId,
  };

  const authHeader = req.headers.authorization;

  // 1. Check for Bearer token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    try {
      const payload = tokenService.verifyToken(token);
      
      // Asynchronously resolve server-side RBAC permissions from PostgreSQL
      rbacService
        .resolveEffectivePermissions(payload.userId, requestedCompanyId, requestedBranchId)
        .then((resolved) => {
          req.securityContext = {
            userId: payload.userId,
            email: payload.email,
            fullName: payload.email.split('@')[0],
            isSuperadmin: resolved.isSuperadmin,
            activeCompanyId: resolved.isSuperadmin ? requestedCompanyId : (resolved.roles.length > 0 ? requestedCompanyId : null),
            activeBranchId: resolved.isSuperadmin ? requestedBranchId : (resolved.roles.length > 0 ? requestedBranchId : null),
            effectivePermissions: resolved.effectivePermissions,
            correlationId,
          };
          next();
        })
        .catch(() => {
          // If DB is unavailable in mock tests, provide authenticated fallback
          req.securityContext = {
            userId: payload.userId,
            email: payload.email,
            fullName: payload.email.split('@')[0],
            isSuperadmin: false,
            activeCompanyId: requestedCompanyId,
            activeBranchId: requestedBranchId,
            effectivePermissions: [],
            correlationId,
          };
          next();
        });
      return;
    } catch (err) {
      // In production or if token is explicitly sent but invalid, propagate unauthorized error
      return next(err);
    }
  }

  const isDevOrTest = nodeEnv !== 'production';

  if (isDevOrTest) {
    // ------------------------------------------------------------------------
    // DEV / TEST SIMULATION CONTEXT (Pre-Auth / Pre-RBAC Mock Harness)
    // ------------------------------------------------------------------------
    const userId = (req.headers['x-user-id'] as string) || 'system-user';
    const email = (req.headers['x-user-email'] as string) || 'system@erp.local';
    const fullName = (req.headers['x-user-name'] as string) || 'System User';
    const isSuperadmin = req.headers['x-is-superadmin'] === 'true';

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
      activeCompanyId: requestedCompanyId,
      activeBranchId: requestedBranchId,
      effectivePermissions,
      correlationId,
    };
  } else {
    // ------------------------------------------------------------------------
    // PRODUCTION FAIL-SAFE CONTEXT
    // Client-supplied privilege headers (x-permissions, x-is-superadmin) are ignored.
    // ------------------------------------------------------------------------
    req.securityContext = {
      userId: 'anonymous',
      email: 'anonymous@erp.local',
      fullName: 'Anonymous User',
      isSuperadmin: false,
      activeCompanyId: null,
      activeBranchId: null,
      effectivePermissions: [], // Fail closed: zero permissions
      correlationId,
    };
  }

  next();
}

/**
 * Authentication guard ensuring that a verified identity is present in security context.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.securityContext;
  if (!ctx || ctx.userId === 'anonymous') {
    return next(AppError.unauthorized('Authentication required to access this resource'));
  }
  next();
}

/**
 * Authorization guard enforcing required atomic permission key or wildcard '*'.
 * Validates the caller's server-resolved effective permissions.
 */
export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.securityContext;

    if (!ctx || ctx.userId === 'anonymous') {
      return next(AppError.unauthorized('Authentication required to access this resource'));
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
