import { Injectable, Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export interface AuditContext {
  actorUserId: string;
  tenantId?: string;
  branchId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(ctx: AuditContext): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: ctx.actorUserId,
          tenantId: ctx.tenantId ?? null,
          branchId: ctx.branchId ?? null,
          action: ctx.action,
          entityType: ctx.entityType,
          entityId: ctx.entityId ?? null,
          beforeJson: ctx.before as any ?? undefined,
          afterJson: ctx.after as any ?? undefined,
        },
      });
    } catch (error) {
      // Audit failures should not break the request
      this.logger.error(`Audit log failed: ${error}`);
    }
  }
}
