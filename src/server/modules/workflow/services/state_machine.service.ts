import {
  DocumentState,
  StateMachineConfig,
  StateTransitionDefinition,
  SecurityContext,
} from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';
import { SodService } from './sod.service.js';

export class StateMachineEngine {
  private registry: Map<string, StateMachineConfig> = new Map();

  constructor(private sodService: SodService = new SodService()) {
    this.registerStandardWorkflows();
  }

  /**
   * Registers standard enterprise workflow configurations.
   */
  private registerStandardWorkflows(): void {
    // 1. Quotation Workflow
    this.registerStateMachine({
      documentType: 'QUOTATION',
      initialState: 'DRAFT',
      allowReversal: false,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit draft quotation for review' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'sales.quotation.approve',
          requiresSoD: true,
          description: 'Approve quotation',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'sales.quotation.reject',
          description: 'Reject quotation',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft quotation' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted quotation' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved quotation' },
      ],
    });

    // 2. Purchase Order Workflow
    this.registerStateMachine({
      documentType: 'PURCHASE_ORDER',
      initialState: 'DRAFT',
      allowReversal: false,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit PO for approval' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'purchase.order.approve',
          requiresSoD: true,
          description: 'Approve purchase order',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'purchase.order.reject',
          description: 'Reject purchase order',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft PO' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved PO' },
      ],
    });

    // 3. Sales Order Workflow
    this.registerStateMachine({
      documentType: 'SALES_ORDER',
      initialState: 'DRAFT',
      allowReversal: false,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit SO for approval' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'sales.order.approve',
          requiresSoD: true,
          description: 'Approve sales order',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'sales.order.reject',
          description: 'Reject sales order',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft SO' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved SO' },
      ],
    });

    // 4. Financial Document Workflow (Standard POSTED -> REVERSED Immutability Protocol)
    this.registerStateMachine({
      documentType: 'FINANCIAL_DOC',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit financial document for review' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'accounting.journal.approve',
          requiresSoD: true,
          description: 'Approve financial transaction',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'accounting.journal.reject',
          description: 'Reject financial transaction',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'accounting.journal.post',
          requiresSoD: true,
          description: 'Post transaction to general ledger (immutable)',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'accounting.journal.reverse',
          requiresSoD: false,
          description: 'Post reversing transaction to offset financial document',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft financial document' },
      ],
    });

    // 5. Stock / Inventory Movement Workflow
    this.registerStateMachine({
      documentType: 'STOCK_ENTRY',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit stock entry' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'inventory.movement.approve',
          requiresSoD: true,
          description: 'Approve inventory movement',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'inventory.movement.reject',
          description: 'Reject inventory movement',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'inventory.movement.post',
          requiresSoD: true,
          description: 'Post stock entry to inventory ledger (immutable)',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'inventory.movement.reverse',
          description: 'Reverse stock movement with offset entries',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft stock entry' },
      ],
    });
  }

  /**
   * Registers or overrides a document state machine.
   */
  registerStateMachine(config: StateMachineConfig): void {
    this.registry.set(config.documentType.toUpperCase(), config);
  }

  /**
   * Retrieves a document state machine definition.
   */
  getStateMachine(documentType: string): StateMachineConfig {
    const config = this.registry.get(documentType.toUpperCase());
    if (!config) {
      throw AppError.notFound(`State machine for document type '${documentType}' is not registered`);
    }
    return config;
  }

  /**
   * Evaluates if a transition is valid and permissible under the caller's security context.
   */
  validateTransition(params: {
    documentType: string;
    currentState: DocumentState;
    targetState: DocumentState;
    ctx: SecurityContext;
    documentContext?: {
      creatorId?: string;
      companyId: string;
      branchId?: string | null;
      documentId?: string;
    };
    strictSoD?: boolean;
  }): StateTransitionDefinition {
    const { documentType, currentState, targetState, ctx, documentContext, strictSoD = true } = params;
    const config = this.getStateMachine(documentType);

    // Invariant 1: Terminal States
    if (currentState === 'CANCELLED' || currentState === 'REVERSED') {
      throw AppError.invariantViolation(
        `Document is in terminal state '${currentState}' and cannot transition further`
      );
    }

    // Invariant 2: POSTED Document Immutability
    if (currentState === 'POSTED') {
      if (targetState !== 'REVERSED') {
        throw AppError.invariantViolation(
          `POSTED documents are strictly immutable. Cannot transition from 'POSTED' to '${targetState}'. Only reversal ('REVERSED') is permitted.`
        );
      }
      if (!config.allowReversal) {
        throw AppError.invariantViolation(
          `Document type '${documentType}' does not permit reversal of posted records`
        );
      }
    }

    // Match transition rule
    const transition = config.allowedTransitions.find(
      (t) => t.from === currentState && t.to === targetState
    );

    if (!transition) {
      throw AppError.badRequest(
        `Invalid state transition: Cannot transition '${documentType}' from '${currentState}' to '${targetState}'`
      );
    }

    // Check Multi-Tenant & Branch Boundaries if document context provided
    if (documentContext) {
      if (!ctx.isSuperadmin && ctx.activeCompanyId && ctx.activeCompanyId !== documentContext.companyId) {
        throw AppError.forbidden(
          `Cross-tenant violation: User company '${ctx.activeCompanyId}' cannot transition document of company '${documentContext.companyId}'`
        );
      }
      if (
        !ctx.isSuperadmin &&
        documentContext.branchId &&
        ctx.activeBranchId &&
        ctx.activeBranchId !== documentContext.branchId
      ) {
        throw AppError.forbidden(
          `Branch scope violation: User branch scope '${ctx.activeBranchId}' cannot transition document of branch '${documentContext.branchId}'`
        );
      }
    }

    // Check Segregation of Duties (Creator vs Approver/Poster)
    if (transition.requiresSoD && documentContext?.creatorId) {
      if (strictSoD) {
        this.sodService.assertCreatorApproverSeparation(documentContext.creatorId, ctx.userId, {
          documentType,
          documentId: documentContext.documentId,
        });
      }
    }

    // Check RBAC Permission
    if (transition.requiredPermission) {
      const hasWildcard = ctx.isSuperadmin || ctx.effectivePermissions.includes('*');
      const hasPermission = ctx.effectivePermissions.includes(transition.requiredPermission);

      if (!hasWildcard && !hasPermission) {
        throw AppError.forbidden(
          `Missing required permission '${transition.requiredPermission}' to execute transition '${transition.action}' (${currentState} -> ${targetState})`
        );
      }
    }

    return transition;
  }

  /**
   * Safe boolean check for transition capability.
   */
  canTransition(
    documentType: string,
    currentState: DocumentState,
    targetState: DocumentState,
    ctx: SecurityContext,
    documentContext?: {
      creatorId?: string;
      companyId: string;
      branchId?: string | null;
      documentId?: string;
    }
  ): boolean {
    try {
      this.validateTransition({
        documentType,
        currentState,
        targetState,
        ctx,
        documentContext,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists available outgoing transitions from the current state.
   */
  getAvailableTransitions(
    documentType: string,
    currentState: DocumentState,
    ctx?: SecurityContext,
    documentContext?: {
      creatorId?: string;
      companyId: string;
      branchId?: string | null;
      documentId?: string;
    }
  ): StateTransitionDefinition[] {
    const config = this.getStateMachine(documentType);
    return config.allowedTransitions.filter((transition) => {
      if (transition.from !== currentState) return false;
      if (!ctx) return true;
      try {
        this.validateTransition({
          documentType,
          currentState,
          targetState: transition.to,
          ctx,
          documentContext,
        });
        return true;
      } catch {
        return false;
      }
    });
  }
}
