# Super Admin Feature Entitlements - Implementation Plan (Revised)

## 1. Objective

A Super Admin controls which major modules each tenant may use. Restaurant owners configure modules only when the platform entitlement permits. Branch overrides may restrict but never bypass platform or tenant decisions.

Hierarchy: Platform entitlement -> Tenant configuration -> Branch override -> Effective state

## 2. Scope

### In scope
- New TenantEntitlement model for platform-level feature gating
- Expanded canonical FeatureKey enum (9 keys)
- Partial unique indexes on FeatureSetting for tenant-level and branch-level uniqueness
- Super Admin entitlement CRUD endpoints
- Centralized feature resolution service with dependency graph
- FeatureEnabledGuard for declarative route-level checks
- Service-level feature assertions in Orders, Payments, Kitchen, OutboxProcessor
- Entitlement-aware updates to TenancyService.setFeature()
- Stable error contracts (FEATURE_DISABLED, DEPENDENCY_DISABLED)
- Audit logging for entitlement and feature changes
- Unit and E2E tests covering 18 PostgreSQL-backed scenarios

### Out of scope
- Frontend changes
- Authentication, RBAC, tenant isolation, observability changes
- Making auth/RBAC/audit/observability toggleable

## 3. Contracts (packages/contracts/src/enums.ts)

### 3.1 Expanded FeatureKey enum

Replace existing FeatureKey with 9 canonical keys:
TABLE_QR_ORDERING, PICKUP_ORDERING, MANUAL_TRANSFER_PAYMENTS, PAYMENT_GATEWAY, KDS, INVENTORY, BATCH_INVENTORY, ANALYTICS, MULTI_BRANCH.

PAYMENT_POLICY remains as ad-hoc string usage in FeatureSetting rows (not in the enum). Existing payment-policy lookups must continue working.

### 3.2 New enums

- EntitlementStatus: ENABLED, DISABLED, TRIAL, SUSPENDED
- BranchFeatureOverride: INHERIT, ENABLED, DISABLED

### 3.3 Stable error codes

- FEATURE_DISABLED: feature not available
- DEPENDENCY_DISABLED: a required dependency feature is not enabled

## 4. Database (packages/database/prisma/schema.prisma)

### 4.1 New model: TenantEntitlement

Fields: id, tenantId, featureKey, status (default DISABLED), trialEndsAt (nullable), updatedByUserId (nullable), notes (nullable), createdAt, updatedAt.
Unique constraint: @@unique([tenantId, featureKey]).
Relation: tenant Tenant @relation.

### 4.2 Add relation to Tenant

Add: entitlements TenantEntitlement[]

### 4.3 Partial unique indexes on FeatureSetting

Do NOT use @@unique([tenantId, branchId, featureKey]) because PostgreSQL allows multiple NULL branchId rows.

Instead use raw SQL partial unique indexes:

```sql
CREATE UNIQUE INDEX "FeatureSetting_tenant_unique"
ON "FeatureSetting" ("tenantId", "featureKey")
WHERE "branchId" IS NULL;

CREATE UNIQUE INDEX "FeatureSetting_branch_unique"
ON "FeatureSetting" ("tenantId", "branchId", "featureKey")
WHERE "branchId" IS NOT NULL;
```

Document in Prisma schema via comments. Make mutation operations concurrency-safe using upsert or SELECT-for-update patterns.

### 4.4 Branch override storage

With the existing FeatureSetting model:
- No branch row means INHERIT
- Branch row with enabled=true means ENABLED
- Branch row with enabled=false means DISABLED

Do not reference a nonexistent branchSetting.override field.

### 4.5 Migration: 20260822000002_add_platform_entitlements

1. Create TenantEntitlement table
2. Drop existing FeatureSetting index
3. Deduplicate existing FeatureSetting rows (keep most recent per tenantId+branchId+featureKey)
4. Create partial unique indexes
5. Backfill: for ALL existing tenants, create ENABLED entitlements for all 9 feature keys
6. Backfill: for ALL existing tenants, create tenant-level enabled FeatureSetting rows for all 9 keys (preserving existing rows)
7. Preserve ALL existing branch overrides unchanged

## 5. Features Module (apps/api/src/modules/features/)

New neutral module. Payments, Orders, Kitchen import this module (not PlatformAdminModule).

### 5.1 feature-catalog.ts

Canonical feature definitions with display names, descriptions, and dependency graph:

```typescript
export interface FeatureDefinition {
  key: FeatureKey;
  name: string;
  description: string;
  dependencies: FeatureKey[];
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  { key: FeatureKey.TABLE_QR_ORDERING, name: 'Table QR Ordering', description: '...', dependencies: [] },
  { key: FeatureKey.PICKUP_ORDERING, name: 'Pickup Ordering', description: '...', dependencies: [] },
  { key: FeatureKey.MANUAL_TRANSFER_PAYMENTS, name: 'Manual Transfer Payments', description: '...', dependencies: [] },
  { key: FeatureKey.PAYMENT_GATEWAY, name: 'Payment Gateway', description: '...', dependencies: [] },
  { key: FeatureKey.KDS, name: 'Kitchen Display System', description: '...', dependencies: [] },
  { key: FeatureKey.INVENTORY, name: 'Inventory', description: '...', dependencies: [] },
  { key: FeatureKey.BATCH_INVENTORY, name: 'Batch Inventory', description: '...', dependencies: [FeatureKey.INVENTORY] },
  { key: FeatureKey.ANALYTICS, name: 'Analytics', description: '...', dependencies: [] },
  { key: FeatureKey.MULTI_BRANCH, name: 'Multi-Branch', description: '...', dependencies: [] },
];
```

Only dependency enforced: BATCH_INVENTORY -> INVENTORY.

### 5.2 feature-resolver.service.ts

Centralized resolution service. Any module injects it.

Resolution algorithm for each FeatureKey:
1. platformAllows = entitlement.status == ENABLED OR (entitlement.status == TRIAL AND trialEndsAt > now)
2. tenantEnabled = tenantSetting?.enabled ?? false (explicit default false)
3. branchOverride: no row = INHERIT, row with enabled=true = ENABLED, row with enabled=false = DISABLED
4. depsResolved = all dependencies are effectively enabled (recursive with cycle guard)
5. effective = platformAllows AND tenantEnabled AND branchOverride != DISABLED AND depsResolved

### 5.3 feature-enabled.guard.ts

Reads @FeatureEnabled() metadata from handler. Resolves via FeatureResolver. Throws ForbiddenException if not effective. NO bypass for Super Admin - everyone must comply with effective state.

### 5.4 feature-enabled.decorator.ts

SetMetadata decorator: @FeatureEnabled(FeatureKey.KDS)

### 5.5 features.module.ts

Providers: FeatureResolver, FeatureEnabledGuard.
Exports: FeatureResolver, FeatureEnabledGuard.

## 6. Platform Admin Module Updates

### 6.1 New endpoints

- GET /platform/tenants/:tenantId/features - List entitlements for a tenant
- PUT /platform/tenants/:tenantId/features/:featureKey - Set single entitlement

Bulk entitlement update may be added later but must not replace per-feature endpoint.

### 6.2 DTOs

SetEntitlementDto: status (EntitlementStatus), trialEndsAt (ISO string, required when TRIAL, must be in future), reason (string, required), internalNote (optional string).

### 6.3 Service mutations

Every mutation must:
- validate tenant existence
- validate future trial expiry
- clear obsolete trialEndsAt when leaving trial
- write mutation and audit in one transaction
- include before/after state and actor
- use expected version or SELECTFORUPDATE for concurrency

## 7. Tenancy Module Updates

### 7.1 API contract

- GET /tenants/features - List tenant-level features with entitlement info
- PUT /tenants/features/:featureKey - Set tenant feature (entitlement-gated)

### 7.2 TenancyService.setFeature() entitlement gate

Before allowing a tenant owner/manager to enable a feature:
1. Check platform entitlement for that feature
2. If DISABLED or expired TRIAL -> throw with FEATURE_DISABLED
3. If SUSPENDED -> throw with FEATURE_DISABLED

### 7.3 Branch endpoints (existing, enhanced)

- GET /branches/:branchId/features - Enhanced with effective resolution
- PUT /branches/:branchId/features/:featureKey - Entitlement-gated

### 7.4 internalNote exposure

Never expose internalNote through tenant-facing APIs. Only platform admin endpoints return it.

## 8. Service-Level Assertions

Guards improve controller ergonomics but cannot protect background processing. Add service-level assertFeatureEnabled() calls to:

- Public QR order creation (PublicOrdersService)
- Pickup order creation
- Manual-transfer creation and proof upload/finalization (PaymentService)
- KDS mutations (KitchenTicketsService)
- OutboxProcessor before creating kitchen tickets
- Branch creation for MULTI_BRANCH (TenancyService)

When KDS is disabled, order.confirmed processing should mark the event handled without creating tickets, with an explicit reason and audit trail. It must not retry forever.

Do NOT guard historical read endpoints that must remain available after disabling a module.

## 9. Stable Error Contracts

```json
{
  "statusCode": 403,
  "code": "FEATURE_DISABLED",
  "feature": "KDS",
  "reason": "SUSPENDED",
  "message": "Kitchen Display System is not enabled for this restaurant."
}
```

Dependency failures use code: "DEPENDENCY_DISABLED" with a dependency field listing missing deps.

## 10. Backfill and Migration Safety

For ALL existing tenants:
- Create ENABLED entitlements for all 9 feature keys
- Create tenant-level enabled FeatureSetting rows for all 9 keys (preserving existing)
- Preserve ALL existing branch overrides unchanged
- Deduplicate existing settings before creating unique indexes

New tenants start with a default preset. The default policy enables: TABLE_QR_ORDERING, MANUAL_TRANSFER_PAYMENTS, KDS, INVENTORY, MULTI_BRANCH.

## 11. Acceptance Test Scenarios (18 PostgreSQL-backed)

1. Populated migration compatibility - existing data preserved after migration
2. Concurrent update conflict - two simultaneous entitlement updates produce deterministic winner
3. QR enforcement - disabling TABLE_QR_ORDERING blocks QR order creation
4. Pickup enforcement - disabling PICKUP_ORDERING blocks pickup order creation
5. Payment enforcement - disabling MANUAL_TRANSFER_PAYMENTS blocks transfer creation/proof
6. KDS enforcement - disabling KDS blocks ticket mutations
7. Outbox enforcement - KDS-disabled order.confirmed marks handled, does not retry forever
8. Historical record access after disabling - completed orders/reports remain readable
9. Re-enabling without data loss - re-enable KDS, existing queued tickets still process
10. Audit rollback - every mutation has before/after audit trail
11. Branch override cannot bypass disabled platform entitlement
12. Branch override cannot bypass disabled tenant configuration
13. Expired trial disables features
14. SUSPENDED entitlement disables features immediately
15. MULTI_BRANCH enforcement - branch creation blocked when disabled
16. BATCH_INVENTORY requires INVENTORY dependency
17. Tenant-level feature setting respects platform entitlement
18. Effective feature resolution returns correct state at each level
