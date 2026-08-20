import { Injectable, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { canonicalStringify } from '@rms/contracts';
import * as crypto from 'crypto';

/**
 * Idempotency service using reserve-before-execute pattern.
 *
 * Flow:
 * 1. Check for existing reservation
 * 2. If found with same hash → return stored result
 * 3. If found with different hash → 409 Conflict
 * 4. If not found → reserve key (IN_PROGRESS) → execute handler → store result
 * 5. Failed handler → expire reservation immediately (allow retry)
 *
 * Concurrency: concurrent identical requests get 409 while first is in progress.
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

    // Check for existing reservation
    const existing = await this.prisma.idempotencyRecord.findFirst({
      where: {
        tenantId: params.tenantId,
        branchId: params.branchId ?? undefined,
        operation: params.operation,
        key: params.key,
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('Idempotency key reused with different payload');
      }
      if (existing.responseStatus && existing.responseBody) {
        // Already completed — return stored result
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
        // Expired reservation — clean up and allow re-execution
        await this.prisma.idempotencyRecord.delete({ where: { id: existing.id } });
      } else {
        // In-progress — concurrent request
        throw new ConflictException('Request in progress');
      }
    }

    // Reserve the key before executing handler
    const reservation = await this.prisma.idempotencyRecord.create({
      data: {
        tenantId: params.tenantId,
        branchId: params.branchId ?? null,
        operation: params.operation,
        key: params.key,
        requestHash,
        expiresAt,
      },
    });

    // Execute handler
    try {
      const result = await handler();

      // Store completed result
      await this.prisma.idempotencyRecord.update({
        where: { id: reservation.id },
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
        where: { id: reservation.id },
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
