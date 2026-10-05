import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { TablesService } from './tables.service';
import type { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';

const mockPrisma = {
  diningArea: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  restaurantTable: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  tableQrToken: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  branch: { findFirst: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
};

const tenantId = 't1';
const branchId = 'b1';

describe('TablesService', () => {
  let service: TablesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TablesService(mockPrisma as unknown as PrismaService);
  });

  // ─── Branch Ownership ────────────────────────

  describe('branch ownership validation', () => {
    it('rejects dining area creation on unowned branch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(service.createDiningArea(tenantId, 'foreign-branch', { name: 'Test' })).rejects.toThrow(NotFoundException);
    });

    it('rejects table creation on unowned branch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(service.createTable(tenantId, 'foreign-branch', { label: 'T1', capacity: 4 })).rejects.toThrow(NotFoundException);
    });

    it('rejects list dining areas on inactive branch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(service.listDiningAreas(tenantId, 'inactive-branch')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Dining Areas ──────────────────────────

  describe('listDiningAreas', () => {
    it('returns dining areas for owned branch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      mockPrisma.diningArea.findMany.mockResolvedValue([{ id: 'da1', name: 'Main' }]);
      const result = await service.listDiningAreas(tenantId, branchId);
      expect(result).toHaveLength(1);
    });
  });

  describe('createDiningArea', () => {
    it('creates on owned branch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      mockPrisma.diningArea.create.mockResolvedValue({ id: 'da1', name: 'Ground Floor' });
      const result = await service.createDiningArea(tenantId, branchId, { name: 'Ground Floor' });
      expect(result.id).toBe('da1');
    });
  });

  // ─── Tables ────────────────────────────────

  describe('createTable', () => {
    it('validates branch ownership before creation', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(service.createTable(tenantId, branchId, { label: 'T1', capacity: 4 })).rejects.toThrow(NotFoundException);
    });

    it('creates table and QR token transactionally, returns raw QR', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      const mockTx = {
        restaurantTable: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
        tableQrToken: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'qt1' }) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1', label: 'T1', diningArea: null });

      const result = await service.createTable(tenantId, branchId, { label: 'T1', capacity: 4 });
      expect(result.id).toBe('t1');
      expect(result.qrTokenRaw).toBeDefined();
      expect(typeof result.qrTokenRaw).toBe('string');
      expect(result.qrTokenRaw).toHaveLength(64); // 32 bytes hex
    });
  });

  // ─── QR Token ──────────────────────────────

  describe('generateQrToken', () => {
    it('throws NotFoundException if table not found', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue(null);
      await expect(service.generateQrToken('bad', tenantId, branchId)).rejects.toThrow(NotFoundException);
    });

    it('generates token with FOR UPDATE locking and audit inside transaction', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1' });
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ version: 2 }]),
        tableQrToken: {
          updateMany: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: 'qt3', tokenHash: 'h3' }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await service.generateQrToken('t1', tenantId, branchId, 'reprint', 'u1');
      expect(result.raw).toBeDefined();
      expect(result.version).toBe(3);
      // Verify FOR UPDATE was used in the raw query
      const queryParts = mockTx.$queryRaw.mock.calls[0][0];
      const queryStr = queryParts.join('');
      expect(queryStr).toContain('FOR UPDATE');
      // Verify audit was written via tx client
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'QR_TOKEN_ROTATE' }),
      }));
    });

    it('version uses locked value (concurrent-safe)', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1' });
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]), // no existing tokens
        tableQrToken: {
          updateMany: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: 'qt1', tokenHash: 'h1' }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await service.generateQrToken('t1', tenantId, branchId);
      expect(result.version).toBe(1); // 0 + 1
    });

    it('retries on unique constraint conflict (first-token race)', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1' });
      let callCount = 0;

      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        callCount++;
        if (callCount === 1) {
          // First attempt: conflict on unique (tableId, version)
          const err = new Error('Unique constraint') as any;
          err.code = 'P2002';
          throw err;
        }
        // Second attempt: success
        const mockTx = {
          $queryRaw: vi.fn().mockResolvedValue([{ version: 1 }]),
          tableQrToken: {
            updateMany: vi.fn().mockResolvedValue({}),
            create: vi.fn().mockResolvedValue({ id: 'qt2', tokenHash: 'h2' }),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        };
        return fn(mockTx);
      });

      const result = await service.generateQrToken('t1', tenantId, branchId);
      expect(result.version).toBe(2);
      expect(callCount).toBe(2);
    });

    it('throws ConflictException after exhausting retries', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1' });
      mockPrisma.$transaction.mockImplementation(async () => {
        const err = new Error('Unique constraint') as any;
        err.code = 'P2002';
        throw err;
      });

      await expect(service.generateQrToken('t1', tenantId, branchId)).rejects.toThrow(ConflictException);
    });

    it('rolls back rotation when audit write fails', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1' });
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ version: 1 }]),
        tableQrToken: {
          updateMany: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: 'qt2', tokenHash: 'h2' }),
        },
        auditLog: {
          create: vi.fn().mockRejectedValue(new Error('Disk full')),
        },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      await expect(service.generateQrToken('t1', tenantId, branchId)).rejects.toThrow('Disk full');
      // The transaction should have been rolled back — $transaction itself rejects
    });
  });

  describe('getActiveToken', () => {
    it('returns only metadata, no hash', async () => {
      mockPrisma.tableQrToken.findFirst.mockResolvedValue({ id: 'qt1', version: 1, createdAt: new Date(), expiresAt: null });
      const result = await service.getActiveToken('t1', tenantId, branchId);
      expect(result).not.toHaveProperty('tokenHash');
    });
  });

  describe('listTokens', () => {
    it('returns only metadata, no hashes', async () => {
      mockPrisma.tableQrToken.findMany.mockResolvedValue([
        { id: 'qt2', version: 2, revokedAt: null, createdAt: new Date() },
        { id: 'qt1', version: 1, revokedAt: new Date(), createdAt: new Date() },
      ]);
      const result = await service.listTokens('t1', tenantId, branchId);
      expect(result).toHaveLength(2);
      for (const token of result) {
        expect(token).not.toHaveProperty('tokenHash');
      }
    });
  });

  // ─── Rotation invalidates previous tokens ──

  describe('rotation invalidation', () => {
    it('revokes every previously active token in the same transaction as the new one', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1', label: 'T1' });
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ version: 3 }]),
        tableQrToken: {
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
          create: vi.fn().mockResolvedValue({ id: 'qt4' }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await service.generateQrToken('t1', tenantId, branchId);

      // The revocation happens before the new token is created, inside the
      // same transaction, so the old printed code stops working atomically.
      expect(mockTx.tableQrToken.updateMany).toHaveBeenCalledWith({
        where: { tableId: 't1', tenantId, branchId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(mockTx.tableQrToken.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockTx.tableQrToken.create.mock.invocationCallOrder[0],
      );

      // Only the hash of the returned raw token is persisted.
      const stored = mockTx.tableQrToken.create.mock.calls[0][0].data;
      expect(stored.tokenHash).toBe(createHash('sha256').update(result.raw).digest('hex'));
      expect(Object.keys(stored)).not.toContain('raw');
    });
  });

  // ─── Batch rotation ─────────────────────────

  describe('generateQrTokenBatch', () => {
    function batchTx() {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        tableQrToken: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi
            .fn()
            .mockResolvedValueOnce({ id: 'qt1' })
            .mockResolvedValueOnce({ id: 'qt2' })
            .mockResolvedValue({ id: 'qt3' }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
      return tx;
    }

    it('rejects an empty selection without rotating anything', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      await expect(
        service.generateQrTokenBatch({ tableIds: [], tenantId, branchId }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects more than 100 tables in one batch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      const tableIds = Array.from({ length: 101 }, (_, i) => `t${i}`);
      await expect(service.generateQrTokenBatch({ tableIds, tenantId, branchId })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rotates exactly the selected tables and returns raw tokens once', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      mockPrisma.restaurantTable.findMany.mockResolvedValue([
        { id: 't1', label: 'T1' },
        { id: 't3', label: 'T3' },
      ]);
      const tx = batchTx();

      const result = await service.generateQrTokenBatch({
        tableIds: ['t1', 't3'],
        tenantId,
        branchId,
        reason: 'batch print',
        actorUserId: 'u1',
      });

      expect(result.map((r) => r.tableId)).toEqual(['t1', 't3']);
      expect(result.map((r) => r.label)).toEqual(['T1', 'T3']);
      for (const entry of result) {
        expect(entry.raw).toHaveLength(64);
        expect(entry.version).toBe(1);
        expect(entry).not.toHaveProperty('tokenHash');
        expect(entry).not.toHaveProperty('id');
      }

      // Only the two selected tables were written.
      expect(tx.tableQrToken.create).toHaveBeenCalledTimes(2);
      expect(tx.tableQrToken.updateMany).toHaveBeenCalledTimes(2);
      const createdTableIds = tx.tableQrToken.create.mock.calls.map((c: any[]) => c[0].data.tableId);
      expect(createdTableIds.sort()).toEqual(['t1', 't3']);
      expect(mockPrisma.restaurantTable.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['t1', 't3'] }, tenantId, branchId } }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'QR_TOKEN_ROTATE',
            afterJson: expect.objectContaining({ batch: true, reason: 'batch print' }),
          }),
        }),
      );
      // No plaintext token leaks into the audit trail.
      const auditPayloads = tx.auditLog.create.mock.calls.map((c: any[]) => JSON.stringify(c[0].data.afterJson));
      for (const payload of auditPayloads) {
        expect(payload).not.toContain(result[0].raw);
      }
    });

    it('deduplicates repeated table ids', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      mockPrisma.restaurantTable.findMany.mockResolvedValue([{ id: 't1', label: 'T1' }]);
      const tx = batchTx();

      const result = await service.generateQrTokenBatch({
        tableIds: ['t1', 't1'],
        tenantId,
        branchId,
      });

      expect(result).toHaveLength(1);
      expect(tx.tableQrToken.create).toHaveBeenCalledTimes(1);
    });

    it('fails without rotating when any selected table is outside the branch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      // One of the two requested tables does not belong to this tenant/branch.
      mockPrisma.restaurantTable.findMany.mockResolvedValue([{ id: 't1', label: 'T1' }]);
      const tx = batchTx();

      await expect(
        service.generateQrTokenBatch({ tableIds: ['t1', 'foreign'], tenantId, branchId }),
      ).rejects.toThrow(NotFoundException);

      expect(tx.tableQrToken.create).not.toHaveBeenCalled();
      expect(tx.tableQrToken.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rolls the whole batch back when a later rotation fails', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      mockPrisma.restaurantTable.findMany.mockResolvedValue([
        { id: 't1', label: 'T1' },
        { id: 't2', label: 'T2' },
      ]);
      const tx = batchTx();
      tx.auditLog.create
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('audit unavailable'));
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        try {
          return await fn(tx);
        } catch (error) {
          // Prisma discards the transaction on error — nothing is committed.
          throw error;
        }
      });

      await expect(
        service.generateQrTokenBatch({ tableIds: ['t1', 't2'], tenantId, branchId }),
      ).rejects.toThrow('audit unavailable');
    });

    it('retries the whole batch on a version collision', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      mockPrisma.restaurantTable.findMany.mockResolvedValue([{ id: 't1', label: 'T1' }]);
      let attempts = 0;
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        attempts++;
        if (attempts === 1) {
          const err = new Error('Unique constraint') as any;
          err.code = 'P2002';
          throw err;
        }
        return fn({
          $queryRaw: vi.fn().mockResolvedValue([{ version: 4 }]),
          tableQrToken: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockResolvedValue({ id: 'qt9' }),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        });
      });

      const result = await service.generateQrTokenBatch({ tableIds: ['t1'], tenantId, branchId });
      expect(attempts).toBe(2);
      expect(result[0].version).toBe(5);
    });

    it('rejects a batch for a branch the tenant does not own', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(
        service.generateQrTokenBatch({ tableIds: ['t1'], tenantId, branchId: 'foreign' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── QR branding ────────────────────────────

  describe('getQrBranding', () => {
    it('returns restaurant and branch identity plus the public slug', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({
        name: 'Bole Branch',
        publicSlug: 'buna-bole',
        tenant: { name: 'Buna House' },
      });
      const result = await service.getQrBranding(tenantId, branchId);
      expect(result).toEqual({
        restaurantName: 'Buna House',
        branchName: 'Bole Branch',
        publicSlug: 'buna-bole',
      });
      expect(mockPrisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: branchId, tenantId, isActive: true },
          select: { name: true, publicSlug: true, tenant: { select: { name: true } } },
        }),
      );
    });

    it('rejects an unknown or inactive branch', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue(null);
      await expect(service.getQrBranding(tenantId, 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
