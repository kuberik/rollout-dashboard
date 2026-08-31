import { describe, it, expect } from 'vitest';
import type { Rollout, Environment, RolloutDependency } from '../../types';
import { buildGateContext } from './blocking-story';
import {
	buildRolloutGraph,
	filterByEnv,
	neighbourhood,
	networkVerdict,
	edgeSentence,
	layoutOrder,
	serviceLines,
	nodeId
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
	it('reaches BOTH relations at depth 1', () => {
		const local = neighbourhood(build(), ID.feProd, 1);
		// The hop reaches frontend@staging (promotion) and api@prod (contract);
		// the rectangle closure then adds api@staging so that api has a column
		// anchor and does not get drawn in staging's column.
		expect(local.nodes.map((n) => n.id).sort()).toEqual(
			[ID.feStaging, ID.feProd, ID.apiStaging, ID.apiProd].sort()
		);
		expect(local.envs).toEqual(['staging', 'prod']);
		expect(local.edges.map((e) => e.writer).sort()).toEqual([
			'contract',
			'contract',
			'promotion',
			'promotion'
		]);
	});

	it('returns an empty graph for a rollout that is in no relation', () => {
		expect(neighbourhood(build(), nodeId('dev', 'nowhere', 'nothing'), 1).nodes).toEqual([]);
	});

	it('reaches the provider’s OWN promotion line at depth 2', () => {
		const local = neighbourhood(build(), ID.feStaging, 2);
		expect(local.nodes.map((n) => n.id).sort()).toEqual(Object.values(ID).sort());
	});

	it('narrows the environments to the ones the neighbourhood is actually in', () => {
		const local = neighbourhood(build(), ID.feProd, 1);
		expect(local.envs).toEqual(['staging', 'prod']);
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

describe('serviceLines — the phone carries BOTH relations', () => {
	it('gives one line per service, environments in promotion order', () => {
		const lines = serviceLines(build());
		expect(lines.map((l) => l.name)).toEqual(['hello-api-app', 'hello-frontend-app']);
		expect(lines[1].nodes.map((n) => n.env)).toEqual(['dev', 'staging', 'prod']);
		expect(lines[1].blocked).toBe(true);
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
		expect(networkVerdict(build())).toEqual({ text: '5 of 7 blocked', tone: 'adverse' });
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
		expect(networkVerdict(g)).toEqual({ text: '7 of 7 not read', tone: 'neutral' });
	});
});
