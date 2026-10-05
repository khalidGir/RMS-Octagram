import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FulfillmentPolicyService } from './fulfillment-policy.service';

function mockPrisma(overrides: Record<string, any> = {}) {
  const hasKey = (key: string) => key in overrides;
  const mock = {
    branchFulfillmentPolicy: {
      findUnique: vi.fn().mockResolvedValue(hasKey('existingPolicy') ? overrides.existingPolicy : null),
      upsert: vi.fn().mockResolvedValue(hasKey('upsertedPolicy') ? overrides.upsertedPolicy : {
        id: 'fp-1', branchId: 'b1', tenantId: 't1', serviceMode: 'ALL_AT_ONCE', expoMode: 'NONE',
        allowWaiterSelfClaim: false, showUnassignedReadyOrdersToWaiters: false,
        readyReminderSeconds: null, readyEscalationSeconds: null,
        autoCompleteKitchenTicketOnCollected: false, createdAt: new Date(), updatedAt: new Date(),
      }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
  } as any;
  return mock;
}

describe('FulfillmentPolicyService', () => {
  let service: FulfillmentPolicyService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPolicy', () => {
    it('returns existing policy', async () => {
      const prisma = mockPrisma({
        existingPolicy: {
          id: 'fp-1', branchId: 'b1', tenantId: 't1', serviceMode: 'PARTIAL_ALLOWED', expoMode: 'REQUIRED',
          allowWaiterSelfClaim: true, showUnassignedReadyOrdersToWaiters: true,
          readyReminderSeconds: 120, readyEscalationSeconds: 300,
          autoCompleteKitchenTicketOnCollected: true, createdAt: new Date(), updatedAt: new Date(),
        },
      });
      service = new FulfillmentPolicyService(prisma);

      const result = await service.getPolicy('t1', 'b1');

      expect(result.serviceMode).toBe('PARTIAL_ALLOWED');
      expect(result.expoMode).toBe('REQUIRED');
      expect(result.allowWaiterSelfClaim).toBe(true);
      expect(result.readyReminderSeconds).toBe(120);
    });

    it('returns defaults when no policy exists', async () => {
      const prisma = mockPrisma({ existingPolicy: null });
      service = new FulfillmentPolicyService(prisma);

      const result = await service.getPolicy('t1', 'b1');

      expect(result.serviceMode).toBe('ALL_AT_ONCE');
      expect(result.expoMode).toBe('NONE');
      expect(result.allowWaiterSelfClaim).toBe(false);
    });

    it('returns defaults when policy belongs to different tenant', async () => {
      const prisma = mockPrisma({
        existingPolicy: { id: 'fp-1', branchId: 'b1', tenantId: 'other-tenant', serviceMode: 'PARTIAL_ALLOWED' },
      });
      service = new FulfillmentPolicyService(prisma);

      const result = await service.getPolicy('t1', 'b1');

      expect(result.serviceMode).toBe('ALL_AT_ONCE');
    });
  });

  describe('upsertPolicy', () => {
    it('creates a new policy with audit log', async () => {
      const prisma = mockPrisma({ existingPolicy: null });
      prisma.branchFulfillmentPolicy.upsert.mockResolvedValue({
        id: 'fp-1', branchId: 'b1', tenantId: 't1', serviceMode: 'PARTIAL_ALLOWED', expoMode: 'REQUIRED',
        allowWaiterSelfClaim: false, showUnassignedReadyOrdersToWaiters: false,
        readyReminderSeconds: null, readyEscalationSeconds: null,
        autoCompleteKitchenTicketOnCollected: false, createdAt: new Date(), updatedAt: new Date(),
      });
      service = new FulfillmentPolicyService(prisma);

      const result = await service.upsertPolicy({
        tenantId: 't1', branchId: 'b1', serviceMode: 'PARTIAL_ALLOWED', expoMode: 'REQUIRED',
        actorUserId: 'u1',
      });

      expect(result.serviceMode).toBe('PARTIAL_ALLOWED');
      expect(result.expoMode).toBe('REQUIRED');
      expect(prisma.branchFulfillmentPolicy.upsert).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'FULFILLMENT_POLICY_CREATE' }),
        }),
      );
    });

    it('updates existing policy with audit log', async () => {
      const prisma = mockPrisma({
        existingPolicy: { id: 'fp-1', branchId: 'b1', tenantId: 't1', serviceMode: 'ALL_AT_ONCE' },
      });
      service = new FulfillmentPolicyService(prisma);

      await service.upsertPolicy({
        tenantId: 't1', branchId: 'b1', serviceMode: 'PARTIAL_ALLOWED', actorUserId: 'u1',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'FULFILLMENT_POLICY_UPDATE' }),
        }),
      );
    });

    it('partial update only modifies provided fields', async () => {
      const prisma = mockPrisma({
        existingPolicy: { id: 'fp-1', branchId: 'b1', tenantId: 't1', serviceMode: 'ALL_AT_ONCE' },
      });
      service = new FulfillmentPolicyService(prisma);

      await service.upsertPolicy({
        tenantId: 't1', branchId: 'b1', expoMode: 'REQUIRED', actorUserId: 'u1',
      });

      const updateCall = prisma.branchFulfillmentPolicy.upsert.mock.calls[0][0];
      expect(updateCall.update).toEqual({ expoMode: 'REQUIRED' });
    });
  });
});
