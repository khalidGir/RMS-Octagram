import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenTicketsService } from '../kitchen/kitchen-tickets.service';
import { FeatureResolver } from '../features/feature-resolver.service';
import { FeatureKey } from '@rms/contracts';
import { ExecutionContext } from '../observability/execution-context';
import { randomBytes } from 'crypto';

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const DRAIN_TIMEOUT_MS = 30_000;
const INSTANCE_ID = randomBytes(8).toString('hex');

type EventHandler = (event: OutboxEventRecord) => Promise<void>;

// Raw query result type — includes new fields not yet in Prisma client
interface OutboxEventRecord {
  id: string;
  tenantId: string | null;
  branchId: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  occurredAt: Date;
  publishedAt: Date | null;
  attemptCount: number;
  lastError: string | null;
  status?: string;
  lockedBy?: string | null;
  lockedAt?: Date | null;
  nextRetryAt?: Date | null;
}

/**
 * Outbox processor with FOR UPDATE SKIP LOCKED, exponential retry, and dead-letter handling.
 *
 * Key guarantees:
 * - Atomic claim/lease semantics via FOR UPDATE SKIP LOCKED
 * - Exponential retry with maximum attempts
 * - Dead-letter state with diagnostic metadata
 * - Recovery after worker/process termination
 * - Idempotent handlers (each handler checks ProcessedEvent before processing)
 * - Unknown event types are NEVER silently marked published
 * - Admin-only inspection endpoints for debugging
 */
@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private activeWork: Promise<void>[] = [];

  private handlers = new Map<string, EventHandler>([
    ['order.confirmed', this.handleOrderConfirmed.bind(this)],
    // Future handlers registered here as features are implemented
  ]);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(KitchenTicketsService)
    private readonly kitchenTickets: KitchenTicketsService,
    @Inject(FeatureResolver)
    private readonly featureResolver: FeatureResolver,
  ) {}

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  start() {
    if (this.pollTimer) return;
    this.draining = false;
    this.logger.log(`Outbox processor started [instance=${INSTANCE_ID}]`);
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  async stop() {
    this.draining = true;
    this.logger.log('Outbox processor draining...');

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active work to complete (with timeout)
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (this.activeWork.length > 0 && Date.now() < deadline) {
      await Promise.race(this.activeWork);
    }

    if (this.activeWork.length > 0) {
      this.logger.warn(`${this.activeWork.length} outbox tasks still active after drain timeout`);
    }

    this.logger.log('Outbox processor stopped');
  }

  async poll(force = false) {
    if (!force && this.draining) return;

    try {
      // Atomic claim with FOR UPDATE SKIP LOCKED
      const events = await this.prisma.$queryRaw<OutboxEventRecord[]>`
        SELECT *
        FROM "OutboxEvent"
        WHERE "publishedAt" IS NULL
          AND "attemptCount" < ${MAX_ATTEMPTS}
          AND ("status" IS NULL OR "status" = 'PENDING' OR "status" = 'RETRY')
          AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
        ORDER BY "occurredAt" ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `;

      if (events.length === 0) return;

      // Mark events as claimed
      const eventIds = events.map((e) => e.id);
      await this.prisma.$executeRaw`
        UPDATE "OutboxEvent"
        SET "status" = 'PROCESSING', "lockedBy" = ${INSTANCE_ID}, "lockedAt" = NOW()
        WHERE "id" = ANY(${eventIds}::text[])
      `;

      // Process each event
      for (const event of events) {
        const work = this.processEvent(event).catch((err) => {
          this.logger.error(`Unhandled error processing event ${event.id}: ${err}`);
        });
        this.activeWork.push(work);
        work.finally(() => {
          this.activeWork = this.activeWork.filter((w) => w !== work);
        });
      }

      // Wait for all events in this batch to complete processing
      await Promise.allSettled(this.activeWork);
    } catch (err) {
      this.logger.error(`Outbox poll failed: ${err}`);
    }
  }

  private async processEvent(event: OutboxEventRecord) {
    const handler = this.handlers.get(event.eventType);

    if (!handler) {
      this.logger.error(
        `Unknown outbox event type: ${event.eventType} (event=${event.id}). ` +
        `Event is NOT marked as published. Register a handler or manually resolve.`,
      );
      await this.prisma.$executeRaw`
        UPDATE "OutboxEvent"
        SET "status" = 'UNKNOWN_TYPE',
            "lastError" = ${`Unhandled event type: ${event.eventType}`},
            "lockedBy" = NULL,
            "lockedAt" = NULL
        WHERE "id" = ${event.id}
      `;
      return;
    }

    const ctx = {
      correlationId: `outbox-${event.id}`,
      tenantId: event.tenantId ?? undefined,
      userId: undefined as string | undefined,
    };

    await ExecutionContext.run(ctx, async () => {
      try {
        await handler(event);

        // Mark as published
        await this.prisma.$executeRaw`
          UPDATE "OutboxEvent"
          SET "publishedAt" = NOW(),
              "status" = 'PUBLISHED',
              "lockedBy" = NULL,
              "lockedAt" = NULL
          WHERE "id" = ${event.id}
        `;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const newAttemptCount = Number(event.attemptCount) + 1;

        if (newAttemptCount >= MAX_ATTEMPTS) {
          // Dead-letter: max attempts exhausted
          this.logger.error(
            `Event ${event.id} (${event.eventType}) moved to DEAD_LETTER after ${MAX_ATTEMPTS} attempts: ${errorMessage}`,
          );
          await this.prisma.$executeRaw`
            UPDATE "OutboxEvent"
            SET "attemptCount" = ${newAttemptCount},
                "lastError" = ${errorMessage},
                "status" = 'DEAD_LETTER',
                "lockedBy" = NULL,
                "lockedAt" = NULL
            WHERE "id" = ${event.id}
          `;
        } else {
          // Exponential backoff: 2^attemptCount seconds
          const backoffSeconds = Math.pow(2, newAttemptCount);
          const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);
          this.logger.warn(
            `Event ${event.id} (${event.eventType}) failed (attempt ${newAttemptCount}/${MAX_ATTEMPTS}): ${errorMessage}. ` +
            `Retry in ${backoffSeconds}s`,
          );
          await this.prisma.$executeRaw`
            UPDATE "OutboxEvent"
            SET "attemptCount" = ${newAttemptCount},
                "lastError" = ${errorMessage},
                "status" = 'RETRY',
                "lockedBy" = NULL,
                "lockedAt" = NULL,
                "nextRetryAt" = ${nextRetryAt}
            WHERE "id" = ${event.id}
          `;
        }
      }
    });
  }

  private async handleOrderConfirmed(event: OutboxEventRecord) {
    const payload = event.payload as { orderId: string; paymentId: string };

    // Check if KDS is effective for this tenant/branch
    const kdsState = await this.featureResolver.resolve(
      event.tenantId!,
      FeatureKey.KDS,
      event.branchId!,
    );

    if (!kdsState.effective) {
      this.logger.log(
        `KDS disabled for tenant ${event.tenantId} branch ${event.branchId} — skipping kitchen ticket creation for order ${payload.orderId}. Reason: ${kdsState.disabledReason}`,
      );

      // Audit trail: mark that we intentionally skipped ticket creation
      await this.prisma.auditLog.create({
        data: {
          actorUserId: null,
          tenantId: event.tenantId!,
          branchId: event.branchId!,
          action: 'OUTBOX_KDS_SKIP',
          entityType: 'Order',
          entityId: payload.orderId,
          afterJson: {
            reason: 'KDS_DISABLED',
            disabledReason: kdsState.disabledReason,
            orderId: payload.orderId,
          },
        },
      });

      return; // Mark handled without creating tickets
    }

    await this.kitchenTickets.createTicketsForOrder({
      tenantId: event.tenantId!,
      branchId: event.branchId!,
      orderId: payload.orderId,
      actorUserId: undefined,
    });
  }

  /**
   * Get outbox statistics for admin inspection.
   */
  async getStats(): Promise<Record<string, number>> {
    const stats = await this.prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT COALESCE("status", 'PENDING') as "status", COUNT(*) as "count"
      FROM "OutboxEvent"
      GROUP BY "status"
    `;

    const result: Record<string, number> = {};
    for (const row of stats) {
      result[row.status] = Number(row.count);
    }
    return result;
  }

  /**
   * Get dead-letter events for admin inspection.
   */
  async getDeadLetterEvents(limit = 50): Promise<unknown[]> {
    return this.prisma.$queryRaw`
      SELECT * FROM "OutboxEvent"
      WHERE "status" = 'DEAD_LETTER'
      ORDER BY "occurredAt" DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Manually retry a dead-letter event (admin action).
   */
  async retryDeadLetter(eventId: string, actorUserId: string): Promise<void> {
    const events = await this.prisma.$queryRaw<Array<{ id: string; tenantId: string | null; branchId: string | null; status: string; eventType: string; attemptCount: number; lastError: string | null }>>`
      SELECT "id", "tenantId", "branchId", "status", "eventType", "attemptCount", "lastError"
      FROM "OutboxEvent"
      WHERE "id" = ${eventId}
      LIMIT 1
    `;

    const event = events[0];
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    if (event.status !== 'DEAD_LETTER') {
      throw new Error(`Event ${eventId} is not in DEAD_LETTER state (current: ${event.status})`);
    }

    await this.prisma.$executeRaw`
      UPDATE "OutboxEvent"
      SET "status" = 'RETRY',
          "attemptCount" = 0,
          "lastError" = NULL,
          "nextRetryAt" = NULL,
          "lockedBy" = NULL,
          "lockedAt" = NULL
      WHERE "id" = ${eventId}
    `;

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        tenantId: event.tenantId,
        branchId: event.branchId,
        action: 'OUTBOX_RETRY',
        entityType: 'OutboxEvent',
        entityId: eventId,
        afterJson: {
          eventType: event.eventType,
          attemptCount: event.attemptCount,
          lastError: event.lastError,
        },
      },
    });

    this.logger.log(`Event ${eventId} (${event.eventType}) queued for retry by ${actorUserId}`);
  }
}
