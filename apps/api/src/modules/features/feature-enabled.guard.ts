import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@rms/contracts';
import { FEATURE_ENABLED_KEY } from './feature-enabled.decorator';
import { FeatureResolver } from './feature-resolver.service';

@Injectable()
export class FeatureEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.getAllAndOverride<FeatureKey>(FEATURE_ENABLED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!featureKey) return true; // No feature requirement

    const request = context.switchToHttp().getRequest();
    const tenantId = request.tenantContext?.tenantId;
    const branchId = request.params?.branchId;

    if (!tenantId) return true; // No tenant context — let auth guards handle

    const state = await this.featureResolver.resolve(tenantId, featureKey, branchId);
    if (!state.effective) {
      const message = `This action requires the ${featureKey} feature to be enabled.`;

      const errPayload: Record<string, unknown> = {
        statusCode: 403,
        code: state.disabledReason === 'DEPENDENCY_DISABLED' ? 'DEPENDENCY_DISABLED' : 'FEATURE_DISABLED',
        feature: featureKey,
        reason: state.disabledReason,
        message,
      };

      const err = new ForbiddenException(errPayload);
      throw err;
    }

    return true;
  }
}
