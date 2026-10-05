# MK-7 Implementation Plan — Frontend Configuration & Operational Screens

**Branch:** `opencode/frontend-phase6f` (RMS-frontend worktree)  
**Owner:** Frontend only — `apps/web`, `packages/ui`, frontend tests  
**No backend files modified**

---

## Scope

Build 5 view groups, typed mock adapters, and shared types for the multi-kitchen fulfillment workflow. All views use the established design tokens (terracotta brand, warm surfaces, Inter font), Radix-based UI primitives, React Query, and the existing `apiRequest` pattern.

---

## Phase 1: Types, Mock Adapters, and Navigation (foundation)

### 1a. Shared fulfillment types

**New file:** `apps/web/src/lib/fulfillment-types.ts`

Define all TypeScript interfaces the 5 views consume:

```
Kitchen, KitchenStation, StationRoute, MenuItemRouteAssignment
FulfillmentPolicy (serviceMode, expoMode, allowWaiterSelfClaim, etc.)
KitchenTicket, KitchenTicketLine (extended with collection quantities)
FulfillmentOrder (order summary with per-station ticket status)
ExpoOrder (order with station breakdown, release state)
ServiceBoardOrder (order with ready/collected/served counts, actions)
ServiceNotification
KdsDevice, KdsDeviceStation
```

Enum types: `FulfillmentStatus`, `ServiceMode`, `ExpoMode`, `TicketType`, `RouteType`, `NotificationType`, `NotificationStatus`

### 1b. Mock adapters

**New file:** `apps/web/src/lib/mock-adapter.ts`

A thin adapter layer that:
- Checks `process.env.NEXT_PUBLIC_USE_MOCKS === 'true'`
- When mocks enabled, returns typed fixture data for endpoints that don't exist on the backend yet
- When mocks disabled, delegates to real `apiRequest`
- All mock data matches the exact TypeScript interfaces from 1a

Mock endpoints:
| Endpoint | Used by |
|----------|---------|
| `GET /branches/:id/kitchens` | Kitchen config |
| `POST /branches/:id/kitchens` | Kitchen config |
| `PATCH /branches/:id/kitchens/:kid` | Kitchen config |
| `DELETE /branches/:id/kitchens/:kid` | Kitchen config |
| `GET /branches/:id/menu-items/:mid/station-routes` | Route editor |
| `PUT /branches/:id/menu-items/:mid/station-routes` | Route editor |
| `GET /branches/:id/fulfillment-policy` | Policy editor |
| `PUT /branches/:id/fulfillment-policy` | Policy editor |
| `GET /branches/:id/expo/orders` | Expo display |
| `POST /branches/:id/expo/orders/:oid/release` | Expo display |
| `POST /branches/:id/expo/orders/:oid/recall` | Expo display |
| `GET /branches/:id/service-board` | Waiter board |
| `POST /branches/:id/orders/:oid/claim` | Waiter board |
| `POST /branches/:id/orders/:oid/collect` | Waiter board |
| `POST /branches/:id/orders/:oid/serve` | Waiter board |

### 1c. React Query hooks

**New file:** `apps/web/src/lib/use-kitchen-config.ts`

Hooks: `useKitchens`, `useCreateKitchen`, `useUpdateKitchen`, `useDeleteKitchen`, `useStationRoutes`, `useReplaceRoutes`, `useFulfillmentPolicy`, `useUpdateFulfillmentPolicy`

**New file:** `apps/web/src/lib/use-expo.ts`

Hooks: `useExpoOrders`, `useReleaseOrder`, `useRecallExpoOrder`

**New file:** `apps/web/src/lib/use-service-board.ts`

Hooks: `useServiceBoard`, `useClaimOrder`, `useCollectOrder`, `useServeOrder`

All hooks follow existing pattern: `apiRequest` + `useQuery`/`useMutation` from React Query + `queryClient.invalidateQueries` on success.

### 1d. Navigation entries

**Modify:** `apps/web/src/components/shell/nav-config.ts`

Add entries:
- `/kitchen/config` → OWNER, MANAGER (nested under kitchen section)
- `/expo` → OWNER, MANAGER, KITCHEN_STAFF

Modify existing:
- `/kitchen` label → "KDS" (to distinguish from config)
- `/waiter` stays as-is

---

## Phase 2: Kitchen & Routing Configuration

**New page:** `apps/web/src/app/kitchen/config/page.tsx`  
**New components:** `apps/web/src/components/kitchen-config/`

### 2a. Kitchen list

**Component:** `kitchen-list.tsx`

- Card grid of kitchens (name, description, station count, isActive toggle)
- Create kitchen dialog (name, description, collection label)
- Edit/delete with confirmation
- Drag-to-reorder (displayOrder)
- Empty state: "No kitchens configured yet"

### 2b. Station manager (nested per kitchen)

**Component:** `station-manager.tsx`

- Collapsible panel under each kitchen card
- Station list: name, code, default prep minutes, isExpo badge, isActive
- Add station dialog (name, code, defaultPrepMinutes, isExpo toggle)
- Inline edit for prep time and collection label override
- Warn before deactivating station with active routes (tooltip/banner)

### 2c. Route editor

**Component:** `route-editor.tsx`

- Two-panel layout: left = menu items (grouped by category), right = station assignment
- For each menu item: drag or toggle stations, set routeType (PREPARE/ASSEMBLE), isRequired, sortOrder
- Visual indicator: preparation routes = solid border, assembly routes = dashed border
- Bulk assign: select category → assign common stations
- Validation: must have at least one required PREPARE route
- Coverage report tab: unrouted items highlighted in warning

### 2d. Fulfillment policy editor

**Component:** `fulfillment-policy-editor.tsx`

- Service mode radio: ALL_AT_ONCE / PARTIAL_ALLOWED
- Expo mode radio: NONE / OPTIONAL / REQUIRED
- Toggle: allowWaiterSelfClaim
- Toggle: showUnassignedReadyOrdersToWaiters
- Numeric fields: readyReminderSeconds, readyEscalationSeconds
- Save with optimistic update + rollback on error

---

## Phase 3: Enhanced KDS

**Modify:** `apps/web/src/components/kitchen-display.tsx`  
**Modify:** `apps/web/src/lib/use-kds-tickets.ts`

### 3a. Multi-kitchen/station filtering

- Kitchen selector pills (in addition to existing station pills)
- "All kitchens" combined view option
- Persist filter selection to localStorage

### 3b. Ticket enrichment

- Display `ticketType` badge (PREPARATION / EXPO)
- Show kitchen name alongside station name
- Show `collectionLabelSnapshot` when ticket is READY
- Elapsed time with SLA indicator (configurable thresholds)
- Order type icon (dine-in, takeaway, pickup)

### 3c. Connection improvements

- Show reconnect countdown with attempt number
- "Force refresh" button when disconnected > 30s
- Optimistic UI for bump/recall with version rollback on conflict

---

## Phase 4: Expo Display

**New page:** `apps/web/src/app/expo/page.tsx`  
**New components:** `apps/web/src/components/expo/`

### 4a. Expo order board

**Component:** `expo-board.tsx`

- Grid/list of orders with fulfillment status near completion
- Each card shows:
  - Order number, type, table/pickup label
  - Per-station status row (✓ Ready / ● Preparing / ○ Queued)
  - Station names, elapsed time
  - Outstanding items count
  - Released/collected state
- Filter: All / Ready for release / Awaiting collection / Recently released

### 4b. Order detail panel

**Component:** `expo-order-detail.tsx`

- Click card → slide-over panel
- Full station breakdown with ticket-level detail
- Line items per station with quantities
- Release button (enabled only when all required prep tickets READY)
- Recall button with reason dialog
- Conflict handling (409 stale version → refetch)

### 4c. Release/recall actions

- `useReleaseOrder` mutation: optimistic status update, rollback on error
- `useRecallExpoOrder` mutation: prompts for reason, updates local state
- Toast notifications on success/failure

---

## Phase 5: Waiter Service Board

**Modify:** `apps/web/src/app/waiter/page.tsx`  
**Modify:** `apps/web/src/components/waiter-workspace.tsx`

### 5a. Board layout

- Replace current table grid with a service board
- Tab bar: Mine / Unassigned / Ready / Waiting / Served
- Pull-to-refresh + 15s polling
- Connection indicator

### 5b. Order cards

Each card shows:
- Order number + type icon + table/pickup label
- "X of Y ready" progress indicator
- Outstanding stations (names + collection points)
- Assigned waiter name (or "Unassigned")
- Ready age (time since first ticket became ready)
- Action buttons based on server-provided permissions:
  - Claim (for unassigned)
  - Collect (when ready)
  - Serve (when collected)

### 5c. Partial service support

- When serviceMode = PARTIAL_ALLOWED: show per-station collect buttons
- When serviceMode = ALL_AT_ONCE: collect button disabled with tooltip explaining blocking reason
- Group actions by collection point

### 5d. Notifications

- In-app notification bell with unread count
- Toast on new ready notification
- Sound notification (user-toggleable, not default)

---

## Phase 6: Order Fulfillment Timeline

**Modify:** `apps/web/src/components/order-detail.tsx`

### 6a. Fulfillment timeline section

Add to existing order detail view:
- Vertical timeline showing: Routed → Preparing → Partially Ready → Ready → Collected → Served
- Station breakdown rows with status chips
- Recall/cancel events in timeline
- Assigned waiter display
- Expo release status

### 6b. POS integration

- In `pos-workspace.tsx`, after order creation: show routing summary
- Minimal — just confirmation that tickets were created

---

## Phase 7: Tests

### 7a. Component tests (Vitest + Testing Library)

New test files:
- `kitchen-config/kitchen-list.test.tsx` — renders list, create dialog, toggle active
- `kitchen-config/route-editor.test.tsx` — route assignment, validation, coverage
- `kitchen-config/fulfillment-policy-editor.test.tsx` — mode selection, save
- `expo/expo-board.test.tsx` — order cards, station status, release button state
- `expo/expo-order-detail.test.tsx` — detail panel, recall dialog
- `waiter-workspace.test.tsx` — board tabs, action buttons, partial service
- `kitchen-display.test.tsx` — multi-station filter, ticket enrichment (extend existing)
- `order-detail-fulfillment.test.tsx` — timeline rendering

### 7b. Mock adapter tests

- `mock-adapter.test.ts` — toggle between mock/real, type safety

### 7c. Accessibility

- All new interactive elements have aria-labels
- Status indicators use non-color signals (icons + text)
- Keyboard navigation for expo board and service board
- Focus management in slide-over panels

---

## File Inventory

### New files (estimated ~30)
```
apps/web/src/lib/fulfillment-types.ts
apps/web/src/lib/mock-adapter.ts
apps/web/src/lib/mock-fixtures.ts
apps/web/src/lib/use-kitchen-config.ts
apps/web/src/lib/use-expo.ts
apps/web/src/lib/use-service-board.ts
apps/web/src/app/kitchen/config/page.tsx
apps/web/src/app/expo/page.tsx
apps/web/src/components/kitchen-config/index.ts
apps/web/src/components/kitchen-config/kitchen-list.tsx
apps/web/src/components/kitchen-config/station-manager.tsx
apps/web/src/components/kitchen-config/route-editor.tsx
apps/web/src/components/kitchen-config/coverage-report.tsx
apps/web/src/components/kitchen-config/fulfillment-policy-editor.tsx
apps/web/src/components/expo/index.ts
apps/web/src/components/expo/expo-board.tsx
apps/web/src/components/expo/expo-order-card.tsx
apps/web/src/components/expo/expo-order-detail.tsx
apps/web/src/components/expo/station-status-row.tsx
apps/web/src/components/waiter/service-board.tsx
apps/web/src/components/waiter/service-order-card.tsx
apps/web/src/components/waiter/notification-center.tsx
apps/web/src/components/order/fulfillment-timeline.tsx
apps/web/src/components/order/station-breakdown.tsx
apps/web/src/__tests__/kitchen-config.test.tsx
apps/web/src/__tests__/expo-board.test.tsx
apps/web/src/__tests__/expo-order-detail.test.tsx
apps/web/src/__tests__/service-board.test.tsx
apps/web/src/__tests__/fulfillment-timeline.test.tsx
apps/web/src/__tests__/mock-adapter.test.ts
```

### Modified files (estimated ~8)
```
apps/web/src/components/shell/nav-config.ts
apps/web/src/components/kitchen-display.tsx
apps/web/src/lib/use-kds-tickets.ts
apps/web/src/app/waiter/page.tsx
apps/web/src/components/waiter-workspace.tsx
apps/web/src/components/order-detail.tsx
apps/web/src/lib/kds-types.ts (extend)
packages/contracts/src/enums.ts (add fulfillment enums)
```

---

## Execution Order

| Step | Description | Depends on |
|------|-------------|------------|
| 1 | Checkout frontend branch, verify baseline (build, test, typecheck) | — |
| 2 | Add fulfillment enums to `packages/contracts/src/enums.ts` | — |
| 3 | Create `fulfillment-types.ts` + `mock-adapter.ts` + `mock-fixtures.ts` | 2 |
| 4 | Create React Query hooks (`use-kitchen-config`, `use-expo`, `use-service-board`) | 3 |
| 5 | Add nav entries for `/kitchen/config` and `/expo` | — |
| 6 | Build Kitchen & Routing config views | 3, 4 |
| 7 | Enhance KDS with multi-station filtering + enrichment | 3, 4 |
| 8 | Build Expo display | 3, 4 |
| 9 | Build Waiter service board | 3, 4 |
| 10 | Add fulfillment timeline to order detail | 3, 4 |
| 11 | Write component tests | 6-10 |
| 12 | Typecheck, lint, run all tests, commit | 11 |

---

## Constraints

- **No backend files modified** — only `apps/web`, `packages/ui`, `packages/contracts` (enums only), and test files
- **Mock adapters** for unfinished backend endpoints; typed to match planned API contracts
- **Design tokens preserved** — use existing `--brand-*`, `--surface-*`, `--success/warning/danger` CSS vars
- **Responsive** — all views work at phone (< 640px), tablet (768px), and desktop (1024px+)
- **Accessibility** — non-color status indicators, aria-labels, keyboard nav, focus management
- **Touch targets** — KDS/expo buttons minimum 44x44px for tablet use
