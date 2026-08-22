import { Injectable, Inject, NotFoundException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentInstructionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getActiveInstructions(tenantId: string, branchId: string) {
    return this.prisma.paymentInstruction.findMany({
      where: { tenantId, branchId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getInstructions(tenantId: string, branchId: string) {
    return this.prisma.paymentInstruction.findMany({
      where: { tenantId, branchId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getInstruction(tenantId: string, branchId: string, instructionId: string) {
    return this.prisma.paymentInstruction.findFirst({
      where: { id: instructionId, tenantId, branchId },
    });
  }

  async createInstruction(params: {
    tenantId: string;
    branchId: string;
    method: string;
    label: string;
    accountHolder?: string;
    accountIdentifier?: string;
    instructions?: string;
    sortOrder?: number;
    actorUserId?: string;
  }) {
    const { actorUserId, ...data } = params;

    return this.prisma.$transaction(async (tx) => {
      const instruction = await tx.paymentInstruction.create({
        data: {
          tenantId: data.tenantId,
          branchId: data.branchId,
          method: data.method,
          label: data.label,
          accountHolder: data.accountHolder ?? null,
          accountIdentifier: data.accountIdentifier ?? null,
          instructions: data.instructions ?? null,
          sortOrder: data.sortOrder ?? 0,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId ?? null,
          tenantId: data.tenantId,
          branchId: data.branchId,
          action: 'PAYMENT_INSTRUCTION_CREATE',
          entityType: 'PaymentInstruction',
          entityId: instruction.id,
          afterJson: {
            method: data.method,
            label: data.label,
            accountHolder: data.accountHolder,
            accountIdentifier: data.accountIdentifier,
          },
        },
      });

      return instruction;
    });
  }

  async updateInstruction(
    tenantId: string,
    branchId: string,
    instructionId: string,
    data: Partial<{
      method: string;
      label: string;
      accountHolder: string;
      accountIdentifier: string;
      instructions: string;
      sortOrder: number;
      isActive: boolean;
    }>,
    actorUserId?: string,
  ) {
    const existing = await this.prisma.paymentInstruction.findFirst({
      where: { id: instructionId, tenantId, branchId },
    });
    if (!existing) {
      throw new NotFoundException('Payment instruction not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const instruction = await tx.paymentInstruction.update({
        where: { id: instructionId },
        data,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId ?? null,
          tenantId,
          branchId,
          action: 'PAYMENT_INSTRUCTION_UPDATE',
          entityType: 'PaymentInstruction',
          entityId: instructionId,
          beforeJson: {
            method: existing.method,
            label: existing.label,
            isActive: existing.isActive,
          },
          afterJson: {
            method: instruction.method,
            label: instruction.label,
            isActive: instruction.isActive,
          },
        },
      });

      return instruction;
    });
  }

  async deleteInstruction(tenantId: string, branchId: string, instructionId: string, actorUserId?: string) {
    const existing = await this.prisma.paymentInstruction.findFirst({
      where: { id: instructionId, tenantId, branchId },
    });
    if (!existing) {
      throw new NotFoundException('Payment instruction not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.paymentInstruction.delete({
        where: { id: instructionId },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId ?? null,
          tenantId,
          branchId,
          action: 'PAYMENT_INSTRUCTION_DELETE',
          entityType: 'PaymentInstruction',
          entityId: instructionId,
          beforeJson: {
            method: existing.method,
            label: existing.label,
          },
        },
      });

      return { deleted: true };
    });
  }
}
