import { Router, Request, Response, NextFunction } from 'express';
import { PurchaseReturnService } from '../services/purchase_return.service.js';
import { createPurchaseReturnSchema } from '../../../../shared/schemas/purchase.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createPurchaseReturnRouter(
  returnService: PurchaseReturnService = new PurchaseReturnService()
): Router {
  const router = Router();

  // List Returns
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.return.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { supplierId, status, receiptId, branchId } = req.query;
        const data = await returnService.list(
          {
            branchId: branchId ? String(branchId) : undefined,
            supplierId: supplierId ? String(supplierId) : undefined,
            status: status ? String(status) : undefined,
            receiptId: receiptId ? String(receiptId) : undefined,
          },
          req.securityContext!
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Return by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.return.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await returnService.findById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Return
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.return.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = createPurchaseReturnSchema.parse({
          ...req.body,
          companyId: req.securityContext!.activeCompanyId,
        });
        const data = await returnService.create(validated, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Return
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.return.submit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await returnService.submit(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve Return
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.return.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await returnService.approve(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post Return (Deducts stock from stock ledger)
  router.post(
    '/:id/post',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.return.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await returnService.post(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reverse Return (Restores stock)
  router.post(
    '/:id/reverse',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.return.reverse'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { reason } = req.body;
        const data = await returnService.reverse(req.params.id, reason, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
