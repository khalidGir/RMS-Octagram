import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FulfillmentPolicyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getPolicy(tenantId: string, branchId: string) {
    const policy = await this.prisma.branchFulfillmentPolicy.findUnique({
      where: { branchId },
    });

    if (!policy || policy.tenantId !== tenantId) {
      // Return defaults if no policy configured
      return {
        branchId,
        serviceMode: 'ALL_AT_ONCE',
        expoMode: 'NONE',
        allowWaiterSelfClaim: false,
        showUnassignedReadyOrdersToWaiters: false,
        readyReminderSeconds: null,
        readyEscalationSeconds: null,
        autoCompleteKitchenTicketOnCollected: false,
      };
    }

    return this.serializePolicy(policy);
  }

  async upsertPolicy(params: {
    tenantId: string;
    branchId: string;
    serviceMode?: string;
    expoMode?: string;
    allowWaiterSelfClaim?: boolean;
    showUnassignedReadyOrdersToWaiters?: boolean;
    readyReminderSeconds?: number | null;
    readyEscalationSeconds?: number | null;
    autoCompleteKitchenTicketOnCollected?: boolean;
    actorUserId: string;
  }) {
    const {
      tenantId, branchId,
      serviceMode, expoMode, allowWaiterSelfClaim,
      showUnassignedReadyOrdersToWaiters, readyReminderSeconds,
      readyEscalationSeconds, autoCompleteKitchenTicketOnCollected,
      actorUserId,
    } = params;

    const existing = await this.prisma.branchFulfillmentPolicy.findUnique({
      where: { branchId },
    });

    const policy = await this.prisma.$transaction(async (tx) => {
      const p = await tx.branchFulfillmentPolicy.upsert({
        where: { branchId },
        create: {
          tenantId,
          branchId,
          serviceMode: serviceMode ?? 'ALL_AT_ONCE',
          expoMode: expoMode ?? 'NONE',
          allowWaiterSelfClaim: allowWaiterSelfClaim ?? false,
          showUnassignedReadyOrdersToWaiters: showUnassignedReadyOrdersToWaiters ?? false,
          readyReminderSeconds: readyReminderSeconds ?? null,
          readyEscalationSeconds: readyEscalationSeconds ?? null,
          autoCompleteKitchenTicketOnCollected: autoCompleteKitchenTicketOnCollected ?? false,
        },
        update: {
          ...(serviceMode !== undefined && { serviceMode }),
          ...(expoMode !== undefined && { expoMode }),
          ...(allowWaiterSelfClaim !== undefined && { allowWaiterSelfClaim }),
          ...(showUnassignedReadyOrdersToWaiters !== undefined && { showUnassignedReadyOrdersToWaiters }),
          ...(readyReminderSeconds !== undefined && { readyReminderSeconds }),
          ...(readyEscalationSeconds !== undefined && { readyEscalationSeconds }),
          ...(autoCompleteKitchenTicketOnCollected !== undefined && { autoCompleteKitchenTicketOnCollected }),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: existing ? 'FULFILLMENT_POLICY_UPDATE' : 'FULFILLMENT_POLICY_CREATE',
          entityType: 'BranchFulfillmentPolicy',
          entityId: p.id,
          ...(existing ? { beforeJson: existing as any } : {}),
          afterJson: p as any,
        },
      });

      return p;
    });

    return this.serializePolicy(policy);
  }

  private serializePolicy(policy: any) {
    return {
      id: policy.id,
      branchId: policy.branchId,
      serviceMode: policy.serviceMode,
      expoMode: policy.expoMode,
      allowWaiterSelfClaim: policy.allowWaiterSelfClaim,
      showUnassignedReadyOrdersToWaiters: policy.showUnassignedReadyOrdersToWaiters,
      readyReminderSeconds: policy.readyReminderSeconds,
      readyEscalationSeconds: policy.readyEscalationSeconds,
      autoCompleteKitchenTicketOnCollected: policy.autoCompleteKitchenTicketOnCollected,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }
}
