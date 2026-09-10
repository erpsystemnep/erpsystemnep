import { Router } from 'express';
import { createChartOfAccountsRouter } from './chart_of_accounts.routes.js';
import { createAccountingJournalRouter } from './accounting_journal.routes.js';
import { createTrialBalanceRouter } from './trial_balance.routes.js';
import { createTaxRouter } from './tax.routes.js';
import { createAccountingPeriodRouter } from './accounting_period.routes.js';
import { createFinancialReportRouter } from './financial_report.routes.js';

export function createAccountingRouter(): Router {
  const router = Router();

  router.use('/accounts', createChartOfAccountsRouter());
  router.use('/journals', createAccountingJournalRouter());
  router.use('/trial-balance', createTrialBalanceRouter());
  router.use('/tax', createTaxRouter());
  router.use('/periods', createAccountingPeriodRouter());
  router.use('/reports', createFinancialReportRouter());

  return router;
}
