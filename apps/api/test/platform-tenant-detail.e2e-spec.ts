import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test'))
  throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const ts = Date.now();

async function login(app: any, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test1234!' });
  if (!res.body?.data?.accessToken)
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

describe('Platform tenant detail (e2e)', () => {
  let app: INestApplication;
  let superAdminToken: string;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;

  const superAdminEmail = `sa-detail-${ts}@test.com`;
  const ownerEmail = `owner-detail-${ts}@test.com`;
  const managerEmail = `mgr-detail-${ts}@test.com`;
  const cashierEmail = `cash-detail-${ts}@test.com`;

  beforeAll(async () => {
    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    app.get(OutboxProcessor).stop();

    await prisma.user.create({
      data: { email: superAdminEmail, passwordHash, displayName: 'SA Detail', status: 'ACTIVE', platformRole: 'SUPER_ADMIN' },
    });
    superAdminToken = await login(app, superAdminEmail);

    const tenant = await prisma.tenant.create({
      data: { name: 'Detail T1', slug: `detail-t1-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Detail Main', slug: `detail-main-${ts}`, publicSlug: `detail-main-${ts}`, isActive: true },
    });
    branchId = branch.id;

    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Detail Owner', status: 'ACTIVE' },
    });
    const om = await prisma.tenantMembership.create({
      data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });
    ownerToken = await login(app, ownerEmail);

    const manager = await prisma.user.create({
      data: { email: managerEmail, passwordHash, displayName: 'Detail Manager', status: 'ACTIVE' },
    });
    await prisma.tenantMembership.create({
      data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' },
    });
    managerToken = await login(app, managerEmail);

    const cashier = await prisma.user.create({
      data: { email: cashierEmail, passwordHash, displayName: 'Detail Cashier', status: 'ACTIVE' },
    });
    await prisma.tenantMembership.create({
      data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' },
    });
    cashierToken = await login(app, cashierEmail);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    if (tenantId) {
      await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.branch.deleteMany({ where: { tenantId } }).catch(() => {});
      await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { email: { contains: '-detail-' } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('returns full detail for SUPER_ADMIN', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/platform/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    const detail = res.body.data;
    expect(detail.id).toBe(tenantId);
    expect(detail.name).toBe('Detail T1');
    expect(detail.status).toBe('ACTIVE');
    expect(detail._count.branches).toBe(1);
    expect(detail._count.memberships).toBe(3);
    expect(detail.branches).toHaveLength(1);
    expect(detail.branches[0].name).toBe('Detail Main');
    expect(detail.branches[0].publicSlug).toBeTruthy();
    const owner = detail.memberships.find((m: any) => m.role === 'OWNER');
    expect(owner).toBeTruthy();
    expect(owner.user.displayName).toBe('Detail Owner');
    expect(owner.user.phoneE164).toBeNull();
  });

  it('returns 404 for an unknown tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/platform/tenants/${tenantId}`);
    expect(res.status).toBe(401);
  });

  it('denies OWNER', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/platform/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it('denies MANAGER', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/platform/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
  });

  it('denies CASHIER', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/platform/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(403);
  });
});
