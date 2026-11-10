import type { Rollout, Environment, RolloutDependency, RolloutGate } from '../../types';
import {
	buildGateContext,
	withSchedules,
	blockingStory,
	type BlockingStory,
	type GateContext,
	type ContractHolds
} from './blocking-story';
import {
	namespacesByCluster,
	withNetworkSchedules,
	buildRolloutGraph,
	contractHoldsForRollout,
	type RolloutGraph
} from './dependency-graph';
import type { NetworkSchedules, NetworkScheduleObject } from '$lib/api/schedules';

/**
 * ⭐ THE ONE CARD-JOIN CONSTRUCTION. (shared/cards-join, 2026-10-11)
 *
 * squad-fleet2's map found `checkout-api/staging` reading "held on
 * payments-svc" on Home and "behind the newest build" on `/apps`'s own map
 * callout for the SAME rollout at the SAME instant — because `/apps` built
 * its `gateContext` one way and `/rollouts`, the command palette and
 * `lib/view-models/matrix.ts` built theirs another (or skipped the
 * dependency-contract join — `contractHoldsFor` — entirely). `held` is only
 * ever correct when `buildRolloutCards` is handed BOTH the gate join
 * (`GateContext`) and the contract join (`contractHoldsFor`), built off the
 * SAME `RolloutGraph` — see that function's own doc comment on `held`.
 *
 * This is `ControlCenter.svelte`'s own construction (`buildGateContext` →
 * optionally `withNetworkSchedules`/`withSchedules` → `buildRolloutGraph` →
 * `contractHoldsForRollout`), lifted unchanged and generalised with the
 * EXTRA inputs the richer pages already had before this existed:
 * `rolloutGates` (positive ownership evidence — only the single-rollout
 * endpoint serves these: rollout detail, the Gates tab) and `focus` (a
 * rollout that must be a node even with no edges — the Gates tab's own
 * `RolloutDependency` tab). Every optional field defaults to exactly what
 * `ControlCenter`/`/apps` already pass, so a caller that omits them gets
 * their identical behaviour, not a weaker one.
 *
 * `environments`/`rolloutDependencies` are the RAW list-payload shapes
 * (`{ items?: [...] } | null`), not pre-flattened arrays — `buildGateContext`
 * tells "this source was never asked" (`null`) apart from "asked, found
 * nothing" (`{ items: [] }`) by that nullability, and collapsing the two
 * downgrades a machine-owned gate to "needs a person" (see `buildGateContext`'s
 * own `sources` doc). Callers that already have the flat array and want to
 * pass it here wrap it as `{ items: theArray }`.
 */
export function cardContext(input: {
	rollouts: Rollout[];
	environments: { items?: Environment[] } | null | undefined;
	rolloutDependencies?: { items?: RolloutDependency[] } | null;
	/** Positive ownership evidence. Only rollout detail and the Gates tab have it. */
	rolloutGates?: { items?: RolloutGate[] } | null;
	/** Promotion order of the fleet's environments, upstream first. */
	envOrder?: string[];
	/** A rollout that must be a node even with no edges — see `buildRolloutGraph`'s own doc. */
	focus?: { cluster: string; namespace: string; name: string; localCluster?: string };
	/**
	 * Network-wide schedule join (`ControlCenter`/`/apps`'s own
	 * `fetchNetworkSchedules`, one bulk request per cluster). Mutually
	 * exclusive with `schedulesForNamespace` — pass whichever shape your
	 * page already fetches.
	 */
	schedulesByCluster?: Map<string, NetworkSchedules>;
	/**
	 * The single-rollout `/schedules` fetch rollout detail and the Gates tab
	 * already make for `ScheduleStatus`. `null` means "not asked yet" and is
	 * NOT the same as an empty list — see `withSchedules`'s own doc; passing
	 * `null` here (the default) leaves `GateContext.schedulesLoaded` false.
	 */
	schedulesForNamespace?: { namespace: string; list: NetworkScheduleObject[] } | null;
	/**
	 * The app page's own shape: one `/schedules` fetch PER NAMESPACE an app's
	 * rollouts span (`scheduleObjects`, `fetchScheduleObjects`), folded in one
	 * namespace at a time the same way the page's own loop over
	 * `Object.entries(scheduleObjects)` did. Mutually exclusive with the other
	 * two schedule inputs — pass whichever shape your page already fetches.
	 */
	scheduleObjectsByNamespace?: Record<string, NetworkScheduleObject[]> | null;
	/**
	 * See `GateContext.schedulesExpected`. Pass `false` on a page that never
	 * fetches schedules at all (`/envs/[name]` today) so a check gate reads
	 * as its own honest answer instead of "pending". Default `true`, matching
	 * `buildGateContext`'s own default.
	 */
	schedulesExpected?: boolean;
}): {
	gateContext: GateContext;
	providerNetwork: RolloutGraph;
	contractHoldsFor: (rollout: Rollout, namespace?: string, cluster?: string) => ContractHolds;
	/**
	 * ⭐ THE ROLLOUT'S STORY, WITH BOTH JOINS. `blockingStory` over this
	 * context's `gateContext` AND this rollout's own contract holds — the
	 * pair the Gates tab and the Overview banner hand it, so a
	 * `RolloutDependency`'s gate and its contract hold are folded into ONE
	 * cause (`isDependencyGateCoveredBy`). A caller that calls `blockingStory`
	 * with the gate context alone prints the dependency gate as its own,
	 * vaguer cause ("ships a newer payments") on controller-faithful data,
	 * where the controller publishes that gate on `status.gates`.
	 */
	storyFor: (
		rollout: Rollout,
		options?: Omit<NonNullable<Parameters<typeof blockingStory>[2]>, 'contractHolds'>
	) => BlockingStory;
} {
	const envItems = input.environments?.items ?? [];

	let gateContext = buildGateContext({
		environments: input.environments ?? null,
		rolloutDependencies: input.rolloutDependencies ?? null,
		rolloutGates: input.rolloutGates ?? null,
		schedulesExpected: input.schedulesExpected
	});

	if (input.schedulesByCluster) {
		gateContext = withNetworkSchedules(
			gateContext,
			input.schedulesByCluster,
			namespacesByCluster(input.rollouts)
		);
	} else if (input.schedulesForNamespace) {
		gateContext = withSchedules(
			gateContext,
			input.schedulesForNamespace.namespace,
			input.schedulesForNamespace.list
		);
	} else if (input.scheduleObjectsByNamespace) {
		for (const [ns, objs] of Object.entries(input.scheduleObjectsByNamespace)) {
			gateContext = withSchedules(gateContext, ns, objs);
		}
	}

	const providerNetwork = buildRolloutGraph({
		rollouts: input.rollouts,
		environments: envItems,
		dependencies: input.rolloutDependencies?.items ?? [],
		envOrder: input.envOrder ?? [],
		gates: gateContext,
		focus: input.focus
	});

	const contractHoldsFor = (rollout: Rollout, namespace?: string, cluster?: string) =>
		contractHoldsForRollout(providerNetwork, rollout, namespace, cluster);
	return {
		gateContext,
		providerNetwork,
		contractHoldsFor,
		storyFor: (rollout, options = {}) =>
			blockingStory(rollout, gateContext, { ...options, contractHolds: contractHoldsFor(rollout) })
	};
}
