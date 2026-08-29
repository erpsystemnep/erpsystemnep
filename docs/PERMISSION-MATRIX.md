# Permission Matrix & Access Control Policy

**Status**: Active / Foundational Blueprint  
**Model**: Granular Role-Based Access Control (RBAC) with Hierarchical Organizational Scoping

---

## 1. Permission Naming Standard & Approved Action Primitives

All atomic permissions strictly follow the standard format:
`<module>.<resource>.<action>`

### Approved Action Primitives:
1. `view`: Inspect/read resource details and listings.
2. `create`: Author/draft a new record.
3. `edit`: Modify an unapproved/draft record.
4. `delete`: Remove/void an unposted draft record.
5. `export`: Download/extract structured reports and sensitive datasets.
6. `approve`: Formally authorize a submitted document (Subject to Segregation of Duties).
7. `reject`: Decline an authorization request and return to draft/cancelled.
8. `post`: Commit a document to the General Ledger or Stock Ledger (Immutable).
9. `cancel`: Void an approved or in-progress operational document before posting.
10. `reverse`: Generate an explicit compensating reversal for a posted transaction.
11. `print`: Render official customer/vendor or statutory printed documents.

---

## 2. Foundational Permission Keys Matrix

| Module | Resource | Action | Permission Key | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`org`** | `company` | view | `org.company.view` | View company profile and settings |
| **`org`** | `company` | create | `org.company.create` | Provision new operating company |
| **`org`** | `company` | edit | `org.company.edit` | Update company legal details and parameters |
| **`org`** | `branch` | view | `org.branch.view` | View branches in authorized companies |
| **`org`** | `branch` | create | `org.branch.create` | Create new operating branches |
| **`org`** | `branch` | edit | `org.branch.edit` | Edit branch configurations |
| **`org`** | `warehouse`| view | `org.warehouse.view` | View warehouses and storage bins |
| **`org`** | `warehouse`| create | `org.warehouse.create` | Provision warehouses |
| **`org`** | `warehouse`| edit | `org.warehouse.edit` | Modify warehouse parameters |
| **`auth`** | `user` | view | `auth.user.view` | View user directory |
| **`auth`** | `user` | create | `auth.user.create` | Provision user identities |
| **`auth`** | `user` | edit | `auth.user.edit` | Update user status and profiles |
| **`auth`** | `role` | view | `auth.role.view` | View roles and permission assignments |
| **`auth`** | `role` | create | `auth.role.create` | Create custom company roles |
| **`auth`** | `role` | edit | `auth.role.edit` | Modify role permission mappings |
| **`auth`** | `role` | delete | `auth.role.delete` | Delete unassigned custom roles |
| **`audit`**| `log` | view | `audit.log.view` | Inspect system-wide audit logs |
| **`audit`**| `log` | export | `audit.log.export` | Export audit trails for compliance |
| **`system`**| `series` | view | `system.series.view` | View document numbering configurations |
| **`system`**| `series` | edit | `system.series.edit` | Configure numbering series templates |

---

## 3. System Default Roles & Scopes

### Role 1: Super Administrator (`SUPERADMIN`)
- **Scope**: Platform-wide across all companies.
- **Permissions**: Wildcard `*` across all modules.
- **Purpose**: System setup, database migrations, cross-company provisioning.

### Role 2: Company Administrator (`COMPANY_ADMIN`)
- **Scope**: Bound to a specific `company_id`.
- **Permissions**: Full manage access within the scoped company (`org.*`, `auth.*`, `audit.log.view`).
- **Purpose**: Company executive or IT administrator managing local branch master data and local user assignments.

### Role 3: Branch Manager (`BRANCH_MANAGER`)
- **Scope**: Bound to a specific `company_id` and specific `branch_id`.
- **Permissions**: View/manage local branch transactions and warehouse resources. Cannot alter company-wide accounting settings.

### Role 4: Warehouse Operator (`WAREHOUSE_OPERATOR`)
- **Scope**: Bound to assigned `warehouse_id` / `branch_id`.
- **Permissions**: Stock movements, physical counts, picking, packing. No access to financial margins or system configuration.

### Role 5: Auditor / Read-Only (`AUDITOR_READONLY`)
- **Scope**: Scoped per company.
- **Permissions**: `*.view` permissions only; no create, update, delete, or posting privileges.

---

## 4. Server-Side Enforcement Rules

1. Every private route executes two verification steps:
   - **Step 1: Identity & Company Membership Verification**: Confirms token validity and ensures the user has an active assignment in the targeted `X-Company-Id`.
   - **Step 2: Scoped Permission Evaluation**: Confirms that the role assigned to the user in that company (and branch) contains the explicit permission required.
2. If authorization fails, the server responds with an unambiguous `403 Forbidden` including the missing permission identifier.
