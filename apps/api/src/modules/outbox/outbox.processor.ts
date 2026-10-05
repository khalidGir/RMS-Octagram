import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenTicketsService } from '../kitchen/kitchen-tickets.service';
import { FeatureResolver } from '../features/feature-resolver.service';
import { SqsQueueService } from './sqs-queue.service';
import { FeatureKey } from '@rms/contracts';
import { ExecutionContext } from '../observability/execution-context';
import { randomBytes } from 'crypto';

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const DRAIN_TIMEOUT_MS = 30_000;
const INSTANCE_ID = randomBytes(8).toString('hex');
const LEASE_SECONDS = 120;
const HEARTBEAT_MS = 20_000;

type EventHandler = (event: OutboxEventRecord) => Promise<void>;

export interface OutboxScope {
  tenantId: string;
  branchIds?: string[];
}

// Raw query result type — includes new fields not yet in Prisma client
export interface OutboxEventRecord {
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
 * - At-least-once delivery; domain handlers must deduplicate their effects
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
    ['menu.image.process_requested', this.handleMenuImageRequested.bind(this)],
    // Future handlers registered here as features are implemented
  ]);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(KitchenTicketsService)
    private readonly kitchenTickets: KitchenTicketsService,
    @Inject(FeatureResolver)
    private readonly featureResolver: FeatureResolver,
    @Inject(SqsQueueService)
    private readonly sqs: SqsQueueService,
  ) {}

  onModuleInit() {
    this.start();
  }

  registerHandler(eventType: string, handler: EventHandler) {
    if (this.handlers.has(eventType)) throw new Error(`Outbox handler already registered: ${eventType}`);
    this.handlers.set(eventType, handler);
  }

  onModuleDestroy() {
    return this.stop();
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

    // A deadline checked before an unbounded await is not a timeout. Race the
    // actual drain against a timer so a stuck handler cannot block shutdown.
    if (this.activeWork.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([...this.activeWork]),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, DRAIN_TIMEOUT_MS); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    if (this.activeWork.length > 0) {
      this.logger.warn(`${this.activeWork.length} outbox tasks still active after drain timeout`);
    }

    this.logger.log('Outbox processor stopped');
  }

  async poll(force = false) {
    if (!force && this.draining) return;

    try {
      const claimId = `${INSTANCE_ID}:${randomBytes(8).toString('hex')}`;
      // Select and claim in one statement: a standalone SELECT would release
      // its row locks before a subsequent UPDATE and allow duplicate claims.
      const events = await this.prisma.$queryRaw<OutboxEventRecord[]>`
        WITH expired_exhausted AS (
          UPDATE "OutboxEvent"
          SET "status" = 'DEAD_LETTER', "lastError" = 'Processing lease expired after maximum recovery attempts',
              "lockedBy" = NULL, "lockedAt" = NULL
          WHERE "publishedAt" IS NULL AND "status" = 'PROCESSING'
            AND "attemptCount" >= ${MAX_ATTEMPTS}
            AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - ${LEASE_SECONDS} * INTERVAL '1 second')
          RETURNING "id"
        ), candidates AS (
          SELECT "id"
          FROM "OutboxEvent"
          WHERE "publishedAt" IS NULL
            AND "attemptCount" < ${MAX_ATTEMPTS}
            AND ("status" IS NULL OR "status" = 'PENDING' OR "status" = 'RETRY'
              OR ("status" = 'PROCESSING' AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - ${LEASE_SECONDS} * INTERVAL '1 second')))
            AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW())
          ORDER BY "occurredAt" ASC, "id" ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "OutboxEvent" AS event
        SET "attemptCount" = event."attemptCount" + CASE WHEN event."status" = 'PROCESSING' THEN 1 ELSE 0 END,
            "status" = 'PROCESSING', "lockedBy" = ${claimId}, "lockedAt" = NOW()
        FROM candidates
        WHERE event."id" = candidates."id"
        RETURNING event.*
      `;

      if (events.length === 0) return;

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
    // The random claim token fences all completion/retry writes. A processor
    // that resumes after another consumer recovers its lease cannot overwrite it.
    const heartbeat = setInterval(() => {
      void this.prisma.$executeRaw`
        UPDATE "OutboxEvent" SET "lockedAt" = NOW()
        WHERE "id" = ${event.id} AND "status" = 'PROCESSING' AND "lockedBy" = ${event.lockedBy}
      `.catch((error: unknown) => this.logger.error(`Outbox heartbeat failed for ${event.id}: ${String(error)}`));
    }, HEARTBEAT_MS);
    heartbeat.unref();
    try {
      await this.processClaimedEvent(event);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async processClaimedEvent(event: OutboxEventRecord) {
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
        WHERE "id" = ${event.id} AND "status" = 'PROCESSING' AND "lockedBy" = ${event.lockedBy}
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
          WHERE "id" = ${event.id} AND "status" = 'PROCESSING' AND "lockedBy" = ${event.lockedBy}
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
            WHERE "id" = ${event.id} AND "status" = 'PROCESSING' AND "lockedBy" = ${event.lockedBy}
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
            WHERE "id" = ${event.id} AND "status" = 'PROCESSING' AND "lockedBy" = ${event.lockedBy}
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
   * Publishes a menu image processing job to SQS. The message body is only a
   * pointer (mediaObjectId); the worker derives every tenant/item association
   * from the database record it loads by that id.
   */
  private async handleMenuImageRequested(event: OutboxEventRecord) {
    const payload = event.payload as { mediaObjectId?: string };
    if (typeof payload?.mediaObjectId !== 'string' || !payload.mediaObjectId) {
      throw new Error('menu.image.process_requested payload is missing mediaObjectId');
    }
    await this.sqs.send({ mediaObjectId: payload.mediaObjectId });
  }

  /**
   * Get outbox statistics for admin inspection.
   */
  async getStats(scope: OutboxScope): Promise<Record<string, number>> {
    const stats = await this.prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT COALESCE("status", 'PENDING') as "status", COUNT(*) as "count"
      FROM "OutboxEvent"
      WHERE "tenantId" = ${scope.tenantId}
        AND (${scope.branchIds === undefined} OR "branchId" = ANY(${scope.branchIds ?? []}::text[]))
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
  async getDeadLetterEvents(scope: OutboxScope, limit = 50): Promise<unknown[]> {
    return this.prisma.$queryRaw`
      SELECT * FROM "OutboxEvent"
      WHERE "status" = 'DEAD_LETTER'
        AND "tenantId" = ${scope.tenantId}
        AND (${scope.branchIds === undefined} OR "branchId" = ANY(${scope.branchIds ?? []}::text[]))
      ORDER BY "occurredAt" DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Manually retry a dead-letter event (admin action).
   */
  async retryDeadLetter(scope: OutboxScope, eventId: string, actorUserId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const where = {
        id: eventId, tenantId: scope.tenantId,
        ...(scope.branchIds === undefined ? {} : { branchId: { in: scope.branchIds } }),
      };
      const event = await tx.outboxEvent.findFirst({ where });
      if (!event) throw new NotFoundException('Outbox event not found');
      if (event.status !== 'DEAD_LETTER') throw new ConflictException('Event is not in DEAD_LETTER state');
      const result = await tx.outboxEvent.updateMany({
        where: { ...where, status: 'DEAD_LETTER' },
        data: { status: 'RETRY', attemptCount: 0, lastError: null, nextRetryAt: null, lockedBy: null, lockedAt: null },
      });
      if (result.count !== 1) throw new ConflictException('Event was already retried');
      await tx.auditLog.create({
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
    });

    this.logger.log(`Event ${eventId} queued for retry by ${actorUserId}`);
  }
}
