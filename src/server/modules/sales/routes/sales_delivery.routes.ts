import { Router, Request, Response, NextFunction } from 'express';
import { SalesDeliveryService } from '../services/sales_delivery.service.js';
import { createSalesDeliverySchema } from '../../../../shared/schemas/sales.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createSalesDeliveryRouter(
  deliveryService: SalesDeliveryService = new SalesDeliveryService()
): Router {
  const router = Router();

  // List Deliveries
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { customerId, salesOrderId, status, search, page, limit } = req.query;
        const result = await deliveryService.list(
          {
            customerId: customerId ? String(customerId) : undefined,
            salesOrderId: salesOrderId ? String(salesOrderId) : undefined,
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

  // Get Delivery by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await deliveryService.findById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Delivery
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = createSalesDeliverySchema.parse({
          ...req.body,
          companyId: req.securityContext!.activeCompanyId,
        });
        const data = await deliveryService.create(validated, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Delivery
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await deliveryService.submit(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve Delivery
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await deliveryService.approve(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reject Delivery
  router.post(
    '/:id/reject',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.reject'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await deliveryService.reject(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post Delivery (Stock Deductions)
  router.post(
    '/:id/post',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await deliveryService.post(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reverse Delivery
  router.post(
    '/:id/reverse',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.reverse'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await deliveryService.reverse(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cancel Delivery
  router.post(
    '/:id/cancel',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.cancel'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await deliveryService.cancel(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Delete Draft Delivery
  router.delete(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.delivery.delete'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const success = await deliveryService.delete(req.params.id, req.securityContext!);
        res.json({ success });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
