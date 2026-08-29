# Accounting Rules & Financial Subsystem Blueprint

**Status**: Active / Foundational Blueprint  
**Standard**: Double-entry bookkeeping with strict subledger-to-general-ledger reconciliation

---

## 1. Core General Ledger Principles

1. **Double-Entry Mandate**:
   - Every financial event is recorded as a Journal Entry containing at least one Debit and at least one Credit.
   - For every entry: $\sum \text{Debits} = \sum \text{Credits}$ within the company's base currency.
2. **Subledger Decoupling**:
   - Accounts Receivable (AR), Accounts Payable (AP), Inventory Valuation, and Fixed Assets operate as subledgers.
   - Control Accounts in the General Ledger (e.g., *Trade Receivables Control*, *Inventory Clearing*) can only be mutated via system postings from their corresponding subledger documents to prevent manual discrepancies.
3. **Period Locking**:
   - Fiscal periods have statuses: `FUTURE`, `OPEN`, `CLOSING_IN_PROGRESS`, `CLOSED`.
   - Backdating into a `CLOSED` period is strictly prohibited by server-side constraints.

---

## 2. Standard Transaction Posting Patterns (To Be Activated in Phase 6)

### A. Procurement & Goods Receipt (GRN)
1. **Goods Receipt Note Posted**:
   - `Debit`: Inventory / Stock in Hand (Asset)
   - `Credit`: Goods Received Not Invoiced / GRIR Clearing (Liability)
2. **Vendor Bill Matched & Posted**:
   - `Debit`: GRIR Clearing (Liability)
   - `Debit`: Input Tax / VAT Recoverable (Asset)
   - `Credit`: Accounts Payable / Trade Creditors (Liability)

### B. Sales Order & Fulfillment
1. **Delivery Note Posted (Goods Dispatched)**:
   - `Debit`: Cost of Goods Sold (COGS - Expense)
   - `Credit`: Inventory / Stock in Hand (Asset)
2. **Sales Invoice Posted**:
   - `Debit`: Accounts Receivable (Asset)
   - `Credit`: Sales Revenue (Income)
   - `Credit`: Output Tax / VAT Payable (Liability)

---

## 3. Currency & Multi-Currency Handling

- Each company specifies a single immutable `base_currency` (ISO 4217, e.g., `USD`, `EUR`, `GBP`, `SGD`).
- Multi-currency transactions record:
  1. `transaction_currency` (e.g., `EUR`).
  2. `exchange_rate` (e.g., `1.0850`).
  3. `amount_foreign_currency`.
  4. `amount_base_currency` (calculated and stored at time of posting).
- Realized and Unrealized Foreign Exchange (FX) Gains/Losses are calculated during settlement and period-end revaluation.
