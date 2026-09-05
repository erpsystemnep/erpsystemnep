import { Router, Request, Response, NextFunction } from 'express';
import { PurchaseInvoiceService } from '../services/purchase_invoice.service.js';
import { createPurchaseInvoiceSchema, updatePurchaseInvoiceSchema } from '../../../../shared/schemas/purchase_invoice.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createPurchaseInvoiceRouter(
  invoiceService: PurchaseInvoiceService = new PurchaseInvoiceService()
): Router {
  const router = Router();

  // List Purchase Invoices
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { supplierId, status, purchaseOrderId, receiptId, startDate, endDate } = req.query;
        const data = await invoiceService.list(
          {
            supplierId: supplierId ? String(supplierId) : undefined,
            status: status ? (String(status) as any) : undefined,
            purchaseOrderId: purchaseOrderId ? String(purchaseOrderId) : undefined,
            receiptId: receiptId ? String(receiptId) : undefined,
            startDate: startDate ? String(startDate) : undefined,
            endDate: endDate ? String(endDate) : undefined,
          },
          req.securityContext!
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Invoice by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await invoiceService.getById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Purchase Invoice
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = createPurchaseInvoiceSchema.parse({
          ...req.body,
          companyId: req.securityContext!.activeCompanyId,
        });
        const data = await invoiceService.create(validated, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Delete Draft Purchase Invoice
  router.delete(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.cancel'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await invoiceService.delete(req.params.id, req.securityContext!);
        res.json({ success: true, message: 'Draft purchase invoice deleted' });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Invoice (DRAFT -> SUBMITTED)
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await invoiceService.submit(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve Invoice (SUBMITTED -> APPROVED)
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await invoiceService.approve(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reject Invoice (SUBMITTED -> REJECTED)
  router.post(
    '/:id/reject',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.reject'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const reason = req.body.reason || 'Rejected by approver';
        const data = await invoiceService.reject(req.params.id, reason, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post Invoice to AP & GL (APPROVED -> POSTED)
  router.post(
    '/:id/post',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await invoiceService.post(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reverse Posted Purchase Invoice
  router.post(
    '/:id/reverse',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.reverse'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const reason = req.body.reason || 'Reversed by finance manager';
        const data = await invoiceService.reverse(req.params.id, reason, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Cancel Purchase Invoice
  router.post(
    '/:id/cancel',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.invoice.cancel'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const reason = req.body.reason || 'Cancelled by user';
        const data = await invoiceService.cancel(req.params.id, reason, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
