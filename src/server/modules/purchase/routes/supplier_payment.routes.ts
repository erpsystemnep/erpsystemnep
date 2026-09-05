import { Router, Request, Response, NextFunction } from 'express';
import { SupplierPaymentService } from '../services/supplier_payment.service.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createSupplierPaymentRouter(
  paymentService: SupplierPaymentService = new SupplierPaymentService()
): Router {
  const router = Router();

  // List Payments
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { supplierId, status, fromDate, toDate, limit, offset } = req.query;
        const result = await paymentService.listPayments(
          {
            supplierId: supplierId ? String(supplierId) : undefined,
            status: status ? (String(status) as any) : undefined,
            fromDate: fromDate ? String(fromDate) : undefined,
            toDate: toDate ? String(toDate) : undefined,
          },
          limit ? Number(limit) : 50,
          offset ? Number(offset) : 0,
          req.securityContext!
        );
        res.json({ success: true, data: result.data, total: result.total });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Payment by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await paymentService.getPaymentById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Supplier Payment
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await paymentService.createPayment(req.body, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Payment (DRAFT -> SUBMITTED)
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await paymentService.submitPayment(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve Payment (SUBMITTED -> APPROVED)
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await paymentService.approvePayment(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reject Payment (SUBMITTED -> REJECTED)
  router.post(
    '/:id/reject',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.reject'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const reason = req.body.reason || 'Rejected by approver';
        const data = await paymentService.rejectPayment(req.params.id, reason, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post Payment (APPROVED -> POSTED)
  router.post(
    '/:id/post',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await paymentService.postPayment(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reverse Posted Payment
  router.post(
    '/:id/reverse',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.reverse'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await paymentService.reversePayment(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cancel Payment
  router.post(
    '/:id/cancel',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payment.cancel'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await paymentService.cancelPayment(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
