import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PaymentInstructionService } from './payment-instruction.service';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

function createMockPrisma() {
  const mockTx = {
    paymentInstruction: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };
  return {
    paymentInstruction: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => fn(mockTx)),
    _mockTx: mockTx,
  } as unknown as PrismaService & { _mockTx: typeof mockTx };
}

describe('PaymentInstructionService', () => {
  let service: PaymentInstructionService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    service = new PaymentInstructionService(prisma);
  });

  describe('getActiveInstructions', () => {
    it('returns active instructions for a branch', async () => {
      const mockInstructions = [
        { id: 'pi-1', method: 'CBE', label: 'CBE Birr', isActive: true },
        { id: 'pi-2', method: 'TELEBIRR', label: 'Telebirr', isActive: true },
      ];
      vi.mocked(prisma.paymentInstruction.findMany).mockResolvedValue(mockInstructions as any);

      const result = await service.getActiveInstructions('t1', 'b1');

      expect(result).toEqual(mockInstructions);
      expect(prisma.paymentInstruction.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', branchId: 'b1', isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('createInstruction', () => {
    it('creates a payment instruction in a transaction', async () => {
      const mockCreated = {
        id: 'pi-new',
        tenantId: 't1',
        branchId: 'b1',
        method: 'CBE',
        label: 'CBE Birr',
        accountHolder: 'Test Restaurant',
        accountIdentifier: '1234567890',
        instructions: 'Transfer the exact amount',
        sortOrder: 0,
      };
      vi.mocked((prisma as any)._mockTx.paymentInstruction.create).mockResolvedValue(mockCreated as any);
      vi.mocked((prisma as any)._mockTx.auditLog.create).mockResolvedValue({} as any);

      const result = await service.createInstruction({
        tenantId: 't1',
        branchId: 'b1',
        method: 'CBE',
        label: 'CBE Birr',
        accountHolder: 'Test Restaurant',
        accountIdentifier: '1234567890',
        instructions: 'Transfer the exact amount',
        actorUserId: 'user-1',
      });

      expect(result).toEqual(mockCreated);
      expect((prisma as any)._mockTx.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('updateInstruction', () => {
    it('updates an existing instruction in a transaction', async () => {
      const existing = { id: 'pi-1', tenantId: 't1', branchId: 'b1', method: 'CBE', label: 'Old', isActive: true };
      vi.mocked(prisma.paymentInstruction.findFirst).mockResolvedValue(existing as any);
      vi.mocked((prisma as any)._mockTx.paymentInstruction.update).mockResolvedValue({ ...existing, label: 'Updated' } as any);
      vi.mocked((prisma as any)._mockTx.auditLog.create).mockResolvedValue({} as any);

      const result = await service.updateInstruction('t1', 'b1', 'pi-1', { label: 'Updated' }, 'user-1');

      expect(result.label).toBe('Updated');
      expect((prisma as any)._mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException for non-existent instruction', async () => {
      vi.mocked(prisma.paymentInstruction.findFirst).mockResolvedValue(null);

      await expect(
        service.updateInstruction('t1', 'b1', 'nonexistent', { label: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteInstruction', () => {
    it('deletes an existing instruction in a transaction', async () => {
      const existing = { id: 'pi-1', tenantId: 't1', branchId: 'b1', method: 'CBE', label: 'To Delete' };
      vi.mocked(prisma.paymentInstruction.findFirst).mockResolvedValue(existing as any);
      vi.mocked((prisma as any)._mockTx.paymentInstruction.delete).mockResolvedValue(existing as any);
      vi.mocked((prisma as any)._mockTx.auditLog.create).mockResolvedValue({} as any);

      await expect(service.deleteInstruction('t1', 'b1', 'pi-1', 'user-1')).resolves.toBeDefined();
      expect((prisma as any)._mockTx.auditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException for non-existent instruction', async () => {
      vi.mocked(prisma.paymentInstruction.findFirst).mockResolvedValue(null);

      await expect(
        service.deleteInstruction('t1', 'b1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
