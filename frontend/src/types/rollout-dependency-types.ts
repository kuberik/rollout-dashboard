/**
 * RolloutDependency — the API contract served on `GET /api/rollouts` as the
 * `rolloutDependencies` sibling of `rollouts` / `environments`.
 *
 * Hand-written rather than generated: `scripts/generate-types.sh` builds
 * `rollout-types.ts` from the CRDs published on rollout-controller's `main`
 * branch, and the RolloutDependency CRD is not there yet. Keep this in sync with
 * `rollout-controller/api/v1alpha1/rolloutdependency_types.go`.
 *
 * ## What it means
 *
 * A RolloutDependency gates a *consumer* Rollout (`spec.rolloutRef`) on the
 * deployed contract version of a *provider* Rollout (`spec.providerRef`). Each
 * release candidate of the consumer declares what it needs of the contract via a
 * `com.kuberik.rollout.requires.<contract>` OCI annotation, surfaced on the
 * Rollout as `VersionInfo.requires[contract]`. A candidate is admitted only once
 * the provider has deployed a release whose own contract version satisfies that
 * constraint. Providers therefore advance before their consumers.
 *
 * ## Reading it safely
 *
 * - A consumer, its provider and this object are always in **one namespace on one
 *   cluster**. Use `metadata.annotations['rollout-dashboard.kuberik.com/source-cluster']`
 *   for cluster attribution, exactly as with `rollouts` and `environments` — the
 *   list is merged across clusters and is otherwise ambiguous.
 * - The collection is **sparse**. A dependency existing in one environment's
 *   namespace says nothing about the others; render the absence as absence, not
 *   as an unblocked dependency.
 * - `rolloutDependencies` may be `null` or absent when the source cluster does not
 *   have the CRD installed. That is not an error and does not appear in
 *   `clusterErrors`; it is indistinguishable from "no dependencies defined".
 */

/** A cluster-attribution annotation stamped on every merged list item. */
export const SOURCE_CLUSTER_ANNOTATION = 'rollout-dashboard.kuberik.com/source-cluster';
export const SOURCE_DASHBOARD_ANNOTATION = 'rollout-dashboard.kuberik.com/source-dashboard';

export type RolloutDependencyMetadata = {
	name?: string;
	namespace?: string;
	uid?: string;
	creationTimestamp?: string;
	labels?: Record<string, string>;
	/** Includes the two source-* annotations above after multi-cluster merge. */
	annotations?: Record<string, string>;
};

export type ProviderRolloutReference = {
	/** Name of the providing Rollout. */
	name: string;
	/**
	 * Namespace of the providing Rollout. Optional in the CRD, but the dashboard
	 * **resolves the default server-side**, so it is always populated here — it
	 * equals `metadata.namespace` when the object did not set it. Do not
	 * re-implement the defaulting.
	 */
	namespace: string;
};

export type RolloutDependencySpec = {
	/** The consumer Rollout this dependency gates. Always same-namespace. */
	rolloutRef: { name: string };
	providerRef: ProviderRolloutReference;
	/**
	 * Contract name matched against the consumer's
	 * `com.kuberik.rollout.requires.<contract>` annotations. Optional in the CRD,
	 * but the dashboard **resolves the default server-side** (it falls back to
	 * `providerRef.name`), so it is always populated here.
	 */
	contract: string;
};

/** Why a consumer release candidate cannot ship. The adverse case. */
export type BlockedRelease = {
	/** Image tag of the blocked candidate. */
	tag: string;
	/**
	 * The semver constraint that candidate places on the contract, verbatim from
	 * its requires annotation. Masterminds/semver semantics: a bare `1.1.0` is an
	 * *exact* match, `^1.1.0` is compatible-within-major.
	 */
	requiredVersion?: string;
	/** Short machine-readable reason, e.g. `ConstraintNotSatisfied`. */
	reason?: string;
};

export type RolloutDependencyCondition = {
	/** `Ready` (gate evaluated and in sync) or `Satisfied` (nothing held back). */
	type: 'Ready' | 'Satisfied' | (string & {});
	status: 'True' | 'False' | 'Unknown' | (string & {});
	reason?: string;
	message?: string;
	lastTransitionTime?: string;
	observedGeneration?: number;
};

export type RolloutDependencyStatus = {
	conditions?: RolloutDependencyCondition[];
	/** Contract version currently deployed by the provider, e.g. `1.66.0`. */
	providedVersion?: string;
	/** Image tag of the provider release `providedVersion` was read from. */
	providedTag?: string;
	/** Consumer candidate TAGS this dependency admits (not versions). Capped at 50. */
	admittedVersions?: string[];
	/** Consumer candidates held back, with the constraint each asks for. Capped at 50. */
	blockedReleases?: BlockedRelease[];
	/** Name of the RolloutGate this dependency manages. */
	gateName?: string;
};

export type RolloutDependency = {
	apiVersion?: string;
	kind?: string;
	metadata?: RolloutDependencyMetadata;
	spec: RolloutDependencySpec;
	status?: RolloutDependencyStatus;
};

export type RolloutDependencyList = { items: RolloutDependency[] };

/**
 * `VersionInfo.requires` — what a given release candidate asks of each contract,
 * keyed by contract name, values being semver constraints.
 *
 * This is served on `status.availableReleases[]`, `status.releaseCandidates[]`,
 * `status.gatedReleaseCandidates[]` and `status.history[].version`, but the
 * generated `Rollout` type predates it (same reason as above). Cast through this
 * helper rather than widening the generated type.
 *
 *   const requires = releaseRequires(rollout.status?.history?.[0]?.version);
 */
export type ReleaseRequires = Record<string, string>;

export function releaseRequires(version: unknown): ReleaseRequires | undefined {
	const requires = (version as { requires?: unknown } | null | undefined)?.requires;
	return requires && typeof requires === 'object' ? (requires as ReleaseRequires) : undefined;
}

/** True when the release's OCI manifest could not be read, so `requires` is unknown. */
export function releaseMetadataUnresolved(version: unknown): boolean {
	return (
		(version as { metadataUnresolved?: boolean } | null | undefined)?.metadataUnresolved === true
	);
}

/** Condition lookup that treats a missing condition as unknown, not as false. */
export function dependencyCondition(
	dep: RolloutDependency | undefined,
	type: 'Ready' | 'Satisfied'
): RolloutDependencyCondition | undefined {
	return dep?.status?.conditions?.find((c) => c.type === type);
}

/** The cluster a merged dependency came from, or undefined on a single-cluster payload. */
export function dependencySourceCluster(dep: RolloutDependency | undefined): string | undefined {
	return dep?.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION];
}
