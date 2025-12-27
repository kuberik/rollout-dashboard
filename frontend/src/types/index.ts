import type { components } from './rollout-types';
import type { ManagedResourceStatus as ManagedResourceStatusType } from './managed-resource';

export type Rollout = components['schemas']['Rollout'];
export type RolloutGate = components['schemas']['RolloutGate'];
export type HealthCheck = components['schemas']['HealthCheck'];
export type Environment = components['schemas']['Environment'];
export type RolloutTest = components['schemas']['RolloutTest'];
export type Kustomization = components['schemas']['Kustomization'];
export type OCIRepository = components['schemas']['OCIRepository'];
export type KruiseRollout = components['schemas']['KruiseRollout'];
export type ManagedResourceStatus = ManagedResourceStatusType;
