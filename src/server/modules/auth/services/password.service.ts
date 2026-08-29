import bcrypt from 'bcrypt';
import { AppError } from '../../../../shared/errors/AppError.js';

export class PasswordService {
  private readonly saltRounds: number;

  constructor(saltRounds: number = 10) {
    this.saltRounds = saltRounds;
  }

  /**
   * Hashes a plaintext password using bcrypt with configured salt rounds.
   */
  async hash(password: string): Promise<string> {
    if (!password || typeof password !== 'string') {
      throw AppError.validation('Password is required for hashing');
    }
    return bcrypt.hash(password, this.saltRounds);
  }

  /**
   * Compares a plaintext password against a stored bcrypt hash.
   * Returns false safely on mismatch or invalid parameters without throwing unhandled exceptions.
   */
  async compare(password: string, hash: string): Promise<boolean> {
    if (!password || !hash || typeof password !== 'string' || typeof hash !== 'string') {
      return false;
    }
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }
}
