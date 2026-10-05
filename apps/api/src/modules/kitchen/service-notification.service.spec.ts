import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceNotificationService } from './service-notification.service';
import { ServiceNotificationType } from '@rms/contracts';
import type { PrismaService } from '../prisma/prisma.service';

function createMockPrisma() {
  return {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([]),
    order: { findFirst: vi.fn().mockResolvedValue({ id: 'o1' }) },
    kitchenTicket: { findFirst: vi.fn().mockResolvedValue({ id: 't1' }) },
    serviceNotification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };
}

describe('ServiceNotificationService', () => {
  let service: ServiceNotificationService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    service = new ServiceNotificationService(prisma as unknown as PrismaService);
  });

  describe('createNotification', () => {
    it('rejects an order outside the requested tenant and branch', async () => {
      prisma.serviceNotification.findUnique.mockResolvedValue(null);
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.createNotification({
        tenantId: 't1', branchId: 'b1', orderId: 'foreign-order',
        type: ServiceNotificationType.ORDER_READY, dedupeKey: 'foreign-order-key',
      })).rejects.toThrow('Order not found');
      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-order', tenantId: 't1', branchId: 'b1' }, select: { id: true },
      });
      expect(prisma.serviceNotification.create).not.toHaveBeenCalled();
    });

    it('rejects a ticket outside the order, tenant and branch', async () => {
      prisma.serviceNotification.findUnique.mockResolvedValue(null);
      prisma.kitchenTicket.findFirst.mockResolvedValue(null);
      await expect(service.createNotification({
        tenantId: 't1', branchId: 'b1', orderId: 'o1', ticketId: 'foreign-ticket',
        type: ServiceNotificationType.STATION_READY, dedupeKey: 'foreign-ticket-key',
      })).rejects.toThrow('Ticket not found');
      expect(prisma.kitchenTicket.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-ticket', orderId: 'o1', tenantId: 't1', branchId: 'b1' }, select: { id: true },
      });
      expect(prisma.serviceNotification.create).not.toHaveBeenCalled();
    });

    it('should create a new notification', async () => {
      prisma.serviceNotification.findUnique.mockResolvedValue(null);
      prisma.serviceNotification.create.mockResolvedValue({
        id: 'n1',
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        ticketId: null,
        assignedUserId: 'u1',
        type: 'STATION_READY',
        status: 'UNREAD',
        collectionLabelSnapshot: 'Main pass',
        dedupeKey: 'order:o1:ticket:t1:ready:v1',
        createdAt: new Date(),
        acknowledgedAt: null,
        resolvedAt: null,
      });

      const result = await service.createNotification({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        ticketId: 't1',
        assignedUserId: 'u1',
        type: ServiceNotificationType.STATION_READY,
        collectionLabelSnapshot: 'Main pass',
        dedupeKey: 'order:o1:ticket:t1:ready:v1',
      });

      expect(result.id).toBe('n1');
      expect(result.type).toBe('STATION_READY');
      expect(result.status).toBe('UNREAD');
      expect(prisma.serviceNotification.create).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('should return existing notification if dedupe key exists (idempotent)', async () => {
      const existing = {
        id: 'n1',
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        ticketId: null,
        assignedUserId: 'u1',
        type: 'STATION_READY',
        status: 'UNREAD',
        collectionLabelSnapshot: null,
        dedupeKey: 'order:o1:ticket:t1:ready:v1',
        createdAt: new Date(),
        acknowledgedAt: null,
        resolvedAt: null,
      };
      prisma.serviceNotification.findUnique.mockResolvedValue(existing);

      const result = await service.createNotification({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
        type: ServiceNotificationType.STATION_READY,
        dedupeKey: 'order:o1:ticket:t1:ready:v1',
      });

      expect(result.id).toBe('n1');
      expect(prisma.serviceNotification.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('propagates audit failure so the transaction rolls back notification creation', async () => {
      prisma.serviceNotification.findUnique.mockResolvedValue(null);
      prisma.serviceNotification.create.mockResolvedValue({ id: 'n1' });
      prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
      await expect(service.createNotification({
        tenantId: 't1', branchId: 'b1', orderId: 'o1',
        type: ServiceNotificationType.STATION_READY, dedupeKey: 'retry-key',
      })).rejects.toThrow('audit unavailable');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does not disclose a dedupe-key collision from another scope', async () => {
      prisma.serviceNotification.findUnique.mockResolvedValue({
        id: 'other-notification', tenantId: 'other-tenant', branchId: 'other-branch', orderId: 'other-order',
      });
      await expect(service.createNotification({
        tenantId: 't1', branchId: 'b1', orderId: 'o1',
        type: ServiceNotificationType.STATION_READY, dedupeKey: 'collision',
      })).rejects.toThrow('Notification not found');
      expect(prisma.serviceNotification.create).not.toHaveBeenCalled();
    });
  });

  describe('acknowledgeNotification', () => {
    it('should acknowledge an unread notification', async () => {
      prisma.serviceNotification.findFirst.mockResolvedValue({
        id: 'n1',
        status: 'UNREAD',
        tenantId: 't1',
        branchId: 'b1',
      });
      prisma.serviceNotification.update.mockResolvedValue({
        id: 'n1',
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
      });

      const result = await service.acknowledgeNotification({
        tenantId: 't1',
        branchId: 'b1',
        notificationId: 'n1',
        actorUserId: 'u1',
      });

      expect(result.status).toBe('ACKNOWLEDGED');
    });

    it('should return existing if not unread', async () => {
      prisma.serviceNotification.findFirst.mockResolvedValue({
        id: 'n1',
        status: 'ACKNOWLEDGED',
        tenantId: 't1',
        branchId: 'b1',
      });

      const result = await service.acknowledgeNotification({
        tenantId: 't1',
        branchId: 'b1',
        notificationId: 'n1',
        actorUserId: 'u1',
      });

      expect(result.status).toBe('ACKNOWLEDGED');
      expect(prisma.serviceNotification.update).not.toHaveBeenCalled();
    });

    it('should throw if notification not found', async () => {
      prisma.serviceNotification.findFirst.mockResolvedValue(null);

      await expect(
        service.acknowledgeNotification({
          tenantId: 't1',
          branchId: 'b1',
          notificationId: 'n1',
          actorUserId: 'u1',
        }),
      ).rejects.toThrow('Notification not found');
    });
  });

  describe('resolveNotification', () => {
    it('should resolve a notification', async () => {
      prisma.serviceNotification.findFirst.mockResolvedValue({
        id: 'n1',
        status: 'UNREAD',
        tenantId: 't1',
        branchId: 'b1',
      });
      prisma.serviceNotification.update.mockResolvedValue({
        id: 'n1',
        status: 'RESOLVED',
        resolvedAt: new Date(),
      });

      const result = await service.resolveNotification({
        tenantId: 't1',
        branchId: 'b1',
        notificationId: 'n1',
        actorUserId: 'u1',
      });

      expect(result.status).toBe('RESOLVED');
    });

    it('should be idempotent for already resolved', async () => {
      prisma.serviceNotification.findFirst.mockResolvedValue({
        id: 'n1',
        status: 'RESOLVED',
        tenantId: 't1',
        branchId: 'b1',
      });

      const result = await service.resolveNotification({
        tenantId: 't1',
        branchId: 'b1',
        notificationId: 'n1',
        actorUserId: 'u1',
      });

      expect(result.status).toBe('RESOLVED');
      expect(prisma.serviceNotification.update).not.toHaveBeenCalled();
    });
  });

  describe('cancelNotificationsForOrder', () => {
    it('should cancel all open notifications for an order', async () => {
      prisma.serviceNotification.updateMany.mockResolvedValue({ count: 2 });

      await service.cancelNotificationsForOrder({
        tenantId: 't1',
        branchId: 'b1',
        orderId: 'o1',
      });

      expect(prisma.serviceNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 't1', branchId: 'b1', orderId: 'o1' }),
          data: { status: 'CANCELLED' },
        }),
      );
    });
  });

  it('scopes ticket notification cancellation to both tenant and branch', async () => {
    await service.cancelNotificationsForTicket({ tenantId: 't1', branchId: 'b1', ticketId: 'ticket-1' });
    expect(prisma.serviceNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 't1', branchId: 'b1', ticketId: 'ticket-1' }),
    }));
  });
});
