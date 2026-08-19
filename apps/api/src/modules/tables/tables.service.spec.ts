import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TablesService } from './tables.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  diningArea: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  restaurantTable: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  tableQrToken: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
  branch: { findFirst: vi.fn() },
  $transaction: vi.fn(),
};

const mockAudit = { log: vi.fn() };

const tenantId = 't1';
const branchId = 'b1';

describe('TablesService', () => {
  let service: TablesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TablesService(mockPrisma as unknown as PrismaService, mockAudit as unknown as AuditService);
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

    it('creates table and QR token transactionally', async () => {
      mockPrisma.branch.findFirst.mockResolvedValue({ id: branchId });
      const mockTx = {
        restaurantTable: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
        tableQrToken: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'qt1' }) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1', label: 'T1', diningArea: null });

      const result = await service.createTable(tenantId, branchId, { label: 'T1', capacity: 4 });
      expect(result.id).toBe('t1');
      expect(mockTx.restaurantTable.create).toHaveBeenCalled();
      expect(mockTx.tableQrToken.create).toHaveBeenCalled();
    });
  });

  // ─── QR Token ──────────────────────────────

  describe('generateQrToken', () => {
    it('throws NotFoundException if table not found', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue(null);
      await expect(service.generateQrToken('bad', tenantId, branchId)).rejects.toThrow(NotFoundException);
    });

    it('generates token transactionally with concurrency-safe version', async () => {
      mockPrisma.restaurantTable.findFirst.mockResolvedValue({ id: 't1' });
      const mockTx = {
        tableQrToken: {
          updateMany: vi.fn().mockResolvedValue({}),
          aggregate: vi.fn().mockResolvedValue({ _max: { version: 3 } }),
          create: vi.fn().mockResolvedValue({ id: 'qt4', tokenHash: 'h4' }),
        },
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockTx));

      const result = await service.generateQrToken('t1', tenantId, branchId, 'reprint', userId);
      expect(result.raw).toBeDefined();
      expect(result.version).toBe(4);
      expect(mockTx.tableQrToken.updateMany).toHaveBeenCalled();
      expect(mockTx.tableQrToken.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ version: 4 }),
      }));
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: userId }));
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

const userId = 'u1';
