/**
 * Application Error Standard
 * Reusable across client and server layers for consistent error contracts.
 */

export const ErrorCode = {
  // Client & Input Errors
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',

  // Domain & Governance Invariants
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
  SOD_VIOLATION: 'SOD_VIOLATION', // Segregation of Duties Violation
  TENANT_BOUNDARY_VIOLATION: 'TENANT_BOUNDARY_VIOLATION',
  IMMUTABILITY_VIOLATION: 'IMMUTABILITY_VIOLATION',

  // System & Infrastructure Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode] | string;

export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCodeType;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly correlationId?: string;
  public readonly isOperational: boolean;
  public readonly timestamp: string;

  constructor(options: {
    message: string;
    code?: ErrorCodeType;
    statusCode?: number;
    details?: unknown;
    correlationId?: string;
    isOperational?: boolean;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code || ErrorCode.INTERNAL_ERROR;
    this.statusCode = options.statusCode || 500;
    this.details = options.details;
    this.correlationId = options.correlationId;
    this.isOperational = options.isOperational ?? true;
    this.timestamp = new Date().toISOString();

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  // --- Factory Methods for Standardized HTTP & Domain Errors ---

  public static badRequest(
    message: string,
    details?: unknown,
    correlationId?: string
  ): AppError {
    return new AppError({
      message,
      code: ErrorCode.BAD_REQUEST,
      statusCode: 400,
      details,
      correlationId,
    });
  }

  public static validation(
    message: string = 'Validation failed',
    details?: unknown,
    correlationId?: string
  ): AppError {
    return new AppError({
      message,
      code: ErrorCode.VALIDATION_ERROR,
      statusCode: 400,
      details,
      correlationId,
    });
  }

  public static unauthorized(
    message: string = 'Authentication required',
    correlationId?: string
  ): AppError {
    return new AppError({
      message,
      code: ErrorCode.UNAUTHORIZED,
      statusCode: 401,
      correlationId,
    });
  }

  public static forbidden(
    message: string = 'Access denied: insufficient permissions',
    details?: unknown,
    correlationId?: string
  ): AppError {
    return new AppError({
      message,
      code: ErrorCode.FORBIDDEN,
      statusCode: 403,
      details,
      correlationId,
    });
  }

  public static sodViolation(
    message: string = 'Segregation of duties violation: creator cannot approve or post this transaction',
    details?: unknown,
    correlationId?: string
  ): AppError {
    return new AppError({
      message,
      code: ErrorCode.SOD_VIOLATION,
      statusCode: 403,
      details,
      correlationId,
    });
  }

  public static notFound(
    resource: string = 'Resource',
    id?: string,
    correlationId?: string
  ): AppError {
    const message = id ? `${resource} with identifier '${id}' was not found` : `${resource} was not found`;
    return new AppError({
      message,
      code: ErrorCode.NOT_FOUND,
      statusCode: 404,
      details: { resource, id },
      correlationId,
    });
  }

  public static conflict(
    message: string,
    details?: unknown,
    correlationId?: string
  ): AppError {
    return new AppError({
      message,
      code: ErrorCode.CONFLICT,
      statusCode: 409,
      details,
      correlationId,
    });
  }

  public static invariantViolation(
    message: string,
    details?: unknown,
    correlationId?: string
  ): AppError {
    return new AppError({
      message,
      code: ErrorCode.INVARIANT_VIOLATION,
      statusCode: 422,
      details,
      correlationId,
    });
  }

  public static internal(
    message: string = 'An unexpected internal error occurred',
    details?: unknown,
    correlationId?: string
  ): AppError {
    return new AppError({
      message,
      code: ErrorCode.INTERNAL_ERROR,
      statusCode: 500,
      details,
      correlationId,
      isOperational: false,
    });
  }

  public toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details,
        correlationId: this.correlationId,
        timestamp: this.timestamp,
      },
    };
  }
}
