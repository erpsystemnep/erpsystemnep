import { Router, Request, Response, NextFunction } from 'express';
import { InventoryValuationService } from '../services/inventory_valuation.service.js';
import {
  costLayerFilterSchema,
  valuationTxFilterSchema,
  cogsReportFilterSchema,
} from '../../../../shared/schemas/inventory.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createValuationRouter(
  valuationService: InventoryValuationService = new InventoryValuationService()
): Router {
  const router = Router();

  // 1. Inventory Valuation Report (FIFO Subledger valuation by Item / Warehouse)
  router.get(
    '/report',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.stock.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const validated = costLayerFilterSchema.parse({
          ...req.query,
          companyId,
        });
        const report = await valuationService.getValuationReport(companyId, validated);
        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // 2. Active & Historical Cost Layers
  router.get(
    '/cost-layers',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.stock.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const validated = costLayerFilterSchema.parse({
          ...req.query,
          companyId,
        });
        const result = await valuationService.getCostLayers(companyId, validated);
        res.json({
          success: true,
          data: result.data,
          meta: {
            total: result.total,
            page: validated.page,
            limit: validated.limit,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // 3. Inventory Valuation Transactions (Inward & Outward Movements)
  router.get(
    '/transactions',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.stock.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const validated = valuationTxFilterSchema.parse({
          ...req.query,
          companyId,
        });
        const result = await valuationService.getTransactions(companyId, validated);
        res.json({
          success: true,
          data: result.data,
          meta: {
            total: result.total,
            page: validated.page,
            limit: validated.limit,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // 4. Cost of Goods Sold (COGS) Report
  router.get(
    '/cogs-report',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.stock.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const validated = cogsReportFilterSchema.parse({
          ...req.query,
          companyId,
        });
        const report = await valuationService.getCogsReport(companyId, validated);
        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // 5. Inventory Subledger to General Ledger (Account 1400) Reconciliation
  router.get(
    '/gl-reconciliation',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.stock.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const asOfDate = req.query.asOfDate ? String(req.query.asOfDate) : undefined;
        const reconciliation = await valuationService.getInventoryGlReconciliation(companyId, asOfDate);
        res.json({ success: true, data: reconciliation });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
