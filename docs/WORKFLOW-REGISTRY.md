# Document & Transaction Workflow Registry

**Status**: Active / Foundational Blueprint  
**Purpose**: Standardized State Machine Specifications for All ERP Documents

---

## 1. Unified Document Lifecycle State Machine

All transactional documents across all future modules (Purchase Orders, Sales Orders, Stock Transfers, Invoices, Manufacturing Orders) must adhere to a standardized state lifecycle:

```
                  ┌──────────────────────┐
                  │        DRAFT         │ <── (Initial Creation & Editing)
                  └──────────┬───────────┘
                             │
                             │ submit_for_approval()
                             ▼
                  ┌──────────────────────┐
         ┌─────── │  PENDING_APPROVAL    │ ◄──── (Optional Multi-Level Approval)
         │        └──────────┬───────────┘
         │                   │
reject() │                   │ approve()
         │                   ▼
         │        ┌──────────────────────┐
         └──────> │       APPROVED       │
                  └──────────┬───────────┘
                             │
                             │ post() / confirm()
                             ▼
                  ┌──────────────────────┐
                  │        POSTED        │ ◄──── [IMMUTABLE FINANCIAL/LEDGER IMPACT]
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            │ cancel() / reverse()            │ close() / complete()
            ▼                                 ▼
┌──────────────────────┐          ┌──────────────────────┐
│  REVERSED / VOIDED   │          │      COMPLETED       │
└──────────────────────┘          └──────────────────────┘
```

---

## 2. Standard State Definitions

| State Name | Allowed Modifications | Financial / Inventory Impact | Can Be Deleted? |
| :--- | :--- | :--- | :--- |
| **`DRAFT`** | Full edits to header, lines, pricing, and references | None | Yes (Soft/Hard delete if no references) |
| **`PENDING_APPROVAL`** | Locked against edits except by authorized approvers | None | No (Must reject back to DRAFT first) |
| **`APPROVED`** | Header notes only; lines/amounts are locked | None (Allocation/Reservation allowed) | No |
| **`POSTED`** | **ZERO edits allowed**. Read-only ledger document | Real-time GL & Inventory Ledger Impact | **STRICTLY FORBIDDEN** |
| **`COMPLETED`** | Read-only | Fulfilled / Closed | **STRICTLY FORBIDDEN** |
| **`REVERSED`** | Read-only | Offset by an explicit Reversal Journal Entry | **STRICTLY FORBIDDEN** |

---

## 3. Transaction Correction Protocol

- **Never Overwrite**: A posted transaction must never have its dollar amount, quantity, item code, or account code directly altered via an `UPDATE` statement.
- **Correction Mechanism**:
  1. Generate an explicit Correction Document (e.g., Credit Note, Debit Note, Inventory Adjustment, or Reversing GL Entry).
  2. Reference the `original_document_id` and reason code.
  3. Update the original document state to `REVERSED` or `ADJUSTED`.
