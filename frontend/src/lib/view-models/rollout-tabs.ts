/**
 * ⭐ ONE TRUTH FOR "DOES THIS ROLLOUT HAVE A GATES TAB." (squad-rollout
 * coordinator ruling, 2026-10-09) Extracted from the rollout layout's own
 * `show:` predicate — `hasEnvironment || hasDependencies || hasOwnGates` —
 * which until now lived only in `+layout.svelte`'s script, so the command
 * palette's "This rollout" section (`CommandPalette.svelte`'s
 * `hasGatesTab`) had grown its OWN, narrower copy that could not see
 * `rolloutDependencies` (the layout's `listQuery` has it; the palette's
 * props never carried it). Two copies of a tab-visibility rule is exactly
 * the drift `rollout-cards.ts`'s own doc comments warn about for a rank or
 * a stuck predicate — this is the same class of bug for "which tabs exist."
 *
 * Pure: every argument is data the caller already has (or, for the
 * palette, can read off the SAME cached list-query result `Navbar.svelte`
 * already fetches under `rolloutsListQueryOptions`'s shared key — no second
 * fetch). Nothing here reads a store or a query directly, so a change to
 * either caller's own data-fetching shape can never make this function
 * disagree with itself.
 */
import type { Rollout, Environment, RolloutDependency, RolloutGate } from '../../types';
import { hasDependencyLinks } from './dependency-graph';
import { buildTopology, deployNameOf, downstreamOf, siteNodeOf, upstreamOf } from './sites-waves';

export type RolloutTabsInput = {
	/** The rollout's own detail object (`rolloutQueryOptions`'s `.rollout`). */
	rollout: Rollout | null | undefined;
	/** The detail payload's own gate OBJECTS (`rolloutQueryOptions`'s `.rolloutGates`). */
	rolloutGates?: { items?: RolloutGate[] } | null;
	/** The rollout's bound `Environment`, if any (`rolloutQueryOptions`'s `.environment`). */
	environment?: Environment | null;
	/** The route's cluster, namespace and name — the THIS in "does THIS rollout…". */
	cluster?: string;
	/** The hub's own cluster name, for `hasDependencyLinks`' on-cluster check. */
	localCluster?: string;
	namespace: string;
	name: string;
	/** The list payload's own `environments.items` (promotion-chain edges). */
	environments: Environment[];
	/** The list payload's own `rolloutDependencies.items` (contract edges). */
	rolloutDependencies: RolloutDependency[];
};

export type RolloutTabsResult = {
	/** Whether the Gates tab has anything to show — a promotion edge, a
	 *  contract edge, or a gate of any other kind (including one with no
	 *  edge at all: a deploy window, an external approval, or health checks
	 *  that apply here whether or not one is failing right now). */
	gates: boolean;
};

/**
 * A rollout whose own `DeploymentBlocked` condition is `True` is held by
 * SOMETHING right now, even when this payload cannot otherwise name what —
 * U-32(a), 2026-10-08.
 */
function isDeploymentBlocked(rollout: Rollout | null | undefined): boolean {
	return (rollout?.status?.conditions ?? []).some(
		(c) => c?.type === 'DeploymentBlocked' && c?.status === 'True'
	);
}

/** Health checks apply here, whether or not one is failing right now — same
 *  "drawn whether or not it holds" rule the gate graph's other boxes follow. */
function hasHealthSelector(rollout: Rollout | null | undefined): boolean {
	return Boolean(rollout?.spec?.healthCheckSelector);
}

function hasOwnGates(input: Pick<RolloutTabsInput, 'rollout' | 'rolloutGates'>): boolean {
	return (
		(input.rolloutGates?.items?.length ?? 0) > 0 ||
		(input.rollout?.status?.gates?.length ?? 0) > 0 ||
		hasHealthSelector(input.rollout) ||
		isDeploymentBlocked(input.rollout)
	);
}

/**
 * ⭐ WAS `environmentInfos.length > 0`, THEN "an `environmentInfos` entry names a
 * `relationship`" (2026-10-05). `relationship` is gone from the Environment
 * (sites and waves): a neighbour is now a site this one takes its version from
 * (`upstreamOf`), a site that takes its version from this one (`downstreamOf`),
 * or a sibling site in the same tier. The authority for edges BETWEEN rollouts
 * is still the graph's own rule (`hasDependencyLinks`); this one reads the
 * topology of the app's Environments, which also sees sites on other clusters
 * (through `status.wave.members`) that the list payload has no object for.
 */
function hasEnvironment(
	environment: Environment | null | undefined,
	environments: Environment[]
): boolean {
	if (!environment) return false;
	const all = environments.includes(environment) ? environments : [...environments, environment];
	const topo = buildTopology(all).get(deployNameOf(environment));
	const node = siteNodeOf(topo, environment);
	if (!topo || !node) return false;
	if (upstreamOf(topo, node).length > 0 || downstreamOf(topo, node).length > 0) return true;
	return (topo.tiers.find((t) => t.tier === node.tier)?.sites.length ?? 0) > 1;
}

export function rolloutTabs(input: RolloutTabsInput): RolloutTabsResult {
	const gates =
		hasEnvironment(input.environment, input.environments) ||
		hasDependencyLinks({
			cluster: input.cluster,
			localCluster: input.localCluster,
			namespace: input.namespace,
			name: input.name,
			environments: input.environments,
			dependencies: input.rolloutDependencies
		}) ||
		hasOwnGates(input);
	return { gates };
}
