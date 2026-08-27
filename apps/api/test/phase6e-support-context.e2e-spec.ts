import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { seedEntitlements } from './entitlements-test-utils';

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
    .set('Content-Type', 'application/json')
    .send({ email, password: 'Test1234!' });
  if (!res.body?.data?.accessToken)
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

describe('Phase 6E — Support Context (e2e)', () => {
  let app: any;
  let superAdminToken: string;
  let ownerToken: string;
  let waiterToken: string;
  let tenantId: string;
  let branchId: string;
  let categoryId: string;

  const saEmail = `phase6e-sa-${ts}@test.com`;
  const ownerEmail = `phase6e-owner-${ts}@test.com`;
  const waiterEmail = `phase6e-waiter-${ts}@test.com`;
  let passwordHash: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });
    passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    // Create Super Admin
    const sa = await prisma.user.create({
      data: { email: saEmail, passwordHash, displayName: 'SuperAdmin', status: 'ACTIVE', platformRole: 'SUPER_ADMIN' },
    });
    superAdminToken = await login(app, saEmail);

    // Create tenant and branch
    const tenant = await prisma.tenant.create({ data: { name: 'Phase6ETest', slug: `phase6e-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'Main Branch', slug: `phase6e-main-${ts}`, isActive: true },
    });
    branchId = branch.id;

    // Create owner
    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: om.id } });
    ownerToken = await login(app, ownerEmail);

    // Create waiter
    const waiter = await prisma.user.create({ data: { email: waiterEmail, passwordHash, displayName: 'Waiter', status: 'ACTIVE' } });
    const wm = await prisma.tenantMembership.create({ data: { tenantId, userId: waiter.id, role: 'WAITER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: wm.id } });
    waiterToken = await login(app, waiterEmail);
  });

  afterAll(async () => {
    await app.close();
    await prisma.supportSession.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.branch.delete({ where: { id: branchId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [saEmail, ownerEmail, waiterEmail] } } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('1. super admin enters support mode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId, reason: 'Debugging menu configuration' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.tenantId).toBe(tenantId);
    expect(res.body.data.reason).toBe('Debugging menu configuration');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.expiresAt).toBeDefined();
  });

  it('2. entering support mode requires reason', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId, reason: '' });
    expect(res.status).toBe(400);
  });

  it('3. non-super-admin cannot enter support mode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ tenantId, reason: 'Test' });
    expect(res.status).toBe(403);
  });

  it('4. waiter cannot enter support mode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ tenantId, reason: 'Test' });
    expect(res.status).toBe(403);
  });

  it('5. active support session is retrievable', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('6. super admin exits support mode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/support/exit')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ENDED');
  });

  it('7. no active session after exit', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/platform/support/active?tenantId=${tenantId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('8. re-entering support mode creates new session', async () => {
    const enterRes = await request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId, reason: 'Second support session' });
    expect(enterRes.status).toBe(200);
    expect(enterRes.body.data.status).toBe('ACTIVE');

    // Exit again for cleanup
    await request(app.getHttpServer())
      .post('/api/v1/platform/support/exit')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId });
  });

  it('9. support session has 30-minute expiry', async () => {
    const enterRes = await request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId, reason: 'Expiry test' });
    expect(enterRes.status).toBe(200);

    const expiresAt = new Date(enterRes.body.data.expiresAt);
    const startedAt = new Date(enterRes.body.data.startedAt);
    const diffMs = expiresAt.getTime() - startedAt.getTime();
    expect(diffMs).toBe(30 * 60 * 1000); // 30 minutes

    // Exit
    await request(app.getHttpServer())
      .post('/api/v1/platform/support/exit')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId });
  });

  it('10. support session for non-existent tenant returns 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId: '00000000-0000-0000-0000-000000000000', reason: 'Test' });
    expect(res.status).toBe(404);
  });

  it('11. exiting non-existent session returns 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/support/exit')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ tenantId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('12. owner cannot enter support mode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/support/enter')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ tenantId, reason: 'Test' });
    expect(res.status).toBe(403);
  });
});
