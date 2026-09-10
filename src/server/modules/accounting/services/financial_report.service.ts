import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  GeneralLedgerReport,
  GeneralLedgerLine,
  AccountLedgerReport,
  AccountLedgerLine,
  ProfitLossReport,
  BalanceSheetReport,
  ArAgingReport,
  ArAgingItem,
  ArAgingCustomerSummary,
  ApAgingReport,
  ApAgingItem,
  ApAgingSupplierSummary,
  CashBankReport,
  CashBankAccountSummary,
  SecurityContext,
  AccountType,
} from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class FinancialReportService {
  private assertCompanyAccess(ctx: SecurityContext, targetCompanyId: string): void {
    if (ctx.isSuperadmin || ctx.effectivePermissions.includes('*')) {
      return;
    }
    if (!ctx.activeCompanyId || ctx.activeCompanyId !== targetCompanyId) {
      throw AppError.forbidden(
        `Cross-tenant access violation: Active company '${ctx.activeCompanyId}' cannot access financial reports in company '${targetCompanyId}'`
      );
    }
  }

  /**
   * 1. GENERAL LEDGER REPORT
   */
  async getGeneralLedgerReport(
    filter: {
      startDate?: string;
      endDate?: string;
      branchId?: string;
      accountId?: string;
      partnerId?: string;
    } = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<GeneralLedgerReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');
    this.assertCompanyAccess(ctx, companyId);

    const pool = client || getPool();
    const startDate = filter.startDate || '1970-01-01';
    const endDate = filter.endDate || new Date().toISOString().split('T')[0];

    const conditions: string[] = [
      'aj.company_id = $1',
      "aj.status = 'POSTED'",
      'aj.posting_date >= $2',
      'aj.posting_date <= $3',
    ];
    const params: any[] = [companyId, startDate, endDate];
    let idx = 4;

    if (filter.branchId) {
      conditions.push(`aj.branch_id = $${idx++}`);
      params.push(filter.branchId);
    }
    if (filter.accountId) {
      conditions.push(`ajl.account_id = $${idx++}`);
      params.push(filter.accountId);
    }
    if (filter.partnerId) {
      conditions.push(`ajl.partner_id = $${idx++}`);
      params.push(filter.partnerId);
    }

    const sql = `
      SELECT 
        ajl.id as line_id,
        aj.id as journal_id,
        aj.journal_number,
        aj.posting_date,
        aj.source_document_type,
        aj.source_document_id,
        ajl.account_id,
        coa.account_code,
        coa.account_name,
        coa.account_type,
        ajl.partner_id,
        bp.legal_name as partner_name,
        bp.partner_code as partner_code,
        ajl.description,
        ajl.base_debit as debit,
        ajl.base_credit as credit
      FROM accounting_journal_lines ajl
      JOIN accounting_journals aj ON ajl.journal_id = aj.id
      JOIN chart_of_accounts coa ON ajl.account_id = coa.id
      LEFT JOIN business_partners bp ON ajl.partner_id = bp.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY aj.posting_date ASC, aj.created_at ASC, ajl.line_number ASC;
    `;

    const res = await pool.query(sql, params);

    let totalDebit = 0;
    let totalCredit = 0;
    let runningBalance = 0;
    const lines: GeneralLedgerLine[] = [];

    for (const r of res.rows) {
      const debit = Math.round(parseFloat(r.debit || '0') * 10000) / 10000;
      const credit = Math.round(parseFloat(r.credit || '0') * 10000) / 10000;
      totalDebit = Math.round((totalDebit + debit) * 10000) / 10000;
      totalCredit = Math.round((totalCredit + credit) * 10000) / 10000;

      // Net impact for normal debit balances (ASSET, EXPENSE) is +debit -credit
      // For normal credit balances (LIABILITY, EQUITY, REVENUE) is +credit -debit
      const isDebitNormal = r.account_type === 'ASSET' || r.account_type === 'EXPENSE';
      const delta = isDebitNormal ? debit - credit : credit - debit;
      runningBalance = Math.round((runningBalance + delta) * 10000) / 10000;

      lines.push({
        id: r.line_id,
        journalId: r.journal_id,
        journalNumber: r.journal_number,
        postingDate: r.posting_date ? new Date(r.posting_date).toISOString().split('T')[0] : '',
        sourceDocumentType: r.source_document_type,
        sourceDocumentId: r.source_document_id || null,
        accountId: r.account_id,
        accountCode: r.account_code,
        accountName: r.account_name,
        accountType: r.account_type as AccountType,
        partnerId: r.partner_id || null,
        partnerName: r.partner_name || null,
        partnerCode: r.partner_code || null,
        description: r.description || null,
        debit,
        credit,
        runningBalance,
      });
    }

    return {
      companyId,
      startDate,
      endDate,
      branchId: filter.branchId || null,
      accountId: filter.accountId || null,
      generatedAt: new Date().toISOString(),
      totalDebit,
      totalCredit,
      lines,
    };
  }

  /**
   * 2. ACCOUNT LEDGER REPORT
   */
  async getAccountLedgerReport(
    accountId: string,
    filter: { startDate?: string; endDate?: string } = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<AccountLedgerReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');
    this.assertCompanyAccess(ctx, companyId);

    const pool = client || getPool();
    const startDate = filter.startDate || '1970-01-01';
    const endDate = filter.endDate || new Date().toISOString().split('T')[0];

    // Verify account exists in company
    const accRes = await pool.query(
      `SELECT * FROM chart_of_accounts WHERE id = $1 AND company_id = $2;`,
      [accountId, companyId]
    );
    if (accRes.rows.length === 0) {
      throw AppError.notFound(`Account with ID '${accountId}' not found in active company`);
    }
    const acc = accRes.rows[0];
    const isDebitNormal = acc.account_type === 'ASSET' || acc.account_type === 'EXPENSE';

    // Calculate Opening Balance prior to startDate from all POSTED journals
    const openRes = await pool.query(
      `SELECT 
         COALESCE(SUM(ajl.base_debit), 0) as total_debit,
         COALESCE(SUM(ajl.base_credit), 0) as total_credit
       FROM accounting_journal_lines ajl
       JOIN accounting_journals aj ON ajl.journal_id = aj.id
       WHERE aj.company_id = $1 
         AND aj.status = 'POSTED'
         AND ajl.account_id = $2
         AND aj.posting_date < $3;`,
      [companyId, accountId, startDate]
    );
    const priorDebit = parseFloat(openRes.rows[0]?.total_debit || '0');
    const priorCredit = parseFloat(openRes.rows[0]?.total_credit || '0');
    const openingBalance = Math.round(
      (isDebitNormal ? priorDebit - priorCredit : priorCredit - priorDebit) * 10000
    ) / 10000;

    // Fetch lines in period
    const linesRes = await pool.query(
      `SELECT 
         ajl.id as line_id,
         aj.id as journal_id,
         aj.journal_number,
         aj.posting_date,
         aj.source_document_type,
         ajl.description,
         ajl.base_debit as debit,
         ajl.base_credit as credit
       FROM accounting_journal_lines ajl
       JOIN accounting_journals aj ON ajl.journal_id = aj.id
       WHERE aj.company_id = $1
         AND aj.status = 'POSTED'
         AND ajl.account_id = $2
         AND aj.posting_date >= $3
         AND aj.posting_date <= $4
       ORDER BY aj.posting_date ASC, aj.created_at ASC, ajl.line_number ASC;`,
      [companyId, accountId, startDate, endDate]
    );

    let running = openingBalance;
    let totalDebits = 0;
    let totalCredits = 0;
    const lines: AccountLedgerLine[] = [];

    for (const r of linesRes.rows) {
      const debit = Math.round(parseFloat(r.debit || '0') * 10000) / 10000;
      const credit = Math.round(parseFloat(r.credit || '0') * 10000) / 10000;
      totalDebits = Math.round((totalDebits + debit) * 10000) / 10000;
      totalCredits = Math.round((totalCredits + credit) * 10000) / 10000;

      const delta = isDebitNormal ? debit - credit : credit - debit;
      running = Math.round((running + delta) * 10000) / 10000;

      lines.push({
        id: r.line_id,
        journalId: r.journal_id,
        journalNumber: r.journal_number,
        postingDate: r.posting_date ? new Date(r.posting_date).toISOString().split('T')[0] : '',
        sourceDocumentType: r.source_document_type,
        description: r.description || null,
        debit,
        credit,
        runningBalance: running,
      });
    }

    return {
      companyId,
      accountId: acc.id,
      accountCode: acc.account_code,
      accountName: acc.account_name,
      accountType: acc.account_type as AccountType,
      startDate,
      endDate,
      currencyCode: acc.currency_code || 'USD',
      openingBalance,
      totalDebits,
      totalCredits,
      closingBalance: running,
      lines,
    };
  }

  /**
   * 3. PROFIT & LOSS STATEMENT (INCOME STATEMENT)
   */
  async getProfitLossReport(
    filter: { startDate?: string; endDate?: string; branchId?: string } = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<ProfitLossReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');
    this.assertCompanyAccess(ctx, companyId);

    const pool = client || getPool();
    const startDate = filter.startDate || `${new Date().getFullYear()}-01-01`;
    const endDate = filter.endDate || new Date().toISOString().split('T')[0];

    const conditions: string[] = [
      'aj.company_id = $1',
      "aj.status = 'POSTED'",
      'aj.posting_date >= $2',
      'aj.posting_date <= $3',
      "coa.account_type IN ('REVENUE', 'EXPENSE')",
      'coa.is_active = TRUE',
    ];
    const params: any[] = [companyId, startDate, endDate];
    let idx = 4;

    if (filter.branchId) {
      conditions.push(`aj.branch_id = $${idx++}`);
      params.push(filter.branchId);
    }

    const sql = `
      SELECT 
        coa.id as account_id,
        coa.account_code,
        coa.account_name,
        coa.account_type,
        coa.currency_code,
        COALESCE(SUM(ajl.base_debit), 0) as total_debit,
        COALESCE(SUM(ajl.base_credit), 0) as total_credit
      FROM chart_of_accounts coa
      JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
      JOIN accounting_journals aj ON ajl.journal_id = aj.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.currency_code
      ORDER BY coa.account_code ASC;
    `;

    const res = await pool.query(sql, params);

    const opRevenueAccounts = [];
    const cogsAccounts = [];
    const opExpenseAccounts = [];
    const otherIncomeAccounts = [];
    const otherExpenseAccounts = [];

    let totalOpRevenue = 0;
    let totalCogs = 0;
    let totalOpExpenses = 0;
    let totalOtherIncome = 0;
    let totalOtherExpenses = 0;

    for (const r of res.rows) {
      const debit = parseFloat(r.total_debit || '0');
      const credit = parseFloat(r.total_credit || '0');
      const code = r.account_code.trim();
      const name = r.account_name.trim();

      if (r.account_type === 'REVENUE') {
        // Normal Credit balance
        const amount = Math.round((credit - debit) * 10000) / 10000;
        if (code.startsWith('8') || name.toLowerCase().includes('other income')) {
          otherIncomeAccounts.push({ accountId: r.account_id, accountCode: code, accountName: name, amount });
          totalOtherIncome = Math.round((totalOtherIncome + amount) * 10000) / 10000;
        } else {
          opRevenueAccounts.push({ accountId: r.account_id, accountCode: code, accountName: name, amount });
          totalOpRevenue = Math.round((totalOpRevenue + amount) * 10000) / 10000;
        }
      } else if (r.account_type === 'EXPENSE') {
        // Normal Debit balance
        const amount = Math.round((debit - credit) * 10000) / 10000;
        if (code === '5000' || code.startsWith('50') || name.toLowerCase().includes('cost of goods') || name.toLowerCase().includes('cogs')) {
          cogsAccounts.push({ accountId: r.account_id, accountCode: code, accountName: name, amount });
          totalCogs = Math.round((totalCogs + amount) * 10000) / 10000;
        } else if (code.startsWith('8') || name.toLowerCase().includes('other expense')) {
          otherExpenseAccounts.push({ accountId: r.account_id, accountCode: code, accountName: name, amount });
          totalOtherExpenses = Math.round((totalOtherExpenses + amount) * 10000) / 10000;
        } else {
          opExpenseAccounts.push({ accountId: r.account_id, accountCode: code, accountName: name, amount });
          totalOpExpenses = Math.round((totalOpExpenses + amount) * 10000) / 10000;
        }
      }
    }

    const grossProfit = Math.round((totalOpRevenue - totalCogs) * 10000) / 10000;
    const operatingProfit = Math.round((grossProfit - totalOpExpenses) * 10000) / 10000;
    const netProfit = Math.round((operatingProfit + totalOtherIncome - totalOtherExpenses) * 10000) / 10000;

    return {
      companyId,
      startDate,
      endDate,
      branchId: filter.branchId || null,
      generatedAt: new Date().toISOString(),
      currencyCode: 'USD',
      operatingRevenue: { accounts: opRevenueAccounts, total: totalOpRevenue },
      costOfGoodsSold: { accounts: cogsAccounts, total: totalCogs },
      grossProfit,
      operatingExpenses: { accounts: opExpenseAccounts, total: totalOpExpenses },
      operatingProfit,
      otherIncome: { accounts: otherIncomeAccounts, total: totalOtherIncome },
      otherExpenses: { accounts: otherExpenseAccounts, total: totalOtherExpenses },
      netProfit,
    };
  }

  /**
   * 4. BALANCE SHEET REPORT
   */
  async getBalanceSheetReport(
    filter: { asOfDate?: string; branchId?: string } = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<BalanceSheetReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');
    this.assertCompanyAccess(ctx, companyId);

    const pool = client || getPool();
    const asOfDate = filter.asOfDate || new Date().toISOString().split('T')[0];

    // 1. Fetch all POSTED journal lines up to asOfDate for ASSET, LIABILITY, EQUITY
    const conditions: string[] = [
      'aj.company_id = $1',
      "aj.status = 'POSTED'",
      'aj.posting_date <= $2',
      "coa.account_type IN ('ASSET', 'LIABILITY', 'EQUITY')",
      'coa.is_active = TRUE',
    ];
    const params: any[] = [companyId, asOfDate];
    let idx = 3;

    if (filter.branchId) {
      conditions.push(`aj.branch_id = $${idx++}`);
      params.push(filter.branchId);
    }

    const sql = `
      SELECT 
        coa.id as account_id,
        coa.account_code,
        coa.account_name,
        coa.account_type,
        COALESCE(SUM(ajl.base_debit), 0) as total_debit,
        COALESCE(SUM(ajl.base_credit), 0) as total_credit
      FROM chart_of_accounts coa
      LEFT JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
      LEFT JOIN accounting_journals aj ON ajl.journal_id = aj.id 
        AND aj.status = 'POSTED'
        AND aj.posting_date <= $2
        ${filter.branchId ? `AND aj.branch_id = '${filter.branchId}'` : ''}
      WHERE coa.company_id = $1 
        AND coa.account_type IN ('ASSET', 'LIABILITY', 'EQUITY')
        AND coa.is_active = TRUE
      GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type
      ORDER BY coa.account_code ASC;
    `;

    const res = await pool.query(sql, params);

    const currentAssets = [];
    const nonCurrentAssets = [];
    let totalCurrentAssets = 0;
    let totalNonCurrentAssets = 0;

    const currentLiabilities = [];
    const nonCurrentLiabilities = [];
    let totalCurrentLiabilities = 0;
    let totalNonCurrentLiabilities = 0;

    const equityAccounts = [];
    let totalEquityAccounts = 0;

    for (const r of res.rows) {
      const debit = parseFloat(r.total_debit || '0');
      const credit = parseFloat(r.total_credit || '0');
      const code = r.account_code.trim();
      const name = r.account_name.trim();

      if (r.account_type === 'ASSET') {
        const balance = Math.round((debit - credit) * 10000) / 10000;
        if (balance === 0) continue;
        if (code.startsWith('15') || code.startsWith('16') || code.startsWith('17') || code.startsWith('18')) {
          nonCurrentAssets.push({ accountId: r.account_id, accountCode: code, accountName: name, balance });
          totalNonCurrentAssets = Math.round((totalNonCurrentAssets + balance) * 10000) / 10000;
        } else {
          currentAssets.push({ accountId: r.account_id, accountCode: code, accountName: name, balance });
          totalCurrentAssets = Math.round((totalCurrentAssets + balance) * 10000) / 10000;
        }
      } else if (r.account_type === 'LIABILITY') {
        const balance = Math.round((credit - debit) * 10000) / 10000;
        if (balance === 0) continue;
        if (code.startsWith('25') || code.startsWith('26') || code.startsWith('27') || code.startsWith('28')) {
          nonCurrentLiabilities.push({ accountId: r.account_id, accountCode: code, accountName: name, balance });
          totalNonCurrentLiabilities = Math.round((totalNonCurrentLiabilities + balance) * 10000) / 10000;
        } else {
          currentLiabilities.push({ accountId: r.account_id, accountCode: code, accountName: name, balance });
          totalCurrentLiabilities = Math.round((totalCurrentLiabilities + balance) * 10000) / 10000;
        }
      } else if (r.account_type === 'EQUITY') {
        const balance = Math.round((credit - debit) * 10000) / 10000;
        if (balance !== 0) {
          equityAccounts.push({ accountId: r.account_id, accountCode: code, accountName: name, balance });
          totalEquityAccounts = Math.round((totalEquityAccounts + balance) * 10000) / 10000;
        }
      }
    }

    // 2. Compute Net Profit up to asOfDate to balance the equity
    const pnlRes = await pool.query(
      `SELECT 
         COALESCE(SUM(CASE WHEN coa.account_type = 'REVENUE' THEN ajl.base_credit - ajl.base_debit ELSE 0 END), 0) as rev_net,
         COALESCE(SUM(CASE WHEN coa.account_type = 'EXPENSE' THEN ajl.base_debit - ajl.base_credit ELSE 0 END), 0) as exp_net
       FROM chart_of_accounts coa
       JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
       JOIN accounting_journals aj ON ajl.journal_id = aj.id
       WHERE aj.company_id = $1 
         AND aj.status = 'POSTED'
         AND aj.posting_date <= $2
         AND coa.account_type IN ('REVENUE', 'EXPENSE')
         ${filter.branchId ? `AND aj.branch_id = '${filter.branchId}'` : ''};`,
      [companyId, asOfDate]
    );
    const revNet = parseFloat(pnlRes.rows[0]?.rev_net || '0');
    const expNet = parseFloat(pnlRes.rows[0]?.exp_net || '0');
    const currentPeriodNetProfit = Math.round((revNet - expNet) * 10000) / 10000;

    const totalAssets = Math.round((totalCurrentAssets + totalNonCurrentAssets) * 10000) / 10000;
    const totalLiabilities = Math.round((totalCurrentLiabilities + totalNonCurrentLiabilities) * 10000) / 10000;
    const totalEquity = Math.round((totalEquityAccounts + currentPeriodNetProfit) * 10000) / 10000;
    const totalLiabilitiesAndEquity = Math.round((totalLiabilities + totalEquity) * 10000) / 10000;
    const discrepancy = Math.round((totalAssets - totalLiabilitiesAndEquity) * 10000) / 10000;
    const isBalanced = Math.abs(discrepancy) < 0.0001;

    return {
      companyId,
      asOfDate,
      branchId: filter.branchId || null,
      generatedAt: new Date().toISOString(),
      currencyCode: 'USD',
      assets: {
        currentAssets,
        nonCurrentAssets,
        totalCurrentAssets,
        totalNonCurrentAssets,
        totalAssets,
      },
      liabilities: {
        currentLiabilities,
        nonCurrentLiabilities,
        totalCurrentLiabilities,
        totalNonCurrentLiabilities,
        totalLiabilities,
      },
      equity: {
        accounts: equityAccounts,
        totalAccounts: totalEquityAccounts,
        currentPeriodNetProfit,
        totalEquity,
      },
      totalLiabilitiesAndEquity,
      discrepancy,
      isBalanced,
    };
  }

  /**
   * 5. AR AGING REPORT & RECONCILIATION
   */
  async getArAgingReport(
    filter: { asOfDate?: string } = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<ArAgingReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');
    this.assertCompanyAccess(ctx, companyId);

    const pool = client || getPool();
    const asOfDate = filter.asOfDate || new Date().toISOString().split('T')[0];

    // Query open/partially paid customer receivables
    const sql = `
      SELECT 
        cr.id as receivable_id,
        cr.customer_id,
        bp.partner_code as customer_code,
        bp.legal_name as customer_name,
        cr.sales_invoice_id,
        si.invoice_number,
        cr.invoice_date,
        cr.due_date,
        cr.currency_code,
        cr.invoice_amount,
        cr.paid_amount,
        cr.outstanding_amount
      FROM customer_receivables cr
      JOIN business_partners bp ON cr.customer_id = bp.id
      JOIN sales_invoices si ON cr.sales_invoice_id = si.id
      WHERE cr.company_id = $1 
        AND cr.status IN ('OPEN', 'PARTIALLY_PAID')
        AND cr.outstanding_amount > 0
        AND cr.invoice_date <= $2
      ORDER BY cr.invoice_date ASC;
    `;
    const res = await pool.query(sql, [companyId, asOfDate]);

    const asOfTime = new Date(asOfDate).getTime();
    const items: ArAgingItem[] = [];
    const customerMap = new Map<string, ArAgingCustomerSummary>();

    let totalCurrent = 0;
    let totalDays1To30 = 0;
    let totalDays31To60 = 0;
    let totalDays61To90 = 0;
    let totalDays91To120 = 0;
    let totalDaysOver120 = 0;
    let grandTotalOutstanding = 0;

    for (const r of res.rows) {
      const outstanding = Math.round(parseFloat(r.outstanding_amount || '0') * 10000) / 10000;
      const refDateStr = r.due_date || r.invoice_date;
      const refTime = new Date(refDateStr).getTime();
      const daysOverdue = Math.max(0, Math.floor((asOfTime - refTime) / (1000 * 60 * 60 * 24)));

      let bucket: ArAgingItem['bucket'] = 'CURRENT';
      if (daysOverdue > 120) bucket = 'DAYS_OVER_120';
      else if (daysOverdue > 90) bucket = 'DAYS_91_120';
      else if (daysOverdue > 60) bucket = 'DAYS_61_90';
      else if (daysOverdue > 30) bucket = 'DAYS_31_60';
      else if (daysOverdue > 0) bucket = 'DAYS_1_30';

      items.push({
        receivableId: r.receivable_id,
        customerId: r.customer_id,
        customerCode: r.customer_code,
        customerName: r.customer_name,
        salesInvoiceId: r.sales_invoice_id,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date ? new Date(r.invoice_date).toISOString().split('T')[0] : '',
        dueDate: r.due_date ? new Date(r.due_date).toISOString().split('T')[0] : null,
        currencyCode: r.currency_code || 'USD',
        invoiceAmount: parseFloat(r.invoice_amount || '0'),
        paidAmount: parseFloat(r.paid_amount || '0'),
        outstandingAmount: outstanding,
        daysOverdue,
        bucket,
      });

      // Update bucket sums
      if (bucket === 'CURRENT') totalCurrent = Math.round((totalCurrent + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_1_30') totalDays1To30 = Math.round((totalDays1To30 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_31_60') totalDays31To60 = Math.round((totalDays31To60 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_61_90') totalDays61To90 = Math.round((totalDays61To90 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_91_120') totalDays91To120 = Math.round((totalDays91To120 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_OVER_120') totalDaysOver120 = Math.round((totalDaysOver120 + outstanding) * 10000) / 10000;

      grandTotalOutstanding = Math.round((grandTotalOutstanding + outstanding) * 10000) / 10000;

      // Update customer summary
      if (!customerMap.has(r.customer_id)) {
        customerMap.set(r.customer_id, {
          customerId: r.customer_id,
          customerCode: r.customer_code,
          customerName: r.customer_name,
          current: 0,
          days1To30: 0,
          days31To60: 0,
          days61To90: 0,
          days91To120: 0,
          daysOver120: 0,
          totalOutstanding: 0,
        });
      }
      const c = customerMap.get(r.customer_id)!;
      c.totalOutstanding = Math.round((c.totalOutstanding + outstanding) * 10000) / 10000;
      if (bucket === 'CURRENT') c.current = Math.round((c.current + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_1_30') c.days1To30 = Math.round((c.days1To30 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_31_60') c.days31To60 = Math.round((c.days31To60 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_61_90') c.days61To90 = Math.round((c.days61To90 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_91_120') c.days91To120 = Math.round((c.days91To120 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_OVER_120') c.daysOver120 = Math.round((c.daysOver120 + outstanding) * 10000) / 10000;
    }

    // Query GL Balance of Trade AR Account (1100 or Trade Accounts Receivable)
    const glRes = await pool.query(
      `SELECT 
         COALESCE(SUM(ajl.base_debit), 0) - COALESCE(SUM(ajl.base_credit), 0) as ar_balance
       FROM chart_of_accounts coa
       JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
       JOIN accounting_journals aj ON ajl.journal_id = aj.id
       WHERE coa.company_id = $1
         AND aj.status = 'POSTED'
         AND aj.posting_date <= $2
         AND (coa.account_code = '1100' OR coa.account_name ILIKE '%Accounts Receivable%');`,
      [companyId, asOfDate]
    );
    const glAccountBalance = Math.round(parseFloat(glRes.rows[0]?.ar_balance || '0') * 10000) / 10000;
    const discrepancy = Math.round((grandTotalOutstanding - glAccountBalance) * 10000) / 10000;
    const isReconciled = Math.abs(discrepancy) < 0.01;

    return {
      companyId,
      asOfDate,
      generatedAt: new Date().toISOString(),
      currencyCode: 'USD',
      items,
      customers: Array.from(customerMap.values()),
      totalCurrent,
      totalDays1To30,
      totalDays31To60,
      totalDays61To90,
      totalDays91To120,
      totalDaysOver120,
      grandTotalOutstanding,
      glAccountBalance,
      discrepancy,
      isReconciled,
    };
  }

  /**
   * 6. AP AGING REPORT & RECONCILIATION
   */
  async getApAgingReport(
    filter: { asOfDate?: string } = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<ApAgingReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');
    this.assertCompanyAccess(ctx, companyId);

    const pool = client || getPool();
    const asOfDate = filter.asOfDate || new Date().toISOString().split('T')[0];

    // Query open/partially paid supplier payables
    const sql = `
      SELECT 
        sp.id as payable_id,
        sp.supplier_id,
        bp.partner_code as supplier_code,
        bp.legal_name as supplier_name,
        sp.purchase_invoice_id,
        pi.invoice_number,
        sp.invoice_date,
        sp.due_date,
        sp.currency_code,
        sp.invoice_amount,
        sp.paid_amount,
        sp.outstanding_amount
      FROM supplier_payables sp
      JOIN business_partners bp ON sp.supplier_id = bp.id
      JOIN purchase_invoices pi ON sp.purchase_invoice_id = pi.id
      WHERE sp.company_id = $1 
        AND sp.status IN ('OPEN', 'PARTIALLY_PAID')
        AND sp.outstanding_amount > 0
        AND sp.invoice_date <= $2
      ORDER BY sp.invoice_date ASC;
    `;
    const res = await pool.query(sql, [companyId, asOfDate]);

    const asOfTime = new Date(asOfDate).getTime();
    const items: ApAgingItem[] = [];
    const supplierMap = new Map<string, ApAgingSupplierSummary>();

    let totalCurrent = 0;
    let totalDays1To30 = 0;
    let totalDays31To60 = 0;
    let totalDays61To90 = 0;
    let totalDays91To120 = 0;
    let totalDaysOver120 = 0;
    let grandTotalOutstanding = 0;

    for (const r of res.rows) {
      const outstanding = Math.round(parseFloat(r.outstanding_amount || '0') * 10000) / 10000;
      const refDateStr = r.due_date || r.invoice_date;
      const refTime = new Date(refDateStr).getTime();
      const daysOverdue = Math.max(0, Math.floor((asOfTime - refTime) / (1000 * 60 * 60 * 24)));

      let bucket: ApAgingItem['bucket'] = 'CURRENT';
      if (daysOverdue > 120) bucket = 'DAYS_OVER_120';
      else if (daysOverdue > 90) bucket = 'DAYS_91_120';
      else if (daysOverdue > 60) bucket = 'DAYS_61_90';
      else if (daysOverdue > 30) bucket = 'DAYS_31_60';
      else if (daysOverdue > 0) bucket = 'DAYS_1_30';

      items.push({
        payableId: r.payable_id,
        supplierId: r.supplier_id,
        supplierCode: r.supplier_code,
        supplierName: r.supplier_name,
        purchaseInvoiceId: r.purchase_invoice_id,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date ? new Date(r.invoice_date).toISOString().split('T')[0] : '',
        dueDate: r.due_date ? new Date(r.due_date).toISOString().split('T')[0] : null,
        currencyCode: r.currency_code || 'USD',
        invoiceAmount: parseFloat(r.invoice_amount || '0'),
        paidAmount: parseFloat(r.paid_amount || '0'),
        outstandingAmount: outstanding,
        daysOverdue,
        bucket,
      });

      if (bucket === 'CURRENT') totalCurrent = Math.round((totalCurrent + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_1_30') totalDays1To30 = Math.round((totalDays1To30 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_31_60') totalDays31To60 = Math.round((totalDays31To60 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_61_90') totalDays61To90 = Math.round((totalDays61To90 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_91_120') totalDays91To120 = Math.round((totalDays91To120 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_OVER_120') totalDaysOver120 = Math.round((totalDaysOver120 + outstanding) * 10000) / 10000;

      grandTotalOutstanding = Math.round((grandTotalOutstanding + outstanding) * 10000) / 10000;

      if (!supplierMap.has(r.supplier_id)) {
        supplierMap.set(r.supplier_id, {
          supplierId: r.supplier_id,
          supplierCode: r.supplier_code,
          supplierName: r.supplier_name,
          current: 0,
          days1To30: 0,
          days31To60: 0,
          days61To90: 0,
          days91To120: 0,
          daysOver120: 0,
          totalOutstanding: 0,
        });
      }
      const s = supplierMap.get(r.supplier_id)!;
      s.totalOutstanding = Math.round((s.totalOutstanding + outstanding) * 10000) / 10000;
      if (bucket === 'CURRENT') s.current = Math.round((s.current + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_1_30') s.days1To30 = Math.round((s.days1To30 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_31_60') s.days31To60 = Math.round((s.days31To60 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_61_90') s.days61To90 = Math.round((s.days61To90 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_91_120') s.days91To120 = Math.round((s.days91To120 + outstanding) * 10000) / 10000;
      else if (bucket === 'DAYS_OVER_120') s.daysOver120 = Math.round((s.daysOver120 + outstanding) * 10000) / 10000;
    }

    // Query GL Balance of Trade AP Account (2000 or Trade Accounts Payable)
    const glRes = await pool.query(
      `SELECT 
         COALESCE(SUM(ajl.base_credit), 0) - COALESCE(SUM(ajl.base_debit), 0) as ap_balance
       FROM chart_of_accounts coa
       JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
       JOIN accounting_journals aj ON ajl.journal_id = aj.id
       WHERE coa.company_id = $1
         AND aj.status = 'POSTED'
         AND aj.posting_date <= $2
         AND (coa.account_code = '2000' OR coa.account_name ILIKE '%Accounts Payable%');`,
      [companyId, asOfDate]
    );
    const glAccountBalance = Math.round(parseFloat(glRes.rows[0]?.ap_balance || '0') * 10000) / 10000;
    const discrepancy = Math.round((grandTotalOutstanding - glAccountBalance) * 10000) / 10000;
    const isReconciled = Math.abs(discrepancy) < 0.01;

    return {
      companyId,
      asOfDate,
      generatedAt: new Date().toISOString(),
      currencyCode: 'USD',
      items,
      suppliers: Array.from(supplierMap.values()),
      totalCurrent,
      totalDays1To30,
      totalDays31To60,
      totalDays61To90,
      totalDays91To120,
      totalDaysOver120,
      grandTotalOutstanding,
      glAccountBalance,
      discrepancy,
      isReconciled,
    };
  }

  /**
   * 7. CASH & BANK REPORT FOUNDATION
   */
  async getCashBankReport(
    filter: { startDate?: string; endDate?: string } = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<CashBankReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');
    this.assertCompanyAccess(ctx, companyId);

    const pool = client || getPool();
    const startDate = filter.startDate || `${new Date().getFullYear()}-01-01`;
    const endDate = filter.endDate || new Date().toISOString().split('T')[0];

    // Find cash and bank accounts (code 1000, 1010, 1020 or name matches cash/bank)
    const accsRes = await pool.query(
      `SELECT * FROM chart_of_accounts 
       WHERE company_id = $1 
         AND account_type = 'ASSET'
         AND is_active = TRUE
         AND (account_code IN ('1000', '1010', '1020') OR account_name ILIKE '%cash%' OR account_name ILIKE '%bank%')
       ORDER BY account_code ASC;`,
      [companyId]
    );

    const accountSummaries: CashBankAccountSummary[] = [];
    let totalOpeningBalance = 0;
    let totalReceipts = 0;
    let totalPayments = 0;
    let totalClosingBalance = 0;

    for (const acc of accsRes.rows) {
      // Opening balance
      const openRes = await pool.query(
        `SELECT 
           COALESCE(SUM(ajl.base_debit), 0) - COALESCE(SUM(ajl.base_credit), 0) as open_bal
         FROM accounting_journal_lines ajl
         JOIN accounting_journals aj ON ajl.journal_id = aj.id
         WHERE aj.company_id = $1
           AND aj.status = 'POSTED'
           AND ajl.account_id = $2
           AND aj.posting_date < $3;`,
        [companyId, acc.id, startDate]
      );
      const openingBalance = Math.round(parseFloat(openRes.rows[0]?.open_bal || '0') * 10000) / 10000;

      // Transactions in period
      const txRes = await pool.query(
        `SELECT 
           aj.id as journal_id,
           aj.journal_number,
           aj.posting_date,
           aj.source_document_type,
           ajl.description,
           ajl.base_debit as debit,
           ajl.base_credit as credit
         FROM accounting_journal_lines ajl
         JOIN accounting_journals aj ON ajl.journal_id = aj.id
         WHERE aj.company_id = $1
           AND aj.status = 'POSTED'
           AND ajl.account_id = $2
           AND aj.posting_date >= $3
           AND aj.posting_date <= $4
         ORDER BY aj.posting_date ASC, aj.created_at ASC;`,
        [companyId, acc.id, startDate, endDate]
      );

      let running = openingBalance;
      let accReceipts = 0;
      let accPayments = 0;
      const transactions = [];

      for (const t of txRes.rows) {
        const debit = Math.round(parseFloat(t.debit || '0') * 10000) / 10000;
        const credit = Math.round(parseFloat(t.credit || '0') * 10000) / 10000;
        accReceipts = Math.round((accReceipts + debit) * 10000) / 10000;
        accPayments = Math.round((accPayments + credit) * 10000) / 10000;
        running = Math.round((running + debit - credit) * 10000) / 10000;

        transactions.push({
          journalId: t.journal_id,
          journalNumber: t.journal_number,
          postingDate: t.posting_date ? new Date(t.posting_date).toISOString().split('T')[0] : '',
          sourceDocumentType: t.source_document_type,
          description: t.description || null,
          debit,
          credit,
          runningBalance: running,
        });
      }

      totalOpeningBalance = Math.round((totalOpeningBalance + openingBalance) * 10000) / 10000;
      totalReceipts = Math.round((totalReceipts + accReceipts) * 10000) / 10000;
      totalPayments = Math.round((totalPayments + accPayments) * 10000) / 10000;
      totalClosingBalance = Math.round((totalClosingBalance + running) * 10000) / 10000;

      accountSummaries.push({
        accountId: acc.id,
        accountCode: acc.account_code,
        accountName: acc.account_name,
        accountType: acc.account_type as AccountType,
        openingBalance,
        totalReceipts: accReceipts,
        totalPayments: accPayments,
        closingBalance: running,
        transactions,
      });
    }

    return {
      companyId,
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      currencyCode: 'USD',
      accounts: accountSummaries,
      totalOpeningBalance,
      totalReceipts,
      totalPayments,
      totalClosingBalance,
    };
  }

  /**
   * CSV EXPORTERS
   */
  exportGeneralLedgerCsv(report: GeneralLedgerReport): string {
    const headers = ['Posting Date', 'Journal #', 'Source', 'Account Code', 'Account Name', 'Partner', 'Description', 'Debit', 'Credit', 'Balance'];
    const rows = report.lines.map((l) => [
      l.postingDate,
      `"${l.journalNumber}"`,
      `"${l.sourceDocumentType}"`,
      `"${l.accountCode}"`,
      `"${l.accountName.replace(/"/g, '""')}"`,
      `"${(l.partnerName || '').replace(/"/g, '""')}"`,
      `"${(l.description || '').replace(/"/g, '""')}"`,
      l.debit.toFixed(2),
      l.credit.toFixed(2),
      l.runningBalance.toFixed(2),
    ]);
    rows.push(['"TOTAL"', '""', '""', '""', '""', '""', '""', report.totalDebit.toFixed(2), report.totalCredit.toFixed(2), '""']);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  exportProfitLossCsv(report: ProfitLossReport): string {
    const lines = [
      'PROFIT & LOSS STATEMENT',
      `Period: ${report.startDate} to ${report.endDate}`,
      `Currency: ${report.currencyCode}`,
      '',
      'Account Code,Account Name,Amount',
      'OPERATING REVENUE',
      ...report.operatingRevenue.accounts.map((a) => `"${a.accountCode}","${a.accountName.replace(/"/g, '""')}",${a.amount.toFixed(2)}`),
      `"TOTAL OPERATING REVENUE",""${report.operatingRevenue.total.toFixed(2)}`,
      '',
      'COST OF GOODS SOLD',
      ...report.costOfGoodsSold.accounts.map((a) => `"${a.accountCode}","${a.accountName.replace(/"/g, '""')}",${a.amount.toFixed(2)}`),
      `"TOTAL COGS",""${report.costOfGoodsSold.total.toFixed(2)}`,
      '',
      `"GROSS PROFIT",""${report.grossProfit.toFixed(2)}`,
      '',
      'OPERATING EXPENSES',
      ...report.operatingExpenses.accounts.map((a) => `"${a.accountCode}","${a.accountName.replace(/"/g, '""')}",${a.amount.toFixed(2)}`),
      `"TOTAL OPERATING EXPENSES",""${report.operatingExpenses.total.toFixed(2)}`,
      '',
      `"OPERATING PROFIT",""${report.operatingProfit.toFixed(2)}`,
      '',
      `"NET PROFIT / (LOSS)",""${report.netProfit.toFixed(2)}`,
    ];
    return lines.join('\n');
  }

  exportBalanceSheetCsv(report: BalanceSheetReport): string {
    const lines = [
      'BALANCE SHEET',
      `As of: ${report.asOfDate}`,
      `Currency: ${report.currencyCode}`,
      '',
      'Account Code,Account Name,Balance',
      'CURRENT ASSETS',
      ...report.assets.currentAssets.map((a) => `"${a.accountCode}","${a.accountName.replace(/"/g, '""')}",${a.balance.toFixed(2)}`),
      `"TOTAL CURRENT ASSETS",""${report.assets.totalCurrentAssets.toFixed(2)}`,
      '',
      'NON-CURRENT ASSETS',
      ...report.assets.nonCurrentAssets.map((a) => `"${a.accountCode}","${a.accountName.replace(/"/g, '""')}",${a.balance.toFixed(2)}`),
      `"TOTAL NON-CURRENT ASSETS",""${report.assets.totalNonCurrentAssets.toFixed(2)}`,
      '',
      `"TOTAL ASSETS",""${report.assets.totalAssets.toFixed(2)}`,
      '',
      'CURRENT LIABILITIES',
      ...report.liabilities.currentLiabilities.map((a) => `"${a.accountCode}","${a.accountName.replace(/"/g, '""')}",${a.balance.toFixed(2)}`),
      `"TOTAL CURRENT LIABILITIES",""${report.liabilities.totalCurrentLiabilities.toFixed(2)}`,
      '',
      'NON-CURRENT LIABILITIES',
      ...report.liabilities.nonCurrentLiabilities.map((a) => `"${a.accountCode}","${a.accountName.replace(/"/g, '""')}",${a.balance.toFixed(2)}`),
      `"TOTAL NON-CURRENT LIABILITIES",""${report.liabilities.totalNonCurrentLiabilities.toFixed(2)}`,
      '',
      `"TOTAL LIABILITIES",""${report.liabilities.totalLiabilities.toFixed(2)}`,
      '',
      'EQUITY',
      ...report.equity.accounts.map((a) => `"${a.accountCode}","${a.accountName.replace(/"/g, '""')}",${a.balance.toFixed(2)}`),
      `"CURRENT PERIOD NET PROFIT",""${report.equity.currentPeriodNetProfit.toFixed(2)}`,
      `"TOTAL EQUITY",""${report.equity.totalEquity.toFixed(2)}`,
      '',
      `"TOTAL LIABILITIES AND EQUITY",""${report.totalLiabilitiesAndEquity.toFixed(2)}`,
      `"BALANCE CHECK (MUST BE ZERO)",""${report.discrepancy.toFixed(2)}`,
    ];
    return lines.join('\n');
  }

  exportArAgingCsv(report: ArAgingReport): string {
    const headers = ['Customer Code', 'Customer Name', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '91-120 Days', '>120 Days', 'Total Outstanding'];
    const rows = report.customers.map((c) => [
      `"${c.customerCode}"`,
      `"${c.customerName.replace(/"/g, '""')}"`,
      c.current.toFixed(2),
      c.days1To30.toFixed(2),
      c.days31To60.toFixed(2),
      c.days61To90.toFixed(2),
      c.days91To120.toFixed(2),
      c.daysOver120.toFixed(2),
      c.totalOutstanding.toFixed(2),
    ]);
    rows.push([
      '"TOTAL"',
      '""',
      report.totalCurrent.toFixed(2),
      report.totalDays1To30.toFixed(2),
      report.totalDays31To60.toFixed(2),
      report.totalDays61To90.toFixed(2),
      report.totalDays91To120.toFixed(2),
      report.totalDaysOver120.toFixed(2),
      report.grandTotalOutstanding.toFixed(2),
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  exportApAgingCsv(report: ApAgingReport): string {
    const headers = ['Supplier Code', 'Supplier Name', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '91-120 Days', '>120 Days', 'Total Outstanding'];
    const rows = report.suppliers.map((s) => [
      `"${s.supplierCode}"`,
      `"${s.supplierName.replace(/"/g, '""')}"`,
      s.current.toFixed(2),
      s.days1To30.toFixed(2),
      s.days31To60.toFixed(2),
      s.days61To90.toFixed(2),
      s.days91To120.toFixed(2),
      s.daysOver120.toFixed(2),
      s.totalOutstanding.toFixed(2),
    ]);
    rows.push([
      '"TOTAL"',
      '""',
      report.totalCurrent.toFixed(2),
      report.totalDays1To30.toFixed(2),
      report.totalDays31To60.toFixed(2),
      report.totalDays61To90.toFixed(2),
      report.totalDays91To120.toFixed(2),
      report.totalDaysOver120.toFixed(2),
      report.grandTotalOutstanding.toFixed(2),
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
