# Frontend Role Completion

The frontend is complete as a mock-data-driven integration target. Backend calls remain behind frontend-facing boundaries and can replace fixtures without redesigning the product flows.

## Role coverage

| Role | Completed UI workflows |
| --- | --- |
| Super Admin | Tenant operations, provisioning entry point, status overview, feature entitlements, tenant settings, branch overrides, dependency states, and audit-history entry point |
| Owner | Multi-branch dashboard, catalog, orders, tables/QR, inventory batches, reports, team, branches, branding, modules, account, and notifications |
| Manager | Assigned-branch operations, branch switching, staff invitations/assignments, tables, menu, inventory, reports, payments, and settings |
| Cashier | Touch POS, order list/detail, editing controls, bill split/merge, manual-payment review, shift reconciliation, and kitchen handoff |
| Kitchen Staff | Detailed tickets, preparation notes, elapsed-time warnings, bump, complete, and recall controls |
| Customer | Public menu, cart, checkout, cash/manual-transfer choice, payment instructions, proof upload, confirmation, and live order tracking |

## Integration routes

- `/platform` and `/platform/features`
- `/`, `/reports`, `/settings`, `/team`, `/tables`, `/inventory`, `/menu`
- `/pos`, `/orders`, `/orders/[orderId]`, `/payments`, `/shifts`
- `/kitchen`
- `/order/[branchSlug]`, `/checkout`, `/payment`, `/track`
- `/account` and `/states`

## Integration expectations

- Replace fixtures with API adapters while preserving component-facing models.
- Resolve role and branch context from authenticated claims rather than the preview selector.
- Apply server-authoritative permission checks even though navigation is role filtered.
- Replace simulated real-time updates with WebSocket events.
- Replace the proof file picker preview with signed object-storage uploads.
- Map loading, empty, error, disconnected, conflict, and forbidden responses to the reusable state patterns shown at `/states`.

## Quality gate

- Production build: passed
- TypeScript: passed
- ESLint: passed
- Responsive matrix: 48 route/viewport combinations, no horizontal overflow
- Tested viewport classes: phone, tablet, and desktop
- Tested interactions: role redirects, cashier payment resolution, kitchen bump, customer payment selection/tracking, and platform navigation
