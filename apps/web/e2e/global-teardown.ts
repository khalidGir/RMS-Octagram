import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import type { SeedData } from './global-setup';

const SEED_FILE = path.join(__dirname, '.playwright-seed.json');

export default async function globalTeardown(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) return;
  if (!fs.existsSync(SEED_FILE)) return;

  const raw = fs.readFileSync(SEED_FILE, 'utf-8');
  const seed: SeedData = JSON.parse(raw);
  fs.unlinkSync(SEED_FILE);

  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();

  try {
    const tid = seed.tenantId;
    const bid = seed.branchId;

    // FK-safe cleanup in reverse dependency order
    await client.query(`DELETE FROM "PaymentProof" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "MediaObject" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "Payment" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "PaymentInstruction" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "IdempotencyRecord" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "OrderStatusHistory" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "OrderLineModifier" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "OrderLine" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "Order" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "CashShift" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "ShiftReportSnapshot" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "BranchOrderCounter" WHERE "branchId"=$1`, [bid]).catch(() => {});
    await client.query(`DELETE FROM "FeatureSetting" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "TenantEntitlement" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "OutboxEvent" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "AuditLog" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "BranchAssignment" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "TenantMembership" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "RestaurantTable" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "MenuItemModifierGroup" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "ModifierOption" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "ModifierGroup" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "MenuItemVariant" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "MenuItemStation" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "BranchMenuItem" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "MenuItem" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "MenuCategory" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "KitchenStation" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "Branch" WHERE "tenantId"=$1`, [tid]).catch(() => {});
    await client.query(`DELETE FROM "Tenant" WHERE "id"=$1`, [tid]).catch(() => {});

    // Cleanup users by email pattern
    await client.query(`DELETE FROM "AuthSession" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%pw-%')`).catch(() => {});
    await client.query(`DELETE FROM "User" WHERE "email" LIKE '%pw-%'`).catch(() => {});

    console.log('  Playwright seed data cleaned up');
  } finally {
    await client.end();
  }
}
