import type { components } from './rollout-types';
import type { ManagedResourceStatus as ManagedResourceStatusType } from './managed-resource';

export type { DependencyBreak, RollbackSelection, AutoRollbackStatus, SkippedRollbackTarget } from './rollout-types';

type RolloutSchema = components['schemas']['Rollout'];
/** The old status lists rollout-controller no longer writes: releases come from the ReleaseSlice catalogue (src/lib/releases/catalogue.ts). Absent here so svelte-check refuses any read of them. */
type RetiredReleaseLists = 'availableReleases' | 'releaseCandidates' | 'gatedReleaseCandidates';
/** The schema's one release entry (the catalogue's VersionInfo is built on it). */
export type SchemaRelease = NonNullable<
	NonNullable<RolloutSchema['status']>['availableReleases']
>[number];
export type Rollout = Omit<RolloutSchema, 'status'> & {
	status?: Omit<NonNullable<RolloutSchema['status']>, RetiredReleaseLists>;
};
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
	/** One line about the thing observed, verbatim from the provider (a resource status message, an alert's identifying labels, a monitor's alerting groups, or the error when the check could not run). Never parsed. Absent on older controllers. */
	message?: string;
};
type HealthCheckBase = components['schemas']['HealthCheck'];
export type HealthCheck = Omit<HealthCheckBase, 'status'> & { status?: NonNullable<HealthCheckBase['status']> & { observations?: HealthObservation[] } };
export type Environment = components['schemas']['Environment'];
export type RolloutTest = components['schemas']['RolloutTest'];
export type Kustomization = components['schemas']['Kustomization'];
export type OCIRepository = components['schemas']['OCIRepository'];
export type KruiseRollout = components['schemas']['KruiseRollout'];
export type ManagedResourceStatus = ManagedResourceStatusType;
/**
 * A Flux HelmRelease (helm.toolkit.fluxcd.io/v2) as `/api/rollouts/:ns/:name` embeds it. Hand-written and loose on purpose: the
 * backend reads HelmReleases unstructured (no typed Flux helm API), and the CRD is not part of the generated schemas.
 */
export type HelmRelease = {
	apiVersion?: string;
	kind?: string;
	metadata?: { name?: string; namespace?: string; generation?: number; annotations?: Record<string, string> };
	spec?: Record<string, any>;
	status?: Record<string, any>;
};

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
