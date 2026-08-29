# Domain Business Rules & Invariant Register

**Status**: Active / Baseline Blueprint  
**Governance**: No unconfirmed domain rules are assumed. All business parameters are configurable per Company.

---

## 1. Multi-Company & Organizational Invariants

1. **Company Legal Sovereignty**:
   - Each company represents an independent legal entity with its own base currency, fiscal calendar, chart of accounts, and tax registrations.
   - Cross-company transactions must never occur via direct ledger mutation; they require explicit Inter-Company Sales & Purchase documents with balancing clearing accounts.
2. **Branch Operating Scope**:
   - Every branch belongs strictly to one company.
   - Operating documents (Sales Orders, POs) originate at a branch level.
3. **Warehouse Inventory Isolation**:
   - Stock quantities in Warehouse A cannot be credited or transferred to Warehouse B without a formal Stock Transfer Order (STO) with In-Transit status handling.

---

## 2. Unconfirmed Domain Rules (Configurable Policy Flags)

The following domain rules require explicit user/stakeholder confirmation before being hardcoded into future modules. They are represented as company-level configuration flags:

| Rule Category | Description | Candidate Options | Default Mode (Pending Confirmation) |
| :--- | :--- | :--- | :--- |
| **Inventory Valuation** | Method for calculating cost of goods sold and inventory value | `FIFO`, `WEIGHTED_AVERAGE`, `STANDARD_COST` | Configurable per Company / Item Category |
| **Negative Inventory** | Whether stock is allowed to go below zero on goods issue | `STRICT_DISALLOW`, `ALLOW_WITH_WARNING` | `STRICT_DISALLOW` (Safe accounting default) |
| **Tax Calculation** | Timing and rounding of tax lines | `LINE_LEVEL_ROUNDING`, `SUBTOTAL_ROUNDING` | Configurable per Tax Rule |
| **Revenue Recognition** | Trigger point for recognizing sales revenue | `ON_DELIVERY`, `ON_INVOICE`, `ON_PAYMENT` | Configurable per Company |
| **Document Numbering**| Sequence reset period | `NEVER`, `YEARLY`, `MONTHLY` | Configurable per Series Definition |

---

## 3. Data Integrity & Validation Invariants

1. **Header-to-Line Balance Consistency**:
   - For all transactional documents, `header.total_amount` must equal `SUM(lines.net_amount) + header.total_tax - header.discount_amount`.
2. **Double-Entry Balance Guarantee**:
   - In any journal or GL posting, `SUM(debit_amount) == SUM(credit_amount)` down to the base currency's decimal precision.
3. **Date Invariants**:
   - Transaction date cannot be prior to the company's closed fiscal period date.
   - Due date must be greater than or equal to invoice/document date.
