import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PermissionRepository } from '../../src/server/modules/auth/repositories/permission.repository.js';
import { RoleRepository } from '../../src/server/modules/auth/repositories/role.repository.js';
import { UserRepository, UserWithPassword } from '../../src/server/modules/auth/repositories/user.repository.js';
import { RbacService } from '../../src/server/modules/auth/services/rbac.service.js';
import { TokenService } from '../../src/server/modules/auth/services/token.service.js';
import { extractSecurityContext, requirePermission } from '../../src/server/middleware/auth.js';
import {
  APPROVED_ACTION_PRIMITIVES,
  STANDARD_PERMISSIONS,
  STANDARD_ROLES,
  PermissionDefinition,
} from '../../src/server/modules/auth/seed/defaultRoles.js';
import { User, Role, UserCompanyRole } from '../../src/shared/types/index.js';
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

console.log('\n=== RUNNING INCREMENT 0.5 RBAC ENGINE & SCOPED PERMISSIONS TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Test Harness for RBAC Unit Testing
// ----------------------------------------------------------------------------

class InMemoryPermissionRepo extends PermissionRepository {
  private permissions: Map<string, PermissionDefinition> = new Map();

  async findAll(): Promise<PermissionDefinition[]> {
    return Array.from(this.permissions.values());
  }

  async findById(id: string): Promise<PermissionDefinition | null> {
    return this.permissions.get(id) || null;
  }

  async upsertMany(perms: PermissionDefinition[]): Promise<void> {
    for (const p of perms) {
      this.permissions.set(p.id, { ...p });
    }
  }
}

class InMemoryRoleRepo extends RoleRepository {
  private roles: Map<string, Role> = new Map();
  private rolePermissions: Map<string, Set<string>> = new Map();
  private userCompanyRoles: Map<string, UserCompanyRole & { roleCode: string; roleName: string }> = new Map();

  async findById(id: string): Promise<Role | null> {
    return this.roles.get(id) || null;
  }

  async findByCode(code: string, companyId?: string | null): Promise<Role | null> {
    const normalized = code.toUpperCase().trim();
    for (const r of this.roles.values()) {
      if (r.code.toUpperCase() === normalized) {
        if (companyId) {
          if (r.companyId === companyId || !r.companyId) return r;
        } else if (!r.companyId) {
          return r;
        }
      }
    }
    return null;
  }

  async create(data: {
    companyId?: string | null;
    code: string;
    name: string;
    description?: string;
    isSystem?: boolean;
    permissions?: string[];
  }): Promise<Role> {
    const id = randomUUID();
    const role: Role = {
      id,
      companyId: data.companyId || null,
      code: data.code.toUpperCase().trim(),
      name: data.name.trim(),
      description: data.description?.trim() || '',
      isSystem: data.isSystem ?? false,
    };
    this.roles.set(id, role);

    if (data.permissions && data.permissions.length > 0) {
      await this.setRolePermissions(id, data.permissions);
    }
    return role;
  }

  async setRolePermissions(roleId: string, permissions: string[]): Promise<void> {
    this.rolePermissions.set(roleId, new Set(permissions));
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    const set = this.rolePermissions.get(roleId);
    return set ? Array.from(set) : [];
  }

  async assignUserRole(data: {
    userId: string;
    companyId: string;
    roleId: string;
    branchId?: string | null;
  }): Promise<UserCompanyRole> {
    const role = this.roles.get(data.roleId);
    const key = `${data.userId}:${data.companyId}:${data.branchId || 'null'}:${data.roleId}`;
    const entry: UserCompanyRole & { roleCode: string; roleName: string } = {
      id: randomUUID(),
      userId: data.userId,
      companyId: data.companyId,
      branchId: data.branchId || null,
      roleId: data.roleId,
      roleCode: role?.code || 'UNKNOWN',
      roleName: role?.name || 'Unknown',
    };
    this.userCompanyRoles.set(key, entry);
    return {
      id: entry.id,
      userId: entry.userId,
      companyId: entry.companyId,
      branchId: entry.branchId,
      roleId: entry.roleId,
    };
  }

  async removeUserRole(data: {
    userId: string;
    companyId: string;
    roleId: string;
    branchId?: string | null;
  }): Promise<boolean> {
    const key = `${data.userId}:${data.companyId}:${data.branchId || 'null'}:${data.roleId}`;
    return this.userCompanyRoles.delete(key);
  }

  async getUserCompanyRoles(userId: string, companyId?: string): Promise<Array<UserCompanyRole & { roleCode: string; roleName: string }>> {
    const result: Array<UserCompanyRole & { roleCode: string; roleName: string }> = [];
    for (const r of this.userCompanyRoles.values()) {
      if (r.userId === userId) {
        if (!companyId || r.companyId === companyId) {
          result.push({ ...r });
        }
      }
    }
    return result;
  }
}

class InMemoryUserRepo extends UserRepository {
  private users: Map<string, UserWithPassword> = new Map();

  async findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const { passwordHash: _, updatedAt: __, ...safeUser } = user;
    return safeUser;
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

  async setUserActive(id: string, isActive: boolean): Promise<void> {
    const u = this.users.get(id);
    if (u) {
      u.isActive = isActive;
    }
  }
}

async function runAllTests() {
  const permRepo = new InMemoryPermissionRepo();
  const roleRepo = new InMemoryRoleRepo();
  const userRepo = new InMemoryUserRepo();
  const tokenSecret = 'rbac-test-jwt-secret-at-least-32-chars-long';
  const tokenService = new TokenService(tokenSecret, '1h');
  const rbacService = new RbacService(roleRepo, permRepo, userRepo);

  // --------------------------------------------------------------------------
  // Suite 1: Action Primitives & Permission Catalogue Seed
  // --------------------------------------------------------------------------
  console.log('--- Suite 1: Action Primitives & Permission Catalogue Seed ---');

  await test('Approved Action Primitives contains all 11 enterprise verbs', () => {
    const expectedPrimitives = [
      'view',
      'create',
      'edit',
      'delete',
      'export',
      'approve',
      'reject',
      'post',
      'cancel',
      'reverse',
      'print',
    ];
    assert.equal(APPROVED_ACTION_PRIMITIVES.length, 11);
    assert.deepEqual(Array.from(APPROVED_ACTION_PRIMITIVES).sort(), expectedPrimitives.sort());
  });

  await test('Seeds standard permissions catalogue across all foundational domains', async () => {
    await rbacService.seedDefaults();
    const allPerms = await permRepo.findAll();
    assert.ok(allPerms.length >= 25);

    // Verify all 11 action primitives are represented in the catalogue
    const uniqueActions = new Set(allPerms.map((p) => p.action));
    for (const primitive of APPROVED_ACTION_PRIMITIVES) {
      assert.ok(uniqueActions.has(primitive), `Catalogue must contain action primitive '${primitive}'`);
    }
  });

  await test('Seeds 5 standard system roles with correct permission bindings', async () => {
    for (const rDef of STANDARD_ROLES) {
      const role = await roleRepo.findByCode(rDef.code);
      assert.ok(role, `Role '${rDef.code}' must be seeded`);
      assert.equal(role.isSystem, true);

      const perms = await roleRepo.getRolePermissions(role.id);
      if (rDef.code === 'SUPERADMIN') {
        assert.ok(rDef.permissions.includes('*'));
      } else {
        assert.ok(perms.length > 0);
      }
    }
  });

  // --------------------------------------------------------------------------
  // Suite 2: Role Assignments (Company-Wide vs Branch-Scoped)
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 2: Role Assignments (Company-Wide vs Branch-Scoped) ---');

  const compA = 'comp-aaa-111';
  const compB = 'comp-bbb-222';
  const branchA1 = 'branch-aaa-01';
  const branchA2 = 'branch-aaa-02';

  let userCompanyAdmin: User;
  let userBranchManager: User;
  let userWarehouseOp: User;
  let userSuperAdmin: User;
  let userInactive: User;

  let roleCompanyAdmin: Role;
  let roleBranchManager: Role;
  let roleWarehouseOp: Role;

  await test('Provisions test user identities', async () => {
    userCompanyAdmin = await userRepo.create({
      email: 'admin@compa.com',
      fullName: 'Alice Company Admin',
      passwordHash: 'hash-1',
      isSuperadmin: false,
    });

    userBranchManager = await userRepo.create({
      email: 'manager@compa.com',
      fullName: 'Bob Branch Manager',
      passwordHash: 'hash-2',
      isSuperadmin: false,
    });

    userWarehouseOp = await userRepo.create({
      email: 'operator@compa.com',
      fullName: 'Charlie Operator',
      passwordHash: 'hash-3',
      isSuperadmin: false,
    });

    userSuperAdmin = await userRepo.create({
      email: 'root@platform.local',
      fullName: 'Super Administrator',
      passwordHash: 'hash-4',
      isSuperadmin: true,
    });

    userInactive = await userRepo.create({
      email: 'fired@compa.com',
      fullName: 'Inactive Dave',
      passwordHash: 'hash-5',
      isSuperadmin: false,
      isActive: false,
    });

    roleCompanyAdmin = (await roleRepo.findByCode('COMPANY_ADMIN'))!;
    roleBranchManager = (await roleRepo.findByCode('BRANCH_MANAGER'))!;
    roleWarehouseOp = (await roleRepo.findByCode('WAREHOUSE_OPERATOR'))!;
  });

  await test('Assigns company-wide role (branchId = null)', async () => {
    const assignment = await rbacService.assignRole({
      userId: userCompanyAdmin.id,
      companyId: compA,
      roleId: roleCompanyAdmin.id,
      branchId: null, // Company-wide
    });

    assert.ok(assignment.id);
    assert.equal(assignment.userId, userCompanyAdmin.id);
    assert.equal(assignment.companyId, compA);
    assert.equal(assignment.branchId, null);
  });

  await test('Assigns branch-scoped role (branchId = branchA1)', async () => {
    const assignment = await rbacService.assignRole({
      userId: userBranchManager.id,
      companyId: compA,
      roleId: roleBranchManager.id,
      branchId: branchA1,
    });

    assert.ok(assignment.id);
    assert.equal(assignment.userId, userBranchManager.id);
    assert.equal(assignment.companyId, compA);
    assert.equal(assignment.branchId, branchA1);
  });

  await test('Assigns warehouse operator role to branchA2', async () => {
    await rbacService.assignRole({
      userId: userWarehouseOp.id,
      companyId: compA,
      roleId: roleWarehouseOp.id,
      branchId: branchA2,
    });
  });

  await test('Rejects role assignment for inactive or nonexistent user', async () => {
    await assert.rejects(
      async () => {
        await rbacService.assignRole({
          userId: userInactive.id,
          companyId: compA,
          roleId: roleCompanyAdmin.id,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await rbacService.assignRole({
          userId: 'non-existent-user-id',
          companyId: compA,
          roleId: roleCompanyAdmin.id,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // Suite 3: Effective Permission Resolution Engine
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 3: Effective Permission Resolution Engine ---');

  await test('Company-wide assignment resolves all company permissions across any branch', async () => {
    // 1. In root company context
    const compContext = await rbacService.resolveEffectivePermissions(userCompanyAdmin.id, compA, null);
    assert.equal(compContext.isSuperadmin, false);
    assert.ok(compContext.effectivePermissions.includes('org.company.edit'));
    assert.ok(compContext.effectivePermissions.includes('org.branch.create'));
    assert.ok(compContext.effectivePermissions.includes('org.warehouse.post'));
    assert.ok(compContext.roles.includes('COMPANY_ADMIN'));

    // 2. In specific branch context (inherits company-wide role)
    const branchContext = await rbacService.resolveEffectivePermissions(userCompanyAdmin.id, compA, branchA1);
    assert.ok(branchContext.effectivePermissions.includes('org.company.edit'));
    assert.ok(branchContext.effectivePermissions.includes('org.branch.create'));
  });

  await test('Branch-scoped role resolves permissions ONLY when requested branch matches', async () => {
    // 1. Matches assigned branchA1
    const matchingBranch = await rbacService.resolveEffectivePermissions(userBranchManager.id, compA, branchA1);
    assert.ok(matchingBranch.effectivePermissions.includes('org.branch.view'));
    assert.ok(matchingBranch.effectivePermissions.includes('org.warehouse.view'));
    assert.ok(matchingBranch.effectivePermissions.includes('system.workflow.approve'));
    assert.equal(matchingBranch.effectivePermissions.includes('org.company.edit'), false, 'Branch manager cannot edit company');

    // 2. Unassigned branchA2 -> No permissions resolved
    const unassignedBranch = await rbacService.resolveEffectivePermissions(userBranchManager.id, compA, branchA2);
    assert.equal(unassignedBranch.effectivePermissions.length, 0);
    assert.equal(unassignedBranch.roles.length, 0);

    // 3. Company-wide query without branch -> Branch-scoped role does NOT apply company-wide
    const noBranch = await rbacService.resolveEffectivePermissions(userBranchManager.id, compA, null);
    assert.equal(noBranch.effectivePermissions.length, 0);
  });

  await test('Tenant isolation: User assigned to Company A cannot resolve permissions in Company B', async () => {
    const crossCompany = await rbacService.resolveEffectivePermissions(userCompanyAdmin.id, compB, null);
    assert.equal(crossCompany.effectivePermissions.length, 0);
    assert.equal(crossCompany.roles.length, 0);

    const crossBranch = await rbacService.resolveEffectivePermissions(userBranchManager.id, compB, branchA1);
    assert.equal(crossBranch.effectivePermissions.length, 0);
  });

  await test('Multiple applicable roles combine and deduplicate permissions cleanly', async () => {
    // Assign warehouse operator role to userCompanyAdmin as well
    await rbacService.assignRole({
      userId: userCompanyAdmin.id,
      companyId: compA,
      roleId: roleWarehouseOp.id,
      branchId: branchA1,
    });

    const combined = await rbacService.resolveEffectivePermissions(userCompanyAdmin.id, compA, branchA1);
    assert.ok(combined.roles.includes('COMPANY_ADMIN'));
    assert.ok(combined.roles.includes('WAREHOUSE_OPERATOR'));
    assert.ok(combined.effectivePermissions.includes('org.warehouse.post'));
    assert.ok(combined.effectivePermissions.includes('org.company.view'));

    // Verify deduplication
    const uniqueCount = new Set(combined.effectivePermissions).size;
    assert.equal(combined.effectivePermissions.length, uniqueCount);
  });

  await test('Inactive user always resolves empty permissions (fail closed)', async () => {
    // Attempt assignment
    await roleRepo.assignUserRole({
      userId: userInactive.id,
      companyId: compA,
      roleId: roleCompanyAdmin.id,
    });

    const inactiveResult = await rbacService.resolveEffectivePermissions(userInactive.id, compA, null);
    assert.equal(inactiveResult.effectivePermissions.length, 0);
    assert.equal(inactiveResult.roles.length, 0);
  });

  await test('SUPERADMIN resolves wildcard * unconditionally across any company/branch', async () => {
    const rootAnywhere = await rbacService.resolveEffectivePermissions(userSuperAdmin.id, compA, branchA1);
    assert.equal(rootAnywhere.isSuperadmin, true);
    assert.deepEqual(rootAnywhere.effectivePermissions, ['*']);

    const rootCompB = await rbacService.resolveEffectivePermissions(userSuperAdmin.id, compB, 'some-random-branch');
    assert.equal(rootCompB.isSuperadmin, true);
    assert.deepEqual(rootCompB.effectivePermissions, ['*']);
  });

  // --------------------------------------------------------------------------
  // Suite 4: Security Context Middleware & Authorization Guards
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 4: Security Context Middleware & Authorization Guards ---');

  const adminToken = tokenService.signToken({
    userId: userCompanyAdmin.id,
    email: userCompanyAdmin.email,
  });

  const managerToken = tokenService.signToken({
    userId: userBranchManager.id,
    email: userBranchManager.email,
  });

  await test('extractSecurityContext resolves server-side permissions from database for authenticated token', async () => {
    const mockReq: any = {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-company-id': compA,
      },
    };

    await new Promise<void>((resolve, reject) => {
      extractSecurityContext(
        mockReq,
        {} as any,
        (err?: any) => {
          if (err) return reject(err);
          resolve();
        },
        tokenService,
        rbacService
      );
    });

    assert.equal(mockReq.securityContext.userId, userCompanyAdmin.id);
    assert.equal(mockReq.securityContext.activeCompanyId, compA);
    assert.ok(mockReq.securityContext.effectivePermissions.includes('org.company.edit'));
    assert.ok(mockReq.securityContext.effectivePermissions.includes('org.branch.create'));
  });

  await test('requirePermission allows authorized permission and blocks missing permission', () => {
    const allowedReq: any = {
      securityContext: {
        userId: userCompanyAdmin.id,
        isSuperadmin: false,
        effectivePermissions: ['org.company.view', 'org.branch.create'],
      },
    };

    let allowed = false;
    requirePermission('org.company.view')(allowedReq, {} as any, (err?: any) => {
      assert.equal(err, undefined);
      allowed = true;
    });
    assert.ok(allowed);

    const forbiddenReq: any = {
      securityContext: {
        userId: userBranchManager.id,
        isSuperadmin: false,
        effectivePermissions: ['org.warehouse.view'],
      },
    };

    let forbidden = false;
    requirePermission('org.company.delete')(forbiddenReq, {} as any, (err?: any) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 403);
      assert.ok(err.message.includes('Missing required permission'));
      forbidden = true;
    });
    assert.ok(forbidden);
  });

  await test('Production security ignores client x-permissions and x-is-superadmin headers', () => {
    // Simulate production environment
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const mockReq: any = {
      headers: {
        'x-user-id': 'attacker-user',
        'x-is-superadmin': 'true',
        'x-permissions': 'org.company.delete,org.company.create,*',
      },
    };

    extractSecurityContext(
      mockReq,
      {} as any,
      () => {},
      tokenService,
      rbacService
    );

    // Security context must fail closed
    assert.equal(mockReq.securityContext.userId, 'anonymous');
    assert.equal(mockReq.securityContext.isSuperadmin, false);
    assert.deepEqual(mockReq.securityContext.effectivePermissions, []);

    // Clean up
    process.env.NODE_ENV = originalEnv;
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 0.5 TESTS PASSED!`);
  console.log(`=============================================\n`);
}

runAllTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
