import { Router, Request, Response, NextFunction } from 'express';
import { TrialBalanceService } from '../services/trial_balance.service.js';
import { requirePermission } from '../../../middleware/auth.js';
import { SecurityContext } from '../../../../shared/types/index.js';

export function createTrialBalanceRouter(): Router {
  const router = Router();
  const tbService = new TrialBalanceService();

  // Get Trial Balance report
  router.get(
    '/',
    requirePermission('accounting.journal.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filter = {
          asOfDate: req.query.asOfDate as string,
          startDate: req.query.startDate as string,
          branchId: req.query.branchId as string,
          accountType: req.query.accountType as any,
          includeZeroBalance: req.query.includeZeroBalance === 'true',
        };

        if (req.query.format === 'csv') {
          const csv = await tbService.exportToCsv(filter, ctx);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="trial-balance-${filter.asOfDate || 'current'}.csv"`);
          return res.send(csv);
        }

        const report = await tbService.getTrialBalance(filter, ctx);
        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
