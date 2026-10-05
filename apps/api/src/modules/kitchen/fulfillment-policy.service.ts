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
        orderAcceptancePolicy: 'CASHIER_CONFIRMATION',
        assistanceEscalationSeconds: 180,
        cashAtCounterEnabled: true,
        cashToWaiterEnabled: true,
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
    orderAcceptancePolicy?: string;
    assistanceEscalationSeconds?: number;
    cashAtCounterEnabled?: boolean;
    cashToWaiterEnabled?: boolean;
    actorUserId: string;
  }) {
    const {
      tenantId, branchId,
      serviceMode, expoMode, allowWaiterSelfClaim,
      showUnassignedReadyOrdersToWaiters, readyReminderSeconds,
      readyEscalationSeconds, autoCompleteKitchenTicketOnCollected,
      orderAcceptancePolicy, assistanceEscalationSeconds,
      cashAtCounterEnabled, cashToWaiterEnabled,
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
          orderAcceptancePolicy: orderAcceptancePolicy ?? 'CASHIER_CONFIRMATION',
          assistanceEscalationSeconds: assistanceEscalationSeconds ?? 180,
          cashAtCounterEnabled: cashAtCounterEnabled ?? true,
          cashToWaiterEnabled: cashToWaiterEnabled ?? true,
        },
        update: {
          ...(serviceMode !== undefined && { serviceMode }),
          ...(expoMode !== undefined && { expoMode }),
          ...(allowWaiterSelfClaim !== undefined && { allowWaiterSelfClaim }),
          ...(showUnassignedReadyOrdersToWaiters !== undefined && { showUnassignedReadyOrdersToWaiters }),
          ...(readyReminderSeconds !== undefined && { readyReminderSeconds }),
          ...(readyEscalationSeconds !== undefined && { readyEscalationSeconds }),
          ...(autoCompleteKitchenTicketOnCollected !== undefined && { autoCompleteKitchenTicketOnCollected }),
          ...(orderAcceptancePolicy !== undefined && { orderAcceptancePolicy }),
          ...(assistanceEscalationSeconds !== undefined && { assistanceEscalationSeconds }),
          ...(cashAtCounterEnabled !== undefined && { cashAtCounterEnabled }),
          ...(cashToWaiterEnabled !== undefined && { cashToWaiterEnabled }),
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
      orderAcceptancePolicy: policy.orderAcceptancePolicy,
      assistanceEscalationSeconds: policy.assistanceEscalationSeconds,
      cashAtCounterEnabled: policy.cashAtCounterEnabled,
      cashToWaiterEnabled: policy.cashToWaiterEnabled,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }
}
