import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // Safety check: refuse to run against production
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') {
    console.error('Seed script refuses to run in production. Use migrations instead.');
    process.exit(1);
  }

  console.log(`Seeding database (env: ${env})...`);

  // 1. Platform super admin
  const superAdminPasswordHash = await argon2.hash('admin123', { type: argon2.argon2id });
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@rms.dev' },
    update: {},
    create: {
      email: 'admin@rms.dev',
      passwordHash: superAdminPasswordHash,
      displayName: 'Platform Admin',
      platformRole: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`Super admin: ${superAdmin.email} (admin123)`);

  // 2. Demo tenant: Coffee House
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-coffee-house' },
    update: {},
    create: {
      name: 'Demo Coffee House',
      slug: 'demo-coffee-house',
      status: 'ACTIVE',
    },
  });

  // 3. Owner
  const ownerPasswordHash = await argon2.hash('owner123', { type: argon2.argon2id });
  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.com' },
    update: {},
    create: {
      email: 'owner@demo.com',
      passwordHash: ownerPasswordHash,
      displayName: 'Abebe Kebede',
      status: 'ACTIVE',
    },
  });

  const ownerMembership = await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: owner.id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  console.log(`Owner: ${owner.email} (owner123)`);

  // 4. Manager
  const managerPasswordHash = await argon2.hash('manager123', { type: argon2.argon2id });
  const manager = await prisma.user.upsert({
    where: { email: 'manager@demo.com' },
    update: {},
    create: {
      email: 'manager@demo.com',
      passwordHash: managerPasswordHash,
      displayName: 'Almaz Tesfaye',
      status: 'ACTIVE',
    },
  });

  const managerMembership = await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: manager.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: manager.id,
      role: 'MANAGER',
      status: 'ACTIVE',
    },
  });

  // 5. Cashier
  const cashierPasswordHash = await argon2.hash('cashier123', { type: argon2.argon2id });
  const cashier = await prisma.user.upsert({
    where: { email: 'cashier@demo.com' },
    update: {},
    create: {
      email: 'cashier@demo.com',
      passwordHash: cashierPasswordHash,
      displayName: 'Dawit Mulugeta',
      status: 'ACTIVE',
    },
  });

  const cashierMembership = await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: cashier.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: cashier.id,
      role: 'CASHIER',
      status: 'ACTIVE',
    },
  });

  // 6. Kitchen staff
  const kitchenPasswordHash = await argon2.hash('kitchen123', { type: argon2.argon2id });
  const kitchen = await prisma.user.upsert({
    where: { email: 'kitchen@demo.com' },
    update: {},
    create: {
      email: 'kitchen@demo.com',
      passwordHash: kitchenPasswordHash,
      displayName: 'Fatima Hassan',
      status: 'ACTIVE',
    },
  });

  const kitchenMembership = await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: kitchen.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: kitchen.id,
      role: 'KITCHEN_STAFF',
      status: 'ACTIVE',
    },
  });

  // 7. Two branches
  const branchMain = await prisma.branch.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'main' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Main Branch',
      slug: 'main',
      isActive: true,
    },
  });

  const branchDowntown = await prisma.branch.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'downtown' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Downtown Branch',
      slug: 'downtown',
      isActive: true,
    },
  });

  console.log(`Branches: ${branchMain.name}, ${branchDowntown.name}`);

  // 8. Branch assignments (manager to both, cashier to main only, kitchen to main only)
  const assignments = [
    { membershipId: managerMembership.id, branchId: branchMain.id },
    { membershipId: managerMembership.id, branchId: branchDowntown.id },
    { membershipId: cashierMembership.id, branchId: branchMain.id },
    { membershipId: kitchenMembership.id, branchId: branchMain.id },
  ];

  for (const a of assignments) {
    await prisma.branchAssignment.upsert({
      where: { branchId_membershipId: { branchId: a.branchId, membershipId: a.membershipId } },
      update: {},
      create: {
        tenantId: tenant.id,
        branchId: a.branchId,
        membershipId: a.membershipId,
      },
    });
  }

  console.log(`Cashier: ${cashier.email} (cashier123) — assigned to Main only`);
  console.log(`Kitchen: ${kitchen.email} (kitchen123) — assigned to Main only`);
  console.log(`Manager: ${manager.email} (manager123) — assigned to both branches`);

  // 9. Feature defaults
  const features = ['KDS', 'HOLD_RELEASE', 'RESERVATIONS', 'PROMOS', 'INVENTORY', 'EXPENSES', 'ADVANCE_ORDERS'];
  for (const key of features) {
    const existingFeature = await prisma.featureSetting.findFirst({
      where: { tenantId: tenant.id, branchId: null, featureKey: key },
    });
    if (!existingFeature) {
      await prisma.featureSetting.create({
        data: {
        tenantId: tenant.id,
        branchId: null,
        featureKey: key,
        enabled: true,
        updatedByUserId: owner.id,
        },
      });
    }
  }

  // 10. Demo catalog. Keep this idempotent so reseeding never duplicates data.
  const categoryDefinitions = [
    { name: 'Main dishes', description: 'Traditional Ethiopian main dishes', sortOrder: 0 },
    { name: 'Breakfast', description: 'Breakfast and early service dishes', sortOrder: 1 },
    { name: 'Drinks', description: 'Hot and cold beverages', sortOrder: 2 },
    { name: 'Desserts', description: 'Desserts and sweet dishes', sortOrder: 3 },
  ];
  const categories = new Map<string, { id: string }>();
  for (const definition of categoryDefinitions) {
    const existing = await prisma.menuCategory.findFirst({ where: { tenantId: tenant.id, name: definition.name } });
    const category = existing ?? await prisma.menuCategory.create({ data: { tenantId: tenant.id, ...definition } });
    categories.set(definition.name, category);
  }

  const catalogItems = [
    { name: 'Special Tibs', description: 'Sizzling beef tibs with peppers and onions', category: 'Main dishes', priceMinor: 40000n, available: true },
    { name: 'Shiro Wot', description: 'Slow-cooked chickpea stew served with injera', category: 'Main dishes', priceMinor: 29000n, available: true },
    { name: 'Beyaynetu', description: 'A colorful selection of fasting dishes', category: 'Main dishes', priceMinor: 35000n, available: true },
    { name: 'Special Firfir', description: 'Spiced injera firfir prepared for breakfast', category: 'Breakfast', priceMinor: 26000n, available: true },
    { name: 'Buna Ceremony', description: 'Traditional Ethiopian coffee service', category: 'Drinks', priceMinor: 15000n, available: true },
    { name: 'House Baklava', description: 'Layered pastry with nuts and honey', category: 'Desserts', priceMinor: 12000n, available: false },
  ];

  for (const definition of catalogItems) {
    const categoryId = categories.get(definition.category)!.id;
    const existing = await prisma.menuItem.findFirst({ where: { tenantId: tenant.id, name: definition.name } });
    const item = existing
      ? await prisma.menuItem.update({ where: { id: existing.id }, data: { categoryId, description: definition.description, isActive: true, deletedAt: null } })
      : await prisma.menuItem.create({ data: { tenantId: tenant.id, categoryId, name: definition.name, description: definition.description } });

    const existingVariant = await prisma.menuItemVariant.findFirst({ where: { tenantId: tenant.id, menuItemId: item.id, name: 'Regular' } });
    if (existingVariant) {
      await prisma.menuItemVariant.update({ where: { id: existingVariant.id }, data: { basePriceMinor: definition.priceMinor, isDefault: true, isActive: true } });
    } else {
      await prisma.menuItemVariant.create({ data: { tenantId: tenant.id, menuItemId: item.id, name: 'Regular', basePriceMinor: definition.priceMinor, isDefault: true } });
    }

    for (const branch of [branchMain, branchDowntown]) {
      await prisma.branchMenuItem.upsert({
        where: { branchId_menuItemId: { branchId: branch.id, menuItemId: item.id } },
        update: { isAvailable: definition.available },
        create: { tenantId: tenant.id, branchId: branch.id, menuItemId: item.id, isAvailable: definition.available },
      });
    }
  }

  console.log(`Catalog: ${catalogItems.length} menu items across ${categoryDefinitions.length} categories`);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
