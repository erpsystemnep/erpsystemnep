import { Router, Request, Response, NextFunction } from 'express';
import { PartnerService } from '../services/partner.service.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createPartnerRouter(
  partnerService: PartnerService = new PartnerService()
): Router {
  const router = Router();

  // List partners
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.partner.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await partnerService.listPartners(req.query, req.securityContext!);
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

  // Get partner by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.partner.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const partner = await partnerService.getPartner(req.params.id, req.securityContext!);
        res.json({ success: true, data: partner });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create partner
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.partner.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const partner = await partnerService.createPartner(req.body, req.securityContext!);
        res.status(201).json({ success: true, data: partner });
      } catch (err) {
        next(err);
      }
    }
  );

  // Update partner
  router.patch(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.partner.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const partner = await partnerService.updatePartner(
          req.params.id,
          req.body,
          req.securityContext!
        );
        res.json({ success: true, data: partner });
      } catch (err) {
        next(err);
      }
    }
  );

  // Delete / deactivate partner
  router.delete(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.partner.delete'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const partner = await partnerService.deletePartner(req.params.id, req.securityContext!);
        res.json({ success: true, data: partner, message: 'Business partner deactivated successfully' });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
