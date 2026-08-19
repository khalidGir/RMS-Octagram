import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('Seeding database...');

    // Create a demo tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Demo Restaurant',
        slug: 'demo-restaurant',
        status: 'ACTIVE',
        defaultCurrency: 'ETB',
        defaultTimezone: 'Africa/Addis_Ababa',
      },
    });

    console.log(`Created tenant: ${tenant.name} (${tenant.id})`);

    // Create a demo branch
    const branch = await prisma.branch.create({
      data: {
        tenantId: tenant.id,
        name: 'Bole Main',
        slug: 'bole-main',
        timezone: 'Africa/Addis_Ababa',
        currency: 'ETB',
        isActive: true,
      },
    });

    console.log(`Created branch: ${branch.name} (${branch.id})`);

    console.log('Seed complete.');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
