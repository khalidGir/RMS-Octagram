# REST API Specification

## 1. Contract Rules

- Base path: `/api/v1`.
- JSON request and response bodies use `camelCase`.
- OpenAPI is generated from implementation and committed/exported for contract review.
- Staff authentication uses secure cookies; public order access uses opaque QR/tracking tokens.
- All mutating requests require CSRF protection where cookie authentication applies.
- Critical mutations require `Idempotency-Key`.
- Resource updates use an integer `version`; stale writes return `409 Conflict`.
- List endpoints use cursor pagination: `?limit=50&after=<opaqueCursor>`.
- Timestamps are ISO 8601 UTC strings.
- Money is `{ "amountMinor": 12500, "currency": "ETB" }` or clearly named equivalent fields.
- Clients do not submit authoritative tenant IDs, prices, totals, roles, or state transitions.

## 2. Standard Envelopes

Success:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_..."
  }
}
```

Error:

```json
{
  "error": {
    "code": "ORDER_VERSION_CONFLICT",
    "message": "The order changed. Refresh and try again.",
    "fieldErrors": {},
    "requestId": "req_..."
  }
}
```

Use stable machine-readable codes. Never expose stack traces, SQL errors, secrets, or cross-tenant resource existence.

## 3. Authentication and Session

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `POST` | `/auth/login` | Staff login; rate limited. |
| `POST` | `/auth/refresh` | Rotate refresh session. |
| `POST` | `/auth/logout` | Revoke current session and clear cookies. |
| `POST` | `/auth/logout-all` | Revoke all sessions for the user. |
| `GET` | `/auth/me` | User, memberships, roles, branch assignments, and effective features. |
| `POST` | `/auth/forgot-password` | Begin reset without revealing account existence. |
| `POST` | `/auth/reset-password` | Complete one-time reset and revoke old sessions. |

## 4. Platform and Tenancy

| Method | Path | Roles | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/platform/tenants` | Super Admin | Provision tenant and first owner invitation. |
| `GET` | `/platform/tenants` | Super Admin | List tenants by status/search. |
| `GET` | `/platform/tenants/:tenantId` | Super Admin | Tenant summary with audited access. |
| `PATCH` | `/platform/tenants/:tenantId/status` | Super Admin | Activate or suspend tenant. |
| `GET` | `/tenants/current` | Staff | Current tenant profile. |
| `PATCH` | `/tenants/current` | Owner | Update tenant settings. |
| `GET` | `/branches` | Staff | Authorized branches. |
| `POST` | `/branches` | Owner | Create branch. |
| `GET` | `/branches/:branchId` | Assigned staff | Branch details. |
| `PATCH` | `/branches/:branchId` | Owner/Manager policy | Update branch. |
| `GET` | `/branches/:branchId/features` | Assigned staff | Effective features. |
| `PUT` | `/branches/:branchId/features/:featureKey` | Owner/Manager | Set authorized override. |
| `GET` | `/memberships` | Owner/Manager | List scoped staff. |
| `POST` | `/memberships/invitations` | Owner/Manager | Invite within grant rules. |
| `PATCH` | `/memberships/:membershipId` | Owner/Manager | Role/status changes within grant rules. |
| `PUT` | `/memberships/:membershipId/branches` | Owner/Manager | Replace allowed branches. |

## 5. Catalog

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET/POST` | `/catalog/categories` | List/create tenant categories. |
| `PATCH/DELETE` | `/catalog/categories/:categoryId` | Update/retire category. |
| `GET/POST` | `/catalog/items` | Search/create items. |
| `GET/PATCH/DELETE` | `/catalog/items/:itemId` | Read/update/retire item. |
| `POST` | `/catalog/items/:itemId/variants` | Add variant. |
| `PATCH` | `/catalog/variants/:variantId` | Update variant. |
| `POST` | `/catalog/modifier-groups` | Create modifier group/options. |
| `PATCH` | `/catalog/modifier-groups/:groupId` | Update modifier rules. |
| `PUT` | `/branches/:branchId/menu-items/:itemId` | Branch price/availability override. |
| `GET` | `/public/branches/:branchSlug/menu` | Public branch menu and ordering policy. |

Catalog write endpoints are Owner/Manager only and tenant scoped. Public output excludes internal IDs/fields not required to order.

## 6. Tables and Sessions

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET/POST` | `/branches/:branchId/tables` | List/create tables. |
| `PATCH` | `/tables/:tableId` | Update table. |
| `POST` | `/tables/:tableId/qr-token` | Create/rotate opaque QR token. |
| `POST` | `/public/table-context/resolve` | Resolve QR token to safe branch/table/menu context. |
| `GET` | `/branches/:branchId/sessions` | List open sessions. |
| `POST` | `/tables/:tableId/sessions` | Staff opens a session. |
| `POST` | `/sessions/:sessionId/close` | Close a settled session. |

QR tokens are secrets: accept them in a POST body for resolution where practical and prevent them from appearing in server logs.

## 7. Orders

| Method | Path | Roles/context | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/public/orders` | Customer context | Create table/pickup order. Idempotent. |
| `GET` | `/public/orders/:trackingToken` | Customer context | Safe order tracking view. |
| `PATCH` | `/public/orders/:trackingToken` | Customer context | Policy-limited edit before confirmation. |
| `POST` | `/branches/:branchId/orders` | Cashier+ | Create POS order. Idempotent. |
| `GET` | `/branches/:branchId/orders` | Assigned staff | Filter by status/type/date/search. |
| `GET` | `/orders/:orderId` | Scoped staff | Detailed order. |
| `PATCH` | `/orders/:orderId` | Cashier+ | Edit allowed draft/unconfirmed order. |
| `POST` | `/orders/:orderId/confirm` | Cashier+ | Confirm under pay-later/manual staff policy. |
| `POST` | `/orders/:orderId/cancel` | Authorized actor | Cancel before confirmation. |
| `POST` | `/orders/:orderId/void` | Policy-authorized staff | Void with reason and compensations. |
| `POST` | `/orders/:orderId/split` | Manager/Cashier policy | Split eligible lines. |
| `POST` | `/orders/merge` | Manager/Cashier policy | Merge compatible unpaid orders. |

Representative create request:

```json
{
  "orderType": "PICKUP",
  "branchSlug": "bole-main",
  "customer": {
    "name": "Customer name",
    "phone": "+251..."
  },
  "pickupAt": "2026-08-19T12:30:00.000Z",
  "lines": [
    {
      "variantId": "uuid",
      "quantity": 2,
      "modifierOptionIds": ["uuid"],
      "notes": "No onions"
    }
  ]
}
```

Response returns server-calculated totals, current status, permitted next actions, and a customer tracking token exactly once where applicable.

## 8. Payments and Proof Uploads

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/public/orders/:trackingToken/payment-options` | Safe branch payment instructions and payable balance. |
| `POST` | `/public/orders/:trackingToken/payments/manual-transfer` | Create/reuse pending manual payment. |
| `POST` | `/public/payments/:paymentToken/proof-upload` | Obtain constrained presigned upload. |
| `POST` | `/public/payments/:paymentToken/proof-finalize` | Verify metadata/checksum and submit proof. Idempotent. |
| `POST` | `/orders/:orderId/payments/cash` | Cashier records cash and confirms order. |
| `GET` | `/branches/:branchId/payments?status=PENDING_VERIFICATION` | Cashier review queue. |
| `GET` | `/payments/:paymentId` | Authorized payment details. |
| `GET` | `/payments/:paymentId/proof-url` | Short-lived authorized proof URL. |
| `POST` | `/payments/:paymentId/approve` | Cashier/Manager approval. Idempotent. |
| `POST` | `/payments/:paymentId/reject` | Reject with required reason. Idempotent. |

Approval request:

```json
{
  "paymentVersion": 3,
  "orderVersion": 2,
  "note": "Matched external transaction reference"
}
```

Do not create a generic endpoint that lets clients set arbitrary payment status values.

## 9. Kitchen

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET/POST` | `/branches/:branchId/kitchen/stations` | List/configure stations. |
| `GET` | `/branches/:branchId/kitchen/tickets` | Authoritative queue by station/status. |
| `POST` | `/kitchen/tickets/:ticketId/start` | Queue to in-progress. |
| `POST` | `/kitchen/tickets/:ticketId/ready` | Mark ready. |
| `POST` | `/kitchen/tickets/:ticketId/complete` | Mark completed. |
| `POST` | `/kitchen/tickets/:ticketId/recall` | Recall with reason. |

WebSocket namespace: `/operations`.

Client subscribes with authenticated branch/station context; server emits small invalidation events:

```json
{
  "id": "event_uuid",
  "type": "ticket.updated",
  "branchId": "uuid",
  "resourceId": "ticket_uuid",
  "occurredAt": "2026-08-19T10:00:00.000Z"
}
```

The client refetches the resource/queue; events are not the sole source of state.

## 10. Inventory

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET/POST` | `/branches/:branchId/inventory/items` | List/create items. |
| `PATCH` | `/inventory/items/:itemId` | Update threshold/settings. |
| `POST` | `/inventory/items/:itemId/batches` | Receive a batch. |
| `GET` | `/inventory/items/:itemId/movements` | Ledger history. |
| `POST` | `/inventory/items/:itemId/adjustments` | Audited adjustment. Idempotent. |
| `GET/PUT` | `/catalog/variants/:variantId/recipe` | Read/version recipe. |
| `GET` | `/branches/:branchId/inventory/alerts` | Low-stock list. |

## 11. Reporting and Audit

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/reports/revenue` | Branch or authorized tenant aggregate. |
| `GET` | `/reports/best-sellers` | Quantity and revenue by item snapshot. |
| `GET` | `/reports/peak-hours` | Branch-local hourly aggregates. |
| `GET` | `/reports/inventory-consumption` | Movement-ledger aggregate. |
| `GET` | `/audit-logs` | Owner or scoped manager audit view. |

Common report parameters: `branchId`, `fromLocalDate`, `toLocalDate`, `timezone`. API validates scope and returns the effective timezone and UTC range.

## 12. Health and Operations

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/health/live` | Process liveness only. |
| `GET` | `/health/ready` | Required dependency readiness. |
| `GET` | `/version` | Non-secret release identifier. |

## 13. HTTP Status Guidance

- `200/201/204`: successful request.
- `400`: malformed request.
- `401`: authentication missing/invalid.
- `403`: authenticated but not allowed.
- `404`: resource absent or intentionally hidden across scope.
- `409`: version, state, duplicate, or idempotency conflict.
- `413/415`: upload too large or unsupported type.
- `422`: valid JSON that violates business rules.
- `429`: rate limited.
- `500`: unexpected failure with request ID.
- `503`: temporary dependency/readiness failure.

## 14. Contract Completion Criteria

- Every endpoint has Zod/class-validator input validation and serialized output.
- Every protected endpoint documents roles and branch scope.
- Every mutation documents state transitions, idempotency, and audit behavior.
- OpenAPI examples use ETB integer amounts.
- API integration tests cover happy path, invalid transition, stale version, duplicate idempotency key, cross-branch access, and cross-tenant access.

## 15. Product v0.2 Contract Amendments

The following routes and rules supersede conflicting role or public-context examples above. Final names are reflected in generated OpenAPI before frontend integration.

### Localization and public entry

| Method | Path | Context | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/public/restaurants/:publicSlug` | Public | Safe active restaurant/branch identity, locale availability and pickup policy. |
| `GET` | `/public/restaurants/:publicSlug/menu` | Public | Pickup-only localized menu and bank/Telebirr methods. |
| `POST` | `/public/table-context/resolve` | QR token body | Safe table identity, localized menu context and configured dine-in/takeaway methods. |
| `PUT` | `/me/preferences/locale` | Staff | Persist `en`, `am`, or `ar`. |

Public responses accept `Accept-Language` or explicit validated locale and return `contentLocale` plus fallback metadata where translated restaurant content is incomplete.

### Route-bound order creation

Separate commands prevent a client from manufacturing entry context:

| Method | Path | Allowed choices |
| :--- | :--- | :--- |
| `POST` | `/public/table-orders` | Verified QR token; DINE_IN or TAKEAWAY; configured cash/bank/Telebirr. |
| `POST` | `/public/pickup-orders` | Verified public slug/branch resolver; PICKUP; bank/Telebirr only. |

Both require `Idempotency-Key` and return immutable subtotal, VAT rate/amount, total, instruction snapshot identifier and tracking token exactly once. Public pickup rejects cash even when a crafted request includes it.

### VAT configuration

| Method | Path | Role | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/tenants/current/tax-configurations` | Owner | Current/history VAT configuration. |
| `POST` | `/tenants/current/tax-configurations` | Owner | Add future/current version with confirmation metadata. |
| `GET` | `/branches/:branchId/checkout-policy` | Scoped staff | Effective tax/payment/day-boundary policy. |

Money fields are decimal strings for transport where BigInt applies. Rate fields use decimal strings, never binary floats. Service charge is absent from public configuration and always zero in legacy stored fields.

### Owner-only transfer review

`GET /branches/:branchId/payments`, proof access, approve and reject operations for `BANK_TRANSFER` or `TELEBIRR` require Owner. Manager/Cashier/Super Admin receive scope-safe denial. Rejection requires a reason; public tracking receives localized safe status rather than the internal note.

### Cashier shifts

| Method | Path | Role | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/branches/:branchId/shifts/current` | Cashier/Owner | Current actor shift. |
| `POST` | `/branches/:branchId/shifts` | Cashier/Owner | Open one shift; idempotent. |
| `GET` | `/branches/:branchId/shifts` | Owner/Manager read policy | Paginated scoped history. |
| `GET` | `/shifts/:shiftId` | Owner/own Cashier | Shift details/current calculated summary. |
| `POST` | `/shifts/:shiftId/close` | Owner/own Cashier | Close with counted cash and variance reason; idempotent/versioned. |
| `GET` | `/shifts/:shiftId/report` | Owner/own Cashier | Immutable printable report data. |

Cash confirmation endpoints derive the active shift from server membership/branch context and reject `SHIFT_REQUIRED` when absent. Clients cannot submit arbitrary shift IDs to reattribute payment.

### Table sessions and waiter operations

| Method | Path | Role | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/branches/:branchId/table-operations` | Owner/Manager/Cashier/Waiter policy | Safe occupancy and Ready-order projection. |
| `GET` | `/sessions/:sessionId` | Scoped staff | Session and terminal eligibility. |
| `POST` | `/sessions/:sessionId/clear` | Owner/Waiter | Clear after all linked orders terminal; versioned/idempotent. |
| `POST` | `/orders/:orderId/complete` | Owner/Manager/Cashier/Waiter | Complete Ready order under role policy. |

Scanning a QR or creating a draft never opens a session. Session assignment occurs transactionally when the first dine-in order is confirmed.

### Business-day close

| Method | Path | Role | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/branches/:branchId/business-days/:localDate/preview` | Owner | Exact current totals, blockers and exception items. |
| `POST` | `/branches/:branchId/business-days/:localDate/close` | Owner | Normal or exception close with expected version/reason. |
| `GET` | `/branches/:branchId/business-days/:localDate` | Owner | Immutable close snapshot/history. |
| `POST` | `/business-days/:closeId/reopen` | Owner | Reopen with mandatory reason; audited/versioned. |
| `GET` | `/business-days/:closeId/report` | Owner | Printable/downloadable snapshot data. |

Normal close returns a stable business error listing blocker counts/links when shifts or pending payments remain. Pending totals are excluded from recognized income.

### Super-admin menu support context

| Method | Path | Role | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/platform/support-contexts` | Super Admin | Enter selected tenant menu-support mode with reason and short expiry. |
| `GET` | `/platform/support-contexts/current` | Super Admin | Current target and expiry. |
| `DELETE` | `/platform/support-contexts/:contextId` | Super Admin | Explicitly leave/revoke context. |
| catalog routes | Existing catalog mutations | Super Admin with active context | Menu-only operations against selected tenant. |

Support context is carried in a secure server-validated session/header binding and cannot authorize other tenant modules. Operational routes reject it even when a valid tenant ID is known.

### Customer tracking and real-time

- Tracking remains available through opaque token reads.
- If token-scoped WebSocket/SSE is implemented, authentication uses the tracking token only for that order and emits invalidation/status data without proof or private customer fields.
- Polling fallback is 20-30 seconds with backoff/jitter and authoritative refetch after reconnect.
- Staff mutation endpoints return no optimistic success when server acknowledgement is unavailable.

### New stable errors

- `PUBLIC_CONTEXT_ORDER_TYPE_DENIED`
- `PUBLIC_CONTEXT_PAYMENT_METHOD_DENIED`
- `SHIFT_REQUIRED`
- `SHIFT_ALREADY_OPEN`
- `SHIFT_VARIANCE_REASON_REQUIRED`
- `TABLE_SESSION_NOT_CLEARABLE`
- `BUSINESS_DAY_BLOCKED`
- `BUSINESS_DAY_ALREADY_CLOSED`
- `SUPPORT_CONTEXT_REQUIRED`
- `SUPPORT_OPERATION_DENIED`
- `TRANSLATION_FALLBACK_USED` is metadata, not an error.

