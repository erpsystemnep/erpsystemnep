import pg from 'pg';
import { getPool } from '../../../db/connection.js';
import { TaxTransactionRepository, ListTaxTransactionsFilter } from '../repositories/tax_transaction.repository.js';
import { ChartOfAccountsRepository } from '../repositories/chart_of_accounts.repository.js';
import {
  TaxTransaction,
  TaxSummaryReport,
  TaxReconciliationReport,
  SecurityContext,
} from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class TaxService {
  constructor(
    private taxRepo: TaxTransactionRepository = new TaxTransactionRepository(),
    private coaRepo: ChartOfAccountsRepository = new ChartOfAccountsRepository()
  ) {}

  async listTransactions(
    filters: ListTaxTransactionsFilter,
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<{ items: TaxTransaction[]; total: number }> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required');
    }
    return this.taxRepo.list(companyId, filters, client);
  }

  async getSummary(
    filters: { fromDate?: string; toDate?: string } = {},
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<TaxSummaryReport> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required');
    }
    const summary = await this.taxRepo.getSummary(companyId, filters, client);
    return {
      ...summary,
      generatedAt: new Date().toISOString(),
      asOfDate: filters.toDate || null,
    };
  }

  async getReconciliation(
    asOfDate?: string,
    ctx?: SecurityContext,
    client?: pg.PoolClient
  ): Promise<TaxReconciliationReport> {
    const companyId = ctx?.activeCompanyId;
    if (!companyId) {
      throw AppError.badRequest('Active company context is required for tax reconciliation');
    }

    const db = client || getPool();
    const effectiveDate = asOfDate || new Date().toISOString().split('T')[0];

    // 1. Get Subledger Totals (Authoritative Tax Subledger)
    const subledgerSql = `
      SELECT 
        tax_type,
        COALESCE(SUM(base_tax_amount), 0) as total_tax
      FROM tax_transactions
      WHERE company_id = $1 
        AND status = 'POSTED'
        AND accounting_date <= $2
      GROUP BY tax_type
    `;
    const subledgerRes = await db.query(subledgerSql, [companyId, effectiveDate]);

    let outputTaxSubledgerTotal = 0;
    let inputTaxSubledgerTotal = 0;

    for (const r of subledgerRes.rows) {
      if (r.tax_type === 'OUTPUT_TAX') {
        outputTaxSubledgerTotal = Math.round(parseFloat(r.total_tax) * 10000) / 10000;
      } else if (r.tax_type === 'INPUT_TAX') {
        inputTaxSubledgerTotal = Math.round(parseFloat(r.total_tax) * 10000) / 10000;
      }
    }

    // 2. Get General Ledger Balances for Output Tax Payable (Liability: Net Credits = Credits - Debits)
    const outputTaxGlSql = `
      SELECT 
        COALESCE(SUM(ajl.base_credit), 0) as gl_credit,
        COALESCE(SUM(ajl.base_debit), 0) as gl_debit
      FROM chart_of_accounts coa
      JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
      JOIN accounting_journals aj ON ajl.journal_id = aj.id
      WHERE coa.company_id = $1
        AND aj.company_id = $1
        AND aj.status = 'POSTED'
        AND aj.posting_date <= $2
        AND (
          coa.account_code = '2200' 
          OR coa.account_name ILIKE '%OUTPUT TAX%'
          OR coa.account_name ILIKE '%TAX PAYABLE%'
          OR coa.account_name ILIKE '%VAT PAYABLE%'
        )
    `;
    const outputGlRes = await db.query(outputTaxGlSql, [companyId, effectiveDate]);
    const outCredit = parseFloat(outputGlRes.rows[0]?.gl_credit || '0');
    const outDebit = parseFloat(outputGlRes.rows[0]?.gl_debit || '0');
    const outputTaxGlTotal = Math.round((outCredit - outDebit) * 10000) / 10000;

    // 3. Get General Ledger Balances for Input Tax Receivable (Asset: Net Debits = Debits - Credits)
    const inputTaxGlSql = `
      SELECT 
        COALESCE(SUM(ajl.base_debit), 0) as gl_debit,
        COALESCE(SUM(ajl.base_credit), 0) as gl_credit
      FROM chart_of_accounts coa
      JOIN accounting_journal_lines ajl ON coa.id = ajl.account_id
      JOIN accounting_journals aj ON ajl.journal_id = aj.id
      WHERE coa.company_id = $1
        AND aj.company_id = $1
        AND aj.status = 'POSTED'
        AND aj.posting_date <= $2
        AND (
          coa.account_code = '1150'
          OR coa.account_name ILIKE '%INPUT TAX%'
          OR coa.account_name ILIKE '%TAX RECEIVABLE%'
          OR coa.account_name ILIKE '%VAT RECEIVABLE%'
        )
    `;
    const inputGlRes = await db.query(inputTaxGlSql, [companyId, effectiveDate]);
    const inDebit = parseFloat(inputGlRes.rows[0]?.gl_debit || '0');
    const inCredit = parseFloat(inputGlRes.rows[0]?.gl_credit || '0');
    const inputTaxGlTotal = Math.round((inDebit - inCredit) * 10000) / 10000;

    // 4. Calculate Discrepancies and Reconciled Flags
    const outputTaxDiscrepancy = Math.round(Math.abs(outputTaxSubledgerTotal - outputTaxGlTotal) * 10000) / 10000;
    const isOutputTaxReconciled = outputTaxDiscrepancy < 0.0001;

    const inputTaxDiscrepancy = Math.round(Math.abs(inputTaxSubledgerTotal - inputTaxGlTotal) * 10000) / 10000;
    const isInputTaxReconciled = inputTaxDiscrepancy < 0.0001;

    const netTaxPosition = Math.round((outputTaxSubledgerTotal - inputTaxSubledgerTotal) * 10000) / 10000;
    const isFullyReconciled = isOutputTaxReconciled && isInputTaxReconciled;

    return {
      companyId,
      asOfDate: effectiveDate,
      generatedAt: new Date().toISOString(),
      outputTaxSubledgerTotal,
      outputTaxGlTotal,
      outputTaxDiscrepancy,
      isOutputTaxReconciled,
      inputTaxSubledgerTotal,
      inputTaxGlTotal,
      inputTaxDiscrepancy,
      isInputTaxReconciled,
      netTaxPosition,
      isFullyReconciled,
    };
  }
}
