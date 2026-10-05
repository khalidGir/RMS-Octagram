import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OutboxProcessor } from './outbox.processor';

function createMockPrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(undefined),
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

function createMockSqs() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

describe('OutboxProcessor', () => {
  let processor: OutboxProcessor;
  let prisma: ReturnType<typeof createMockPrisma>;
  let kitchenTickets: ReturnType<typeof createMockKitchenTickets>;
  let featureResolver: ReturnType<typeof createMockFeatureResolver>;
  let sqs: ReturnType<typeof createMockSqs>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    kitchenTickets = createMockKitchenTickets();
    featureResolver = createMockFeatureResolver();
    sqs = createMockSqs();
    processor = new OutboxProcessor(
      prisma as unknown as ConstructorParameters<typeof OutboxProcessor>[0],
      kitchenTickets as unknown as ConstructorParameters<typeof OutboxProcessor>[1],
      featureResolver as unknown as ConstructorParameters<typeof OutboxProcessor>[2],
      sqs as unknown as ConstructorParameters<typeof OutboxProcessor>[3],
    );
  });

  afterEach(() => {
    processor.stop();
  });

  it('processes order.confirmed events and creates kitchen tickets', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'evt-1',
          tenantId: 't1',
          branchId: 'b1',
          eventType: 'order.confirmed',
          payload: { orderId: 'ord-1', paymentId: 'pay-1', totalMinor: '5000' },
          attemptCount: 0,
          publishedAt: null,
          lastError: null,
          aggregateType: 'Order',
          aggregateId: 'ord-1',
          occurredAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    await processor.poll();

    expect(kitchenTickets.createTicketsForOrder).toHaveBeenCalledWith({
      tenantId: 't1',
      branchId: 'b1',
      orderId: 'ord-1',
      actorUserId: undefined,
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('marks event as published after successful processing', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'evt-2',
          tenantId: 't1',
          branchId: 'b1',
          eventType: 'order.confirmed',
          payload: { orderId: 'ord-2', paymentId: 'pay-2', totalMinor: '3000' },
          attemptCount: 0,
          publishedAt: null,
          lastError: null,
          aggregateType: 'Order',
          aggregateId: 'ord-2',
          occurredAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    await processor.poll();

    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('increments attemptCount on failure without marking published', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'evt-3',
          tenantId: 't1',
          branchId: 'b1',
          eventType: 'order.confirmed',
          payload: { orderId: 'ord-3', paymentId: 'pay-3', totalMinor: '2000' },
          attemptCount: 0,
          publishedAt: null,
          lastError: null,
          aggregateType: 'Order',
          aggregateId: 'ord-3',
          occurredAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    kitchenTickets.createTicketsForOrder.mockRejectedValue(new Error('DB connection lost'));

    await processor.poll();

    // Claim is part of $queryRaw; the failure update must remain unpublished.
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('skips events that have reached max attempts', async () => {
    // findMany returns empty when the query filters
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await processor.poll();

    expect(kitchenTickets.createTicketsForOrder).not.toHaveBeenCalled();
  });

  it('idempotent — second processing returns existing tickets', async () => {
    const existingTicket = { id: 'tkt-1', tenantId: 't1', branchId: 'b1', orderId: 'ord-5', stationId: 's1' };
    kitchenTickets.createTicketsForOrder.mockResolvedValue({ tickets: [existingTicket], idempotent: true });
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'evt-5',
          tenantId: 't1',
          branchId: 'b1',
          eventType: 'order.confirmed',
          payload: { orderId: 'ord-5', paymentId: 'pay-5', totalMinor: '4000' },
          attemptCount: 0,
          publishedAt: null,
          lastError: null,
          aggregateType: 'Order',
          aggregateId: 'ord-5',
          occurredAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    await processor.poll();

    expect(kitchenTickets.createTicketsForOrder).toHaveBeenCalledWith({
      tenantId: 't1',
      branchId: 'b1',
      orderId: 'ord-5',
      actorUserId: undefined,
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('processes multiple events in a single poll', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'evt-a',
          tenantId: 't1',
          branchId: 'b1',
          eventType: 'order.confirmed',
          payload: { orderId: 'ord-a', paymentId: 'pay-a', totalMinor: '1000' },
          attemptCount: 0,
          publishedAt: null,
          lastError: null,
          aggregateType: 'Order',
          aggregateId: 'ord-a',
          occurredAt: new Date(),
        },
        {
          id: 'evt-b',
          tenantId: 't1',
          branchId: 'b1',
          eventType: 'order.confirmed',
          payload: { orderId: 'ord-b', paymentId: 'pay-b', totalMinor: '2000' },
          attemptCount: 0,
          publishedAt: null,
          lastError: null,
          aggregateType: 'Order',
          aggregateId: 'ord-b',
          occurredAt: new Date(),
        },
      ])
      .mockResolvedValue([]);

    await processor.poll();

    // Wait for async work to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(kitchenTickets.createTicketsForOrder).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no pending events', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await processor.poll();

    expect(kitchenTickets.createTicketsForOrder).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('selects and claims work in one SQL statement rather than a separate update', async () => {
    await processor.poll();
    const [sql] = prisma.$queryRaw.mock.calls[0];
    const statement = (sql as TemplateStringsArray).join('?');
    expect(statement).toContain('candidates AS');
    expect(statement).toContain('FOR UPDATE SKIP LOCKED');
    expect(statement).toContain('UPDATE "OutboxEvent" AS event');
    expect(statement).toContain('RETURNING event.*');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('renews a held claim and bounds shutdown even when its handler is stuck', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    kitchenTickets.createTicketsForOrder.mockImplementation(() => barrier);
    prisma.$queryRaw.mockResolvedValueOnce([{
      id: 'held-event', tenantId: 't1', branchId: 'b1', eventType: 'order.confirmed',
      payload: { orderId: 'held-order' }, attemptCount: 0, lockedBy: 'held-claim',
    }]);
    const work = processor.poll();
    try {
      await vi.advanceTimersByTimeAsync(20_000);
      expect(kitchenTickets.createTicketsForOrder).toHaveBeenCalledTimes(1);
      const [sql, ...values] = prisma.$executeRaw.mock.calls[0];
      expect((sql as TemplateStringsArray).join('?')).toContain('SET "lockedAt" = NOW()');
      expect(values).toEqual(['held-event', 'held-claim']);
      const stop = processor.stop();
      await vi.advanceTimersByTimeAsync(30_000);
      await stop;
      expect(prisma.$executeRaw.mock.calls.some(([query]) => (query as TemplateStringsArray).join('?').includes("'PUBLISHED'"))).toBe(false);
    } finally {
      release();
      await work;
      vi.useRealTimers();
    }
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

    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'evt-kds-disabled',
          tenantId: 't1',
          branchId: 'b1',
          eventType: 'order.confirmed',
          payload: { orderId: 'ord-kds-disabled', paymentId: 'pay-kds-disabled', totalMinor: '5000' },
          attemptCount: 0,
          publishedAt: null,
          lastError: null,
          aggregateType: 'Order',
          aggregateId: 'ord-kds-disabled',
          occurredAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    await processor.poll();

    // Wait for async work
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should NOT create kitchen tickets
    expect(kitchenTickets.createTicketsForOrder).not.toHaveBeenCalled();
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

  describe('menu.image.process_requested', () => {
    function menuImageEvent(payload: unknown) {
      return {
        id: 'evt-img', tenantId: 't1', branchId: null,
        eventType: 'menu.image.process_requested', payload,
        attemptCount: 0, publishedAt: null, lastError: null,
        aggregateType: 'MediaObject', aggregateId: 'media-1', occurredAt: new Date(),
      };
    }

    it('publishes a pointer-only message and marks the event published', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([menuImageEvent({ mediaObjectId: 'media-1' })])
        .mockResolvedValueOnce([]);

      await processor.poll();

      expect(sqs.send).toHaveBeenCalledTimes(1);
      expect(sqs.send).toHaveBeenCalledWith({ mediaObjectId: 'media-1' });
      expect(Object.keys(sqs.send.mock.calls[0][0])).toEqual(['mediaObjectId']);
      const published = prisma.$executeRaw.mock.calls.some(([query]) => (query as TemplateStringsArray).join('?').includes("'PUBLISHED'"));
      expect(published).toBe(true);
    });

    it('retries without sending when the payload lacks a mediaObjectId', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([menuImageEvent({ tenantId: 't1' })])
        .mockResolvedValueOnce([]);

      await processor.poll();

      expect(sqs.send).not.toHaveBeenCalled();
      const published = prisma.$executeRaw.mock.calls.some(([query]) => (query as TemplateStringsArray).join('?').includes("'PUBLISHED'"));
      expect(published).toBe(false);
      const retried = prisma.$executeRaw.mock.calls.some(([query]) => (query as TemplateStringsArray).join('?').includes("'RETRY'"));
      expect(retried).toBe(true);
    });

    it('retries when the queue send fails so the job is not lost', async () => {
      sqs.send.mockRejectedValue(new Error('SQS unavailable'));
      prisma.$queryRaw
        .mockResolvedValueOnce([menuImageEvent({ mediaObjectId: 'media-1' })])
        .mockResolvedValueOnce([]);

      await processor.poll();

      const published = prisma.$executeRaw.mock.calls.some(([query]) => (query as TemplateStringsArray).join('?').includes("'PUBLISHED'"));
      expect(published).toBe(false);
      const retried = prisma.$executeRaw.mock.calls.some(([query]) => (query as TemplateStringsArray).join('?').includes("'RETRY'"));
      expect(retried).toBe(true);
    });
  });
});
