import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { IdempotencyService } from './idempotency.service';
import { ConflictException } from '@nestjs/common';
import { canonicalStringify } from '@rms/contracts';
import type { PrismaService } from '../prisma/prisma.service';

function computeHash(payload: unknown): string {
  const canonical = canonicalStringify(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function createMockPrisma() {
  return {
    idempotencyRecord: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  } as unknown as PrismaService;
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let prisma: ReturnType<typeof createMockPrisma>;

  const payload = { lines: [{ variantId: 'v1', quantity: 2 }] };
  const expectedHash = computeHash(payload);

  const baseParams = {
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    operation: 'createTableOrder',
    key: 'idem-key-1',
    requestPayload: payload,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = new IdempotencyService(prisma);
  });

  describe('first request and replay', () => {
    it('first request stores and returns result with tracking token', async () => {
      const mockRecord = { id: 'rec-1', requestHash: expectedHash, expiresAt: new Date(Date.now() + 3600_000) };
      vi.mocked(prisma.idempotencyRecord.create).mockResolvedValue(mockRecord as any);
      vi.mocked(prisma.idempotencyRecord.update).mockResolvedValue({} as any);

      const handler = vi.fn().mockResolvedValue({
        status: 201,
        body: { id: 'order-1', trackingToken: 'raw-token-123' },
        resourceId: 'order-1',
      });

      const result = await service.withIdempotency(baseParams, handler);

      expect(result.reused).toBe(false);
      expect(result.result.body).toHaveProperty('trackingToken', 'raw-token-123');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('replay returns same stored result including tracking token', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue(p2002Error);

      vi.mocked(prisma.idempotencyRecord.findFirst).mockResolvedValue({
        id: 'rec-1',
        requestHash: expectedHash,
        expiresAt: new Date(Date.now() + 3600_000),
        responseStatus: 201,
        responseBody: { id: 'order-1', trackingToken: 'raw-token-123' },
        resourceId: 'order-1',
      } as any);

      const handler = vi.fn();

      const result = await service.withIdempotency(baseParams, handler);

      expect(result.reused).toBe(true);
      expect(result.result.body).toHaveProperty('trackingToken', 'raw-token-123');
      expect(handler).not.toHaveBeenCalled();
    });

    it('replay returns same tracking token on repeated replays', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue(p2002Error);

      vi.mocked(prisma.idempotencyRecord.findFirst).mockResolvedValue({
        id: 'rec-1',
        requestHash: expectedHash,
        expiresAt: new Date(Date.now() + 3600_000),
        responseStatus: 201,
        responseBody: { id: 'order-1', trackingToken: 'the-same-token' },
        resourceId: 'order-1',
      } as any);

      const handler = vi.fn();

      const [r1, r2, r3] = await Promise.all([
        service.withIdempotency(baseParams, handler),
        service.withIdempotency(baseParams, handler),
        service.withIdempotency(baseParams, handler),
      ]);

      expect(r1.result.body).toHaveProperty('trackingToken', 'the-same-token');
      expect(r2.result.body).toHaveProperty('trackingToken', 'the-same-token');
      expect(r3.result.body).toHaveProperty('trackingToken', 'the-same-token');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('tenant and branch isolation', () => {
    it('tenant-scoped key does not collide with branch-scoped key', async () => {
      const mockRecord = { id: 'rec-1', requestHash: expectedHash, expiresAt: new Date(Date.now() + 3600_000) };
      vi.mocked(prisma.idempotencyRecord.create).mockResolvedValue(mockRecord as any);
      vi.mocked(prisma.idempotencyRecord.update).mockResolvedValue({} as any);

      const handler = vi.fn().mockResolvedValue({ status: 201, body: { ok: true } });

      // Tenant-scoped
      await service.withIdempotency({ ...baseParams, branchId: null }, handler);

      // Branch-scoped with same operation/key — different scope so should not collide
      const mockRecord2 = { id: 'rec-2', requestHash: expectedHash, expiresAt: new Date(Date.now() + 3600_000) };
      vi.mocked(prisma.idempotencyRecord.create).mockResolvedValue(mockRecord2 as any);

      await service.withIdempotency({ ...baseParams, branchId: 'branch-1' }, handler);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('same key in same scope returns replay', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue(p2002Error);

      vi.mocked(prisma.idempotencyRecord.findFirst).mockResolvedValue({
        id: 'rec-1',
        requestHash: expectedHash,
        expiresAt: new Date(Date.now() + 3600_000),
        responseStatus: 200,
        responseBody: { result: 'cached' },
        resourceId: null,
      } as any);

      const handler = vi.fn();
      const result = await service.withIdempotency(baseParams, handler);

      expect(result.reused).toBe(true);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('conflict detection', () => {
    it('rejects different payload with same key', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue(p2002Error);

      vi.mocked(prisma.idempotencyRecord.findFirst).mockResolvedValue({
        id: 'rec-1',
        requestHash: 'different-hash-value',
        expiresAt: new Date(Date.now() + 3600_000),
        responseStatus: null,
        responseBody: null,
        resourceId: null,
      } as any);

      const handler = vi.fn();
      await expect(service.withIdempotency(baseParams, handler)).rejects.toThrow(ConflictException);
    });

    it('rejects while request is in progress', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue(p2002Error);

      vi.mocked(prisma.idempotencyRecord.findFirst).mockResolvedValue({
        id: 'rec-1',
        requestHash: expectedHash,
        expiresAt: new Date(Date.now() + 3600_000),
        responseStatus: null,
        responseBody: null,
        resourceId: null,
      } as any);

      const handler = vi.fn();
      await expect(service.withIdempotency(baseParams, handler)).rejects.toThrow('Request in progress');
    });
  });

  describe('expired takeover', () => {
    it('takes over expired reservation atomically', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue(p2002Error);

      vi.mocked(prisma.idempotencyRecord.findFirst).mockResolvedValue({
        id: 'rec-expired',
        requestHash: expectedHash,
        expiresAt: new Date(Date.now() - 1000),
        responseStatus: null,
        responseBody: null,
        resourceId: null,
      } as any);

      vi.mocked(prisma.idempotencyRecord.updateMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(prisma.idempotencyRecord.update).mockResolvedValue({} as any);

      const handler = vi.fn().mockResolvedValue({ status: 201, body: { ok: true } });

      const result = await service.withIdempotency(baseParams, handler);

      expect(result.reused).toBe(false);
      expect(handler).toHaveBeenCalledOnce();
      // Should use updateMany (atomic), not delete
      expect(prisma.idempotencyRecord.updateMany).toHaveBeenCalledOnce();
    });
  });

  describe('completion check', () => {
    it('replays when responseStatus is 200', async () => {
      const p2002Error = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.idempotencyRecord.create).mockRejectedValue(p2002Error);

      vi.mocked(prisma.idempotencyRecord.findFirst).mockResolvedValue({
        id: 'rec-1',
        requestHash: expectedHash,
        expiresAt: new Date(Date.now() + 3600_000),
        responseStatus: 200,
        responseBody: { success: true },
        resourceId: 'res-1',
      } as any);

      const handler = vi.fn();
      const result = await service.withIdempotency(baseParams, handler);

      expect(result.reused).toBe(true);
      expect(result.result.status).toBe(200);
    });
  });
});
