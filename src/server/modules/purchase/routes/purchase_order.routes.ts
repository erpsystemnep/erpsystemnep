import { Router, Request, Response, NextFunction } from 'express';
import { PurchaseOrderService } from '../services/purchase_order.service.js';
import { createPurchaseOrderSchema } from '../../../../shared/schemas/purchase.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createPurchaseOrderRouter(
  poService: PurchaseOrderService = new PurchaseOrderService()
): Router {
  const router = Router();

  // List POs
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.order.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { branchId, supplierId, status } = req.query;
        const data = await poService.list(
          {
            branchId: branchId ? String(branchId) : undefined,
            supplierId: supplierId ? String(supplierId) : undefined,
            status: status ? String(status) : undefined,
          },
          req.securityContext!
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get PO by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.order.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await poService.findById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create PO
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.order.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = createPurchaseOrderSchema.parse({
          ...req.body,
          companyId: req.securityContext!.activeCompanyId,
        });
        const data = await poService.create(validated, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit PO
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.order.submit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await poService.submit(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve PO
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.order.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await poService.approve(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reject PO
  router.post(
    '/:id/reject',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.order.reject'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { reason } = req.body;
        const data = await poService.reject(req.params.id, reason, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cancel PO
  router.post(
    '/:id/cancel',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.order.cancel'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await poService.cancel(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
