import { Injectable, Inject } from '@nestjs/common';
import type { FeatureKey } from '@rms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  FEATURE_CATALOG,
  type FeatureDefinition,
  getFeatureDefinition,
} from './feature-catalog';

export interface EffectiveFeatureState {
  effective: boolean;
  platformStatus: string | null;
  trialEndsAt: Date | null;
  tenantEnabled: boolean;
  branchOverride: 'INHERIT' | 'ENABLED' | 'DISABLED' | null;
  disabledReason?: string;
}

@Injectable()
export class FeatureResolver {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Resolve the effective state of a single feature for a tenant + optional branch.
   */
  async resolve(tenantId: string, featureKey: FeatureKey, branchId?: string): Promise<EffectiveFeatureState> {
    // 1. Platform entitlement
    const entitlement = await this.prisma.tenantEntitlement.findUnique({
      where: { tenantId_featureKey: { tenantId, featureKey } },
    });

    const platformStatus = entitlement?.status ?? 'DISABLED';
    const trialEndsAt = entitlement?.trialEndsAt ?? null;

    const platformAllows =
      platformStatus === 'ENABLED' ||
      (platformStatus === 'TRIAL' && trialEndsAt !== null && trialEndsAt > new Date());

    // 2. Tenant-level setting
    const tenantSetting = await this.prisma.featureSetting.findFirst({
      where: { tenantId, branchId: null, featureKey },
    });

    const tenantEnabled = tenantSetting?.enabled ?? true;

    // 3. Branch override (no row = INHERIT)
    let branchOverride: 'INHERIT' | 'ENABLED' | 'DISABLED' | null = null;
    if (branchId) {
      const branchSetting = await this.prisma.featureSetting.findFirst({
        where: { tenantId, branchId, featureKey },
      });
      if (branchSetting) {
        branchOverride = branchSetting.enabled ? 'ENABLED' : 'DISABLED';
      }
    }

    // 4. Resolve dependencies (with cycle guard)
    const depsResolved = await this.resolveDependencies(featureKey, tenantId, branchId, new Set());

    // 5. Compute effective
    const effective = platformAllows && tenantEnabled && depsResolved && branchOverride !== 'DISABLED';

    let disabledReason: string | undefined;
    if (!effective) {
      if (!platformAllows) {
        disabledReason = platformStatus === 'TRIAL' ? 'TRIAL_EXPIRED' : platformStatus;
      } else if (!tenantEnabled) {
        disabledReason = 'TENANT_DISABLED';
      } else if (branchOverride === 'DISABLED') {
        disabledReason = 'BRANCH_DISABLED';
      } else if (!depsResolved) {
        disabledReason = 'DEPENDENCY_DISABLED';
      }
    }

    return {
      effective,
      platformStatus,
      trialEndsAt,
      tenantEnabled,
      branchOverride,
      disabledReason,
    };
  }

  /**
   * Resolve the effective state of all features for a tenant + optional branch.
   */
  async resolveAll(tenantId: string, branchId?: string): Promise<Record<string, EffectiveFeatureState>> {
    const result: Record<string, EffectiveFeatureState> = {};

    for (const def of FEATURE_CATALOG) {
      result[def.key] = await this.resolve(tenantId, def.key, branchId);
    }

    return result;
  }

  /**
   * Assert that a feature is effective; throw a structured error if not.
   */
  async assertEffective(tenantId: string, featureKey: FeatureKey, branchId?: string): Promise<void> {
    const state = await this.resolve(tenantId, featureKey, branchId);
    if (!state.effective) {
      const def = getFeatureDefinition(featureKey);
      const message = `${def?.name ?? featureKey} is not enabled for this restaurant.`;

      const errorPayload = {
        statusCode: 403,
        code: state.disabledReason === 'DEPENDENCY_DISABLED' ? 'DEPENDENCY_DISABLED' : 'FEATURE_DISABLED',
        feature: featureKey,
        reason: state.disabledReason,
        message,
      };

      // Throw a proper NestJS HttpException-compatible error
      const err = new Error(message) as Error & typeof errorPayload;
      Object.assign(err, errorPayload);
      throw err;
    }
  }

  private async resolveDependencies(
    featureKey: FeatureKey,
    tenantId: string,
    branchId: string | undefined,
    visited: Set<FeatureKey>,
  ): Promise<boolean> {
    if (visited.has(featureKey)) return true; // cycle guard
    visited.add(featureKey);

    const def = getFeatureDefinition(featureKey);
    if (!def || def.dependencies.length === 0) return true;

    for (const dep of def.dependencies) {
      const depState = await this.resolve(tenantId, dep, branchId);
      if (!depState.effective) return false;
    }

    return true;
  }

  /**
   * Get the list of all feature definitions.
   */
  getCatalog(): FeatureDefinition[] {
    return FEATURE_CATALOG;
  }
}
