import { SetMetadata } from '@nestjs/common';
import { FeatureKey } from '@rms/contracts';

export const FEATURE_ENABLED_KEY = 'featureEnabled';

/**
 * Decorator: marks a route handler as requiring a specific feature to be effective.
 * Used with FeatureEnabledGuard.
 */
export const FeatureEnabled = (featureKey: FeatureKey) =>
  SetMetadata(FEATURE_ENABLED_KEY, featureKey);
