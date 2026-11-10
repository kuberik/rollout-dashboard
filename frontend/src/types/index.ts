import type { components } from './rollout-types';
import type { ManagedResourceStatus as ManagedResourceStatusType } from './managed-resource';

export type Rollout = components['schemas']['Rollout'];
export type RolloutGate = components['schemas']['RolloutGate'];
/** One measurement a health check reports (rollout-controller `status.observations[]`, max 16). Values are decimal strings. */
export type HealthObservation = {
	name: string;
	kind: 'Threshold' | 'Ratio' | 'Count' | 'State';
	value?: string;
	/** Threshold: the budget the value is held against */
	limit?: string;
	/** Ratio: the denominator */
	total?: string;
	/** Threshold: which side of the limit is bad */
	direction?: 'Above' | 'Below';
	unit?: string;
	window?: string;
	healthy?: boolean;
	observedTime?: string;
};
type HealthCheckBase = components['schemas']['HealthCheck'];
export type HealthCheck = Omit<HealthCheckBase, 'status'> & { status?: NonNullable<HealthCheckBase['status']> & { observations?: HealthObservation[] } };
export type Environment = components['schemas']['Environment'];
export type RolloutTest = components['schemas']['RolloutTest'];
export type Kustomization = components['schemas']['Kustomization'];
export type OCIRepository = components['schemas']['OCIRepository'];
export type KruiseRollout = components['schemas']['KruiseRollout'];
export type ManagedResourceStatus = ManagedResourceStatusType;

// Auto-generated: Extract array element type from Rollout status schema
type RolloutStatus = Required<Rollout>['status'];
export type HistoryEntry = Required<RolloutStatus>['history'][number];

// RolloutDependency is hand-written, not generated: scripts/generate-types.sh
// builds rollout-types.ts from the CRDs on rollout-controller's main branch, and
// the RolloutDependency CRD is not published there yet.
export type {
	RolloutDependency,
	RolloutDependencyList,
	RolloutDependencySpec,
	RolloutDependencyStatus,
	RolloutDependencyCondition,
	ProviderRolloutReference,
	BlockedRelease,
	ReleaseRequires
} from './rollout-dependency-types';
export {
	releaseRequires,
	releaseMetadataUnresolved,
	dependencyCondition,
	dependencySourceCluster,
	SOURCE_CLUSTER_ANNOTATION,
	SOURCE_DASHBOARD_ANNOTATION
} from './rollout-dependency-types';
