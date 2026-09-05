import { Router, Request, Response, NextFunction } from 'express';
import { CustomerPaymentService } from '../services/customer_payment.service.js';
import { requirePermission } from '../../../middleware/auth.js';
import { SecurityContext } from '../../../../shared/types/index.js';

export function createCustomerPaymentRouter(): Router {
  const router = Router();
  const paymentService = new CustomerPaymentService();

  // List Payments
  router.get(
    '/',
    requirePermission('sales.payment.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const companyId = (req.query.companyId as string) || ctx.activeCompanyId;
        const filters = {
          customerId: req.query.customerId as string,
          status: req.query.status as any,
          fromDate: req.query.fromDate as string,
          toDate: req.query.toDate as string,
          search: req.query.search as string,
        };

        const payments = await paymentService.listPayments(companyId!, ctx, filters);
        res.json({ success: true, data: payments });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Payment by ID
  router.get(
    '/:id',
    requirePermission('sales.payment.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const payment = await paymentService.getPaymentById(req.params.id, ctx);
        res.json({ success: true, data: payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Draft Payment
  router.post(
    '/',
    requirePermission('sales.payment.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const payment = await paymentService.createPayment(req.body, ctx);
        res.status(201).json({ success: true, data: payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Payment
  router.post(
    '/:id/submit',
    requirePermission('sales.payment.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const payment = await paymentService.submitPayment(req.params.id, ctx);
        res.json({ success: true, data: payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve Payment
  router.post(
    '/:id/approve',
    requirePermission('sales.payment.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const payment = await paymentService.approvePayment(req.params.id, ctx);
        res.json({ success: true, data: payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post Payment (Settles Receivables & Generates GL Journal)
  router.post(
    '/:id/post',
    requirePermission('sales.payment.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const payment = await paymentService.postPayment(req.params.id, ctx);
        res.json({ success: true, data: payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reverse Payment
  router.post(
    '/:id/reverse',
    requirePermission('sales.payment.reverse'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const payment = await paymentService.reversePayment(req.params.id, ctx);
        res.json({ success: true, data: payment });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cancel Payment
  router.post(
    '/:id/cancel',
    requirePermission('sales.payment.cancel'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const payment = await paymentService.cancelPayment(req.params.id, ctx);
        res.json({ success: true, data: payment });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
