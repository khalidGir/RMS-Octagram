import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KdsGateway } from '../kitchen/kds.gateway';
import { OutboxProcessor } from './outbox.processor';
import type { OutboxEventRecord } from './outbox.processor';

const TICKET_EVENTS = ['ticket.in_progress', 'ticket.ready', 'ticket.recalled', 'ticket.completed', 'ticket.cancelled'];
const ORDER_EVENTS = ['order.fulfillment.status_changed', 'order.expo.released', 'order.expo.recalled',
  'order.waiter.assigned', 'order.collected', 'order.served'];

/** Durable after-commit invalidations, not replayable client state patches.
 * Duplicate delivery is safe: clients refetch their authorized HTTP projections.
 * Socket delivery is best-effort; durable state and reconnect reconciliation are
 * authoritative. Never send raw outbox payloads or financial order projections.
 */
@Injectable()
export class FulfillmentEventDelivery implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KdsGateway) private readonly gateway: KdsGateway,
    @Inject(OutboxProcessor) private readonly processor: OutboxProcessor,
  ) {}

  onModuleInit() {
    for (const eventType of [...TICKET_EVENTS, ...ORDER_EVENTS]) {
      this.processor.registerHandler(eventType, (event) => this.deliver(event));
    }
  }

  async deliver(event: OutboxEventRecord) {
    const { tenantId, branchId } = event;
    if (!tenantId || !branchId || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
      throw new Error('Invalid fulfillment event scope or payload');
    }
    const payload = event.payload as Record<string, unknown>;
    const orderId = payload.orderId;
    if (typeof orderId !== 'string' || !orderId) throw new Error('Invalid fulfillment event orderId');
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, branchId }, select: { id: true, version: true },
    });
    if (!order) throw new Error('Fulfillment event order outside scope');
    const invalidation = { eventId: event.id, orderId: order.id, version: order.version };
    if (TICKET_EVENTS.includes(event.eventType)) {
      if (event.aggregateType !== 'KitchenTicket' || typeof payload.ticketId !== 'string' || event.aggregateId !== payload.ticketId) {
        throw new Error('Invalid fulfillment event ticket aggregate');
      }
      const ticket = await this.prisma.kitchenTicket.findFirst({
        where: { id: payload.ticketId, orderId, tenantId, branchId },
        select: { id: true, stationId: true, version: true },
      });
      if (!ticket) throw new Error('Fulfillment event ticket outside scope');
      this.gateway.broadcastTicketInvalidated(branchId, ticket.stationId, {
        ...invalidation, ticketId: ticket.id, stationId: ticket.stationId, version: ticket.version,
      });
      this.gateway.broadcastToExpo(branchId, 'fulfillment:changed', invalidation);
      this.gateway.broadcastToServiceBoard(branchId, 'fulfillment:changed', invalidation);
      return;
    }
    if (!ORDER_EVENTS.includes(event.eventType) || event.aggregateType !== 'Order' || event.aggregateId !== orderId) {
      throw new Error('Invalid fulfillment event order aggregate');
    }
    if (event.eventType === 'order.waiter.assigned') {
      this.gateway.broadcastToServiceBoard(branchId, 'order:assignment_changed', invalidation);
    } else if (event.eventType.startsWith('order.expo.')) {
      const name = event.eventType === 'order.expo.released' ? 'expo:released' : 'expo:updated';
      this.gateway.broadcastToExpo(branchId, name, invalidation);
    }
    this.gateway.broadcastFulfillmentChanged(branchId, invalidation);
    this.gateway.broadcastToExpo(branchId, 'fulfillment:changed', invalidation);
  }
}
