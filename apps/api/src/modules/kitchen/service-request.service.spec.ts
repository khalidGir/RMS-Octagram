import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ServiceRequestService } from './service-request.service';
import { ServiceRequestsController } from './service-requests.controller';
import { SERVICE_REQUEST_ERRORS, ServiceRequestStatus, ServiceRequestType, TenantRole } from '@rms/contracts';

const QR_TOKEN = 'raw-qr-token';

function mockPrisma(overrides: Record<string, any> = {}) {
  const has = (key: string) => key in overrides;
  const mock = {
    tableQrToken: {
      findUnique: vi.fn().mockResolvedValue(has('qrToken') ? overrides.qrToken : null),
    },
    diningSession: {
      findFirst: vi.fn().mockResolvedValue(has('session') ? overrides.session : null),
    },
    order: {
      findFirst: vi.fn().mockResolvedValue(has('openOrder') ? overrides.openOrder : null),
    },
    serviceRequest: {
      findFirst: vi.fn().mockResolvedValue(has('request') ? overrides.request : null),
      findMany: vi.fn().mockResolvedValue(has('requests') ? overrides.requests : []),
      create: vi.fn().mockResolvedValue(
        overrides.created ?? {
          id: 'sr-new', tenantId: 't1', branchId: 'b1', tableId: 'tbl-1', diningSessionId: 'ds-1',
          orderId: null, type: ServiceRequestType.CALL_WAITER, status: ServiceRequestStatus.OPEN,
          note: null, assignedWaiterUserId: 'w-9', claimedByUserId: null, idempotencyKey: 'idem-1',
          version: 1, createdAt: new Date(), claimedAt: null, resolvedAt: null, cancelledAt: null,
          escalatedAt: null, updatedAt: new Date(), table: { label: 'T1' }, order: null,
        },
      ),
      updateMany: vi.fn().mockResolvedValue(has('updateResult') ? overrides.updateResult : { count: 1 }),
    },
    branchFulfillmentPolicy: {
      findUnique: vi.fn().mockResolvedValue(has('policy') ? overrides.policy : null),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
  } as any;
  return mock;
}

function mockGateway() {
  return { broadcastToServiceBoard: vi.fn(), broadcastServiceNotification: vi.fn() } as any;
}

const qrRecord = {
  id: 'tok-1', tokenHash: 'hash', tenantId: 't1', branchId: 'b1',
  revokedAt: null, expiresAt: null,
  table: { id: 'tbl-1', branchId: 'b1', tenantId: 't1', isActive: true },
};

const openSession = {
  id: 'ds-1', tenantId: 't1', branchId: 'b1', tableId: 'tbl-1',
  status: 'OPEN', assignedWaiterUserId: 'w-9', openedAt: new Date(),
};

function baseRequest(overrides: Record<string, any> = {}) {
  return {
    id: 'sr-1', tenantId: 't1', branchId: 'b1', tableId: 'tbl-1', diningSessionId: 'ds-1',
    orderId: 'o-1', type: ServiceRequestType.CALL_WAITER, status: ServiceRequestStatus.OPEN,
    note: null, assignedWaiterUserId: 'w-1', claimedByUserId: null, idempotencyKey: 'idem-1',
    version: 1, createdAt: new Date(), claimedAt: null, resolvedAt: null, cancelledAt: null,
    escalatedAt: null, updatedAt: new Date(), table: { label: 'T1' }, order: { orderNumber: 42 },
    ...overrides,
  };
}

const claimArgs = {
  tenantId: 't1', branchId: 'b1', requestId: 'sr-1',
  actorUserId: 'w-1', actorRole: TenantRole.WAITER, expectedVersion: 1,
};

async function captureError(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe('ServiceRequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createFromToken', () => {
    it('rejects an unknown QR token', async () => {
      const prisma = mockPrisma({ qrToken: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.createFromToken({ qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER }));

      expect(err).toBeInstanceOf(NotFoundException);
    });

    it('rejects a revoked QR token', async () => {
      const prisma = mockPrisma({ qrToken: { ...qrRecord, revokedAt: new Date() } });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.createFromToken({ qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER }));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ message: 'QR token has been revoked' });
    });

    it('rejects an expired QR token', async () => {
      const prisma = mockPrisma({ qrToken: { ...qrRecord, expiresAt: new Date(Date.now() - 1000) } });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.createFromToken({ qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER }));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ message: 'QR token has expired' });
    });

    it('rejects an inactive table', async () => {
      const prisma = mockPrisma({ qrToken: { ...qrRecord, table: { ...qrRecord.table, isActive: false } } });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.createFromToken({ qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER }));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ message: 'Table is not active' });
    });

    it('rejects creation without an open dining session', async () => {
      const prisma = mockPrisma({ qrToken: qrRecord, session: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.createFromToken({ qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER }));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.NO_ACTIVE_SESSION });
      expect(prisma.serviceRequest.create).not.toHaveBeenCalled();
    });

    it('creates a request scoped to the QR table with the session assigned waiter', async () => {
      const prisma = mockPrisma({ qrToken: qrRecord, session: openSession, openOrder: { id: 'o-1' } });
      const gateway = mockGateway();
      const service = new ServiceRequestService(prisma, gateway);

      const result = await service.createFromToken({
        qrToken: QR_TOKEN, type: ServiceRequestType.REQUEST_BILL, note: '  Please hurry  ',
      });

      expect(result.created).toBe(true);
      expect(result.alreadyOpen).toBe(false);
      expect(result.request).toMatchObject({ status: ServiceRequestStatus.OPEN });
      expect(prisma.serviceRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1', branchId: 'b1', tableId: 'tbl-1', diningSessionId: 'ds-1',
            orderId: 'o-1', type: ServiceRequestType.REQUEST_BILL, note: 'Please hurry',
            assignedWaiterUserId: 'w-9',
          }),
        }),
      );
      expect(gateway.broadcastToServiceBoard).toHaveBeenCalledWith(
        'b1', 'service_request:created', expect.objectContaining({ requestId: 'sr-new' }),
      );
    });

    it('returns the existing open request when the same type is already open', async () => {
      const existing = baseRequest();
      const prisma = mockPrisma({ qrToken: qrRecord, session: openSession, request: existing });
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.createFromToken({ qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER });

      expect(result.created).toBe(false);
      expect(result.alreadyOpen).toBe(true);
      expect(result.request).toMatchObject({ id: 'sr-1', status: ServiceRequestStatus.OPEN });
      expect(prisma.serviceRequest.create).not.toHaveBeenCalled();
    });

    it('replays an idempotency key without creating a duplicate', async () => {
      const existing = baseRequest();
      const prisma = mockPrisma({ qrToken: qrRecord, request: existing });
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.createFromToken({
        qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER, idempotencyKey: 'client-key-1',
      });

      expect(result.created).toBe(false);
      expect(result.request).toMatchObject({ id: 'sr-1' });
      expect(prisma.serviceRequest.create).not.toHaveBeenCalled();
      expect(prisma.serviceRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 't1', branchId: 'b1', idempotencyKey: 'client-key-1' }),
        }),
      );
    });

    it('recovers when a concurrent duplicate hits the open-per-type index', async () => {
      const concurrent = baseRequest();
      const prisma = mockPrisma({ qrToken: qrRecord, session: openSession, openOrder: { id: 'o-1' } });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(concurrent);
      prisma.serviceRequest.create.mockRejectedValueOnce(
        Object.assign(new Error('unique violation'), { code: 'P2002' }),
      );
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.createFromToken({ qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER });

      expect(result.created).toBe(false);
      expect(result.alreadyOpen).toBe(true);
      expect(result.request).toMatchObject({ id: 'sr-1' });
    });

    it('creates the request without an order when no open order exists', async () => {
      const prisma = mockPrisma({ qrToken: qrRecord, session: openSession, openOrder: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.createFromToken({ qrToken: QR_TOKEN, type: ServiceRequestType.CALL_WAITER });

      expect(result.created).toBe(true);
      expect(prisma.serviceRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orderId: null }) }),
      );
    });
  });

  describe('getTableRequests', () => {
    it('returns an empty list when the table has no open session', async () => {
      const prisma = mockPrisma({ qrToken: qrRecord, session: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.getTableRequests(QR_TOKEN);

      expect(result.requests).toEqual([]);
    });

    it('escalates overdue requests and returns active requests for the session', async () => {
      const rows = [baseRequest(), baseRequest({ id: 'sr-2', status: ServiceRequestStatus.CLAIMED })];
      const prisma = mockPrisma({
        qrToken: qrRecord, session: openSession, requests: rows,
        policy: { assistanceEscalationSeconds: 300 },
      });
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.getTableRequests(QR_TOKEN);

      expect(result.requests).toHaveLength(2);
      expect(result.requests[0]).toMatchObject({ id: 'sr-1', type: ServiceRequestType.CALL_WAITER });
      // Staff-only fields are never exposed publicly.
      expect(result.requests[0]).not.toHaveProperty('version');
      expect(result.requests[0]).not.toHaveProperty('assignedWaiterUserId');
      expect(result.requests[0]).not.toHaveProperty('tableLabel');
      expect(prisma.serviceRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 't1', branchId: 'b1', status: ServiceRequestStatus.OPEN }),
        }),
      );
    });
  });

  describe('listBranchRequests', () => {
    it('scopes the query to the tenant and branch', async () => {
      const prisma = mockPrisma({ requests: [baseRequest()], policy: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      await service.listBranchRequests({ tenantId: 't1', branchId: 'b1' });

      expect(prisma.serviceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 't1', branchId: 'b1' }),
        }),
      );
    });

    it('returns staff fields including version for the waiter UI', async () => {
      const prisma = mockPrisma({ requests: [baseRequest()], policy: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      const [row] = await service.listBranchRequests({ tenantId: 't1', branchId: 'b1' });

      expect(row).toMatchObject({
        id: 'sr-1', version: 1, tableLabel: 'T1', orderNumber: 42, assignedWaiterUserId: 'w-1',
      });
    });

    it('honours an explicit status filter', async () => {
      const prisma = mockPrisma({ requests: [], policy: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      await service.listBranchRequests({ tenantId: 't1', branchId: 'b1', status: 'RESOLVED', limit: 10 });

      expect(prisma.serviceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'RESOLVED' }),
          take: 10,
        }),
      );
    });
  });

  describe('claim', () => {
    it('denies cross-tenant and cross-branch access (request is tenant+branch scoped)', async () => {
      const prisma = mockPrisma({ request: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.claim(claimArgs));

      expect(err).toBeInstanceOf(NotFoundException);
      expect(prisma.serviceRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'sr-1', tenantId: 't1', branchId: 'b1' }),
        }),
      );
    });

    it('rejects a stale version', async () => {
      const prisma = mockPrisma({ request: baseRequest({ version: 3 }) });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.claim(claimArgs));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({
        code: SERVICE_REQUEST_ERRORS.VERSION_CONFLICT, currentVersion: 3,
      });
      expect(prisma.serviceRequest.updateMany).not.toHaveBeenCalled();
    });

    it('claims an open request with the version guard and audit trail', async () => {
      const open = baseRequest();
      const claimed = baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1', version: 2 });
      const prisma = mockPrisma({ request: open });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(claimed);
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.claim(claimArgs);

      expect(result).toMatchObject({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1', version: 2 });
      expect(prisma.serviceRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'sr-1', tenantId: 't1', branchId: 'b1', version: 1 }),
          data: expect.objectContaining({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1' }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SERVICE_REQUEST_CLAIM', entityId: 'sr-1' }),
        }),
      );
    });

    it('claims an escalated request', async () => {
      const escalated = baseRequest({ status: ServiceRequestStatus.ESCALATED });
      const prisma = mockPrisma({ request: escalated });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(escalated)
        .mockResolvedValueOnce(escalated)
        .mockResolvedValueOnce(baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1', version: 2 }));
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.claim(claimArgs);

      expect(result).toMatchObject({ status: ServiceRequestStatus.CLAIMED });
    });

    it('treats a duplicate claim by the same waiter as idempotent', async () => {
      const alreadyClaimed = baseRequest({
        status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1', version: 2,
      });
      const prisma = mockPrisma({ request: alreadyClaimed });
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.claim(claimArgs);

      expect(result).toMatchObject({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1' });
      expect(prisma.serviceRequest.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a claim by a different waiter when already claimed', async () => {
      const prisma = mockPrisma({
        request: baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-other', version: 2 }),
      });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.claim(claimArgs));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.REQUEST_ALREADY_CLAIMED });
    });

    it('rejects claiming a resolved request', async () => {
      const prisma = mockPrisma({
        request: baseRequest({ status: ServiceRequestStatus.RESOLVED, claimedByUserId: 'w-1', version: 2 }),
      });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.claim(claimArgs));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_CLAIMABLE });
    });

    it('denies a waiter whose request is assigned to another waiter', async () => {
      const prisma = mockPrisma({ request: baseRequest({ assignedWaiterUserId: 'w-other' }) });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.claim(claimArgs));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.REQUEST_ASSIGNED_OTHER });
    });

    it('lets the assigned waiter claim their own request', async () => {
      const open = baseRequest({ assignedWaiterUserId: 'w-1' });
      const claimed = baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1', version: 2 });
      const prisma = mockPrisma({ request: open });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(claimed);
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.claim(claimArgs);

      expect(result).toMatchObject({ status: ServiceRequestStatus.CLAIMED });
    });

    it('lets a manager claim a request assigned to another waiter', async () => {
      const open = baseRequest({ assignedWaiterUserId: 'w-other' });
      const claimed = baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'm-1', version: 2 });
      const prisma = mockPrisma({ request: open });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(claimed);
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.claim({ ...claimArgs, actorUserId: 'm-1', actorRole: TenantRole.MANAGER });

      expect(result).toMatchObject({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'm-1' });
    });

    it('rejects when the guarded update loses a race (count 0)', async () => {
      const open = baseRequest();
      const prisma = mockPrisma({ request: open, updateResult: { count: 0 } });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(open);
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.claim(claimArgs));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.VERSION_CONFLICT });
    });
  });

  describe('resolve', () => {
    it('rejects resolving an unclaimed request', async () => {
      const prisma = mockPrisma({ request: baseRequest() });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.resolve(claimArgs));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_RESOLVABLE });
    });

    it('denies a waiter resolving a request claimed by someone else', async () => {
      const prisma = mockPrisma({
        request: baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-other', version: 2 }),
      });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.resolve({ ...claimArgs, expectedVersion: 2 }));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_YOURS });
    });

    it('resolves a claimed request with version guard and audit', async () => {
      const claimed = baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1', version: 2 });
      const resolved = baseRequest({ status: ServiceRequestStatus.RESOLVED, claimedByUserId: 'w-1', version: 3 });
      const prisma = mockPrisma({ request: claimed });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(claimed)
        .mockResolvedValueOnce(claimed)
        .mockResolvedValueOnce(resolved);
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.resolve({ ...claimArgs, expectedVersion: 2 });

      expect(result).toMatchObject({ status: ServiceRequestStatus.RESOLVED, version: 3 });
      expect(prisma.serviceRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ version: 2, status: { in: [ServiceRequestStatus.CLAIMED] } }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SERVICE_REQUEST_RESOLVE' }),
        }),
      );
    });

    it('treats a duplicate resolve as idempotent', async () => {
      const resolved = baseRequest({ status: ServiceRequestStatus.RESOLVED, claimedByUserId: 'w-1', version: 3 });
      const prisma = mockPrisma({ request: resolved });
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.resolve({ ...claimArgs, expectedVersion: 3 });

      expect(result).toMatchObject({ status: ServiceRequestStatus.RESOLVED });
      expect(prisma.serviceRequest.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a stale version on resolve', async () => {
      const claimed = baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1', version: 2 });
      const prisma = mockPrisma({ request: claimed });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.resolve({ ...claimArgs, expectedVersion: 1 }));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.VERSION_CONFLICT });
    });

    it('lets a manager resolve a request claimed by a waiter', async () => {
      const claimed = baseRequest({ status: ServiceRequestStatus.CLAIMED, claimedByUserId: 'w-1', version: 2 });
      const resolved = baseRequest({ status: ServiceRequestStatus.RESOLVED, version: 3 });
      const prisma = mockPrisma({ request: claimed });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(claimed)
        .mockResolvedValueOnce(claimed)
        .mockResolvedValueOnce(resolved);
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.resolve({ ...claimArgs, actorUserId: 'm-1', actorRole: TenantRole.MANAGER, expectedVersion: 2 });

      expect(result).toMatchObject({ status: ServiceRequestStatus.RESOLVED });
    });
  });

  describe('cancel', () => {
    it('rejects cancelling a resolved request', async () => {
      const prisma = mockPrisma({
        request: baseRequest({ status: ServiceRequestStatus.RESOLVED, version: 3 }),
      });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.cancel({ ...claimArgs, expectedVersion: 3 }));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_CANCELLABLE });
    });

    it('denies a waiter cancelling a request they neither claimed nor are assigned', async () => {
      const prisma = mockPrisma({
        request: baseRequest({ assignedWaiterUserId: 'w-other', claimedByUserId: null }),
      });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.cancel(claimArgs));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.REQUEST_NOT_YOURS });
    });

    it('lets a manager cancel an open request', async () => {
      const open = baseRequest();
      const cancelled = baseRequest({ status: ServiceRequestStatus.CANCELLED, version: 2 });
      const prisma = mockPrisma({ request: open });
      prisma.serviceRequest.findFirst
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce(cancelled);
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.cancel({ ...claimArgs, actorUserId: 'm-1', actorRole: TenantRole.MANAGER });

      expect(result).toMatchObject({ status: ServiceRequestStatus.CANCELLED });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SERVICE_REQUEST_CANCEL' }),
        }),
      );
    });

    it('treats a duplicate cancel as idempotent', async () => {
      const cancelled = baseRequest({ status: ServiceRequestStatus.CANCELLED, version: 2 });
      const prisma = mockPrisma({ request: cancelled });
      const service = new ServiceRequestService(prisma, mockGateway());

      const result = await service.cancel({ ...claimArgs, expectedVersion: 2 });

      expect(result).toMatchObject({ status: ServiceRequestStatus.CANCELLED });
      expect(prisma.serviceRequest.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a stale version on cancel', async () => {
      const open = baseRequest({ version: 5 });
      const prisma = mockPrisma({ request: open });
      const service = new ServiceRequestService(prisma, mockGateway());

      const err = await captureError(service.cancel({ ...claimArgs, expectedVersion: 4 }));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: SERVICE_REQUEST_ERRORS.VERSION_CONFLICT });
    });
  });

  describe('escalation', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('escalates overdue OPEN requests past the branch policy threshold', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
      const prisma = mockPrisma({ policy: { assistanceEscalationSeconds: 180 }, updateResult: { count: 2 } });
      const gateway = mockGateway();
      const service = new ServiceRequestService(prisma, gateway);

      const count = await service.escalateBranch('t1', 'b1');

      expect(count).toBe(2);
      expect(prisma.serviceRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1', branchId: 'b1', status: ServiceRequestStatus.OPEN,
            createdAt: { lt: new Date('2026-10-03T11:57:00.000Z') },
          }),
          data: expect.objectContaining({ status: ServiceRequestStatus.ESCALATED, version: { increment: 1 } }),
        }),
      );
      expect(gateway.broadcastToServiceBoard).toHaveBeenCalledWith(
        'b1', 'service_request:escalated', expect.objectContaining({ count: 2 }),
      );
    });

    it('falls back to the default threshold when no policy exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
      const prisma = mockPrisma({ policy: null });
      const service = new ServiceRequestService(prisma, mockGateway());

      await service.escalateBranch('t1', 'b1');

      expect(prisma.serviceRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdAt: { lt: new Date('2026-10-03T11:57:00.000Z') } }),
        }),
      );
    });

    it('does not broadcast when nothing is overdue', async () => {
      const prisma = mockPrisma({ policy: null, updateResult: { count: 0 } });
      const gateway = mockGateway();
      const service = new ServiceRequestService(prisma, gateway);

      const count = await service.escalateBranch('t1', 'b1');

      expect(count).toBe(0);
      expect(gateway.broadcastToServiceBoard).not.toHaveBeenCalled();
    });

    it('escalates every branch that still has OPEN requests', async () => {
      const prisma = mockPrisma({
        policy: null,
        updateResult: { count: 1 },
      });
      prisma.serviceRequest.findMany.mockResolvedValue([
        { tenantId: 't1', branchId: 'b1' },
        { tenantId: 't2', branchId: 'b2' },
      ]);
      const service = new ServiceRequestService(prisma, mockGateway());

      const total = await service.escalateAllOverdue();

      expect(total).toBe(2);
      expect(prisma.serviceRequest.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.serviceRequest.updateMany).toHaveBeenNthCalledWith(
        1, expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1', branchId: 'b1' }) }),
      );
      expect(prisma.serviceRequest.updateMany).toHaveBeenNthCalledWith(
        2, expect.objectContaining({ where: expect.objectContaining({ tenantId: 't2', branchId: 'b2' }) }),
      );
    });
  });
});

describe('ServiceRequestsController authorization metadata', () => {
  const allowedRoles = [TenantRole.OWNER, TenantRole.MANAGER, TenantRole.WAITER];
  const deniedRoles = [TenantRole.CASHIER, TenantRole.KITCHEN_STAFF];
  const actions = ['list', 'claim', 'resolve', 'cancel'] as const;

  it.each(actions)('%s allows only owner, manager and waiter', (action) => {
    const roles = Reflect.getMetadata('roles', ServiceRequestsController.prototype[action]);
    expect(roles).toEqual(allowedRoles);
    for (const denied of deniedRoles) expect(roles).not.toContain(denied);
  });

  it('is guarded by JWT, roles and branch scope', () => {
    const guards = Reflect.getMetadata('__guards__', ServiceRequestsController);
    expect(guards?.length).toBeGreaterThanOrEqual(3);
  });
});
