import { describe, it, expect } from 'vitest';
import type { RolloutDependency } from '../../types';
import {
	buildDependencyGraph,
	filterByEnv,
	neighbourhood,
	networkVerdict,
	edgeSentence,
	rankNodes,
	releaseWaves
} from './dependency-graph';

/**
 * A dependency object, shaped like the live cluster's. Defaults reproduce
 * `hello-dep-<env>` / `hello-frontend-needs-api` exactly: consumer `frontend`,
 * provider `api`, contract `api`, `Satisfied=False` with the deployed
 * `1.66.0` short of `^1.67.0`.
 */
function dep(over: {
	ns?: string;
	consumer?: string;
	provider?: string;
	contract?: string;
	satisfied?: 'True' | 'False' | 'Unknown' | null;
	blocked?: { tag: string; requiredVersion?: string; reason?: string }[];
	providedVersion?: string | null;
	cluster?: string;
} = {}): RolloutDependency {
	const {
		ns = 'hello-dep-prod',
		consumer = 'frontend',
		provider = 'api',
		contract = 'api',
		satisfied = 'False',
		blocked = [{ tag: 'rel-67', requiredVersion: '^1.67.0', reason: 'ConstraintNotSatisfied' }],
		providedVersion = '1.66.0',
		cluster = 'prod'
	} = over;
	return {
		metadata: {
			name: `${consumer}-needs-${contract}`,
			namespace: ns,
			annotations: { 'rollout-dashboard.kuberik.com/source-cluster': cluster }
		},
		spec: { rolloutRef: { name: consumer }, providerRef: { name: provider, namespace: ns }, contract },
		status: {
			gateName: `dependency-${consumer}-needs-${contract}`,
			providedVersion: providedVersion ?? undefined,
			providedTag: providedVersion ? 'rel-66' : undefined,
			blockedReleases: blocked,
			conditions: [
				{ type: 'Ready', status: 'True', reason: 'GateSynced' },
				...(satisfied
					? [
							{
								type: 'Satisfied' as const,
								status: satisfied,
								reason: satisfied === 'True' ? 'AllAdmitted' : 'WaitingForProvider',
								message: `Waiting for ${ns}/${provider} to serve contract "${contract}"`
							}
						]
					: [])
			]
		}
	};
}

const ENV_OF = (ns: string) =>
	ns.endsWith('-dev') ? 'dev' : ns.endsWith('-staging') ? 'staging' : ns.endsWith('-prod') ? 'prod' : null;
const ORDER = ['dev', 'staging', 'prod'];

function build(deps: RolloutDependency[], known: string[] = ['api', 'frontend']) {
	return buildDependencyGraph({ deps, envOf: ENV_OF, envOrder: ORDER, knownRollouts: known });
}

// =========================================================================

describe('buildDependencyGraph — the node is a SERVICE, not (service, env)', () => {
	it('folds three identical per-namespace dependencies into ONE edge', () => {
		// This is the live cluster: hello-dep-dev / -staging / -prod all carry
		// the same spec. A (service, environment) model would draw three.
		const g = build([
			dep({ ns: 'hello-dep-dev', cluster: 'dev' }),
			dep({ ns: 'hello-dep-staging', cluster: 'dev' }),
			dep({ ns: 'hello-dep-prod', cluster: 'prod' })
		]);
		expect(g.nodes.map((n) => n.id)).toEqual(['api', 'frontend']);
		expect(g.edges).toHaveLength(1);
		expect(g.edges[0].envs.map((e) => e.env)).toEqual(['dev', 'staging', 'prod']);
	});

	it('points from provider to consumer — the release order', () => {
		const g = build([dep()]);
		expect(g.edges[0].from).toBe('api');
		expect(g.edges[0].to).toBe('frontend');
	});

	it('orders the per-environment readings by promotion order, not arrival', () => {
		const g = build([
			dep({ ns: 'hello-dep-prod' }),
			dep({ ns: 'hello-dep-dev' }),
			dep({ ns: 'hello-dep-staging' })
		]);
		expect(g.edges[0].envs.map((e) => e.env)).toEqual(['dev', 'staging', 'prod']);
	});

	it('keeps cluster attribution per environment', () => {
		const g = build([
			dep({ ns: 'hello-dep-dev', cluster: 'dev' }),
			dep({ ns: 'hello-dep-prod', cluster: 'prod' })
		]);
		expect(g.edges[0].envs.map((e) => e.cluster)).toEqual(['dev', 'prod']);
	});

	it('labels a dependency in an unbound namespace by its namespace, never drops it', () => {
		const g = build([dep({ ns: 'weird-ns' })]);
		expect(g.edges[0].envs[0].env).toBe('weird-ns');
		expect(g.envs).toContain('weird-ns');
	});

	it('separates two contracts between the same pair of services', () => {
		const g = build([dep({ contract: 'api' }), dep({ contract: 'events' })]);
		expect(g.edges).toHaveLength(2);
		expect(g.edges.map((e) => e.contract).sort()).toEqual(['api', 'events']);
	});

	it('defaults the contract to the provider name, as the CRD does', () => {
		const d = dep();
		// @ts-expect-error — exercising the CRD's optional contract
		delete d.spec.contract;
		const g = build([d]);
		expect(g.edges[0].contract).toBe('api');
	});

	it('marks a provider the payload does not carry as unresolved', () => {
		const g = build([dep()], ['frontend']);
		expect(g.nodes.find((n) => n.id === 'api')?.unresolved).toBe(true);
		expect(g.nodes.find((n) => n.id === 'frontend')?.unresolved).toBe(false);
	});
});

describe('edge state — `Satisfied` is the predicate, and absence is not health', () => {
	it('is blocked when any environment is blocked', () => {
		const g = build([
			dep({ ns: 'hello-dep-dev', satisfied: 'True', blocked: [] }),
			dep({ ns: 'hello-dep-prod', satisfied: 'False' })
		]);
		expect(g.edges[0].state).toBe('blocked');
		expect(g.edges[0].blockedEnvs).toEqual(['prod']);
	});

	it('is satisfied only when every environment is', () => {
		const g = build([
			dep({ ns: 'hello-dep-dev', satisfied: 'True', blocked: [] }),
			dep({ ns: 'hello-dep-prod', satisfied: 'True', blocked: [] })
		]);
		expect(g.edges[0].state).toBe('satisfied');
		expect(g.edges[0].blockedEnvs).toEqual([]);
	});

	it('⛔ a MISSING Satisfied condition is `unknown`, never `satisfied`', () => {
		const g = build([dep({ satisfied: null, blocked: [] })]);
		expect(g.edges[0].state).toBe('unknown');
		expect(g.edges[0].unknownEnvs).toEqual(['prod']);
	});

	it('treats Satisfied=Unknown as unknown too', () => {
		const g = build([dep({ satisfied: 'Unknown', blocked: [] })]);
		expect(g.edges[0].state).toBe('unknown');
	});

	it('a blocked environment outranks an unevaluated one in the rollup', () => {
		const g = build([
			dep({ ns: 'hello-dep-dev', satisfied: null, blocked: [] }),
			dep({ ns: 'hello-dep-prod', satisfied: 'False' })
		]);
		expect(g.edges[0].state).toBe('blocked');
	});

	it('prints the constraint only when every blocked environment agrees', () => {
		const same = build([
			dep({ ns: 'hello-dep-dev' }),
			dep({ ns: 'hello-dep-prod' })
		]);
		expect(same.edges[0].requiredVersion).toBe('^1.67.0');
		const differs = build([
			dep({ ns: 'hello-dep-dev' }),
			dep({
				ns: 'hello-dep-prod',
				blocked: [{ tag: 'rel-70', requiredVersion: '^2.0.0' }]
			})
		]);
		expect(differs.edges[0].requiredVersion).toBeNull();
	});

	it('prints one provider version only when the environments agree', () => {
		const same = build([dep({ ns: 'hello-dep-dev' }), dep({ ns: 'hello-dep-prod' })]);
		expect(same.edges[0].providedVersion).toBe('1.66.0');
		expect(same.edges[0].providedVaries).toBe(false);
		const differs = build([
			dep({ ns: 'hello-dep-dev', providedVersion: '1.67.0' }),
			dep({ ns: 'hello-dep-prod', providedVersion: '1.66.0' })
		]);
		expect(differs.edges[0].providedVersion).toBeNull();
		expect(differs.edges[0].providedVaries).toBe(true);
	});
});

describe('node rollups', () => {
	it('marks the consumer blocked and the provider blocking', () => {
		const g = build([dep()]);
		expect(g.nodes.find((n) => n.id === 'frontend')).toMatchObject({
			blocked: true,
			blocking: false,
			providers: ['api'],
			blockedEnvs: ['prod']
		});
		expect(g.nodes.find((n) => n.id === 'api')).toMatchObject({
			blocked: false,
			blocking: true,
			consumers: ['frontend']
		});
	});

	it('unions a node`s blocked environments across its inbound edges, in order', () => {
		const g = build(
			[
				dep({ ns: 'hello-dep-prod', provider: 'api' }),
				dep({ ns: 'hello-dep-dev', provider: 'auth', contract: 'auth' })
			],
			['api', 'auth', 'frontend']
		);
		expect(g.nodes.find((n) => n.id === 'frontend')?.blockedEnvs).toEqual(['dev', 'prod']);
	});
});

describe('cycles render — they are not assumed away and not hidden', () => {
	it('marks exactly one back edge on a two-cycle and keeps both edges', () => {
		const g = build(
			[dep({ consumer: 'b', provider: 'a', contract: 'x' }), dep({ consumer: 'a', provider: 'b', contract: 'y' })],
			['a', 'b']
		);
		expect(g.edges).toHaveLength(2);
		expect(g.edges.filter((e) => e.cyclic)).toHaveLength(1);
		expect(g.hasCycle).toBe(true);
	});

	it('marks a self-loop as cyclic rather than ranking it forever', () => {
		const g = build([dep({ consumer: 'a', provider: 'a', contract: 'x' })], ['a']);
		expect(g.edges[0].cyclic).toBe(true);
		expect(rankNodes(g).get('a')).toBe(0);
	});

	it('breaks a three-cycle deterministically across runs', () => {
		const mk = () =>
			build(
				[
					dep({ consumer: 'b', provider: 'a', contract: 'x' }),
					dep({ consumer: 'c', provider: 'b', contract: 'y' }),
					dep({ consumer: 'a', provider: 'c', contract: 'z' })
				],
				['a', 'b', 'c']
			);
		const first = mk().edges.filter((e) => e.cyclic).map((e) => e.key);
		const second = mk().edges.filter((e) => e.cyclic).map((e) => e.key);
		expect(first).toEqual(second);
		expect(first).toHaveLength(1);
	});
});

describe('ranking is RELEASE ORDER — longest path, not shortest', () => {
	it('puts a service after everything it waits on, however deep', () => {
		// a → b → c and a → c. `c` must be in wave 2, not wave 1.
		const g = build(
			[
				dep({ consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ consumer: 'c', provider: 'b', contract: 'bc' }),
				dep({ consumer: 'c', provider: 'a', contract: 'ac' })
			],
			['a', 'b', 'c']
		);
		const r = rankNodes(g);
		expect(r.get('a')).toBe(0);
		expect(r.get('b')).toBe(1);
		expect(r.get('c')).toBe(2);
	});

	it('gives an isolated pair one provider rank and one consumer rank', () => {
		const r = rankNodes(build([dep()]));
		expect(r.get('api')).toBe(0);
		expect(r.get('frontend')).toBe(1);
	});

	it('ignores back edges when ranking', () => {
		const g = build(
			[dep({ consumer: 'b', provider: 'a', contract: 'x' }), dep({ consumer: 'a', provider: 'b', contract: 'y' })],
			['a', 'b']
		);
		const r = rankNodes(g);
		expect([...r.values()].sort()).toEqual([0, 1]);
	});
});

describe('release waves — the phone`s ordering, and it is NOT dagre`s', () => {
	it('puts a service in the earliest wave its providers allow', () => {
		// a → b → c. Three waves, one service each.
		const g = build(
			[
				dep({ consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ consumer: 'c', provider: 'b', contract: 'bc' })
			],
			['a', 'b', 'c']
		);
		expect(releaseWaves(g)).toEqual([['a'], ['b'], ['c']]);
	});

	/**
	 * ⭐ THE REASON THIS FUNCTION SURVIVED THE MOVE TO dagre.
	 *
	 * Measured on this exact shape, dagre's `network-simplex` and `tight-tree`
	 * both return `[[a],[b],[c],[d,x],[e]]` — they push `x` next to `e` because
	 * that shortens the line, which is the right objective for a DRAWING. `x`
	 * waits on nothing, so `Ships 1st` is where it belongs on a page that is
	 * telling somebody what they can deploy this morning.
	 */
	it('puts a service that waits on nothing in wave 0, however late it is consumed', () => {
		const g = build(
			[
				dep({ consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ consumer: 'c', provider: 'b', contract: 'bc' }),
				dep({ consumer: 'd', provider: 'c', contract: 'cd' }),
				dep({ consumer: 'e', provider: 'd', contract: 'de' }),
				dep({ consumer: 'e', provider: 'x', contract: 'xe' })
			],
			['a', 'b', 'c', 'd', 'e', 'x']
		);
		expect(releaseWaves(g)).toEqual([['a', 'x'], ['b'], ['c'], ['d'], ['e']]);
	});

	it('sorts names inside a wave, so two loads of one fleet read identically', () => {
		const g = build(
			[
				dep({ consumer: 'zeta', provider: 'root', contract: 'z' }),
				dep({ consumer: 'alpha', provider: 'root', contract: 'a' }),
				dep({ consumer: 'mid', provider: 'root', contract: 'm' })
			],
			['root', 'zeta', 'alpha', 'mid']
		);
		expect(releaseWaves(g)).toEqual([['root'], ['alpha', 'mid', 'zeta']]);
	});

	it('a cycle still yields waves — every node lands in exactly one', () => {
		const g = build(
			[
				dep({ consumer: 'b', provider: 'a', contract: 'x' }),
				dep({ consumer: 'a', provider: 'b', contract: 'y' })
			],
			['a', 'b']
		);
		const waves = releaseWaves(g);
		expect(waves.flat().sort()).toEqual(['a', 'b']);
		expect(waves).toHaveLength(2);
	});

	it('a self-loop does not push its own node out of the first wave', () => {
		const g = build([dep({ consumer: 'a', provider: 'a', contract: 'x' })], ['a']);
		expect(releaseWaves(g)).toEqual([['a']]);
	});

	it('holds 40 nodes with a fan-out — every node in exactly one wave, deepest last', () => {
		const deps: RolloutDependency[] = [];
		const name = (i: number) => `svc-${String(i).padStart(2, '0')}`;
		for (let i = 1; i < 40; i++) {
			deps.push(
				dep({ consumer: name(i), provider: name(Math.floor((i - 1) / 3)), contract: `c${i}` })
			);
		}
		const g = build(deps, Array.from({ length: 40 }, (_, i) => name(i)));
		const waves = releaseWaves(g);
		expect(waves.flat()).toHaveLength(40);
		expect(new Set(waves.flat()).size).toBe(40);
		expect(waves[0]).toEqual([name(0)]);
		// Every node sits strictly after every provider it waits on.
		const waveOf = new Map<string, number>();
		waves.forEach((w, i) => w.forEach((id) => waveOf.set(id, i)));
		for (const e of g.edges) {
			if (e.cyclic) continue;
			expect(waveOf.get(e.to)!).toBeGreaterThan(waveOf.get(e.from)!);
		}
	});

	it('is deterministic — the same fleet waves identically twice', () => {
		const mk = () =>
			build(
				[
					dep({ consumer: 'b', provider: 'a', contract: 'ab' }),
					dep({ consumer: 'c', provider: 'a', contract: 'ac' }),
					dep({ consumer: 'd', provider: 'b', contract: 'bd' }),
					dep({ consumer: 'd', provider: 'c', contract: 'cd' })
				],
				['a', 'b', 'c', 'd']
			);
		expect(releaseWaves(mk())).toEqual(releaseWaves(mk()));
	});

	it('gives an unresolved provider a wave too — a dangling ref is not dropped', () => {
		// `ghost` is a providerRef the payload carries no Rollout for. It still
		// ships first: the consumer genuinely waits on it, and hiding it would
		// hide a real misconfiguration.
		const g = build([dep({ consumer: 'frontend', provider: 'ghost', contract: 'api' })], [
			'frontend'
		]);
		expect(releaseWaves(g)).toEqual([['ghost'], ['frontend']]);
	});

	it('re-waves the environment slice, not the whole fleet', () => {
		// `b→c` exists only in prod. Filtering to dev leaves `a→b`, so `c` is
		// gone entirely rather than sitting in an empty third wave.
		const g = build(
			[
				dep({ ns: 'hello-dep-dev', consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ ns: 'hello-dep-prod', consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ ns: 'hello-dep-prod', consumer: 'c', provider: 'b', contract: 'bc' })
			],
			['a', 'b', 'c']
		);
		expect(releaseWaves(g)).toEqual([['a'], ['b'], ['c']]);
		expect(releaseWaves(filterByEnv(g, ['dev']))).toEqual([['a'], ['b']]);
	});

	it('returns no waves for an empty network rather than one empty wave', () => {
		expect(releaseWaves(build([]))).toEqual([]);
	});
});

describe('neighbourhood — the same graph at one node`s scale', () => {
	const wide = () =>
		build(
			[
				dep({ consumer: 'frontend', provider: 'api', contract: 'api' }),
				dep({ consumer: 'api', provider: 'db', contract: 'db' }),
				dep({ consumer: 'reports', provider: 'db', contract: 'db2' }),
				dep({ consumer: 'unrelated', provider: 'other', contract: 'z' })
			],
			['frontend', 'api', 'db', 'reports', 'unrelated', 'other']
		);

	it('keeps both ends of the focus node at depth 1', () => {
		const n = neighbourhood(wide(), 'api', 1);
		expect(n.nodes.map((x) => x.id).sort()).toEqual(['api', 'db', 'frontend']);
		expect(n.edges).toHaveLength(2);
	});

	it('reaches a sibling at depth 2', () => {
		const n = neighbourhood(wide(), 'frontend', 2);
		expect(n.nodes.map((x) => x.id).sort()).toEqual(['api', 'db', 'frontend']);
	});

	it('excludes a disconnected component', () => {
		const n = neighbourhood(wide(), 'api', 3);
		expect(n.nodes.map((x) => x.id)).not.toContain('unrelated');
	});

	it('returns an empty graph for a rollout that is in no dependency', () => {
		const n = neighbourhood(wide(), 'nobody', 2);
		expect(n.nodes).toEqual([]);
		expect(n.edges).toEqual([]);
	});
});

describe('filterByEnv — the (service, environment) graph, one layer at a time', () => {
	const threeEnvs = () =>
		build([
			dep({ ns: 'hello-dep-dev', satisfied: 'True', blocked: [] }),
			dep({ ns: 'hello-dep-staging', satisfied: 'True', blocked: [] }),
			dep({ ns: 'hello-dep-prod', satisfied: 'False' })
		]);

	it('an empty selection is every environment — there is no `All` pill', () => {
		const g = threeEnvs();
		expect(filterByEnv(g, [])).toBe(g);
	});

	it('re-derives the edge state for the chosen environment', () => {
		const prod = filterByEnv(threeEnvs(), ['prod']);
		expect(prod.edges[0].state).toBe('blocked');
		const dev = filterByEnv(threeEnvs(), ['dev']);
		expect(dev.edges[0].state).toBe('satisfied');
		expect(dev.blockedEdges).toEqual([]);
	});

	it('⛔ drops an edge with no object in the chosen environment — sparse means absent', () => {
		const g = build([dep({ ns: 'hello-dep-prod' })]);
		expect(filterByEnv(g, ['dev']).edges).toEqual([]);
		expect(filterByEnv(g, ['dev']).nodes).toEqual([]);
	});

	it('re-derives node rollups too', () => {
		const dev = filterByEnv(threeEnvs(), ['dev']);
		expect(dev.nodes.find((n) => n.id === 'frontend')).toMatchObject({
			blocked: false,
			blockedEnvs: []
		});
	});
});

describe('the sentence and the verdict', () => {
	it('names the consumer, the constraint, the provider version and where', () => {
		const g = build([dep({ ns: 'hello-dep-dev' }), dep({ ns: 'hello-dep-prod' })]);
		expect(edgeSentence(g.edges[0])).toBe(
			'frontend needs api ^1.67.0, api serves 1.66.0 — held in dev, prod'
		);
	});

	it('says an unevaluated gate is unevaluated, not satisfied', () => {
		const g = build([dep({ satisfied: null, blocked: [] })]);
		expect(edgeSentence(g.edges[0])).toContain('has not been evaluated');
	});

	it('rolls the network up to blocked-first', () => {
		expect(networkVerdict(build([dep()]))).toEqual({ text: '1 of 1 blocked', tone: 'adverse' });
	});

	it('rolls a healthy network up without claiming anything green', () => {
		const g = build([dep({ satisfied: 'True', blocked: [] })]);
		expect(networkVerdict(g)).toEqual({ text: '1 link satisfied', tone: 'neutral' });
	});

	it('says `no links` for an empty network', () => {
		expect(networkVerdict(build([]))).toEqual({ text: 'no links', tone: 'neutral' });
	});
});
