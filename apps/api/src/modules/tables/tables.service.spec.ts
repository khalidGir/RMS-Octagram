import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TablesService } from './tables.service';
import type { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

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
});
