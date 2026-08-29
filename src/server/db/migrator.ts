import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { getPool, withTransaction } from './connection.js';
import { AppError } from '../../shared/errors/AppError.js';

export interface MigrationFile {
  id: string;
  name: string;
  filename: string;
  filePath: string;
  sqlContent: string;
  checksum: string;
}

export interface AppliedMigration {
  id: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

export interface MigrationResult {
  totalDiscovered: number;
  alreadyApplied: number;
  newlyApplied: string[];
  durationMs: number;
}

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: MigrationFile[];
}

/**
 * Computes deterministic SHA-256 checksum of migration SQL string.
 */
export function calculateChecksum(content: string): string {
  // Normalize line endings to ensure consistent checksum across OS platforms
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Discovers and loads all .sql migration files from the migrations directory.
 * Sorted deterministically in ascending alphanumeric order.
 */
export function loadMigrationFiles(customMigrationsDir?: string): MigrationFile[] {
  const migrationsDir = customMigrationsDir || path.join(process.cwd(), 'src', 'server', 'db', 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((filename) => {
    const filePath = path.join(migrationsDir, filename);
    const sqlContent = fs.readFileSync(filePath, 'utf-8');
    const id = filename.replace(/\.sql$/, '');
    const checksum = calculateChecksum(sqlContent);

    return {
      id,
      name: filename,
      filename,
      filePath,
      sqlContent,
      checksum,
    };
  });
}

export interface Queryable {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] } | any>;
}

async function executeQuery(client: Queryable, text: string, params?: any[]): Promise<{ rows: any[] }> {
  return (client as any).query(text, params);
}

/**
 * Ensures the schema_migrations tracking table exists.
 */
export async function ensureMigrationTable(client: Queryable): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await executeQuery(client, sql);
}

/**
 * Fetches all applied migrations recorded in schema_migrations.
 */
export async function getAppliedMigrations(client: Queryable): Promise<AppliedMigration[]> {
  await ensureMigrationTable(client);
  const result = await executeQuery(
    client,
    'SELECT id, name, checksum, applied_at FROM schema_migrations ORDER BY id ASC'
  );
  return (result.rows || []) as AppliedMigration[];
}

/**
 * Runs all unapplied forward migrations in deterministic sequence.
 * Enforces checksum immutability for previously applied migrations.
 */
export async function runMigrations(
  poolOrClient?: Queryable,
  customMigrationsDir?: string
): Promise<MigrationResult> {
  const startTime = Date.now();
  const discovered = loadMigrationFiles(customMigrationsDir);

  if (discovered.length === 0) {
    return {
      totalDiscovered: 0,
      alreadyApplied: 0,
      newlyApplied: [],
      durationMs: Date.now() - startTime,
    };
  }

  const executor: Queryable = poolOrClient || getPool();
  const newlyApplied: string[] = [];

  // 1. Ensure table exists & get applied history
  await ensureMigrationTable(executor);
  const applied = await getAppliedMigrations(executor);
  const appliedMap = new Map<string, AppliedMigration>();
  for (const m of applied) {
    appliedMap.set(m.id, m);
  }

  // 2. Validate checksum integrity of already applied migrations
  for (const file of discovered) {
    const existing = appliedMap.get(file.id);
    if (existing) {
      if (existing.checksum !== file.checksum) {
        throw new AppError({
          message: `Migration checksum mismatch for '${file.id}'. Previously applied checksum '${existing.checksum}', but found file checksum '${file.checksum}'. Applied migrations are strictly immutable.`,
          code: 'IMMUTABILITY_VIOLATION',
          statusCode: 500,
          details: {
            migrationId: file.id,
            appliedChecksum: existing.checksum,
            currentChecksum: file.checksum,
          },
          isOperational: false,
        });
      }
    }
  }

  // 3. Filter for unapplied migrations
  const pending = discovered.filter((f) => !appliedMap.has(f.id));

  // 4. Apply pending migrations in individual transactions
  for (const migration of pending) {
    console.log(`Applying forward migration: ${migration.filename}...`);

    if ('connect' in executor && typeof (executor as any).connect === 'function') {
      // If given a pool, execute in transactional block
      await withTransaction(async (client) => {
        await executeQuery(client, migration.sqlContent);
        await executeQuery(
          client,
          'INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
          [migration.id, migration.name, migration.checksum]
        );
      });
    } else {
      // If given a dedicated client or mock
      await executeQuery(executor, migration.sqlContent);
      await executeQuery(
        executor,
        'INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [migration.id, migration.name, migration.checksum]
      );
    }

    newlyApplied.push(migration.id);
    console.log(`Successfully applied migration: ${migration.filename}`);
  }

  return {
    totalDiscovered: discovered.length,
    alreadyApplied: applied.length,
    newlyApplied,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Returns current status of migrations (applied vs pending).
 */
export async function getMigrationStatus(
  poolOrClient?: Queryable,
  customMigrationsDir?: string
): Promise<MigrationStatus> {
  const executor: Queryable = poolOrClient || getPool();
  const discovered = loadMigrationFiles(customMigrationsDir);
  const applied = await getAppliedMigrations(executor);

  const appliedIds = new Set(applied.map((a) => a.id));
  const pending = discovered.filter((f) => !appliedIds.has(f.id));

  return {
    applied,
    pending,
  };
}
