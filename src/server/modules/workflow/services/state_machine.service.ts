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
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted PO' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved PO' },
      ],
    });

    // 2b. Purchase Receipt Workflow (Goods Receipt Note)
    this.registerStateMachine({
      documentType: 'PURCHASE_RECEIPT',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit purchase receipt for review' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'purchase.receipt.approve',
          requiresSoD: true,
          description: 'Approve purchase receipt',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'purchase.receipt.reject',
          description: 'Reject purchase receipt',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'purchase.receipt.post',
          requiresSoD: true,
          description: 'Post purchase receipt to inventory ledger (immutable)',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'purchase.receipt.reverse',
          description: 'Reverse posted purchase receipt with offset movements',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft receipt' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted receipt' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved receipt' },
      ],
    });

    // 2c. Quality Control (QC) Inspection Workflow
    this.registerStateMachine({
      documentType: 'QC_INSPECTION',
      initialState: 'DRAFT',
      allowReversal: false,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit QC inspection results' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'inventory.qc.approve',
          requiresSoD: true,
          description: 'Approve QC inspection findings',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'inventory.qc.reject',
          description: 'Reject QC inspection findings',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'inventory.qc.post',
          requiresSoD: true,
          description: 'Post QC release / restriction to inventory ledger',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft QC inspection' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted QC inspection' },
      ],
    });

    // 2d. Purchase Return Workflow
    this.registerStateMachine({
      documentType: 'PURCHASE_RETURN',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit purchase return' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'purchase.return.approve',
          requiresSoD: true,
          description: 'Approve purchase return',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'purchase.return.reject',
          description: 'Reject purchase return',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'purchase.return.post',
          requiresSoD: true,
          description: 'Post purchase return stock deductions',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'purchase.return.reverse',
          description: 'Reverse posted purchase return',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft purchase return' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted purchase return' },
      ],
    });

    // 2e. Purchase Invoice Workflow (Supplier Bills / Accounts Payable)
    this.registerStateMachine({
      documentType: 'PURCHASE_INVOICE',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit purchase invoice for approval' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'purchase.invoice.approve',
          requiresSoD: true,
          description: 'Approve purchase invoice / supplier bill',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'purchase.invoice.reject',
          description: 'Reject purchase invoice',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'purchase.invoice.post',
          requiresSoD: true,
          description: 'Post purchase invoice to create supplier payable and GL entries (immutable)',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'purchase.invoice.reverse',
          requiresSoD: false,
          description: 'Reverse posted purchase invoice, canceling payable and posting compensating GL entries',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft invoice' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted invoice' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved invoice' },
      ],
    });

    // 2f. Supplier Payment Workflow (Disbursements & AP Settlement)
    this.registerStateMachine({
      documentType: 'SUPPLIER_PAYMENT',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit supplier payment for review' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'purchase.payment.approve',
          requiresSoD: true,
          description: 'Approve supplier payment disbursement',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'purchase.payment.reject',
          description: 'Reject supplier payment disbursement',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'purchase.payment.post',
          requiresSoD: true,
          description: 'Post supplier payment, settle payables, and generate GL journal (immutable)',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'purchase.payment.reverse',
          requiresSoD: false,
          description: 'Reverse posted supplier payment with compensating GL entry and restored AP balances',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft supplier payment' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted supplier payment' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved supplier payment' },
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
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'sales.order.post',
          requiresSoD: true,
          description: 'Post / Confirm sales order for fulfillment',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft SO' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted SO' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved SO' },
      ],
    });

    // 3b. Sales Delivery Workflow (Goods Delivery Note / Fulfillment)
    this.registerStateMachine({
      documentType: 'SALES_DELIVERY',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit sales delivery for review' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'sales.delivery.approve',
          requiresSoD: true,
          description: 'Approve sales delivery',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'sales.delivery.reject',
          description: 'Reject sales delivery',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'sales.delivery.post',
          requiresSoD: true,
          description: 'Post sales delivery to inventory ledger (deduct physical stock)',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'sales.delivery.reverse',
          description: 'Reverse posted sales delivery with compensating inventory ledger movements',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft sales delivery' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted sales delivery' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved sales delivery' },
      ],
    });

    // 3c. Sales Invoice Workflow (Accounts Receivable & Billing)
    this.registerStateMachine({
      documentType: 'SALES_INVOICE',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit sales invoice for approval' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'sales.invoice.approve',
          requiresSoD: true,
          description: 'Approve sales invoice',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'sales.invoice.reject',
          description: 'Reject sales invoice',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'sales.invoice.post',
          requiresSoD: true,
          description: 'Post sales invoice to create customer receivable (immutable)',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'sales.invoice.reverse',
          description: 'Reverse posted sales invoice and receivable',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft invoice' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted invoice' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved invoice' },
      ],
    });

    // 3d. Customer Payment Workflow (Settlement & GL Integration)
    this.registerStateMachine({
      documentType: 'CUSTOMER_PAYMENT',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit customer payment for review' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'sales.payment.approve',
          requiresSoD: true,
          description: 'Approve customer payment receipt',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'sales.payment.reject',
          description: 'Reject customer payment receipt',
        },
        {
          from: 'APPROVED',
          to: 'POSTED',
          action: 'post',
          requiredPermission: 'sales.payment.post',
          requiresSoD: true,
          description: 'Post customer payment, settle receivables, and generate general ledger journal (immutable)',
        },
        {
          from: 'POSTED',
          to: 'REVERSED',
          action: 'reverse',
          requiredPermission: 'sales.payment.reverse',
          requiresSoD: false,
          description: 'Reverse posted customer payment with compensating GL entry and restored AR balances',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft customer payment' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted customer payment' },
        { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved customer payment' },
      ],
    });

    // 4. Financial Document & Accounting Journal Workflow
    this.registerStateMachine({
      documentType: 'ACCOUNTING_JOURNAL',
      initialState: 'DRAFT',
      allowReversal: true,
      allowedTransitions: [
        { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit journal for review' },
        {
          from: 'SUBMITTED',
          to: 'APPROVED',
          action: 'approve',
          requiredPermission: 'accounting.journal.approve',
          requiresSoD: true,
          description: 'Approve accounting journal',
        },
        {
          from: 'SUBMITTED',
          to: 'REJECTED',
          action: 'reject',
          requiredPermission: 'accounting.journal.reject',
          description: 'Reject accounting journal',
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
          description: 'Post reversing transaction to offset journal entry',
        },
        { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft journal' },
        { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted journal' },
      ],
    });

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
