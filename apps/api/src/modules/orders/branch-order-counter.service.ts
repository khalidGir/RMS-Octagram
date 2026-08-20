import { Injectable } from '@nestjs/common';

/**
 * Atomic order number generation using BranchOrderCounter.
 *
 * Contract:
 * - First order number for a branch: 1
 * - Every allocation increments atomically
 * - Rolled-back transactions do not consume committed numbers
 * - No MAX(orderNumber) fallback
 */
@Injectable()
export class BranchOrderCounterService {
  /**
   * Allocate the next order number for a branch.
   * Uses atomic SQL UPDATE + RETURNING to prevent race conditions.
   * Accepts any Prisma transaction client (tx from $transaction callback).
   */
  async nextOrderNumber(tx: any, branchId: string): Promise<bigint> {
    const result = await tx.$queryRaw<{ lastNumber: bigint }[]>`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 1, now(), now())
      ON CONFLICT ("branchId") DO UPDATE
      SET "lastNumber" = "BranchOrderCounter"."lastNumber" + 1,
          "updatedAt" = now()
      RETURNING "lastNumber"
    `;

    return result[0].lastNumber;
  }
}
