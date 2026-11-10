import { describe, it, expect } from 'vitest';
import type { Rollout, Environment, RolloutDependency } from '../../types';
import { buildRolloutGraph, hasDependencyLinks } from './dependency-graph';
import { rolloutNeighbourhood } from './rollout-neighbourhood';

const ANN = 'rollout-dashboard.kuberik.com/source-cluster';

function rollout(o: {
	name: string;
	ns: string;
	cluster?: string;
	tag?: string;
	candidates?: string[];
	gates?: { name: string; passing?: boolean; allowedVersions?: string[] | null }[];
}): Rollout {
	const tag = o.tag ?? 'r1';
	return {
		metadata: { name: o.name, namespace: o.ns, annotations: { [ANN]: o.cluster ?? 'c' } },
		spec: {},
		status: {
			history: [{ version: { tag, version: tag } }],
			availableReleases: [{ tag, version: tag }, ...(o.candidates ?? []).map((t) => ({ tag: t, version: t }))],
			releaseCandidates: (o.candidates ?? []).map((t) => ({ tag: t, version: t })),
			gates: o.gates ?? []
		}
	} as unknown as Rollout;
}

function env(o: {
	line: string;
	tier: string;
	ns: string;
	rollout: string;
	gate?: string;
	after?: string;
}): Environment {
	return {
		metadata: { name: o.rollout, namespace: o.ns, annotations: { [ANN]: 'c' } },
		spec: {
			name: o.line,
			environment: o.tier,
			rolloutRef: { name: o.rollout }
		},
		status: o.gate ? { rolloutGateRef: { name: o.gate } } : {}
	} as unknown as Environment;
}

function dep(o: {
	ns: string;
	consumer: string;
	provider: string;
	providerNs?: string;
	blocked?: string[];
	satisfied?: boolean;
	gateName?: string | null;
}): RolloutDependency {
	return {
		metadata: { name: `${o.consumer}-needs-x`, namespace: o.ns, annotations: { [ANN]: 'c' } },
		spec: {
			rolloutRef: { name: o.consumer },
			providerRef: { name: o.provider, namespace: o.providerNs ?? o.ns },
			contract: 'x'
		},
		status: {
			...(o.gateName === null ? {} : { gateName: o.gateName ?? `dependency-${o.consumer}-needs-x` }),
			providedVersion: '1.0.0',
			blockedReleases: (o.blocked ?? []).map((tag) => ({ tag, requiredVersion: '^2.0.0' })),
			conditions:
				o.satisfied === undefined
					? []
					: [{ type: 'Satisfied', status: o.satisfied ? 'True' : 'False', reason: 'x', message: '' }]
		}
	} as unknown as RolloutDependency;
}

/** `app` in dev → staging → prod; `api` provides a contract to app in staging. */
function fixture() {
	const environments = [
		env({ line: 'app', tier: 'dev', ns: 'app-dev', rollout: 'app' }),
		env({ line: 'app', tier: 'staging', ns: 'app-staging', rollout: 'app', gate: 'promo-staging', after: 'dev' }),
		env({ line: 'app', tier: 'prod', ns: 'app-prod', rollout: 'app', gate: 'promo-prod', after: 'staging' })
	];
	return { environments };
}

const at = (ns: string, name = 'app') => ({ cluster: 'c', namespace: ns, name });

describe('hasDependencyLinks — the Dependencies tab predicate', () => {
	const { environments } = fixture();

	it('shows the tab on a promotion chain with no RolloutDependency at all (hello-world in dev)', () => {
		for (const ns of ['app-dev', 'app-staging', 'app-prod']) {
			expect(hasDependencyLinks({ namespace: ns, name: 'app', environments, dependencies: [] })).toBe(true);
		}
	});

	it('hides it for a rollout bound to an Environment with no neighbouring Environment either way', () => {
		const lone = [env({ line: 'solo', tier: 'prod', ns: 'solo', rollout: 'solo' })];
		expect(
			hasDependencyLinks({ namespace: 'solo', name: 'solo', environments: lone, dependencies: [] })
		).toBe(false);
	});

	it('draws no edge, and so shows no tab, for a site whose upstream is not visible', () => {
		const orphan = [env({ line: 'o', tier: 'prod', ns: 'o-prod', rollout: 'o', gate: 'g', after: 'staging' })];
		expect(
			hasDependencyLinks({ namespace: 'o-prod', name: 'o', environments: orphan, dependencies: [] })
		).toBe(false);
	});

	it('matches both ends of a contract — consumer and provider', () => {
		const deps = [dep({ ns: 'shop', consumer: 'web', provider: 'api', providerNs: 'platform' })];
		expect(hasDependencyLinks({ namespace: 'shop', name: 'web', environments: [], dependencies: deps })).toBe(true);
		expect(
			hasDependencyLinks({ namespace: 'platform', name: 'api', environments: [], dependencies: deps })
		).toBe(true);
		expect(hasDependencyLinks({ namespace: 'shop', name: 'api', environments: [], dependencies: deps })).toBe(
			false
		);
	});

	it('uses the graph\'s edge rule: a RolloutDependency with no gate yet is no edge, so no tab', () => {
		const deps = [dep({ ns: 'shop', consumer: 'web', provider: 'api', gateName: null })];
		expect(hasDependencyLinks({ namespace: 'shop', name: 'web', environments: [], dependencies: deps })).toBe(false);
		const graph = buildRolloutGraph({ rollouts: [], environments: [], dependencies: deps, envOrder: [] });
		expect(graph.edges).toEqual([]);
	});

	it('matches on cluster too, when the route gives one', () => {
		const deps = [dep({ ns: 'shop', consumer: 'web', provider: 'api' })]; // stamped cluster `c`
		const q = { namespace: 'shop', name: 'web', environments: [], dependencies: deps };
		expect(hasDependencyLinks({ ...q, cluster: 'c' })).toBe(true);
		expect(hasDependencyLinks({ ...q, cluster: 'other' })).toBe(false);
	});
});

describe('rolloutNeighbourhood', () => {
	const { environments } = fixture();

	function hood(rollouts: Rollout[], dependencies: RolloutDependency[] = [], focusNs = 'app-staging') {
		const graph = buildRolloutGraph({
			rollouts,
			environments,
			dependencies,
			envOrder: ['dev', 'staging', 'prod']
		});
		return rolloutNeighbourhood({ graph, at: at(focusNs) });
	}

	it('splits edges into upstream (into the focus) and downstream (out of it)', () => {
		const h = hood([
			rollout({ name: 'app', ns: 'app-dev', tag: 'r2' }),
			rollout({ name: 'app', ns: 'app-staging', gates: [{ name: 'promo-staging', passing: true }] }),
			rollout({ name: 'app', ns: 'app-prod', gates: [{ name: 'promo-prod', passing: true }] })
		]);
		expect(h.focus?.env).toBe('staging');
		expect(h.upstream.map((l) => l.node.env)).toEqual(['dev']);
		expect(h.downstream.map((l) => l.node.env)).toEqual(['prod']);
		expect(h.heldLinks).toBe(0);
		expect(h.heldBuilds).toEqual([]);
	});

	it('names the builds a held promotion edge is holding, from the gate itself — but never counts it, dev is a CHAIN predecessor of staging', () => {
		// ⭐ qa11 correction (squad-rollout gates-2 follow-up, 2026-10-11):
		// `dev` is an EARLIER tier than `staging`, so this edge is plain
		// chain sequencing — staging has simply not reached these builds
		// yet, never a hold ON staging. The per-edge fields (`state`/`held`)
		// still name exactly what the gate refuses (a caller composing
		// "Waits for dev" still needs the build id), but the AGGREGATE
		// rollups (`heldBuilds`/`heldLinks`) must not count it — see
		// `NeighbourLink.chainPredecessor`'s own doc comment.
		const h = hood([
			rollout({ name: 'app', ns: 'app-dev', tag: 'r1' }),
			rollout({
				name: 'app',
				ns: 'app-staging',
				candidates: ['r3', 'r2'],
				gates: [{ name: 'promo-staging', allowedVersions: [] }]
			}),
			rollout({ name: 'app', ns: 'app-prod' })
		]);
		const up = h.upstream[0];
		expect(up.state).toBe('blocked');
		expect(up.held).toEqual(['r3', 'r2']);
		expect(up.chainPredecessor).toBe(true);
		expect(h.heldBuilds).toEqual([]);
		expect(h.heldLinks).toBe(0);
	});

	it('only counts the builds THIS gate refuses, not every candidate', () => {
		const h = hood([
			rollout({ name: 'app', ns: 'app-dev' }),
			rollout({
				name: 'app',
				ns: 'app-staging',
				candidates: ['r3', 'r2'],
				// promo refuses r3 only; another rule refuses r2. Nothing can
				// deploy, the newest is refused by promo, so promo is holding —
				// but only r3 is ITS refusal.
				gates: [
					{ name: 'promo-staging', allowedVersions: ['r2'] },
					{ name: 'other', allowedVersions: ['r3'] }
				]
			}),
			rollout({ name: 'app', ns: 'app-prod' })
		]);
		expect(h.upstream[0].held).toEqual(['r3']);
	});

	it('reads an unpublished contract gate off its RolloutDependency, wanted builds only — in the GRAPH', () => {
		const rollouts = [
			rollout({ name: 'app', ns: 'app-dev' }),
			// Gate NOT on status.gates — the graph alone says `unknown`.
			rollout({ name: 'app', ns: 'app-staging', candidates: ['r3'] }),
			rollout({ name: 'app', ns: 'app-prod' }),
			rollout({ name: 'api', ns: 'app-staging' })
		];
		const held = hood(rollouts, [
			dep({ ns: 'app-staging', consumer: 'app', provider: 'api', blocked: ['r3', 'r0'] })
		]);
		const contract = held.upstream.find((l) => l.writer === 'contract')!;
		expect(contract.state).toBe('blocked');
		expect(contract.held).toEqual(['r3']); // r0 is history, not a hold
		// Held edges sort first.
		expect(held.upstream[0]).toBe(contract);

		// `/dependencies` draws the graph, not the neighbourhood: the edge
		// itself carries the state and the held builds, so the two pages
		// cannot disagree.
		const graph = buildRolloutGraph({
			rollouts,
			environments,
			dependencies: [dep({ ns: 'app-staging', consumer: 'app', provider: 'api', blocked: ['r3', 'r0'] })],
			envOrder: ['dev', 'staging', 'prod']
		});
		const edge = graph.edges.find((e) => e.writer === 'contract')!;
		expect(edge.state).toBe('blocked');
		expect(edge.held).toEqual(['r3']);
		expect(graph.blockedEdges).toContain(edge);

		// Refusing only a build the rollout is past: clear only on the
		// controller's own `Satisfied=True`, otherwise still unread.
		const past = hood(rollouts, [
			dep({ ns: 'app-staging', consumer: 'app', provider: 'api', blocked: ['r0'], satisfied: true })
		]);
		expect(past.upstream.find((l) => l.writer === 'contract')!.state).toBe('clear');
		const silent = hood(rollouts, [dep({ ns: 'app-staging', consumer: 'app', provider: 'api', blocked: ['r0'] })]);
		expect(silent.upstream.find((l) => l.writer === 'contract')!.state).toBe('unknown');
	});

	it('shows the provider side: the held consumer is a downstream link of the provider', () => {
		const rollouts = [
			rollout({ name: 'app', ns: 'app-staging', candidates: ['r3'] }),
			rollout({ name: 'api', ns: 'app-staging' })
		];
		const graph = buildRolloutGraph({
			rollouts,
			environments: [],
			dependencies: [dep({ ns: 'app-staging', consumer: 'app', provider: 'api', blocked: ['r3'] })],
			envOrder: []
		});
		const h = rolloutNeighbourhood({ graph, at: at('app-staging', 'api') });
		expect(h.upstream).toEqual([]);
		expect(h.downstream).toHaveLength(1);
		expect(h.downstream[0].held).toEqual(['r3']);
		// The focus itself holds nothing of its own.
		expect(h.heldBuilds).toEqual([]);
	});

	it('matches the focus on cluster, not namespace and name alone', () => {
		const graph = buildRolloutGraph({
			rollouts: [rollout({ name: 'app', ns: 'app-dev' }), rollout({ name: 'app', ns: 'app-staging' })],
			environments,
			dependencies: [],
			envOrder: ['dev', 'staging', 'prod']
		});
		// Stamped `c`: found on `c`, not on another cluster with the same ns/name.
		expect(rolloutNeighbourhood({ graph, at: at('app-staging') }).focus?.namespace).toBe('app-staging');
		expect(
			rolloutNeighbourhood({ graph, at: { cluster: 'other', namespace: 'app-staging', name: 'app' } }).focus
		).toBeNull();
	});

	it('places an unstamped (hub-local) node on the hub cluster, or the route\'s when that is unknown', () => {
		const local = (r: Rollout) => {
			r.metadata!.annotations = {};
			return r;
		};
		const localEnvs = environments.map((e) => ({ ...e, metadata: { ...e.metadata, annotations: {} } })) as Environment[];
		const graph = buildRolloutGraph({
			rollouts: [local(rollout({ name: 'app', ns: 'app-dev' })), local(rollout({ name: 'app', ns: 'app-staging' }))],
			environments: localEnvs,
			dependencies: [],
			envOrder: ['dev', 'staging', 'prod']
		});
		const q = { cluster: 'hub', namespace: 'app-staging', name: 'app' };
		expect(rolloutNeighbourhood({ graph, at: q }).focus?.namespace).toBe('app-staging');
		expect(rolloutNeighbourhood({ graph, at: q, localCluster: 'hub' }).focus?.namespace).toBe('app-staging');
		expect(rolloutNeighbourhood({ graph, at: q, localCluster: 'spoke' }).focus).toBeNull();
	});

	it('is empty for a rollout that is not in the graph', () => {
		const h = hood([rollout({ name: 'app', ns: 'app-dev' })], [], 'nowhere');
		expect(h.focus).toBeNull();
		expect(h.upstream).toEqual([]);
	});
});
