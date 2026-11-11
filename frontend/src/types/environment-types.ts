import type { components } from './rollout-types';

// Auto-generated: Extract array element types from Environment status schema
type EnvironmentStatus = Required<components['schemas']['Environment']>['status'];
export type EnvironmentInfo = Required<EnvironmentStatus>['environmentInfos'][number];
// EnvironmentStatusEntry is now the history entry from EnvironmentInfo
export type EnvironmentStatusEntry = Required<EnvironmentInfo>['history'][number];

// Sites and waves (environment-controller feat/sites-and-waves).
export type EnvironmentSpec = components['schemas']['Environment']['spec'];
/** One of the nine names spec.environment accepts. */
export type TierName = EnvironmentSpec['environment'];
export type WaveStatus = Required<EnvironmentStatus>['wave'];
export type WaveMember = Required<WaveStatus>['members'][number];
/** The CRD now types status.wave.role as a plain string; the controller only writes these two. */
export type WaveRole = 'Leader' | 'Follower';
/** Condition reasons of WaveReady / LockstepConsistent. */
export type WaveReadyReason =
	| 'Ready'
	| 'WaitingFor'
	| 'WaitingForCandidate'
	| 'Pinned'
	| 'InvalidTopology'
	| 'LockstepWaiting'
	| 'LockstepMismatch'
	| 'DuplicateSite'
	| 'UnknownTier';
