import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { MenuImageStorageService } from '../src/modules/catalog/menu-image-storage.service';
import { SqsQueueService } from '../src/modules/outbox/sqs-queue.service';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test')) throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.MEDIA_CDN_URL = process.env.MEDIA_CDN_URL || 'https://media.example.test';

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

// In-memory stand-in for S3: no AWS credentials, deterministic verification.
// Mirrors the real MenuImageStorageService contract, including the type/size
// gate that exists independently of DTO validation.
const inMemoryStorage = {
  bucket: 'test-media-bucket',
  objects: new Map<string, { sizeBytes: number; contentType: string; sha256: string }>(),
  async createUpload(params: { tenantId: string; itemId: string; contentType: string; sizeBytes: number; sha256: string }) {
    const accepted = ['image/jpeg', 'image/png', 'image/webp'];
    if (!accepted.includes(params.contentType) || params.sizeBytes < 1 || params.sizeBytes > 10 * 1024 * 1024) {
      throw new BadRequestException('Unsupported menu image');
    }
    const extension = params.contentType === 'image/jpeg' ? 'jpg' : params.contentType.split('/')[1];
    const objectKey = `tenant/${params.tenantId}/menu-items/${params.itemId}/original/${randomUUID()}.${extension}`;
    return { uploadUrl: `https://s3.test.local/${objectKey}`, objectKey, fields: { key: objectKey } };
  },
  async verifyObject(params: { objectKey: string; sizeBytes: number; contentType: string; sha256: string }) {
    const stored = this.objects.get(params.objectKey);
    if (!stored) throw new BadRequestException('Uploaded image was not found');
    if (stored.sizeBytes !== params.sizeBytes || stored.contentType !== params.contentType || stored.sha256 !== params.sha256) {
      throw new BadRequestException('Uploaded image does not match its upload intent');
    }
  },
  simulateUpload(objectKey: string, sizeBytes: number, contentType: string, sha256: string) {
    this.objects.set(objectKey, { sizeBytes, contentType, sha256 });
  },
};

// Captures direct queue sends so the suite can prove publication goes through
// the outbox transaction instead.
const sqsCapture = { send: vi.fn(async () => undefined) };

describe('Menu Item Image Upload (e2e)', () => {
  let app: any;
  let ownerToken: string;
  let managerToken: string;
  let branchBManagerToken: string;
  let cashierToken: string;
  let waiterToken: string;
  let outsiderToken: string;
  let tenantId: string;
  let otherTenantId: string;
  let branchAId: string;
  let branchBId: string;
  let categoryId: string;
  let ownerUserId: string;

  const ts = Date.now();
  const ownerEmail = `mi-owner-${ts}@test.com`;
  const managerEmail = `mi-manager-${ts}@test.com`;
  const branchBManagerEmail = `mi-mb-${ts}@test.com`;
  const cashierEmail = `mi-cashier-${ts}@test.com`;
  const waiterEmail = `mi-waiter-${ts}@test.com`;
  const outsiderEmail = `mi-outsider-${ts}@test.com`;

  const login = async (email: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email, password: 'Test1234!' });
    if (!res.body?.data?.accessToken) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
    return res.body.data.accessToken;
  };

  const createItem = async (name: string) => {
    const item = await prisma.menuItem.create({ data: { tenantId, categoryId, name, isActive: true } });
    return item;
  };

  const uploadIntent = (itemId: string, token: string, expectedVersion: number, overrides: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/api/v1/items/${itemId}/image/upload-intent`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId)
      .send({
        contentType: 'image/jpeg',
        sizeBytes: 128,
        sha256: 'a'.repeat(64),
        crop: { x: 0, y: 0, width: 1, height: 1 },
        expectedVersion,
        ...overrides,
      });

  const finalizeImage = (itemId: string, token: string, mediaObjectId: string, expectedVersion: number) =>
    request(app.getHttpServer())
      .post(`/api/v1/items/${itemId}/image/finalize`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId)
      .send({ mediaObjectId, expectedVersion });

  const imageStatus = (itemId: string, token: string, mediaObjectId?: string) => {
    const query = mediaObjectId ? `?mediaObjectId=${encodeURIComponent(mediaObjectId)}` : '';
    return request(app.getHttpServer())
      .get(`/api/v1/items/${itemId}/image/status${query}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', tenantId);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MenuImageStorageService)
      .useValue(inMemoryStorage)
      .overrideProvider(SqsQueueService)
      .useValue(sqsCapture)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    app.get(OutboxProcessor).stop();
    await prisma.outboxEvent.deleteMany({ where: { publishedAt: null } });

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });

    const tenant = await prisma.tenant.create({ data: { name: 'MenuImageTest', slug: `menu-image-test-${ts}`, status: 'ACTIVE' } });
    tenantId = tenant.id;
    await seedEntitlements(prisma, tenantId);

    const branchA = await prisma.branch.create({ data: { tenantId, name: 'BranchA', slug: `a-${ts}`, isActive: true } });
    branchAId = branchA.id;
    const branchB = await prisma.branch.create({ data: { tenantId, name: 'BranchB', slug: `b-${ts}`, isActive: true } });
    branchBId = branchB.id;

    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' } });
    ownerUserId = owner.id;
    const om = await prisma.tenantMembership.create({ data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId: branchAId, membershipId: om.id } });

    const manager = await prisma.user.create({ data: { email: managerEmail, passwordHash, displayName: 'Manager', status: 'ACTIVE' } });
    const mm = await prisma.tenantMembership.create({ data: { tenantId, userId: manager.id, role: 'MANAGER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId: branchAId, membershipId: mm.id } });

    // Manager assigned ONLY to branch B: catalog is tenant-scoped, so they may
    // still manage item images (documents the deliberate cross-branch allowance).
    const branchBManager = await prisma.user.create({ data: { email: branchBManagerEmail, passwordHash, displayName: 'Manager B', status: 'ACTIVE' } });
    const mbm = await prisma.tenantMembership.create({ data: { tenantId, userId: branchBManager.id, role: 'MANAGER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId: branchBId, membershipId: mbm.id } });

    const cashier = await prisma.user.create({ data: { email: cashierEmail, passwordHash, displayName: 'Cashier', status: 'ACTIVE' } });
    const cm = await prisma.tenantMembership.create({ data: { tenantId, userId: cashier.id, role: 'CASHIER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId: branchAId, membershipId: cm.id } });

    const waiter = await prisma.user.create({ data: { email: waiterEmail, passwordHash, displayName: 'Waiter', status: 'ACTIVE' } });
    const wm = await prisma.tenantMembership.create({ data: { tenantId, userId: waiter.id, role: 'WAITER', status: 'ACTIVE' } });
    await prisma.branchAssignment.create({ data: { tenantId, branchId: branchAId, membershipId: wm.id } });

    const otherTenant = await prisma.tenant.create({ data: { name: 'MenuImageOther', slug: `mi-other-${ts}`, status: 'ACTIVE' } });
    otherTenantId = otherTenant.id;
    await seedEntitlements(prisma, otherTenantId);
    const outsider = await prisma.user.create({ data: { email: outsiderEmail, passwordHash, displayName: 'Outsider', status: 'ACTIVE' } });
    const outm = await prisma.tenantMembership.create({ data: { tenantId: otherTenantId, userId: outsider.id, role: 'OWNER', status: 'ACTIVE' } });
    const otherBranch = await prisma.branch.create({ data: { tenantId: otherTenantId, name: 'OB', slug: `ob-${ts}`, isActive: true } });
    await prisma.branchAssignment.create({ data: { tenantId: otherTenantId, branchId: otherBranch.id, membershipId: outm.id } });

    const category = await prisma.menuCategory.create({ data: { tenantId, name: 'Mains', sortOrder: 0, isActive: true } });
    categoryId = category.id;

    ownerToken = await login(ownerEmail);
    managerToken = await login(managerEmail);
    branchBManagerToken = await login(branchBManagerEmail);
    cashierToken = await login(cashierEmail);
    waiterToken = await login(waiterEmail);
    outsiderToken = await login(outsiderEmail);
  });

  afterAll(async () => {
    await app.close();
    await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.outboxEvent.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.mediaObject.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuCategory.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await cleanupEntitlements(prisma, tenantId);
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.menuItem.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.branch.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, managerEmail, branchBManagerEmail, cashierEmail, waiterEmail, outsiderEmail] } } }).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await prisma.branch.deleteMany({ where: { tenantId: otherTenantId } }).catch(() => {});
    await cleanupEntitlements(prisma, otherTenantId);
    await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('Role matrix (upload-intent)', () => {
    it('owner can create an upload intent', async () => {
      const item = await createItem('Owner item');
      const res = await uploadIntent(item.id, ownerToken, 1);
      expect(res.status).toBe(201);
      expect(res.body.data.mediaObjectId).toBeDefined();
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.fields).toBeDefined();

      const media = await prisma.mediaObject.findUnique({ where: { id: res.body.data.mediaObjectId } });
      expect(media).toMatchObject({
        tenantId,
        branchId: null,
        purpose: 'MENU_ITEM_IMAGE',
        processingStatus: 'PENDING_UPLOAD',
        bucket: inMemoryStorage.bucket,
        targetMenuItemId: item.id,
      });
      expect(media!.objectKey).toContain(`/menu-items/${item.id}/`);
      expect(media!.uploadedByUserId).toBe(ownerUserId);
    });

    it('manager can create an upload intent', async () => {
      const item = await createItem('Manager item');
      const res = await uploadIntent(item.id, managerToken, 1);
      expect(res.status).toBe(201);
    });

    it('cashier is denied on upload-intent', async () => {
      const item = await createItem('Cashier item');
      const res = await uploadIntent(item.id, cashierToken, 1);
      expect(res.status).toBe(403);
    });

    it('waiter is denied on upload-intent', async () => {
      const item = await createItem('Waiter item');
      const res = await uploadIntent(item.id, waiterToken, 1);
      expect(res.status).toBe(403);
    });

    it('cashier is denied on finalize, status and remove', async () => {
      const item = await createItem('Denied endpoints');
      const fin = await finalizeImage(item.id, cashierToken, randomUUID(), 1);
      expect(fin.status).toBe(403);
      const st = await imageStatus(item.id, cashierToken);
      expect(st.status).toBe(403);
      const rm = await request(app.getHttpServer())
        .delete(`/api/v1/items/${item.id}/image`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 1 });
      expect(rm.status).toBe(403);
    });

    it('unauthenticated requests are rejected', async () => {
      const item = await createItem('Unauth item');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/items/${item.id}/image/upload-intent`)
        .set('Content-Type', 'application/json')
        .send({ contentType: 'image/jpeg', sizeBytes: 128, sha256: 'a'.repeat(64), crop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: 1 });
      expect(res.status).toBe(401);
    });
  });

  describe('Happy path: intent → finalize → outbox', () => {
    let itemId: string;
    let mediaId: string;
    let objectKey: string;
    const contentHash = 'b'.repeat(64);
    const sizeBytes = 4096;

    it('finalizes into PENDING_PROCESSING with a pointer-only outbox row in one transaction', async () => {
      const item = await createItem('Happy item');
      itemId = item.id;

      const intent = await uploadIntent(itemId, ownerToken, 1, { sha256: contentHash, sizeBytes });
      expect(intent.status).toBe(201);
      mediaId = intent.body.data.mediaObjectId;
      objectKey = (await prisma.mediaObject.findUnique({ where: { id: mediaId } }))!.objectKey;

      inMemoryStorage.simulateUpload(objectKey, sizeBytes, 'image/jpeg', contentHash);

      const fin = await finalizeImage(itemId, ownerToken, mediaId, 1);
      expect(fin.status).toBe(201);
      expect(fin.body.data.processingStatus).toBe('PENDING_PROCESSING');
      expect(fin.body.data.image).toBeNull();

      const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
      expect(media).toMatchObject({
        processingStatus: 'PENDING_PROCESSING',
        scanStatus: 'PENDING_SCAN',
        expectedItemVersion: 1,
      });

      const outbox = await prisma.outboxEvent.findMany({ where: { tenantId, aggregateId: mediaId, eventType: 'menu.image.process_requested' } });
      expect(outbox).toHaveLength(1);
      expect(outbox[0].branchId).toBeNull();
      expect(outbox[0].publishedAt).toBeNull();
      expect(outbox[0].payload).toEqual({ mediaObjectId: mediaId });
      expect(Object.keys(outbox[0].payload as object)).toEqual(['mediaObjectId']);

      // No direct queue send outside the outbox path.
      expect(sqsCapture.send).not.toHaveBeenCalled();
    });

    it('duplicate finalize is idempotent and never adds a second outbox row', async () => {
      const fin = await finalizeImage(itemId, ownerToken, mediaId, 1);
      expect(fin.status).toBe(201);
      expect(fin.body.data.processingStatus).toBe('PENDING_PROCESSING');

      const outbox = await prisma.outboxEvent.findMany({ where: { tenantId, aggregateId: mediaId, eventType: 'menu.image.process_requested' } });
      expect(outbox).toHaveLength(1);
      expect(sqsCapture.send).not.toHaveBeenCalled();
    });

    it('status reflects the claimed processing state', async () => {
      const res = await imageStatus(itemId, ownerToken, mediaId);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ mediaObjectId: mediaId, processingStatus: 'PENDING_PROCESSING', image: null });
      expect(res.body.data.itemVersion).toBe(1);
    });

    it('duplicate finalize after the worker attached the image still succeeds (version guard is bypassed for terminal states)', async () => {
      // Simulate the worker's transactional outcome.
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: {
          processingStatus: 'READY',
          scanStatus: 'CLEAN',
          cdnKeyBase: `menu-items/${itemId}/secret-token-0123456789abcdef`,
          outputWidth: 1280,
          outputHeight: 960,
          processedAt: new Date(),
        },
      });
      await prisma.menuItem.update({ where: { id: itemId }, data: { imageMediaId: mediaId, version: { increment: 1 } } });

      // Item version is now 2 while the client still holds 1: the idempotent
      // short-circuit must win over the stale-version conflict.
      const fin = await finalizeImage(itemId, ownerToken, mediaId, 1);
      expect(fin.status).toBe(201);
      expect(fin.body.data.processingStatus).toBe('READY');

      const outbox = await prisma.outboxEvent.findMany({ where: { tenantId, aggregateId: mediaId } });
      expect(outbox).toHaveLength(1);
    });

    it('status exposes secret-key CDN derivative URLs once READY', async () => {
      const res = await imageStatus(itemId, ownerToken, mediaId);
      expect(res.status).toBe(200);
      expect(res.body.data.processingStatus).toBe('READY');
      expect(res.body.data.itemVersion).toBe(2);
      expect(res.body.data.image).toMatchObject({
        width: 1280,
        height: 960,
        thumbnailUrl: `https://media.example.test/menu-items/${itemId}/secret-token-0123456789abcdef/320x240.webp`,
        standardUrl: `https://media.example.test/menu-items/${itemId}/secret-token-0123456789abcdef/640x480.webp`,
        highResolutionUrl: `https://media.example.test/menu-items/${itemId}/secret-token-0123456789abcdef/1280x960.webp`,
      });
      const urls = JSON.stringify(res.body.data.image);
      expect(urls).not.toContain(tenantId);
      expect(urls).not.toContain(mediaId);
    });

    it('removing the image schedules cleanup of the replaced media and bumps the version', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/items/${itemId}/image`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-tenant-id', tenantId)
        .send({ expectedVersion: 2 });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ success: true, itemVersion: 3 });

      const item = await prisma.menuItem.findUnique({ where: { id: itemId } });
      expect(item!.imageMediaId).toBeNull();
      expect(item!.version).toBe(3);

      const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
      expect(media!.cleanupAfter).toBeInstanceOf(Date);
      expect(media!.cleanupAfter!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Concurrent finalize', () => {
    it('two parallel finalizes produce exactly one outbox row and both succeed', async () => {
      const item = await createItem('Concurrent item');
      const contentHash = 'c'.repeat(64);
      const sizeBytes = 777;
      const intent = await uploadIntent(item.id, ownerToken, 1, { sha256: contentHash, sizeBytes });
      expect(intent.status).toBe(201);
      const mediaId = intent.body.data.mediaObjectId;
      const media = (await prisma.mediaObject.findUnique({ where: { id: mediaId } }))!;
      inMemoryStorage.simulateUpload(media.objectKey, sizeBytes, 'image/jpeg', contentHash);

      const [r1, r2] = await Promise.all([
        finalizeImage(item.id, ownerToken, mediaId, 1),
        finalizeImage(item.id, ownerToken, mediaId, 1),
      ]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);

      const outbox = await prisma.outboxEvent.findMany({ where: { tenantId, aggregateId: mediaId, eventType: 'menu.image.process_requested' } });
      expect(outbox).toHaveLength(1);
      const mediaAfter = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
      expect(mediaAfter!.processingStatus).toBe('PENDING_PROCESSING');
      expect(sqsCapture.send).not.toHaveBeenCalled();
    });
  });

  describe('Validation and conflicts', () => {
    it('rejects a stale expectedVersion on upload-intent', async () => {
      const item = await createItem('Stale intent');
      const res = await uploadIntent(item.id, ownerToken, 99);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('refresh');
      expect(await prisma.mediaObject.count({ where: { targetMenuItemId: item.id } })).toBe(0);
    });

    it('rejects a stale expectedVersion on finalize', async () => {
      const item = await createItem('Stale finalize');
      const intent = await uploadIntent(item.id, ownerToken, 1);
      expect(intent.status).toBe(201);
      inMemoryStorage.simulateUpload(
        (await prisma.mediaObject.findUnique({ where: { id: intent.body.data.mediaObjectId } }))!.objectKey,
        128,
        'image/jpeg',
        'a'.repeat(64),
      );
      const res = await finalizeImage(item.id, ownerToken, intent.body.data.mediaObjectId, 99);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('refresh');
      const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: intent.body.data.mediaObjectId } });
      expect(outbox).toHaveLength(0);
    });

    it('rejects an expired upload intent', async () => {
      const item = await createItem('Expired intent');
      const intent = await uploadIntent(item.id, ownerToken, 1);
      expect(intent.status).toBe(201);
      const mediaId = intent.body.data.mediaObjectId;
      await prisma.mediaObject.update({ where: { id: mediaId }, data: { uploadExpiresAt: new Date(Date.now() - 60_000) } });
      const res = await finalizeImage(item.id, ownerToken, mediaId, 1);
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('expired');
    });

    it('rejects finalize when the object was never uploaded', async () => {
      const item = await createItem('Missing object');
      const intent = await uploadIntent(item.id, ownerToken, 1);
      expect(intent.status).toBe(201);
      const res = await finalizeImage(item.id, ownerToken, intent.body.data.mediaObjectId, 1);
      expect(res.status).toBe(400);
      const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: intent.body.data.mediaObjectId } });
      expect(outbox).toHaveLength(0);
    });

    it('rejects unsupported content types and oversized payloads at the storage boundary, leaving no rows', async () => {
      const item = await createItem('Bad inputs');
      const gif = await uploadIntent(item.id, ownerToken, 1, { contentType: 'image/gif' });
      expect(gif.status).toBe(400);
      const oversized = await uploadIntent(item.id, ownerToken, 1, { sizeBytes: 10 * 1024 * 1024 + 1 });
      expect(oversized.status).toBe(400);
      expect(await prisma.mediaObject.count({ where: { targetMenuItemId: item.id } })).toBe(0);
    });

    it('returns 404 for a fabricated media object id', async () => {
      const item = await createItem('Fabricated');
      const res = await finalizeImage(item.id, ownerToken, randomUUID(), 1);
      expect(res.status).toBe(404);
    });
  });

  describe('Tenant isolation and branch scope', () => {
    it('rejects another tenant using our tenant header (not a member)', async () => {
      const item = await createItem('Isolation A');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/items/${item.id}/image/upload-intent`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-tenant-id', tenantId)
        .send({ contentType: 'image/jpeg', sizeBytes: 128, sha256: 'a'.repeat(64), crop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: 1 });
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('member');
    });

    it('returns 404 when another tenant scopes to their own tenant', async () => {
      const item = await createItem('Isolation B');
      const res = await request(app.getHttpServer())
        .post(`/api/v1/items/${item.id}/image/upload-intent`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-tenant-id', otherTenantId)
        .send({ contentType: 'image/jpeg', sizeBytes: 128, sha256: 'a'.repeat(64), crop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: 1 });
      expect(res.status).toBe(404);
      expect(await prisma.mediaObject.count({ where: { targetMenuItemId: item.id } })).toBe(0);
    });

    it('allows a branch-B-only manager because catalog images are tenant-scoped', async () => {
      const item = await createItem('Tenant-wide item');
      const res = await uploadIntent(item.id, branchBManagerToken, 1);
      expect(res.status).toBe(201);

      const media = await prisma.mediaObject.findUnique({ where: { id: res.body.data.mediaObjectId } });
      expect(media!.branchId).toBeNull();
      expect(media!.tenantId).toBe(tenantId);
    });
  });
});
