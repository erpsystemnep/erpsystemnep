# ERP Automated Testing & Quality Assurance Plan

**Status**: Active / Foundational Blueprint  
**Coverage Standard**: Unit tests for all business services, integration tests for multi-tenant repositories and transactions

---

## 1. Testing Pyramid Strategy

```
               ┌───────────────────────┐
               │    E2E & UI Flow      │  (10% - Critical user paths)
               │      (Playwright)     │
               ├───────────────────────┤
               │   Integration / API   │  (30% - API routes, Auth,
               │  (Supertest / PG DB)  │   Transactions & Tenant isolation)
               ├───────────────────────┤
               │     Unit / Domain     │  (60% - Business services, state
               │    (Vitest / Jest)    │   machines, tax & accounting math)
               └───────────────────────┘
```

---

## 2. Test Suites & Verification Mandates

### A. Domain Service Unit Tests
- Must test all validation rules in isolation without hitting a real database.
- Mock repositories using strongly typed interfaces.
- Test edge cases: negative amounts, zero line items, invalid state transitions, currency decimal overflow.

### B. Multi-Tenant Scoping Integration Tests
- **Crucial Security Test**: Querying resources with User A (assigned only to Company 1) must never return records belonging to Company 2, even when attempting ID manipulation in route parameters.
- Verify that `branch_id` filtering strictly limits records when the user does not possess company-wide visibility.

### C. Database Transaction Rollback Tests
- Verify that if a step fails during a multi-record mutation (e.g., Stock Ledger insert succeeds but GL Post fails), the entire transaction rolls back cleanly with zero orphan records.

### D. Audit Trail Verification Tests
- Ensure that every create, update, delete, and post mutation automatically creates a corresponding row in `audit_logs` capturing user context, timestamp, and diff payload.
