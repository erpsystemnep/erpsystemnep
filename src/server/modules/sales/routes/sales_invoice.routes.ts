import { Router, Request, Response, NextFunction } from 'express';
import { SalesInvoiceService } from '../services/sales_invoice.service.js';
import { CustomerReceivableService } from '../services/customer_receivable.service.js';
import { createSalesInvoiceSchema } from '../../../../shared/schemas/sales_invoice.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createSalesInvoiceRouter(
  invoiceService: SalesInvoiceService = new SalesInvoiceService(),
  receivableService: CustomerReceivableService = new CustomerReceivableService()
): Router {
  const router = Router();

  // 1. List Invoices
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { customerId, salesOrderId, deliveryId, status, startDate, endDate, limit, offset } = req.query;
        const result = await invoiceService.list(
          {
            customerId: customerId ? String(customerId) : undefined,
            salesOrderId: salesOrderId ? String(salesOrderId) : undefined,
            deliveryId: deliveryId ? String(deliveryId) : undefined,
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

  // 2. List Customer Receivables
  router.get(
    '/receivables',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.view'),
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

  // 3. Get Invoice by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await invoiceService.getById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 4. Create Draft Invoice
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = createSalesInvoiceSchema.parse(req.body);
        const data = await invoiceService.create(parsed, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 5. Submit Invoice
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await invoiceService.submit(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 6. Approve Invoice
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await invoiceService.approve(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 7. Reject Invoice
  router.post(
    '/:id/reject',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.reject'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { reason } = req.body;
        const data = await invoiceService.reject(
          req.params.id,
          reason || 'Rejected by approver',
          req.securityContext!
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 8. Post Invoice
  router.post(
    '/:id/post',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await invoiceService.post(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 9. Reverse Invoice
  router.post(
    '/:id/reverse',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.reverse'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { reason } = req.body;
        const data = await invoiceService.reverse(
          req.params.id,
          reason || 'Reversed by authorized personnel',
          req.securityContext!
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 10. Cancel Invoice
  router.post(
    '/:id/cancel',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.cancel'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { reason } = req.body;
        const data = await invoiceService.cancel(
          req.params.id,
          reason || 'Cancelled',
          req.securityContext!
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // 11. Delete Draft Invoice
  router.delete(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.invoice.delete'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await invoiceService.delete(req.params.id, req.securityContext!);
        res.json({ success: true, message: 'Draft invoice successfully deleted' });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
