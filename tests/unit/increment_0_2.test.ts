import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateChecksum,
  loadMigrationFiles,
  runMigrations,
  getMigrationStatus,
  ensureMigrationTable,
} from '../../src/server/db/migrator.js';
import { AppError } from '../../src/shared/errors/AppError.js';
import { checkDatabaseHealth } from '../../src/server/db/connection.js';

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

console.log('\n=== RUNNING INCREMENT 0.2 UNIT & MIGRATION TESTS ===\n');

async function runAllTests() {
  // -------------------------------------------------------------
  // 1. Migration Discovery & Parsing Tests
  // -------------------------------------------------------------
  console.log('--- Suite 1: Migration Discovery & Deterministic Loading ---');

  await test('Discovers 0001_initial_foundation.sql migration file', () => {
    const files = loadMigrationFiles();
    assert.ok(files.length >= 1, 'Expected at least 1 migration file');
    const first = files[0];
    assert.equal(first.id, '0001_initial_foundation');
    assert.equal(first.filename, '0001_initial_foundation.sql');
    assert.ok(first.sqlContent.includes('CREATE TABLE IF NOT EXISTS companies'));
    assert.ok(first.sqlContent.includes('CREATE TABLE IF NOT EXISTS audit_logs'));
    assert.ok(first.checksum.length === 64, 'Checksum must be 64-char SHA256 hex');
  });

  await test('Checksum calculation is deterministic and cross-platform safe (CRLF vs LF)', () => {
    const contentUnix = 'CREATE TABLE test (\n  id UUID PRIMARY KEY\n);';
    const contentWin = 'CREATE TABLE test (\r\n  id UUID PRIMARY KEY\r\n);';
    const hash1 = calculateChecksum(contentUnix);
    const hash2 = calculateChecksum(contentWin);
    assert.equal(hash1, hash2, 'Checksum must normalize CRLF to LF');
    assert.equal(hash1.length, 64);
  });

  await test('Migration file ordering is strictly alphanumeric and deterministic', () => {
    // Create temporary mock directory
    const tmpDir = path.join(process.cwd(), 'tests', 'unit', 'tmp_migrations_order');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    try {
      fs.writeFileSync(path.join(tmpDir, '0003_third.sql'), 'SELECT 3;');
      fs.writeFileSync(path.join(tmpDir, '0001_first.sql'), 'SELECT 1;');
      fs.writeFileSync(path.join(tmpDir, '0002_second.sql'), 'SELECT 2;');

      const files = loadMigrationFiles(tmpDir);
      assert.equal(files.length, 3);
      assert.equal(files[0].id, '0001_first');
      assert.equal(files[1].id, '0002_second');
      assert.equal(files[2].id, '0003_third');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------
  // 2. Foundation Schema Verification
  // -------------------------------------------------------------
  console.log('\n--- Suite 2: Foundation Schema DDL Invariants ---');

  await test('0001_initial_foundation.sql establishes all 10 approved foundation entities', () => {
    const files = loadMigrationFiles();
    const sql = files[0].sqlContent;

    const requiredTables = [
      'companies',
      'branches',
      'warehouses',
      'numbering_series',
      'users',
      'roles',
      'permissions',
      'role_permissions',
      'user_company_roles',
      'audit_logs',
    ];

    for (const table of requiredTables) {
      assert.ok(
        sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
        `Migration must create table '${table}'`
      );
    }

    // Check Enums
    assert.ok(sql.includes('warehouse_type_enum'));
    assert.ok(sql.includes('numbering_reset_freq_enum'));
    assert.ok(sql.includes('audit_action_enum'));

    // Check Immutability Trigger
    assert.ok(sql.includes('protect_audit_logs_immutability'));
    assert.ok(sql.includes('trg_audit_logs_immutable'));
  });

  await test('0001_initial_foundation.sql supports nullable branch_id on warehouses for company-level DCs', () => {
    const files = loadMigrationFiles();
    const sql = files[0].sqlContent;

    // Verify warehouses.branch_id is not marked NOT NULL
    const warehouseSection = sql.substring(sql.indexOf('CREATE TABLE IF NOT EXISTS warehouses'));
    const branchLine = warehouseSection
      .split('\n')
      .find((line) => line.includes('branch_id UUID REFERENCES branches'));
    assert.ok(branchLine, 'Warehouses table must reference branches');
    assert.ok(!branchLine.includes('NOT NULL'), 'warehouses.branch_id must be nullable');
  });

  // -------------------------------------------------------------
  // 3. Migration Runner In-Memory / Mock Execution Tests
  // -------------------------------------------------------------
  console.log('\n--- Suite 3: Migration Execution Engine & Checksum Integrity ---');

  function createMockDbClient() {
    const executedQueries: string[] = [];
    const schemaMigrations: Map<string, { id: string; name: string; checksum: string; applied_at: Date }> =
      new Map();

    const mockClient = {
      query: async (text: string, params?: any[]) => {
        executedQueries.push(text);

        if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
          return { rows: [] };
        }

        if (text.includes('SELECT id, name, checksum, applied_at FROM schema_migrations')) {
          const rows = Array.from(schemaMigrations.values()).sort((a, b) => a.id.localeCompare(b.id));
          return { rows };
        }

        if (text.includes('INSERT INTO schema_migrations')) {
          const [id, name, checksum] = params!;
          schemaMigrations.set(id, {
            id,
            name,
            checksum,
            applied_at: new Date(),
          });
          return { rows: [] };
        }

        return { rows: [] };
      },
      executedQueries,
      schemaMigrations,
    };

    return mockClient;
  }

  await test('Migration runner creates schema_migrations, applies pending migrations, and records history', async () => {
    const mockDb = createMockDbClient();
    const result = await runMigrations(mockDb as any);

    assert.ok(result.totalDiscovered >= 1);
    assert.equal(result.alreadyApplied, 0);
    assert.equal(result.newlyApplied.length, result.totalDiscovered);
    assert.ok(result.newlyApplied.includes('0001_initial_foundation'));

    assert.equal(mockDb.schemaMigrations.size, result.totalDiscovered);
    const recorded = mockDb.schemaMigrations.get('0001_initial_foundation');
    assert.ok(recorded);
    assert.equal(recorded.name, '0001_initial_foundation.sql');
  });

  await test('Running migration process again is strictly idempotent (does not duplicate)', async () => {
    const mockDb = createMockDbClient();

    // First run
    const result1 = await runMigrations(mockDb as any);
    assert.ok(result1.newlyApplied.length >= 1);

    // Second run
    const result2 = await runMigrations(mockDb as any);
    assert.equal(result2.totalDiscovered, result1.totalDiscovered);
    assert.equal(result2.alreadyApplied, result1.totalDiscovered);
    assert.equal(result2.newlyApplied.length, 0); // Nothing newly applied
  });

  await test('Detects checksum tampering on previously applied migration and halts with AppError', async () => {
    const mockDb = createMockDbClient();

    // Pre-populate with tampered checksum
    mockDb.schemaMigrations.set('0001_initial_foundation', {
      id: '0001_initial_foundation',
      name: '0001_initial_foundation.sql',
      checksum: 'fake_tampered_hash_000000000000000000000000000000000000000000000000',
      applied_at: new Date(),
    });

    await assert.rejects(
      async () => {
        await runMigrations(mockDb as any);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'IMMUTABILITY_VIOLATION');
        assert.ok(err.message.includes('Migration checksum mismatch'));
        return true;
      }
    );
  });

  await test('Failed migration does NOT get recorded in schema_migrations', async () => {
    const mockDb = createMockDbClient();

    // Mock query that throws on migration execution
    const failingClient = {
      query: async (text: string, params?: any[]) => {
        if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
          return { rows: [] };
        }
        if (text.includes('SELECT id, name, checksum, applied_at FROM schema_migrations')) {
          return { rows: [] };
        }
        if (text.includes('CREATE TABLE IF NOT EXISTS companies')) {
          throw new Error('Simulated SQL Syntax Error');
        }
        if (text.includes('INSERT INTO schema_migrations')) {
          mockDb.schemaMigrations.set(params![0], {
            id: params![0],
            name: params![1],
            checksum: params![2],
            applied_at: new Date(),
          });
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      async () => {
        await runMigrations(failingClient as any);
      },
      (err: any) => {
        assert.ok(err.message.includes('Simulated SQL Syntax Error'));
        return true;
      }
    );

    assert.equal(mockDb.schemaMigrations.size, 0, 'No migration record must be inserted upon failure');
  });

  await test('getMigrationStatus correctly partitions applied vs pending migrations', async () => {
    const mockDb = createMockDbClient();

    const statusBefore = await getMigrationStatus(mockDb as any);
    assert.equal(statusBefore.applied.length, 0);
    assert.ok(statusBefore.pending.length >= 1);
    const pendingCount = statusBefore.pending.length;

    await runMigrations(mockDb as any);

    const statusAfter = await getMigrationStatus(mockDb as any);
    assert.equal(statusAfter.applied.length, pendingCount);
    assert.equal(statusAfter.pending.length, 0);
  });

  // -------------------------------------------------------------
  // 4. Database Health Check Function Tests
  // -------------------------------------------------------------
  console.log('\n--- Suite 4: Database Health Check & Diagnostics ---');

  await test('checkDatabaseHealth returns healthy status on successful query', async () => {
    const mockPool = {
      query: async (sql: string) => {
        assert.equal(sql, 'SELECT 1 AS health_check');
        return { rows: [{ health_check: 1 }] };
      },
    };

    const health = await checkDatabaseHealth(mockPool as any);
    assert.equal(health.connected, true);
    assert.ok(typeof health.latencyMs === 'number');
    assert.equal(health.error, undefined);
  });

  await test('checkDatabaseHealth captures connection errors gracefully without throwing', async () => {
    const mockFailingPool = {
      query: async () => {
        throw new Error('Connection refused at 127.0.0.1:5432');
      },
    };

    const health = await checkDatabaseHealth(mockFailingPool as any);
    assert.equal(health.connected, false);
    assert.ok(typeof health.latencyMs === 'number');
    assert.equal(health.error, 'Connection refused at 127.0.0.1:5432');
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 0.2 TESTS PASSED!`);
  console.log(`=============================================\n`);
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
