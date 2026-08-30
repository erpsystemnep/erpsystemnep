import { Router, Request, Response, NextFunction } from 'express';
import { NumberingService } from '../services/numbering.service.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createNumberingRouter(
  numberingService: NumberingService = new NumberingService()
): Router {
  const router = Router();

  // List numbering series for company
  router.get(
    '/series',
    requireAuth,
    requireActiveCompany,
    requirePermission('org.company.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const branchId = req.query.branchId as string | undefined;
        const documentType = req.query.documentType as string | undefined;
        const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

        const series = await numberingService.listSeries(companyId, req.securityContext!, {
          branchId,
          documentType,
          isActive,
        });

        res.json({ success: true, data: series });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get numbering series by ID
  router.get(
    '/series/:id',
    requireAuth,
    requirePermission('org.company.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const series = await numberingService.getSeriesById(req.params.id, req.securityContext!);
        res.json({ success: true, data: series });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create new numbering series
  router.post(
    '/series',
    requireAuth,
    requireActiveCompany,
    requirePermission('org.company.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const series = await numberingService.createSeries(req.body, req.securityContext!);
        res.status(201).json({ success: true, data: series });
      } catch (err) {
        next(err);
      }
    }
  );

  // Update numbering series
  router.patch(
    '/series/:id',
    requireAuth,
    requirePermission('org.company.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const updated = await numberingService.updateSeries(
          req.params.id,
          req.body,
          req.securityContext!
        );
        res.json({ success: true, data: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
