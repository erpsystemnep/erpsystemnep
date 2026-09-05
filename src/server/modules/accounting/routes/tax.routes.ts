import { Router, Request, Response, NextFunction } from 'express';
import { TaxService } from '../services/tax.service.js';
import { requirePermission } from '../../../middleware/auth.js';
import { SecurityContext } from '../../../../shared/types/index.js';

export function createTaxRouter(): Router {
  const router = Router();
  const taxService = new TaxService();

  // List Tax Subledger Transactions
  router.get(
    '/transactions',
    requirePermission('accounting.journal.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filters = {
          taxType: req.query.taxType as any,
          sourceType: req.query.sourceType as any,
          sourceId: req.query.sourceId as string,
          status: req.query.status as any,
          taxCode: req.query.taxCode as string,
          fromDate: req.query.fromDate as string,
          toDate: req.query.toDate as string,
          limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
          offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
        };

        const result = await taxService.listTransactions(filters, ctx);
        res.json({ success: true, data: result.items, total: result.total });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Tax Summary Report
  router.get(
    '/summary',
    requirePermission('accounting.journal.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filters = {
          fromDate: req.query.fromDate as string,
          toDate: req.query.toDate as string,
        };

        const report = await taxService.getSummary(filters, ctx);
        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Tax Reconciliation Report (Subledger vs General Ledger)
  router.get(
    '/reconciliation',
    requirePermission('accounting.journal.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const asOfDate = req.query.asOfDate as string;

        const report = await taxService.getReconciliation(asOfDate, ctx);
        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
