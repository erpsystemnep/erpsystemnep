import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import {
  TrialBalanceReport,
  TrialBalanceItem,
  AccountType,
  SecurityContext,
} from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export interface TrialBalanceFilter {
  asOfDate?: string;
  startDate?: string;
  branchId?: string;
  accountType?: AccountType;
  includeZeroBalance?: boolean;
}

export class TrialBalanceService {
  /**
   * Generates authoritative Trial Balance report strictly from POSTED accounting journals.
   * Enforces multi-tenant isolation via SecurityContext.
   */
  async getTrialBalance(
    filter: TrialBalanceFilter = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<TrialBalanceReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required for Trial Balance');
    }

    const db = client || getPool();
    const asOfDate = filter.asOfDate || new Date().toISOString().split('T')[0];

    const conditions: string[] = [
      'coa.company_id = $1',
      'coa.is_active = TRUE',
    ];
    const params: any[] = [companyId, asOfDate];
    let idx = 3;

    if (filter.accountType) {
      conditions.push(`coa.account_type = $${idx++}`);
      params.push(filter.accountType);
    }

    // Secondary journal date filter if start date is provided
    let journalDateClause = 'aj.posting_date <= $2';
    if (filter.startDate) {
      journalDateClause += ` AND aj.posting_date >= $${idx++}`;
      params.push(filter.startDate);
    }

    // Branch filter if provided
    let journalBranchClause = '';
    if (filter.branchId) {
      journalBranchClause = ` AND aj.branch_id = $${idx++}`;
      params.push(filter.branchId);
    }

    const whereClause = conditions.join(' AND ');

    const sql = `
      SELECT 
        coa.id as account_id,
        coa.account_code,
        coa.account_name,
        coa.account_type,
        coa.is_group,
        COALESCE(SUM(ajl.base_debit), 0) as debit_total,
        COALESCE(SUM(ajl.base_credit), 0) as credit_total
      FROM chart_of_accounts coa
      LEFT JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
      LEFT JOIN accounting_journals aj ON ajl.journal_id = aj.id 
        AND aj.status = 'POSTED'
        AND aj.company_id = $1
        AND ${journalDateClause}
        ${journalBranchClause}
      WHERE ${whereClause}
      GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.is_group
      ORDER BY coa.account_code ASC
    `;

    const res = await db.query(sql, params);

    let totalDebit = 0;
    let totalCredit = 0;
    let totalDebitBalance = 0;
    let totalCreditBalance = 0;

    const items: TrialBalanceItem[] = [];

    for (const row of res.rows) {
      const debitTotal = Math.round(parseFloat(row.debit_total || '0') * 10000) / 10000;
      const creditTotal = Math.round(parseFloat(row.credit_total || '0') * 10000) / 10000;

      const net = Math.round((debitTotal - creditTotal) * 10000) / 10000;
      const debitBalance = net > 0 ? net : 0;
      const creditBalance = net < 0 ? Math.abs(net) : 0;

      // Check if zero balances should be excluded
      if (
        filter.includeZeroBalance === false &&
        debitTotal === 0 &&
        creditTotal === 0 &&
        debitBalance === 0 &&
        creditBalance === 0
      ) {
        continue;
      }

      totalDebit = Math.round((totalDebit + debitTotal) * 10000) / 10000;
      totalCredit = Math.round((totalCredit + creditTotal) * 10000) / 10000;
      totalDebitBalance = Math.round((totalDebitBalance + debitBalance) * 10000) / 10000;
      totalCreditBalance = Math.round((totalCreditBalance + creditBalance) * 10000) / 10000;

      items.push({
        accountId: row.account_id,
        accountCode: row.account_code,
        accountName: row.account_name,
        accountType: row.account_type as AccountType,
        isGroup: Boolean(row.is_group),
        debitTotal,
        creditTotal,
        debitBalance,
        creditBalance,
      });
    }

    const isBalanced = Math.abs(totalDebitBalance - totalCreditBalance) < 0.0001;

    return {
      companyId,
      asOfDate,
      startDate: filter.startDate || null,
      branchId: filter.branchId || null,
      generatedAt: new Date().toISOString(),
      items,
      totalDebit,
      totalCredit,
      totalDebitBalance,
      totalCreditBalance,
      isBalanced,
    };
  }

  /**
   * Generates CSV format representation of the Trial Balance.
   */
  async exportToCsv(
    filter: TrialBalanceFilter = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<string> {
    const report = await this.getTrialBalance(filter, ctx, client);

    const headers = [
      'Account Code',
      'Account Name',
      'Type',
      'Debit Total',
      'Credit Total',
      'Debit Balance',
      'Credit Balance',
    ];

    const rows = report.items.map((item) => [
      `"${item.accountCode}"`,
      `"${item.accountName.replace(/"/g, '""')}"`,
      `"${item.accountType}"`,
      item.debitTotal.toFixed(2),
      item.creditTotal.toFixed(2),
      item.debitBalance.toFixed(2),
      item.creditBalance.toFixed(2),
    ]);

    // Summary line
    rows.push([
      '"TOTAL"',
      '""',
      '""',
      report.totalDebit.toFixed(2),
      report.totalCredit.toFixed(2),
      report.totalDebitBalance.toFixed(2),
      report.totalCreditBalance.toFixed(2),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
