export { FeaturesModule } from './features.module';
export { FeatureResolver, type EffectiveFeatureState } from './feature-resolver.service';
export { FeatureEnabledGuard } from './feature-enabled.guard';
export { FeatureEnabled, FEATURE_ENABLED_KEY } from './feature-enabled.decorator';
export { FEATURE_CATALOG, DEFAULT_NEW_TENANT_FEATURES, getFeatureDefinition, getAllFeatureKeys, type FeatureDefinition } from './feature-catalog';
