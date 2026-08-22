-- AlterTable: Add unique constraint on KitchenTicket(orderId, stationId)
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_tenantId_branchId_orderId_stationId_key" UNIQUE ("tenantId", "branchId", "orderId", "stationId");
