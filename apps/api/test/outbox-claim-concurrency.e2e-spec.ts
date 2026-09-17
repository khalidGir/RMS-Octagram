import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OutboxProcessor } from '../src/modules/outbox/outbox.processor';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.includes('test')) {
  throw new Error('A dedicated TEST_DATABASE_URL with a test database name is required.');
}

// A private schema prevents this global queue consumer from touching events
// belonging to other tests. Only the real outbox SQL is under test here;
// restaurant routing is covered separately by lifecycle integration tests.
const schema = `outbox_claim_${randomBytes(8).toString('hex')}`;
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set('schema', schema);
const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const first = new PrismaClient({ datasources: { db: { url: scopedUrl.toString() } } });
const second = new PrismaClient({ datasources: { db: { url: scopedUrl.toString() } } });

describe('Outbox atomic claims — real PostgreSQL connections', () => {
  beforeAll(async () => {
    // Identifiers are generated exclusively from a fixed prefix and random hex.
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await admin.$executeRawUnsafe(`CREATE TABLE "${schema}"."OutboxEvent" (LIKE public."OutboxEvent" INCLUDING ALL)`);
    await admin.$executeRawUnsafe(`CREATE TABLE "${schema}"."AuditLog" (LIKE public."AuditLog" INCLUDING ALL)`);
  });

  afterAll(async () => {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
    await admin.$executeRawUnsafe(`DROP TABLE IF EXISTS "${schema}"."OutboxEvent"`);
    await admin.$executeRawUnsafe(`DROP TABLE IF EXISTS "${schema}"."AuditLog"`);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}"`);
    await admin.$disconnect();
  });

  afterEach(async () => {
    await first.outboxEvent.deleteMany();
    await first.auditLog.deleteMany();
  });

  it('two concurrent consumers claim disjoint batches and publish each event once', async () => {
    await first.outboxEvent.createMany({ data: Array.from({ length: 20 }, (_, index) => ({
      id: `claim-${index}`, tenantId: 'claim-tenant', branchId: 'claim-branch',
      aggregateType: 'Order', aggregateId: `order-${index}`, eventType: 'order.confirmed',
      payload: { orderId: `order-${index}`, paymentId: `payment-${index}` },
    })) });

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const handled: string[] = [];
    const kitchen = { createTicketsForOrder: vi.fn(async ({ orderId }: { orderId: string }) => {
      handled.push(orderId);
      await barrier;
    }) };
    const features = { resolve: vi.fn().mockResolvedValue({ effective: true }) };
    const consumer = (client: PrismaClient) => new OutboxProcessor(
      client as unknown as ConstructorParameters<typeof OutboxProcessor>[0],
      kitchen as unknown as ConstructorParameters<typeof OutboxProcessor>[1],
      features as unknown as ConstructorParameters<typeof OutboxProcessor>[2],
    );

    const work = [consumer(first).poll(), consumer(second).poll()];
    try {
      await vi.waitFor(() => expect(handled).toHaveLength(20), { timeout: 10_000 });
      expect(new Set(handled).size).toBe(20);
      const rows = await first.outboxEvent.findMany();
      expect(rows).toHaveLength(20);
      expect(rows.every((row) => row.status === 'PROCESSING' && row.lockedAt && row.lockedBy && !row.publishedAt)).toBe(true);
    } finally {
      release();
      await Promise.all(work);
    }
    const published = await first.outboxEvent.findMany();
    expect(published.every((row) => row.status === 'PUBLISHED' && row.publishedAt && !row.lockedBy && !row.lockedAt)).toBe(true);
    expect(kitchen.createTicketsForOrder).toHaveBeenCalledTimes(20);
  });

  it('diagnostics deny foreign tenants and unassigned branches; retries are scoped and audited once', async () => {
    await first.outboxEvent.createMany({ data: [
      { id: 'dead-owned', tenantId: 'diagnostic-tenant', branchId: 'assigned' },
      { id: 'dead-unassigned', tenantId: 'diagnostic-tenant', branchId: 'unassigned' },
      { id: 'dead-foreign', tenantId: 'foreign-tenant', branchId: 'foreign' },
    ].map((row) => ({ ...row, aggregateType: 'Order', aggregateId: row.id,
      eventType: 'order.confirmed', payload: {}, status: 'DEAD_LETTER', attemptCount: 5,
    })) });
    const service = new OutboxProcessor(
      first as unknown as ConstructorParameters<typeof OutboxProcessor>[0],
      {} as ConstructorParameters<typeof OutboxProcessor>[1],
      {} as ConstructorParameters<typeof OutboxProcessor>[2],
    );
    const ownerScope = { tenantId: 'diagnostic-tenant' };
    const managerScope = { tenantId: 'diagnostic-tenant', branchIds: ['assigned'] };
    expect(await service.getStats(ownerScope)).toEqual({ DEAD_LETTER: 2 });
    expect(await service.getStats(managerScope)).toEqual({ DEAD_LETTER: 1 });
    expect(await service.getStats({ ...managerScope, branchIds: [] })).toEqual({});
    expect(await service.getDeadLetterEvents(managerScope)).toEqual([expect.objectContaining({ id: 'dead-owned' })]);
    await expect(service.retryDeadLetter(ownerScope, 'dead-foreign', 'owner-actor')).rejects.toMatchObject({ status: 404 });
    await expect(service.retryDeadLetter(managerScope, 'dead-unassigned', 'manager-actor')).rejects.toMatchObject({ status: 404 });
    const outcomes = await Promise.allSettled([
      service.retryDeadLetter(ownerScope, 'dead-owned', 'owner-actor'),
      service.retryDeadLetter(ownerScope, 'dead-owned', 'owner-actor'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    expect(await first.outboxEvent.findUnique({ where: { id: 'dead-owned' } })).toMatchObject({ status: 'RETRY', attemptCount: 0 });
    const audits = await first.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: 'owner-actor', tenantId: 'diagnostic-tenant', branchId: 'assigned', action: 'OUTBOX_RETRY' });
  });

  it('recovers expired leases, leaves live leases alone, and dead-letters exhausted crashes', async () => {
    await first.outboxEvent.createMany({ data: [
      { id: 'expired', lockedAt: new Date(0), attemptCount: 0 },
      { id: 'live', lockedAt: new Date(), attemptCount: 0 },
      { id: 'exhausted', lockedAt: new Date(0), attemptCount: 5 },
    ].map((row) => ({ ...row, tenantId: 'lease-tenant', branchId: 'lease-branch',
      aggregateType: 'Order', aggregateId: row.id, eventType: 'order.confirmed',
      payload: { orderId: row.id }, status: 'PROCESSING', lockedBy: 'terminated-process',
    })) });
    const kitchen = { createTicketsForOrder: vi.fn().mockResolvedValue({}) };
    const service = new OutboxProcessor(
      first as unknown as ConstructorParameters<typeof OutboxProcessor>[0],
      kitchen as unknown as ConstructorParameters<typeof OutboxProcessor>[1],
      { resolve: vi.fn().mockResolvedValue({ effective: true }) } as unknown as ConstructorParameters<typeof OutboxProcessor>[2],
    );
    await service.poll();
    expect(kitchen.createTicketsForOrder).toHaveBeenCalledTimes(1);
    expect(await first.outboxEvent.findUnique({ where: { id: 'expired' } })).toMatchObject({ status: 'PUBLISHED', attemptCount: 1 });
    expect(await first.outboxEvent.findUnique({ where: { id: 'live' } })).toMatchObject({ status: 'PROCESSING', lockedBy: 'terminated-process', attemptCount: 0 });
    expect(await first.outboxEvent.findUnique({ where: { id: 'exhausted' } })).toMatchObject({ status: 'DEAD_LETTER', publishedAt: null, lockedBy: null, lockedAt: null });
  });

  it('a stale handler cannot acknowledge a newer recovery claim', async () => {
    await first.outboxEvent.create({ data: { id: 'fenced', tenantId: 'lease-tenant', branchId: 'lease-branch',
      aggregateType: 'Order', aggregateId: 'fenced', eventType: 'order.confirmed', payload: { orderId: 'fenced' },
    } });
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    const oldBarrier = new Promise<void>((resolve) => { releaseOld = resolve; });
    const newBarrier = new Promise<void>((resolve) => { releaseNew = resolve; });
    const oldKitchen = { createTicketsForOrder: vi.fn(() => oldBarrier) };
    const newKitchen = { createTicketsForOrder: vi.fn(() => newBarrier) };
    const service = (client: PrismaClient, kitchen: typeof oldKitchen) => new OutboxProcessor(
      client as unknown as ConstructorParameters<typeof OutboxProcessor>[0],
      kitchen as unknown as ConstructorParameters<typeof OutboxProcessor>[1],
      { resolve: vi.fn().mockResolvedValue({ effective: true }) } as unknown as ConstructorParameters<typeof OutboxProcessor>[2],
    );
    const oldWork = service(first, oldKitchen).poll();
    let newWork: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(oldKitchen.createTicketsForOrder).toHaveBeenCalledTimes(1));
      const oldClaim = await first.outboxEvent.findUniqueOrThrow({ where: { id: 'fenced' } });
      await first.outboxEvent.update({ where: { id: 'fenced' }, data: { lockedAt: new Date(0) } });
      newWork = service(second, newKitchen).poll();
      await vi.waitFor(() => expect(newKitchen.createTicketsForOrder).toHaveBeenCalledTimes(1));
      const newClaim = await first.outboxEvent.findUniqueOrThrow({ where: { id: 'fenced' } });
      expect(newClaim.lockedBy).not.toBe(oldClaim.lockedBy);
      releaseOld();
      await oldWork;
      expect(await first.outboxEvent.findUnique({ where: { id: 'fenced' } })).toMatchObject({ status: 'PROCESSING', publishedAt: null, lockedBy: newClaim.lockedBy });
    } finally {
      releaseOld();
      releaseNew();
      await Promise.all([oldWork, newWork]);
    }
    expect(await first.outboxEvent.findUnique({ where: { id: 'fenced' } })).toMatchObject({ status: 'PUBLISHED', lockedBy: null });
  });
});
