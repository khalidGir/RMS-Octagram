import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FulfillmentEventDelivery } from './fulfillment-event-delivery.service';
import type { OutboxEventRecord } from './outbox.processor';

describe('FulfillmentEventDelivery', () => {
  const prisma = {
    order: { findFirst: vi.fn() }, kitchenTicket: { findFirst: vi.fn() },
  };
  const gateway = {
    broadcastTicketInvalidated: vi.fn(), broadcastToExpo: vi.fn(),
    broadcastToServiceBoard: vi.fn(), broadcastFulfillmentChanged: vi.fn(),
  };
  const processor = { registerHandler: vi.fn() };
  const delivery = new FulfillmentEventDelivery(
    prisma as unknown as ConstructorParameters<typeof FulfillmentEventDelivery>[0],
    gateway as unknown as ConstructorParameters<typeof FulfillmentEventDelivery>[1],
    processor as unknown as ConstructorParameters<typeof FulfillmentEventDelivery>[2],
  );
  const event = {
    id: 'event1', tenantId: 'tenant1', branchId: 'branch1',
    aggregateType: 'KitchenTicket', aggregateId: 'ticket1', eventType: 'ticket.ready',
    payload: { orderId: 'order1', ticketId: 'ticket1', totalMinor: '90000', proofUrl: 'private' },
  } as OutboxEventRecord;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.order.findFirst.mockResolvedValue({ id: 'order1', version: 5 });
    prisma.kitchenTicket.findFirst.mockResolvedValue({ id: 'ticket1', stationId: 'station1', version: 3 });
  });

  it('registers each supported lifecycle handler', () => {
    delivery.onModuleInit();
    expect(processor.registerHandler).toHaveBeenCalledTimes(11);
    expect(processor.registerHandler).toHaveBeenCalledWith('ticket.ready', expect.any(Function));
    expect(processor.registerHandler).toHaveBeenCalledWith('order.expo.recalled', expect.any(Function));
  });

  it('broadcasts scoped current-version invalidations without financial payloads', async () => {
    await delivery.deliver(event);
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'order1', tenantId: 'tenant1', branchId: 'branch1' }, select: { id: true, version: true },
    });
    expect(prisma.kitchenTicket.findFirst).toHaveBeenCalledWith({
      where: { id: 'ticket1', orderId: 'order1', tenantId: 'tenant1', branchId: 'branch1' },
      select: { id: true, stationId: true, version: true },
    });
    expect(gateway.broadcastTicketInvalidated).toHaveBeenCalledWith('branch1', 'station1', {
      eventId: 'event1', orderId: 'order1', ticketId: 'ticket1', stationId: 'station1', version: 3,
    });
  });

  it.each([
    { ...event, tenantId: null }, { ...event, payload: [] },
    { ...event, payload: { orderId: 5 } }, { ...event, aggregateId: 'other-ticket' },
  ])('rejects malformed scope/payload/aggregate', async (invalid) => {
    await expect(delivery.deliver(invalid)).rejects.toThrow();
    expect(gateway.broadcastTicketInvalidated).not.toHaveBeenCalled();
    expect(gateway.broadcastFulfillmentChanged).not.toHaveBeenCalled();
  });

  it('rejects a foreign order before any broadcast', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(delivery.deliver(event)).rejects.toThrow('outside scope');
    expect(gateway.broadcastTicketInvalidated).not.toHaveBeenCalled();
  });

  it('rejects a foreign ticket before any broadcast', async () => {
    prisma.kitchenTicket.findFirst.mockResolvedValue(null);
    await expect(delivery.deliver(event)).rejects.toThrow('outside scope');
    expect(gateway.broadcastTicketInvalidated).not.toHaveBeenCalled();
  });

  it('uses the existing Expo recall contract and refreshes service state', async () => {
    await delivery.deliver({ ...event, eventType: 'order.expo.recalled', aggregateType: 'Order', aggregateId: 'order1' });
    expect(gateway.broadcastToExpo).toHaveBeenCalledWith('branch1', 'expo:updated', {
      eventId: 'event1', orderId: 'order1', version: 5,
    });
    expect(gateway.broadcastFulfillmentChanged).toHaveBeenCalledTimes(1);
  });
});
