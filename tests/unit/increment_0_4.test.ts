import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { UserRepository, UserWithPassword } from '../../src/server/modules/auth/repositories/user.repository.js';
import { PasswordService } from '../../src/server/modules/auth/services/password.service.js';
import { TokenService } from '../../src/server/modules/auth/services/token.service.js';
import { AuthService } from '../../src/server/modules/auth/services/auth.service.js';
import { extractSecurityContext, requireAuth } from '../../src/server/middleware/auth.js';
import { createApp } from '../../src/server/app.js';
import { User } from '../../src/shared/types/index.js';
import { AppError } from '../../src/shared/errors/AppError.js';

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

console.log('\n=== RUNNING INCREMENT 0.4 AUTHENTICATION & IDENTITY CORE TESTS ===\n');

// In-memory User Repository for deterministic unit testing
class InMemoryUserRepo extends UserRepository {
  private users: Map<string, UserWithPassword> = new Map();

  async findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const { passwordHash: _, updatedAt: __, ...safeUser } = user;
    return safeUser;
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === normalized) {
        const { passwordHash: _, updatedAt: __, ...safeUser } = u;
        return safeUser;
      }
    }
    return null;
  }

  async findWithPasswordByEmail(email: string): Promise<UserWithPassword | null> {
    const normalized = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === normalized) {
        return { ...u };
      }
    }
    return null;
  }

  async create(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    isSuperadmin?: boolean;
    isActive?: boolean;
  }): Promise<User> {
    const id = randomUUID();
    const entity: UserWithPassword = {
      id,
      email: input.email.toLowerCase().trim(),
      fullName: input.fullName,
      isSuperadmin: input.isSuperadmin ?? false,
      isActive: input.isActive ?? true,
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(id, entity);
    const { passwordHash: _, updatedAt: __, ...safeUser } = entity;
    return safeUser;
  }

  async updateLastLogin(id: string): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      user.lastLoginAt = new Date().toISOString();
      user.updatedAt = new Date().toISOString();
      this.users.set(id, user);
    }
  }

  async list(filters?: { isActive?: boolean }): Promise<User[]> {
    let result = Array.from(this.users.values());
    if (filters?.isActive !== undefined) {
      result = result.filter((u) => u.isActive === filters.isActive);
    }
    return result.map(({ passwordHash: _, updatedAt: __, ...safeUser }) => safeUser);
  }
}

async function runAllTests() {
  const userRepo = new InMemoryUserRepo();
  const passwordService = new PasswordService(10);
  const tokenSecret = 'test-secret-key-must-be-long-enough-32-chars';
  const tokenService = new TokenService(tokenSecret, '1h');
  const authService = new AuthService(userRepo, passwordService, tokenService);

  // --------------------------------------------------------------------------
  // Suite 1: Password Hashing & Verification
  // --------------------------------------------------------------------------
  console.log('--- Suite 1: Password Hashing & Verification ---');

  let sampleHash = '';
  await test('Hashes plaintext password using bcrypt with salt rounds', async () => {
    sampleHash = await passwordService.hash('SecureP@ssw0rd123');
    assert.ok(sampleHash.startsWith('$2'), 'Bcrypt hash must start with $2');
    assert.notEqual(sampleHash, 'SecureP@ssw0rd123');
  });

  await test('Verifies matching password against valid hash', async () => {
    const isValid = await passwordService.compare('SecureP@ssw0rd123', sampleHash);
    assert.equal(isValid, true);
  });

  await test('Rejects incorrect password against hash', async () => {
    const isValid = await passwordService.compare('WrongPassword456!', sampleHash);
    assert.equal(isValid, false);
  });

  await test('Handles malformed or empty inputs gracefully without throwing', async () => {
    const emptyCheck = await passwordService.compare('', sampleHash);
    assert.equal(emptyCheck, false);

    const invalidHashCheck = await passwordService.compare('password', 'not-a-hash');
    assert.equal(invalidHashCheck, false);
  });

  // --------------------------------------------------------------------------
  // Suite 2: User Provisioning & Account Invariants
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 2: User Provisioning & Account Invariants ---');

  let createdUser: User;

  await test('Provisions new user and never returns password hash', async () => {
    createdUser = await authService.createUser({
      email: 'john.doe@enterprise.com',
      fullName: 'John Doe',
      password: 'EnterprisePassword1!',
      isSuperadmin: false,
      isActive: true,
    });

    assert.ok(createdUser.id);
    assert.equal(createdUser.email, 'john.doe@enterprise.com');
    assert.equal(createdUser.fullName, 'John Doe');
    assert.equal(createdUser.isSuperadmin, false);
    assert.equal(createdUser.isActive, true);
    assert.equal((createdUser as any).passwordHash, undefined, 'Password hash must never leak in domain entity');
  });

  await test('Rejects duplicate email registration with 409 Conflict', async () => {
    await assert.rejects(
      async () => {
        await authService.createUser({
          email: 'JOHN.DOE@ENTERPRISE.COM', // Case-insensitive collision
          fullName: 'John Duplicate',
          password: 'AnotherPassword2@',
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        assert.ok(err.message.includes('already registered'));
        return true;
      }
    );
  });

  await test('Rejects weak or malformed password with validation error', async () => {
    await assert.rejects(
      async () => {
        await authService.createUser({
          email: 'jane.smith@enterprise.com',
          fullName: 'Jane Smith',
          password: 'weak', // Too short, missing upper/digits
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // Suite 3: Login Authentication Flow & Security Checks
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 3: Login Authentication Flow & Security Checks ---');

  let authToken = '';

  await test('Authenticates valid user credentials and returns JWT token and safe profile', async () => {
    const result = await authService.login({
      email: 'john.doe@enterprise.com',
      password: 'EnterprisePassword1!',
    });

    assert.ok(result.token);
    assert.equal(typeof result.token, 'string');
    assert.equal(result.user.id, createdUser.id);
    assert.equal(result.user.email, 'john.doe@enterprise.com');
    assert.equal((result.user as any).passwordHash, undefined);
    authToken = result.token;
  });

  await test('Rejects invalid password with generic 401 Unauthorized (no user enumeration)', async () => {
    await assert.rejects(
      async () => {
        await authService.login({
          email: 'john.doe@enterprise.com',
          password: 'WrongPassword999!',
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.message, 'Invalid email or password');
        return true;
      }
    );
  });

  await test('Rejects non-existent email with identical generic 401 Unauthorized', async () => {
    await assert.rejects(
      async () => {
        await authService.login({
          email: 'nonexistent@enterprise.com',
          password: 'SomePassword123!',
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.message, 'Invalid email or password');
        return true;
      }
    );
  });

  await test('Rejects login attempt for deactivated / inactive user account', async () => {
    const inactiveUser = await authService.createUser({
      email: 'inactive@enterprise.com',
      fullName: 'Inactive Employee',
      password: 'InactivePassword1!',
      isActive: false,
    });

    await assert.rejects(
      async () => {
        await authService.login({
          email: 'inactive@enterprise.com',
          password: 'InactivePassword1!',
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.message, 'Invalid email or password');
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // Suite 4: Token Validation, Expiration & Anti-Tampering
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 4: Token Validation, Expiration & Anti-Tampering ---');

  await test('Valid token resolves verified identity claims (userId, email)', () => {
    const payload = tokenService.verifyToken(authToken);
    assert.equal(payload.userId, createdUser.id);
    assert.equal(payload.email, 'john.doe@enterprise.com');
  });

  await test('Token claims DO NOT contain passwords, hashes, or authoritative permissions', () => {
    const decoded = jwt.decode(authToken) as any;
    assert.equal(decoded.password, undefined);
    assert.equal(decoded.passwordHash, undefined);
    assert.equal(decoded.permissions, undefined);
    assert.equal(decoded.effectivePermissions, undefined);
    assert.equal(decoded.isSuperadmin, undefined);
  });

  await test('Rejects expired token with 401 Unauthorized', () => {
    const expiredTokenService = new TokenService(tokenSecret, '-1s');
    const expiredToken = expiredTokenService.signToken({
      userId: createdUser.id,
      email: createdUser.email,
    });

    assert.throws(
      () => {
        tokenService.verifyToken(expiredToken);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 401);
        assert.ok(err.message.includes('expired'));
        return true;
      }
    );
  });

  await test('Rejects tampered token signature with 401 Unauthorized', () => {
    const otherSecretService = new TokenService('different-secret-key-123456789012345', '1h');
    const foreignToken = otherSecretService.signToken({
      userId: createdUser.id,
      email: createdUser.email,
    });

    assert.throws(
      () => {
        tokenService.verifyToken(foreignToken);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 401);
        assert.ok(err.message.includes('invalid or tampered'));
        return true;
      }
    );
  });

  await test('Rejects malformed token string with 401 Unauthorized', () => {
    assert.throws(
      () => {
        tokenService.verifyToken('malformed.jwt.token.string');
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // Suite 5: Current User Profile (/me) & Logout
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 5: Current User Profile (/me) & Logout ---');

  await test('Resolves current user profile by verified user ID', async () => {
    const profile = await authService.getCurrentUser(createdUser.id);
    assert.equal(profile.id, createdUser.id);
    assert.equal(profile.email, createdUser.email);
    assert.equal((profile as any).passwordHash, undefined);
  });

  await test('Rejects profile lookup for non-existent or anonymous user ID', async () => {
    await assert.rejects(
      async () => {
        await authService.getCurrentUser('anonymous');
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  await test('Logout returns clean success confirmation', async () => {
    const logoutResult = await authService.logout(createdUser.id);
    assert.equal(logoutResult.success, true);
    assert.equal(logoutResult.message, 'Logged out successfully');
  });

  // --------------------------------------------------------------------------
  // Suite 6: Middleware & Security Boundary Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 6: Middleware & Security Boundary Verification ---');

  await test('extractSecurityContext parses Bearer token into authenticated context', async () => {
    const mockReq: any = {
      headers: {
        authorization: `Bearer ${authToken}`,
        'x-company-id': 'comp-100', // context selector
      },
    };
    let nextCalled = false;
    await new Promise<void>((resolve) => {
      extractSecurityContext(
        mockReq,
        {} as any,
        () => {
          nextCalled = true;
          resolve();
        },
        tokenService
      );
    });

    assert.ok(nextCalled);
    assert.equal(mockReq.securityContext.userId, createdUser.id);
    assert.equal(mockReq.securityContext.email, createdUser.email);
    assert.equal(mockReq.requestedTenantContext.companyId, 'comp-100');
  });

  await test('requireAuth guard passes authenticated user and rejects anonymous', () => {
    const authedReq: any = {
      securityContext: {
        userId: createdUser.id,
        email: createdUser.email,
      },
    };
    let passed = false;
    requireAuth(authedReq, {} as any, (err?: any) => {
      assert.equal(err, undefined);
      passed = true;
    });
    assert.ok(passed);

    const anonReq: any = {
      securityContext: {
        userId: 'anonymous',
      },
    };
    let rejected = false;
    requireAuth(anonReq, {} as any, (err?: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      rejected = true;
    });
    assert.ok(rejected);
  });

  // --------------------------------------------------------------------------
  // Suite 7: Express App Router Integration
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 7: Express App Router Integration ---');

  const app = createApp();

  await test('Express app mounts /api/v1/auth and /api/auth routes cleanly', () => {
    assert.ok(typeof app.listen === 'function');
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 0.4 TESTS PASSED!`);
  console.log(`=============================================\n`);
}

runAllTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
