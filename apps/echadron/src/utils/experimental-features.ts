import type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
} from '@yaseenhq/echadron-sdk';

export function experimentalFeatureMap(
  features: readonly Pick<ExperimentalFeatureState, 'id' | 'enabled'>[],
): ExperimentalFlagMap {
  return Object.fromEntries(features.map((feature) => [feature.id, feature.enabled]));
}
