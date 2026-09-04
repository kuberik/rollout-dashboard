import { describe, it, expect } from 'vitest';
import type { Rollout, Environment, RolloutDependency } from '../../types';
import { buildGateContext } from './blocking-story';
import {
	buildRolloutGraph,
	filterByEnv,
	neighbourhood,
	networkVerdict,
	edgeSentence,
	heldSubjects,
	heldClause,
	layoutOrder,
	nodeId,
	namespacesByCluster,
	withNetworkSchedules,
	type GraphEdge,
	type GraphNode
} from './dependency-graph';

/**
 * FIXTURES SHAPED LIKE THE LIVE CLUSTER, verified against
 * `GET /api/rollouts` on 2026-08-31:
 *
 *   · `hello-api-app` and `hello-frontend-app` in `hello-dep-{dev,staging,prod}`
 *   · dev has no relationship, staging is `After dev`, prod is `After staging`
 *   · `hello-frontend-needs-api` exists once per namespace, `^1.67.0` against a
 *     served `1.66.0`
 *   · dev/staging come from the SPOKE cluster and prod from the HUB, which is
 *     why the promotion join must not be cluster-scoped
 */
const CLUSTER = { dev: 'dev', staging: 'dev', prod: 'prod' } as const;
const ORDER = ['dev', 'staging', 'prod'];

function ann(cluster: string) {
	return { 'rollout-dashboard.kuberik.com/source-cluster': cluster };
}

function rollout(over: {
	name: string;
	ns: string;
	cluster: string;
	tag?: string;
	/** Newer builds available. Empty means nothing could promote anyway. */
	candidates?: string[];
	gates?: { name: string; passing?: boolean; allowedVersions?: string[] | null }[];
	wantedVersion?: string;
}): Rollout {
	const tag = over.tag ?? 'rel-66';
	return {
		metadata: { name: over.name, namespace: over.ns, annotations: ann(over.cluster) },
		spec: over.wantedVersion ? { wantedVersion: over.wantedVersion } : {},
		status: {
			history: [{ version: { tag, version: tag } }],
			availableReleases: [{ tag, version: tag }, ...(over.candidates ?? []).map((t) => ({ tag: t, version: t }))],
			releaseCandidates: (over.candidates ?? []).map((t) => ({ tag: t, version: t })),
			gates: over.gates ?? []
		}
	} as unknown as Rollout;
}

function environment(over: {
	line: string;
	tier: keyof typeof CLUSTER;
	ns: string;
	rollout: string;
	gate: string;
	after?: string;
	relType?: 'After' | 'Parallel';
}): Environment {
	return {
		metadata: { name: over.rollout, namespace: over.ns, annotations: ann(CLUSTER[over.tier]) },
		spec: {
			name: over.line,
			environment: over.tier,
			rolloutRef: { name: over.rollout },
			backend: { type: 'github', project: 'x/y' },
			...(over.after ? { relationship: { environment: over.after, type: over.relType ?? 'After' } } : {})
		},
		status: { rolloutGateRef: { name: over.gate } }
	} as unknown as Environment;
}

function dep(over: {
	ns: string;
	cluster: string;
	consumer?: string;
	provider?: string;
	contract?: string;
	satisfied?: 'True' | 'False' | null;
	providedVersion?: string | null;
	blocked?: { tag: string; requiredVersion?: string; reason?: string }[];
}): RolloutDependency {
	const consumer = over.consumer ?? 'hello-frontend-app';
	const provider = over.provider ?? 'hello-api-app';
	const contract = over.contract ?? 'api';
	return {
		metadata: {
			name: `${consumer}-needs-${contract}`,
			namespace: over.ns,
			annotations: ann(over.cluster)
		},
		spec: {
			rolloutRef: { name: consumer },
			providerRef: { name: provider, namespace: over.ns },
			contract
		},
		status: {
			gateName: `dependency-${consumer}-needs-${contract}`,
			providedVersion: over.providedVersion === null ? undefined : (over.providedVersion ?? '1.66.0'),
			blockedReleases: over.blocked ?? [
				{ tag: 'rel-67', requiredVersion: '^1.67.0', reason: 'ConstraintNotSatisfied' }
			],
			conditions: [
				{ type: 'Ready', status: 'True', reason: 'GateSynced' },
				...(over.satisfied === null
					? []
					: [
							{
								type: 'Satisfied' as const,
								status: over.satisfied ?? 'False',
								reason: 'WaitingForProvider',
								message: `Waiting for ${over.ns}/${provider} to serve "${contract}"`
							}
						])
			]
		}
	} as unknown as RolloutDependency;
}

/** The live fleet's two-service, three-environment shape. */
function liveFixture() {
	const gates = {
		apiDev: 'ghd-hbznh',
		apiStaging: 'ghd-cdtgv',
		apiProd: 'ghd-n9wpr',
		feDev: 'ghd-dptmm',
		feStaging: 'ghd-9qcnj',
		feProd: 'ghd-5b2wn'
	};
	const depGate = 'dependency-hello-frontend-app-needs-api';
	const rollouts: Rollout[] = [
		rollout({ name: 'hello-api-app', ns: 'hello-dep-dev', cluster: 'dev', gates: [{ name: gates.apiDev, passing: true, allowedVersions: null }] }),
		rollout({ name: 'hello-api-app', ns: 'hello-dep-staging', cluster: 'dev', gates: [{ name: gates.apiStaging, passing: true, allowedVersions: [] }] }),
		rollout({ name: 'hello-api-app', ns: 'hello-dep-prod', cluster: 'prod', gates: [{ name: gates.apiProd, passing: true, allowedVersions: [] }] }),
		// The consumer has a newer build it cannot take: the contract gate
		// admits only `rel-66`, which it is already running.
		rollout({
			name: 'hello-frontend-app',
			ns: 'hello-dep-dev',
			cluster: 'dev',
			candidates: ['rel-67'],
			gates: [
				{ name: depGate, passing: true, allowedVersions: ['rel-66'] },
				{ name: gates.feDev, passing: true, allowedVersions: null }
			]
		}),
		rollout({
			name: 'hello-frontend-app',
			ns: 'hello-dep-staging',
			cluster: 'dev',
			candidates: ['rel-67'],
			gates: [
				{ name: depGate, passing: true, allowedVersions: ['rel-66'] },
				{ name: gates.feStaging, passing: true, allowedVersions: [] }
			]
		}),
		rollout({
			name: 'hello-frontend-app',
			ns: 'hello-dep-prod',
			cluster: 'prod',
			candidates: ['rel-67'],
			gates: [
				{ name: depGate, passing: true, allowedVersions: ['rel-66'] },
				{ name: gates.feProd, passing: true, allowedVersions: [] }
			]
		})
	];
	const environments: Environment[] = [
		environment({ line: 'hello-dep-api-app', tier: 'dev', ns: 'hello-dep-dev', rollout: 'hello-api-app', gate: gates.apiDev }),
		environment({ line: 'hello-dep-api-app', tier: 'staging', ns: 'hello-dep-staging', rollout: 'hello-api-app', gate: gates.apiStaging, after: 'dev' }),
		environment({ line: 'hello-dep-api-app', tier: 'prod', ns: 'hello-dep-prod', rollout: 'hello-api-app', gate: gates.apiProd, after: 'staging' }),
		environment({ line: 'hello-dep-frontend-app', tier: 'dev', ns: 'hello-dep-dev', rollout: 'hello-frontend-app', gate: gates.feDev }),
		environment({ line: 'hello-dep-frontend-app', tier: 'staging', ns: 'hello-dep-staging', rollout: 'hello-frontend-app', gate: gates.feStaging, after: 'dev' }),
		environment({ line: 'hello-dep-frontend-app', tier: 'prod', ns: 'hello-dep-prod', rollout: 'hello-frontend-app', gate: gates.feProd, after: 'staging' })
	];
	const dependencies: RolloutDependency[] = [
		dep({ ns: 'hello-dep-dev', cluster: 'dev' }),
		dep({ ns: 'hello-dep-staging', cluster: 'dev' }),
		dep({ ns: 'hello-dep-prod', cluster: 'prod' })
	];
	return { rollouts, environments, dependencies, gates, depGate };
}

function build(f = liveFixture()) {
	return buildRolloutGraph({
		rollouts: f.rollouts,
		environments: f.environments,
		dependencies: f.dependencies,
		envOrder: ORDER,
		gates: buildGateContext({
			environments: { items: f.environments },
			rolloutDependencies: { items: f.dependencies }
		})
	});
}

const ID = {
	apiDev: nodeId('dev', 'hello-dep-dev', 'hello-api-app'),
	apiStaging: nodeId('dev', 'hello-dep-staging', 'hello-api-app'),
	apiProd: nodeId('prod', 'hello-dep-prod', 'hello-api-app'),
	feDev: nodeId('dev', 'hello-dep-dev', 'hello-frontend-app'),
	feStaging: nodeId('dev', 'hello-dep-staging', 'hello-frontend-app'),
	feProd: nodeId('prod', 'hello-dep-prod', 'hello-frontend-app')
};

// =========================================================================

describe('the node is a ROLLOUT — a (service, environment)', () => {
	it('draws one node per rollout, not one per service', () => {
		const g = build();
		expect(g.nodes).toHaveLength(6);
		expect(g.nodes.map((n) => n.id).sort()).toEqual(Object.values(ID).sort());
	});

	it('reads the environment off the Environment object, never off the namespace name', () => {
		const g = build();
		expect(g.nodes.find((n) => n.id === ID.feStaging)?.env).toBe('staging');
		expect(g.envs).toEqual(['dev', 'staging', 'prod']);
	});

	it('carries the deployed build, which is what makes a promotion edge readable', () => {
		const g = build();
		for (const n of g.nodes) expect(n.build).toBe('rel-66');
	});
});

describe('ONE edge collection, with the writer as an attribute', () => {
	it('holds both kinds in `edges` — nothing is joined at render time', () => {
		const g = build();
		const kinds = g.edges.map((e) => e.writer);
		expect(kinds.filter((k) => k === 'promotion')).toHaveLength(4);
		expect(kinds.filter((k) => k === 'contract')).toHaveLength(3);
	});

	it('points a promotion edge from the UPSTREAM rollout to the one that waits', () => {
		const g = build();
		const e = g.edges.find((x) => x.writer === 'promotion' && x.to === ID.feProd);
		expect(e?.from).toBe(ID.feStaging);
		expect(e?.relType).toBe('After');
	});

	it('joins the promotion line on Environment.spec.name ACROSS clusters', () => {
		// dev/staging are on the spoke and prod on the hub. A cluster-scoped
		// join loses staging → prod, which is the most important edge here.
		const g = build();
		const e = g.edges.find((x) => x.writer === 'promotion' && x.to === ID.apiProd);
		expect(e?.from).toBe(ID.apiStaging);
	});

	it('points a contract edge from the provider to the consumer, inside ONE environment', () => {
		const g = build();
		const e = g.edges.find((x) => x.writer === 'contract' && x.to === ID.feDev);
		expect(e?.from).toBe(ID.apiDev);
		expect(e?.contract).toBe('api');
		expect(e?.requiredVersion).toBe('^1.67.0');
		expect(e?.providedVersion).toBe('1.66.0');
	});

	it('does not draw a promotion edge when the upstream Environment is not visible', () => {
		const f = liveFixture();
		// Drop the staging half of the api line. prod still has a gate holding
		// it, but there is no rollout to draw an arrow from.
		f.environments = f.environments.filter(
			(e) => !(e.spec?.name === 'hello-dep-api-app' && e.spec?.environment === 'staging')
		);
		const g = build(f);
		expect(g.edges.some((e) => e.writer === 'promotion' && e.to === ID.apiProd)).toBe(false);
	});
});

describe('the adverse predicate is `promotionBlock`, for BOTH kinds', () => {
	it('marks prod frontend held by its promotion edge AND its contract edge', () => {
		// This is the sentence the whole page exists for: prod is blocked
		// because staging has not deployed AND because the api it needs is a
		// version behind.
		const g = build();
		const into = g.edges.filter((e) => e.to === ID.feProd);
		expect(into).toHaveLength(2);
		expect(into.every((e) => e.state === 'blocked')).toBe(true);
		expect(into.map((e) => e.writer).sort()).toEqual(['contract', 'promotion']);
	});

	it('does NOT call a gate blocked when the rollout has no build it could take', () => {
		// `hello-api-app` in prod has an empty allow-list, which refuses
		// everything — and it has nothing to refuse. The gate is working.
		const g = build();
		expect(g.edges.find((e) => e.to === ID.apiProd)?.state).toBe('clear');
	});

	it('is `unknown`, never `clear`, when the gated rollout is not in the payload', () => {
		const f = liveFixture();
		f.rollouts = f.rollouts.filter((r) => r.metadata?.namespace !== 'hello-dep-prod');
		const g = build(f);
		const into = g.edges.filter((e) => e.to === ID.feProd);
		expect(into.every((e) => e.state === 'unknown')).toBe(true);
		expect(g.nodes.find((n) => n.id === ID.feProd)?.unresolved).toBe(true);
	});

	it('is `unknown` when the rollout publishes no summary for the gate the CRD names', () => {
		const f = liveFixture();
		const fe = f.rollouts.find(
			(r) => r.metadata?.name === 'hello-frontend-app' && r.metadata?.namespace === 'hello-dep-dev'
		)!;
		// The contract gate vanishes from the rollout's own status.
		(fe.status as { gates?: unknown[] }).gates = [
			{ name: 'ghd-dptmm', passing: true, allowedVersions: null }
		];
		const g = build(f);
		expect(g.edges.find((e) => e.writer === 'contract' && e.to === ID.feDev)?.state).toBe(
			'unknown'
		);
	});
});

describe('a gate with no far end is a HOLD on the node, never a phantom edge', () => {
	it('records a schedule gate on the node and draws no edge for it', () => {
		const f = liveFixture();
		const fe = f.rollouts.find(
			(r) =>
				r.metadata?.name === 'hello-frontend-app' && r.metadata?.namespace === 'hello-dep-staging'
		)!;
		(fe.status as { gates?: unknown[] }).gates = [
			{ name: 'schedule-gate-nwm62', passing: false, allowedVersions: null },
			{ name: 'ghd-9qcnj', passing: true, allowedVersions: [] }
		];
		const g = build(f);
		const n = g.nodes.find((x) => x.id === ID.feStaging)!;
		expect(n.holds.map((h) => h.gate)).toContain('schedule-gate-nwm62');
		expect(g.edges.some((e) => e.gate === 'schedule-gate-nwm62')).toBe(false);
	});

	it('is not RED for a clock alone — amber means stuck and a clock is not stuck', () => {
		const f = liveFixture();
		const world = rollout({
			name: 'hello-world-app',
			ns: 'hello-world-staging',
			cluster: 'dev',
			candidates: ['main-2'],
			gates: [{ name: 'schedule-gate-nwm62', passing: false, allowedVersions: null }]
		});
		f.rollouts.push(world);
		f.environments.push(
			environment({
				line: 'hello-world-app',
				tier: 'staging',
				ns: 'hello-world-staging',
				rollout: 'hello-world-app',
				gate: 'ghd-p2fld',
				after: 'dev'
			}),
			environment({
				line: 'hello-world-app',
				tier: 'dev',
				ns: 'hello-world-dev',
				rollout: 'hello-world-app',
				gate: 'ghd-pnb8h'
			})
		);
		f.rollouts.push(
			rollout({ name: 'hello-world-app', ns: 'hello-world-dev', cluster: 'dev', gates: [] })
		);
		const g = build(f);
		const n = g.nodes.find(
			(x) => x.id === nodeId('dev', 'hello-world-staging', 'hello-world-app')
		)!;
		expect(n.waiting).toBe(true);
		expect(n.blocked).toBe(false);
		expect(n.holds.map((h) => h.clears)).toEqual(['check']);
	});

	it('states a pin, which outranks every gate and publishes none', () => {
		const f = liveFixture();
		const fe = f.rollouts.find(
			(r) => r.metadata?.name === 'hello-frontend-app' && r.metadata?.namespace === 'hello-dep-dev'
		)!;
		(fe.spec as { wantedVersion?: string }).wantedVersion = 'rel-66';
		const g = build(f);
		const n = g.nodes.find((x) => x.id === ID.feDev)!;
		expect(n.holds).toEqual([
			{ gate: 'rel-66', clears: 'person', short: 'Pinned to rel-66', clearsAt: null }
		]);
	});

	/**
	 * ⛔ THE RAW OCI TAG NEVER PRINTS. (2026-09-02) `spec.wantedVersion` is a
	 * 60-character tag like `main-1788002370-0afab6f1234567890abcdef12345678`,
	 * while every other surface (`/apps`, rollout detail) names the same build
	 * by its short sha. This node printed the raw tag in full because it read
	 * `story.pinnedTo` straight into the sentence instead of going through
	 * `displayVersionForTag`, the one lookup the rest of the product uses.
	 */
	it('shortens a pinned OCI tag the same way every other surface does', () => {
		const f = liveFixture();
		const fe = f.rollouts.find(
			(r) => r.metadata?.name === 'hello-frontend-app' && r.metadata?.namespace === 'hello-dep-dev'
		)!;
		const tag = 'main-1788002370-0afab6f1234567890abcdef12345678';
		(fe.spec as { wantedVersion?: string }).wantedVersion = tag;
		const g = build(f);
		const n = g.nodes.find((x) => x.id === ID.feDev)!;
		expect(n.holds).toEqual([
			{ gate: tag, clears: 'person', short: 'Pinned to main-1788002370-0afab6f', clearsAt: null }
		]);
	});
});

describe('filterByEnv — which COLUMNS render', () => {
	it('keeps one environment and the contract edges inside it', () => {
		const g = filterByEnv(build(), ['dev']);
		expect(g.nodes.map((n) => n.id).sort()).toEqual([ID.apiDev, ID.feDev].sort());
		expect(g.edges).toHaveLength(1);
		expect(g.edges[0].writer).toBe('contract');
	});

	it('drops a promotion edge whose source column is hidden — no arrow from nowhere', () => {
		const g = filterByEnv(build(), ['prod']);
		expect(g.edges.every((e) => e.writer === 'contract')).toBe(true);
	});

	it('treats an empty selection as every environment', () => {
		const g = build();
		expect(filterByEnv(g, [])).toBe(g);
	});
});

describe('neighbourhood — the rollout tab, in the same language', () => {
	/**
	 * ⭐ THE HEADER/DRAWING DISAGREEMENT THIS BLOCK GUARDS AGAINST.
	 * (2026-09-02) `neighbourhood(g, feProd, 1)` used to walk both edge kinds
	 * with one hop count, so it reached `feStaging` (one promotion hop) and
	 * `apiProd` (one contract hop) but NOT `feDev` — dev is two promotion hops
	 * from prod on this three-environment line. The rollout tab's header
	 * ("3 of 4 blocked") then counted a graph that had already dropped a held
	 * leg the side panels — built from the unfiltered dependency list — still
	 * named. `focus`'s own promotion line must be walked to BOTH its ends
	 * regardless of `depth`, which now rations only the CONTRACT axis.
	 */
	it("walks focus's own promotion line to both ends, not hop-limited by depth", () => {
		const local = neighbourhood(build(), ID.feProd, 1);
		// dev is two promotion hops from prod, and it is still here: this is
		// the exact case that used to go missing.
		expect(local.nodes.map((n) => n.id).sort()).toEqual(Object.values(ID).sort());
		expect(local.envs).toEqual(['dev', 'staging', 'prod']);
		expect(local.edges.map((e) => e.writer).sort()).toEqual([
			'contract',
			'contract',
			'contract',
			'promotion',
			'promotion',
			'promotion',
			'promotion'
		]);
	});

	it('the header and the drawing count the same set (regression: no more "3 of 4" against a graph missing dev)', () => {
		const local = neighbourhood(build(), ID.feProd, 1);
		const v = networkVerdict(local);
		// All 3 contract edges are held, plus both of `hello-frontend-app`'s
		// own promotion edges (dev→staging and staging→prod both refuse the
		// `rel-67` it wants); `hello-api-app`'s two promotion edges are clear
		// — it has nothing new to offer, so its gate refusing everything is
		// the gate working, not a block. Before the fix this graph did not
		// even contain a dev→staging edge to count.
		expect(local.blockedEdges).toHaveLength(5);
		expect(v.text).toBe('5 of 7 links held');
	});

	it('returns an empty graph for a rollout that is in no relation', () => {
		expect(neighbourhood(build(), nodeId('dev', 'nowhere', 'nothing'), 1).nodes).toEqual([]);
	});

	it('still rations the CONTRACT axis by depth — a chain of services does not all arrive at once', () => {
		const f = liveFixture();
		// `hello-api-app` in dev itself depends on a third service, two
		// contract hops from `hello-frontend-app`'s own line. No Rollout is
		// added for it — an unresolved node is still a node.
		f.dependencies.push(
			dep({
				ns: 'hello-dep-dev',
				cluster: 'dev',
				consumer: 'hello-api-app',
				provider: 'hello-cache-app',
				contract: 'cache'
			})
		);
		const g = build(f);
		const cacheId = nodeId('dev', 'hello-dep-dev', 'hello-cache-app');
		expect(neighbourhood(g, ID.feDev, 1).nodes.map((n) => n.id)).not.toContain(cacheId);
		expect(neighbourhood(g, ID.feDev, 2).nodes.map((n) => n.id)).toContain(cacheId);
	});

	it('does not mutate the graph it was given', () => {
		const g = build();
		const before = g.nodes.length;
		neighbourhood(g, ID.feProd, 1);
		filterByEnv(g, ['dev']);
		expect(g.nodes).toHaveLength(before);
	});
});

describe('a provider this dashboard cannot see is drawn hollow, never dropped', () => {
	it('marks an unresolvable providerRef as unresolved and keeps the edge', () => {
		const f = liveFixture();
		f.dependencies.push(
			dep({
				ns: 'hello-dep-dev',
				cluster: 'dev',
				provider: 'somewhere-else-app',
				contract: 'billing'
			})
		);
		const g = build(f);
		const ghost = g.nodes.find((n) => n.name === 'somewhere-else-app');
		expect(ghost?.unresolved).toBe(true);
		expect(ghost?.build).toBeNull();
		expect(g.edges.some((e) => e.from === ghost?.id)).toBe(true);
	});
});

describe('layoutOrder — an order, not a position', () => {
	it('puts a provider immediately before its consumer', () => {
		const order = layoutOrder(build());
		const names = order.map((id) => id.split('/')[2]);
		expect(names.indexOf('hello-api-app')).toBeLessThan(names.indexOf('hello-frontend-app'));
	});

	it('hoists a held contract component ahead of an untouched one', () => {
		const f = liveFixture();
		// A second, entirely healthy service line that sorts FIRST by name.
		for (const [tier, ns] of [
			['dev', 'aaa-dev'],
			['staging', 'aaa-staging']
		] as const) {
			f.rollouts.push(rollout({ name: 'aaa-app', ns, cluster: 'dev', gates: [] }));
			f.environments.push(
				environment({
					line: 'aaa-app',
					tier,
					ns,
					rollout: 'aaa-app',
					gate: `ghd-aaa-${tier}`,
					...(tier === 'staging' ? { after: 'dev' } : {})
				})
			);
		}
		const order = layoutOrder(build(f));
		const names = order.map((id) => id.split('/')[2]);
		expect(names[0]).toBe('hello-api-app');
		expect(names.indexOf('hello-frontend-app')).toBeLessThan(names.indexOf('aaa-app'));
	});

	it('keeps a contract component together rather than hoisting one member out of it', () => {
		const order = layoutOrder(build());
		const names = [...new Set(order.map((id) => id.split('/')[2]))];
		expect(names).toEqual(['hello-api-app', 'hello-frontend-app']);
	});
});

describe('the sentences', () => {
	it('says what a held contract edge is waiting for', () => {
		const g = build();
		const byId = new Map(g.nodes.map((n) => [n.id, n] as const));
		const e = g.edges.find((x) => x.writer === 'contract' && x.to === ID.feProd)!;
		expect(edgeSentence(e, byId)).toBe(
			'hello-frontend-app in prod needs api ^1.67.0, hello-api-app serves 1.66.0 — held'
		);
	});

	it('says what a held promotion edge is waiting for', () => {
		const g = build();
		const byId = new Map(g.nodes.map((n) => [n.id, n] as const));
		const e = g.edges.find((x) => x.writer === 'promotion' && x.to === ID.feProd)!;
		expect(edgeSentence(e, byId)).toBe(
			'hello-frontend-app in prod cannot take its next build until staging deploys it first'
		);
	});

	it('rolls the whole graph up in one line', () => {
		// 3 contract gates, plus the two promotion gates into staging and prod
		// that publish an empty allow-list while `rel-67` is waiting.
		expect(networkVerdict(build())).toEqual({ text: '5 of 7 links held', tone: 'adverse' });
	});

	/**
	 * ⭐ THE ROLLUP NAMES ITS NOUN. (2026-09-02, coordinator correction: `5 of
	 * 7 blocked` sat beside a drawing of 6 NODES on the rollout tab, so a
	 * reader counting boxes found a mismatch — the 7 counted EDGES, and
	 * nothing said so. `links` is the noun the `Blocked links` card beside
	 * this rollup already uses for the same objects.)
	 */
	it('never counts bare — every branch names "links", matching the `Held links` card', () => {
		expect(networkVerdict(build()).text).toMatch(/^\d+ of \d+ links held$/);
	});

	it('says `no links` rather than inventing health for an empty graph', () => {
		const g = buildRolloutGraph({
			rollouts: [],
			environments: [],
			dependencies: [],
			envOrder: ORDER
		});
		expect(networkVerdict(g)).toEqual({ text: 'no links', tone: 'neutral' });
		expect(g.nodes).toEqual([]);
	});
});

describe('cycles render, they do not crash and they do not vanish', () => {
	it('marks the back edge of a two-service contract cycle', () => {
		const f = liveFixture();
		f.dependencies.push(
			dep({
				ns: 'hello-dep-dev',
				cluster: 'dev',
				consumer: 'hello-api-app',
				provider: 'hello-frontend-app',
				contract: 'ui'
			})
		);
		const g = build(f);
		expect(g.hasCycle).toBe(true);
		expect(g.edges.filter((e) => e.cyclic)).toHaveLength(1);
		// Every edge still renders.
		expect(g.edges.filter((e) => e.writer === 'contract')).toHaveLength(4);
	});
});

describe('rollouts that are in no relation are counted, never silently dropped', () => {
	it('reports them rather than drawing floating boxes', () => {
		const f = liveFixture();
		f.rollouts.push(
			rollout({ name: 'hello-world-manifests', ns: 'hello-world-dev', cluster: 'dev', gates: [] })
		);
		const g = build(f);
		expect(g.nodes.some((n) => n.name === 'hello-world-manifests')).toBe(false);
		expect(g.unlinkedRollouts).toBe(1);
	});

	it('counts nothing as unlinked when every rollout is in the graph', () => {
		expect(build().unlinkedRollouts).toBe(0);
	});
});

// =========================================================================
// The cases that only bite once, and only in production
// =========================================================================

describe('identity is (cluster, namespace, name) and nothing shorter', () => {
	it('does not fold three same-named rollouts into one node', () => {
		const g = build();
		expect(g.nodes.filter((n) => n.name === 'hello-api-app')).toHaveLength(3);
	});

	it('keeps two same-named rollouts in the same namespace on different clusters apart', () => {
		const f = liveFixture();
		f.rollouts.push(
			rollout({ name: 'hello-api-app', ns: 'hello-dep-dev', cluster: 'other', gates: [] })
		);
		f.dependencies.push(dep({ ns: 'hello-dep-dev', cluster: 'other' }));
		f.rollouts.push(
			rollout({ name: 'hello-frontend-app', ns: 'hello-dep-dev', cluster: 'other', gates: [] })
		);
		const g = build(f);
		expect(g.nodes.filter((n) => n.namespace === 'hello-dep-dev' && n.name === 'hello-api-app'))
			.toHaveLength(2);
		expect(g.edges.some((e) => e.from === nodeId('other', 'hello-dep-dev', 'hello-api-app'))).toBe(
			true
		);
	});

	it('never draws an edge from a rollout to itself', () => {
		const f = liveFixture();
		// An Environment whose relationship resolves back to its own tier.
		f.environments.push(
			environment({
				line: 'self-line',
				tier: 'dev',
				ns: 'self-ns',
				rollout: 'self-app',
				gate: 'ghd-self',
				after: 'dev'
			})
		);
		const g = build(f);
		expect(g.edges.some((e) => e.from === e.to)).toBe(false);
	});
});

describe('the environment axis', () => {
	it('falls back to the namespace when a rollout has no Environment bound', () => {
		const f = liveFixture();
		f.rollouts.push(
			rollout({ name: 'orphan-provider', ns: 'unbound-ns', cluster: 'dev', gates: [] })
		);
		f.rollouts.push(
			rollout({
				name: 'orphan-consumer',
				ns: 'unbound-ns',
				cluster: 'dev',
				candidates: ['rel-67'],
				gates: [{ name: 'dependency-orphan-consumer-needs-thing', passing: true, allowedVersions: [] }]
			})
		);
		f.dependencies.push(
			dep({
				ns: 'unbound-ns',
				cluster: 'dev',
				consumer: 'orphan-consumer',
				provider: 'orphan-provider',
				contract: 'thing'
			})
		);
		const g = build(f);
		expect(g.nodes.find((n) => n.name === 'orphan-consumer')?.env).toBe('unbound-ns');
		// It is still a column, appended after the ordered tiers.
		expect(g.envs[g.envs.length - 1]).toBe('unbound-ns');
	});

	it('lists only the environments the graph actually touches, in promotion order', () => {
		const g = filterByEnv(build(), ['prod', 'dev']);
		expect(g.nodes.map((n) => n.env).sort()).toEqual(['dev', 'dev', 'prod', 'prod']);
		expect(g.envs).toEqual(['dev', 'staging', 'prod']);
	});

	it('ranks a node by its environment, which is the column it lands in', () => {
		const g = build();
		expect(g.nodes.find((n) => n.id === ID.feDev)?.envRank).toBe(0);
		expect(g.nodes.find((n) => n.id === ID.feStaging)?.envRank).toBe(1);
		expect(g.nodes.find((n) => n.id === ID.feProd)?.envRank).toBe(2);
	});
});

describe('a Parallel relationship is not an After relationship', () => {
	it('carries the type onto the edge and into the sentence', () => {
		const f = liveFixture();
		const staging = f.environments.find(
			(e) => e.spec?.name === 'hello-dep-frontend-app' && e.spec?.environment === 'staging'
		)!;
		(staging.spec as { relationship?: unknown }).relationship = {
			environment: 'dev',
			type: 'Parallel'
		};
		const g = build(f);
		const byId = new Map(g.nodes.map((n) => [n.id, n] as const));
		const e = g.edges.find((x) => x.writer === 'promotion' && x.to === ID.feStaging)!;
		expect(e.relType).toBe('Parallel');
		expect(edgeSentence(e, byId)).toContain('deploys it alongside');
	});
});

describe('determinism — two loads of one fleet read identically', () => {
	it('produces the same node ids, edge keys and order every time', () => {
		const a = build();
		const b = build();
		expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id));
		expect(a.edges.map((e) => e.key)).toEqual(b.edges.map((e) => e.key));
		expect(layoutOrder(a)).toEqual(layoutOrder(b));
	});

	it('gives every edge a key unique to the gate it is', () => {
		const g = build();
		expect(new Set(g.edges.map((e) => e.key)).size).toBe(g.edges.length);
	});
});

describe('an open graph says so, and does not look broken', () => {
	it('rolls up as open when nothing is held', () => {
		const f = liveFixture();
		// Nothing newer to take anywhere: every gate is doing its job.
		for (const r of f.rollouts) (r.status as { releaseCandidates?: unknown[] }).releaseCandidates = [];
		const g = build(f);
		expect(g.blockedEdges).toEqual([]);
		expect(networkVerdict(g)).toEqual({ text: '7 links open', tone: 'neutral' });
		expect(g.nodes.every((n) => !n.blocked)).toBe(true);
	});

	it('never says `satisfied` about a gate it could not read', () => {
		const f = liveFixture();
		f.rollouts = f.rollouts.filter((r) => r.metadata?.namespace !== 'hello-dep-prod');
		const g = build(f);
		const byId = new Map(g.nodes.map((n) => [n.id, n] as const));
		const e = g.edges.find((x) => x.writer === 'contract' && x.to === ID.feProd)!;
		expect(edgeSentence(e, byId)).toContain('has not been read');
		expect(edgeSentence(e, byId)).not.toContain('satisfied');
	});

	it('reports unread gates separately from open ones', () => {
		const f = liveFixture();
		for (const r of f.rollouts) {
			(r.status as { releaseCandidates?: unknown[] }).releaseCandidates = [];
			(r.status as { gates?: unknown[] }).gates = [];
		}
		const g = build(f);
		expect(networkVerdict(g)).toEqual({ text: '7 of 7 links not read', tone: 'neutral' });
	});
});

/**
 * `heldSubjects` — the banner's list of held rollouts, grouped by app.
 *
 * The defect it exists for: `/dependencies` printed *"hello-frontend-app in
 * dev, hello-frontend-app in staging, hello-frontend-app in prod"* for ONE app
 * held down one chain.
 */
describe('heldSubjects', () => {
	function node(name: string, env: string): GraphNode {
		return { id: `dev/ns/${name}/${env}`, name, env } as GraphNode;
	}

	it('names an app once and lists its environments', () => {
		expect(
			heldSubjects([
				node('hello-frontend-app', 'dev'),
				node('hello-frontend-app', 'staging'),
				node('hello-frontend-app', 'prod')
			])
		).toBe('hello-frontend-app in dev, staging and prod');
	});

	it('leaves a single held rollout exactly as it reads today', () => {
		expect(heldSubjects([node('hello-frontend-app', 'dev')])).toBe('hello-frontend-app in dev');
	});

	it('joins two apps with one environment each in plain English', () => {
		expect(heldSubjects([node('hello-frontend-app', 'dev'), node('hello-api-app', 'prod')])).toBe(
			'hello-frontend-app in dev and hello-api-app in prod'
		);
	});

	// THE MIXED CASE. With `and` at both levels this reads `… staging and prod
	// and hello-api-app in dev`, i.e. as if `hello-api-app` were a fourth
	// environment. A list whose items contain commas is separated by semicolons.
	it('separates with semicolons when a group already contains a comma', () => {
		expect(
			heldSubjects([
				node('hello-frontend-app', 'dev'),
				node('hello-frontend-app', 'staging'),
				node('hello-frontend-app', 'prod'),
				node('hello-api-app', 'dev'),
				node('hello-api-app', 'staging')
			])
		).toBe('hello-frontend-app in dev, staging and prod; hello-api-app in dev and staging');
	});

	it('keeps the graph order and never sorts', () => {
		expect(
			heldSubjects([
				node('hello-frontend-app', 'prod'),
				node('hello-api-app', 'dev'),
				node('hello-frontend-app', 'dev')
			])
		).toBe('hello-frontend-app in prod and dev and hello-api-app in dev');
	});

	it('folds a repeated (app, environment) pair', () => {
		expect(
			heldSubjects([node('hello-frontend-app', 'dev'), node('hello-frontend-app', 'dev')])
		).toBe('hello-frontend-app in dev');
	});
});

/**
 * `heldClause` — the tail of `/dependencies`' banner sentence, `"… cannot
 * take their next release until <clause>."`
 *
 * ⛔ THE BUG THIS GUARDS: a contract gate does not clear when the deploy in
 * front lands, it clears when the PROVIDER SHIPS a satisfying version. The
 * banner used to say "until the deploy in front of each of them lands" for
 * EVERY held rollout, contract or not — false for `hello-frontend-app`,
 * which is held by a `RolloutDependency`, not by an unpromoted upstream
 * environment. This clause must never say "deploy in front" for a contract
 * hold again.
 */
describe('heldClause', () => {
	function node(name: string, env: string): GraphNode {
		return { id: `x/ns/${name}/${env}`, name, env } as GraphNode;
	}
	const nodes = new Map<string, GraphNode>([
		['fe-dev', node('hello-frontend-app', 'dev')],
		['fe-staging', node('hello-frontend-app', 'staging')],
		['fe-prod', node('hello-frontend-app', 'prod')],
		['api', node('hello-api-app', 'dev')]
	]);
	function contractEdge(to: string, requiredVersion: string | null = '^1.67.0'): GraphEdge {
		return {
			key: `contract:${to}`,
			from: 'api',
			to,
			writer: 'contract',
			gate: 'g',
			state: 'blocked',
			contract: 'api',
			requiredVersion,
			providedVersion: '1.66.0',
			relType: null,
			message: '',
			cyclic: false
		};
	}
	function promotionEdge(to: string): GraphEdge {
		return {
			key: `promotion:${to}`,
			from: 'fe-dev',
			to,
			writer: 'promotion',
			gate: 'g',
			state: 'blocked',
			contract: null,
			requiredVersion: null,
			providedVersion: null,
			relType: 'After',
			message: '',
			cyclic: false
		};
	}

	it('the live cluster shape: one app held dev/staging/prod by ONE contract, said once', () => {
		const edges = [contractEdge('fe-dev'), contractEdge('fe-staging'), contractEdge('fe-prod')];
		expect(heldClause(edges, nodes)).toBe('hello-api-app ships api ^1.67.0');
		expect(heldClause(edges, nodes)).not.toMatch(/deploy in front/);
	});

	it('names each distinct (provider, contract, requirement) once, not per edge', () => {
		const edges = [
			contractEdge('fe-dev', '^1.67.0'),
			contractEdge('fe-staging', '^2.0.0')
		];
		expect(heldClause(edges, nodes)).toBe(
			'hello-api-app ships api ^1.67.0 and hello-api-app ships api ^2.0.0'
		);
	});

	it('an all-promotion set keeps the old wording — this IS true of an order gate', () => {
		expect(heldClause([promotionEdge('fe-staging'), promotionEdge('fe-prod')], nodes)).toBe(
			'the deploy in front of each of them lands'
		);
	});

	/**
	 * ⭐ A PROMOTION HOLD ON A NODE THE CONTRACT ALSO HOLDS IS A SYMPTOM, NOT
	 * A SECOND CAUSE — DROPPED, NOT RESTATED. (2026-09-02, coordinator
	 * correction.) `fe-prod`'s promotion edge and `fe-dev`'s contract edge
	 * target DIFFERENT subjects here, so the promotion hold is genuinely
	 * independent of this contract and earns its own clause — CONTRACT
	 * FIRST now, since the contract is what actually has to happen and the
	 * order gate is secondary.
	 */
	it('a genuinely independent promotion hold gets its own clause, contract first', () => {
		const edges = [promotionEdge('fe-prod'), contractEdge('fe-dev')];
		expect(heldClause(edges, nodes)).toBe(
			'hello-api-app ships api ^1.67.0 and the deploy in front of each of them lands'
		);
	});

	/**
	 * ⭐ THE EXACT SHAPE THE LIVE FLEET IS IN, AND THE BUG THE CORRECTION
	 * FIXES. `fe-staging`'s and `fe-prod`'s promotion holds target the SAME
	 * subjects their contract holds do — every promotion-blocked target is
	 * already in the contract-blocked set — so the order clause drops
	 * entirely. Before this fix the banner said *"the deploy in front of
	 * each of them lands"* for `dev` too, which has no promotion edge at
	 * all (it is the first environment) and was simply false.
	 */
	it('drops the order clause when every promotion hold is downstream of the same contract', () => {
		const edges = [
			contractEdge('fe-dev'),
			contractEdge('fe-staging'),
			contractEdge('fe-prod'),
			promotionEdge('fe-staging'),
			promotionEdge('fe-prod')
		];
		const clause = heldClause(edges, nodes);
		expect(clause).toBe('hello-api-app ships api ^1.67.0');
		expect(clause).not.toMatch(/deploy in front/);
	});

	it('agrees with the live fixture the /dependencies page actually renders', () => {
		// The full fixture's blocked set is mixed (three contract holds plus
		// `hello-frontend-app`'s own two promotion holds), but every
		// promotion-blocked target (staging, prod) is already contract-held —
		// dev has no promotion edge at all, being the first environment — so
		// the clause is contract-only. This is the exact defect: the banner
		// used to say "the deploy in front of each of them lands" including
		// for dev, which was false.
		const g = build();
		const clause = heldClause(g.blockedEdges, new Map(g.nodes.map((n) => [n.id, n])));
		expect(clause).toBe('hello-api-app ships api ^1.67.0');
		expect(clause).not.toMatch(/deploy in front/);
	});
});

describe('withNetworkSchedules — the graph-wide schedule join (2026-09-03, operator-walk B1)', () => {
	/**
	 * `/dependencies` and the rollout `Dependencies` tab built their
	 * `GateContext` from `buildGateContext` alone — no schedule join — so a
	 * `RolloutSchedule`-owned gate had no `ctx.schedule` entry anywhere and
	 * `classifyGate` fell through to its LAST branch: `clears: 'check'`,
	 * `short: 'A check is not passing'`. That is the exact live defect: the
	 * DEV node of `hello-world-app` printed that sentence for a gate the
	 * rollout's own Overview correctly named `Business Hours Only — reopens
	 * 1:00 PM`. This locks the fix at the graph layer so neither surface can
	 * regress to the fallback silently.
	 */
	const SCHEDULE_GATE = 'schedule-gate-nwm62';

	function scheduleFixture() {
		const dev = rollout({
			name: 'hello-world-app',
			ns: 'hello-world-dev',
			cluster: 'dev',
			candidates: ['rel-2'],
			// Not passing, no allow-list — the shape a schedule-owned gate
			// publishes, and the exact shape `classifyGate` cannot tell apart
			// from a genuinely failing health check without a schedule join.
			gates: [{ name: SCHEDULE_GATE, passing: false }]
		});
		const staging = rollout({
			name: 'hello-world-app',
			ns: 'hello-world-staging',
			cluster: 'dev',
			gates: [{ name: 'ghd-staging', passing: true, allowedVersions: [] }]
		});
		// A promotion edge (dev → staging) is what puts BOTH nodes in the
		// graph at all — `buildRolloutGraph` only creates nodes edges touch.
		const environments: Environment[] = [
			environment({
				line: 'hello-world-app',
				tier: 'dev',
				ns: 'hello-world-dev',
				rollout: 'hello-world-app',
				gate: 'ghd-dev'
			}),
			environment({
				line: 'hello-world-app',
				tier: 'staging',
				ns: 'hello-world-staging',
				rollout: 'hello-world-app',
				gate: 'ghd-staging',
				after: 'dev'
			})
		];
		return { rollouts: [dev, staging], environments };
	}

	function devNodeOf(g: ReturnType<typeof buildRolloutGraph>) {
		return g.nodes.find((n) => n.id === nodeId('dev', 'hello-world-dev', 'hello-world-app'));
	}

	it('without the join, a schedule gate is misreported as a failing check', () => {
		const f = scheduleFixture();
		const base = buildGateContext({ environments: { items: f.environments }, rolloutDependencies: null });
		const g = buildRolloutGraph({
			rollouts: f.rollouts,
			environments: f.environments,
			dependencies: [],
			envOrder: ORDER,
			gates: base
		});
		const dev = devNodeOf(g);
		expect(dev?.holds).toEqual([
			expect.objectContaining({ gate: SCHEDULE_GATE, clears: 'check', short: 'A check is not passing' })
		]);
		// ⭐ AND THE NODE KNOWS ITS OWN CLAIM IS SPECULATIVE. (2026-09-04,
		// load-state audit finding 4) `NodeHold.pending` is what tells
		// `DependencyNode` not to draw `short` yet — a renderer that only
		// checked `clears === 'check'` cannot tell this apart from a gate
		// that will NEVER get a schedule join, which is a genuine, final
		// `check` gate and must print immediately.
		expect(dev?.holds[0].pending).toBe(true);
	});

	it('with the join, the same gate names its window instead', () => {
		const f = scheduleFixture();
		const base = buildGateContext({ environments: { items: f.environments }, rolloutDependencies: null });
		const schedulesByCluster = new Map([
			[
				'dev',
				{
					rolloutSchedules: {
						items: [
							{
								metadata: {
									name: 'business-hours',
									namespace: 'hello-world-dev',
									annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
								},
								spec: { action: 'Allow' as const },
								status: {
									active: false,
									nextTransition: '2026-09-03T13:00:00Z',
									managedGates: [SCHEDULE_GATE]
								}
							}
						]
					}
				}
			]
		]);
		const ctx = withNetworkSchedules(base, schedulesByCluster, namespacesByCluster(f.rollouts));
		const g = buildRolloutGraph({
			rollouts: f.rollouts,
			environments: f.environments,
			dependencies: [],
			envOrder: ORDER,
			gates: ctx
		});
		const dev = devNodeOf(g);
		expect(dev?.holds).toEqual([
			expect.objectContaining({
				gate: SCHEDULE_GATE,
				clears: 'clock',
				short: 'Outside the Business Hours Only deploy window',
				clearsAt: '2026-09-03T13:00:00Z'
			})
		]);
		// The claim is final now — `DependencyNode` may draw `short`.
		expect(dev?.holds[0].pending).toBeFalsy();
	});

	it("does not leak one cluster's schedules onto a namespace another cluster owns", () => {
		const f = scheduleFixture();
		const base = buildGateContext({ environments: { items: f.environments }, rolloutDependencies: null });
		// The schedule exists on a DIFFERENT cluster than the one that runs
		// `hello-world-dev` — it must not be joined in.
		const schedulesByCluster = new Map([
			[
				'prod',
				{
					rolloutSchedules: {
						items: [
							{
								metadata: { name: 'business-hours', namespace: 'hello-world-dev' },
								spec: { action: 'Allow' as const },
								status: { active: false, nextTransition: '2026-09-03T13:00:00Z', managedGates: [SCHEDULE_GATE] }
							}
						]
					}
				}
			]
		]);
		const ctx = withNetworkSchedules(base, schedulesByCluster, namespacesByCluster(f.rollouts));
		const g = buildRolloutGraph({
			rollouts: f.rollouts,
			environments: f.environments,
			dependencies: [],
			envOrder: ORDER,
			gates: ctx
		});
		const dev = devNodeOf(g);
		expect(dev?.holds[0].clears).toBe('check');
	});
});

describe('namespacesByCluster', () => {
	it('groups a set of rollouts by cluster, then namespace', () => {
		const map = namespacesByCluster([
			rollout({ name: 'a', ns: 'dev', cluster: 'spoke' }),
			rollout({ name: 'b', ns: 'staging', cluster: 'spoke' }),
			rollout({ name: 'c', ns: 'prod', cluster: '' })
		]);
		expect(map.get('spoke')).toEqual(new Set(['dev', 'staging']));
		expect(map.get('')).toEqual(new Set(['prod']));
	});
});
