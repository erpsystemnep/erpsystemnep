import dotenv from 'dotenv';
dotenv.config({ override: true });
import { z } from 'zod';

/**
 * Server Configuration & Environment Variable Schema
 * Centralized, validated runtime configuration for the backend.
 */

const envSchema = z.object({
  // Runtime Environment
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Database Connection
  DATABASE_URL: z
    .string()
    .transform((val) => val.trim())
    .optional()
    .default('postgresql://postgres:postgres@localhost:5432/erp_database'),
  DB_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_SSL: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true' || val === '1'),

  // JWT & Authentication (Contract only; auth implemented in later increment)
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters for security')
    .default('dev-foundation-secret-key-32-chars-minimum-safety'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // Logging & Diagnostics
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ENABLE_QUERY_LOGGING: z
    .string()
    .default('false')
    .transform((val) => val === 'true' || val === '1'),

  // CORS & Security
  CORS_ORIGIN: z.string().default('*'),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Loads, validates, and freezes runtime configuration from process.env or an override object.
 * Throws a formatted AppError if configuration validation fails.
 */
export function loadConfig(customEnv: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(customEnv);

  if (!result.success) {
    const formattedErrors = result.error.format();
    const errorMessage = `Configuration validation failed: ${JSON.stringify(formattedErrors, null, 2)}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  return Object.freeze(result.data);
}

// Singleton frozen instance for application-wide consumption
export const config: Config = loadConfig();
