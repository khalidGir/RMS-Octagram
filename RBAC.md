# Role-Based Access Control

## 1. Authorization Model

Authorization combines:

1. Platform role for Super Admin operations.
2. Tenant membership role for restaurant responsibilities.
3. Branch assignment for operational scope.
4. Feature settings for enabled modules.
5. Resource state for valid business transitions.

A role alone is never sufficient. Each request must pass all relevant checks.

## 2. Roles

### Super Admin

Platform operator. Can provision, suspend, and inspect tenants for support. Super Admin is not automatically a tenant employee and must use audited support access when viewing tenant-scoped operational data.

### Owner

Highest restaurant-level role. Can access all branches in the tenant by default, manage staff and settings, and view tenant-wide reporting.

### Manager

Operates assigned branches. Can manage catalog, inventory, ordinary orders, staff branch assignments, and reports within policy. Cannot verify bank/Telebirr proof, close/reopen a business day, provision tenants, or grant Owner/Super Admin privileges.

### Cashier

Operates POS and assigned-branch orders, opens/closes their cash shift, confirms cash, and completes Ready orders. Cannot review transfer proof, clear tables, change configuration, or manage inventory recipes.

### Kitchen Staff

Views assigned-branch/station tickets and updates kitchen status. Cannot see payment proof, full reports, or sensitive customer data beyond what ticket fulfillment requires.

### Waiter

Views assigned-branch Ready orders and table occupancy, completes/serves Ready orders, and clears an eligible table session after guests leave. Cannot see or act on payments, proof, prices, menu configuration, inventory, reports, or staff.

### Customer

Unauthenticated or short-lived guest context resolved from a table QR token or public pickup branch. Can browse the public menu, submit an order, upload proof for that order, and track that order using an opaque tracking token.

## 3. Permission Matrix

Legend: `A` all tenants/platform, `T` tenant-wide, `B` assigned branches, `O` own guest order, `-` denied.

| Capability | Super Admin | Owner | Manager | Cashier | Kitchen | Waiter | Customer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Provision/suspend tenant | A | - | - | - | - | - | - |
| Configure platform entitlements | A | - | - | - | - | - | - |
| Configure permitted tenant/branch features | - | T | B policy | - | - | - | - |
| Manage branches | - | T | - | - | - | - | - |
| Invite/assign staff | - | T | B, non-owner policy | - | - | - | - |
| Manage menu/catalog | support mode only | T | B | - | - | - | - |
| View public menu | public only | T | B | B | B | B | public context |
| Manage tables/QR codes | - | T | B | - | - | - | - |
| View table occupancy | - | T | B | B | - | B | O context only |
| Clear eligible table session | - | T | - | - | - | B | - |
| Create POS order | - | T | B | B | - | - | - |
| Create guest order | - | - | - | - | - | - | O |
| Edit unconfirmed order | - | T | B | B | - | - | policy-limited |
| Open/close own cash shift | - | T owner shift | - | B own | - | - | - |
| View shift reports | - | T | B read | own | - | - | - |
| Confirm cash payment | - | T with active shift | - | B with active shift | - | - | - |
| View/review/reject transfer proof | - | T | - | - | - | - | O upload only |
| Void confirmed order | - | T | B policy | - | - | - | - |
| View KDS queue | - | T | B | B read | B | Ready read | O status only |
| Advance Confirmed -> Preparing -> Ready | - | T | B | - | B | - | - |
| Complete/serve Ready order | - | T | B policy | B | - | B | - |
| Recall ticket | - | T | B policy | - | B | - | - |
| Manage inventory/recipes | - | T | B | - | - | - | - |
| Record stock adjustment | - | T | B | - | - | - | - |
| View branch reports | - | T | B | own shift only | - | - | - |
| View tenant-wide reports | - | T | - | - | - | - | - |
| Close/reopen business day | - | T | - | - | - | - | - |
| View audit logs | platform audit only | T | B limited | - | - | - | - |

## 4. Sensitive Action Rules

- Creating or promoting an Owner requires an existing Owner; Super Admin may intervene only through audited support procedures.
- Managers can invite Manager, Cashier, Kitchen Staff, and Waiter roles only within their assigned branches and cannot grant Owner.
- Payment approval cannot be performed by an unauthenticated user.
- Transfer verification is Owner-only for the pilot. Cash confirmation requires an active Cashier/Owner shift.
- Payment rejection requires a reason; customer tracking receives safe localized language rather than an internal note.
- Order voids after confirmation require a reason and create compensating inventory movements.
- Discount, refund, and void thresholds are tenant-configurable. Until configured, require Manager or Owner approval for refunds and post-confirmation voids.
- Staff cannot approve a payment for an order outside their assigned branch.
- Kitchen Staff see customer name/order number and fulfillment notes only; hide phone numbers and proof images.
- Super Admin menu-support access must be time-bound, purpose-labeled, menu-allowlisted and audited; it grants no general tenant operational access.

## 5. Enforcement Pattern

Each protected API handler applies:

```text
authenticate
-> resolve active tenant membership
-> resolve branch scope
-> verify role permission
-> verify feature enabled
-> load resource inside tenant/branch scope
-> validate requested state transition
-> execute and audit
```

Frontend route guards improve usability but provide no security guarantee. The API and database enforce access independently.

## 6. Required Authorization Tests

- Test every sensitive endpoint with each role.
- Test cross-tenant IDs and cross-branch IDs, including valid IDs obtained by another account.
- Test suspended users, memberships, tenants, and disabled branches.
- Test feature-disabled access.
- Test stale tokens after membership/role changes.
- Test customer tracking tokens against unrelated orders.
- Test guessed and malformed QR tokens.
- Test Super Admin support access and audit generation.

