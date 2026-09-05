import { Router, Request, Response, NextFunction } from 'express';
import { ChartOfAccountsService } from '../services/chart_of_accounts.service.js';
import { requirePermission } from '../../../middleware/auth.js';
import { SecurityContext } from '../../../../shared/types/index.js';

export function createChartOfAccountsRouter(): Router {
  const router = Router();
  const coaService = new ChartOfAccountsService();

  // List Accounts
  router.get(
    '/',
    requirePermission('accounting.account.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const companyId = (req.query.companyId as string) || ctx.activeCompanyId;
        const filters = {
          accountType: req.query.accountType as any,
          isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
          isGroup: req.query.isGroup !== undefined ? req.query.isGroup === 'true' : undefined,
          search: req.query.search as string,
        };

        const accounts = await coaService.listAccounts(companyId!, ctx, filters);
        res.json({ success: true, data: accounts });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Account by ID
  router.get(
    '/:id',
    requirePermission('accounting.account.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const account = await coaService.getAccountById(req.params.id, ctx);
        res.json({ success: true, data: account });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Account
  router.post(
    '/',
    requirePermission('accounting.account.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const account = await coaService.createAccount(req.body, ctx);
        res.status(201).json({ success: true, data: account });
      } catch (err) {
        next(err);
      }
    }
  );

  // Update Account
  router.put(
    '/:id',
    requirePermission('accounting.account.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const account = await coaService.updateAccount(req.params.id, req.body, ctx);
        res.json({ success: true, data: account });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
