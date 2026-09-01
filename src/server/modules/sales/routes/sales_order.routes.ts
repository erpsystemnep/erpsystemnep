import { Router, Request, Response, NextFunction } from 'express';
import { SalesOrderService } from '../services/sales_order.service.js';
import { createSalesOrderSchema } from '../../../../shared/schemas/sales.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createSalesOrderRouter(
  soService: SalesOrderService = new SalesOrderService()
): Router {
  const router = Router();

  // List Sales Orders
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { branchId, customerId, status, search, page, limit } = req.query;
        const result = await soService.list(
          {
            branchId: branchId ? String(branchId) : undefined,
            customerId: customerId ? String(customerId) : undefined,
            status: status ? (String(status) as any) : undefined,
            search: search ? String(search) : undefined,
            page: page ? parseInt(String(page), 10) : undefined,
            limit: limit ? parseInt(String(limit), 10) : undefined,
          },
          req.securityContext!
        );
        res.json({ success: true, ...result });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Sales Order by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await soService.findById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Sales Order
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = createSalesOrderSchema.parse({
          ...req.body,
          companyId: req.securityContext!.activeCompanyId,
        });
        const data = await soService.create(validated, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Sales Order
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await soService.submit(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve Sales Order
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await soService.approve(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reject Sales Order
  router.post(
    '/:id/reject',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.reject'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await soService.reject(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post / Confirm Sales Order
  router.post(
    '/:id/post',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await soService.post(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cancel Sales Order
  router.post(
    '/:id/cancel',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.cancel'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await soService.cancel(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Delete Draft Sales Order
  router.delete(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.order.delete'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const success = await soService.delete(req.params.id, req.securityContext!);
        res.json({ success });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
