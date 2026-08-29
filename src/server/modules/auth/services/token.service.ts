import jwt from 'jsonwebtoken';
import { config } from '../../../config.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export interface AuthTokenPayload {
  userId: string;
  email: string;
}

export class TokenService {
  private readonly secret: string;
  private readonly expiresIn: string;

  constructor(secret: string = config.JWT_SECRET, expiresIn: string = config.JWT_EXPIRES_IN) {
    this.secret = secret;
    this.expiresIn = expiresIn;
  }

  /**
   * Signs a standard authenticated identity token containing only verified userId and email.
   * Explicitly avoids embedding authorization permissions or company boundaries in JWT.
   */
  signToken(payload: AuthTokenPayload): string {
    if (!payload.userId || !payload.email) {
      throw AppError.validation('userId and email are required to sign an authentication token');
    }

    return jwt.sign(
      {
        sub: payload.userId,
        userId: payload.userId,
        email: payload.email,
      },
      this.secret,
      {
        expiresIn: this.expiresIn as any,
      }
    );
  }

  /**
   * Verifies and decodes an authentication token.
   * Returns decoded AuthTokenPayload or throws AppError.unauthorized.
   */
  verifyToken(token: string): AuthTokenPayload {
    if (!token || typeof token !== 'string') {
      throw AppError.unauthorized('Authentication token is missing or malformed');
    }

    try {
      const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload;

      if (!decoded || typeof decoded !== 'object') {
        throw AppError.unauthorized('Invalid authentication token payload');
      }

      const userId = (decoded.userId as string) || (decoded.sub as string);
      const email = decoded.email as string;

      if (!userId || !email) {
        throw AppError.unauthorized('Token is missing required user identity claims');
      }

      return {
        userId,
        email,
      };
    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      if (err.name === 'TokenExpiredError') {
        throw AppError.unauthorized('Authentication token has expired');
      }
      if (err.name === 'JsonWebTokenError') {
        throw AppError.unauthorized('Authentication token signature is invalid or tampered');
      }
      throw AppError.unauthorized('Authentication verification failed');
    }
  }

  /**
   * Safe non-throwing verify method for middleware extraction.
   */
  tryVerifyToken(token: string): AuthTokenPayload | null {
    try {
      return this.verifyToken(token);
    } catch {
      return null;
    }
  }
}
