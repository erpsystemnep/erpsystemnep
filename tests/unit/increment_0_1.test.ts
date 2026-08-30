import assert from 'node:assert/strict';
import {
  createCompanySchema,
  createBranchSchema,
  createWarehouseSchema,
  createNumberingSeriesSchema,
} from '../../src/shared/schemas/org.js';
import {
  loginRequestSchema,
  createUserSchema,
  createRoleSchema,
  assignUserRoleSchema,
  permissionKeySchema,
} from '../../src/shared/schemas/auth.js';
import { createAuditLogSchema, auditQuerySchema } from '../../src/shared/schemas/audit.js';
import { AppError, ErrorCode } from '../../src/shared/errors/AppError.js';
import { loadConfig } from '../../src/server/config.js';

let passedTests = 0;
let totalTests = 0;

function test(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('\n=== RUNNING INCREMENT 0.1 UNIT TESTS ===\n');

// -------------------------------------------------------------
// 1. Zod Organization Schemas Tests
// -------------------------------------------------------------
console.log('--- Suite 1: Organization Foundation Schemas ---');

test('Valid Company input passes validation', () => {
  const validCompany = {
    code: 'CORP_HQ',
    legalName: 'Acme Enterprise Corporation',
    baseCurrency: 'USD',
    fiscalYearStartMonth: 1,
    isActive: true,
  };
  const parsed = createCompanySchema.parse(validCompany);
  assert.equal(parsed.code, 'CORP_HQ');
  assert.equal(parsed.legalName, 'Acme Enterprise Corporation');
  assert.equal(parsed.baseCurrency, 'USD');
});

test('Invalid Company input (lowercase code, invalid currency length) fails validation', () => {
  const invalidCompany = {
    code: 'lowercase_corp!',
    legalName: 'A',
    baseCurrency: 'US DOLLAR',
  };
  const result = createCompanySchema.safeParse(invalidCompany);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.length >= 2);
  }
});

test('Valid Branch with company reference passes validation', () => {
  const validBranch = {
    companyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    code: 'NY_BRANCH_01',
    name: 'New York Flagship',
    countryCode: 'US',
    timezone: 'America/New_York',
  };
  const parsed = createBranchSchema.parse(validBranch);
  assert.equal(parsed.code, 'NY_BRANCH_01');
  assert.equal(parsed.isHeadOffice, false); // Default value
});

test('Valid Warehouse (Company-level DC with null branchId) passes validation', () => {
  const validWarehouse = {
    companyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    branchId: null,
    code: 'CENTRAL_DC_01',
    name: 'Central Distribution Center',
    warehouseType: 'CENTRAL_DC',
  };
  const parsed = createWarehouseSchema.parse(validWarehouse);
  assert.equal(parsed.warehouseType, 'CENTRAL_DC');
  assert.equal(parsed.branchId, null);
});

test('Valid Numbering Series passes validation and defaults', () => {
  const validSeries = {
    companyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    documentType: 'SALES_ORDER',
    prefix: 'SO-',
  };
  const parsed = createNumberingSeriesSchema.parse(validSeries);
  assert.equal(parsed.minDigits, 5);
  assert.equal(parsed.currentNumber, 0);
  assert.equal(parsed.resetFrequency, 'NEVER');
});

// -------------------------------------------------------------
// 2. Zod Authentication & RBAC Schemas Tests
// -------------------------------------------------------------
console.log('\n--- Suite 2: Authentication & RBAC Schemas ---');

test('Valid Login Request passes validation', () => {
  const validLogin = {
    email: 'admin@enterprise.com',
    password: 'SecurePassword123!',
  };
  const parsed = loginRequestSchema.parse(validLogin);
  assert.equal(parsed.email, 'admin@enterprise.com');
});

test('Invalid Login Request (malformed email, short password) fails validation', () => {
  const invalidLogin = {
    email: 'not-an-email',
    password: '123',
  };
  const result = loginRequestSchema.safeParse(invalidLogin);
  assert.equal(result.success, false);
});

test('Approved Permission Key standard format validation', () => {
  assert.ok(permissionKeySchema.safeParse('org.company.view').success);
  assert.ok(permissionKeySchema.safeParse('sales.order.approve').success);
  assert.ok(permissionKeySchema.safeParse('inv.stock.reverse').success);
  assert.ok(permissionKeySchema.safeParse('audit.log.export').success);

  // Unapproved action or format must fail
  assert.equal(permissionKeySchema.safeParse('sales.order.supercharge').success, false);
  assert.equal(permissionKeySchema.safeParse('just_one_word').success, false);
});

test('Valid Role definition with action primitive permissions passes', () => {
  const validRole = {
    code: 'FINANCE_APPROVER',
    name: 'Finance Approver',
    description: 'Can view and approve financial transactions',
    permissionIds: ['org.company.view', 'sales.order.approve', 'audit.log.view'],
  };
  const parsed = createRoleSchema.parse(validRole);
  assert.equal(parsed.code, 'FINANCE_APPROVER');
  assert.equal(parsed.permissionIds.length, 3);
});

test('User Company Role assignment with optional branch scope passes', () => {
  const validAssignment = {
    userId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    companyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    branchId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    roleId: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
  };
  const parsed = assignUserRoleSchema.parse(validAssignment);
  assert.equal(parsed.userId, validAssignment.userId);
});

// -------------------------------------------------------------
// 3. Zod Audit Schemas Tests
// -------------------------------------------------------------
console.log('\n--- Suite 3: Audit Logging Schemas ---');

test('Valid Audit Log creation payload passes validation', () => {
  const validAudit = {
    companyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    userId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    action: 'APPROVE',
    module: 'sales',
    entityName: 'sales_order',
    entityId: 'SO-2026-0001',
    changes: {
      old: { status: 'PENDING_APPROVAL' },
      new: { status: 'APPROVED' },
    },
    correlationId: 'req-corr-uuid-12345',
  };
  const parsed = createAuditLogSchema.parse(validAudit);
  assert.equal(parsed.action, 'APPROVE');
  assert.equal(parsed.module, 'sales');
});

test('Audit Query pagination defaults apply correctly', () => {
  const query = {};
  const parsed = auditQuerySchema.parse(query);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 25);
});

// -------------------------------------------------------------
// 4. AppError Behavior & Serialization Tests
// -------------------------------------------------------------
console.log('\n--- Suite 4: AppError Application Error Standard ---');

test('AppError sets correct defaults, status codes, and error codes', () => {
  const notFoundErr = AppError.notFound('Company', 'cmp-123');
  assert.equal(notFoundErr.statusCode, 404);
  assert.equal(notFoundErr.code, ErrorCode.NOT_FOUND);
  assert.equal(notFoundErr instanceof AppError, true);
  assert.equal(notFoundErr instanceof Error, true);

  const json = notFoundErr.toJSON();
  assert.equal(json.success, false);
  assert.equal(json.error.code, ErrorCode.NOT_FOUND);
  assert.equal(json.error.statusCode, 404);
  assert.ok(json.error.timestamp);
});

test('AppError Segregation of Duties (SoD) violation error helper', () => {
  const sodErr = AppError.sodViolation(
    'User cannot approve own document',
    { documentId: 'SO-101', creatorId: 'usr-1', approverId: 'usr-1' },
    'corr-sod-999'
  );
  assert.equal(sodErr.statusCode, 403);
  assert.equal(sodErr.code, ErrorCode.SOD_VIOLATION);
  assert.equal(sodErr.correlationId, 'corr-sod-999');
});

test('AppError Validation error helper formatting', () => {
  const valErr = AppError.validation('Invalid input fields', [{ field: 'email', message: 'Required' }]);
  assert.equal(valErr.statusCode, 400);
  assert.equal(valErr.code, ErrorCode.VALIDATION_ERROR);
});

// -------------------------------------------------------------
// 5. Centralized Configuration Tests
// -------------------------------------------------------------
console.log('\n--- Suite 5: Runtime Configuration Validation ---');

test('loadConfig validates and defaults development environment correctly', () => {
  const env = {
    NODE_ENV: 'development',
    PORT: '3000',
  };
  const cfg = loadConfig(env as any);
  assert.equal(cfg.NODE_ENV, 'development');
  assert.equal(cfg.PORT, 3000);
  assert.equal(cfg.LOG_LEVEL, 'info');
  assert.ok(cfg.JWT_SECRET.length >= 16);
  assert.ok(Object.isFrozen(cfg));
});

test('loadConfig throws descriptive error when port or environment is invalid', () => {
  const invalidEnv = {
    NODE_ENV: 'super_prod', // Invalid enum
    PORT: 'invalid_port', // Invalid number
  };
  assert.throws(
    () => {
      loadConfig(invalidEnv as any);
    },
    (err: any) => {
      return err.message.includes('Configuration validation failed');
    }
  );
});

console.log(`\n=============================================`);
console.log(`ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
console.log(`=============================================\n`);
process.exit(0);
