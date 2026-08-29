import { RoleRepository } from '../repositories/role.repository.js';
import { PermissionRepository } from '../repositories/permission.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { BranchRepository } from '../../org/repositories/branch.repository.js';
import { CompanyRepository } from '../../org/repositories/company.repository.js';
import { STANDARD_PERMISSIONS, STANDARD_ROLES } from '../seed/defaultRoles.js';
import { Role, UserCompanyRole } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import pg from 'pg';

export interface ResolvedPermissions {
  userId: string;
  isSuperadmin: boolean;
  companyId: string | null;
  branchId: string | null;
  roles: string[]; // Assigned role codes
  effectivePermissions: string[]; // Atomic permission strings (or ['*'])
}

export class RbacService {
  constructor(
    private readonly roleRepo: RoleRepository,
    private readonly permissionRepo: PermissionRepository,
    private readonly userRepo: UserRepository,
    private readonly companyRepo?: CompanyRepository,
    private readonly branchRepo?: BranchRepository
  ) {}

  /**
   * Seeds default system permissions and roles if not already present.
   */
  async seedDefaults(client?: pg.PoolClient): Promise<void> {
    // 1. Seed standard permissions
    await this.permissionRepo.upsertMany(STANDARD_PERMISSIONS, client);

    // 2. Seed standard roles
    for (const roleDef of STANDARD_ROLES) {
      let existingRole = await this.roleRepo.findByCode(roleDef.code, null, client);
      if (!existingRole) {
        existingRole = await this.roleRepo.create(
          {
            companyId: null,
            code: roleDef.code,
            name: roleDef.name,
            description: roleDef.description,
            isSystem: roleDef.isSystem,
            permissions: roleDef.permissions,
          },
          client
        );
      } else {
        await this.roleRepo.setRolePermissions(existingRole.id, roleDef.permissions, client);
      }
    }
  }

  /**
   * Assigns a role to a user within a company, optionally scoped to a specific branch.
   */
  async assignRole(
    input: {
      userId: string;
      companyId: string;
      roleId: string;
      branchId?: string | null;
    },
    client?: pg.PoolClient
  ): Promise<UserCompanyRole> {
    // 1. Verify user exists
    const user = await this.userRepo.findById(input.userId, client);
    if (!user) {
      throw AppError.notFound(`User with id '${input.userId}' does not exist`);
    }
    if (!user.isActive) {
      throw AppError.validation(`Cannot assign roles to inactive user '${input.userId}'`);
    }

    // 2. Verify role exists
    const role = await this.roleRepo.findById(input.roleId, client);
    if (!role) {
      throw AppError.notFound(`Role with id '${input.roleId}' does not exist`);
    }

    // 3. If role is custom (company-scoped), ensure it belongs to this company
    if (role.companyId && role.companyId !== input.companyId) {
      throw AppError.validation(`Role '${role.code}' does not belong to company '${input.companyId}'`);
    }

    // 4. If branchId is supplied, verify branch exists and belongs to this company
    if (input.branchId && this.branchRepo) {
      const branch = await this.branchRepo.findById(input.branchId, client);
      if (!branch) {
        throw AppError.notFound(`Branch with id '${input.branchId}' does not exist`);
      }
      if (branch.companyId !== input.companyId) {
        throw AppError.validation(
          `Branch '${input.branchId}' belongs to company '${branch.companyId}', not '${input.companyId}'`
        );
      }
    }

    return this.roleRepo.assignUserRole(input, client);
  }

  /**
   * Removes a user role assignment.
   */
  async removeRole(
    input: {
      userId: string;
      companyId: string;
      roleId: string;
      branchId?: string | null;
    },
    client?: pg.PoolClient
  ): Promise<boolean> {
    return this.roleRepo.removeUserRole(input, client);
  }

  /**
   * Resolves effective permissions for a given user under a requested tenant context.
   * 
   * RESOLUTION RULES:
   * ---------------------------------------------------------------------------
   * 1. User Invariant: User must exist and be active. Inactive/non-existent users fail authorization (effectivePermissions: []).
   * 2. Superadmin Authority: If user.isSuperadmin is TRUE, resolves ['*'] across all companies/branches automatically.
   * 3. Tenant Context: If companyId is null/empty and user is not superadmin, returns empty permissions (fail closed).
   * 4. Scope Hierarchy:
   *    - Company-wide role assignment (branch_id IS NULL) applies to the entire company and all its branches.
   *    - Branch-scoped role assignment (branch_id = :requestedBranchId) applies ONLY when requested branch matches.
   *    - If requested branch belongs to a different company or is not assigned, those branch permissions are NOT included.
   * 5. Role Combination: Permissions from all matching company-wide and branch-scoped roles are aggregated and deduplicated.
   * 6. Fails closed when authorization cannot be established.
   */
  async resolveEffectivePermissions(
    userId: string,
    companyId?: string | null,
    branchId?: string | null,
    client?: pg.PoolClient
  ): Promise<ResolvedPermissions> {
    const emptyResult: ResolvedPermissions = {
      userId,
      isSuperadmin: false,
      companyId: companyId || null,
      branchId: branchId || null,
      roles: [],
      effectivePermissions: [],
    };

    if (!userId || userId === 'anonymous') {
      return emptyResult;
    }

    // 1. Verify user exists and check is_active & is_superadmin
    const user = await this.userRepo.findById(userId, client);
    if (!user || !user.isActive) {
      return emptyResult;
    }

    // 2. Superadmin resolution
    if (user.isSuperadmin) {
      return {
        userId: user.id,
        isSuperadmin: true,
        companyId: companyId || null,
        branchId: branchId || null,
        roles: ['SUPERADMIN'],
        effectivePermissions: ['*'],
      };
    }

    // 3. If no company context is provided for a standard user, no permissions can be resolved
    if (!companyId) {
      return emptyResult;
    }

    // 4. Retrieve all role assignments for this user in this company
    const assignments = await this.roleRepo.getUserCompanyRoles(user.id, companyId, client);
    if (assignments.length === 0) {
      return emptyResult; // User has no roles in this company
    }

    const matchingRoles: string[] = [];
    const permissionSet = new Set<string>();

    for (const assignment of assignments) {
      // Check branch scoping
      const isCompanyWide = !assignment.branchId;
      const isMatchingBranch = branchId && assignment.branchId === branchId;

      // Role applies if it is company-wide OR matches the requested branch
      if (isCompanyWide || isMatchingBranch) {
        matchingRoles.push(assignment.roleCode);

        // Retrieve role permissions
        if (assignment.roleCode === 'SUPERADMIN') {
          permissionSet.add('*');
        } else {
          const perms = await this.roleRepo.getRolePermissions(assignment.roleId, client);
          for (const p of perms) {
            permissionSet.add(p);
          }
        }
      }
    }

    if (permissionSet.has('*')) {
      return {
        userId: user.id,
        isSuperadmin: false,
        companyId,
        branchId: branchId || null,
        roles: Array.from(new Set(matchingRoles)),
        effectivePermissions: ['*'],
      };
    }

    return {
      userId: user.id,
      isSuperadmin: false,
      companyId,
      branchId: branchId || null,
      roles: Array.from(new Set(matchingRoles)),
      effectivePermissions: Array.from(permissionSet).sort(),
    };
  }
}
