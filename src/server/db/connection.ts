import pg from 'pg';
import { config } from '../config.js';
import { AppError } from '../../shared/errors/AppError.js';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

/**
 * Gets or initializes the singleton PostgreSQL connection pool.
 * Configured via centralized server config.
 */
export function getPool(customUrl?: string): pg.Pool {
  if (!poolInstance) {
    const connectionString = customUrl || config.DATABASE_URL;
    const isCloudDb =
      connectionString.includes('supabase.co') ||
      connectionString.includes('pooler.supabase.com') ||
      connectionString.includes('aws.') ||
      connectionString.includes('sslmode=require');
    const useSsl = config.DB_SSL || isCloudDb;

    poolInstance = new Pool({
      connectionString,
      min: config.DB_POOL_MIN,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });

    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client pool', err);
    });
  }

  return poolInstance;
}

/**
 * Executes a parameterized SQL query on the pool.
 */
export async function query<R extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<R>> {
  const pool = getPool();
  try {
    return await pool.query<R>(text, params);
  } catch (err: any) {
    console.error('Database query error:', { text, error: err.message });
    throw new AppError({
      message: `Database error: ${err.message}`,
      code: 'DATABASE_ERROR',
      statusCode: 500,
      details: { query: config.NODE_ENV === 'development' ? text : undefined },
      isOperational: true,
    });
  }
}

/**
 * Transaction executor abstraction.
 * Acquires a client from the pool, begins a transaction, executes the callback,
 * and commits on success or rolls back on error.
 */
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
  existingClient?: pg.PoolClient
): Promise<T> {
  // If already running inside an active transaction client, re-use it
  if (existingClient) {
    return callback(existingClient);
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err: any) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error during transaction rollback:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Closes the database pool. Useful for graceful shutdown and tests.
 */
export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

/**
 * Health check query testing database reachability.
 */
export async function checkDatabaseHealth(poolOrClient?: pg.Pool | pg.PoolClient): Promise<{
  connected: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const executor = poolOrClient || getPool();
    await executor.query('SELECT 1 AS health_check');
    return {
      connected: true,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}
