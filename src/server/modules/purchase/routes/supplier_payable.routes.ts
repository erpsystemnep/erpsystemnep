import { Router, Request, Response, NextFunction } from 'express';
import { SupplierPayableRepository } from '../repositories/supplier_payable.repository.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export function createSupplierPayableRouter(
  payableRepo: SupplierPayableRepository = new SupplierPayableRepository()
): Router {
  const router = Router();

  // List Supplier Payables
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payable.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const { supplierId, status, startDate, endDate } = req.query;
        const data = await payableRepo.list(
          companyId,
          {
            supplierId: supplierId ? String(supplierId) : undefined,
            status: status ? (String(status) as any) : undefined,
            startDate: startDate ? String(startDate) : undefined,
            endDate: endDate ? String(endDate) : undefined,
          }
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Open Payables by Supplier
  router.get(
    '/supplier/:supplierId/open',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payable.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const data = await payableRepo.findOpenBySupplierId(
          req.params.supplierId,
          companyId
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Payable by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('purchase.payable.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const data = await payableRepo.findById(
          req.params.id,
          companyId
        );
        if (!data) {
          throw AppError.notFound(`Supplier payable '${req.params.id}' not found`);
        }
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
