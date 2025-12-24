import type { components } from './rollout-types';

// Auto-generated: Extract array element types from Environment status schema
type EnvironmentStatus = Required<components['schemas']['Environment']>['status'];
export type EnvironmentInfo = Required<EnvironmentStatus>['environmentInfos'][number];
// EnvironmentStatusEntry is now the history entry from EnvironmentInfo
export type EnvironmentStatusEntry = Required<EnvironmentInfo>['history'][number];
