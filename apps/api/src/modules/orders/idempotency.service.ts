import { Injectable, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { canonicalStringify } from '@rms/contracts';
import * as crypto from 'crypto';

/**
 * Idempotency service using reserve-before-execute pattern.
 *
 * Flow:
 * 1. Attempt atomic reserve (INSERT ... ON CONFLICT)
 * 2. If insert succeeds → new reservation, proceed to execute handler
 * 3. If conflict → read existing record:
 *    a. Same hash + completed → return stored result (replay)
 *    b. Same hash + in-progress → 409 Conflict
 *    c. Different hash → 409 Conflict
 *    d. Expired reservation → delete and retry atomic reserve
 * 4. Execute handler → store result with tracking token for replay
 * 5. Failed handler → expire reservation immediately (allow retry)
 *
 * Concurrency: concurrent identical requests get 409 while first is in progress.
 * Replay: completed responses include raw tracking token for client replay.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async withIdempotency<T extends { status: number; body: unknown; resourceId?: string }>(
    params: {
      tenantId: string;
      branchId: string | null;
      operation: string;
      key: string;
      requestPayload: unknown;
      ttlMinutes?: number;
    },
    handler: () => Promise<T>,
  ): Promise<{ result: T; reused: boolean }> {
    const requestHash = this.canonicalHash(params.requestPayload);
    const expiresAt = new Date(Date.now() + (params.ttlMinutes ?? 60) * 60_000);

    // Atomic reserve: try to insert, catch conflict on partial unique index
    let reservation: { id: string; requestHash: string | null; expiresAt: Date } | null = null;
    let isNew = false;

    try {
      reservation = await this.prisma.idempotencyRecord.create({
        data: {
          tenantId: params.tenantId,
          branchId: params.branchId ?? null,
          operation: params.operation,
          key: params.key,
          requestHash,
          expiresAt,
        },
        select: { id: true, requestHash: true, expiresAt: true },
      });
      isNew = true;
    } catch (error: unknown) {
      // P2002 = unique constraint violation (concurrent insert won the race)
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        // Another request inserted first — read the winning record
        const existing = await this.prisma.idempotencyRecord.findFirst({
          where: {
            tenantId: params.tenantId,
            branchId: params.branchId ?? undefined,
            operation: params.operation,
            key: params.key,
          },
          select: { id: true, requestHash: true, expiresAt: true, responseStatus: true, responseBody: true, resourceId: true },
        });

        if (!existing) {
          // Should not happen — the conflicting record was deleted between insert and read
          throw new ConflictException('Idempotency conflict with no existing record');
        }

        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key reused with different payload');
        }

        if (existing.responseStatus && existing.responseBody) {
          return {
            result: {
              status: existing.responseStatus,
              body: existing.responseBody as Record<string, unknown>,
              resourceId: existing.resourceId ?? undefined,
            } as T,
            reused: true,
          };
        }

        if (existing.expiresAt < new Date()) {
          await this.prisma.idempotencyRecord.delete({ where: { id: existing.id } });
          // After cleanup, fall through to retry reservation below
          reservation = null;
          isNew = false;
        } else {
          throw new ConflictException('Request in progress');
        }
      } else {
        throw error;
      }
    }

    // If we cleaned up an expired reservation, retry the atomic reserve
    if (!reservation) {
      try {
        reservation = await this.prisma.idempotencyRecord.create({
          data: {
            tenantId: params.tenantId,
            branchId: params.branchId ?? null,
            operation: params.operation,
            key: params.key,
            requestHash,
            expiresAt,
          },
          select: { id: true, requestHash: true, expiresAt: true },
        });
        isNew = true;
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2002'
        ) {
          throw new ConflictException('Request in progress');
        }
        throw error;
      }
    }

    if (!isNew) {
      throw new ConflictException('Request in progress');
    }

    // Execute handler — reservation is guaranteed non-null here
    const reservationId = reservation!.id;
    try {
      const result = await handler();

      // Store completed result (includes tracking token for replay)
      await this.prisma.idempotencyRecord.update({
        where: { id: reservationId },
        data: {
          responseStatus: result.status,
          responseBody: result.body as any,
          resourceId: result.resourceId,
        },
      });

      return { result, reused: false };
    } catch (error) {
      // Mark as failed (expire immediately so retry can re-execute)
      await this.prisma.idempotencyRecord.update({
        where: { id: reservationId },
        data: { expiresAt: new Date() },
      });
      throw error;
    }
  }

  private canonicalHash(payload: unknown): string {
    const canonical = canonicalStringify(payload);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}
