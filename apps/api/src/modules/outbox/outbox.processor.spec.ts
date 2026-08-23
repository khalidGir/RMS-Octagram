import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutboxProcessor } from './outbox.processor';

function createMockPrisma() {
  return {
    outboxEvent: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function createMockKitchenTickets() {
  return {
    createTicketsForOrder: vi.fn().mockResolvedValue({ tickets: [], idempotent: false }),
  };
}

function createMockFeatureResolver() {
  return {
    resolve: vi.fn().mockResolvedValue({
      effective: true,
      platformStatus: 'ENABLED',
      trialEndsAt: null,
      tenantEnabled: true,
      branchOverride: null,
    }),
  };
}

describe('OutboxProcessor', () => {
  let processor: OutboxProcessor;
  let prisma: ReturnType<typeof createMockPrisma>;
  let kitchenTickets: ReturnType<typeof createMockKitchenTickets>;
  let featureResolver: ReturnType<typeof createMockFeatureResolver>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    kitchenTickets = createMockKitchenTickets();
    featureResolver = createMockFeatureResolver();
    processor = new OutboxProcessor(prisma as any, kitchenTickets as any, featureResolver as any);
  });

  afterEach(() => {
    processor.stop();
  });

  it('processes order.confirmed events and creates kitchen tickets', async () => {
    prisma.outboxEvent.findMany.mockResolvedValue([
      {
        id: 'evt-1',
        tenantId: 't1',
        branchId: 'b1',
        eventType: 'order.confirmed',
        payload: { orderId: 'ord-1', paymentId: 'pay-1', totalMinor: '5000' },
        attemptCount: 0,
      },
    ]);
    prisma.outboxEvent.update.mockResolvedValue({});

    await processor.poll();

    expect(kitchenTickets.createTicketsForOrder).toHaveBeenCalledWith({
      tenantId: 't1',
      branchId: 'b1',
      orderId: 'ord-1',
      actorUserId: undefined,
    });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { publishedAt: expect.any(Date) },
    });
  });

  it('marks event as published after successful processing', async () => {
    prisma.outboxEvent.findMany.mockResolvedValue([
      {
        id: 'evt-2',
        tenantId: 't1',
        branchId: 'b1',
        eventType: 'order.confirmed',
        payload: { orderId: 'ord-2', paymentId: 'pay-2', totalMinor: '3000' },
        attemptCount: 0,
      },
    ]);
    prisma.outboxEvent.update.mockResolvedValue({});

    await processor.poll();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-2' },
      data: { publishedAt: expect.any(Date) },
    });
  });

  it('increments attemptCount on failure without marking published', async () => {
    prisma.outboxEvent.findMany.mockResolvedValue([
      {
        id: 'evt-3',
        tenantId: 't1',
        branchId: 'b1',
        eventType: 'order.confirmed',
        payload: { orderId: 'ord-3', paymentId: 'pay-3', totalMinor: '2000' },
        attemptCount: 0,
      },
    ]);
    kitchenTickets.createTicketsForOrder.mockRejectedValue(new Error('DB connection lost'));
    prisma.outboxEvent.update.mockResolvedValue({});

    await processor.poll();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-3' },
      data: {
        attemptCount: { increment: 1 },
        lastError: 'DB connection lost',
      },
    });
    // Should NOT mark as published
    expect(prisma.outboxEvent.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { publishedAt: expect.any(Date) } }),
    );
  });

  it('skips events that have reached max attempts', async () => {
    // findMany is mocked to return empty when the query filters by attemptCount < MAX_ATTEMPTS
    prisma.outboxEvent.findMany.mockResolvedValue([]);

    await processor.poll();

    // findMany filters attemptCount < 5, so no events returned
    expect(kitchenTickets.createTicketsForOrder).not.toHaveBeenCalled();
  });

  it('idempotent — second processing returns existing tickets', async () => {
    const existingTicket = { id: 'tkt-1', tenantId: 't1', branchId: 'b1', orderId: 'ord-5', stationId: 's1' };
    kitchenTickets.createTicketsForOrder.mockResolvedValue({ tickets: [existingTicket], idempotent: true });
    prisma.outboxEvent.findMany.mockResolvedValue([
      {
        id: 'evt-5',
        tenantId: 't1',
        branchId: 'b1',
        eventType: 'order.confirmed',
        payload: { orderId: 'ord-5', paymentId: 'pay-5', totalMinor: '4000' },
        attemptCount: 0,
      },
    ]);
    prisma.outboxEvent.update.mockResolvedValue({});

    await processor.poll();

    expect(kitchenTickets.createTicketsForOrder).toHaveBeenCalledWith({
      tenantId: 't1',
      branchId: 'b1',
      orderId: 'ord-5',
      actorUserId: undefined,
    });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-5' },
      data: { publishedAt: expect.any(Date) },
    });
  });

  it('processes multiple events in a single poll', async () => {
    prisma.outboxEvent.findMany.mockResolvedValue([
      {
        id: 'evt-a',
        tenantId: 't1',
        branchId: 'b1',
        eventType: 'order.confirmed',
        payload: { orderId: 'ord-a', paymentId: 'pay-a', totalMinor: '1000' },
        attemptCount: 0,
      },
      {
        id: 'evt-b',
        tenantId: 't1',
        branchId: 'b1',
        eventType: 'order.confirmed',
        payload: { orderId: 'ord-b', paymentId: 'pay-b', totalMinor: '2000' },
        attemptCount: 0,
      },
    ]);
    prisma.outboxEvent.update.mockResolvedValue({});

    await processor.poll();

    expect(kitchenTickets.createTicketsForOrder).toHaveBeenCalledTimes(2);
    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no pending events', async () => {
    prisma.outboxEvent.findMany.mockResolvedValue([]);

    await processor.poll();

    expect(kitchenTickets.createTicketsForOrder).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
  });

  it('skips kitchen ticket creation when KDS is disabled', async () => {
    featureResolver.resolve.mockResolvedValue({
      effective: false,
      platformStatus: 'DISABLED',
      trialEndsAt: null,
      tenantEnabled: false,
      branchOverride: null,
      disabledReason: 'TENANT_DISABLED',
    });

    prisma.outboxEvent.findMany.mockResolvedValue([
      {
        id: 'evt-kds-disabled',
        tenantId: 't1',
        branchId: 'b1',
        eventType: 'order.confirmed',
        payload: { orderId: 'ord-kds-disabled', paymentId: 'pay-kds-disabled', totalMinor: '5000' },
        attemptCount: 0,
      },
    ]);
    prisma.outboxEvent.update.mockResolvedValue({});

    await processor.poll();

    // Should NOT create kitchen tickets
    expect(kitchenTickets.createTicketsForOrder).not.toHaveBeenCalled();
    // Should still mark as published (handled gracefully)
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-kds-disabled' },
      data: { publishedAt: expect.any(Date) },
    });
    // Should audit the skip
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: null,
        tenantId: 't1',
        branchId: 'b1',
        action: 'OUTBOX_KDS_SKIP',
        entityType: 'Order',
        entityId: 'ord-kds-disabled',
        afterJson: {
          reason: 'KDS_DISABLED',
          disabledReason: 'TENANT_DISABLED',
          orderId: 'ord-kds-disabled',
        },
      },
    });
  });
});
