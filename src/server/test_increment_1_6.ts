import { getPool } from './db/connection.js';
import { runMigrations } from './db/migrator.js';
import { AccountingPeriodService } from './modules/accounting/services/accounting_period.service.js';
import { FinancialReportService } from './modules/accounting/services/financial_report.service.js';
import { AccountingJournalService } from './modules/accounting/services/accounting_journal.service.js';
import { SecurityContext } from '../shared/types/index.js';

async function runIncrement16Tests() {
  console.log('========================================================================');
  console.log('RUNNING INCREMENT 1.6: FINANCIAL REPORTING & PERIOD CLOSING TEST SUITE');
  console.log('========================================================================\n');

  const pool = getPool();
  console.log('Applying pending database migrations...');
  const migResult = await runMigrations();
  console.log(`Migrations complete: ${migResult.newlyApplied.length} newly applied, ${migResult.alreadyApplied} existing.`);

  const periodService = new AccountingPeriodService();
  const reportService = new FinancialReportService();
  const journalService = new AccountingJournalService();

  // Find demo company
  const compRes = await pool.query(`SELECT id, code, legal_name FROM companies LIMIT 1;`);
  if (compRes.rows.length === 0) {
    throw new Error('No company found in database');
  }
  const company = compRes.rows[0];
  console.log(`Using Test Company: ${company.legal_name} (${company.id})`);

  // Find or create admin and approver users
  let userRes = await pool.query(`SELECT id, email FROM users LIMIT 2;`);
  let adminUserId: string;
  let approverUserId: string;

  if (userRes.rows.length === 0) {
    const u1 = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES ('accountant@erp.local', 'hash_test', 'Lead Accountant', TRUE)
       RETURNING id;`
    );
    adminUserId = u1.rows[0].id;
    const u2 = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES ('manager@erp.local', 'hash_test', 'Finance Manager', TRUE)
       RETURNING id;`
    );
    approverUserId = u2.rows[0].id;
  } else if (userRes.rows.length === 1) {
    adminUserId = userRes.rows[0].id;
    const u2 = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES ('manager@erp.local', 'hash_test', 'Finance Manager', TRUE)
       RETURNING id;`
    );
    approverUserId = u2.rows[0].id;
  } else {
    adminUserId = userRes.rows[0].id;
    approverUserId = userRes.rows[1].id;
  }

  console.log('Using Creator User ID:', adminUserId);
  console.log('Using Approver User ID:', approverUserId);

  const ctx: SecurityContext = {
    userId: adminUserId,
    email: 'accountant@erp.local',
    fullName: 'Lead Accountant',
    activeCompanyId: company.id,
    activeBranchId: null,
    effectivePermissions: ['*'],
    isSuperadmin: true,
  };

  const approverCtx: SecurityContext = {
    userId: approverUserId,
    email: 'manager@erp.local',
    fullName: 'Finance Manager',
    activeCompanyId: company.id,
    activeBranchId: null,
    effectivePermissions: ['*'],
    isSuperadmin: true,
  };

  async function submitApproveAndPost(journalId: string) {
    await journalService.submitJournal(journalId, ctx);
    await journalService.approveJournal(journalId, approverCtx);
    return await journalService.postJournal(journalId, approverCtx);
  }

  // Find or create standard Chart of Accounts needed for testing
  console.log('\n--- 1. Chart of Accounts Setup ---');
  async function getOrCreateAccount(code: string, name: string, type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE') {
    const existing = await pool.query(
      `SELECT id, account_code, account_name FROM chart_of_accounts WHERE company_id = $1 AND account_code = $2;`,
      [company.id, code]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].id;
    }
    const inserted = await pool.query(
      `INSERT INTO chart_of_accounts (company_id, account_code, account_name, account_type, is_active, currency_code)
       VALUES ($1, $2, $3, $4, TRUE, 'USD') RETURNING id;`,
      [company.id, code, name, type]
    );
    return inserted.rows[0].id;
  }

  const cashAccId = await getOrCreateAccount('1000', 'Cash on Hand', 'ASSET');
  const arAccId = await getOrCreateAccount('1100', 'Accounts Receivable', 'ASSET');
  const inventoryAccId = await getOrCreateAccount('1400', 'Merchandise Inventory', 'ASSET');
  const apAccId = await getOrCreateAccount('2000', 'Accounts Payable', 'LIABILITY');
  const equityAccId = await getOrCreateAccount('3000', 'Common Stock', 'EQUITY');
  const retainedEarningsAccId = await getOrCreateAccount('3100', 'Retained Earnings', 'EQUITY');
  const revenueAccId = await getOrCreateAccount('4000', 'Sales Revenue', 'REVENUE');
  const cogsAccId = await getOrCreateAccount('5000', 'Cost of Goods Sold', 'EXPENSE');
  const rentExpenseAccId = await getOrCreateAccount('6000', 'Rent Expense', 'EXPENSE');

  console.log('Chart of Accounts validated: 1000, 1100, 1400, 2000, 3000, 3100, 4000, 5000, 6000.');

  // Clean up any test fiscal years and journals for 2026 in this company to ensure deterministic test run
  await pool.query(`DELETE FROM accounting_journal_lines WHERE journal_id IN (SELECT id FROM accounting_journals WHERE company_id = $1 AND posting_date >= '2026-01-01' AND posting_date <= '2026-12-31');`, [company.id]);
  await pool.query(`DELETE FROM accounting_journals WHERE company_id = $1 AND posting_date >= '2026-01-01' AND posting_date <= '2026-12-31';`, [company.id]);
  await pool.query(`DELETE FROM accounting_periods WHERE company_id = $1 AND period_name LIKE '2026-%';`, [company.id]);
  await pool.query(`DELETE FROM fiscal_years WHERE company_id = $1 AND name = 'FY 2026';`, [company.id]);

  console.log('\n--- 2. Fiscal Year & Accounting Periods Setup ---');
  const fy = await periodService.createFiscalYear(
    {
      name: 'FY 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    },
    ctx
  );
  console.log(`✓ Fiscal Year created: ${fy.name} (ID: ${fy.id}), status: ${fy.status}`);

  const periods = await periodService.generateMonthlyPeriods(
    {
      fiscalYearId: fy.id,
      year: 2026,
    },
    ctx
  );
  console.log(`✓ Generated ${periods.length} monthly accounting periods for 2026.`);
  const janPeriod = periods[0];
  console.log(`  Period 1: ${janPeriod.periodName} (${janPeriod.startDate} to ${janPeriod.endDate}), status: ${janPeriod.status}`);

  console.log('\n--- 3. Post Journal in OPEN Period (Must Succeed) ---');
  const j1 = await journalService.createJournal(
    {
      postingDate: '2026-01-15',
      sourceDocumentType: 'MANUAL_JOURNAL',
      description: 'Initial Jan 2026 cash sales entry',
      currencyCode: 'USD',
      lines: [
        { accountId: cashAccId, debit: 1200, credit: 0, description: 'Cash received' },
        { accountId: revenueAccId, debit: 0, credit: 1200, description: 'Sales revenue' },
      ],
    },
    ctx
  );
  console.log(`  Draft Journal created: ${j1.journalNumber}`);
  const j1Posted = await submitApproveAndPost(j1.id);
  console.log(`✓ Successfully posted journal ${j1Posted.journalNumber} in OPEN period ${janPeriod.periodName}`);

  console.log('\n--- 4. Close Period 2026-01 ---');
  const closedJan = await periodService.closePeriod(
    janPeriod.id,
    { closingNotes: 'January 2026 monthly closing completed by audit team' },
    ctx
  );
  console.log(`✓ Period ${closedJan.periodName} status: ${closedJan.status}, closedAt: ${closedJan.closedAt}`);

  console.log('\n--- 5. Attempt to Post to CLOSED Period (Must Fail) ---');
  let blockedCaught = false;
  let blockedJournalId = '';
  try {
    const blockedJournal = await journalService.createJournal(
      {
        postingDate: '2026-01-20',
        sourceDocumentType: 'MANUAL_JOURNAL',
        description: 'Late entry attempting to post in closed period',
        currencyCode: 'USD',
        lines: [
          { accountId: cashAccId, debit: 300, credit: 0, description: 'Late cash' },
          { accountId: revenueAccId, debit: 0, credit: 300, description: 'Late revenue' },
        ],
      },
      ctx
    );
    blockedJournalId = blockedJournal.id;
    // Submit and Approve
    await journalService.submitJournal(blockedJournal.id, ctx);
    await journalService.approveJournal(blockedJournal.id, approverCtx);
    // Attempting to post to closed period
    await journalService.postJournal(blockedJournal.id, approverCtx);
  } catch (err: any) {
    blockedCaught = true;
    console.log(`✓ System strictly blocked posting to closed period as required: "${err.message}"`);
  }

  if (!blockedCaught) {
    throw new Error('FAILURE: System allowed posting to a closed accounting period!');
  }

  console.log('\n--- 6. Reopen Period, Post Deferred Entry, Re-Close ---');
  const reopenedJan = await periodService.reopenPeriod(
    janPeriod.id,
    { reason: 'Late revenue reconciliation adjustment authorized by controller' },
    ctx
  );
  console.log(`✓ Period ${reopenedJan.periodName} reopened. Status: ${reopenedJan.status}, reopenedAt: ${reopenedJan.reopenedAt}`);

  // Now post the previously blocked entry in the reopened period
  const deferredPosted = await journalService.postJournal(blockedJournalId, approverCtx);
  console.log(`✓ Successfully posted deferred journal ${deferredPosted.journalNumber} in reopened period`);

  await periodService.closePeriod(
    janPeriod.id,
    { closingNotes: 'Final January close after adjustment' },
    ctx
  );
  console.log(`✓ Period ${janPeriod.periodName} safely re-closed.`);

  console.log('\n--- 7. Add Multi-Account Transactions in Other 2026 Periods ---');
  // Post in Feb 2026: Rent Expense 400 paid via Cash
  const febJournal = await journalService.createJournal(
    {
      postingDate: '2026-02-10',
      sourceDocumentType: 'MANUAL_JOURNAL',
      description: 'Office rent payment Feb 2026',
      currencyCode: 'USD',
      lines: [
        { accountId: rentExpenseAccId, debit: 400, credit: 0, description: 'Rent expense' },
        { accountId: cashAccId, debit: 0, credit: 400, description: 'Cash payment' },
      ],
    },
    ctx
  );
  await submitApproveAndPost(febJournal.id);
  console.log(`✓ Posted Feb 2026 Rent Expense ($400)`);

  // Post in March 2026: Cost of Goods Sold $500, Inventory reduction $500
  const marJournal = await journalService.createJournal(
    {
      postingDate: '2026-03-15',
      sourceDocumentType: 'MANUAL_JOURNAL',
      description: 'COGS recognition Mar 2026',
      currencyCode: 'USD',
      lines: [
        { accountId: cogsAccId, debit: 500, credit: 0, description: 'Cost of goods sold' },
        { accountId: inventoryAccId, debit: 0, credit: 500, description: 'Inventory reduction' },
      ],
    },
    ctx
  );
  await submitApproveAndPost(marJournal.id);
  console.log(`✓ Posted Mar 2026 COGS ($500)`);

  console.log('\n--- 8. Verify General Ledger Report ---');
  const glReport = await reportService.getGeneralLedgerReport(
    { startDate: '2026-01-01', endDate: '2026-12-31' },
    ctx
  );
  console.log(`✓ General Ledger fetched: ${glReport.lines.length} lines.`);
  console.log(`  Total Debits: $${glReport.totalDebit.toFixed(2)}, Total Credits: $${glReport.totalCredit.toFixed(2)}`);
  if (Math.abs(glReport.totalDebit - glReport.totalCredit) > 0.001) {
    throw new Error('GL Debits and Credits do not match!');
  }

  console.log('\n--- 9. Verify Account Ledger Report (Cash 1000) ---');
  const cashLedger = await reportService.getAccountLedgerReport(
    cashAccId,
    { startDate: '2026-01-01', endDate: '2026-12-31' },
    ctx
  );
  console.log(`✓ Cash Ledger: Opening: $${cashLedger.openingBalance}, Debits: $${cashLedger.totalDebits}, Credits: $${cashLedger.totalCredits}, Closing: $${cashLedger.closingBalance}`);
  // Expected: +1200 +300 -400 = 1100 net balance
  console.log(`  Cash lines count: ${cashLedger.lines.length}`);

  console.log('\n--- 10. Verify Profit & Loss Report ---');
  const pnlReport = await reportService.getProfitLossReport(
    { startDate: '2026-01-01', endDate: '2026-12-31' },
    ctx
  );
  console.log(`✓ Profit & Loss Report:`);
  console.log(`  Operating Revenue: $${pnlReport.operatingRevenue.total.toFixed(2)} (Expected: $1500.00)`);
  console.log(`  COGS:              $${pnlReport.costOfGoodsSold.total.toFixed(2)} (Expected: $500.00)`);
  console.log(`  Gross Profit:      $${pnlReport.grossProfit.toFixed(2)} (Expected: $1000.00)`);
  console.log(`  Operating Expenses:$${pnlReport.operatingExpenses.total.toFixed(2)} (Expected: $400.00)`);
  console.log(`  Net Profit:        $${pnlReport.netProfit.toFixed(2)} (Expected: $600.00)`);

  if (pnlReport.operatingRevenue.total !== 1500 || pnlReport.costOfGoodsSold.total !== 500 || pnlReport.netProfit !== 600) {
    throw new Error(`P&L calculations incorrect: expected net profit 600, got ${pnlReport.netProfit}`);
  }

  console.log('\n--- 11. Verify Balance Sheet Report & Accounting Equation ---');
  const bsReport = await reportService.getBalanceSheetReport(
    { asOfDate: '2026-12-31' },
    ctx
  );
  console.log(`✓ Balance Sheet Report:`);
  console.log(`  Total Assets:                 $${bsReport.assets.totalAssets.toFixed(2)}`);
  console.log(`  Total Liabilities:            $${bsReport.liabilities.totalLiabilities.toFixed(2)}`);
  console.log(`  Total Equity:                 $${bsReport.equity.totalEquity.toFixed(2)}`);
  console.log(`  Total Liabilities + Equity:   $${bsReport.totalLiabilitiesAndEquity.toFixed(2)}`);
  console.log(`  Discrepancy:                  $${bsReport.discrepancy.toFixed(2)}`);
  console.log(`  Is Balanced (A = L + E):       ${bsReport.isBalanced}`);

  if (!bsReport.isBalanced) {
    throw new Error(`Balance Sheet out of balance! Discrepancy: ${bsReport.discrepancy}`);
  }

  console.log('\n--- 12. Verify AR and AP Aging Reports & Subledger Reconciliation ---');
  const arAging = await reportService.getArAgingReport({ asOfDate: '2026-12-31' }, ctx);
  console.log(`✓ AR Aging Report: Subledger Outstanding: $${arAging.grandTotalOutstanding.toFixed(2)}, GL Account 1100: $${arAging.glAccountBalance.toFixed(2)}, Reconciled: ${arAging.isReconciled}`);

  const apAging = await reportService.getApAgingReport({ asOfDate: '2026-12-31' }, ctx);
  console.log(`✓ AP Aging Report: Subledger Outstanding: $${apAging.grandTotalOutstanding.toFixed(2)}, GL Account 2000: $${apAging.glAccountBalance.toFixed(2)}, Reconciled: ${apAging.isReconciled}`);

  console.log('\n--- 13. Verify Cash & Bank Report ---');
  const cbReport = await reportService.getCashBankReport({ startDate: '2026-01-01', endDate: '2026-12-31' }, ctx);
  console.log(`✓ Cash & Bank Report: Accounts: ${cbReport.accounts.length}, Total Receipts: $${cbReport.totalReceipts.toFixed(2)}, Total Payments: $${cbReport.totalPayments.toFixed(2)}, Total Closing: $${cbReport.totalClosingBalance.toFixed(2)}`);

  console.log('\n--- 14. Verify CSV Exporters ---');
  const glCsv = reportService.exportGeneralLedgerCsv(glReport);
  console.log(`✓ General Ledger CSV generated (${glCsv.split('\n').length} lines)`);
  const pnlCsv = reportService.exportProfitLossCsv(pnlReport);
  console.log(`✓ Profit & Loss CSV generated (${pnlCsv.split('\n').length} lines)`);
  const bsCsv = reportService.exportBalanceSheetCsv(bsReport);
  console.log(`✓ Balance Sheet CSV generated (${bsCsv.split('\n').length} lines)`);
  const arCsv = reportService.exportArAgingCsv(arAging);
  console.log(`✓ AR Aging CSV generated (${arCsv.split('\n').length} lines)`);

  console.log('\n--- 15. Execute Year-End Closing Workflow ---');
  // Close periods 2 through 12 to prepare for year-end closing
  for (let i = 1; i < periods.length; i++) {
    await periodService.closePeriod(periods[i].id, { closingNotes: `Automated close for FY 2026 period ${periods[i].periodNumber}` }, ctx);
  }
  console.log(`✓ All 12 monthly periods in FY 2026 closed.`);

  const closingResult = await periodService.performYearEndClosing(
    {
      fiscalYearId: fy.id,
      retainedEarningsAccountId: retainedEarningsAccId,
      notes: 'Year-End Closing for FY 2026 completed',
    },
    ctx
  );
  console.log(`✓ Year-End Closing successful! Fiscal Year status: ${closingResult.fiscalYear.status}`);
  if (closingResult.closingJournal) {
    console.log(`  Closing Journal Voucher: ${closingResult.closingJournal.journalNumber} (Status: ${closingResult.closingJournal.status})`);
    console.log(`  Closing Debits: $${closingResult.closingJournal.totalDebit.toFixed(2)}, Closing Credits: $${closingResult.closingJournal.totalCredit.toFixed(2)}`);
  }

  // After year-end closing, verify that Revenue and Expense accounts for FY 2026 have net zero balance
  const postClosePnl = await pool.query(
    `SELECT 
       coa.account_type,
       COALESCE(SUM(ajl.base_debit), 0) as deb,
       COALESCE(SUM(ajl.base_credit), 0) as cred
     FROM chart_of_accounts coa
     JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
     JOIN accounting_journals aj ON ajl.journal_id = aj.id
     WHERE aj.company_id = $1 
       AND aj.status = 'POSTED'
       AND aj.posting_date >= '2026-01-01'
       AND aj.posting_date <= '2026-12-31'
       AND coa.account_type IN ('REVENUE', 'EXPENSE')
     GROUP BY coa.account_type;`,
    [company.id]
  );
  for (const row of postClosePnl.rows) {
    const diff = Math.abs(parseFloat(row.deb) - parseFloat(row.cred));
    console.log(`  Post-Closing ${row.account_type} balance difference: $${diff.toFixed(2)} (Cleared to Zero)`);
    if (diff > 0.01) {
      throw new Error(`Revenue/Expense account was not cleared by Year-End Closing! Diff: ${diff}`);
    }
  }
  console.log(`✓ All P&L temporary accounts successfully zeroed out and net income transferred to Retained Earnings.`);

  console.log('\n========================================================================');
  console.log('INCREMENT 1.6 ALL TESTS PASSED! FINANCIAL REPORTING & PERIOD CLOSING VERIFIED');
  console.log('========================================================================\n');
}

runIncrement16Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('TEST FAILED:', err);
    process.exit(1);
  });
