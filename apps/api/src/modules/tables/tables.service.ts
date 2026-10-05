import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

export interface QrTokenRotation {
  tableId: string;
  label: string;
  raw: string;
  version: number;
}

@Injectable()
export class TablesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Confirm branch belongs to tenant and is active */
  private async assertBranchOwnership(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId, isActive: true } });
    if (!branch) throw new NotFoundException('Branch not found or inactive');
    return branch;
  }

  // ─── Dining Areas ──────────────────────────

  async listDiningAreas(tenantId: string, branchId: string) {
    await this.assertBranchOwnership(tenantId, branchId);
    return this.prisma.diningArea.findMany({
      where: { tenantId, branchId },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { tables: true } } },
    });
  }

  async createDiningArea(tenantId: string, branchId: string, data: { name: string; sortOrder?: number }) {
    await this.assertBranchOwnership(tenantId, branchId);
    return this.prisma.diningArea.create({
      data: {
        tenantId,
        branchId,
        name: data.name,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateDiningArea(areaId: string, tenantId: string, branchId: string, data: { name?: string; sortOrder?: number }) {
    const area = await this.prisma.diningArea.findFirst({ where: { id: areaId, tenantId, branchId } });
    if (!area) throw new NotFoundException('Dining area not found');
    return this.prisma.diningArea.update({ where: { id: areaId }, data });
  }

  // ─── Tables ────────────────────────────────

  async listTables(tenantId: string, branchId: string, diningAreaId?: string) {
    await this.assertBranchOwnership(tenantId, branchId);
    const where: any = { tenantId, branchId };
    if (diningAreaId) where.diningAreaId = diningAreaId;
    return this.prisma.restaurantTable.findMany({
      where,
      orderBy: { label: 'asc' },
      include: { diningArea: { select: { id: true, name: true } } },
    });
  }

  async getTable(tableId: string, tenantId: string, branchId: string) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: tableId, tenantId, branchId },
      include: { diningArea: { select: { id: true, name: true } } },
    });
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  async createTable(tenantId: string, branchId: string, data: { label: string; capacity: number; diningAreaId?: string }) {
    await this.assertBranchOwnership(tenantId, branchId);

    if (data.diningAreaId) {
      const area = await this.prisma.diningArea.findFirst({ where: { id: data.diningAreaId, tenantId, branchId } });
      if (!area) throw new NotFoundException('Dining area not found');
    }

    // Create table and QR token in a transaction; return raw token once
    const result = await this.prisma.$transaction(async (tx) => {
      const table = await tx.restaurantTable.create({
        data: { tenantId, branchId, label: data.label, capacity: data.capacity, diningAreaId: data.diningAreaId },
      });

      const raw = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      const count = await tx.tableQrToken.count({ where: { tableId: table.id } });

      await tx.tableQrToken.create({
        data: {
          tenantId,
          branchId,
          tableId: table.id,
          tokenHash,
          version: count + 1,
        },
      });

      return { table, raw };
    });

    const full = await this.getTable(result.table.id, tenantId, branchId);
    return { ...full, qrTokenRaw: result.raw };
  }

  async updateTable(tableId: string, tenantId: string, branchId: string, data: { label?: string; capacity?: number; diningAreaId?: string; isActive?: boolean }) {
    const table = await this.prisma.restaurantTable.findFirst({ where: { id: tableId, tenantId, branchId } });
    if (!table) throw new NotFoundException('Table not found');
    if (data.diningAreaId) {
      const area = await this.prisma.diningArea.findFirst({ where: { id: data.diningAreaId, tenantId, branchId } });
      if (!area) throw new NotFoundException('Dining area not found');
    }
    return this.prisma.restaurantTable.update({ where: { id: tableId }, data });
  }

  // ─── QR Token Generation / Rotation ────────

  private static readonly MAX_QR_RETRIES = 3;
  private static readonly MAX_BATCH_TABLES = 100;

  /**
   * Rotate one table's QR token inside the caller's transaction.
   *
   * The plaintext token is returned exactly once so the caller can render or
   * print it; only its SHA-256 hash is persisted. All previously active
   * tokens for the table are revoked in the same transaction, so a printed
   * code stops working the moment a rotation commits.
   */
  private async rotateTokenInTx(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      branchId: string;
      tableId: string;
      reason?: string;
      actorUserId?: string;
      batch?: boolean;
    },
  ): Promise<{ raw: string; version: number }> {
    const { tenantId, branchId, tableId, reason, actorUserId, batch } = params;

    // Lock existing tokens for this table to prevent concurrent version races.
    // If no rows exist, the lock is a no-op — the unique index catches races.
    const locked = await tx.$queryRaw<{ version: number }[]>`
      SELECT version FROM "TableQrToken"
      WHERE "tableId" = ${tableId}
      ORDER BY version DESC
      LIMIT 1
      FOR UPDATE
    `;

    const nextVersion = (locked[0]?.version ?? 0) + 1;

    const raw = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

    // Revoke all active tokens for this table
    await tx.tableQrToken.updateMany({
      where: { tableId, tenantId, branchId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = await tx.tableQrToken.create({
      data: {
        tenantId,
        branchId,
        tableId,
        tokenHash,
        version: nextVersion,
      },
    });

    // Audit written via tx client so failure rolls back the rotation.
    // The raw token is never part of the audit payload — only its version.
    await tx.auditLog.create({
      data: {
        actorUserId: actorUserId || null,
        tenantId,
        branchId,
        action: 'QR_TOKEN_ROTATE',
        entityType: 'TableQrToken',
        entityId: token.id,
        afterJson: { tableId, branchId, version: nextVersion, reason, ...(batch ? { batch: true } : {}) },
      },
    });

    return { raw, version: nextVersion };
  }

  async generateQrToken(tableId: string, tenantId: string, branchId: string, reason?: string, actorUserId?: string) {
    const table = await this.prisma.restaurantTable.findFirst({ where: { id: tableId, tenantId, branchId } });
    if (!table) throw new NotFoundException('Table not found');

    // Retry loop: FOR UPDATE locks existing rows, but the first-token case
    // (no rows) cannot be locked. Concurrent first-token creates race on the
    // unique (tableId, version) index. We retry on conflict.
    for (let attempt = 1; attempt <= TablesService.MAX_QR_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) =>
          this.rotateTokenInTx(tx, { tenantId, branchId, tableId, reason, actorUserId }),
        );

        return {
          raw: result.raw,
          version: result.version,
          tableId,
          branchId,
        };
      } catch (error: any) {
        // P2002 = Prisma unique constraint violation (code from PostgreSQL)
        if (error?.code === 'P2002' && attempt < TablesService.MAX_QR_RETRIES) {
          continue; // Retry on version collision
        }
        if (error?.code === 'P2002') {
          throw new ConflictException('QR token rotation failed: version collision after retries');
        }
        throw error;
      }
    }

    throw new ConflictException('QR token rotation failed after retries');
  }

  /**
   * Rotate QR tokens for a selected set of tables in ONE transaction.
   *
   * Plaintext tokens cannot be reconstructed from stored hashes, so batch
   * printing necessarily issues fresh tokens: the batch either fully succeeds
   * (all previous codes for those tables stop working) or fully rolls back.
   * Raw tokens are returned exactly once and are never persisted or audited.
   */
  async generateQrTokenBatch(params: {
    tableIds: string[];
    tenantId: string;
    branchId: string;
    reason?: string;
    actorUserId?: string;
  }): Promise<QrTokenRotation[]> {
    const { tenantId, branchId, reason, actorUserId } = params;
    await this.assertBranchOwnership(tenantId, branchId);

    const tableIds = [...new Set(params.tableIds)];
    if (tableIds.length === 0) {
      throw new BadRequestException('Select at least one table');
    }
    if (tableIds.length > TablesService.MAX_BATCH_TABLES) {
      throw new BadRequestException(`At most ${TablesService.MAX_BATCH_TABLES} tables per batch`);
    }

    const tables = await this.prisma.restaurantTable.findMany({
      where: { id: { in: tableIds }, tenantId, branchId },
      select: { id: true, label: true },
    });
    if (tables.length !== tableIds.length) {
      // Do not reveal which ids belong to another tenant or branch.
      throw new NotFoundException('One or more selected tables were not found');
    }
    const byId = new Map(tables.map((t) => [t.id, t]));
    const ordered = tableIds.map((id) => byId.get(id)!);

    for (let attempt = 1; attempt <= TablesService.MAX_QR_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const rotated: QrTokenRotation[] = [];
          for (const table of ordered) {
            const { raw, version } = await this.rotateTokenInTx(tx, {
              tenantId,
              branchId,
              tableId: table.id,
              reason,
              actorUserId,
              batch: true,
            });
            rotated.push({ tableId: table.id, label: table.label, raw, version });
          }
          return rotated;
        });
      } catch (error: any) {
        if (error?.code === 'P2002' && attempt < TablesService.MAX_QR_RETRIES) {
          continue; // Whole batch rolls back; retry from scratch
        }
        if (error?.code === 'P2002') {
          throw new ConflictException('QR token batch rotation failed: version collision after retries');
        }
        throw error;
      }
    }

    throw new ConflictException('QR token batch rotation failed after retries');
  }

  /** Restaurant/branch identity needed to compose table QR cards and the short fallback link. */
  async getQrBranding(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, isActive: true },
      select: { name: true, publicSlug: true, tenant: { select: { name: true } } },
    });
    if (!branch) throw new NotFoundException('Branch not found or inactive');
    return {
      restaurantName: branch.tenant.name,
      branchName: branch.name,
      publicSlug: branch.publicSlug,
    };
  }

  async getActiveToken(tableId: string, tenantId: string, branchId: string) {
    const token = await this.prisma.tableQrToken.findFirst({
      where: { tableId, tenantId, branchId, revokedAt: null },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, createdAt: true, expiresAt: true },
    });
    if (!token) throw new NotFoundException('No active QR token for this table');
    return token;
  }

  async listTokens(tableId: string, tenantId: string, branchId: string) {
    return this.prisma.tableQrToken.findMany({
      where: { tableId, tenantId, branchId },
      orderBy: { version: 'desc' },
      take: 10,
      select: { id: true, version: true, revokedAt: true, createdAt: true },
    });
  }
}
