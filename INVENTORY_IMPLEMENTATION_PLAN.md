# Inventory and Batch Management — Implementation Plan

## Scope

Implement the full inventory subsystem: items, batches, recipes, append-only movement ledger, FIFO deduction on order confirmation, void/restoration, adjustments, waste, low-stock alerts, multi-branch isolation, concurrency safety, audit logging, and feature-entitlement enforcement.

## Database Schema (already migrated)

| Model | Purpose |
|---|---|
| `InventoryItem` | Ingredient/item per branch: name, sku, baseUnit, lowStockThreshold, isActive |
| `InventoryBatch` | Received batch per item: batchCode, receivedQuantity, remainingQuantity, portionCount, costMinor, expiresAt |
| `Recipe` | Versioned recipe linked to a MenuItemVariant (unique active per branch/variant) |
| `RecipeComponent` | One ingredient per recipe: inventoryItemId, quantity, unit, portionQuantity |
| `InventoryMovement` | Append-only ledger: movementType, quantity, batchId, orderId, idempotencyKey |

## API Endpoints (per API_SPEC.md)

| Method | Path | Purpose |
|---|---|---|
| GET | `/branches/:branchId/inventory/items` | List inventory items (paginated, branch-scoped) |
| POST | `/branches/:branchId/inventory/items` | Create inventory item |
| PATCH | `/inventory/items/:itemId` | Update item (threshold, name, sku, isActive) |
| POST | `/inventory/items/:itemId/batches` | Receive a batch |
| GET | `/inventory/items/:itemId/movements` | Movement ledger history |
| POST | `/inventory/items/:itemId/adjustments` | Audited adjustment (idempotent) |
| GET/PUT | `/catalog/variants/:variantId/recipe` | Read/update recipe |
| GET | `/branches/:branchId/inventory/alerts` | Low-stock alerts |
| POST | `/inventory/items/:itemId/waste` | Record waste (idempotent) |

## Roles (per RBAC.md)

- **Super Admin (audited)**: Manage inventory/recipes
- **Owner (tenant-wide)**: Manage inventory/recipes, record stock adjustments
- **Manager (branch-scoped)**: Manage inventory/recipes, record stock adjustments
- **Cashier/Kitchen/Customer**: No inventory access

## Implementation Phases

### Phase 1 — Inventory Items CRUD

**Files to create:**
- `apps/api/src/modules/inventory/inventory.module.ts`
- `apps/api/src/modules/inventory/inventory-items.service.ts`
- `apps/api/src/modules/inventory/inventory-items.controller.ts`
- `apps/api/src/modules/inventory/dto.ts`

**Acceptance criteria:**
- `POST /branches/:branchId/inventory/items` — creates item, returns 201, requires `INVENTORY` feature effective
- `GET /branches/:branchId/inventory/items` — paginated list, branch-scoped, returns `createdAt`/`updatedAt`
- `PATCH /inventory/items/:itemId` — update name, sku, lowStockThreshold, isActive; branch-scoped
- All queries tenant+branch scoped
- Guard: `@FeatureEnabled(FeatureKey.INVENTORY)` on all endpoints
- Roles: Owner, Manager, Super Admin (audited)

### Phase 2 — Batch Receiving

**Files to create:**
- `apps/api/src/modules/inventory/inventory-batches.service.ts`

**Files to modify:**
- `apps/api/src/modules/inventory/inventory-items.controller.ts` — add batch endpoint
- `apps/api/src/modules/inventory/dto.ts` — add batch DTOs

**Acceptance criteria:**
- `POST /inventory/items/:itemId/batches` — creates batch, updates `InventoryItem` total if needed
- Batch receivedQuantity becomes remainingQuantity
- Optional portionCount/remainingPortions on batch
- Optional costMinor (integer minor units)
- Movement type: `RECEIVE` appended to ledger with batch reference
- Audit log: `INVENTORY_BATCH_RECEIVE`
- Feature gate: `BATCH_INVENTORY` (depends on `INVENTORY`)
- Idempotent via idempotency_key on movement

### Phase 3 — Movement Ledger

**Files to create:**
- `apps/api/src/modules/inventory/inventory-movements.service.ts`

**Files to modify:**
- `apps/api/src/modules/inventory/inventory-items.controller.ts` — add movements endpoint

**Acceptance criteria:**
- `GET /inventory/items/:itemId/movements` — paginated, filterable by movementType, date range
- Append-only: every mutation (receive, deduct, adjust, waste, void_restore) creates a movement row
- Movement and batch balance update in the same Prisma `$transaction`
- Never derive historical data from mutable batch balance — movement ledger is source of truth

### Phase 4 — Recipes and Recipe Components

**Files to create:**
- `apps/api/src/modules/inventory/recipes.service.ts`
- `apps/api/src/modules/inventory/recipes.controller.ts`

**Acceptance criteria:**
- `GET /catalog/variants/:variantId/recipe` — returns recipe with components, branch-scoped
- `PUT /catalog/variants/:variantId/recipe` — upsert recipe, replace components atomically
- Only one active recipe per branch/variant (DB unique constraint enforced)
- Recipe version auto-increments on update
- Each component references an inventory item, quantity, unit
- Audit log: `RECIPE_UPDATE`
- Feature gate: `INVENTORY`

### Phase 5 — Inventory Deduction on Order Confirmation

**Files to create:**
- `apps/api/src/modules/inventory/inventory-deduction.service.ts`

**Files to modify:**
- `apps/api/src/modules/outbox/outbox.processor.ts` — handle `order.confirmed` for inventory deduction

**Acceptance criteria:**
- Triggered via outbox event `order.confirmed` (same pattern as KDS ticket creation)
- Load active recipe for every order-line variant
- Lock inventory items + batches in deterministic order (by id ASC) to prevent deadlocks
- FIFO deduction: consume oldest batch first (by receivedAt ASC)
- If batch has portionCount, deduct by portions; otherwise deduct by raw quantity
- Append `DEDUCT` movements tied to order ID
- Update batch `remainingQuantity` / `remainingPortions` in same transaction
- Emit low-stock events after commit
- Feature gate: `INVENTORY`
- Idempotent: duplicate `order.confirmed` events do not double-deduct
- **Insufficient stock policy**: if strict stock control enabled and stock insufficient, fail gracefully (log warning, do not confirm); if warning-only, allow negative with warning

### Phase 6 — Void/Restoration Compensation

**Files to modify:**
- `apps/api/src/modules/inventory/inventory-deduction.service.ts` — add restore method
- `apps/api/src/modules/orders/orders.service.ts` — call restore on void

**Acceptance criteria:**
- When a confirmed order is voided, append `VOID_RESTORE` movements
- Restore to original batches (reverse FIFO: last consumed batch first)
- Never delete original deduction movements
- Stock balance restored in same transaction
- Idempotent: double void does not double-restore

### Phase 7 — Adjustments and Waste

**Files to modify:**
- `apps/api/src/modules/inventory/inventory-items.controller.ts` — add adjustment and waste endpoints
- `apps/api/src/modules/inventory/dto.ts` — add adjustment/waste DTOs

**Acceptance criteria:**
- `POST /inventory/items/:itemId/adjustments` — audited adjustment with reason, idempotent
  - Positive or negative quantity delta
  - Appends `ADJUST` movement
  - Audit log: `INVENTORY_ADJUST`
- `POST /inventory/items/:itemId/waste` — record waste, idempotent
  - Positive quantity (amount wasted)
  - Appends `WASTE` movement
  - Audit log: `INVENTORY_WASTE`
- Roles: Owner, Manager only (not Cashier)
- Feature gate: `INVENTORY`

### Phase 8 — Low-Stock Alerts

**Files to modify:**
- `apps/api/src/modules/inventory/inventory-items.controller.ts` — add alerts endpoint
- `apps/api/src/modules/inventory/inventory-deduction.service.ts` — emit low-stock after deduction

**Acceptance criteria:**
- `GET /branches/:branchId/inventory/alerts` — returns items where current stock < lowStockThreshold
- Current stock calculated from movement ledger (sum of RECEIVE - DEDUCT - WASTE + VOID_RESTORE + ADJUST)
- Also calculated from batch remaining quantities (both should match)
- Low-stock events emitted after deduction commit (via outbox or direct event)
- Feature gate: `INVENTORY`

### Phase 9 — Unit Tests

**Files to create:**
- `apps/api/src/modules/inventory/inventory-items.service.spec.ts`
- `apps/api/src/modules/inventory/inventory-batches.service.spec.ts`
- `apps/api/src/modules/inventory/inventory-movements.service.spec.ts`
- `apps/api/src/modules/inventory/inventory-deduction.service.spec.ts`
- `apps/api/src/modules/inventory/recipes.service.spec.ts`

**Acceptance criteria:**
- Each service tested with mocked Prisma
- Test branch/tenant isolation on every query
- Test FIFO deduction order
- Test idempotency (duplicate receive, duplicate deduction, duplicate adjustment)
- Test insufficient stock handling
- Test void restoration logic
- Test low-stock threshold detection

### Phase 10 — E2E Tests

**Files to create:**
- `apps/api/test/inventory.e2e-spec.ts` — full integration tests

**Acceptance criteria:**
- Create item → receive batch → verify movements
- Recipe CRUD → order confirmation triggers deduction → verify batch balances
- Void order → verify restoration movements
- Duplicate deduction idempotency
- Insufficient stock scenario
- Low-stock alert after deduction
- Cross-branch isolation (items from branch A invisible to branch B)
- Feature gate: INVENTORY disabled → 403 on all inventory endpoints
- Feature gate: BATCH_INVENTORY disabled → batch receiving blocked
- Roles: Cashier gets 403 on all inventory endpoints
- Adjustment and waste recording

## Key Invariants (non-negotiable)

1. Every inventory query is tenant+branch scoped
2. Movement ledger is append-only — never delete or update movements
3. Balance update + movement append in same `$transaction`
4. FIFO by receivedAt/expiry for deduction
5. Idempotent operations via idempotency_key on movements
6. Void restores do not delete original deductions
7. Feature entitlement enforced via `@FeatureEnabled` guard
8. Negative stock never silently introduced
9. Audit log for all mutations
10. Outbox events for cross-module coordination

## Conventions (follow existing patterns)

- 2-space indentation
- `import type` for type-only imports
- eslint-disable for DTO imports only
- `@FeatureEnabled(FeatureKey.INVENTORY)` guard on all endpoints
- Branch-scoped via `@BranchContext()` or explicit branchId validation
- DTOs with class-validator + Swagger decorators
- `@HttpCode(HttpStatus.OK)` for POST returning 200
- Unit tests co-located with `.spec.ts` suffix
- E2E tests in `apps/api/test/`
