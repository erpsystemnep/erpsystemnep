import { Router, Request, Response, NextFunction } from 'express';
import { UomService } from '../services/uom.service.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createUomRouter(
  uomService: UomService = new UomService()
): Router {
  const router = Router();

  // List UOMs
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.uom.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await uomService.listUoms(req.query, req.securityContext!);
        res.json({
          success: true,
          data: result.items,
          meta: {
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get UOM by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.uom.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uom = await uomService.getUom(req.params.id, req.securityContext!);
        res.json({ success: true, data: uom });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create UOM
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.uom.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uom = await uomService.createUom(req.body, req.securityContext!);
        res.status(201).json({ success: true, data: uom });
      } catch (err) {
        next(err);
      }
    }
  );

  // Update UOM
  router.patch(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.uom.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uom = await uomService.updateUom(
          req.params.id,
          req.body,
          req.securityContext!
        );
        res.json({ success: true, data: uom });
      } catch (err) {
        next(err);
      }
    }
  );

  // Delete / deactivate UOM
  router.delete(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.uom.delete'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uom = await uomService.deleteUom(req.params.id, req.securityContext!);
        res.json({ success: true, data: uom, message: 'Unit of measure deactivated successfully' });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
