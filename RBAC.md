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

Operates assigned branches. Can manage catalog, inventory, orders, staff branch assignments, payments, and reports within policy. Cannot provision tenants or grant Owner/Super Admin privileges.

### Cashier

Operates POS and assigned-branch orders, records cash, reviews manual transfers, and performs allowed order actions. Cannot change configuration or inventory recipes.

### Kitchen Staff

Views assigned-branch/station tickets and updates kitchen status. Cannot see payment proof, full reports, or sensitive customer data beyond what ticket fulfillment requires.

### Customer

Unauthenticated or short-lived guest context resolved from a table QR token or public pickup branch. Can browse the public menu, submit an order, upload proof for that order, and track that order using an opaque tracking token.

## 3. Permission Matrix

Legend: `A` all tenants/platform, `T` tenant-wide, `B` assigned branches, `O` own guest order, `-` denied.

| Capability | Super Admin | Owner | Manager | Cashier | Kitchen | Customer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Provision/suspend tenant | A | - | - | - | - | - |
| Configure tenant features | A | T | B overrides | - | - | - |
| Manage branches | A audited | T | - | - | - | - |
| Invite staff | A audited | T | B, non-owner | - | - | - |
| Assign branch access | A audited | T | B, non-owner | - | - | - |
| Manage menu/catalog | A audited | T | B | - | - | - |
| View public menu | A | T | B | B | B | public branch |
| Manage tables/QR codes | A audited | T | B | - | - | - |
| Create POS order | - | T | B | B | - | - |
| Create guest order | - | - | - | - | - | O |
| Edit unconfirmed order | - | T | B | B | - | O, policy-limited |
| Confirm cash payment | - | T | B | B | - | - |
| Review transfer proof | - | T | B | B | - | - |
| View transfer proof | A audited | T | B | B | - | O upload only |
| Reject transfer proof | - | T | B | B | - | - |
| Void confirmed order | - | T | B | B with policy | - | - |
| View KDS queue | - | T | B | B read | B | O status only |
| Advance KDS status | - | T | B | - | B | - |
| Recall ticket | - | T | B | - | B | - |
| Manage inventory/recipes | A audited | T | B | - | - | - |
| Record stock adjustment | - | T | B | - | - | - |
| View branch reports | A audited | T | B | limited shift | - | - |
| View tenant-wide reports | A audited | T | - | - | - | - |
| View audit logs | A audited | T | B limited | - | - | - |

## 4. Sensitive Action Rules

- Creating or promoting an Owner requires an existing Owner; Super Admin may intervene only through audited support procedures.
- Managers can invite Manager, Cashier, and Kitchen Staff roles only for branches they manage.
- Payment approval cannot be performed by an unauthenticated user.
- Payment rejection requires a reason visible to the customer in safe language.
- Order voids after confirmation require a reason and create compensating inventory movements.
- Discount, refund, and void thresholds are tenant-configurable. Until configured, require Manager or Owner approval for refunds and post-confirmation voids.
- Staff cannot approve a payment for an order outside their assigned branch.
- Kitchen Staff see customer name/order number and fulfillment notes only; hide phone numbers and proof images.
- Super Admin data access must be time-bound, purpose-labeled, and audited.

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

