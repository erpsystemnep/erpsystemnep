import { Router, Request, Response, NextFunction } from 'express';
import { QcInspectionService } from '../services/qc.service.js';
import { createQcInspectionSchema } from '../../../../shared/schemas/inventory.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createQcRouter(
  qcService: QcInspectionService = new QcInspectionService()
): Router {
  const router = Router();

  // List QC Inspections
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.qc.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { receiptId, status } = req.query;
        const data = await qcService.list(
          {
            receiptId: receiptId ? String(receiptId) : undefined,
            status: status ? String(status) : undefined,
          },
          req.securityContext!
        );
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get QC Inspection by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.qc.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await qcService.findById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create QC Inspection
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.qc.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = createQcInspectionSchema.parse({
          ...req.body,
          companyId: req.securityContext!.activeCompanyId,
        });
        const data = await qcService.create(validated, req.securityContext!);
        res.status(201).json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit QC Inspection
  router.post(
    '/:id/submit',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.qc.submit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await qcService.submit(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve QC Inspection
  router.post(
    '/:id/approve',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.qc.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await qcService.approve(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post QC Inspection (Moves stock to AVAILABLE or QC_FAILED)
  router.post(
    '/:id/post',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.qc.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await qcService.post(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
