import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { DocumentState, StateTransitionDefinition } from '../../../shared/types/index.js';
import { GitCommit, ArrowRight, ShieldAlert, CheckCircle2, XCircle, Info, Lock } from 'lucide-react';

interface SimulatedWorkflow {
  documentType: string;
  name: string;
  allowReversal: boolean;
  transitions: StateTransitionDefinition[];
}

const REGISTERED_WORKFLOWS: SimulatedWorkflow[] = [
  {
    documentType: 'QUOTATION',
    name: 'Sales Quotation',
    allowReversal: false,
    transitions: [
      { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit draft quotation for review' },
      { from: 'SUBMITTED', to: 'APPROVED', action: 'approve', requiredPermission: 'sales.quotation.approve', requiresSoD: true, description: 'Approve quotation' },
      { from: 'SUBMITTED', to: 'REJECTED', action: 'reject', requiredPermission: 'sales.quotation.reject', description: 'Reject quotation' },
      { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft quotation' },
      { from: 'SUBMITTED', to: 'CANCELLED', action: 'cancel', description: 'Cancel submitted quotation' },
      { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved quotation' },
    ],
  },
  {
    documentType: 'PURCHASE_ORDER',
    name: 'Purchase Order',
    allowReversal: false,
    transitions: [
      { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit PO for approval' },
      { from: 'SUBMITTED', to: 'APPROVED', action: 'approve', requiredPermission: 'purchase.order.approve', requiresSoD: true, description: 'Approve purchase order' },
      { from: 'SUBMITTED', to: 'REJECTED', action: 'reject', requiredPermission: 'purchase.order.reject', description: 'Reject purchase order' },
      { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft PO' },
      { from: 'APPROVED', to: 'CANCELLED', action: 'cancel', description: 'Cancel approved PO' },
    ],
  },
  {
    documentType: 'FINANCIAL_DOC',
    name: 'Financial Journal & Voucher',
    allowReversal: true,
    transitions: [
      { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit financial document for review' },
      { from: 'SUBMITTED', to: 'APPROVED', action: 'approve', requiredPermission: 'accounting.journal.approve', requiresSoD: true, description: 'Approve financial transaction' },
      { from: 'SUBMITTED', to: 'REJECTED', action: 'reject', requiredPermission: 'accounting.journal.reject', description: 'Reject financial transaction' },
      { from: 'APPROVED', to: 'POSTED', action: 'post', requiredPermission: 'accounting.journal.post', requiresSoD: true, description: 'Post transaction to general ledger (immutable)' },
      { from: 'POSTED', to: 'REVERSED', action: 'reverse', requiredPermission: 'accounting.journal.reverse', requiresSoD: false, description: 'Post reversing transaction to offset financial document' },
      { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft financial document' },
    ],
  },
  {
    documentType: 'STOCK_ENTRY',
    name: 'Inventory Stock Movement',
    allowReversal: true,
    transitions: [
      { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', description: 'Submit stock entry' },
      { from: 'SUBMITTED', to: 'APPROVED', action: 'approve', requiredPermission: 'inventory.movement.approve', requiresSoD: true, description: 'Approve inventory movement' },
      { from: 'SUBMITTED', to: 'REJECTED', action: 'reject', requiredPermission: 'inventory.movement.reject', description: 'Reject inventory movement' },
      { from: 'APPROVED', to: 'POSTED', action: 'post', requiredPermission: 'inventory.movement.post', requiresSoD: true, description: 'Post stock entry to inventory ledger (immutable)' },
      { from: 'POSTED', to: 'REVERSED', action: 'reverse', requiredPermission: 'inventory.movement.reverse', description: 'Reverse stock movement with offset entries' },
      { from: 'DRAFT', to: 'CANCELLED', action: 'cancel', description: 'Cancel draft stock entry' },
    ],
  },
];

const ALL_STATES: DocumentState[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'CANCELLED', 'REVERSED'];

export const WorkflowSimulatorView: React.FC = () => {
  const { user, isSuperadmin } = useAuth();
  const [selectedDocType, setSelectedDocType] = useState<string>('FINANCIAL_DOC');
  const [fromState, setFromState] = useState<DocumentState>('SUBMITTED');
  const [toState, setToState] = useState<DocumentState>('APPROVED');
  const [isSameUserAsCreator, setIsSameUserAsCreator] = useState<boolean>(true);

  const currentWorkflow = REGISTERED_WORKFLOWS.find((w) => w.documentType === selectedDocType) || REGISTERED_WORKFLOWS[0];

  // Evaluate transition rule against state machine invariants
  const evaluateSimulation = () => {
    // Check terminal states
    if (fromState === 'CANCELLED' || fromState === 'REVERSED') {
      return {
        allowed: false,
        reason: `Document is in terminal state '${fromState}' and cannot transition further.`,
        code: 'TERMINAL_STATE',
      };
    }

    // Check POSTED immutability
    if (fromState === 'POSTED') {
      if (toState !== 'REVERSED') {
        return {
          allowed: false,
          reason: `POSTED documents are strictly immutable. Cannot transition from 'POSTED' to '${toState}'. Only reversal ('REVERSED') is permitted.`,
          code: 'POSTED_IMMUTABLE',
        };
      }
      if (!currentWorkflow.allowReversal) {
        return {
          allowed: false,
          reason: `Document type '${currentWorkflow.documentType}' does not permit reversal of posted records.`,
          code: 'REVERSAL_NOT_ALLOWED',
        };
      }
    }

    // Match transition definition
    const matched = currentWorkflow.transitions.find((t) => t.from === fromState && t.to === toState);
    if (!matched) {
      return {
        allowed: false,
        reason: `Illegal state transition: Cannot move from '${fromState}' to '${toState}' for document type '${currentWorkflow.documentType}'.`,
        code: 'INVALID_TRANSITION',
      };
    }

    // Check Segregation of Duties (SoD)
    if (matched.requiresSoD && isSameUserAsCreator) {
      return {
        allowed: false,
        reason: `Segregation of Duties (SoD) violation: Document creator cannot approve or post their own transaction. A distinct approver identity is mandatory.`,
        code: 'SOD_VIOLATION',
        rule: matched,
      };
    }

    return {
      allowed: true,
      reason: `Valid transition under state machine and SoD rules. Requires permission: '${matched.requiredPermission || 'None (Standard)'}'.`,
      code: 'VALID_TRANSITION',
      rule: matched,
    };
  };

  const evalResult = evaluateSimulation();

  return (
    <div className="space-y-6" id="workflow-simulator-view">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
          <GitCommit className="w-5 h-5 text-indigo-600" />
          Workflow State Machine & SoD Simulator
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Inspect registered document lifecycle state matrices, Segregation of Duties (SoD), and POSTED immutability enforcement.
        </p>
      </div>

      {/* Simulator Control Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
            Interactive Transition Evaluator
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Document Workflow</label>
              <select
                value={selectedDocType}
                onChange={(e) => setSelectedDocType(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {REGISTERED_WORKFLOWS.map((wf) => (
                  <option key={wf.documentType} value={wf.documentType}>
                    {wf.name} ({wf.documentType})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Current State (From)</label>
                <select
                  value={fromState}
                  onChange={(e) => setFromState(e.target.value as DocumentState)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-mono"
                >
                  {ALL_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Target State (To)</label>
                <select
                  value={toState}
                  onChange={(e) => setToState(e.target.value as DocumentState)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-mono"
                >
                  {ALL_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* SoD Toggle */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSameUserAsCreator}
                  onChange={(e) => setIsSameUserAsCreator(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-700">
                  Simulate: <strong>Current user is the document creator</strong> (Tests SoD)
                </span>
              </label>
            </div>
          </div>

          {/* Evaluation Result Box */}
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${
              evalResult.allowed
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {evalResult.allowed ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            )}
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase tracking-wider">
                  {evalResult.allowed ? 'Transition Permitted' : 'Transition Rejected'}
                </span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-white/70">
                  {evalResult.code}
                </span>
              </div>
              <p className="leading-relaxed">{evalResult.reason}</p>
            </div>
          </div>
        </div>

        {/* Registered Transitions Matrix for Document Type */}
        <div className="lg:col-span-6 bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center justify-between">
            <span>Allowed Transitions for {currentWorkflow.name}</span>
            <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">
              Reversal: {currentWorkflow.allowReversal ? 'Supported' : 'Disabled'}
            </span>
          </h3>

          <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {currentWorkflow.transitions.map((t, idx) => (
              <div key={idx} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1 text-xs">
                <div className="flex items-center justify-between font-mono">
                  <div className="flex items-center gap-1.5 text-slate-900 font-bold">
                    <span>{t.from}</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                    <span>{t.to}</span>
                  </div>
                  <span className="text-[10px] uppercase px-1.5 py-0.2 bg-indigo-100 text-indigo-800 rounded font-semibold">
                    Action: {t.action}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>{t.description}</span>
                  {t.requiresSoD && (
                    <span className="text-amber-700 font-semibold bg-amber-50 px-1.5 rounded">
                      SoD Enforced
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
