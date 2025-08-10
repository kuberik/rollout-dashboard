import type { components } from './rollout-types';
import type { ManagedResourceStatus as ManagedResourceStatusType } from './managed-resource';

export type Rollout = components['schemas']['Rollout'];
export type RolloutGate = components['schemas']['RolloutGate'];
export type HealthCheck = components['schemas']['HealthCheck'];
export type KubeStatus = components['schemas']['KubeStatus'];
export type Kustomization = components['schemas']['Kustomization'];
export type OCIRepository = components['schemas']['OCIRepository'];
export type ManagedResourceStatus = ManagedResourceStatusType;
