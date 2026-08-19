# Database Schema

## 1. Conventions

- Database: PostgreSQL on Amazon RDS.
- ORM and migrations: Prisma.
- Primary keys: UUIDv7 where supported by the application library; otherwise UUIDv4.
- Database naming: `snake_case`; TypeScript naming: `camelCase`.
- All timestamps use `timestamptz` and UTC.
- Mutable tables contain `created_at` and `updated_at`.
- Soft deletion is used only where historical references require it, with `deleted_at`.
- Money uses `BIGINT` minor units plus a three-character currency code.
- Quantities use `NUMERIC(18,6)` where fractional inventory is allowed.
- Tenant-owned unique constraints begin with `tenant_id`; branch-owned constraints begin with `tenant_id, branch_id`.
- Human-facing numbers such as order numbers are not primary keys.
- Status columns use database-safe strings mapped to application enums.

## 2. Core Enumerations

```text
PlatformRole: SUPER_ADMIN
TenantRole: OWNER, MANAGER, CASHIER, KITCHEN_STAFF
MembershipStatus: INVITED, ACTIVE, SUSPENDED, REVOKED
OrderType: DINE_IN, PICKUP, POS
OrderStatus: DRAFT, PENDING_PAYMENT, PENDING_CONFIRMATION, CONFIRMED,
             IN_PROGRESS, READY, COMPLETED, CANCELLED, VOIDED
PaymentMethod: CASH, MANUAL_TRANSFER, GATEWAY
PaymentStatus: PENDING, PENDING_VERIFICATION, APPROVED, REJECTED,
               FAILED, REFUNDED, CANCELLED
TicketStatus: QUEUED, IN_PROGRESS, READY, COMPLETED, RECALLED, CANCELLED
SessionStatus: OPEN, SETTLING, CLOSED, CANCELLED
InventoryMovementType: RECEIVE, DEDUCT, ADJUST, VOID_RESTORE, WASTE, TRANSFER
FeatureKey: PAYMENT_GATEWAY, TABLE_QR_ORDERING, KDS, BATCH_INVENTORY
```

Enums are documented here for clarity. Use PostgreSQL enums only when migrations remain manageable; otherwise use validated text with check constraints.

## 3. Identity and Tenancy

### `users`

Platform identity for staff and Super Admin users.

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | |
| `email` | CITEXT unique, nullable | Normalized email. |
| `phone_e164` | VARCHAR unique, nullable | At least one of email or phone is required. |
| `password_hash` | TEXT | Argon2id hash. |
| `display_name` | VARCHAR(160) | |
| `platform_role` | TEXT nullable | `SUPER_ADMIN` only when applicable. |
| `status` | TEXT | Active, suspended, or locked. |
| `last_login_at` | TIMESTAMPTZ nullable | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `auth_sessions`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | Refresh-session ID. |
| `user_id` | UUID FK | |
| `refresh_token_hash` | TEXT | Never store the raw token. |
| `family_id` | UUID | Detect refresh-token reuse. |
| `expires_at`, `revoked_at` | TIMESTAMPTZ | |
| `ip_hash`, `user_agent` | TEXT nullable | Minimized security metadata. |
| `created_at` | TIMESTAMPTZ | |

### `tenants`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | Restaurant business. |
| `name` | VARCHAR(200) | |
| `slug` | CITEXT unique | Stable public/business identifier. |
| `status` | TEXT | Trial, active, suspended, closed. |
| `default_currency` | CHAR(3) | Defaults to `ETB`. |
| `default_timezone` | TEXT | Defaults to `Africa/Addis_Ababa`. |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `tenant_memberships`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `user_id` | UUID FK | |
| `role` | TEXT | Owner, manager, cashier, or kitchen staff. |
| `status` | TEXT | |
| `invited_by_user_id` | UUID nullable | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Unique: `(tenant_id, user_id)`.

### `branches`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `name` | VARCHAR(200) | |
| `slug` | CITEXT | Unique within tenant. |
| `phone` | VARCHAR nullable | Public branch contact. |
| `address_json` | JSONB | Structured/localized address until exact format is confirmed. |
| `timezone` | TEXT | Defaults from tenant. |
| `currency` | CHAR(3) | Defaults from tenant. |
| `is_active` | BOOLEAN | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Unique: `(tenant_id, slug)`. Add unique `(tenant_id, id)` to support composite tenant-safe foreign keys.

### `branch_assignments`

Maps tenant members to allowed branches.

| Column | Type | Notes |
| :--- | :--- | :--- |
| `tenant_id` | UUID FK | |
| `branch_id` | UUID FK | |
| `membership_id` | UUID FK | |
| `created_at` | TIMESTAMPTZ | |

Primary key: `(branch_id, membership_id)`. Validate that all records belong to the same tenant.

### `feature_settings`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | |
| `tenant_id` | UUID FK | |
| `branch_id` | UUID nullable | Null means tenant default; branch overrides it. |
| `feature_key` | TEXT | |
| `enabled` | BOOLEAN | |
| `configuration` | JSONB | Validated per feature. |
| `updated_by_user_id` | UUID | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Partial unique constraints enforce one tenant default and one branch override per feature.

## 4. Catalog

### `menu_categories`

`id`, `tenant_id`, `name`, `description`, `sort_order`, `is_active`, timestamps.

### `menu_items`

`id`, `tenant_id`, `category_id`, `name`, `description`, `image_media_id`, `sku`, `is_active`, `deleted_at`, timestamps.

### `menu_item_variants`

`id`, `tenant_id`, `menu_item_id`, `name`, `sku`, `base_price_minor`, `currency`, `is_default`, `is_active`, timestamps.

### `modifier_groups`

`id`, `tenant_id`, `name`, `min_selections`, `max_selections`, `is_required`, timestamps.

### `modifier_options`

`id`, `tenant_id`, `modifier_group_id`, `name`, `price_delta_minor`, `currency`, `is_active`, timestamps.

### `menu_item_modifier_groups`

Join table with `tenant_id`, `menu_item_id`, `modifier_group_id`, and `sort_order`.

### `branch_menu_items`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `tenant_id`, `branch_id` | UUID | Scope. |
| `menu_item_id` | UUID FK | |
| `is_available` | BOOLEAN | Branch availability. |
| `price_override_minor` | BIGINT nullable | Optional branch override for the default variant. Prefer variant-level overrides if variants are common. |
| `available_from`, `available_until` | TIME nullable | Optional daily window; advanced scheduling is post-MVP. |
| `updated_at` | TIMESTAMPTZ | |

Primary key: `(branch_id, menu_item_id)`.

## 5. Dining Areas, Tables, and Sessions

### `dining_areas`

`id`, `tenant_id`, `branch_id`, `name`, `sort_order`, timestamps.

### `restaurant_tables`

`id`, `tenant_id`, `branch_id`, `dining_area_id`, `label`, `capacity`, `is_active`, timestamps. Unique `(tenant_id, branch_id, label)`.

### `table_qr_tokens`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | |
| `tenant_id`, `branch_id`, `table_id` | UUID | Scope and target. |
| `token_hash` | TEXT unique | Store only a cryptographic hash of the opaque QR token. |
| `version` | INTEGER | Increment when rotating QR codes. |
| `expires_at`, `revoked_at` | TIMESTAMPTZ nullable | |
| `created_at` | TIMESTAMPTZ | |

### `dining_sessions`

`id`, `tenant_id`, `branch_id`, `table_id`, `status`, `guest_count`, `opened_at`, `closed_at`, `opened_by_user_id` nullable, timestamps.

Only one open/settling session per table is permitted by a partial unique index.

## 6. Orders

### `orders`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | |
| `tenant_id`, `branch_id` | UUID | Mandatory scope. |
| `order_number` | BIGINT | Human-facing sequence unique per branch. |
| `order_type` | TEXT | Dine-in, pickup, or POS. |
| `status` | TEXT | Controlled by the order state machine. |
| `dining_session_id` | UUID nullable | Required for dine-in. |
| `customer_name` | VARCHAR nullable | Required according to pickup policy. |
| `customer_phone` | VARCHAR nullable | Normalize where possible. |
| `pickup_at` | TIMESTAMPTZ nullable | Branch-local input converted to UTC. |
| `currency` | CHAR(3) | Usually `ETB`. |
| `subtotal_minor` | BIGINT | |
| `discount_minor` | BIGINT | |
| `tax_minor` | BIGINT | |
| `service_charge_minor` | BIGINT | |
| `total_minor` | BIGINT | Server calculated. |
| `notes` | TEXT nullable | Sanitized and length limited. |
| `source` | TEXT | Customer web, cashier POS, or staff table order. |
| `created_by_user_id` | UUID nullable | Null for guest orders. |
| `confirmed_at`, `completed_at`, `cancelled_at` | TIMESTAMPTZ nullable | |
| `version` | INTEGER | Optimistic concurrency. |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Unique: `(tenant_id, branch_id, order_number)`.

### `order_lines`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | |
| `tenant_id`, `branch_id`, `order_id` | UUID | |
| `menu_item_id`, `variant_id` | UUID nullable | Nullable to preserve history after catalog retirement. |
| `item_name_snapshot`, `variant_name_snapshot` | VARCHAR | Immutable display snapshots. |
| `sku_snapshot` | VARCHAR nullable | |
| `unit_price_minor` | BIGINT | Before modifiers. |
| `quantity` | INTEGER | Positive. |
| `line_total_minor` | BIGINT | Server calculated. |
| `notes` | TEXT nullable | |
| `created_at` | TIMESTAMPTZ | |

### `order_line_modifiers`

`id`, `tenant_id`, `branch_id`, `order_line_id`, nullable source IDs, name snapshot, unit price delta, quantity, and total delta.

### `order_status_history`

Append-only: `id`, tenant/branch/order IDs, `from_status`, `to_status`, `actor_user_id` nullable, `reason`, `metadata`, `created_at`.

### `order_relations`

Tracks split/merge ancestry: `id`, tenant/branch IDs, `source_order_id`, `target_order_id`, `relation_type`, `created_by_user_id`, `created_at`.

## 7. Payments and Media

### `payment_instructions`

Branch-configurable display data: `id`, tenant/branch IDs, `method`, `label`, `account_holder`, `account_identifier`, `instructions`, `is_active`, `sort_order`, timestamps. Do not store provider secrets here.

### `payments`

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID PK | |
| `tenant_id`, `branch_id`, `order_id` | UUID | |
| `method` | TEXT | Cash, manual transfer, or gateway. |
| `status` | TEXT | Payment state machine. |
| `amount_minor`, `currency` | BIGINT, CHAR(3) | |
| `provider` | VARCHAR nullable | Future adapter identifier. |
| `provider_reference` | VARCHAR nullable | Never a secret. |
| `customer_reference` | VARCHAR nullable | Optional transfer reference. |
| `submitted_at`, `reviewed_at` | TIMESTAMPTZ nullable | |
| `reviewed_by_user_id` | UUID nullable | |
| `review_note` | TEXT nullable | Required for rejection. |
| `version` | INTEGER | Optimistic concurrency. |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `media_objects`

`id`, tenant/branch IDs, `purpose`, `bucket`, `object_key`, `content_type`, `size_bytes`, `sha256`, `scan_status`, `uploaded_by_user_id` nullable, `created_at`, `deleted_at`.

### `payment_proofs`

`id`, tenant/branch/payment IDs, `media_object_id`, `submitted_by_context`, `created_at`. A payment may retain multiple submissions after rejection; exactly one can be marked current.

## 8. Kitchen

### `kitchen_stations`

`id`, tenant/branch IDs, `name`, `display_order`, `is_active`, timestamps.

### `menu_item_stations`

Join table: tenant/branch IDs, `menu_item_id`, `station_id`. Branch assignment overrides a tenant default if implemented later.

### `kitchen_tickets`

`id`, tenant/branch/order IDs, `station_id`, `ticket_number`, `status`, `priority`, `estimated_ready_at`, `started_at`, `ready_at`, `completed_at`, `version`, timestamps.

### `kitchen_ticket_lines`

`id`, tenant/branch/ticket/order-line IDs, `quantity`, `status`, timestamps.

### `kitchen_ticket_history`

Append-only status and recall history including actor, reason, and timestamp.

## 9. Inventory

### `inventory_items`

`id`, tenant/branch IDs, `name`, `sku`, `base_unit`, `low_stock_threshold`, `is_active`, timestamps.

### `inventory_batches`

`id`, tenant/branch/inventory-item IDs, `batch_code`, `received_quantity`, `remaining_quantity`, `unit`, `portion_count` nullable, `remaining_portions` nullable, `cost_minor` nullable, `received_at`, `expires_at` nullable, timestamps.

### `recipes`

`id`, tenant/branch IDs, `menu_item_variant_id`, `name`, `version`, `is_active`, timestamps.

### `recipe_components`

`id`, tenant/branch/recipe/inventory-item IDs, `quantity`, `unit`, `portion_quantity` nullable. MVP should choose one deduction representation per component and validate it.

### `inventory_movements`

Append-only ledger: `id`, tenant/branch/inventory-item IDs, `batch_id` nullable, `movement_type`, signed `quantity`, `unit`, `order_id` nullable, `reason`, `actor_user_id` nullable, `idempotency_key`, `created_at`.

Never derive historical movement solely from the mutable batch balance. Update balance and append movement in one transaction.

## 10. Audit, Idempotency, and Events

### `audit_logs`

Append-only: `id`, tenant/branch IDs nullable for platform actions, actor user ID, action, entity type/ID, safe before/after JSON, IP hash, correlation ID, `created_at`.

### `idempotency_records`

`id`, tenant/branch IDs nullable, key, operation, request hash, response status/body, resource ID, `expires_at`, `created_at`. Unique by scoped operation and key.

### `outbox_events`

`id`, tenant/branch IDs nullable, aggregate type/ID, event type, payload, occurred_at, published_at, attempt_count, last_error.

### `processed_events`

Consumer name plus event ID primary key, with `processed_at`; prevents duplicate side effects.

## 11. Critical Indexes

- Orders: `(tenant_id, branch_id, status, created_at DESC)`.
- Orders: `(tenant_id, branch_id, order_number)` unique.
- Pickup queue: `(tenant_id, branch_id, pickup_at)` for active statuses.
- Payments: `(tenant_id, branch_id, status, submitted_at)`.
- Kitchen tickets: `(tenant_id, branch_id, station_id, status, created_at)`.
- Inventory movements: `(tenant_id, branch_id, inventory_item_id, created_at DESC)`.
- Open sessions: partial unique on `(branch_id, table_id)` for open/settling statuses.
- Audit logs: `(tenant_id, created_at DESC)` and `(entity_type, entity_id, created_at)`.
- Outbox: partial `(published_at, occurred_at)` where `published_at IS NULL`.

Validate indexes with realistic query plans before adding redundant indexes.

## 12. Row-Level Security Policy Pattern

At transaction start, the API sets local PostgreSQL variables for tenant, allowed branches, and platform access. Policies compare row scope to these values. Public QR and ordering requests use a narrowly resolved tenant/branch context, not an unrestricted anonymous database role.

RLS supplements application authorization; it does not replace endpoint permission checks. Migration, maintenance, and background-worker roles must be explicitly designed and tested.

## 13. Transaction Boundaries

Use a database transaction for:

- Order creation plus lines, totals, status history, and idempotency record.
- Manual-payment approval plus payment update, order confirmation, inventory movements, audit log, and outbox event.
- KDS status transition plus history and outbox event.
- Inventory adjustment plus movement ledger and balance update.
- Order void plus payment/stock consequences, histories, audit log, and outbox event.

External calls, S3 operations, and notifications must not remain open inside long database transactions.

