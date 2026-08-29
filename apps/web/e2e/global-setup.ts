import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as crypto from 'crypto';

const SEED_FILE = path.join(__dirname, '.playwright-seed.json');
const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const PASSWORD = 'Test1234!';

export interface SeedData {
  api: string;
  frontend: string;
  owner: { email: string; password: string };
  manager: { email: string; password: string };
  cashier: { email: string; password: string };
  tenantId: string;
  branchId: string;
  branchSlug: string;
  publicSlug: string;
  tenantSlug: string;
  menuItemId: string;
  variantId: string;
  simpleVariantId: string;
  modifierGroupId: string;
  modifierOptionIds: string[];
  tableId: string;
  paymentInstructionId: string;
  trackingToken: string;
  paymentToken: string;
}

function uuid(): string {
  return crypto.randomUUID();
}

export default async function globalSetup(): Promise<void> {
  const dbUrl = process.env.TEST_DATABASE_URL;
  if (!dbUrl) throw new Error('TEST_DATABASE_URL is required');
  if (!dbUrl.includes('test')) throw new Error('TEST_DATABASE_URL must contain "test"');

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const ts = Date.now();
  // Use argon2 for password hashing (consistent with backend tests)
  let passwordHash: string;
  try {
    const argon2 = await import('argon2');
    passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  } catch {
    passwordHash = crypto.createHash('sha256').update(PASSWORD).digest('hex');
  }

  const ownerEmail = `pw-owner-${ts}@test.com`;
  const managerEmail = `pw-manager-${ts}@test.com`;
  const cashierEmail = `pw-cashier-${ts}@test.com`;
  const tenantSlug = `pw-tenant-${ts}`;
  const branchSlug = `pw-branch-${ts}`;

  try {
    // Tenant
    const tenantId = uuid();
    await client.query(`INSERT INTO "Tenant" ("id","name","slug","status","createdAt","updatedAt") VALUES ($1,$2,$3,'ACTIVE',now(),now())`, [tenantId, `PW Test Tenant ${ts}`, tenantSlug]);

    // Entitlements
    const ALL_FEATURE_KEYS = ['TABLE_QR_ORDERING','PICKUP_ORDERING','MANUAL_TRANSFER_PAYMENTS','PAYMENT_GATEWAY','KDS','INVENTORY','BATCH_INVENTORY','ANALYTICS','MULTI_BRANCH'];
    const ENABLED = ['TABLE_QR_ORDERING','PICKUP_ORDERING','MANUAL_TRANSFER_PAYMENTS','KDS','INVENTORY','MULTI_BRANCH'];
    for (const key of ALL_FEATURE_KEYS) {
      await client.query(`INSERT INTO "TenantEntitlement" ("id","tenantId","featureKey","status","createdAt","updatedAt") VALUES ($1,$2,$3,$4,now(),now())`, [uuid(), tenantId, key, ENABLED.includes(key) ? 'ENABLED' : 'DISABLED']);
    }

    // Branch
    const branchId = uuid();
    const publicSlug = `pw-pub-${ts}`;
    await client.query(`INSERT INTO "Branch" ("id","tenantId","name","slug","publicSlug","isActive","createdAt","updatedAt") VALUES ($1,$2,'Main Branch',$3,$4,true,now(),now())`, [branchId, tenantId, branchSlug, publicSlug]);

    // Owner user
    const ownerId = uuid();
    await client.query(`INSERT INTO "User" ("id","email","passwordHash","displayName","status","createdAt","updatedAt") VALUES ($1,$2,$3,'PW Owner','ACTIVE',now(),now())`, [ownerId, ownerEmail, passwordHash]);
    const ownerMembershipId = uuid();
    await client.query(`INSERT INTO "TenantMembership" ("id","tenantId","userId","role","status","createdAt","updatedAt") VALUES ($1,$2,$3,'OWNER','ACTIVE',now(),now())`, [ownerMembershipId, tenantId, ownerId]);
    await client.query(`INSERT INTO "BranchAssignment" ("tenantId","branchId","membershipId","createdAt") VALUES ($1,$2,$3,now())`, [tenantId, branchId, ownerMembershipId]);

    // Manager user
    const managerId = uuid();
    await client.query(`INSERT INTO "User" ("id","email","passwordHash","displayName","status","createdAt","updatedAt") VALUES ($1,$2,$3,'PW Manager','ACTIVE',now(),now())`, [managerId, managerEmail, passwordHash]);
    const managerMembershipId = uuid();
    await client.query(`INSERT INTO "TenantMembership" ("id","tenantId","userId","role","status","createdAt","updatedAt") VALUES ($1,$2,$3,'MANAGER','ACTIVE',now(),now())`, [managerMembershipId, tenantId, managerId]);
    await client.query(`INSERT INTO "BranchAssignment" ("tenantId","branchId","membershipId","createdAt") VALUES ($1,$2,$3,now())`, [tenantId, branchId, managerMembershipId]);

    // Cashier user
    const cashierId = uuid();
    await client.query(`INSERT INTO "User" ("id","email","passwordHash","displayName","status","createdAt","updatedAt") VALUES ($1,$2,$3,'PW Cashier','ACTIVE',now(),now())`, [cashierId, cashierEmail, passwordHash]);
    const cashierMembershipId = uuid();
    await client.query(`INSERT INTO "TenantMembership" ("id","tenantId","userId","role","status","createdAt","updatedAt") VALUES ($1,$2,$3,'CASHIER','ACTIVE',now(),now())`, [cashierMembershipId, tenantId, cashierId]);
    await client.query(`INSERT INTO "BranchAssignment" ("tenantId","branchId","membershipId","createdAt") VALUES ($1,$2,$3,now())`, [tenantId, branchId, cashierMembershipId]);

    // Menu category
    const categoryId = uuid();
    await client.query(`INSERT INTO "MenuCategory" ("id","tenantId","name","sortOrder","isActive","createdAt","updatedAt") VALUES ($1,$2,'Food',0,true,now(),now())`, [categoryId, tenantId]);

    // Menu item
    const menuItemId = uuid();
    await client.query(`INSERT INTO "MenuItem" ("id","tenantId","categoryId","name","description","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'Test Burger','A test burger',true,now(),now())`, [menuItemId, tenantId, categoryId]);

    // Default variant
    const variantId = uuid();
    await client.query(`INSERT INTO "MenuItemVariant" ("id","tenantId","menuItemId","name","sku","basePriceMinor","isDefault","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'Regular','BURG-001',25000,true,true,now(),now())`, [variantId, tenantId, menuItemId]);

    // Second variant (Large)
    await client.query(`INSERT INTO "MenuItemVariant" ("id","tenantId","menuItemId","name","sku","basePriceMinor","isDefault","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'Large','BURG-002',35000,false,true,now(),now())`, [uuid(), tenantId, menuItemId]);

    // Required modifier group: Toppings
    const modifierGroupId = uuid();
    await client.query(`INSERT INTO "ModifierGroup" ("id","tenantId","name","minSelections","maxSelections","isRequired","createdAt","updatedAt") VALUES ($1,$2,'Toppings',1,3,true,now(),now())`, [modifierGroupId, tenantId]);

    // Modifier options
    const opt1 = uuid(); const opt2 = uuid(); const opt3 = uuid();
    await client.query(`INSERT INTO "ModifierOption" ("id","tenantId","modifierGroupId","name","priceDeltaMinor","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'Lettuce',0,true,now(),now())`, [opt1, tenantId, modifierGroupId]);
    await client.query(`INSERT INTO "ModifierOption" ("id","tenantId","modifierGroupId","name","priceDeltaMinor","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'Tomato',500,true,now(),now())`, [opt2, tenantId, modifierGroupId]);
    await client.query(`INSERT INTO "ModifierOption" ("id","tenantId","modifierGroupId","name","priceDeltaMinor","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'Cheese',1500,true,now(),now())`, [opt3, tenantId, modifierGroupId]);

    // Link modifier group to item
    await client.query(`INSERT INTO "MenuItemModifierGroup" ("tenantId","menuItemId","modifierGroupId","sortOrder") VALUES ($1,$2,$3,0)`, [tenantId, menuItemId, modifierGroupId]);

    // Link menu item to branch (required for branch-scoped menu endpoint)
    await client.query(`INSERT INTO "BranchMenuItem" ("tenantId","branchId","menuItemId","isAvailable","updatedAt") VALUES ($1,$2,$3,true,now())`, [tenantId, branchId, menuItemId]);

    // Simple menu item without required modifiers (for easy add-to-cart testing)
    const simpleCategoryId = uuid();
    await client.query(`INSERT INTO "MenuCategory" ("id","tenantId","name","sortOrder","isActive","createdAt","updatedAt") VALUES ($1,$2,'Drinks',1,true,now(),now())`, [simpleCategoryId, tenantId]);
    const simpleItemId = uuid();
    await client.query(`INSERT INTO "MenuItem" ("id","tenantId","categoryId","name","description","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'Water','Bottled water',true,now(),now())`, [simpleItemId, tenantId, simpleCategoryId]);
    const simpleVariantId = uuid();
    await client.query(`INSERT INTO "MenuItemVariant" ("id","tenantId","menuItemId","name","sku","basePriceMinor","isDefault","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'500ml','WAT-001',5000,true,true,now(),now())`, [simpleVariantId, tenantId, simpleItemId]);
    await client.query(`INSERT INTO "BranchMenuItem" ("tenantId","branchId","menuItemId","isAvailable","updatedAt") VALUES ($1,$2,$3,true,now())`, [tenantId, branchId, simpleItemId]);

    // Optional modifier group: Extras
    const optModGroupId = uuid();
    await client.query(`INSERT INTO "ModifierGroup" ("id","tenantId","name","minSelections","maxSelections","isRequired","createdAt","updatedAt") VALUES ($1,$2,'Extras',0,2,false,now(),now())`, [optModGroupId, tenantId]);
    const extra1 = uuid();
    await client.query(`INSERT INTO "ModifierOption" ("id","tenantId","modifierGroupId","name","priceDeltaMinor","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'Bacon',3000,true,now(),now())`, [extra1, tenantId, optModGroupId]);
    await client.query(`INSERT INTO "MenuItemModifierGroup" ("tenantId","menuItemId","modifierGroupId","sortOrder") VALUES ($1,$2,$3,1)`, [tenantId, menuItemId, optModGroupId]);

    // Table
    const tableId = uuid();
    await client.query(`INSERT INTO "RestaurantTable" ("id","tenantId","branchId","label","capacity","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,'T1',4,true,now(),now())`, [tableId, tenantId, branchId]);

    // Branch order counter
    await client.query(`INSERT INTO "BranchOrderCounter" ("branchId","lastNumber","createdAt","updatedAt") VALUES ($1,0,now(),now()) ON CONFLICT ("branchId") DO NOTHING`, [branchId]);

    // Payment instruction
    const paymentInstructionId = uuid();
    await client.query(`INSERT INTO "PaymentInstruction" ("id","tenantId","branchId","method","label","accountHolder","accountIdentifier","instructions","createdAt","updatedAt") VALUES ($1,$2,$3,'CBE','CBE Birr','Test Restaurant','1234567890','Transfer the exact amount',now(),now())`, [paymentInstructionId, tenantId, branchId]);

    // Feature settings for owner
    for (const key of ENABLED) {
      await client.query(`INSERT INTO "FeatureSetting" ("id","tenantId","branchId","featureKey","enabled","updatedByUserId","createdAt","updatedAt") VALUES ($1,$2,NULL,$3,true,$4,now(),now()) ON CONFLICT DO NOTHING`, [uuid(), tenantId, key, ownerId]);
    }

    // Tracking token
    const trackingRaw = crypto.randomBytes(32).toString('base64url');
    const trackingHash = crypto.createHash('sha256').update(trackingRaw).digest('hex');

    // Order in PENDING_PAYMENT status for owner review tests
    const orderId = uuid();
    await client.query(`INSERT INTO "Order" ("id","tenantId","branchId","orderNumber","orderType","status","tableId","currency","subtotalMinor","totalMinor","source","trackingTokenHash","version","createdAt","updatedAt") VALUES ($1,$2,$3,1,'DINE_IN','PENDING_PAYMENT',$4,'ETB',25000,25000,'CUSTOMER_WEB',$5,1,now(),now())`, [orderId, tenantId, branchId, tableId, trackingHash]);

    // Order line
    await client.query(`INSERT INTO "OrderLine" ("id","tenantId","branchId","orderId","menuItemId","variantId","itemNameSnapshot","variantNameSnapshot","skuSnapshot","unitPriceMinor","quantity","lineTotalMinor","createdAt") VALUES ($1,$2,$3,$4,$5,$6,'Test Burger','Regular','BURG-001',25000,1,25000,now())`, [uuid(), tenantId, branchId, orderId, menuItemId, variantId]);

    // Payment for the order
    const paymentId = uuid();
    await client.query(`INSERT INTO "Payment" ("id","tenantId","branchId","orderId","method","amountMinor","currency","status","customerReference","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'BANK_TRANSFER',25000,'ETB','PENDING_VERIFICATION','REF-TEST-001',now(),now())`, [paymentId, tenantId, branchId, orderId]);

    // Open shift for cashier
    const shiftId = uuid();
    await client.query(`INSERT INTO "CashShift" ("id","tenantId","branchId","cashierUserId","status","openingCashMinor","version","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'OPEN',50000,1,now(),now())`, [shiftId, tenantId, branchId, cashierId]);

    const seedData: SeedData = {
      api: API_URL + '/api/v1',
      frontend: FRONTEND_URL,
      owner: { email: ownerEmail, password: PASSWORD },
      manager: { email: managerEmail, password: PASSWORD },
      cashier: { email: cashierEmail, password: PASSWORD },
      tenantId,
      branchId,
      branchSlug,
      publicSlug,
      tenantSlug,
      menuItemId,
      variantId,
      simpleVariantId,
      modifierGroupId,
      modifierOptionIds: [opt1, opt2, opt3],
      tableId,
      paymentInstructionId,
      trackingToken: trackingRaw,
      paymentToken: trackingRaw,
    };

    fs.writeFileSync(SEED_FILE, JSON.stringify(seedData, null, 2));
    console.log(`  Seed data written to ${SEED_FILE}`);
    console.log(`  Tenant: ${tenantSlug}, Branch: ${branchSlug}`);
    console.log(`  Owner: ${ownerEmail}, Manager: ${managerEmail}, Cashier: ${cashierEmail}`);
  } finally {
    await client.end();
  }
}
