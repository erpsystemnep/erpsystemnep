import { Router, Request, Response, NextFunction } from 'express';
import { CustomerReceivableService } from '../services/customer_receivable.service.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createCustomerReceivableRouter(
  receivableService: CustomerReceivableService = new CustomerReceivableService()
): Router {
  const router = Router();

  // List Receivables
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.receivable.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { customerId, status, startDate, endDate, limit, offset } = req.query;
        const result = await receivableService.list(
          {
            customerId: customerId ? String(customerId) : undefined,
            status: status ? (String(status) as any) : undefined,
            startDate: startDate ? String(startDate) : undefined,
            endDate: endDate ? String(endDate) : undefined,
            limit: limit ? parseInt(String(limit), 10) : undefined,
            offset: offset ? parseInt(String(offset), 10) : undefined,
          },
          req.securityContext!
        );
        res.json({ success: true, ...result });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Receivable by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.receivable.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await receivableService.getById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
