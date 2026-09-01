import { Router, Request, Response, NextFunction } from 'express';
import { SalesReservationService } from '../services/sales_reservation.service.js';
import {
  createSalesReservationSchema,
  releaseSalesReservationSchema,
} from '../../../../shared/schemas/sales.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createSalesReservationRouter(
  resvService: SalesReservationService = new SalesReservationService()
): Router {
  const router = Router();

  // List Reservations
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.reservation.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { salesOrderId, itemId, warehouseId, status, page, limit } = req.query;
        const resultDirect = await resvService.list(
          {
            salesOrderId: salesOrderId ? String(salesOrderId) : undefined,
            itemId: itemId ? String(itemId) : undefined,
            warehouseId: warehouseId ? String(warehouseId) : undefined,
            status: status ? (String(status) as any) : undefined,
            page: page ? parseInt(String(page), 10) : undefined,
            limit: limit ? parseInt(String(limit), 10) : undefined,
          },
          req.securityContext!
        );
        res.json({ success: true, ...resultDirect });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Reservation by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.reservation.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await resvService.findById(req.params.id, req.securityContext!);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Reservation
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.reservation.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = createSalesReservationSchema.parse(req.body);
        const dataDirect = await resvService.create(validated, req.securityContext!);
        res.status(201).json({ success: true, data: dataDirect });
      } catch (err) {
        next(err);
      }
    }
  );

  // Release Reservation
  router.post(
    '/:id/release',
    requireAuth,
    requireActiveCompany,
    requirePermission('sales.reservation.release'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const validated = releaseSalesReservationSchema.parse(req.body || {});
        const dataDirect = await resvService.release(req.params.id, validated, req.securityContext!);
        res.json({ success: true, data: dataDirect });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
