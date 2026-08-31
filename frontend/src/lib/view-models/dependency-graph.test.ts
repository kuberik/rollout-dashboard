import { describe, it, expect } from 'vitest';
import type { RolloutDependency } from '../../types';
import {
	buildDependencyGraph,
	filterByEnv,
	layoutGraph,
	neighbourhood,
	networkVerdict,
	edgeSentence,
	orderRanks,
	rankNodes
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

	it('lays a cycle out without crashing and keeps every node placed', () => {
		const g = build(
			[dep({ consumer: 'b', provider: 'a', contract: 'x' }), dep({ consumer: 'a', provider: 'b', contract: 'y' })],
			['a', 'b']
		);
		const l = layoutGraph(g);
		expect(l.nodes).toHaveLength(2);
		expect(l.edges).toHaveLength(2);
		for (const e of l.edges) expect(e.d).toMatch(/^M [\d.]+ [\d.]+ C/);
		// The arc dips below the boxes, and the canvas grew to hold it.
		const arc = l.edges.find((e) => e.cyclic)!;
		expect(l.height).toBeGreaterThan(Math.max(...l.nodes.map((n) => n.y + n.h)));
		expect(arc.labelY).toBeGreaterThan(0);
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

describe('ordering — virtual nodes route long edges around what they cross', () => {
	it('inserts a slot in every rank a long edge crosses', () => {
		const g = build(
			[
				dep({ consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ consumer: 'c', provider: 'b', contract: 'bc' }),
				dep({ consumer: 'c', provider: 'a', contract: 'ac' })
			],
			['a', 'b', 'c']
		);
		const { layers, chains } = orderRanks(g, rankNodes(g), 4);
		// rank 1 holds `b` plus one virtual slot for the a→c edge.
		expect(layers[1].filter((s) => s.real).map((s) => s.id)).toEqual(['b']);
		expect(layers[1].filter((s) => !s.real)).toHaveLength(1);
		expect(chains.get('a c ac')).toHaveLength(3);
	});

	it('bends the long edge`s path through the virtual slot', () => {
		const g = build(
			[
				dep({ consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ consumer: 'c', provider: 'b', contract: 'bc' }),
				dep({ consumer: 'c', provider: 'a', contract: 'ac' })
			],
			['a', 'b', 'c']
		);
		const l = layoutGraph(g);
		const long = l.edges.find((e) => e.key === 'a c ac')!;
		// Two cubic segments, i.e. one intermediate point.
		expect(long.d.match(/C /g)).toHaveLength(2);
	});

	it('is deterministic — the same graph lays out identically twice', () => {
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
		expect(JSON.stringify(layoutGraph(mk()).nodes)).toBe(JSON.stringify(layoutGraph(mk()).nodes));
	});

	it('does not fall apart at 40 nodes — every node placed, no overlap in a column', () => {
		const deps: RolloutDependency[] = [];
		const name = (i: number) => `svc-${String(i).padStart(2, '0')}`;
		for (let i = 1; i < 40; i++) {
			deps.push(
				dep({ consumer: name(i), provider: name(Math.floor((i - 1) / 3)), contract: `c${i}` })
			);
		}
		const g = build(deps, Array.from({ length: 40 }, (_, i) => name(i)));
		const l = layoutGraph(g);
		expect(l.nodes).toHaveLength(40);
		const byRank = new Map<number, number[]>();
		for (const n of l.nodes) byRank.set(n.rank, [...(byRank.get(n.rank) ?? []), n.y]);
		for (const ys of byRank.values()) {
			const sorted = [...ys].sort((a, b) => a - b);
			for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(60);
		}
		expect(l.width).toBeGreaterThan(0);
		expect(l.height).toBeGreaterThan(0);
	});
});

describe('layout geometry', () => {
	it('places providers left of consumers', () => {
		const l = layoutGraph(build([dep()]));
		expect(l.byId.get('api')!.x).toBeLessThan(l.byId.get('frontend')!.x);
	});

	it('centres a short column against the tallest one', () => {
		const g = build(
			[
				dep({ consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ consumer: 'c', provider: 'a', contract: 'ac' })
			],
			['a', 'b', 'c']
		);
		const l = layoutGraph(g);
		const a = l.byId.get('a')!;
		const b = l.byId.get('b')!;
		const c = l.byId.get('c')!;
		expect(a.y + a.h / 2).toBeCloseTo((b.y + c.y + b.h) / 2, 5);
	});

	it('exposes the ranks as waves — the phone`s data', () => {
		const g = build(
			[
				dep({ consumer: 'b', provider: 'a', contract: 'ab' }),
				dep({ consumer: 'c', provider: 'b', contract: 'bc' })
			],
			['a', 'b', 'c']
		);
		expect(layoutGraph(g).waves).toEqual([['a'], ['b'], ['c']]);
	});

	it('returns an empty layout for an empty graph rather than NaN geometry', () => {
		const l = layoutGraph(build([]));
		expect(l).toMatchObject({ nodes: [], edges: [], waves: [], width: 0, height: 0 });
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
