import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KitchenTicketsService } from '../kitchen/kitchen-tickets.service';
const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;

@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(KitchenTicketsService)
    private readonly kitchenTickets: KitchenTicketsService,
  ) {}

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start() {
    if (this.pollTimer) return;
    this.logger.log('Outbox processor started');
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.log('Outbox processor stopped');
    }
  }

  async poll() {
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          publishedAt: null,
          attemptCount: { lt: MAX_ATTEMPTS },
        },
        orderBy: { occurredAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (err) {
      this.logger.error(`Outbox poll failed: ${err}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async processEvent(event: any) {
    try {
      switch (event.eventType) {
        case 'order.confirmed':
          await this.handleOrderConfirmed(event);
          break;
        default:
          this.logger.warn(`Unknown outbox event type: ${event.eventType}`);
      }

      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date() },
      });
    } catch (err) {
      this.logger.error(`Failed to process outbox event ${event.id}: ${err}`);
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          attemptCount: { increment: 1 },
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleOrderConfirmed(event: any) {
    const payload = event.payload as { orderId: string; paymentId: string };
    await this.kitchenTickets.createTicketsForOrder({
      tenantId: event.tenantId!,
      branchId: event.branchId!,
      orderId: payload.orderId,
      actorUserId: undefined,
    });
  }
}
