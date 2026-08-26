import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantTaxConfiguration } from '@prisma/client';
import { RoundingMode } from '@rms/contracts';

/**
 * Tax configuration service — versioned VAT with confirmation gate.
 *
 * IMPORTANT: VAT rounding policy is an UNRESOLVED EXTERNAL DECISION.
 * See AGENTS.md pause conditions: "Tax/VAT/service-charge law or receipt compliance"
 *
 * The PriceCalculatorService only applies VAT when `confirmedBy` is set on the
 * active configuration. Unconfirmed configurations produce VAT=0. This prevents
 * accidental VAT activation before explicit product/owner approval.
 */
@Injectable()
export class TaxConfigService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getActiveConfig(tenantId: string, branchId?: string): Promise<TenantTaxConfiguration | null> {
    return this.prisma.tenantTaxConfiguration.findFirst({
      where: {
        tenantId,
        branchId: branchId ?? null,
        effectiveFrom: { lte: new Date() },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: new Date() } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async getConfigHistory(tenantId: string, branchId?: string): Promise<TenantTaxConfiguration[]> {
    return this.prisma.tenantTaxConfiguration.findMany({
      where: {
        tenantId,
        branchId: branchId ?? null,
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async createConfig(params: {
    tenantId: string;
    branchId?: string;
    vatApplicable: boolean;
    vatRate: number;
    roundingMode?: string;
    effectiveFrom: Date;
    effectiveUntil?: Date;
    confirmedBy?: string;
    confirmationNote?: string;
    createdByUserId: string;
  }): Promise<TenantTaxConfiguration> {
    if (params.vatRate < 0 || params.vatRate > 1) {
      throw new BadRequestException('vatRate must be between 0 and 1');
    }
    if (params.vatApplicable && params.vatRate === 0) {
      throw new BadRequestException('vatRate must be > 0 when vatApplicable is true');
    }

    // Validate rounding mode when provided
    const roundingMode = params.roundingMode ?? RoundingMode.DOWN;
    const validModes = Object.values(RoundingMode);
    if (!validModes.includes(roundingMode as RoundingMode)) {
      throw new BadRequestException(
        `Unsupported rounding mode "${roundingMode}". Supported modes: ${validModes.join(', ')}`,
      );
    }

    // Check for overlapping configs
    const overlapping = await this.prisma.tenantTaxConfiguration.findFirst({
      where: {
        tenantId: params.tenantId,
        branchId: params.branchId ?? null,
        OR: [
          {
            effectiveFrom: { lte: params.effectiveUntil ?? new Date('9999-12-31') },
            effectiveUntil: null,
          },
          {
            effectiveFrom: { lte: params.effectiveUntil ?? new Date('9999-12-31') },
            effectiveUntil: { gte: params.effectiveFrom },
          },
        ],
      },
    });

    if (overlapping) {
      throw new BadRequestException(
        `Overlapping tax configuration exists (id: ${overlapping.id}, effective ${overlapping.effectiveFrom.toISOString()})`,
      );
    }

    return this.prisma.tenantTaxConfiguration.create({
      data: {
        tenantId: params.tenantId,
        branchId: params.branchId ?? null,
        vatApplicable: params.vatApplicable,
        vatRate: params.vatRate,
        roundingMode,
        effectiveFrom: params.effectiveFrom,
        effectiveUntil: params.effectiveUntil ?? null,
        confirmedBy: params.confirmedBy ?? null,
        confirmationNote: params.confirmationNote ?? null,
        createdByUserId: params.createdByUserId,
      },
    });
  }
}
