-- Pre-migration fixture for 20260912000000_multi_kitchen_fulfillment replay.
-- Inserted AFTER migrations 1..23 and BEFORE the target migration, so the
-- target's backfills (Main Kitchen, stations, tickets, policies, fulfillment
-- status) run against realistic pre-multi-kitchen data.
--
-- Pre-target shapes: no Kitchen table, no KitchenStation.kitchenId,
-- no KitchenTicket.kitchenId/ticketType, no Order.fulfillmentStatus,
-- no BranchFulfillmentPolicy.

INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt")
VALUES ('t-mig', 'Migration Replay Fixture', 'mig-replay', now());

INSERT INTO "Branch" ("id", "tenantId", "name", "slug", "updatedAt") VALUES
  ('b-mig-main', 't-mig', 'Main Branch', 'mig-main', now()),
  ('b-mig-downtown', 't-mig', 'Downtown Branch', 'mig-downtown', now());

INSERT INTO "KitchenStation" ("id", "tenantId", "branchId", "name", "updatedAt") VALUES
  ('s-mig-grill', 't-mig', 'b-mig-main', 'Grill', now()),
  ('s-mig-fry', 't-mig', 'b-mig-main', 'Fryer', now()),
  ('s-mig-cold', 't-mig', 'b-mig-downtown', 'Cold Line', now());

INSERT INTO "Order" ("id", "tenantId", "branchId", "orderNumber", "orderType", "updatedAt") VALUES
  ('o-mig-ready', 't-mig', 'b-mig-main', 1001, 'DINE_IN', now()),
  ('o-mig-partial', 't-mig', 'b-mig-main', 1002, 'DINE_IN', now()),
  ('o-mig-queued', 't-mig', 'b-mig-downtown', 1003, 'DINE_IN', now()),
  ('o-mig-completed', 't-mig', 'b-mig-downtown', 1004, 'DINE_IN', now());

INSERT INTO "OrderLine" ("id", "tenantId", "branchId", "orderId", "itemNameSnapshot", "unitPriceMinor", "quantity", "lineTotalMinor")
VALUES ('ol-mig-1', 't-mig', 'b-mig-main', 'o-mig-ready', 'Grilled Fish', 50000, 2, 100000);

-- Distinct (tenantId, branchId, orderId, stationId) to satisfy the pre-target
-- unique constraint from 20260822000001_add_kitchen_ticket_unique_constraint.
INSERT INTO "KitchenTicket" ("id", "tenantId", "branchId", "orderId", "stationId", "ticketNumber", "status", "updatedAt") VALUES
  ('kt-mig-ready', 't-mig', 'b-mig-main', 'o-mig-ready', 's-mig-grill', 91001, 'READY', now()),
  ('kt-mig-pready', 't-mig', 'b-mig-main', 'o-mig-partial', 's-mig-grill', 91002, 'READY', now()),
  ('kt-mig-pinprog', 't-mig', 'b-mig-main', 'o-mig-partial', 's-mig-fry', 91003, 'IN_PROGRESS', now()),
  ('kt-mig-queued', 't-mig', 'b-mig-downtown', 'o-mig-queued', 's-mig-cold', 91004, 'QUEUED', now()),
  ('kt-mig-completed', 't-mig', 'b-mig-downtown', 'o-mig-completed', 's-mig-cold', 91005, 'COMPLETED', now());
