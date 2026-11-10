import { describe, expect, it } from 'vitest';
import type { Rollout, RolloutDependency } from '../../types';
import { buildRolloutGraph } from './dependency-graph';
import { graphNodeForRollout } from './app-tasks';

/**
 * ⭐ ITEM 4 (coordinator, 2026-10-09). `graphNodeForRollout` used to match a
 * node on namespace+name ALONE, which is ambiguous across spokes: two
 * spokes can genuinely run the identical (namespace, name) — a
 * multi-cluster fleet where the same app/env pair exists once per region,
 * say — and `Array.find` silently returned whichever node happened to be
 * built first, regardless of which rollout the caller actually passed in.
 *
 * These fixtures build TWO nodes that share one (namespace, name) but sit
 * on different clusters (`SOURCE_CLUSTER_ANNOTATION` stamped differently on
 * each), the same way two real spokes' rollouts would arrive in one
 * `/api/rollouts` payload. A node only exists in `RolloutGraph` once it
 * participates in an edge (`buildRolloutGraph`'s own doc comment,
 * "Rollouts in the payload that no gate keys to another rollout ... are NOT
 * nodes") — so each spoke gets its own `RolloutDependency`, on its own
 * cluster, naming the SAME consumer identity.
 */

const ANNOTATION = 'rollout-dashboard.kuberik.com/source-cluster';

function ann(cluster: string): Record<string, string> {
	return cluster ? { [ANNOTATION]: cluster } : {};
}

function consumerRollout(cluster: string): Rollout {
	return {
		metadata: { name: 'svc-app', namespace: 'svc-dev', annotations: ann(cluster) },
		spec: {},
		status: {
			history: [{ version: { tag: 'rel-1', version: '1.0.0-1' } }],
			availableReleases: [{ tag: 'rel-1', version: '1.0.0-1' }],
			gates: []
		}
	} as unknown as Rollout;
}

function dependency(over: {
	cluster: string;
	provider: string;
}): RolloutDependency {
	return {
		metadata: {
			name: `svc-app-needs-${over.provider}`,
			namespace: 'svc-dev',
			annotations: ann(over.cluster)
		},
		spec: {
			contract: over.provider,
			providerRef: { name: over.provider, namespace: 'svc-dev' },
			rolloutRef: { name: 'svc-app' }
		},
		status: {
			gateName: `dependency-svc-app-needs-${over.provider}`,
			providedVersion: '1.0.0',
			blockedReleases: [],
			conditions: []
		}
	} as unknown as RolloutDependency;
}

describe('graphNodeForRollout — two spokes sharing one namespace+name (item 4)', () => {
	// Two independent dependency edges, one per spoke, so each spoke's
	// `svc-dev/svc-app` gets its own node — identical namespace+name,
	// different `cluster`.
	const depSpokeA = dependency({ cluster: 'spoke-a', provider: 'provider-a' });
	const depSpokeB = dependency({ cluster: 'spoke-b', provider: 'provider-b' });
	const graph = buildRolloutGraph({
		rollouts: [],
		environments: [],
		dependencies: [depSpokeA, depSpokeB],
		envOrder: []
	});

	it('builds one node per spoke, not one shared node', () => {
		const ids = graph.nodes.filter((n) => n.namespace === 'svc-dev' && n.name === 'svc-app').map((n) => n.id);
		expect(ids.sort()).toEqual(['spoke-a/svc-dev/svc-app', 'spoke-b/svc-dev/svc-app']);
	});

	it("matches spoke A's own rollout to spoke A's own node, never spoke B's", () => {
		const rolloutA = consumerRollout('spoke-a');
		const node = graphNodeForRollout(graph, rolloutA);
		expect(node?.id).toBe('spoke-a/svc-dev/svc-app');
	});

	it("matches spoke B's own rollout to spoke B's own node, never spoke A's", () => {
		// Before item 4, `Array.find` on namespace+name alone always
		// returned whichever node was built FIRST (spoke A's, inserted by
		// the earlier dependency edge above) — regardless of this being
		// spoke B's own rollout. This is the exact regression this fixture
		// pins: the SECOND node must still be reachable.
		const rolloutB = consumerRollout('spoke-b');
		const node = graphNodeForRollout(graph, rolloutB);
		expect(node?.id).toBe('spoke-b/svc-dev/svc-app');
	});

	it("falls back to the caller's cluster argument when the rollout itself carries no annotation", () => {
		// Simulates a single-rollout DETAIL fetch (not list-stamped, per
		// `sourceClusterName`'s own doc comment) for spoke B's rollout: no
		// annotation on the object, so the caller's own route-derived
		// `cluster` argument is what disambiguates.
		const unstamped = consumerRollout('');
		const node = graphNodeForRollout(graph, unstamped, undefined, 'spoke-b');
		expect(node?.id).toBe('spoke-b/svc-dev/svc-app');
	});
});

describe('graphNodeForRollout — hub-local, unstamped cluster (item 4 regression guard)', () => {
	// ONE node only: a hub-local dependency, no `source-cluster` annotation
	// at all (cluster === '').
	const depHub = dependency({ cluster: '', provider: 'provider-hub' });
	const graph = buildRolloutGraph({
		rollouts: [],
		environments: [],
		dependencies: [depHub],
		envOrder: []
	});

	it('builds the hub-local node with an empty cluster', () => {
		const node = graph.nodes.find((n) => n.namespace === 'svc-dev' && n.name === 'svc-app');
		expect(node?.cluster).toBe('');
	});

	it('resolves with no cluster argument at all (undefined, the hub-route case)', () => {
		const rollout = consumerRollout('');
		expect(graphNodeForRollout(graph, rollout)?.cluster).toBe('');
	});

	it(
		"⛔ THE REGRESSION THIS GUARDS: a caller passing its own " +
			"`localClusterName` (never ''), the page's display convention for " +
			"'here', must NOT be allowed to break the single-candidate match " +
			'— `cluster` is a tie-breaker, read only when more than one node ' +
			'shares this namespace+name, never a filter on a graph that already ' +
			'has exactly one.',
		() => {
			const rollout = consumerRollout('');
			const node = graphNodeForRollout(graph, rollout, undefined, 'localClusterName');
			expect(node?.cluster).toBe('');
			expect(node).not.toBeNull();
		}
	);
});
