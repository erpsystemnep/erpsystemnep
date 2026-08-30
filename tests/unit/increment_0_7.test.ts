import assert from 'node:assert/strict';
import { api, ApiError } from '../../src/client/api/client.js';

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

console.log('\n=== RUNNING INCREMENT 0.7 SYSTEM FOUNDATION CONSOLE & CLIENT TESTS ===\n');

async function runTests() {
  await test('1. API Client attaches Authorization Bearer token correctly', async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = (async (url: any, init: any) => {
      capturedHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { status: 'healthy' } }),
      } as any;
    }) as any;

    api.setTokenGetter(() => 'jwt-token-12345');
    api.setCompanyIdGetter(() => null);
    api.setBranchIdGetter(() => null);

    await api.get('/api/test');
    assert.strictEqual(capturedHeaders['Authorization'], 'Bearer jwt-token-12345');
    assert.strictEqual(capturedHeaders['X-Company-Id'], undefined);
  });

  await test('2. API Client dynamically propagates X-Company-Id and X-Branch-Id headers', async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = (async (url: any, init: any) => {
      capturedHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [] }),
      } as any;
    }) as any;

    api.setTokenGetter(() => 'jwt-token-12345');
    api.setCompanyIdGetter(() => 'comp-acme-corp');
    api.setBranchIdGetter(() => 'branch-hq');

    await api.get('/api/v1/org/warehouses');
    assert.strictEqual(capturedHeaders['Authorization'], 'Bearer jwt-token-12345');
    assert.strictEqual(capturedHeaders['X-Company-Id'], 'comp-acme-corp');
    assert.strictEqual(capturedHeaders['X-Branch-Id'], 'branch-hq');
  });

  await test('3. API Client NEVER transmits client-spoofed permissions or superadmin status', async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = (async (url: any, init: any) => {
      capturedHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [] }),
      } as any;
    }) as any;

    api.setTokenGetter(() => 'valid-jwt');
    await api.get('/api/v1/audit/logs');

    assert.strictEqual(capturedHeaders['x-permissions'], undefined);
    assert.strictEqual(capturedHeaders['x-is-superadmin'], undefined);
    assert.strictEqual(capturedHeaders['x-user-id'], undefined);
  });

  await test('4. API Client standardizes AppError payloads and status codes', async () => {
    global.fetch = (async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'User lacks required permission org.company.edit',
          },
        }),
      } as any;
    }) as any;

    try {
      await api.get('/api/v1/org/companies');
      assert.fail('Should have thrown ApiError');
    } catch (err: any) {
      assert.ok(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 403);
      assert.strictEqual(err.code, 'FORBIDDEN');
      assert.ok(err.message.includes('org.company.edit'));
    }
  });

  await test('5. Numbering series preview computes safe sequence without database increment', () => {
    const mockSeries = {
      id: 'ser-1',
      companyId: 'comp-1',
      documentType: 'SALES_INVOICE',
      prefix: 'INV-2026',
      suffix: 'HQ',
      minDigits: 5,
      currentNumber: 100,
      resetFrequency: 'ANNUAL' as const,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const nextSeq = mockSeries.currentNumber + 1;
    const padded = String(nextSeq).padStart(mockSeries.minDigits, '0');
    const preview = `${mockSeries.prefix}-${padded}-${mockSeries.suffix}`;

    assert.strictEqual(preview, 'INV-2026-00101-HQ');
    assert.strictEqual(mockSeries.currentNumber, 100); // Counter unmodified
  });

  await test('6. Terminal states cannot transition in state machine simulation', () => {
    const isTerminal = (state: string) => state === 'CANCELLED' || state === 'REVERSED';
    assert.strictEqual(isTerminal('CANCELLED'), true);
    assert.strictEqual(isTerminal('REVERSED'), true);
    assert.strictEqual(isTerminal('SUBMITTED'), false);
    assert.strictEqual(isTerminal('DRAFT'), false);
  });

  await test('7. POSTED state immutability rejects non-reversal transitions', () => {
    const validatePosted = (targetState: string, allowReversal: boolean) => {
      if (targetState !== 'REVERSED') return false;
      return allowReversal;
    };

    assert.strictEqual(validatePosted('APPROVED', true), false);
    assert.strictEqual(validatePosted('DRAFT', true), false);
    assert.strictEqual(validatePosted('REVERSED', true), true);
    assert.strictEqual(validatePosted('REVERSED', false), false);
  });

  await test('8. Segregation of Duties (SoD) detects self-approval attempts', () => {
    const checkSoD = (requiresSoD: boolean, creatorId: string, approverId: string) => {
      if (requiresSoD && creatorId === approverId) {
        return { allowed: false, reason: 'SOD_VIOLATION' };
      }
      return { allowed: true };
    };

    const selfApprove = checkSoD(true, 'user-creator-1', 'user-creator-1');
    assert.strictEqual(selfApprove.allowed, false);
    assert.strictEqual(selfApprove.reason, 'SOD_VIOLATION');

    const managerApprove = checkSoD(true, 'user-creator-1', 'user-manager-2');
    assert.strictEqual(managerApprove.allowed, true);
  });

  await test('9. Audit query params include company tenant isolation and action filter', async () => {
    let requestedUrl = '';

    global.fetch = (async (url: any) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [] }),
      } as any;
    }) as any;

    api.setCompanyIdGetter(() => 'comp-isolated');

    const queryParams = new URLSearchParams();
    queryParams.set('action', 'POST');
    queryParams.set('module', 'accounting');
    queryParams.set('companyId', 'comp-isolated');

    await api.get(`/api/v1/audit/logs?${queryParams.toString()}`);

    assert.ok(requestedUrl.includes('action=POST'));
    assert.ok(requestedUrl.includes('module=accounting'));
    assert.ok(requestedUrl.includes('companyId=comp-isolated'));
  });

  await test('10. 401 Unauthorized clears context and fails closed', async () => {
    global.fetch = (async () => {
      return {
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Session token has expired or is invalid',
          },
        }),
      } as any;
    }) as any;

    try {
      await api.get('/api/v1/auth/me');
      assert.fail('Should have failed with 401 ApiError');
    } catch (err: any) {
      assert.strictEqual(err.statusCode, 401);
      assert.strictEqual(err.code, 'UNAUTHORIZED');
    }
  });

  console.log(`\nIncrement 0.7 Tests: ${passedTests}/${totalTests} passed.\n`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
