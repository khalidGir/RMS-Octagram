import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async generateQrToken(tableId: string, tenantId: string, branchId: string, reason?: string, actorUserId?: string) {
    const table = await this.prisma.restaurantTable.findFirst({ where: { id: tableId, tenantId, branchId } });
    if (!table) throw new NotFoundException('Table not found');

    // Concurrency-safe: use raw SQL SELECT ... FOR UPDATE to lock the latest row,
    // then allocate version = locked.version + 1. For the first token (no rows),
    // the lock still serializes correctly.
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock existing tokens for this table to prevent concurrent version races
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

      // Audit inside transaction — if rotation fails, audit is not committed
      await this.audit.log({
        actorUserId: actorUserId ?? null as any,
        tenantId,
        branchId,
        action: 'QR_TOKEN_ROTATE',
        entityType: 'TableQrToken',
        entityId: token.id,
        after: { tableId, branchId, version: nextVersion, reason },
      });

      return { raw, token, version: nextVersion };
    });

    return {
      raw: result.raw,
      version: result.version,
      tableId,
      branchId,
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
