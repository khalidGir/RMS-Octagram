# SPEC-001: API Contract Handoff

> **Status**: DRAFT — awaiting review
> **Author**: opencode (backend agent)
> **Date**: 2026-09-17
> **Purpose**: Authoritative API contract for the frontend agent. Every endpoint, every shape, every guard. No guessing.

---

## 1. Base Configuration

| Property | Value |
|----------|-------|
| Base URL | `http://localhost:3001` |
| Global prefix | `/api/v1` |
| WebSocket namespace | `/kds` |
| OpenAPI docs | `http://localhost:3001/docs` |
| CORS | Configurable via `API_CORS_ORIGIN` env (default: `http://localhost:3000`), credentials: true |
| Validation | `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, implicit conversion enabled |

---

## 2. Authentication

### 2.1 Login Flow

```
POST /api/v1/auth/login
Body: { email: string, password: string }
Response: { data: { accessToken: string, csrfToken: string } }
Set-Cookie: refresh_token (httpOnly, 7-day expiry, SameSite=lax)
Rate limit: 10 requests per 60 seconds per IP
```

### 2.2 Token Usage

| Token | Where | Purpose |
|-------|-------|---------|
| `accessToken` | `Authorization: Bearer <token>` header | All authenticated requests |
| `refresh_token` | httpOnly cookie (auto-sent) | Token rotation |
| `csrfToken` | `X-CSRF-Token` header (state-changing requests over cookie) | CSRF protection |

### 2.3 Token Refresh

```
POST /api/v1/auth/refresh
Cookie: refresh_token (auto-sent by browser)
Response: { data: { accessToken: string, csrfToken: string } }
Set-Cookie: refresh_token (rotated)
```

### 2.4 Profile

```
GET /api/v1/auth/me
Headers: Authorization: Bearer <token>
Response: { data: { id, email, tenantId, role, branchIds, ... } }
```

### 2.5 Logout

```
POST /api/v1/auth/logout          — revoke current session
POST /api/v1/auth/logout-all      — revoke all sessions (requires JWT)
```

---

## 3. Standard Envelope

### 3.1 Success

All endpoints (except health and some payments) return:

```json
{ "data": <payload> }
```

Payload types:
- **Single object**: `{ data: { id, name, ... } }`
- **Array**: `{ data: [{ id, ... }, ...] }`
- **Void/boolean**: `{ data: { success: true } }`
- **Paginated**: `{ data: [{ ... }], nextCursor?: string }` (cursor-based)

### 3.2 Error (NestJS default — no custom exception filter)

```json
{
  "statusCode": 400,
  "message": "Validation failed" | ["field must be a string", ...],
  "error": "Bad Request"
}
```

Special cases:
- **409 Conflict** for version conflicts:
  ```json
  {
    "statusCode": 409,
    "message": {
      "code": "VERSION_CONFLICT",
      "message": "Ticket has been modified. Please refresh.",
      "currentVersion": 5
    },
    "error": "Conflict"
  }
  ```
- **429 Too Many Requests**:
  ```json
  {
    "statusCode": 429,
    "message": "Too many requests. Retry after 30 seconds.",
    "error": "Too Many Requests",
    "retryAfter": 30
  }
  ```

### 3.3 Health (no data wrapper)

```
GET /api/v1/health/live   → { status: "ok", timestamp: string }
GET /api/v1/health/ready  → { status: "ok", version, timestamp, checks: { postgres, redis } }
                           → 503 if degraded: { status: "degraded", ... }
```

---

## 4. Pagination

Cursor-based. The `after` parameter is an entity ID (not an offset).

**Request**:
```
GET /api/v1/branches/:branchId/orders?limit=20&after=<lastOrderId>&status=CONFIRMED
```

**Response**:
```json
{
  "data": [ { "id": "abc", ... }, ... ],
  "nextCursor": "def"   // absent if no more pages
}
```

**Rules**:
- Default limit: 50 (varies by endpoint)
- Max limit: 100
- `after` is exclusive (results come AFTER this ID)
- Always sort by `createdAt asc` or `id asc` for stable pagination

---

## 5. Branch Scoping

~78 endpoints are branch-scoped. Pattern:

```
/api/v1/branches/:branchId/<resource>
```

The `:branchId` parameter is **validated server-side** against the caller's membership:
- The JWT contains `tenantId` and `branchIds[]`
- `BranchScopeGuard` verifies the URL `branchId` is in the caller's `branchIds`
- **Exception**: OWNER and MANAGER can access any branch within their tenant

---

## 6. Role Taxonomy

| Role | Scope | Typical Permissions |
|------|-------|-------------------|
| `SUPER_ADMIN` | Platform | All tenants, user management, support context |
| `OWNER` | Tenant | Everything within tenant, billing, feature flags |
| `MANAGER` | Tenant/Branch | Catalog, kitchen config, reports, payments review |
| `CASHIER` | Branch | Orders, payments, shifts, tables |
| `KITCHEN_STAFF` | Branch | KDS tickets, stations, bump/recall/complete |
| `WAITER` | Branch | Service board, order collection, serving |

### 6.1 Authorization Model

- `JwtAuthGuard` — validates JWT, attaches `req.user`
- `RolesGuard` — checks `@Roles(...)` decorator against `req.user.role`
- `BranchScopeGuard` — validates branch membership
- `FeatureEnabledGuard` — checks feature entitlement before handler

---

## 7. Feature Gates

Some endpoints require an active feature entitlement:

| Feature Key | Gated Endpoints |
|------------|----------------|
| `KDS` | All kitchen ticket endpoints, KDS devices, service notifications |
| `INVENTORY` | All inventory items/movements/adjustments/waste, recipes |
| `BATCH_INVENTORY` | Inventory batch receiving |
| `ANALYTICS` | All `/api/v1/reports/*` endpoints |

**Response when feature disabled**:
```json
{
  "statusCode": 403,
  "message": "Feature KDS is not enabled for this tenant",
  "error": "Feature Disabled"
}
```

---

## 8. Rate Limiting

Per-route via `@Throttle()` decorator. Not global.

| Endpoint | TTL | Limit | Name |
|----------|-----|-------|------|
| `POST /auth/login` | 60s | 10 | `login` |
| Other routes | — | — | No limit (unless decorated) |

Rate limit key: `{name}:{clientIp}:{tenantId}:{userId}`

---

## 9. Complete Endpoint Reference

### 9.1 Health (PUBLIC)

| Method | Path | Auth | Response |
|--------|------|------|----------|
| `GET` | `/api/v1/health/live` | None | `{ status, timestamp }` |
| `GET` | `/api/v1/health/ready` | None | `{ status, version, timestamp, checks }` — 503 if degraded |

### 9.2 Auth

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| `POST` | `/api/v1/auth/login` | None | `{ email, password }` | `{ data: { accessToken, csrfToken } }` + cookie |
| `POST` | `/api/v1/auth/refresh` | Cookie | — | `{ data: { accessToken, csrfToken } }` + cookie |
| `POST` | `/api/v1/auth/logout` | Cookie | — | `{ data: { success: true } }` |
| `POST` | `/api/v1/auth/logout-all` | JWT | — | `{ data: { success: true } }` |
| `GET` | `/api/v1/auth/me` | JWT | — | `{ data: { id, email, tenantId, role, branchIds } }` |

### 9.3 Tenancy & Branches

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/tenants/current` | JWT | Any | — | `{ data: tenant }` |
| `PATCH` | `/api/v1/tenants/current` | JWT | OWNER | UpdateTenantDto | `{ data: tenant }` |
| `GET` | `/api/v1/branches` | JWT | Any | — | `{ data: branch[] }` |
| `POST` | `/api/v1/branches` | JWT | OWNER | CreateBranchDto | `{ data: branch }` |
| `PATCH` | `/api/v1/branches/:branchId` | JWT+BranchScope | OWNER, MANAGER | UpdateBranchDto | `{ data: branch }` |

### 9.4 Memberships & Invitations

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/memberships` | JWT+Roles | OWNER, MANAGER | — | `{ data: membership[] }` |
| `POST` | `/api/v1/memberships/invitations` | JWT+Roles | OWNER, MANAGER | `{ email, role, branchIds }` | `{ data: invitation }` |
| `POST` | `/api/v1/memberships/accept-invitation` | JWT | Any | `{ invitationToken }` | `{ data: membership }` |
| `PATCH` | `/api/v1/memberships/:membershipId` | JWT+Roles | OWNER, MANAGER | `{ role, status }` | `{ data: membership }` |
| `PUT` | `/api/v1/memberships/:membershipId/branches` | JWT+Roles | OWNER, MANAGER | `{ branchIds }` | `{ data: { success: true } }` |

### 9.5 Feature Entitlements (Tenant)

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/tenants/features` | JWT+Roles | OWNER, MANAGER | — | `{ data: feature[] }` |
| `PUT` | `/api/v1/tenants/features/:featureKey` | JWT+Roles | OWNER | `{ enabled: boolean }` | `{ data: feature }` |
| `GET` | `/api/v1/branches/:branchId/features` | JWT | Any | — | `{ data: feature[] }` |
| `PUT` | `/api/v1/branches/:branchId/features/:featureKey` | JWT+Roles | OWNER, MANAGER | `{ enabled: boolean }` | `{ data: feature }` |

### 9.6 Catalog (Categories, Items, Variants, Modifiers)

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/categories` | JWT | Any | — | `{ data: category[] }` |
| `POST` | `/api/v1/categories` | JWT+Roles | OWNER, MANAGER | CreateCategoryDto | `{ data: category }` |
| `PATCH` | `/api/v1/categories/:categoryId` | JWT+Roles | OWNER, MANAGER | UpdateCategoryDto | `{ data: category }` |
| `DELETE` | `/api/v1/categories/:categoryId` | JWT+Roles | OWNER | — | `{ data: { success: true } }` |
| `GET` | `/api/v1/items` | JWT | Any | `?categoryId?` | `{ data: item[] }` |
| `GET` | `/api/v1/items/:itemId` | JWT | Any | — | `{ data: item }` |
| `POST` | `/api/v1/items` | JWT+Roles | OWNER, MANAGER | CreateItemDto | `{ data: item }` |
| `PATCH` | `/api/v1/items/:itemId` | JWT+Roles | OWNER, MANAGER | UpdateItemDto | `{ data: item }` |
| `DELETE` | `/api/v1/items/:itemId` | JWT+Roles | OWNER | — | `{ data: { success: true } }` |
| `GET` | `/api/v1/items/:itemId/variants` | JWT | Any | — | `{ data: variant[] }` |
| `POST` | `/api/v1/items/:itemId/variants` | JWT+Roles | OWNER, MANAGER | CreateVariantDto | `{ data: variant }` |
| `PATCH` | `/api/v1/variants/:variantId` | JWT+Roles | OWNER, MANAGER | UpdateVariantDto | `{ data: variant }` |
| `DELETE` | `/api/v1/variants/:variantId` | JWT+Roles | OWNER | — | `{ data: { success: true } }` |
| `GET` | `/api/v1/modifier-groups` | JWT | Any | — | `{ data: modifierGroup[] }` |
| `POST` | `/api/v1/modifier-groups` | JWT+Roles | OWNER, MANAGER | CreateModifierGroupDto | `{ data: modifierGroup }` |
| `PATCH` | `/api/v1/modifier-groups/:groupId` | JWT+Roles | OWNER, MANAGER | CreateModifierGroupDto | `{ data: modifierGroup }` |
| `POST` | `/api/v1/modifier-groups/:groupId/options` | JWT+Roles | OWNER, MANAGER | CreateModifierOptionDto | `{ data: modifierOption }` |
| `PATCH` | `/api/v1/modifier-options/:optionId` | JWT+Roles | OWNER, MANAGER | CreateModifierOptionDto | `{ data: modifierOption }` |
| `POST` | `/api/v1/items/:itemId/modifier-groups` | JWT+Roles | OWNER, MANAGER | `{ modifierGroupId, sortOrder? }` | `{ data: link }` |
| `PUT` | `/api/v1/items/:itemId/branches/:branchId/availability` | JWT+BranchScope | OWNER, MANAGER | SetBranchAvailabilityDto | `{ data: availability }` |
| `GET` | `/api/v1/branches/:branchId/menu` | JWT+BranchScope | Any | — | `{ data: branchMenu }` |

### 9.7 Orders

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `POST` | `/api/v1/branches/:branchId/orders` | JWT+BranchScope | OWNER, MANAGER, CASHIER | `{ lines[], notes?, orderType, tableId?, idempotencyKey?, quotedTotal? }` | `{ data: order }` |
| `GET` | `/api/v1/branches/:branchId/orders` | JWT+BranchScope | Any | `?status?, orderType?, from?, to?, limit?, after?` | `{ data: order[] }` |
| `GET` | `/api/v1/orders/:orderId` | JWT+BranchScope | Any | — | `{ data: order }` |
| `PATCH` | `/api/v1/orders/:orderId` | JWT+BranchScope | OWNER, MANAGER, CASHIER | `{ lines[], notes?, expectedVersion, idempotencyKey? }` | `{ data: order }` |
| `POST` | `/api/v1/orders/:orderId/confirm` | JWT+BranchScope | OWNER, MANAGER, CASHIER | `{ note? }` | **501 Not Implemented** |
| `POST` | `/api/v1/orders/:orderId/complete` | JWT+BranchScope | OWNER, MANAGER, CASHIER, WAITER | `{ expectedVersion }` | `{ data: order }` |
| `POST` | `/api/v1/orders/:orderId/cancel` | JWT+BranchScope | OWNER, MANAGER, CASHIER | `{ reason?, expectedVersion }` | `{ data: order }` |

**Order types**: `POS`, `DINE_IN`, `TAKEAWAY`, `QR_PICKUP`
**Order statuses**: `PENDING_CONFIRMATION` → `CONFIRMED` → `READY` → `COMPLETED` / `CANCELLED`

**Fulfillment statuses**: `NOT_ROUTED` → `QUEUED` → `IN_PROGRESS` → `READY_FOR_SERVICE`

### 9.8 Public Orders (No Auth)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/v1/public/pickup-orders` | `{ branchId, lines[], customerName, customerPhone, pickupAt, notes?, idempotencyKey? }` | `{ data: { order, trackingToken } }` |
| `POST` | `/api/v1/public/orders` | `{ qrToken, lines[], orderType?, customerName?, customerPhone?, notes?, idempotencyKey? }` | `{ data: { order, trackingToken } }` |
| `GET` | `/api/v1/public/orders/:trackingToken` | — | `{ data: orderStatus }` |

### 9.9 Payments (Staff)

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/payment-instructions` | JWT+BranchScope | OWNER, MANAGER, CASHIER | — | `{ data: instruction[] }` |
| `POST` | `/api/v1/branches/:branchId/payment-instructions` | JWT+BranchScope | OWNER, MANAGER | CreatePaymentInstructionDto | `{ data: instruction }` |
| `PATCH` | `/api/v1/branches/:branchId/payment-instructions/:id` | JWT+BranchScope | OWNER, MANAGER | UpdatePaymentInstructionDto | `{ data: instruction }` |
| `DELETE` | `/api/v1/branches/:branchId/payment-instructions/:id` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: { deleted: true } }` |
| `GET` | `/api/v1/branches/:branchId/payments` | JWT+BranchScope | OWNER | `?status?, limit?, after?` | `{ data: payment[] }` |
| `GET` | `/api/v1/branches/:branchId/payments/:paymentId` | JWT+BranchScope | OWNER | — | `{ data: payment }` |
| `GET` | `/api/v1/branches/:branchId/payments/:paymentId/proof-url` | JWT+BranchScope | OWNER | — | `{ data: signedUrl }` |
| `POST` | `/api/v1/branches/:branchId/payments/cash` | JWT+BranchScope | OWNER, MANAGER, CASHIER | `{ orderId, idempotencyKey }` | `{ data: payment }` |
| `POST` | `/api/v1/branches/:branchId/payments/:paymentId/confirm-cash` | JWT+BranchScope | OWNER, CASHIER | — | `{ data: payment }` |
| `POST` | `/api/v1/branches/:branchId/payments/manual-transfer` | JWT+BranchScope | OWNER, MANAGER, CASHIER | `{ orderId, idempotencyKey, staffReference?, method? }` | `{ data: payment }` |
| `POST` | `/api/v1/branches/:branchId/payments/:paymentId/approve` | JWT+BranchScope | OWNER | `{ reviewNote? }` | `{ data: payment }` |
| `POST` | `/api/v1/branches/:branchId/payments/:paymentId/reject` | JWT+BranchScope | OWNER | `{ reason }` | `{ data: payment }` |

### 9.10 Public Payments (No Auth)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/v1/public/payment-options` | `{ trackingToken }` | `{ data: { orderId, totalMinor, currency, status, instructions[] } }` |
| `POST` | `/api/v1/public/payments/manual-transfer` | `{ trackingToken, idempotencyKey, customerReference?, method? }` | `{ data: payment }` |
| `POST` | `/api/v1/public/payments/proof-upload` | `{ paymentToken, contentType, sizeBytes, sha256 }` | `{ data: { mediaObjectId, uploadUrl, objectKey, fields, expiresIn } }` |
| `POST` | `/api/v1/public/payments/proof-finalize` | `{ paymentToken, mediaObjectId, customerReference? }` | `{ data: result }` |

### 9.11 Cash Shifts

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `POST` | `/api/v1/branches/:branchId/shifts/open` | JWT+BranchScope | OWNER, CASHIER | `{ openingCashMinor: string }` | `{ data: shift }` |
| `GET` | `/api/v1/branches/:branchId/shifts/current` | JWT+BranchScope | OWNER, CASHIER | — | `{ data: shift }` |
| `POST` | `/api/v1/branches/:branchId/shifts/:shiftId/close` | JWT+BranchScope | OWNER, CASHIER | `{ countedCashMinor: string, varianceReason?, expectedVersion }` | `{ data: shift }` |
| `GET` | `/api/v1/branches/:branchId/shifts/:shiftId/report` | JWT+BranchScope | OWNER, MANAGER, CASHIER | — | `{ data: report }` |
| `GET` | `/api/v1/branches/:branchId/shifts/reports` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: report[] }` |

**Important**: Money fields (`openingCashMinor`, `countedCashMinor`) are **strings** representing integer minor units. `"250000"` = 2,500.00 ETB.

### 9.12 Kitchens (CRUD)

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/kitchens` | JWT+BranchScope | Any | — | `{ data: kitchen[] }` |
| `POST` | `/api/v1/branches/:branchId/kitchens` | JWT+BranchScope | OWNER, MANAGER | `{ name, description?, collectionLabel?, displayOrder? }` | `{ data: kitchen }` |
| `PATCH` | `/api/v1/branches/:branchId/kitchens/:kitchenId` | JWT+BranchScope | OWNER, MANAGER | `{ name?, description?, collectionLabel?, displayOrder?, isActive? }` | `{ data: kitchen }` |
| `DELETE` | `/api/v1/branches/:branchId/kitchens/:kitchenId` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: { success: true } }` |

### 9.13 Kitchen Stations

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/kitchen-stations` | JWT+BranchScope | Any | — | `{ data: station[] }` |
| `POST` | `/api/v1/branches/:branchId/kitchen-stations` | JWT+BranchScope | OWNER, MANAGER | `{ name, displayOrder? }` | `{ data: station }` |
| `PATCH` | `/api/v1/branches/:branchId/kitchen-stations/:stationId` | JWT+BranchScope | OWNER, MANAGER | `{ name?, displayOrder?, isActive? }` | `{ data: station }` |
| `DELETE` | `/api/v1/branches/:branchId/kitchen-stations/:stationId` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: { success: true } }` |
| `POST` | `/api/v1/branches/:branchId/kitchen-stations/:stationId/menu-items` | JWT+BranchScope | OWNER, MANAGER | `{ menuItemId }` | `{ data: assignment }` |
| `DELETE` | `/api/v1/branches/:branchId/kitchen-stations/:stationId/menu-items/:menuItemId` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: { success: true } }` |
| `GET` | `/api/v1/branches/:branchId/kitchen-stations/:stationId/menu-items` | JWT+BranchScope | Any | — | `{ data: menuItem[] }` |

**Note**: Stations MUST belong to a kitchen (`kitchenId` is required for routing to work). The `createStation` API does not accept `kitchenId` — use the Kitchens CRUD first, then create stations. The station's kitchen assignment is implicit through branch + kitchen relationship.

### 9.14 Kitchen Tickets

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/kitchen-tickets` | JWT+BranchScope | Any | `?stationId?, status?, limit?, after?` | `{ data: ticket[] }` |
| `GET` | `/api/v1/branches/:branchId/kitchen-tickets/:ticketId` | JWT+BranchScope | Any | — | `{ data: ticket }` |
| `POST` | `/api/v1/branches/:branchId/kitchen-tickets/:ticketId/bump` | JWT+BranchScope | Any | `{ reason?, expectedVersion }` | `{ data: ticket }` |
| `POST` | `/api/v1/branches/:branchId/kitchen-tickets/:ticketId/recall` | JWT+BranchScope | Any | `{ reason?, expectedVersion }` | `{ data: ticket }` |
| `POST` | `/api/v1/branches/:branchId/kitchen-tickets/:ticketId/complete` | JWT+BranchScope | Any | `{ expectedVersion }` | `{ data: ticket }` |
| `POST` | `/api/v1/branches/:branchId/kitchen-tickets/:ticketId/cancel` | JWT+BranchScope | OWNER, MANAGER | `{ expectedVersion, reason? }` | `{ data: ticket }` |

**Ticket state machine**:
```
QUEUED → bump → IN_PROGRESS → bump → READY → complete → COMPLETED
                          ↑                    ↓
                          ←←←← recall ←←←←←←←
```

**Bump path**: `QUEUED → IN_PROGRESS → READY` (two bumps)

### 9.15 KDS Devices

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/kds-devices` | JWT+BranchScope | OWNER, MANAGER, KITCHEN_STAFF | — | `{ data: device[] }` |
| `POST` | `/api/v1/branches/:branchId/kds-devices` | JWT+BranchScope | OWNER, MANAGER | `{ name }` | `{ data: device }` |
| `PATCH` | `/api/v1/branches/:branchId/kds-devices/:deviceId` | JWT+BranchScope | OWNER, MANAGER | `{ name?, isActive? }` | `{ data: device }` |
| `DELETE` | `/api/v1/branches/:branchId/kds-devices/:deviceId` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: { success: true } }` |
| `POST` | `/api/v1/branches/:branchId/kds-devices/:deviceId/rotate-token` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: { newToken } }` |
| `POST` | `/api/v1/branches/:branchId/kds-devices/:deviceId/stations` | JWT+BranchScope | OWNER, MANAGER | `{ stationId, displayOrder? }` | `{ data: assignment }` |
| `DELETE` | `/api/v1/branches/:branchId/kds-devices/:deviceId/stations/:stationId` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: { success: true } }` |

### 9.16 Expo

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/expo/orders` | JWT+BranchScope | Any | `?updatedAfter?, limit?, after?` | `{ data: order[] }` |
| `GET` | `/api/v1/branches/:branchId/expo/orders/:orderId` | JWT+BranchScope | Any | — | `{ data: detail }` |
| `POST` | `/api/v1/branches/:branchId/expo/orders/:orderId/release` | JWT+BranchScope | OWNER, MANAGER, KITCHEN_STAFF | `{ expectedVersion }` | `{ data: result }` |
| `POST` | `/api/v1/branches/:branchId/expo/orders/:orderId/recall` | JWT+BranchScope | OWNER, MANAGER | `{ reason?, expectedVersion }` | `{ data: result }` |
| `POST` | `/api/v1/branches/:branchId/expo/orders/:orderId/collect` | JWT+BranchScope | Any (with role) | `{ expectedVersion }` | `{ data: result }` |

### 9.17 Waiter / Service Board

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/service-board` | JWT+BranchScope | Any | `?scope?, status?, updatedAfter?, limit?, after?` | `{ data: board }` |
| `POST` | `/api/v1/branches/:branchId/orders/:orderId/assign-waiter` | JWT+BranchScope | OWNER, MANAGER | `{ waiterUserId }` | `{ data: result }` |
| `POST` | `/api/v1/branches/:branchId/orders/:orderId/claim` | JWT+BranchScope | OWNER, MANAGER, WAITER | — | `{ data: result }` |
| `POST` | `/api/v1/branches/:branchId/orders/:orderId/collect` | JWT+BranchScope | Any (with role) | `{ expectedVersion }` | `{ data: result }` |
| `POST` | `/api/v1/branches/:branchId/orders/:orderId/serve` | JWT+BranchScope | Any (with role) | `{ expectedVersion }` | `{ data: result }` |
| `POST` | `/api/v1/branches/:branchId/orders/:orderId/serve-lines` | JWT+BranchScope | Any (with role) | `{ lineIds[], expectedVersion }` | `{ data: result }` |

### 9.18 Fulfillment Policy

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/fulfillment-policy` | JWT+BranchScope | Any | — | `{ data: policy }` |
| `PUT` | `/api/v1/branches/:branchId/fulfillment-policy` | JWT+BranchScope | OWNER, MANAGER | `{ serviceMode, expoMode, allowWaiterSelfClaim?, showUnassignedReadyOrdersToWaiters?, readyReminderSeconds?, readyEscalationSeconds?, autoCompleteKitchenTicketOnCollected? }` | `{ data: policy }` |

### 9.19 Routes (Menu Item → Station Routing)

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/routes` | JWT+BranchScope | Any | `?menuItemId?, stationId?, routeType?` | `{ data: route[] }` |
| `POST` | `/api/v1/branches/:branchId/routes` | JWT+BranchScope | OWNER, MANAGER | `{ menuItemId, stationId, routeType, isRequired, sortOrder? }` | `{ data: route }` |
| `PUT` | `/api/v1/branches/:branchId/routes/menu-items/:menuItemId` | JWT+BranchScope | OWNER, MANAGER | `{ routes[] }` | `{ data: route[] }` |
| `DELETE` | `/api/v1/branches/:branchId/routes/:menuItemId/:stationId/:routeType` | JWT+BranchScope | OWNER, MANAGER | — | `{ data: { success: true } }` |

**Route types**: `PREPARE` (kitchen prep), `ASSEMBLE` (assembly/pickup)

### 9.20 Service Notifications

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/service-notifications` | JWT+BranchScope+FeatureGate(KDS) | OWNER, MANAGER, WAITER | — | `{ data: notification[] }` |

### 9.21 Inventory

| Method | Path | Auth | Roles | Feature Gate | Body | Response |
|--------|------|------|-------|-------------|------|----------|
| `POST` | `/api/v1/branches/:branchId/inventory/items` | JWT+BranchScope | OWNER, MANAGER | INVENTORY | CreateInventoryItemDto | `{ data: item }` |
| `GET` | `/api/v1/branches/:branchId/inventory/items` | JWT+BranchScope | Any | INVENTORY | `?query` | `{ data: item[] }` |
| `PATCH` | `/api/v1/branches/:branchId/inventory/items/:itemId` | JWT+BranchScope | OWNER, MANAGER | INVENTORY | UpdateInventoryItemDto | `{ data: item }` |
| `POST` | `/api/v1/branches/:branchId/inventory/items/:itemId/batches` | JWT+BranchScope | OWNER, MANAGER | BATCH_INVENTORY | ReceiveBatchDto | `{ data: batch }` |
| `GET` | `/api/v1/branches/:branchId/inventory/items/:itemId/movements` | JWT+BranchScope | Any | INVENTORY | `?query` | `{ data: movement[] }` |
| `POST` | `/api/v1/branches/:branchId/inventory/items/:itemId/adjustments` | JWT+BranchScope | OWNER, MANAGER | INVENTORY | CreateAdjustmentDto | `{ data: adjustment }` |
| `POST` | `/api/v1/branches/:branchId/inventory/items/:itemId/waste` | JWT+BranchScope | OWNER, MANAGER | INVENTORY | CreateWasteDto | `{ data: wasteRecord }` |
| `GET` | `/api/v1/branches/:branchId/inventory/alerts` | JWT+BranchScope | Any | INVENTORY | `?query` | `{ data: alert[] }` |

### 9.22 Recipes

| Method | Path | Auth | Roles | Feature Gate | Body | Response |
|--------|------|------|-------|-------------|------|----------|
| `GET` | `/api/v1/branches/:branchId/catalog/variants/:variantId/recipe` | JWT+BranchScope | Any | INVENTORY | — | `{ data: recipe }` |
| `PATCH` | `/api/v1/branches/:branchId/catalog/variants/:variantId/recipe` | JWT+BranchScope | OWNER, MANAGER | INVENTORY | UpsertRecipeDto | `{ data: recipe }` |

### 9.23 Reports & Analytics

All endpoints require `ANALYTICS` feature gate.

| Method | Path | Auth | Roles | Query Params | Response |
|--------|------|------|-------|-------------|----------|
| `GET` | `/api/v1/reports/revenue` | JWT | OWNER, MANAGER | `branchId?, from?, to?` | `{ data: revenueSummary }` |
| `GET` | `/api/v1/reports/revenue-by-method` | JWT | OWNER, MANAGER | `branchId?, from?, to?` | `{ data: revenueByMethod }` |
| `GET` | `/api/v1/reports/orders` | JWT | OWNER, MANAGER | `branchId?, from?, to?` | `{ data: orderStats }` |
| `GET` | `/api/v1/reports/best-sellers` | JWT | OWNER, MANAGER | `branchId?, from?, to?, limit?` | `{ data: bestSellers[] }` |
| `GET` | `/api/v1/reports/peak-hours` | JWT | OWNER, MANAGER | `branchId?, from?, to?` | `{ data: peakHours }` |
| `GET` | `/api/v1/reports/inventory-consumption` | JWT | OWNER, MANAGER | `branchId?, from?, to?` | `{ data: consumption[] }` |
| `GET` | `/api/v1/reports/low-stock` | JWT | OWNER, MANAGER | `branchId?` | `{ data: lowStock }` |

### 9.24 Tables & Dining Areas

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/dining-areas` | JWT+BranchScope | Any | — | `{ data: area[] }` |
| `POST` | `/api/v1/branches/:branchId/dining-areas` | JWT+BranchScope | OWNER, MANAGER | CreateDiningAreaDto | `{ data: area }` |
| `PATCH` | `/api/v1/branches/:branchId/dining-areas/:areaId` | JWT+BranchScope | OWNER, MANAGER | UpdateDiningAreaDto | `{ data: area }` |
| `GET` | `/api/v1/branches/:branchId/tables` | JWT+BranchScope | Any | `?diningAreaId?` | `{ data: table[] }` |
| `GET` | `/api/v1/branches/:branchId/tables/:tableId` | JWT+BranchScope | Any | — | `{ data: table }` |
| `POST` | `/api/v1/branches/:branchId/tables` | JWT+BranchScope | OWNER, MANAGER | CreateTableDto | `{ data: table }` |
| `PATCH` | `/api/v1/branches/:branchId/tables/:tableId` | JWT+BranchScope | OWNER, MANAGER | UpdateTableDto | `{ data: table }` |
| `GET` | `/api/v1/branches/:branchId/tables/:tableId/qr-token` | JWT+BranchScope | Any | — | `{ data: qrTokenMeta }` |
| `POST` | `/api/v1/branches/:branchId/tables/:tableId/qr-token/rotate` | JWT+BranchScope | OWNER, MANAGER | `{ reason? }` | `{ data: newTokenMeta }` |
| `GET` | `/api/v1/branches/:branchId/tables/:tableId/qr-token/history` | JWT+BranchScope | Any | — | `{ data: tokenHistory[] }` |
| `GET` | `/api/v1/branches/:branchId/table-operations` | JWT+BranchScope | OWNER, MANAGER, CASHIER, WAITER | — | `{ data: occupancy }` |
| `GET` | `/api/v1/branches/:branchId/sessions` | JWT+BranchScope | OWNER, MANAGER, CASHIER, WAITER | — | `{ data: session[] }` |
| `GET` | `/api/v1/branches/:branchId/sessions/:sessionId` | JWT+BranchScope | OWNER, MANAGER, CASHIER, WAITER | — | `{ data: session }` |
| `POST` | `/api/v1/branches/:branchId/sessions/:sessionId/clear` | JWT+BranchScope | OWNER, WAITER | `{ clearReason?, expectedVersion }` | `{ data: result }` |

### 9.25 Tax Config

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/tax-config` | JWT | OWNER, MANAGER | — | `{ data: taxConfig }` |
| `GET` | `/api/v1/tax-config/history` | JWT | OWNER | — | `{ data: config[] }` |
| `POST` | `/api/v1/tax-config` | JWT | OWNER | `{ vatApplicable, vatRate, roundingMode?, effectiveFrom, effectiveUntil?, confirmedBy?, confirmationNote? }` | `{ data: config }` |

### 9.26 Business Day Close

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/branches/:branchId/day-close/preview` | JWT | OWNER, MANAGER | `?localBusinessDate?` | `{ data: preview }` |
| `POST` | `/api/v1/branches/:branchId/day-close/close` | JWT | OWNER | `{ closedWithException?, reason? }` | `{ data: result }` |
| `POST` | `/api/v1/branches/:branchId/day-close/reopen` | JWT | OWNER | `{ reason }` | `{ data: result }` |
| `GET` | `/api/v1/branches/:branchId/day-close/report` | JWT | OWNER, MANAGER | `?localBusinessDate?` | `{ data: report }` |
| `GET` | `/api/v1/branches/:branchId/day-close/current` | JWT | OWNER, MANAGER | `?localBusinessDate?` | `{ data: closeRecord }` |

### 9.27 Outbox (Admin)

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/outbox/stats` | JWT | OWNER, MANAGER | — | `{ data: stats }` |
| `GET` | `/api/v1/outbox/dead-letter` | JWT | OWNER, MANAGER | — | `{ data: deadLetterEvent[] }` |
| `POST` | `/api/v1/outbox/retry/:eventId` | JWT | OWNER | — | `{ data: { success: true, eventId } }` |

### 9.28 Locale & Translations

| Method | Path | Auth | Roles | Body | Response |
|--------|------|------|-------|------|----------|
| `GET` | `/api/v1/locale/default` | JWT | OWNER, MANAGER | — | `{ data: { locale } }` |
| `POST` | `/api/v1/locale/default` | JWT | OWNER | `{ locale }` | `{ data: { locale } }` |
| `GET` | `/api/v1/locale/menu-translations/:menuItemId` | JWT | OWNER, MANAGER | — | `{ data: translation[] }` |
| `POST` | `/api/v1/locale/menu-translations/:menuItemId` | JWT | OWNER, MANAGER | `{ locale, name, description? }` | `{ data: translation }` |
| `DELETE` | `/api/v1/locale/menu-translations/:menuItemId/:locale` | JWT | OWNER, MANAGER | — | 204 No Content |
| `GET` | `/api/v1/me/preferences/locale` | JWT | Any | — | `{ data: { locale } }` |
| `POST` | `/api/v1/me/preferences/locale` | JWT | Any | `{ locale: string | null }` | `{ data: { locale } }` |

### 9.29 Platform Admin (SUPER_ADMIN only)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/v1/platform/tenants` | `?status?` | `{ data: tenant[] }` |
| `PATCH` | `/api/v1/platform/tenants/:tenantId/suspend` | — | `{ data: tenant }` |
| `PATCH` | `/api/v1/platform/tenants/:tenantId/activate` | — | `{ data: tenant }` |
| `GET` | `/api/v1/platform/users` | `?tenantId?` | `{ data: user[] }` |
| `PATCH` | `/api/v1/platform/users/:userId/role` | `{ platformRole }` | `{ data: user }` |
| `PATCH` | `/api/v1/platform/users/:userId/deactivate` | — | `{ data: user }` |
| `GET` | `/api/v1/platform/tenants/:tenantId/features` | — | `{ data: entitlement[] }` |
| `PUT` | `/api/v1/platform/tenants/:tenantId/features/:featureKey` | `{ status, trialEndsAt?, reason?, internalNote? }` | `{ data: entitlement }` |
| `GET` | `/api/v1/platform/tenants/:tenantId/features/effective` | `?branchId?` | `{ data: feature[] }` |

### 9.30 Support Context (SUPER_ADMIN only)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `POST` | `/api/v1/platform/support/enter` | `{ tenantId, reason }` | `{ data: supportSession }` |
| `POST` | `/api/v1/platform/support/exit` | `{ tenantId }` | `{ data: supportSession }` |
| `GET` | `/api/v1/platform/support/active` | `?tenantId?` | `{ data: bannerData }` |

### 9.31 Public Menu (No Auth)

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/api/v1/public/restaurants/:publicSlug` | — | `{ data: publicContext }` |
| `GET` | `/api/v1/public/restaurants/:publicSlug/menu` | — | `{ data: { menu, context } }` |
| `POST` | `/api/v1/public/table-context/resolve` | `{ token }` | `{ data: tableContext }` |
| `GET` | `/api/v1/public/tenants/:tenantId/branches/:branchId/menu` | — | `{ data: branchMenu }` |
| `POST` | `/api/v1/public/tenants/:tenantId/table-context` | `{ token }` | `{ data: tableContext }` |

---

## 10. WebSocket Contract (KDS)

**Namespace**: `/kds`
**Auth**: JWT via `WsAuthGuard` — token sent as query param or handshake auth

### 10.1 Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `join:branch` | `{ branchId }` | Join all KDS events for a branch |
| `join:station` | `{ branchId, stationId }` | Join station-filtered events |
| `join:expo` | `{ branchId }` | Join expo room |
| `join:service` | `{ branchId }` | Join service board room |
| `join:waiter` | `{ branchId, userId }` | Join personal notification room |
| `leave` | `{ room }` | Leave a room |

### 10.2 Server → Client Events

| Event | Room(s) | Payload | Trigger |
|-------|---------|---------|---------|
| `ticket:created` | `branch:{id}` | `{ ticket }` | New kitchen ticket |
| `ticket:updated` | `branch:{id}`, `station:{id}:{stationId}` | `{ ticket }` | Ticket status change |
| `order:confirmed` | `branch:{id}` | `{ order }` | Order confirmed |
| `service:notification` | `waiter:{branchId}:{userId}` | `{ notification }` | Service request |
| `fulfillment:changed` | `branch:{id}`, `service:{id}` | `{ orderId, fulfillmentStatus }` | Fulfillment status change |

### 10.3 Room Authorization

| Room | Who Can Join |
|------|-------------|
| `branch:{id}` | Any authenticated user with branch access |
| `station:{id}:{stationId}` | KITCHEN_STAFF, MANAGER, OWNER |
| `expo:{id}` | KITCHEN_STAFF, MANAGER, OWNER |
| `service:{id}` | WAITER, MANAGER, OWNER |
| `waiter:{id}:{userId}` | Only that user (OWNER/MANAGER can join any) |

### 10.4 Token Expiry

- WebSocket connections are disconnected when JWT expires
- Client should reconnect with a fresh token
- `already-joined` access revocation is enforced

---

## 11. Dev/Test Credentials

| Role | Email | Password |
|------|-------|----------|
| SUPER_ADMIN | admin@rms.dev | admin123 |
| OWNER | owner@demo.com | owner123 |
| MANAGER | manager@demo.com | manager123 |
| CASHIER | cashier@demo.com | cashier123 |
| KITCHEN_STAFF | kitchen@demo.com | kitchen123 |
| WAITER | waiter@demo.com | waiter123 |

**Tenant**: `Demo Coffee House` (slug: `demo-coffee-house`)
**Branches**: Main Branch, Downtown Branch

---

## 12. Known Issues & Non-Goals

### 12.1 Known Gaps
- `POST /api/v1/orders/:orderId/confirm` returns **501 Not Implemented** — confirmation happens through payment flow instead
- No global response interceptor — each controller wraps responses manually in `{ data: ... }`
- Health endpoint is at `/api/v1/health/live` and `/api/v1/health/ready` — NOT at `/api/v1/health`
- The `createStation` API does not accept `kitchenId` — stations are created without kitchen assignment via the API; the kitchen relationship is established through the seed data or direct DB operations

### 12.2 Non-Goals (for this spec)
- Input/output DTO class-validator constraints (see actual DTO files)
- Prisma schema and migration details
- Internal service-to-service calls
- Outbox event payloads (see `outbox.processor.ts`)

---

## 13. Acceptance Criteria for Frontend Agent

- [ ] All API calls use the `/api/v1` prefix
- [ ] Auth uses `Authorization: Bearer <accessToken>` header
- [ ] Refresh token is sent via httpOnly cookie (automatic)
- [ ] CSRF token is sent via `X-CSRF-Token` header on state-changing requests
- [ ] Branch-scoped requests include `:branchId` in the URL path
- [ ] `x-tenant-id` header is NOT required (tenant is derived from JWT)
- [ ] All responses are unwrapped from `{ data: ... }` envelope
- [ ] Money values are displayed with 2 decimal places (e.g., `"250000"` → `2,500.00 ETB`)
- [ ] 401 errors trigger re-login or token refresh
- [ ] 409 VERSION_CONFLICT errors prompt the user to refresh
- [ ] Feature-disabled (403) shows "Feature not available" UI, not a crash
- [ ] WebSocket connects to `/kds` namespace with JWT
- [ ] WebSocket reconnects automatically with fresh token on disconnect
- [ ] Pagination uses cursor-based `after` + `limit` params
