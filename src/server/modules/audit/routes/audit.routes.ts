import { Router, Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service.js';
import { requireAuth, requirePermission } from '../../../middleware/auth.js';

export function createAuditRouter(auditService: AuditService = new AuditService()): Router {
  const router = Router();

  // Query audit logs
  router.get(
    '/logs',
    requireAuth,
    requirePermission('audit.log.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await auditService.queryLogs(req.query, req.securityContext!);
        res.json({
          success: true,
          data: result.items,
          meta: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
