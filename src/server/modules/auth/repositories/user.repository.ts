import { query } from '../../../db/connection.js';
import { User } from '../../../../shared/types/index.js';
import { CreateUserInput, UpdateUserInput } from '../../../../shared/schemas/auth.js';
import pg from 'pg';

export interface UserWithPassword extends User {
  passwordHash: string;
  updatedAt: string;
}

export class UserRepository {
  /**
   * Maps raw database row to safe User domain interface (excluding password_hash).
   */
  protected mapRowToEntity(row: any): User {
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      isSuperadmin: Boolean(row.is_superadmin),
      isActive: Boolean(row.is_active),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /**
   * Maps raw database row to internal UserWithPassword.
   */
  protected mapRowToInternalEntity(row: any): UserWithPassword {
    return {
      ...this.mapRowToEntity(row),
      passwordHash: row.password_hash,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async findById(id: string, client?: pg.PoolClient): Promise<User | null> {
    const sql = `
      SELECT id, email, full_name, is_superadmin, is_active, last_login_at, created_at, updated_at
      FROM users
      WHERE id = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async findByEmail(email: string, client?: pg.PoolClient): Promise<User | null> {
    const sql = `
      SELECT id, email, full_name, is_superadmin, is_active, last_login_at, created_at, updated_at
      FROM users
      WHERE LOWER(email) = LOWER($1)
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [email.trim()]);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async findWithPasswordByEmail(email: string, client?: pg.PoolClient): Promise<UserWithPassword | null> {
    const sql = `
      SELECT id, email, password_hash, full_name, is_superadmin, is_active, last_login_at, created_at, updated_at
      FROM users
      WHERE LOWER(email) = LOWER($1)
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, [email.trim()]);
    if (result.rows.length === 0) return null;
    return this.mapRowToInternalEntity(result.rows[0]);
  }

  async create(
    input: {
      email: string;
      fullName: string;
      passwordHash: string;
      isSuperadmin?: boolean;
      isActive?: boolean;
    },
    client?: pg.PoolClient
  ): Promise<User> {
    const sql = `
      INSERT INTO users (
        email, password_hash, full_name, is_superadmin, is_active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id, email, full_name, is_superadmin, is_active, last_login_at, created_at, updated_at
    `;
    const params = [
      input.email.toLowerCase().trim(),
      input.passwordHash,
      input.fullName.trim(),
      input.isSuperadmin ?? false,
      input.isActive ?? true,
    ];

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return this.mapRowToEntity(result.rows[0]);
  }

  async updateLastLogin(id: string, client?: pg.PoolClient): Promise<void> {
    const sql = `
      UPDATE users
      SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    await executor.query(sql, [id]);
  }

  async update(id: string, input: Partial<UpdateUserInput> & { passwordHash?: string }, client?: pg.PoolClient): Promise<User | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (input.fullName !== undefined) {
      fields.push(`full_name = $${idx++}`);
      params.push(input.fullName.trim());
    }
    if (input.passwordHash !== undefined) {
      fields.push(`password_hash = $${idx++}`);
      params.push(input.passwordHash);
    }
    if (input.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      params.push(input.isActive);
    }

    if (fields.length === 0) {
      return this.findById(id, client);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const sql = `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, email, full_name, is_superadmin, is_active, last_login_at, created_at, updated_at
    `;

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    if (result.rows.length === 0) return null;
    return this.mapRowToEntity(result.rows[0]);
  }

  async list(filters?: { isActive?: boolean }, client?: pg.PoolClient): Promise<User[]> {
    let sql = `
      SELECT id, email, full_name, is_superadmin, is_active, last_login_at, created_at, updated_at
      FROM users
    `;
    const params: any[] = [];

    if (filters?.isActive !== undefined) {
      sql += ' WHERE is_active = $1';
      params.push(filters.isActive);
    }

    sql += ' ORDER BY email ASC';

    const executor = client ? client : { query: (text: string, params: any[]) => query(text, params) };
    const result = await executor.query(sql, params);
    return result.rows.map((r: any) => this.mapRowToEntity(r));
  }
}
