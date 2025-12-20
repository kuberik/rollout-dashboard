import type { components } from './rollout-types';

// Auto-generated: Extract array element types from Environment status schema
type EnvironmentStatus = Required<components['schemas']['Environment']>['status'];
export type EnvironmentStatusEntry = Required<EnvironmentStatus>['deploymentStatuses'][number];
export type EnvironmentInfo = Required<EnvironmentStatus>['environmentInfos'][number];
