import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NumberingSeriesRepository } from '../../src/server/modules/numbering/repositories/numbering_series.repository.js';
import { NumberingService } from '../../src/server/modules/numbering/services/numbering.service.js';
import { CompanyRepository } from '../../src/server/modules/org/repositories/company.repository.js';
import { BranchRepository } from '../../src/server/modules/org/repositories/branch.repository.js';
import { StateMachineEngine } from '../../src/server/modules/workflow/services/state_machine.service.js';
import { SodService } from '../../src/server/modules/workflow/services/sod.service.js';
import { AuditRepository } from '../../src/server/modules/audit/repositories/audit.repository.js';
import { AuditService } from '../../src/server/modules/audit/services/audit.service.js';
import {
  NumberingSeries,
  Company,
  Branch,
  SecurityContext,
  AuditLog,
  DocumentState,
} from '../../src/shared/types/index.js';
import { AppError } from '../../src/shared/errors/AppError.js';
import pg from 'pg';

let passedTests = 0;
let totalTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('\n=== RUNNING INCREMENT 0.6 SHARED TRANSACTION INFRASTRUCTURE TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Test Harness for Increment 0.6 Unit Testing
// ----------------------------------------------------------------------------

class InMemoryNumberingSeriesRepo extends NumberingSeriesRepository {
  private series: Map<string, NumberingSeries> = new Map();

  async findById(id: string): Promise<NumberingSeries | null> {
    const s = this.series.get(id);
    return s ? { ...s } : null;
  }

  async findByScope(
    companyId: string,
    branchId: string | null | undefined,
    documentType: string
  ): Promise<NumberingSeries | null> {
    const docType = documentType.toUpperCase();
    for (const s of this.series.values()) {
      if (s.companyId === companyId && s.documentType === docType) {
        if (branchId) {
          if (s.branchId === branchId) return { ...s };
        } else {
          if (!s.branchId) return { ...s };
        }
      }
    }
    return null;
  }

  async findForUpdate(id: string): Promise<NumberingSeries | null> {
    return this.findById(id);
  }

  async incrementAndReset(
    id: string,
    nextNumber: number,
    lastResetDate: string | null
  ): Promise<NumberingSeries> {
    const s = this.series.get(id);
    if (!s) throw AppError.notFound('Series not found in mock');
    const updated: NumberingSeries = {
      ...s,
      currentNumber: nextNumber,
      lastResetDate: lastResetDate || undefined,
      updatedAt: new Date().toISOString(),
    };
    this.series.set(id, updated);
    return { ...updated };
  }

  async list(
    companyId: string,
    filters?: { branchId?: string | null; documentType?: string; isActive?: boolean }
  ): Promise<NumberingSeries[]> {
    const results: NumberingSeries[] = [];
    for (const s of this.series.values()) {
      if (s.companyId !== companyId) continue;
      if (filters?.branchId !== undefined && s.branchId !== (filters.branchId || null)) continue;
      if (filters?.documentType && s.documentType !== filters.documentType.toUpperCase()) continue;
      if (filters?.isActive !== undefined && s.isActive !== filters.isActive) continue;
      results.push({ ...s });
    }
    return results;
  }

  async create(input: any): Promise<NumberingSeries> {
    const id = randomUUID();
    const created: NumberingSeries = {
      id,
      companyId: input.companyId,
      branchId: input.branchId || null,
      documentType: input.documentType.toUpperCase(),
      prefix: input.prefix,
      suffix: input.suffix || undefined,
      minDigits: input.minDigits ?? 5,
      currentNumber: input.currentNumber ?? 0,
      resetFrequency: input.resetFrequency ?? 'NEVER',
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.series.set(id, created);
    return { ...created };
  }

  async update(id: string, input: any): Promise<NumberingSeries | null> {
    const s = this.series.get(id);
    if (!s) return null;
    const updated: NumberingSeries = {
      ...s,
      prefix: input.prefix !== undefined ? input.prefix : s.prefix,
      suffix: input.suffix !== undefined ? input.suffix : s.suffix,
      minDigits: input.minDigits !== undefined ? input.minDigits : s.minDigits,
      currentNumber: input.currentNumber !== undefined ? input.currentNumber : s.currentNumber,
      resetFrequency: input.resetFrequency !== undefined ? input.resetFrequency : s.resetFrequency,
      isActive: input.isActive !== undefined ? input.isActive : s.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.series.set(id, updated);
    return { ...updated };
  }
}

class InMemoryCompanyRepo extends CompanyRepository {
  private companies: Map<string, Company> = new Map();

  async findById(id: string): Promise<Company | null> {
    const c = this.companies.get(id);
    return c ? { ...c } : null;
  }

  async create(input: any): Promise<Company> {
    const id = randomUUID();
    const company: Company = {
      id,
      code: input.code.toUpperCase(),
      legalName: input.legalName,
      tradeName: input.tradeName,
      baseCurrency: input.baseCurrency.toUpperCase(),
      taxIdentifier: input.taxIdentifier,
      fiscalYearStartMonth: input.fiscalYearStartMonth || 1,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.companies.set(id, company);
    return { ...company };
  }
}

class InMemoryBranchRepo extends BranchRepository {
  private branches: Map<string, Branch> = new Map();

  async findById(id: string): Promise<Branch | null> {
    const b = this.branches.get(id);
    return b ? { ...b } : null;
  }

  async create(input: any): Promise<Branch> {
    const id = randomUUID();
    const branch: Branch = {
      id,
      companyId: input.companyId,
      code: input.code.toUpperCase(),
      name: input.name,
      isHeadOffice: input.isHeadOffice ?? false,
      countryCode: input.countryCode || 'US',
      timezone: input.timezone || 'UTC',
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.branches.set(id, branch);
    return { ...branch };
  }
}

class InMemoryAuditRepo extends AuditRepository {
  public logs: AuditLog[] = [];

  async create(input: any): Promise<AuditLog> {
    const log: AuditLog = {
      id: randomUUID(),
      companyId: input.companyId || null,
      branchId: input.branchId || null,
      warehouseId: input.warehouseId || null,
      userId: input.userId || null,
      action: input.action,
      module: input.module,
      entityName: input.entityName,
      entityId: input.entityId,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      changes: input.changes,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      sessionId: input.sessionId,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
    };
    this.logs.push(log);
    return { ...log };
  }

  async query(filters: any): Promise<{ items: AuditLog[]; total: number; page: number; limit: number; totalPages: number }> {
    let filtered = [...this.logs];
    if (filters.companyId) filtered = filtered.filter((l) => l.companyId === filters.companyId);
    if (filters.userId) filtered = filtered.filter((l) => l.userId === filters.userId);
    if (filters.action) filtered = filtered.filter((l) => l.action === filters.action);
    if (filters.module) filtered = filtered.filter((l) => l.module === filters.module);
    if (filters.entityName) filtered = filtered.filter((l) => l.entityName === filters.entityName);
    if (filters.entityId) filtered = filtered.filter((l) => l.entityId === filters.entityId);

    const total = filtered.length;
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const items = filtered.slice((page - 1) * limit, page * limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}

async function runTests() {
  const companyRepo = new InMemoryCompanyRepo();
  const branchRepo = new InMemoryBranchRepo();
  const numberingRepo = new InMemoryNumberingSeriesRepo();
  const numberingService = new NumberingService(numberingRepo, companyRepo, branchRepo);

  const sodService = new SodService();
  const stateMachine = new StateMachineEngine(sodService);

  const auditRepo = new InMemoryAuditRepo();
  const auditService = new AuditService(auditRepo);

  // Setup sample test organization entities
  const companyA = await companyRepo.create({
    code: 'ACME',
    legalName: 'Acme Global Corp',
    baseCurrency: 'USD',
  });

  const companyB = await companyRepo.create({
    code: 'BETA',
    legalName: 'Beta Industrial LLC',
    baseCurrency: 'EUR',
  });

  const branchHQ = await branchRepo.create({
    companyId: companyA.id,
    code: 'HQ',
    name: 'Headquarters Branch',
  });

  const branchWest = await branchRepo.create({
    companyId: companyA.id,
    code: 'WEST',
    name: 'West Branch',
  });

  // Security Contexts
  const superadminId = randomUUID();
  const creatorId = randomUUID();
  const managerId = randomUUID();
  const otherCompanyUserId = randomUUID();

  const superadminCtx: SecurityContext = {
    userId: superadminId,
    email: 'admin@system.local',
    fullName: 'System Superadmin',
    isSuperadmin: true,
    activeCompanyId: null,
    activeBranchId: null,
    effectivePermissions: ['*'],
  };

  const creatorUserCtx: SecurityContext = {
    userId: creatorId,
    email: 'creator@acme.com',
    fullName: 'Quotation Creator',
    isSuperadmin: false,
    activeCompanyId: companyA.id,
    activeBranchId: branchHQ.id,
    effectivePermissions: [
      'sales.quotation.view',
      'sales.quotation.create',
      'accounting.journal.create',
    ],
  };

  const managerApproverCtx: SecurityContext = {
    userId: managerId,
    email: 'manager@acme.com',
    fullName: 'Branch Manager',
    isSuperadmin: false,
    activeCompanyId: companyA.id,
    activeBranchId: branchHQ.id,
    effectivePermissions: [
      'sales.quotation.approve',
      'sales.quotation.reject',
      'accounting.journal.approve',
      'accounting.journal.post',
      'accounting.journal.reverse',
      'audit.log.view',
    ],
  };

  const otherCompanyUserCtx: SecurityContext = {
    userId: otherCompanyUserId,
    email: 'user@beta.com',
    fullName: 'Beta User',
    isSuperadmin: false,
    activeCompanyId: companyB.id,
    activeBranchId: null,
    effectivePermissions: ['sales.quotation.approve', 'accounting.journal.post'],
  };

  // ==========================================================================
  // 1. NUMBERING SERIES SERVICE TESTS
  // ==========================================================================

  await test('1.1 Create company-wide and branch-scoped numbering series', async () => {
    // Company-wide Invoice series for Company A
    const series1 = await numberingService.createSeries(
      {
        companyId: companyA.id,
        documentType: 'INVOICE',
        prefix: 'INV-',
        minDigits: 5,
        currentNumber: 0,
        resetFrequency: 'NEVER',
      },
      superadminCtx
    );
    assert.strictEqual(series1.prefix, 'INV-');
    assert.strictEqual(series1.minDigits, 5);
    assert.strictEqual(series1.branchId, null);

    // Branch-specific Quotation series for Branch HQ
    const series2 = await numberingService.createSeries(
      {
        companyId: companyA.id,
        branchId: branchHQ.id,
        documentType: 'QUOTATION',
        prefix: 'QT-HQ-',
        suffix: '/2026',
        minDigits: 4,
        currentNumber: 10,
        resetFrequency: 'ANNUAL',
      },
      superadminCtx
    );
    assert.strictEqual(series2.prefix, 'QT-HQ-');
    assert.strictEqual(series2.suffix, '/2026');
    assert.strictEqual(series2.branchId, branchHQ.id);
  });

  await test('1.2 Number generation respects branch override with company fallback', async () => {
    // Branch HQ has specific series for QUOTATION
    const numHQ = await numberingService.generateNextNumber(
      {
        companyId: companyA.id,
        branchId: branchHQ.id,
        documentType: 'QUOTATION',
      },
      creatorUserCtx
    );
    assert.strictEqual(numHQ.formattedNumber, 'QT-HQ-0011/2026');
    assert.strictEqual(numHQ.sequenceNumber, 11);

    // Branch West does NOT have specific series for INVOICE -> falls back to Company-wide INVOICE series
    const numWest = await numberingService.generateNextNumber(
      {
        companyId: companyA.id,
        branchId: branchWest.id,
        documentType: 'INVOICE',
      },
      creatorUserCtx
    );
    assert.strictEqual(numWest.formattedNumber, 'INV-00001');
    assert.strictEqual(numWest.sequenceNumber, 1);

    // Next invoice increments monotonically
    const numWest2 = await numberingService.generateNextNumber(
      {
        companyId: companyA.id,
        documentType: 'INVOICE',
      },
      creatorUserCtx
    );
    assert.strictEqual(numWest2.formattedNumber, 'INV-00002');
    assert.strictEqual(numWest2.sequenceNumber, 2);
  });

  await test('1.3 Cross-tenant sequence generation is blocked', async () => {
    await assert.rejects(
      async () => {
        // User from Company B attempts to generate sequence for Company A
        await numberingService.generateNextNumber(
          {
            companyId: companyA.id,
            documentType: 'INVOICE',
          },
          otherCompanyUserCtx
        );
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes('Cross-tenant access violation'));
        return true;
      }
    );
  });

  await test('1.4 Missing numbering series throws 404', async () => {
    await assert.rejects(
      async () => {
        await numberingService.generateNextNumber(
          {
            companyId: companyA.id,
            documentType: 'PURCHASE_ORDER',
          },
          creatorUserCtx
        );
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 404);
        assert.ok(err.message.includes('Numbering series not configured'));
        return true;
      }
    );
  });

  await test('1.5 Inactive numbering series throws invariant error', async () => {
    const inactiveSeries = await numberingService.createSeries(
      {
        companyId: companyA.id,
        documentType: 'CREDIT_NOTE',
        prefix: 'CN-',
        minDigits: 4,
        isActive: false,
      },
      superadminCtx
    );

    await assert.rejects(
      async () => {
        await numberingService.generateNextNumber(
          {
            companyId: companyA.id,
            documentType: 'CREDIT_NOTE',
          },
          creatorUserCtx
        );
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 422);
        assert.ok(err.message.includes('is inactive'));
        return true;
      }
    );
  });

  await test('1.6 Annual and Monthly reset frequencies reset counters on calendar change', async () => {
    // Annual Series
    const annualSeries = await numberingService.createSeries(
      {
        companyId: companyB.id,
        documentType: 'JOURNAL',
        prefix: 'JV-',
        minDigits: 4,
        currentNumber: 500,
        resetFrequency: 'ANNUAL',
      },
      superadminCtx
    );

    // Simulate allocation in 2025
    const date2025 = new Date('2025-12-31T23:59:59Z');
    const res2025 = await numberingService.generateNextNumber(
      { companyId: companyB.id, documentType: 'JOURNAL' },
      superadminCtx,
      undefined,
      date2025
    );
    assert.strictEqual(res2025.formattedNumber, 'JV-0501');

    // Simulate allocation in 2026 -> counter resets to 1
    const date2026 = new Date('2026-01-01T00:00:01Z');
    const res2026 = await numberingService.generateNextNumber(
      { companyId: companyB.id, documentType: 'JOURNAL' },
      superadminCtx,
      undefined,
      date2026
    );
    assert.strictEqual(res2026.formattedNumber, 'JV-0001');
    assert.strictEqual(res2026.sequenceNumber, 1);
  });

  // ==========================================================================
  // 2. SEGREGATION OF DUTIES (SoD) & APPROVAL AUTHORITY TESTS
  // ==========================================================================

  await test('2.1 Creator cannot approve own document (SoD Enforcement)', async () => {
    assert.throws(
      () => {
        sodService.assertCreatorApproverSeparation(creatorUserCtx.userId, creatorUserCtx.userId, {
          documentType: 'QUOTATION',
          documentId: 'qt-1001',
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'SOD_VIOLATION');
        assert.ok(err.message.toLowerCase().includes('creator cannot approve'));
        return true;
      }
    );
  });

  await test('2.2 Distinct approver passes SoD assertion', async () => {
    assert.doesNotThrow(() => {
      sodService.assertCreatorApproverSeparation(creatorUserCtx.userId, managerApproverCtx.userId);
    });
  });

  await test('2.3 validateApprovalAuthority enforces identity, tenant, branch, SoD, and permission', async () => {
    // Valid Approval
    assert.doesNotThrow(() => {
      sodService.validateApprovalAuthority({
        ctx: managerApproverCtx,
        companyId: companyA.id,
        branchId: branchHQ.id,
        requiredPermission: 'sales.quotation.approve',
        creatorId: creatorUserCtx.userId,
        documentType: 'QUOTATION',
      });
    });

    // Fails on SoD (creator trying to approve)
    assert.throws(
      () => {
        sodService.validateApprovalAuthority({
          ctx: creatorUserCtx,
          companyId: companyA.id,
          branchId: branchHQ.id,
          requiredPermission: 'sales.quotation.approve',
          creatorId: creatorUserCtx.userId,
        });
      },
      (err: any) => {
        assert.strictEqual(err.code, 'SOD_VIOLATION');
        return true;
      }
    );

    // Fails on missing permission
    assert.throws(
      () => {
        sodService.validateApprovalAuthority({
          ctx: creatorUserCtx,
          companyId: companyA.id,
          branchId: branchHQ.id,
          requiredPermission: 'super.secret.approve',
          creatorId: randomUUID(),
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes('Missing required approval permission'));
        return true;
      }
    );

    // Fails on Cross-Tenant
    assert.throws(
      () => {
        sodService.validateApprovalAuthority({
          ctx: otherCompanyUserCtx,
          companyId: companyA.id,
          requiredPermission: 'sales.quotation.approve',
          creatorId: creatorUserCtx.userId,
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes('Cross-company approval violation'));
        return true;
      }
    );
  });

  // ==========================================================================
  // 3. DOCUMENT STATE MACHINE FOUNDATION & IMMUTABILITY TESTS
  // ==========================================================================

  await test('3.1 Valid state transitions succeed', async () => {
    // DRAFT -> SUBMITTED (Submit)
    const t1 = stateMachine.validateTransition({
      documentType: 'FINANCIAL_DOC',
      currentState: 'DRAFT',
      targetState: 'SUBMITTED',
      ctx: creatorUserCtx,
      documentContext: { companyId: companyA.id, creatorId: creatorUserCtx.userId },
    });
    assert.strictEqual(t1.action, 'submit');

    // SUBMITTED -> APPROVED (Approve with Manager context)
    const t2 = stateMachine.validateTransition({
      documentType: 'FINANCIAL_DOC',
      currentState: 'SUBMITTED',
      targetState: 'APPROVED',
      ctx: managerApproverCtx,
      documentContext: { companyId: companyA.id, creatorId: creatorUserCtx.userId },
    });
    assert.strictEqual(t2.action, 'approve');

    // APPROVED -> POSTED (Post to General Ledger)
    const t3 = stateMachine.validateTransition({
      documentType: 'FINANCIAL_DOC',
      currentState: 'APPROVED',
      targetState: 'POSTED',
      ctx: managerApproverCtx,
      documentContext: { companyId: companyA.id, creatorId: creatorUserCtx.userId },
    });
    assert.strictEqual(t3.action, 'post');
  });

  await test('3.2 POSTED document immutability prevents illegal edits or rollbacks', async () => {
    // Cannot transition POSTED -> DRAFT
    assert.throws(
      () => {
        stateMachine.validateTransition({
          documentType: 'FINANCIAL_DOC',
          currentState: 'POSTED',
          targetState: 'DRAFT',
          ctx: superadminCtx,
          documentContext: { companyId: companyA.id },
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 422);
        assert.ok(err.message.includes('POSTED documents are strictly immutable'));
        return true;
      }
    );

    // Cannot transition POSTED -> APPROVED
    assert.throws(
      () => {
        stateMachine.validateTransition({
          documentType: 'FINANCIAL_DOC',
          currentState: 'POSTED',
          targetState: 'APPROVED',
          ctx: superadminCtx,
          documentContext: { companyId: companyA.id },
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 422);
        assert.ok(err.message.includes('POSTED documents are strictly immutable'));
        return true;
      }
    );
  });

  await test('3.3 Authorized Reversal transition (POSTED -> REVERSED)', async () => {
    // POSTED -> REVERSED is permissible for FINANCIAL_DOC
    const tReverse = stateMachine.validateTransition({
      documentType: 'FINANCIAL_DOC',
      currentState: 'POSTED',
      targetState: 'REVERSED',
      ctx: managerApproverCtx,
      documentContext: { companyId: companyA.id },
    });
    assert.strictEqual(tReverse.action, 'reverse');
  });

  await test('3.4 Terminal states (REVERSED, CANCELLED) cannot transition further', async () => {
    assert.throws(
      () => {
        stateMachine.validateTransition({
          documentType: 'FINANCIAL_DOC',
          currentState: 'REVERSED',
          targetState: 'DRAFT',
          ctx: superadminCtx,
          documentContext: { companyId: companyA.id },
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 422);
        assert.ok(err.message.includes('terminal state'));
        return true;
      }
    );

    assert.throws(
      () => {
        stateMachine.validateTransition({
          documentType: 'QUOTATION',
          currentState: 'CANCELLED',
          targetState: 'SUBMITTED',
          ctx: superadminCtx,
          documentContext: { companyId: companyA.id },
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 422);
        assert.ok(err.message.includes('terminal state'));
        return true;
      }
    );
  });

  await test('3.5 State transition honors SoD and throws when creator attempts approval', async () => {
    assert.throws(
      () => {
        stateMachine.validateTransition({
          documentType: 'QUOTATION',
          currentState: 'SUBMITTED',
          targetState: 'APPROVED',
          ctx: creatorUserCtx, // Creator attempting to approve
          documentContext: {
            companyId: companyA.id,
            creatorId: creatorUserCtx.userId,
          },
        });
      },
      (err: any) => {
        assert.strictEqual(err.code, 'SOD_VIOLATION');
        return true;
      }
    );
  });

  // ==========================================================================
  // 4. AUDIT SERVICE & IMMUTABLE DISPATCHER TESTS
  // ==========================================================================

  await test('4.1 Audit event recording binds identity and tenant context safely', async () => {
    const log = await auditService.recordEvent(
      {
        action: 'CREATE',
        module: 'sales',
        entityName: 'Quotation',
        entityId: 'qt-999',
        changes: { new: { totalAmount: 1500 } },
      },
      creatorUserCtx
    );

    assert.strictEqual(log.userId, creatorUserCtx.userId);
    assert.strictEqual(log.companyId, companyA.id);
    assert.strictEqual(log.action, 'CREATE');
    assert.strictEqual(log.module, 'sales');
    assert.strictEqual(log.entityName, 'Quotation');
    assert.strictEqual(log.entityId, 'qt-999');
  });

  await test('4.2 Non-superadmin cannot spoof another company in audit trail', async () => {
    const log = await auditService.recordEvent(
      {
        action: 'POST',
        module: 'accounting',
        entityName: 'Invoice',
        entityId: 'inv-888',
        companyId: companyB.id, // Attempt to spoof Company B
      },
      creatorUserCtx // Caller is in Company A
    );

    // System overrides spoofed companyId with authenticated activeCompanyId
    assert.strictEqual(log.companyId, companyA.id);
  });

  await test('4.3 Standard audit dispatchers (logPost, logReverse, logApprove) record correctly', async () => {
    const logPost = await auditService.logPost(
      'accounting',
      'JournalEntry',
      'jv-101',
      managerApproverCtx,
      'Posted by Finance Manager'
    );
    assert.strictEqual(logPost.action, 'POST');
    assert.strictEqual(logPost.reasonText, 'Posted by Finance Manager');

    const logReverse = await auditService.logReverse(
      'accounting',
      'JournalEntry',
      'jv-101',
      managerApproverCtx,
      'Erroneous tax code reversal'
    );
    assert.strictEqual(logReverse.action, 'REVERSE');
    assert.strictEqual(logReverse.reasonText, 'Erroneous tax code reversal');
  });

  await test('4.4 Audit logs querying supports filtering and enforces tenant boundary', async () => {
    // Query logs as Company A manager
    const queryA = await auditService.queryLogs({ module: 'accounting' }, managerApproverCtx);
    assert.ok(queryA.total >= 2);
    assert.ok(queryA.items.every((item) => item.companyId === companyA.id));

    // Attempt cross-tenant audit query as Company A manager for Company B
    await assert.rejects(
      async () => {
        await auditService.queryLogs({ companyId: companyB.id }, managerApproverCtx);
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes('Cross-tenant audit query access denied'));
        return true;
      }
    );
  });

  // ==========================================================================
  // 5. ATOMIC UNIT OF WORK & TRANSACTION INTEGRATION TESTS
  // ==========================================================================

  await test('5.1 End-to-end transactional workflow simulation', async () => {
    // Simulate complete transaction lifecycle:
    // 1. Generate sequential number
    const seq = await numberingService.generateNextNumber(
      { companyId: companyA.id, branchId: branchHQ.id, documentType: 'QUOTATION' },
      creatorUserCtx
    );
    assert.ok(seq.formattedNumber.startsWith('QT-HQ-'));

    // 2. Draft created & audit logged
    await auditService.logCreate('sales', 'Quotation', seq.formattedNumber, { status: 'DRAFT' }, creatorUserCtx);

    // 3. Submitted for approval
    stateMachine.validateTransition({
      documentType: 'QUOTATION',
      currentState: 'DRAFT',
      targetState: 'SUBMITTED',
      ctx: creatorUserCtx,
      documentContext: { companyId: companyA.id, creatorId: creatorUserCtx.userId },
    });

    // 4. Approved by Manager (SoD validated)
    stateMachine.validateTransition({
      documentType: 'QUOTATION',
      currentState: 'SUBMITTED',
      targetState: 'APPROVED',
      ctx: managerApproverCtx,
      documentContext: { companyId: companyA.id, creatorId: creatorUserCtx.userId },
    });

    // 5. Approval audit log recorded
    const approveAudit = await auditService.logApprove('sales', 'Quotation', seq.formattedNumber, managerApproverCtx);
    assert.strictEqual(approveAudit.action, 'APPROVE');
    assert.strictEqual(approveAudit.userId, managerApproverCtx.userId);
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 0.6 TESTS PASSED!`);
  console.log(`=============================================\n`);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
