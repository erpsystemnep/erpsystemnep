import { Router, Request, Response, NextFunction } from 'express';
import { AccountingPeriodService } from '../services/accounting_period.service.js';
import { requirePermission } from '../../../middleware/auth.js';
import { SecurityContext } from '../../../../shared/types/index.js';

export function createAccountingPeriodRouter(): Router {
  const router = Router();
  const periodService = new AccountingPeriodService();

  // Create Fiscal Year
  router.post(
    '/fiscal-years',
    requirePermission('accounting.period.manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const fy = await periodService.createFiscalYear(req.body, ctx);
        res.status(201).json({ success: true, data: fy });
      } catch (err) {
        next(err);
      }
    }
  );

  // List Fiscal Years
  router.get(
    '/fiscal-years',
    requirePermission('accounting.period.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const companyId = (req.query.companyId as string) || ctx.activeCompanyId;
        if (!companyId) {
          return res.status(400).json({ success: false, error: 'Company ID is required' });
        }
        const fys = await periodService.listFiscalYears(companyId, ctx);
        res.json({ success: true, data: fys });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Fiscal Year by ID
  router.get(
    '/fiscal-years/:id',
    requirePermission('accounting.period.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const fy = await periodService.getFiscalYearById(req.params.id, ctx);
        res.json({ success: true, data: fy });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Accounting Period
  router.post(
    '/periods',
    requirePermission('accounting.period.manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const period = await periodService.createPeriod(req.body, ctx);
        res.status(201).json({ success: true, data: period });
      } catch (err) {
        next(err);
      }
    }
  );

  // Generate 12 Monthly Periods
  router.post(
    '/periods/generate',
    requirePermission('accounting.period.manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const periods = await periodService.generateMonthlyPeriods(req.body, ctx);
        res.status(201).json({ success: true, data: periods });
      } catch (err) {
        next(err);
      }
    }
  );

  // List Accounting Periods
  router.get(
    '/periods',
    requirePermission('accounting.period.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const companyId = (req.query.companyId as string) || ctx.activeCompanyId;
        if (!companyId) {
          return res.status(400).json({ success: false, error: 'Company ID is required' });
        }
        const periods = await periodService.listPeriods(companyId, ctx, {
          fiscalYearId: req.query.fiscalYearId as string,
          status: req.query.status as any,
        });
        res.json({ success: true, data: periods });
      } catch (err) {
        next(err);
      }
    }
  );

  // Close Accounting Period
  router.post(
    '/periods/:id/close',
    requirePermission('accounting.period.close'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const closed = await periodService.closePeriod(req.params.id, req.body, ctx);
        res.json({ success: true, data: closed });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reopen Accounting Period
  router.post(
    '/periods/:id/reopen',
    requirePermission('accounting.period.reopen'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const reopened = await periodService.reopenPeriod(req.params.id, req.body, ctx);
        res.json({ success: true, data: reopened });
      } catch (err) {
        next(err);
      }
    }
  );

  // Year-End Closing
  router.post(
    '/year-end-closing',
    requirePermission('accounting.period.close'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const result = await periodService.performYearEndClosing(req.body, ctx);
        res.json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
