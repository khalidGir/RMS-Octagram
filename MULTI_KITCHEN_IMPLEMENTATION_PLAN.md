# Multi-Kitchen, KDS, Expo, and Waiter Fulfillment Implementation Plan

**Project:** All-in-One Restaurant Management & POS System  
**Audience:** OpenCode implementation agent, backend and frontend contributors  
**Status:** Execution plan  
**Priority:** Complete before backend/frontend integration is considered finished  
**Primary stack:** NestJS, Prisma/PostgreSQL, Next.js PWA, WebSockets, transactional outbox  
**Scope:** Multiple physical kitchens per branch, station routing, coordinated KDS screens, expo, waiter notifications, and item-level service completion

---

## 1. Objective

Implement a reliable fulfillment system for restaurant branches that may have one or more physical kitchens, bars, bakeries, coffee counters, or preparation areas.

The system must preserve one customer-facing order and one bill while splitting preparation into independently operated station tickets. Kitchen teams must see only the work relevant to their assigned screens. Waiters must have a single live view showing what is ready, where to collect it, what is still outstanding, and whether partial service is allowed. Larger restaurants may use an expo screen to coordinate final assembly; smaller restaurants may use automatic readiness aggregation.

The implementation must build on the current kitchen foundation instead of creating a parallel subsystem. The repository already contains:

- `KitchenStation`
- `MenuItemStation`
- `KitchenTicket`
- `KitchenTicketLine`
- `KitchenTicketHistory`
- per-station ticket counters
- station-scoped ticket querying
- ticket bump, recall, complete, and cancel actions
- optimistic ticket versions
- KDS WebSocket rooms and polling fallback
- KDS feature-entitlement enforcement
- tenant and branch isolation
- a `WAITER` tenant role and initial waiter permissions

This plan closes the gaps between that foundation and a production-ready multi-kitchen workflow.

---

## 2. Non-Goals

Do not include the following in this implementation unless separately approved:

- kitchen printer or fiscal printer drivers
- delivery-driver dispatch
- customer seat-by-seat coursing beyond basic course metadata
- automatic cooking hardware integration
- predictive preparation using machine learning
- cross-branch preparation or stock fulfillment
- offline creation of authoritative orders or financial mutations
- payroll, tips, or waiter commission calculations
- arbitrary user-authored workflow engines

The architecture should leave room for printers, advanced coursing, and delivery later without blocking this milestone.

---

## 3. Product Decisions to Treat as Accepted

OpenCode should implement the following decisions without pausing for reconfirmation.

### 3.1 Fulfillment unit

- A customer creates or a staff member creates one `Order`.
- Confirmation creates one preparation ticket per destination station.
- All tickets remain children of the same order.
- Billing, payment, cancellation, and customer tracking remain order-level concerns.
- Preparation, readiness, collection, and service progress are tracked at line allocation and station-ticket level.

### 3.2 Physical kitchen and station hierarchy

Use this hierarchy:

```text
Tenant
└── Branch
    ├── Kitchen / Production Area
    │   ├── Station
    │   └── Station
    └── Kitchen / Production Area
        └── Station
```

A `Kitchen` represents a physical production or collection area, such as Main Kitchen, Outdoor Kitchen, Bar, Coffee Counter, or Bakery. A `KitchenStation` is a working queue within that area, such as Grill, Fryer, Cold Line, Drinks, or Dessert.

### 3.3 Routing semantics

- A menu item must have at least one active preparation route before it can be sold when KDS is enabled.
- A menu item may route to multiple preparation stations.
- Every routed preparation allocation is required unless explicitly marked optional.
- An optional assembly/expo route may receive the item for coordination but must not duplicate inventory deduction or order quantity.
- Order confirmation snapshots the routing. Later menu-routing changes must not rewrite existing tickets.
- If no valid route exists, confirmation must fail atomically with a structured `MENU_ITEM_ROUTE_MISSING` error. Never silently drop an item from KDS.

### 3.4 Readiness and service policy

Each branch has one of two service modes:

- `ALL_AT_ONCE`: notify the waiter for collection only after all required preparation tickets are ready, or after expo releases the order.
- `PARTIAL_ALLOWED`: notify the waiter whenever a station or service batch becomes ready.

Default new and migrated branches to `ALL_AT_ONCE` to avoid unintended partial service.

### 3.5 Expo policy

Each branch supports:

- `NONE`: readiness is calculated automatically from required station tickets.
- `OPTIONAL`: an expo screen is available, but automatic readiness remains permitted.
- `REQUIRED`: all required preparation tickets may be ready, but the order is not released to waiters until an authorized expo user releases it.

Default new and migrated branches to `NONE`.

### 3.6 Status separation

Do not overload the financial/order lifecycle with every kitchen detail. Preserve the existing canonical `OrderStatus` behavior and add a separate fulfillment summary.

Use these fulfillment states:

```text
NOT_ROUTED
QUEUED
PREPARING
PARTIALLY_READY
READY_FOR_EXPO
READY_FOR_SERVICE
PARTIALLY_SERVED
SERVED
CANCELLED
```

The summary is derived from authoritative allocations/tickets but may be persisted on `Order` for indexed queue queries. Every mutation that changes the derivation must update the persisted summary in the same transaction.

### 3.7 Collection and serving

- `READY` means the kitchen has finished its work.
- `COLLECTED` means a waiter/expo user has physically acknowledged pickup from a collection point.
- `SERVED` means the relevant items were delivered to the customer/table or handed to the pickup customer.
- Completing a kitchen ticket does not automatically settle payment or close a dining session.
- The order reaches fulfillment `SERVED` only when all non-cancelled required allocations are served.

### 3.8 Waiter assignment

- A dine-in order may have a primary assigned waiter.
- Assignment may be inherited from an open dining session or set/reassigned by an Owner or Manager.
- Waiters may self-claim an unassigned order in their assigned branch.
- A waiter sees orders assigned to them plus unassigned ready work when branch policy permits.
- Owner and Manager can see all service work within authorized scope.

### 3.9 Real-time consistency

- HTTP/database state is authoritative.
- WebSocket events are hints that cause clients to patch safe data or refetch.
- Every event includes tenant, branch, resource, monotonically useful version/timestamp, and correlation ID.
- Reconnect always triggers an authoritative refetch.
- Event delivery may be duplicated; consumers must be idempotent.

---

## 4. Required Repository and Concurrency Protocol

OpenCode owns backend paths in the backend worktree/branch:

- `apps/api/**`
- `apps/worker/**`
- `packages/database/**`
- backend integration/security tests
- backend seed data

Frontend implementation belongs in the separate frontend worktree/branch and must not be written into the backend branch accidentally. Shared paths require coordination:

- `packages/contracts/**`
- root documentation
- root workspace configuration
- lockfiles and CI workflows

Before editing:

1. Confirm the active worktree and branch.
2. Read `AGENTS.md` and `WORKSPACE_OWNERSHIP.md`.
3. Inspect existing migrations and current kitchen/order tests.
4. Record the baseline results for build, typecheck, lint, unit tests, and E2E tests.
5. Do not overwrite or recreate frontend work that exists on another branch.
6. Make shared-contract changes in a small isolated commit so the frontend branch can consume them cleanly.

---

## 5. Domain Model

### 5.1 New `Kitchen` model

Add a physical kitchen/production-area entity.

```prisma
model Kitchen {
  id                 String   @id @default(uuid())
  tenantId           String
  branchId           String
  name               String
  description        String?
  collectionLabel    String?
  displayOrder       Int      @default(0)
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  branch             Branch   @relation(fields: [branchId], references: [id])
  stations           KitchenStation[]

  @@index([tenantId, branchId, isActive])
  @@unique([branchId, name])
}
```

`collectionLabel` is waiter-facing text such as “Main pass”, “Bar counter”, or “Garden kitchen window”. It must not expose internal-only information to customers.

### 5.2 Extend `KitchenStation`

Add:

- `kitchenId String?` during expand migration; make required only after backfill and verification
- `code String?` for stable short display labels
- `defaultPrepMinutes Int?`
- `isExpo Boolean @default(false)`
- `collectionLabelOverride String?`
- relation to `Kitchen`

Constraints and validation:

- Kitchen and station must share tenant and branch.
- Only one active expo station per branch for MVP.
- Station code is unique per branch when supplied.
- A station with active tickets or routes is soft-disabled, not hard-deleted.

### 5.3 Replace the ambiguous menu mapping with explicit route semantics

Evolve `MenuItemStation` without breaking existing assignments:

- `routeType`: `PREPARE | ASSEMBLE`
- `isRequired Boolean @default(true)`
- `quantityMultiplier Decimal(9,3) @default(1)` only if genuinely required; otherwise omit for MVP
- `sortOrder Int @default(0)`
- `createdAt`, `updatedAt`

Rules:

- `PREPARE` creates a required kitchen line by default.
- `ASSEMBLE` sends an informational/assembly allocation to expo and does not represent another sellable quantity.
- The same menu item cannot have duplicate identical route types to the same station.
- Routing is branch-specific.
- An inactive station cannot receive new routes.

If introducing route semantics into the existing table is unsafe, create `MenuItemStationRoute`, migrate the data, switch reads/writes, and contract the old table in a later deployment.

### 5.4 Extend `KitchenTicket`

Add:

- `ticketType`: `PREPARATION | EXPO`
- `kitchenId` snapshot/reference for efficient kitchen filtering
- `collectionLabelSnapshot`
- `releasedAt DateTime?`
- `releasedByUserId String?`
- `collectedAt DateTime?`
- `collectedByUserId String?`
- `lastRecalledAt DateTime?`

Do not remove existing ticket number, status, priority, timing, history, or version fields.

### 5.5 Extend `KitchenTicketLine`

The existing line model needs to become the authoritative fulfillment allocation.

Add:

- relation to `OrderLine`
- `routeType`
- `isRequired`
- `itemNameSnapshot`
- `variantNameSnapshot`
- `notesSnapshot`
- `quantityPrepared Int @default(0)` if partial line preparation is supported
- `quantityReady Int @default(0)`
- `quantityCollected Int @default(0)`
- `quantityServed Int @default(0)`
- `readyAt`, `collectedAt`, `servedAt`
- `version Int @default(1)`
- optional `cancelledAt` and `cancelReason`

MVP simplification: the UI may initially act on the full line quantity, but the schema and service invariants must not prevent later partial-quantity handling. If partial quantities are deferred, document that ticket-line transitions apply atomically to the full quantity.

### 5.6 Extend `Order`

Add:

- `fulfillmentStatus String @default("NOT_ROUTED")`
- `assignedWaiterUserId String?`
- `expoReleasedAt DateTime?`
- `expoReleasedByUserId String?`
- `readyForServiceAt DateTime?`
- `servedAt DateTime?`

Add indexes supporting:

- branch service board by fulfillment status and creation time
- assigned waiter queue by branch, waiter, fulfillment status

Do not conflate `servedAt` with `completedAt`; payment may still be outstanding under an allowed pay-later policy.

### 5.7 Dining-session waiter assignment

Add optional primary waiter assignment to `DiningSession`:

- `assignedWaiterUserId String?`
- `assignedAt DateTime?`
- `assignedByUserId String?`

New dine-in orders inherit the open session assignment unless explicitly overridden by an authorized user.

### 5.8 KDS device registration

Add `KdsDevice` and `KdsDeviceStation`:

```text
KdsDevice
- id
- tenantId
- branchId
- name
- deviceTokenHash
- lastSeenAt
- isActive
- createdByUserId
- createdAt / updatedAt

KdsDeviceStation
- tenantId
- branchId
- deviceId
- stationId
- displayOrder
```

Requirements:

- Never store a raw device token.
- Device activation/rotation is Owner/Manager only.
- A signed-in staff session remains required for privileged ticket mutations in MVP; device identity scopes the display but does not replace user authorization.
- A display may subscribe to one or multiple stations in one branch.

### 5.9 Service notification records

Add an append-only `ServiceNotification` model for durable waiter-facing work:

- `id`
- `tenantId`
- `branchId`
- `orderId`
- optional `ticketId`
- optional `assignedUserId`
- `type`: `STATION_READY | ORDER_READY | EXPO_RELEASED | RECALL | REASSIGNED | ESCALATION`
- `collectionLabelSnapshot`
- `status`: `UNREAD | ACKNOWLEDGED | RESOLVED | CANCELLED`
- `dedupeKey` unique
- `createdAt`, `acknowledgedAt`, `resolvedAt`

WebSocket-only notifications are insufficient because waiters may reconnect or change devices.

### 5.10 Configuration

Add branch fulfillment configuration, either to an existing branch-settings model or a dedicated `BranchFulfillmentPolicy`:

- `serviceMode`: `ALL_AT_ONCE | PARTIAL_ALLOWED`
- `expoMode`: `NONE | OPTIONAL | REQUIRED`
- `allowWaiterSelfClaim Boolean`
- `showUnassignedReadyOrdersToWaiters Boolean`
- `readyReminderSeconds Int?`
- `readyEscalationSeconds Int?`
- `autoCompleteKitchenTicketOnCollected Boolean @default(false)`

Validate reasonable ranges. Use explicit defaults in both migration and application code.

---

## 6. State Machines and Invariants

### 6.1 Preparation ticket state

Keep the current ticket state machine, but clarify semantics:

```text
QUEUED -> IN_PROGRESS -> READY -> COMPLETED
                     READY -> RECALLED -> IN_PROGRESS
QUEUED | IN_PROGRESS | READY | RECALLED -> CANCELLED
```

- `COMPLETED` means work was collected/closed at that station according to policy.
- Recall requires a non-empty reason.
- Cancel requires an authorized order/ticket action and audit history.
- Every transition requires `expectedVersion`.
- A duplicate command with the same idempotency key returns the original result.

### 6.2 Ticket-line state

Normalize and enforce:

```text
QUEUED -> IN_PROGRESS -> READY -> COLLECTED -> SERVED
READY -> IN_PROGRESS only through a ticket recall
Any non-terminal state -> CANCELLED through an authorized cancellation/void
```

For the first release, ticket transitions may cascade to all active lines on the ticket. Line-level endpoints should still be designed so they can be enabled without another breaking API change.

### 6.3 Fulfillment summary derivation

Create one domain service, for example `FulfillmentStatusService`, as the only implementation of aggregation rules. Do not duplicate aggregation in controllers, WebSocket gateways, or React code.

Rules:

1. No required allocations: `NOT_ROUTED`.
2. All allocations cancelled: `CANCELLED`.
3. At least one active allocation started and none ready: `PREPARING`.
4. Some required allocations ready/collected/served while others are not ready: `PARTIALLY_READY`.
5. All required preparation allocations ready and expo is required but unreleased: `READY_FOR_EXPO`.
6. All required allocations ready and expo is not required, or expo has released: `READY_FOR_SERVICE`.
7. Some active allocations served and others not served: `PARTIALLY_SERVED`.
8. All non-cancelled required allocations served: `SERVED`.

An assembly route must not cause readiness before its required preparation dependencies are ready.

### 6.4 Relationship to `OrderStatus`

- Order confirmation remains the only entry point into kitchen routing.
- When the first required ticket starts, existing `OrderStatus` may move from `CONFIRMED` to `IN_PROGRESS` if that is already current behavior.
- When fulfillment reaches `READY_FOR_SERVICE`, existing `OrderStatus` may move to `READY` for backward compatibility.
- Do not move `OrderStatus` to `COMPLETED` merely because all kitchen tickets are ready.
- Serving and payment completion must follow existing business policy.
- Voiding/cancelling an order cancels all non-terminal tickets and notifications transactionally.

### 6.5 Concurrency

All ticket, line, expo-release, collection, service, assignment, and policy-changing commands must:

- use optimistic versions where a mutable aggregate is involved
- execute tenant- and branch-scoped predicates
- use idempotency keys for client retryable commands
- update histories and the outbox in the same transaction
- return `409` with a stable error code on stale version
- never partially update ticket state without recomputing order fulfillment summary

---

## 7. Routing and Ticket Generation

Refactor current confirmed-order ticket generation into a dedicated domain service such as `KitchenRoutingService`.

### 7.1 Confirmation algorithm

Within the existing order-confirmation transaction:

1. Load order and active order lines with immutable snapshots.
2. Load branch fulfillment policy.
3. If KDS is disabled, preserve the existing non-KDS flow and set fulfillment appropriately.
4. Load active station routes for every menu item, scoped by tenant and branch.
5. Validate that each sellable line has at least one active `PREPARE` route.
6. Group preparation allocations by station.
7. Allocate station ticket numbers safely using the existing per-station counter.
8. Create one preparation ticket per station.
9. Create ticket-line allocations referencing the source order line and snapshotting display data.
10. If expo is configured, create or expose an expo aggregation view without double-counting quantities. Prefer derived expo data unless an explicit expo ticket is needed for commands/history.
11. Set the order fulfillment summary to `QUEUED`.
12. Write ticket/order history and outbox events in the same transaction.

### 7.2 Idempotency

Use the unique ticket constraint and guarded transactional logic so replaying order confirmation cannot create duplicate tickets or allocations.

### 7.3 Order edits after confirmation

Do not mutate historical allocations silently.

- Added items create supplemental ticket lines/tickets and emit a clear `order.items_added` event.
- Removed items require authorization, cancellation reason, and compensating inventory behavior.
- Changed quantity should be represented as explicit added/cancelled allocations unless the ticket has not started and a safe edit path is accepted.
- Started or ready items must require Manager/Owner override for cancellation.
- Existing route snapshots remain unchanged.

---

## 8. Backend API Plan

Use the existing API version and response envelope conventions. Update OpenAPI examples and error schemas.

### 8.1 Kitchens

```text
GET    /branches/:branchId/kitchens
POST   /branches/:branchId/kitchens
GET    /branches/:branchId/kitchens/:kitchenId
PATCH  /branches/:branchId/kitchens/:kitchenId
DELETE /branches/:branchId/kitchens/:kitchenId
```

Owner and Manager can mutate; authorized operational roles may read the minimum required data.

### 8.2 Stations

Retain current station endpoints and extend payloads with `kitchenId`, collection label, timing, expo metadata, and active state. Add a reorder endpoint only if atomic ordering cannot be handled safely by patch commands.

### 8.3 Menu routing

Prefer menu-centric bulk replacement for management UI:

```text
GET /branches/:branchId/menu-items/:menuItemId/station-routes
PUT /branches/:branchId/menu-items/:menuItemId/station-routes
```

The `PUT` request replaces routes transactionally and includes `expectedVersion` or an ETag/precondition. Validate all referenced stations in the same tenant/branch and reject inactive stations.

Keep existing station-centric endpoints temporarily for backward compatibility, then deprecate them through documented API evolution.

### 8.4 KDS queue

Extend the current ticket list endpoint:

```text
GET /branches/:branchId/kitchen-tickets
  ?kitchenId=
  &stationId=
  &status=
  &ticketType=
  &updatedAfter=
  &limit=
  &after=
```

Response must include:

- ticket and version
- station and kitchen identity
- collection label
- order number/type/table-safe label
- elapsed time and estimated-ready timestamp
- lines with immutable item/modifier/note snapshots
- priority
- recall state
- fulfillment summary sufficient for the display

Never return payment proof, customer phone, or unrelated sensitive order data to kitchen staff.

### 8.5 Ticket and line commands

Retain current endpoints and add explicit commands as needed:

```text
POST /branches/:branchId/kitchen-tickets/:ticketId/bump
POST /branches/:branchId/kitchen-tickets/:ticketId/recall
POST /branches/:branchId/kitchen-tickets/:ticketId/complete
POST /branches/:branchId/kitchen-tickets/:ticketId/cancel
POST /branches/:branchId/kitchen-tickets/:ticketId/collect

POST /branches/:branchId/kitchen-ticket-lines/:lineId/start
POST /branches/:branchId/kitchen-ticket-lines/:lineId/ready
POST /branches/:branchId/kitchen-ticket-lines/:lineId/collect
POST /branches/:branchId/kitchen-ticket-lines/:lineId/serve
```

If full line-level controls are deferred, implement the service/domain methods and keep the UI on ticket-level commands. Do not expose placeholder endpoints.

### 8.6 Expo

```text
GET  /branches/:branchId/expo/orders
GET  /branches/:branchId/expo/orders/:orderId
POST /branches/:branchId/expo/orders/:orderId/release
POST /branches/:branchId/expo/orders/:orderId/recall
```

- Release requires every required preparation allocation to be ready.
- Recall after waiter collection requires Manager/Owner or an explicit policy; otherwise reject with `409 ORDER_ALREADY_COLLECTED`.
- Release and recall require expected order version and idempotency key.

### 8.7 Waiter service board

```text
GET  /branches/:branchId/service-board
  ?scope=mine|unassigned|all
  &status=
  &updatedAfter=

POST /branches/:branchId/orders/:orderId/assign-waiter
POST /branches/:branchId/orders/:orderId/claim
POST /branches/:branchId/orders/:orderId/collect
POST /branches/:branchId/orders/:orderId/serve
POST /branches/:branchId/orders/:orderId/serve-lines
```

The service-board DTO should include:

- order number, order type, table/guest-safe display label
- assigned waiter summary
- count of total/ready/collected/served allocations
- list of outstanding stations and collection points
- `canCollect`, `canServe`, `canClaim`, and blocking reason
- current fulfillment status and version
- age and ready-wait duration

Do not make the frontend recreate permission or readiness rules.

### 8.8 Devices

```text
GET    /branches/:branchId/kds-devices
POST   /branches/:branchId/kds-devices
PATCH  /branches/:branchId/kds-devices/:deviceId
POST   /branches/:branchId/kds-devices/:deviceId/rotate-token
DELETE /branches/:branchId/kds-devices/:deviceId
PUT    /branches/:branchId/kds-devices/:deviceId/stations
```

Return a raw activation token exactly once.

### 8.9 Configuration

```text
GET /branches/:branchId/fulfillment-policy
PUT /branches/:branchId/fulfillment-policy
```

Owner and authorized Manager only. Audit every change.

### 8.10 Stable error codes

At minimum add and test:

- `MENU_ITEM_ROUTE_MISSING`
- `ROUTE_STATION_INACTIVE`
- `ROUTE_BRANCH_MISMATCH`
- `KITCHEN_BRANCH_MISMATCH`
- `STATION_HAS_ACTIVE_WORK`
- `EXPO_RELEASE_BLOCKED`
- `EXPO_ALREADY_RELEASED`
- `ORDER_ALREADY_COLLECTED`
- `ORDER_NOT_READY_FOR_COLLECTION`
- `ORDER_NOT_READY_FOR_SERVICE`
- `WAITER_ASSIGNMENT_DENIED`
- `TICKET_VERSION_CONFLICT`
- `ORDER_VERSION_CONFLICT`
- `DEVICE_TOKEN_INVALID`
- `FEATURE_DISABLED`

---

## 9. Authorization Matrix

Enforce authorization on the server; UI visibility is not a security boundary.

| Capability | Owner | Manager | Cashier | Kitchen Staff | Waiter |
|---|---:|---:|---:|---:|---:|
| Manage kitchens/stations/routes | Tenant | Assigned branches | No | No | No |
| Configure fulfillment policy | Tenant | Assigned branches if policy permits | No | No | No |
| Register KDS device | Tenant | Assigned branches | No | No | No |
| View all KDS queues | Tenant | Assigned branches | Read | Assigned branch/stations | Ready-only summary |
| Advance preparation ticket | Yes | Yes | No | Assigned branch/stations | No |
| Recall ticket | Yes | Policy | No | Assigned branch/stations | No |
| Release expo order | Yes | Yes | No | Expo-assigned staff | No |
| Assign waiter | Yes | Yes | No | No | Self-claim only if allowed |
| Collect ready work | Yes | Policy | Policy | Optional station handoff only | Assigned/claimable orders |
| Mark served | Yes | Policy | Yes where existing policy allows | No | Assigned/claimable orders |

Current membership is branch-scoped but not station-scoped. Add staff-station assignment if KDS users must be restricted inside a branch. If implemented:

- Owner sees all stations.
- Manager sees all stations in assigned branches.
- Kitchen Staff sees only assigned stations, with an explicit “all stations in branch” assignment option.
- Never trust station IDs from the client without server-side assignment validation.

Every protected endpoint must test allowed role, denied role, cross-branch denial, cross-tenant denial, and station-assignment denial where relevant.

---

## 10. Real-Time Event Contract

Publish through the existing transactional outbox. Use a consistent envelope:

```json
{
  "eventId": "uuid",
  "type": "fulfillment.order_ready",
  "tenantId": "uuid",
  "branchId": "uuid",
  "resourceType": "order",
  "resourceId": "uuid",
  "resourceVersion": 7,
  "occurredAt": "2026-09-12T10:00:00.000Z",
  "correlationId": "uuid",
  "data": {}
}
```

Required events:

- `kds.ticket.created`
- `kds.ticket.updated`
- `kds.ticket.recalled`
- `kds.ticket.cancelled`
- `fulfillment.partially_ready`
- `fulfillment.ready_for_expo`
- `fulfillment.order_ready`
- `fulfillment.collected`
- `fulfillment.partially_served`
- `fulfillment.served`
- `fulfillment.assignment_changed`
- `service.notification.created`
- `service.notification.resolved`
- `configuration.kitchen_changed`
- `configuration.route_changed`

Rooms/channels:

```text
tenant:{tenantId}:branch:{branchId}:operations
tenant:{tenantId}:branch:{branchId}:kitchen:{kitchenId}
tenant:{tenantId}:branch:{branchId}:station:{stationId}
tenant:{tenantId}:branch:{branchId}:expo
tenant:{tenantId}:branch:{branchId}:service
tenant:{tenantId}:branch:{branchId}:waiter:{userId}
```

Gateway authorization must derive tenant, branch, role, and station access from the validated JWT/database context. Never let a client join an arbitrary room by naming it.

Keep event payloads minimal. Clients refetch detail after unknown, stale, or skipped versions.

---

## 11. Notifications and Escalation

### 11.1 Initial delivery

For the PWA milestone:

- show an in-app notification center
- update service-board cards immediately
- optionally play a user-enabled sound
- use vibration only after user permission and a qualifying interaction
- show collection point, table/order label, ready items, and age
- never depend on audio as the only signal

Browser push notifications may be a later sub-phase because they require service-worker subscription lifecycle and platform-specific testing.

### 11.2 Dedupe

Create notifications with deterministic dedupe keys, for example:

```text
order:{orderId}:ticket:{ticketId}:ready:v{ticketVersion}
order:{orderId}:ready:v{orderVersion}
order:{orderId}:expo-released:v{orderVersion}
```

### 11.3 Escalation

Use a worker job for reminders/escalations:

1. Find unresolved ready notifications older than branch policy threshold.
2. Lock or claim work idempotently.
3. Emit reminder to the assigned waiter.
4. After escalation threshold, also notify Manager/Owner operations room.
5. Resolve escalation when collection/serve/recall/cancel occurs.

Do not spam on every worker poll. Persist reminder/escalation state.

---

## 12. Frontend Implementation Contract

Frontend work must consume typed API contracts and should be implemented in the frontend-owned worktree after the shared contract commit is available.

### 12.1 Owner/Manager configuration

Create a “Kitchen & routing” area with:

- kitchen list and activation state
- nested station list with ordering
- collection-point labels
- default preparation times
- expo configuration
- KDS device registration and station assignment
- menu-item routing editor
- routing coverage report showing unrouted sellable items
- fulfillment/service policy editor

Required UX safeguards:

- cannot select a station from another branch
- warn before deactivating a station with active routes/work
- show route validation inline
- bulk route common categories without hiding individual overrides
- clearly distinguish preparation routes from expo/assembly routes

### 12.2 KDS

The KDS should support:

- one or multiple selected stations per screen
- optional kitchen-wide combined view
- columns for queued, in progress, and ready/recall state
- prominent elapsed-time and SLA state
- order type and table/order identifier
- item quantities, modifiers, and kitchen-safe notes
- bump, recall, and complete controls
- reconnect/disconnected state with automatic authoritative refetch
- touch targets suitable for tablet use
- no payment or unnecessary customer information

Never rely only on colour. Pair status colours with labels/icons and preserve sufficient contrast.

### 12.3 Expo display

For each order show:

- every required kitchen/station
- station status and elapsed time
- missing/outstanding items
- collected state
- release button only when allowed
- recall action with reason and conflict handling

Suggested compact representation:

```text
Order #1048 · Table 8
✓ Bar / Drinks         Ready
✓ Bakery / Dessert     Ready
● Main / Hot Line      Preparing
○ Main / Grill         Queued
```

### 12.4 Waiter service board

Provide tabs/filters for:

- Mine
- Unassigned
- Ready now
- Waiting
- Served recently

Each order card must show:

- table/order identifier
- “X of Y ready” summary
- exact outstanding station
- exact collection point for ready work
- assigned waiter
- readiness age
- actions allowed by the server: claim, collect, serve

For partial service, group actions by station/service batch. For all-at-once mode, disable collection until server reports it is allowed and show the blocking reason.

### 12.5 POS/order detail integration

Add a fulfillment timeline to staff order detail:

- routed stations
- preparation progress
- recalls/cancellations
- collection and service acknowledgements
- assigned waiter
- expo status

POS must remain one order and one payment view; do not represent station tickets as separate customer orders.

### 12.6 Customer tracking

Expose only customer-appropriate aggregate states:

- Order received
- Preparing
- Partially ready only if restaurant policy permits customer visibility
- Ready
- Served/completed

Do not reveal internal kitchen/station names unless explicitly marked customer-visible.

### 12.7 Required UI states

Every new screen must implement:

- loading/skeleton
- empty state
- permission denied
- feature disabled
- offline/disconnected
- stale-version conflict with refetch
- generic error with retry
- inactive/missing station-route state

---

## 13. Migration Strategy

Use expand, backfill, verify, then contract. Never use destructive schema synchronization.

### Release A: expand

1. Add new tables and nullable columns.
2. Add enums/check constraints as compatible strings according to current schema conventions.
3. Create one default `Kitchen` named “Main Kitchen” for every branch that currently has stations.
4. Attach existing stations to that kitchen.
5. Backfill existing menu mappings as required `PREPARE` routes.
6. Backfill existing ticket kitchen references and safe snapshots.
7. Backfill `Order.fulfillmentStatus` from existing tickets.
8. Add indexes concurrently where deployment tooling permits.
9. Deploy code capable of reading old/null and new data.

### Release B: switch writes

1. Write all new fields and models.
2. Use new routing and aggregation services.
3. Monitor route-missing, stale-version, and outbox failure metrics.
4. Run consistency verification against live-like data.

### Release C: contract

1. Make required foreign keys non-null only after verification.
2. Remove compatibility reads.
3. Remove/deprecate superseded route endpoints or tables in a later version.

Provide a rollback note for each migration. A rollback must not delete already-created tickets or service history.

---

## 14. Seed and Local Demo Scenario

Extend seed data with one multi-kitchen restaurant branch:

```text
Bole Main Branch
├── Main Kitchen
│   ├── Grill
│   └── Hot Line
├── Bar
│   └── Drinks
└── Bakery
    └── Dessert
```

Seed routes:

- Special Tibs -> Grill
- Shiro Wot -> Hot Line
- Buna Ceremony -> Drinks
- House Baklava -> Dessert
- one mixed item routed to two required stations to test aggregation
- one intentionally unrouted inactive/draft item for configuration UX only; it must not be publicly sellable

Seed users:

- Owner
- Manager
- Cashier
- Kitchen staff assigned to Grill/Hot Line
- Kitchen staff assigned to Drinks
- Expo-capable staff member
- Waiter assigned to the branch

Seed scenarios or fixtures for:

- all-at-once service
- partial service
- expo-required service
- recalled ticket
- unassigned waiter order
- ready order waiting past escalation threshold

Never put production credentials in seed files. Keep the existing production seed guard.

---

## 15. Testing Plan

### 15.1 Domain/unit tests

Add table-driven tests for:

- routing one item to one station
- one order split across multiple kitchens/stations
- one item routed to multiple required stations
- assembly route not double-counting quantity
- missing route rejection
- inactive station rejection
- route snapshot stability after configuration changes
- every fulfillment-summary combination
- expo none/optional/required aggregation
- all-at-once versus partial service
- recall moving fulfillment backward correctly
- cancellation excluding cancelled allocations
- collected versus served distinction
- notification dedupe
- escalation idempotency

### 15.2 Service/integration tests

Test:

- confirmation creates exactly one ticket per routed station
- repeat confirmation creates no duplicates
- ticket transitions update history, fulfillment summary, notifications, and outbox atomically
- transaction rollback leaves none of those partially updated
- concurrent bump produces one success and one version conflict
- concurrent expo release is idempotent/guarded
- concurrent waiter claim allows one winner
- serving before readiness is rejected
- cross-tenant kitchen/station IDs are rejected
- cross-branch route and device assignments are rejected
- KDS feature disabled returns structured `403`
- outbox retries do not duplicate durable notification records

### 15.3 Authorization tests

For every endpoint cover:

- allowed role
- denied role
- inactive membership
- suspended tenant
- unassigned branch
- another tenant
- unassigned station where station scope applies

Verify kitchen responses never include customer phone numbers, proof images, or payment details.

### 15.4 WebSocket tests

Test:

- authorized station room join
- arbitrary room/station join denial
- correct station receives new ticket
- unrelated station does not receive ticket detail
- waiter receives assigned ready notification
- manager receives escalated notification
- duplicate event handling
- disconnect, missed events, reconnect, and authoritative refetch
- stale event version is ignored/refetched

### 15.5 Frontend component tests

Test:

- KDS ticket status and allowed actions
- multi-station filters
- expo blocking reasons
- service-board ready counts and collection labels
- all required error/loading/offline states
- keyboard navigation and focus management
- accessible names and non-colour status indicators

### 15.6 Playwright journeys

At minimum:

1. Owner creates kitchens/stations and routes menu items.
2. Cashier confirms a mixed order; tickets appear only on correct station displays.
3. Grill and bar advance independently; waiter sees partial readiness.
4. All-at-once branch withholds collection until all stations are ready.
5. Partial-service branch allows drinks collection before food.
6. Expo-required branch waits for release even after all stations are ready.
7. Waiter claims, collects, and serves an order.
8. Kitchen recalls a ready ticket; waiter notification is withdrawn/updated.
9. A second branch and tenant cannot see or mutate the order.
10. WebSocket disconnect falls back to polling and reconciles after reconnect.

Do not mark broken tests `fixme` merely to pass the gate. If an unrelated pre-existing failure exists, document the exact baseline and prove no regression.

---

## 16. Observability and Operations

Add metrics for:

- tickets created by branch/station
- time queued before start
- preparation duration
- ready-to-collected duration
- collected-to-served duration
- recalls and cancellations
- route-missing confirmation failures
- unresolved ready notifications
- escalation count
- WebSocket connections/reconnects
- outbox age and retry count
- version conflicts by command

Structured logs must include correlation ID, tenant ID, branch ID, order ID, ticket ID, and station ID where applicable. Never log raw customer tokens, device tokens, payment proof, or unnecessary customer data.

Add health/operational checks for:

- outbox backlog
- notification worker backlog
- invalid or orphaned route counts
- persisted fulfillment summary inconsistent with ticket allocations

Provide an administrative reconciliation command/job that reports inconsistencies and supports a dry run. Any repair mode must be explicit, audited, and idempotent.

---

## 17. Execution Phases

### Phase MK-0 — Audit and decisions record

Deliverables:

- map current ticket creation, transitions, WebSocket events, and order aggregation
- document gaps against this plan
- add accepted architecture decision to `DECISIONS.md`
- capture test/build baseline
- identify shared contract changes

Exit criteria:

- no duplicate subsystem is proposed
- current behavior and migration risks are documented
- file ownership is confirmed

### Phase MK-1 — Schema and contracts

Deliverables:

- additive Prisma migration
- kitchen, policy, device, notification, assignment, and fulfillment fields
- typed enums/DTO contracts
- backfill and verification script/tests
- expanded local seed

Exit criteria:

- migration applies to an empty database and a database containing current seed data
- rollback notes exist
- all tenant/branch indexes and constraints are present
- old behavior still passes

### Phase MK-2 — Routing and aggregation domain

Deliverables:

- routing service
- fulfillment aggregation service
- idempotent confirmation integration
- route validation and stable errors
- unit/integration tests

Exit criteria:

- a mixed order creates correct station tickets atomically
- no routed line is lost or duplicated
- summary states are correct for all policy modes

### Phase MK-3 — Kitchen configuration APIs

Deliverables:

- kitchen CRUD
- enhanced station CRUD
- route replacement and coverage endpoints
- fulfillment-policy endpoints
- audit records and authorization tests

Exit criteria:

- cross-tenant/branch mutations are impossible
- active work cannot be orphaned
- OpenAPI is current

### Phase MK-4 — KDS and real-time coordination

Deliverables:

- kitchen/station-scoped queues
- device registration and display assignments
- enriched ticket commands
- event envelope and authorized rooms
- reconnect/refetch behavior

Exit criteria:

- two kitchen displays receive only their relevant tickets
- mutations converge across displays
- polling fallback works

### Phase MK-5 — Expo

Deliverables:

- expo queue and order detail
- release/recall workflow
- required/optional/none policy enforcement
- authorization, conflicts, and events

Exit criteria:

- required expo blocks waiter readiness until release
- recalls correctly reverse readiness and notify affected clients

### Phase MK-6 — Waiter fulfillment

Deliverables:

- session/order waiter assignment
- claim workflow
- durable service notifications
- service-board APIs
- collect and serve commands
- escalation worker

Exit criteria:

- waiter knows exactly what and where to collect
- partial/all-at-once policy is enforced by the server
- reconnection cannot lose ready work

### Phase MK-7 — Frontend configuration and operational screens

Deliverables on the frontend-owned branch:

- Kitchen & routing settings
- KDS station/kitchen views
- Expo view
- Waiter service board
- POS/order fulfillment timeline
- typed API and event adapters
- accessibility and responsive tablet behavior

Exit criteria:

- all critical journeys work at phone, tablet, and desktop breakpoints
- no placeholder action remains in the multi-kitchen workflow
- UI handles conflict, disconnected, empty, feature-disabled, and denied states

### Phase MK-8 — End-to-end hardening and rollout

Deliverables:

- full Playwright journeys
- load/concurrency tests for busy branch scenarios
- reconciliation tooling
- monitoring dashboards/alerts
- staged rollout and rollback procedure
- documentation updates

Exit criteria:

- quality gates pass with no new skipped tests
- no P0/P1 security, isolation, routing, or data-integrity defect remains
- migrated single-kitchen restaurants behave as before
- multi-kitchen demo scenario passes end to end

---

## 18. Performance Targets

Use these initial engineering targets for local/staging verification, not contractual SLAs:

- ticket creation committed with order confirmation without N+1 station queries
- KDS queue first page: p95 under 500 ms under expected pilot load
- service-board first page: p95 under 500 ms under expected pilot load
- real-time ready event visible on a connected client within 2 seconds after commit
- reconnect and authoritative reconciliation within 5 seconds under normal connectivity
- support at least 100 active tickets per station without unusable rendering or query behavior

Use pagination/cursors and indexed queries. Do not fetch an entire branch order history for an operational board.

---

## 19. Definition of Done

The multi-kitchen mission is complete only when all of the following are true:

- A branch can configure multiple physical kitchens and stations.
- Every sellable menu item has validated branch routing when KDS is enabled.
- Confirmation splits one order into the correct station tickets atomically.
- Each KDS display sees only authorized assigned work.
- Stations can progress independently without corrupting overall order state.
- Expo modes behave exactly as configured.
- Waiters receive durable, live, location-specific readiness information.
- Partial service and all-at-once service are enforced server-side.
- Collection and service acknowledgements are recorded and auditable.
- Recall/cancel actions reconcile KDS, expo, POS, waiter, and customer summaries.
- WebSocket disconnect/reconnect cannot permanently hide work.
- Tenant, branch, station, and role isolation tests pass.
- Existing single-kitchen branches migrate safely to one default kitchen.
- OpenAPI, workflows, schema documentation, RBAC documentation, seed instructions, and progress documentation are updated.
- Build, typecheck, lint, unit, integration, migration, and E2E gates pass with no new ignored failures.

---

## 20. OpenCode Reporting Format

At the end of every phase, report:

1. Exact scope completed.
2. Files and migrations changed.
3. API/contracts added or changed.
4. Tests added and exact pass/fail/skip counts.
5. Baseline comparison proving no regression.
6. Security and tenant/branch isolation coverage.
7. Migration/backfill verification performed.
8. Screens or workflows still using mocks/placeholders.
9. Known risks and blockers.
10. The next phase and its entry criteria.

Do not report a phase as complete if required behavior is a placeholder, a test is skipped because the implementation is broken, or a cross-tenant/branch authorization case is untested.

