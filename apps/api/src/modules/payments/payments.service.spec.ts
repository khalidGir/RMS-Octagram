import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PaymentService } from './payments.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProofStorage } from './proof-storage.interface';
import type { IdempotencyService } from '../orders/idempotency.service';
import type { FeatureResolver } from '../features/feature-resolver.service';

function createMockPrisma() {
  const mockTx = {
    mediaObject: {
      updateMany: vi.fn(),
    },
    paymentProof: {
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    payment: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    order: {
      updateMany: vi.fn(),
    },
    orderStatusHistory: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    outboxEvent: {
      create: vi.fn(),
    },
  };

  return {
    $transaction: vi.fn(async (fn: any) => fn(mockTx)),
    mediaObject: { findFirst: vi.fn() },
    payment: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    paymentProof: { findFirst: vi.fn(), findMany: vi.fn() },
    order: { updateMany: vi.fn() },
    _mockTx: mockTx,
  } as unknown as PrismaService & { _mockTx: typeof mockTx };
}

function createMockProofStorage(): ProofStorage {
  return {
    createUploadIntent: vi.fn(),
    verifyObject: vi.fn(),
    createReadUrl: vi.fn(),
    getBucket: vi.fn(() => 'test-bucket'),
  } as unknown as ProofStorage;
}

function createMockIdempotency(): IdempotencyService {
  return {
    withIdempotency: vi.fn(),
  } as unknown as IdempotencyService;
}

function createMockFeatureResolver(): FeatureResolver {
  return {
    resolve: vi.fn().mockResolvedValue({
      effective: true,
      platformStatus: 'ENABLED',
      trialEndsAt: null,
      tenantEnabled: true,
      branchOverride: null,
    }),
    assertEffective: vi.fn().mockResolvedValue(undefined),
    resolveAll: vi.fn().mockResolvedValue({}),
    getCatalog: vi.fn().mockReturnValue([]),
  } as unknown as FeatureResolver;
}

describe('PaymentService — Transaction Rollback', () => {
  let service: PaymentService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let proofStorage: ProofStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    proofStorage = createMockProofStorage();
    const idempotency = createMockIdempotency();
    const featureResolver = createMockFeatureResolver();
    service = new PaymentService(prisma, proofStorage, idempotency, featureResolver);
  });

  describe('finalizeProof rollback', () => {
    it('rolls back when audit creation fails — no proof, no payment transition', async () => {
      // Setup: media object is PENDING_UPLOAD
      prisma.mediaObject.findFirst.mockResolvedValue({
        id: 'mo-1',
        tenantId: 't1',
        branchId: 'b1',
        paymentId: 'pay-1',
        purpose: 'PAYMENT_PROOF',
        scanStatus: 'PENDING_UPLOAD',
        uploadExpiresAt: new Date(Date.now() + 3600_000),
        objectKey: 'test/key.jpg',
        sha256: 'abc123',
        sizeBytes: 1024n,
        contentType: 'image/jpeg',
      });

      // Setup: payment exists
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'ord-1',
        status: 'PENDING',
        version: 1,
        paymentTokenExpiresAt: new Date(Date.now() + 3600_000),
      });

      // Mock proofStorage.verifyObject to succeed
      (proofStorage.verifyObject as any).mockResolvedValue(undefined);

      // Mock transaction: everything succeeds until audit creation
      prisma._mockTx.mediaObject.updateMany.mockResolvedValue({ count: 1 });
      prisma._mockTx.paymentProof.updateMany.mockResolvedValue({ count: 0 });
      prisma._mockTx.paymentProof.create.mockResolvedValue({ id: 'proof-1' });
      prisma._mockTx.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma._mockTx.payment.findUnique.mockResolvedValue({ id: 'pay-1', status: 'PENDING_VERIFICATION', version: 2 });
      prisma._mockTx.auditLog.create.mockRejectedValue(new Error('Audit write failed'));

      // Finalize should fail (transaction rolls back)
      await expect(
        service.finalizeProof({
          tenantId: 't1',
          branchId: 'b1',
          paymentTokenRaw: 'raw-token',
          mediaObjectId: 'mo-1',
        }),
      ).rejects.toThrow('Audit write failed');

      // Verify transaction was attempted
      expect(prisma.$transaction).toHaveBeenCalled();

      // Verify the mock transaction methods were called
      expect(prisma._mockTx.mediaObject.updateMany).toHaveBeenCalled();
      expect(prisma._mockTx.paymentProof.create).toHaveBeenCalled();
      expect(prisma._mockTx.payment.updateMany).toHaveBeenCalled();
      expect(prisma._mockTx.auditLog.create).toHaveBeenCalled();
      // Outbox should NOT have been reached (audit failed first)
      expect(prisma._mockTx.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('rolls back when outbox creation fails — no proof persisted, no payment transition', async () => {
      // Setup: media object is PENDING_UPLOAD
      prisma.mediaObject.findFirst.mockResolvedValue({
        id: 'mo-2',
        tenantId: 't1',
        branchId: 'b1',
        paymentId: 'pay-2',
        purpose: 'PAYMENT_PROOF',
        scanStatus: 'PENDING_UPLOAD',
        uploadExpiresAt: new Date(Date.now() + 3600_000),
        objectKey: 'test/key2.jpg',
        sha256: 'def456',
        sizeBytes: 2048n,
        contentType: 'image/png',
      });

      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-2',
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'ord-2',
        status: 'PENDING',
        version: 1,
        paymentTokenExpiresAt: new Date(Date.now() + 3600_000),
      });

      (proofStorage.verifyObject as any).mockResolvedValue(undefined);

      // Mock transaction: everything succeeds until outbox creation
      prisma._mockTx.mediaObject.updateMany.mockResolvedValue({ count: 1 });
      prisma._mockTx.paymentProof.updateMany.mockResolvedValue({ count: 0 });
      prisma._mockTx.paymentProof.create.mockResolvedValue({ id: 'proof-2' });
      prisma._mockTx.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma._mockTx.payment.findUnique.mockResolvedValue({ id: 'pay-2', status: 'PENDING_VERIFICATION', version: 2 });
      prisma._mockTx.auditLog.create.mockResolvedValue({ id: 'audit-1' });
      prisma._mockTx.outboxEvent.create.mockRejectedValue(new Error('Outbox write failed'));

      await expect(
        service.finalizeProof({
          tenantId: 't1',
          branchId: 'b1',
          paymentTokenRaw: 'raw-token-2',
          mediaObjectId: 'mo-2',
        }),
      ).rejects.toThrow('Outbox write failed');

      // All transactional methods were called
      expect(prisma._mockTx.mediaObject.updateMany).toHaveBeenCalled();
      expect(prisma._mockTx.paymentProof.create).toHaveBeenCalled();
      expect(prisma._mockTx.payment.updateMany).toHaveBeenCalled();
      expect(prisma._mockTx.auditLog.create).toHaveBeenCalled();
      expect(prisma._mockTx.outboxEvent.create).toHaveBeenCalled();
    });
  });
});

describe('PaymentService — Approve/Reject', () => {
  let service: PaymentService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    const proofStorage = createMockProofStorage();
    const idempotency = createMockIdempotency();
    const featureResolver = createMockFeatureResolver();
    service = new PaymentService(prisma, proofStorage, idempotency, featureResolver);
  });

  describe('approvePayment', () => {
    it('should approve a PENDING_VERIFICATION payment and confirm order', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        tenantId: 't1',
        branchId: 'b1',
        status: 'PENDING_VERIFICATION',
        version: 1,
        amountMinor: 500n,
        order: { id: 'ord-1', status: 'PENDING_PAYMENT', version: 1, totalMinor: 500n, currency: 'ETB' },
      });

      const tx = prisma._mockTx;
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      tx.payment.findUnique.mockResolvedValue({ id: 'pay-1', status: 'APPROVED', version: 2 });

      const result = await service.approvePayment({
        tenantId: 't1', branchId: 'b1', paymentId: 'pay-1', actorUserId: 'u1',
      });

      expect(result!.status).toBe('APPROVED');
      expect(tx.order.updateMany).toHaveBeenCalled();
      expect(tx.outboxEvent.create).toHaveBeenCalledTimes(2); // payment.approved + order.confirmed
    });

    it('should not create kitchen tickets directly — relies on outbox', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        tenantId: 't1',
        branchId: 'b1',
        status: 'PENDING_VERIFICATION',
        version: 1,
        amountMinor: 500n,
        order: { id: 'ord-1', status: 'PENDING_PAYMENT', version: 1, totalMinor: 500n, currency: 'ETB' },
      });

      const tx = prisma._mockTx;
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      tx.payment.findUnique.mockResolvedValue({ id: 'pay-1', status: 'APPROVED', version: 2 });
      tx.outboxEvent.create.mockResolvedValue({ id: 'outbox-1' });

      const result = await service.approvePayment({
        tenantId: 't1', branchId: 'b1', paymentId: 'pay-1', actorUserId: 'u1',
      });

      expect(result!.status).toBe('APPROVED');
      // Two outbox events: payment.approved + order.confirmed
      expect(tx.outboxEvent.create).toHaveBeenCalledTimes(2);
      const eventTypes = tx.outboxEvent.create.mock.calls.map((c: any) => c[0]?.data?.eventType);
      expect(eventTypes).toContain('order.confirmed');
    });

    it('should return idempotent if already APPROVED', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1', status: 'APPROVED', version: 2,
        order: { id: 'ord-1', status: 'CONFIRMED' },
      });

      const result = await service.approvePayment({
        tenantId: 't1', branchId: 'b1', paymentId: 'pay-1', actorUserId: 'u1',
      });

      expect(result!.status).toBe('APPROVED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if payment is not PENDING_VERIFICATION', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1', status: 'PENDING', version: 1,
        order: { id: 'ord-1', status: 'PENDING_PAYMENT' },
      });

      await expect(
        service.approvePayment({
          tenantId: 't1', branchId: 'b1', paymentId: 'pay-1', actorUserId: 'u1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('rejectPayment', () => {
    it('should reject a PENDING_VERIFICATION payment', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        tenantId: 't1',
        branchId: 'b1',
        status: 'PENDING_VERIFICATION',
        version: 1,
        order: { id: 'ord-1', status: 'PENDING_PAYMENT' },
      });

      const tx = prisma._mockTx;
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      tx.payment.findUnique.mockResolvedValue({ id: 'pay-1', status: 'REJECTED', version: 2 });

      const result = await service.rejectPayment({
        tenantId: 't1', branchId: 'b1', paymentId: 'pay-1', actorUserId: 'u1', reason: 'Invalid proof',
      });

      expect(result!.status).toBe('REJECTED');
      expect(tx.auditLog.create).toHaveBeenCalled();
      expect(tx.outboxEvent.create).toHaveBeenCalled();
    });

    it('should return idempotent if already REJECTED', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1', status: 'REJECTED', version: 2,
        order: { id: 'ord-1' },
      });

      const result = await service.rejectPayment({
        tenantId: 't1', branchId: 'b1', paymentId: 'pay-1', actorUserId: 'u1', reason: 'Invalid',
      });

      expect(result!.status).toBe('REJECTED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
