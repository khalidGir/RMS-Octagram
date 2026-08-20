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
    // Atomic: increment lastNumber and return the new value
    const result = await tx.$queryRaw<{ lastNumber: bigint }[]>`
      UPDATE "BranchOrderCounter"
      SET "lastNumber" = "lastNumber" + 1,
          "updatedAt" = now()
      WHERE "branchId" = ${branchId}
      RETURNING "lastNumber"
    `;

    if (result.length > 0) {
      return result[0].lastNumber;
    }

    // First order for this branch: insert with lastNumber=1
    // Use ON CONFLICT to handle race where another process inserted first
    await tx.$executeRaw`
      INSERT INTO "BranchOrderCounter" ("branchId", "lastNumber", "createdAt", "updatedAt")
      VALUES (${branchId}, 1, now(), now())
      ON CONFLICT ("branchId") DO NOTHING
    `;

    // Re-read to get the correct value
    const retry = await tx.$queryRaw<{ lastNumber: bigint }[]>`
      SELECT "lastNumber"
      FROM "BranchOrderCounter"
      WHERE "branchId" = ${branchId}
    `;

    return retry[0]?.lastNumber ?? 1n;
  }
}
