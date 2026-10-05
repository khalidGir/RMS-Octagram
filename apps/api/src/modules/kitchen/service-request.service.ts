import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { DiningSessionStatus, ServiceRequestStatus, SERVICE_REQUEST_ERRORS } from '@rms/contracts';
import type { ServiceRequestType } from '@rms/contracts';
import type { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { KdsGateway } from './kds.gateway';

const DEFAULT_ASSISTANCE_ESCALATION_SECONDS = 180;
const ACTIVE_STATUSES: string[] = [
  ServiceRequestStatus.OPEN,
  ServiceRequestStatus.CLAIMED,
  ServiceRequestStatus.ESCALATED,
];

type ServiceRequestRecord = Prisma.ServiceRequestGetPayload<{
  include: { table: { select: { label: true } }; order: { select: { orderNumber: true } } };
}>;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * Customer-initiated table assistance requests (call waiter / request bill).
 *
 * Creation trusts only a raw QR token: tenant, branch and table are resolved
 * server-side. A request requires the table's OPEN dining session (opened by a
 * confirmed dine-in order), inherits the session's assigned waiter when set,
 * and is guarded by one-open-request-per-type-per-session at the database level.
 */
@Injectable()
export class ServiceRequestService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KdsGateway) private readonly kdsGateway: KdsGateway,
  ) {}

  async createFromToken(params: {
    qrToken: string;
    type: ServiceRequestType;
    note?: string;
    idempotencyKey?: string;
  }): Promise<{ request: Record<string, unknown>; created: boolean; alreadyOpen: boolean }> {
    const { tenantId, branchId, tableId } = await this.resolveTableToken(params.qrToken);

    // Idempotent replay: same key returns the same request.
    if (params.idempotencyKey) {
      const replay = await this.findScoped({
        tenantId,
        branchId,
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (replay) {
        return {
          request: this.serialize(replay, false),
          created: false,
          alreadyOpen: ACTIVE_STATUSES.includes(replay.status),
        };
      }
    }

    const session = await this.prisma.diningSession.findFirst({
      where: { tenantId, branchId, tableId, status: DiningSessionStatus.OPEN },
      orderBy: { openedAt: 'desc' },
    });
    if (!session) {
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.NO_ACTIVE_SESSION,
        message: 'No active dining session for this table. Place an order first.',
      });
    }

    const existingOpen = await this.prisma.serviceRequest.findFirst({
      where: {
        tenantId,
        branchId,
        diningSessionId: session.id,
        type: params.type,
        status: { in: ACTIVE_STATUSES },
      },
    });
    if (existingOpen) {
      return { request: this.serialize(existingOpen, false), created: false, alreadyOpen: true };
    }

    const openOrder = await this.prisma.order.findFirst({
      where: { diningSessionId: session.id, status: { notIn: ['COMPLETED', 'CANCELLED', 'VOIDED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    let created: ServiceRequestRecord;
    try {
      created = await this.prisma.serviceRequest.create({
        data: {
          tenantId,
          branchId,
          tableId,
          diningSessionId: session.id,
          orderId: openOrder?.id ?? null,
          type: params.type,
          note: params.note?.trim() || null,
          assignedWaiterUserId: session.assignedWaiterUserId ?? null,
          idempotencyKey: params.idempotencyKey ?? crypto.randomUUID(),
        },
        include: { table: { select: { label: true } }, order: { select: { orderNumber: true } } },
      });
    } catch (error) {
      // Concurrent duplicate: the partial unique index (one open request of a
      // type per session) or the idempotency key may have been claimed first.
      if (!isUniqueViolation(error)) throw error;
      if (params.idempotencyKey) {
        const replay = await this.findScoped({ tenantId, branchId, where: { idempotencyKey: params.idempotencyKey } });
        if (replay) {
          return {
            request: this.serialize(replay, false),
            created: false,
            alreadyOpen: ACTIVE_STATUSES.includes(replay.status),
          };
        }
      }
      const concurrent = await this.prisma.serviceRequest.findFirst({
        where: { tenantId, branchId, diningSessionId: session.id, type: params.type, status: { in: ACTIVE_STATUSES } },
      });
      if (concurrent) return { request: this.serialize(concurrent, false), created: false, alreadyOpen: true };
      throw error;
    }

    this.kdsGateway.broadcastToServiceBoard(branchId, 'service_request:created', {
      requestId: created.id,
      type: created.type,
      tableLabel: created.table?.label ?? null,
    });

    return { request: this.serialize(created, false), created: true, alreadyOpen: false };
  }

  async getTableRequests(qrToken: string): Promise<{ requests: Array<Record<string, unknown>> }> {
    const { tenantId, branchId, tableId } = await this.resolveTableToken(qrToken);
    const session = await this.prisma.diningSession.findFirst({
      where: { tenantId, branchId, tableId, status: DiningSessionStatus.OPEN },
      orderBy: { openedAt: 'desc' },
    });
    if (!session) return { requests: [] };

    await this.escalateBranch(tenantId, branchId);

    const rows = await this.prisma.serviceRequest.findMany({
      where: { tenantId, branchId, diningSessionId: session.id, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'asc' },
    });
    return { requests: rows.map((row) => this.serialize(row, false)) };
  }

  async listBranchRequests(params: {
    tenantId: string;
    branchId: string;
    status?: string;
    limit?: number;
  }): Promise<Array<Record<string, unknown>>> {
    await this.escalateBranch(params.tenantId, params.branchId);

    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        tenantId: params.tenantId,
        branchId: params.branchId,
        status: params.status ? params.status : { in: ACTIVE_STATUSES },
      },
      include: { table: { select: { label: true } }, order: { select: { orderNumber: true } } },
      orderBy: { createdAt: 'asc' },
      take: params.limit ?? 50,
    });
    return rows.map((row) => this.serialize(row, true));
  }

  async claim(params: {
    tenantId: string;
    branchId: string;
    requestId: string;
    actorUserId: string;
    actorRole: string;
    expectedVersion: number;
  }): Promise<Record<string, unknown>> {
    const request = await this.requireRequest(params.tenantId, params.branchId, params.requestId);

    if (request.status === ServiceRequestStatus.CLAIMED) {
      // Duplicate claim by the same waiter is idempotent.
      if (request.claimedByUserId === params.actorUserId) return this.serialize(request, true);
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.REQUEST_ALREADY_CLAIMED,
        message: 'Service request has already been claimed by another waiter.',
        currentVersion: request.version,
      });
    }
    if (
      request.status !== ServiceRequestStatus.OPEN &&
      request.status !== ServiceRequestStatus.ESCALATED
    ) {
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_CLAIMABLE,
        message: `Service request cannot be claimed from status ${request.status}.`,
        currentVersion: request.version,
      });
    }
    if (
      params.actorRole === 'WAITER' &&
      request.assignedWaiterUserId &&
      request.assignedWaiterUserId !== params.actorUserId
    ) {
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.REQUEST_ASSIGNED_OTHER,
        message: 'Service request is assigned to another waiter.',
        currentVersion: request.version,
      });
    }

    await this.transition({
      ...params,
      from: [ServiceRequestStatus.OPEN, ServiceRequestStatus.ESCALATED],
      to: ServiceRequestStatus.CLAIMED,
      action: 'SERVICE_REQUEST_CLAIM',
      data: { claimedByUserId: params.actorUserId, claimedAt: new Date() },
    });

    const updated = await this.requireRequest(params.tenantId, params.branchId, params.requestId);
    return this.serialize(updated, true);
  }

  async resolve(params: {
    tenantId: string;
    branchId: string;
    requestId: string;
    actorUserId: string;
    actorRole: string;
    expectedVersion: number;
  }): Promise<Record<string, unknown>> {
    const request = await this.requireRequest(params.tenantId, params.branchId, params.requestId);

    // Duplicate resolve is idempotent.
    if (request.status === ServiceRequestStatus.RESOLVED) return this.serialize(request, true);
    if (request.status !== ServiceRequestStatus.CLAIMED) {
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_RESOLVABLE,
        message: `Service request must be claimed before it can be resolved (status: ${request.status}).`,
        currentVersion: request.version,
      });
    }
    if (params.actorRole === 'WAITER' && request.claimedByUserId !== params.actorUserId) {
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_YOURS,
        message: 'Only the waiter who claimed this request can resolve it.',
        currentVersion: request.version,
      });
    }

    await this.transition({
      ...params,
      from: [ServiceRequestStatus.CLAIMED],
      to: ServiceRequestStatus.RESOLVED,
      action: 'SERVICE_REQUEST_RESOLVE',
      data: { resolvedAt: new Date() },
    });

    const updated = await this.requireRequest(params.tenantId, params.branchId, params.requestId);
    return this.serialize(updated, true);
  }

  async cancel(params: {
    tenantId: string;
    branchId: string;
    requestId: string;
    actorUserId: string;
    actorRole: string;
    expectedVersion: number;
  }): Promise<Record<string, unknown>> {
    const request = await this.requireRequest(params.tenantId, params.branchId, params.requestId);

    // Duplicate cancel is idempotent.
    if (request.status === ServiceRequestStatus.CANCELLED) return this.serialize(request, true);
    if (request.status === ServiceRequestStatus.RESOLVED) {
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_CANCELLABLE,
        message: 'A resolved service request cannot be cancelled.',
        currentVersion: request.version,
      });
    }
    if (
      params.actorRole === 'WAITER' &&
      request.claimedByUserId !== params.actorUserId &&
      request.assignedWaiterUserId !== params.actorUserId
    ) {
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_YOURS,
        message: 'Only the claiming or assigned waiter can cancel this request.',
        currentVersion: request.version,
      });
    }

    await this.transition({
      ...params,
      from: [ServiceRequestStatus.OPEN, ServiceRequestStatus.CLAIMED, ServiceRequestStatus.ESCALATED],
      to: ServiceRequestStatus.CANCELLED,
      action: 'SERVICE_REQUEST_CANCEL',
      data: { cancelledAt: new Date() },
    });

    const updated = await this.requireRequest(params.tenantId, params.branchId, params.requestId);
    return this.serialize(updated, true);
  }

  /**
   * Escalate overdue OPEN requests for one branch. Uses the branch policy
   * threshold (default 180s) and bumps the optimistic version so concurrent
   * claimers observe the conflict.
   */
  async escalateBranch(tenantId: string, branchId: string): Promise<number> {
    const policy = await this.prisma.branchFulfillmentPolicy.findUnique({
      where: { branchId },
      select: { assistanceEscalationSeconds: true },
    });
    const threshold = policy?.assistanceEscalationSeconds ?? DEFAULT_ASSISTANCE_ESCALATION_SECONDS;
    const cutoff = new Date(Date.now() - threshold * 1000);

    const result = await this.prisma.serviceRequest.updateMany({
      where: { tenantId, branchId, status: ServiceRequestStatus.OPEN, createdAt: { lt: cutoff } },
      data: { status: ServiceRequestStatus.ESCALATED, escalatedAt: new Date(), version: { increment: 1 } },
    });

    if (result.count > 0) {
      this.kdsGateway.broadcastToServiceBoard(branchId, 'service_request:escalated', {
        branchId,
        count: result.count,
      });
    }
    return result.count;
  }

  /** Escalate overdue requests across every branch that has OPEN requests. */
  async escalateAllOverdue(): Promise<number> {
    const branches = await this.prisma.serviceRequest.findMany({
      where: { status: ServiceRequestStatus.OPEN },
      select: { tenantId: true, branchId: true },
      distinct: ['branchId'],
      take: 500,
    });
    let total = 0;
    for (const branch of branches) {
      total += await this.escalateBranch(branch.tenantId, branch.branchId);
    }
    return total;
  }

  private async resolveTableToken(qrToken: string): Promise<{ tenantId: string; branchId: string; tableId: string }> {
    const tokenHash = crypto.createHash('sha256').update(qrToken).digest('hex');
    const record = await this.prisma.tableQrToken.findUnique({
      where: { tokenHash },
      include: { table: { select: { id: true, branchId: true, tenantId: true, isActive: true } } },
    });

    if (!record) throw new NotFoundException('Invalid QR token');
    if (record.revokedAt) throw new BadRequestException('QR token has been revoked');
    if (record.expiresAt && record.expiresAt < new Date()) throw new BadRequestException('QR token has expired');
    if (!record.table.isActive) throw new BadRequestException('Table is not active');
    // Defense in depth: token's tenant/branch must match the table's relations.
    if (record.table.tenantId !== record.tenantId || record.table.branchId !== record.branchId) {
      throw new BadRequestException('QR token does not match table context');
    }

    return { tenantId: record.table.tenantId, branchId: record.table.branchId, tableId: record.table.id };
  }

  private async findScoped(params: {
    tenantId: string;
    branchId: string;
    where: Prisma.ServiceRequestWhereInput;
  }): Promise<ServiceRequestRecord | null> {
    return this.prisma.serviceRequest.findFirst({
      where: { tenantId: params.tenantId, branchId: params.branchId, ...params.where },
      include: { table: { select: { label: true } }, order: { select: { orderNumber: true } } },
    });
  }

  private async requireRequest(tenantId: string, branchId: string, requestId: string): Promise<ServiceRequestRecord> {
    const request = await this.prisma.serviceRequest.findFirst({
      where: { id: requestId, tenantId, branchId },
      include: { table: { select: { label: true } }, order: { select: { orderNumber: true } } },
    });
    if (!request) throw new NotFoundException('Service request not found');
    return request;
  }

  private async transition(params: {
    tenantId: string;
    branchId: string;
    requestId: string;
    actorUserId: string;
    expectedVersion: number;
    from: string[];
    to: string;
    action: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    const { tenantId, branchId, requestId, actorUserId, expectedVersion, from, to, action, data } = params;

    const current = await this.requireRequest(tenantId, branchId, requestId);
    if (current.version !== expectedVersion) {
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.VERSION_CONFLICT,
        message: 'Service request has been modified. Please refresh.',
        currentVersion: current.version,
      });
    }

    const result = await this.prisma.serviceRequest.updateMany({
      where: { id: requestId, tenantId, branchId, version: expectedVersion, status: { in: from } },
      data: { status: to, version: { increment: 1 }, ...data },
    });
    if (result.count === 0) {
      const latest = await this.requireRequest(tenantId, branchId, requestId);
      throw new ConflictException({
        code: SERVICE_REQUEST_ERRORS.VERSION_CONFLICT,
        message: 'Service request has been modified. Please refresh.',
        currentVersion: latest.version,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        tenantId,
        branchId,
        action,
        entityType: 'ServiceRequest',
        entityId: requestId,
        afterJson: { status: to, ...data },
      },
    });
  }

  private serialize(
    row: Omit<ServiceRequestRecord, 'table' | 'order'> & Partial<Pick<ServiceRequestRecord, 'table' | 'order'>>,
    staff: boolean,
  ): Record<string, unknown> {
    const base = {
      id: row.id,
      type: row.type,
      status: row.status,
      createdAt: row.createdAt,
    };
    if (!staff) return base;
    return {
      ...base,
      note: row.note,
      tableLabel: row.table?.label ?? null,
      orderNumber: row.order?.orderNumber != null ? Number(row.order.orderNumber) : null,
      assignedWaiterUserId: row.assignedWaiterUserId,
      claimedByUserId: row.claimedByUserId,
      version: row.version,
      claimedAt: row.claimedAt,
      resolvedAt: row.resolvedAt,
      cancelledAt: row.cancelledAt,
      escalatedAt: row.escalatedAt,
      updatedAt: row.updatedAt,
    };
  }
}
