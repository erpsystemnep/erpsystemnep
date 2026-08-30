export interface PermissionDefinition {
  id: string; // e.g. 'org.company.view'
  module: string; // e.g. 'org'
  action: string; // e.g. 'view'
  description: string;
}

/**
 * The 11 Approved Action Primitives:
 * view, create, edit, delete, export, approve, reject, post, cancel, reverse, print
 */
export const APPROVED_ACTION_PRIMITIVES = [
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
] as const;

export type ActionPrimitive = (typeof APPROVED_ACTION_PRIMITIVES)[number];

/**
 * Standard Seed Permission Catalogue for Foundation Modules (org, auth, audit, system)
 * Covers all 11 action primitives across foundational enterprise domains.
 */
export const STANDARD_PERMISSIONS: PermissionDefinition[] = [
  // Org Module - Company
  { id: 'org.company.view', module: 'org', action: 'view', description: 'View company profile, structure, and parameters' },
  { id: 'org.company.create', module: 'org', action: 'create', description: 'Provision new operating companies' },
  { id: 'org.company.edit', module: 'org', action: 'edit', description: 'Update company legal and operating settings' },
  { id: 'org.company.delete', module: 'org', action: 'delete', description: 'Deactivate or remove unposted company entities' },
  { id: 'org.company.export', module: 'org', action: 'export', description: 'Export company directory and structured reports' },

  // Org Module - Branch
  { id: 'org.branch.view', module: 'org', action: 'view', description: 'View branches within authorized companies' },
  { id: 'org.branch.create', module: 'org', action: 'create', description: 'Provision new operating branch locations' },
  { id: 'org.branch.edit', module: 'org', action: 'edit', description: 'Update branch settings and address parameters' },
  { id: 'org.branch.delete', module: 'org', action: 'delete', description: 'Deactivate or delete unposted branch records' },
  { id: 'org.branch.export', module: 'org', action: 'export', description: 'Export branch location datasets' },

  // Org Module - Warehouse
  { id: 'org.warehouse.view', module: 'org', action: 'view', description: 'View warehouses and storage facilities' },
  { id: 'org.warehouse.create', module: 'org', action: 'create', description: 'Provision physical and virtual storage warehouses' },
  { id: 'org.warehouse.edit', module: 'org', action: 'edit', description: 'Update warehouse configurations and storage parameters' },
  { id: 'org.warehouse.delete', module: 'org', action: 'delete', description: 'Remove inactive or empty warehouse facilities' },
  { id: 'org.warehouse.post', module: 'org', action: 'post', description: 'Post inventory balance opening/reconciliation adjustments' },
  { id: 'org.warehouse.export', module: 'org', action: 'export', description: 'Export warehouse capacity and listing data' },

  // Auth Module - User
  { id: 'auth.user.view', module: 'auth', action: 'view', description: 'View user directory and assignment statuses' },
  { id: 'auth.user.create', module: 'auth', action: 'create', description: 'Provision new user identities' },
  { id: 'auth.user.edit', module: 'auth', action: 'edit', description: 'Update user profiles and active account status' },
  { id: 'auth.user.delete', module: 'auth', action: 'delete', description: 'Deactivate user accounts' },
  { id: 'auth.user.export', module: 'auth', action: 'export', description: 'Export user registry and identity logs' },

  // Auth Module - Role & RBAC
  { id: 'auth.role.view', module: 'auth', action: 'view', description: 'View roles, permissions, and company assignments' },
  { id: 'auth.role.create', module: 'auth', action: 'create', description: 'Create custom roles' },
  { id: 'auth.role.edit', module: 'auth', action: 'edit', description: 'Modify role permission bindings' },
  { id: 'auth.role.delete', module: 'auth', action: 'delete', description: 'Delete unassigned custom roles' },

  // Audit Module - Logs
  { id: 'audit.log.view', module: 'audit', action: 'view', description: 'Inspect immutable system audit trail events' },
  { id: 'audit.log.export', module: 'audit', action: 'export', description: 'Export structured audit trail logs for statutory compliance' },

  // System Module - Numbering Series & Approvals/Reversals Action Primitives
  { id: 'system.series.view', module: 'system', action: 'view', description: 'View numbering series configurations' },
  { id: 'system.series.edit', module: 'system', action: 'edit', description: 'Configure document numbering sequences' },
  { id: 'system.workflow.approve', module: 'system', action: 'approve', description: 'Approve pending workflow documents' },
  { id: 'system.workflow.reject', module: 'system', action: 'reject', description: 'Reject submitted workflow documents' },
  { id: 'system.document.cancel', module: 'system', action: 'cancel', description: 'Cancel unposted approved documents' },
  { id: 'system.document.reverse', module: 'system', action: 'reverse', description: 'Post compensating reversals on posted transactions' },
  { id: 'system.document.print', module: 'system', action: 'print', description: 'Generate official print and PDF outputs' },

  // Master Data Module - Items
  { id: 'master.item.view', module: 'master', action: 'view', description: 'View item and product catalog records' },
  { id: 'master.item.create', module: 'master', action: 'create', description: 'Create item master records and conversion ratios' },
  { id: 'master.item.edit', module: 'master', action: 'edit', description: 'Update item specifications, descriptions, and categories' },
  { id: 'master.item.delete', module: 'master', action: 'delete', description: 'Deactivate or soft-delete item records' },
  { id: 'master.item.export', module: 'master', action: 'export', description: 'Export item catalog data and price lists' },

  // Master Data Module - Business Partners
  { id: 'master.partner.view', module: 'master', action: 'view', description: 'View customer and supplier business partner records' },
  { id: 'master.partner.create', module: 'master', action: 'create', description: 'Create customer and supplier partner records' },
  { id: 'master.partner.edit', module: 'master', action: 'edit', description: 'Update business partner profiles, addresses, and contacts' },
  { id: 'master.partner.delete', module: 'master', action: 'delete', description: 'Deactivate or soft-delete business partner records' },
  { id: 'master.partner.export', module: 'master', action: 'export', description: 'Export business partner registries and directories' },

  // Master Data Module - Item Categories
  { id: 'master.category.view', module: 'master', action: 'view', description: 'View product and material category hierarchy' },
  { id: 'master.category.create', module: 'master', action: 'create', description: 'Create product taxonomy and material categories' },
  { id: 'master.category.edit', module: 'master', action: 'edit', description: 'Modify category attributes and hierarchy structures' },
  { id: 'master.category.delete', module: 'master', action: 'delete', description: 'Deactivate or remove unassigned categories' },

  // Master Data Module - Units of Measure (UOM)
  { id: 'master.uom.view', module: 'master', action: 'view', description: 'View units of measure master catalog' },
  { id: 'master.uom.create', module: 'master', action: 'create', description: 'Define new units of measure and symbols' },
  { id: 'master.uom.edit', module: 'master', action: 'edit', description: 'Modify unit of measure specifications and symbols' },
  { id: 'master.uom.delete', module: 'master', action: 'delete', description: 'Deactivate unreferenced units of measure' },
];

export interface StandardRoleDefinition {
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[]; // List of permission keys or '*'
}

/**
 * The 5 Standard System Roles
 */
export const STANDARD_ROLES: StandardRoleDefinition[] = [
  {
    code: 'SUPERADMIN',
    name: 'Super Administrator',
    description: 'Platform-wide administrator with unrestricted system authority across all companies',
    isSystem: true,
    permissions: ['*'],
  },
  {
    code: 'COMPANY_ADMIN',
    name: 'Company Administrator',
    description: 'Full administrative management within the assigned company and its branches',
    isSystem: true,
    permissions: [
      'org.company.view',
      'org.company.edit',
      'org.company.export',
      'org.branch.view',
      'org.branch.create',
      'org.branch.edit',
      'org.branch.delete',
      'org.branch.export',
      'org.warehouse.view',
      'org.warehouse.create',
      'org.warehouse.edit',
      'org.warehouse.delete',
      'org.warehouse.post',
      'org.warehouse.export',
      'auth.user.view',
      'auth.user.create',
      'auth.user.edit',
      'auth.role.view',
      'auth.role.create',
      'auth.role.edit',
      'audit.log.view',
      'audit.log.export',
      'system.series.view',
      'system.series.edit',
      'system.workflow.approve',
      'system.workflow.reject',
      'system.document.cancel',
      'system.document.reverse',
      'system.document.print',
      'master.item.view',
      'master.item.create',
      'master.item.edit',
      'master.item.delete',
      'master.item.export',
      'master.partner.view',
      'master.partner.create',
      'master.partner.edit',
      'master.partner.delete',
      'master.partner.export',
      'master.category.view',
      'master.category.create',
      'master.category.edit',
      'master.category.delete',
      'master.uom.view',
      'master.uom.create',
      'master.uom.edit',
      'master.uom.delete',
    ],
  },
  {
    code: 'BRANCH_MANAGER',
    name: 'Branch Manager',
    description: 'Operational manager for assigned branch location and warehouses',
    isSystem: true,
    permissions: [
      'org.company.view',
      'org.branch.view',
      'org.warehouse.view',
      'org.warehouse.create',
      'org.warehouse.edit',
      'org.warehouse.post',
      'org.warehouse.export',
      'auth.user.view',
      'system.workflow.approve',
      'system.workflow.reject',
      'system.document.cancel',
      'system.document.print',
      'master.item.view',
      'master.partner.view',
      'master.category.view',
      'master.uom.view',
    ],
  },
  {
    code: 'WAREHOUSE_OPERATOR',
    name: 'Warehouse Operator',
    description: 'Operational floor personnel handling storage, receiving, packing, and posting',
    isSystem: true,
    permissions: [
      'org.warehouse.view',
      'org.warehouse.post',
      'system.document.print',
      'master.item.view',
      'master.uom.view',
      'master.category.view',
    ],
  },
  {
    code: 'AUDITOR_READONLY',
    name: 'Auditor (Read-Only)',
    description: 'Read-only inspection and export rights for compliance and financial audit',
    isSystem: true,
    permissions: [
      'org.company.view',
      'org.company.export',
      'org.branch.view',
      'org.branch.export',
      'org.warehouse.view',
      'org.warehouse.export',
      'auth.user.view',
      'auth.user.export',
      'auth.role.view',
      'audit.log.view',
      'audit.log.export',
      'system.series.view',
      'system.document.print',
      'master.item.view',
      'master.item.export',
      'master.partner.view',
      'master.partner.export',
      'master.category.view',
      'master.uom.view',
    ],
  },
];
