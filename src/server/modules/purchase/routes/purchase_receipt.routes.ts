import { Router, Request, Response, NextFunction } from 'express';
import { PurchaseReceiptService } from '../services/purchase_receipt.service.js';
import { createPurchaseReceiptSchema } from '../../../../shared/schemas/purchase.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createPurchaseReceiptRouter(
  receiptService: PurchaseReceiptService = new PurchaseReceiptService()
): Router {
  const router = Router();

  // List Receipts
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.receipt.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { branchId, supplierId, status, purchaseOrderId } = req.query;
        const data = await receiptService.list(
          {
            branchId: branchId ? String(branchId) : undefined,
            supplierId: supplierId ? String(supplierId) : undefined,
            status: status ? String(status) : undefined,
            purchaseOrderId: purchaseOrderId ? String(purchaseOrderId) : undefined,
          },
          req.securityContext!
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Receipt by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.receipt.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await receiptService.findById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Receipt
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.receipt.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = createPurchaseReceiptSchema.parse({
          ...req.body,
          companyId: req.securityContext!.activeCompanyId,
        });
        const data = await receiptService.create(validated, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Receipt
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.receipt.submit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await receiptService.submit(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve Receipt
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.receipt.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await receiptService.approve(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post Receipt (Updates Stock Ledger)
  router.post(
    '/:id/post',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.receipt.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await receiptService.post(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reverse Receipt (Posts Reversing Stock Movements)
  router.post(
    '/:id/reverse',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.receipt.reverse'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { reason } = req.body;
        const data = await receiptService.reverse(req.params.id, reason, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
