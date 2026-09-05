import { Router, Request, Response, NextFunction } from 'express';
import { AccountingJournalService } from '../services/accounting_journal.service.js';
import { requirePermission } from '../../../middleware/auth.js';
import { SecurityContext } from '../../../../shared/types/index.js';

export function createAccountingJournalRouter(): Router {
  const router = Router();
  const journalService = new AccountingJournalService();

  // List Journals
  router.get(
    '/',
    requirePermission('accounting.journal.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const companyId = (req.query.companyId as string) || ctx.activeCompanyId;
        const filters = {
          status: req.query.status as any,
          sourceDocumentType: req.query.sourceDocumentType as string,
          fromDate: req.query.fromDate as string,
          toDate: req.query.toDate as string,
          search: req.query.search as string,
        };

        const journals = await journalService.listJournals(companyId!, ctx, filters);
        res.json({ success: true, data: journals });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Journal by ID
  router.get(
    '/:id',
    requirePermission('accounting.journal.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const journal = await journalService.getJournalById(req.params.id, ctx);
        res.json({ success: true, data: journal });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Manual Journal
  router.post(
    '/',
    requirePermission('accounting.journal.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const journal = await journalService.createJournal(req.body, ctx);
        res.status(201).json({ success: true, data: journal });
      } catch (err) {
        next(err);
      }
    }
  );

  // Submit Journal
  router.post(
    '/:id/submit',
    requirePermission('accounting.journal.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const journal = await journalService.submitJournal(req.params.id, ctx);
        res.json({ success: true, data: journal });
      } catch (err) {
        next(err);
      }
    }
  );

  // Approve Journal
  router.post(
    '/:id/approve',
    requirePermission('accounting.journal.approve'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const journal = await journalService.approveJournal(req.params.id, ctx);
        res.json({ success: true, data: journal });
      } catch (err) {
        next(err);
      }
    }
  );

  // Post Journal
  router.post(
    '/:id/post',
    requirePermission('accounting.journal.post'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const journal = await journalService.postJournal(req.params.id, ctx);
        res.json({ success: true, data: journal });
      } catch (err) {
        next(err);
      }
    }
  );

  // Reverse Journal
  router.post(
    '/:id/reverse',
    requirePermission('accounting.journal.reverse'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const result = await journalService.reverseJournal(req.params.id, ctx);
        res.json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
