import { Router, Request, Response, NextFunction } from 'express';
import { FinancialReportService } from '../services/financial_report.service.js';
import { requirePermission } from '../../../middleware/auth.js';
import { SecurityContext } from '../../../../shared/types/index.js';

export function createFinancialReportRouter(): Router {
  const router = Router();
  const reportService = new FinancialReportService();

  // 1. General Ledger Report
  router.get(
    '/general-ledger',
    requirePermission('accounting.report.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filter = {
          startDate: req.query.startDate as string,
          endDate: req.query.endDate as string,
          branchId: req.query.branchId as string,
          accountId: req.query.accountId as string,
          partnerId: req.query.partnerId as string,
        };

        const report = await reportService.getGeneralLedgerReport(filter, ctx);

        if (req.query.format === 'csv') {
          const csv = reportService.exportGeneralLedgerCsv(report);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="general-ledger-${report.startDate}-to-${report.endDate}.csv"`);
          return res.send(csv);
        }

        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // 2. Account Ledger (Subledger) Report
  router.get(
    '/accounts/:id/ledger',
    requirePermission('accounting.report.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filter = {
          startDate: req.query.startDate as string,
          endDate: req.query.endDate as string,
        };

        const report = await reportService.getAccountLedgerReport(req.params.id, filter, ctx);

        if (req.query.format === 'csv') {
          const csvLines = [
            `ACCOUNT LEDGER: ${report.accountCode} - ${report.accountName}`,
            `Period: ${report.startDate} to ${report.endDate}`,
            `Currency: ${report.currencyCode}`,
            `Opening Balance: ${report.openingBalance.toFixed(2)}`,
            '',
            'Posting Date,Journal #,Source,Description,Debit,Credit,Running Balance',
            ...report.lines.map((l) =>
              [
                l.postingDate,
                `"${l.journalNumber}"`,
                `"${l.sourceDocumentType}"`,
                `"${(l.description || '').replace(/"/g, '""')}"`,
                l.debit.toFixed(2),
                l.credit.toFixed(2),
                l.runningBalance.toFixed(2),
              ].join(',')
            ),
            '',
            `Total Debits,${report.totalDebits.toFixed(2)}`,
            `Total Credits,${report.totalCredits.toFixed(2)}`,
            `Closing Balance,${report.closingBalance.toFixed(2)}`,
          ];
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="account-ledger-${report.accountCode}.csv"`);
          return res.send(csvLines.join('\n'));
        }

        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // 3. Profit & Loss Report
  router.get(
    '/profit-loss',
    requirePermission('accounting.report.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filter = {
          startDate: req.query.startDate as string,
          endDate: req.query.endDate as string,
          branchId: req.query.branchId as string,
        };

        const report = await reportService.getProfitLossReport(filter, ctx);

        if (req.query.format === 'csv') {
          const csv = reportService.exportProfitLossCsv(report);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="profit-loss-${report.startDate}-to-${report.endDate}.csv"`);
          return res.send(csv);
        }

        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // 4. Balance Sheet Report
  router.get(
    '/balance-sheet',
    requirePermission('accounting.report.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filter = {
          asOfDate: req.query.asOfDate as string,
          branchId: req.query.branchId as string,
        };

        const report = await reportService.getBalanceSheetReport(filter, ctx);

        if (req.query.format === 'csv') {
          const csv = reportService.exportBalanceSheetCsv(report);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="balance-sheet-${report.asOfDate}.csv"`);
          return res.send(csv);
        }

        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // 5. AR Aging Report & Reconciliation
  router.get(
    '/ar-aging',
    requirePermission('accounting.report.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filter = {
          asOfDate: req.query.asOfDate as string,
        };

        const report = await reportService.getArAgingReport(filter, ctx);

        if (req.query.format === 'csv') {
          const csv = reportService.exportArAgingCsv(report);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="ar-aging-${report.asOfDate}.csv"`);
          return res.send(csv);
        }

        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // 6. AP Aging Report & Reconciliation
  router.get(
    '/ap-aging',
    requirePermission('accounting.report.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filter = {
          asOfDate: req.query.asOfDate as string,
        };

        const report = await reportService.getApAgingReport(filter, ctx);

        if (req.query.format === 'csv') {
          const csv = reportService.exportApAgingCsv(report);
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="ap-aging-${report.asOfDate}.csv"`);
          return res.send(csv);
        }

        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  // 7. Cash & Bank Report
  router.get(
    '/cash-bank',
    requirePermission('accounting.report.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = (req as any).securityContext as SecurityContext;
        const filter = {
          startDate: req.query.startDate as string,
          endDate: req.query.endDate as string,
        };

        const report = await reportService.getCashBankReport(filter, ctx);

        res.json({ success: true, data: report });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
