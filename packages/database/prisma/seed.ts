import { PrismaClient, TenantStatus, UserStatus } from '@prisma/client';
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
      status: UserStatus.ACTIVE,
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
      status: TenantStatus.ACTIVE,
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
      status: UserStatus.ACTIVE,
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
      status: UserStatus.ACTIVE,
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
      status: UserStatus.ACTIVE,
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
      status: UserStatus.ACTIVE,
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
      where: { membershipId_branchId: { membershipId: a.membershipId, branchId: a.branchId } },
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
    await prisma.featureSetting.upsert({
      where: { tenantId_branchId_featureKey: { tenantId: tenant.id, branchId: null, featureKey: key } },
      update: {},
      create: {
        tenantId: tenant.id,
        branchId: null,
        featureKey: key,
        enabled: true,
        updatedByUserId: owner.id,
      },
    });
  }

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
