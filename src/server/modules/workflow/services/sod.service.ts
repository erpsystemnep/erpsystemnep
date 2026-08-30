import { SecurityContext, ValidateApprovalAuthorityParams } from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class SodService {
  /**
   * Asserts that the document creator and approver/poster are distinct identities.
   * Enforces strict Segregation of Duties (SoD).
   */
  assertCreatorApproverSeparation(
    creatorId: string,
    approverId: string,
    docContext?: { documentType?: string; documentId?: string }
  ): void {
    if (creatorId && approverId && creatorId === approverId) {
      throw AppError.sodViolation(
        'Segregation of duties violation: Document creator cannot approve or post their own transaction',
        {
          creatorId,
          approverId,
          ...docContext,
        }
      );
    }
  }

  /**
   * Validates full approval authority:
   * 1. Authenticated user check.
   * 2. Tenant isolation (company boundary).
   * 3. Branch-scoped authority (cannot approve documents of a different branch).
   * 4. Segregation of duties (creator vs approver).
   * 5. RBAC permission verification.
   */
  validateApprovalAuthority(params: ValidateApprovalAuthorityParams): void {
    const {
      ctx,
      companyId,
      branchId,
      requiredPermission,
      creatorId,
      documentType,
      documentId,
      strictSoD = true,
    } = params;

    // 1. Authenticated Identity Check
    if (!ctx || ctx.userId === 'anonymous') {
      throw AppError.unauthorized('Authentication required to execute document approval');
    }

    // 2. Multi-Tenant Company Boundary Check
    if (!ctx.isSuperadmin && (!ctx.activeCompanyId || ctx.activeCompanyId !== companyId)) {
      throw AppError.forbidden(
        `Cross-company approval violation: User is authenticated in company '${ctx.activeCompanyId}' but document belongs to company '${companyId}'`
      );
    }

    // 3. Branch Scoping Check
    // If document is branch-scoped and user has a restricted branch scope
    if (!ctx.isSuperadmin && branchId && ctx.activeBranchId && ctx.activeBranchId !== branchId) {
      throw AppError.forbidden(
        `Branch scope violation: User branch scope '${ctx.activeBranchId}' does not have authority over document branch '${branchId}'`
      );
    }

    // 4. Segregation of Duties (Creator != Approver)
    if (strictSoD && creatorId) {
      // Even superadmin cannot self-approve if strict SoD applies
      this.assertCreatorApproverSeparation(creatorId, ctx.userId, {
        documentType,
        documentId,
      });
    }

    // 5. RBAC Required Permission Check
    if (requiredPermission) {
      const hasWildcard = ctx.isSuperadmin || ctx.effectivePermissions.includes('*');
      const hasPermission = ctx.effectivePermissions.includes(requiredPermission);

      if (!hasWildcard && !hasPermission) {
        throw AppError.forbidden(
          `Insufficient authority: Missing required approval permission '${requiredPermission}'`
        );
      }
    }
  }

  /**
   * Safe boolean check for approval authority.
   */
  canApprove(params: ValidateApprovalAuthorityParams): boolean {
    try {
      this.validateApprovalAuthority(params);
      return true;
    } catch {
      return false;
    }
  }
}
