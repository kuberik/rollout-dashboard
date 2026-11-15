/**
 * HEALTH FAILURES, MOCK ONLY (health-conditions TAKE C, 2026-11-15). Seven apps whose prod rollout carries HealthChecks drawn from what the API
 * ALREADY has (`status`, `message`, `lastErrorTime`, `lastChangeTime`, `observations[]`, the history snapshot `failedHealthChecks[].observations`)
 * plus ONE proposed optional field, `status.observations[].message`. NO `conditions`, NO `failures[]`. Spec: `.work/health-conditions/design/health-c.md`.
 *
 *   OPT-IN: `MOCK_SCENARIO=health-failures` or `MOCK_FIXTURES=health-failures` (dev-mock-api.ts). Without it nothing here is imported.
 *
 *   case  app                 prod rollout    HealthCheck class          bake        scenario
 *   C1    checkout-gateway    Failed          kustomization              Failed      S1  one resource, 1/3 ready (6m)
 *   C2    checkout-web        Failed          datadog                    Failed      S2  monitor 812 ms over 500 ms (9m)
 *   C3    payments-api        Failed          prometheus-alert           Failed      S3  HighErrorRate firing (7m)
 *   C4    orders-hub          Failed          kustomization+datadog+prom Failed      S4/S6 two monitors + an alert + a pending resource (12m)
 *   C5    search-indexer      Failed          prometheus-alert           Failed      S7  failed 14m ago for 3m, recovered (the witness keeps the bake failed)
 *   C6    catalog-api         Failed          datadog                    Failed      S5  failed 10m ago, OK 1m ago
 *   C7    inventory-api       InProgress      prometheus-alert           InProgress  S8  Pending: the provider's error is the message (5m)
 *
 * EVERY time is computed from `Date.now()` on each request (not from `hcAgo`, which is anchored to the server start and drifts: the take-A shots
 * read "1h ago"). `checkout-api` (the brief's name for C1) already exists in the mock fleet, so C1 is `checkout-gateway`.
 */
import { SOURCE_CLUSTER } from './mock-data';
import { registerExtraApps, curated, OWNER, type AppFixture } from './github-data';
import { setExtraFixtures, setExtraHealthChecks, keepFailed } from './extra-fixtures';
import { build, environmentsOf, rolloutsOf, GH as RS_GH, MERGE_MIN_AGO as RS_MERGE, type Fixture } from './release-switch-fixtures';

/** `m` minutes before THIS request */
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type Obj = Record<string, unknown>;
type Check = { name: string; cls: string; display: string; status: Obj };
const checkOf = (app: string, ns: string, c: Check): Obj => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'HealthCheck',
	metadata: { name: c.name, namespace: ns, labels: { app }, annotations: { 'kuberik.com/display-name': c.display } },
	spec: { class: c.cls },
	status: c.status
});

type Case = {
	app: string;
	/** minutes ago the head deployed / the bake ended (Failed only) */
	deployed: number;
	bake: 'Failed' | 'InProgress';
	bakeMessage: string;
	bakeEnd?: number;
	checks: Check[];
	/** the failing checks' names, snapshotted onto the head's failedHealthChecks; `snapObs` overrides the snapshot's observations (a recovered check's live ones are healthy) */
	snapshot: string[];
	snapObs?: Record<string, Obj[]>;
};

const NS = (app: string) => `${app}-prod-default`;
const KUST = 'kustomization-health-check';

/** an observation: `m` is the minutes-ago of when it was observed */
const obs = (o: Obj, m = 1): Obj => ({ ...o, observedTime: ago(m) });

function cases(): Case[] {
	const kust = (app: string, status: Obj): Check => ({ name: `${app}-${KUST}`, cls: 'kustomization', display: 'Flux Deployment', status });

	// C1 - S1: one Kustomization resource failing
	const c1: Case = {
		app: 'checkout-gateway',
		deployed: 22,
		bake: 'Failed',
		bakeEnd: 3,
		bakeMessage: '1 of 12 resources unhealthy',
		snapshot: [`checkout-gateway-${KUST}`],
		checks: [
			kust('checkout-gateway', {
				status: 'Unhealthy',
				message: '1 of 12 resources unhealthy',
				lastChangeTime: ago(6),
				lastErrorTime: ago(1),
				observations: [obs({ name: 'Deployment shop/checkout-api', kind: 'Ratio', value: '1', total: '3', unit: 'ready', healthy: false, message: 'Readiness probe failed: HTTP probe failed with statuscode: 503' })]
			})
		]
	};

	// C2 - S2: one Datadog monitor alerting
	const c2: Case = {
		app: 'checkout-web',
		deployed: 31,
		bake: 'Failed',
		bakeEnd: 7,
		bakeMessage: '1 of 4 monitors alerting',
		snapshot: ['checkout-web-datadog'],
		checks: [
			{
				name: 'checkout-web-datadog',
				cls: 'datadog',
				display: 'Datadog monitors',
				status: {
					status: 'Unhealthy',
					message: '1 of 4 monitors alerting',
					lastChangeTime: ago(9),
					lastErrorTime: ago(1),
					observations: [obs({ name: 'checkout p99 latency', kind: 'Threshold', value: '812', limit: '500', direction: 'Above', unit: 'ms', window: '5m', healthy: false, message: 'service:checkout, env:prod' })]
				}
			}
		]
	};

	// C3 - S3: one Prometheus alert firing
	const c3: Case = {
		app: 'payments-api',
		deployed: 26,
		bake: 'Failed',
		bakeEnd: 5,
		bakeMessage: '1 alert firing',
		snapshot: ['payments-api-prometheus-alerts'],
		checks: [
			{
				name: 'payments-api-prometheus-alerts',
				cls: 'prometheus-alert',
				display: 'Prometheus alerts',
				status: {
					status: 'Unhealthy',
					message: '1 alert firing',
					lastChangeTime: ago(7),
					lastErrorTime: ago(1),
					observations: [obs({ name: 'HighErrorRate', kind: 'Threshold', value: '4.2', limit: '1', direction: 'Above', unit: '%', window: '5m', healthy: false, message: 'severity=critical, namespace=payments' })]
				}
			}
		]
	};

	// C4 - S4/S6: several at once, plus healthy ones and a pending resource
	const c4: Case = {
		app: 'orders-hub',
		deployed: 34,
		bake: 'Failed',
		bakeEnd: 4,
		bakeMessage: '3 health checks failed',
		snapshot: ['orders-hub-datadog', `orders-hub-${KUST}`, 'orders-hub-prometheus-alerts'],
		checks: [
			{
				name: 'orders-hub-datadog',
				cls: 'datadog',
				display: 'Datadog monitors',
				status: {
					status: 'Unhealthy',
					message: '2 of 5 monitors alerting',
					lastChangeTime: ago(12),
					lastErrorTime: ago(1),
					observations: [
						obs({ name: 'payment errors', kind: 'Threshold', value: '3.1', limit: '1', direction: 'Above', unit: '%', window: '10m', healthy: false, message: 'service:orders, env:prod' }),
						obs({ name: 'order-events consumer lag', kind: 'State', value: 'Alert', healthy: false, message: 'service:orders, env:prod' }),
						obs({ name: 'cart latency', kind: 'Threshold', value: '180', limit: '500', direction: 'Above', unit: 'ms', window: '5m', healthy: true })
					]
				}
			},
			kust('orders-hub', {
				status: 'Pending',
				message: '1 of 12 resources progressing',
				lastChangeTime: ago(6),
				observations: [obs({ name: 'Deployment orders/orders-worker', kind: 'Ratio', value: '2', total: '3', unit: 'updated', message: 'Waiting for rollout to finish: 2 of 3 updated replicas are available' })]
			}),
			{
				name: 'orders-hub-prometheus-alerts',
				cls: 'prometheus-alert',
				display: 'Prometheus alerts',
				status: {
					status: 'Unhealthy',
					message: '1 alert firing',
					lastChangeTime: ago(8),
					lastErrorTime: ago(1),
					observations: [obs({ name: 'HighOrderBacklog', kind: 'Threshold', value: '1840', limit: '1000', direction: 'Above', unit: 'orders', healthy: false, message: 'severity=warning' })]
				}
			},
			{
				name: 'orders-hub-datadog-incidents',
				cls: 'datadog-incidents',
				display: 'Datadog incidents',
				status: { status: 'Healthy', message: 'No open incidents', lastChangeTime: ago(34), observations: [obs({ name: 'open incidents', kind: 'Count', value: '0', healthy: true })] }
			},
			{
				name: 'orders-hub-prometheus-slo',
				cls: 'prometheus-alert',
				display: 'Prometheus SLO alerts',
				status: { status: 'Healthy', message: 'No alerts firing', lastChangeTime: ago(34), observations: [obs({ name: 'OrdersSLOBurn', kind: 'Threshold', value: '0.3', limit: '1', direction: 'Above', unit: 'x', window: '1h', healthy: true })] }
			}
		]
	};

	// C5 - S7: failed 14m ago for 3m, recovered; the witness keeps the bake failed
	const c5: Case = {
		app: 'search-indexer',
		deployed: 38,
		bake: 'Failed',
		bakeEnd: 10,
		bakeMessage: 'HighLatency fired during the bake',
		snapshot: ['search-indexer-prometheus-alerts'],
		snapObs: { 'search-indexer-prometheus-alerts': [obs({ name: 'HighLatency', kind: 'Threshold', value: '1.9', limit: '1', direction: 'Above', unit: 's', window: '5m', healthy: false, message: 'severity=warning' }, 14)] },
		checks: [
			{
				name: 'search-indexer-prometheus-alerts',
				cls: 'prometheus-alert',
				display: 'Prometheus alerts',
				status: {
					status: 'Healthy',
					message: 'No alerts firing',
					lastChangeTime: ago(11),
					lastErrorTime: ago(11.1),
					observations: [obs({ name: 'HighLatency', kind: 'Threshold', value: '0.4', limit: '1', direction: 'Above', unit: 's', window: '5m', healthy: true, message: 'severity=warning' })]
				}
			}
		]
	};

	// C6 - S5: failed 10m ago, OK now (drawn exactly like C5: the API carries no flap count)
	const c6: Case = {
		app: 'catalog-api',
		deployed: 24,
		bake: 'Failed',
		bakeEnd: 1,
		bakeMessage: 'catalog cache hit ratio fell below its floor during the bake',
		snapshot: ['catalog-api-datadog'],
		snapObs: { 'catalog-api-datadog': [obs({ name: 'catalog cache hit ratio', kind: 'Threshold', value: '72', limit: '80', direction: 'Below', unit: '%', window: '5m', healthy: false, message: 'service:catalog, env:prod' }, 10)] },
		checks: [
			{
				name: 'catalog-api-datadog',
				cls: 'datadog',
				display: 'Datadog monitors',
				status: {
					status: 'Healthy',
					message: 'All 4 monitors OK',
					lastChangeTime: ago(1),
					lastErrorTime: ago(1.1),
					observations: [obs({ name: 'catalog cache hit ratio', kind: 'Threshold', value: '86', limit: '80', direction: 'Below', unit: '%', window: '5m', healthy: true, message: 'service:catalog, env:prod' })]
				}
			}
		]
	};

	// C7 - S8: the check cannot evaluate. It is Pending, and the provider's error is the message.
	const c7: Case = {
		app: 'inventory-api',
		deployed: 12,
		bake: 'InProgress',
		bakeMessage: 'Baking: waiting for a health check',
		snapshot: [],
		checks: [
			{
				name: 'inventory-api-prometheus-alerts',
				cls: 'prometheus-alert',
				display: 'Prometheus alerts',
				status: {
					status: 'Pending',
					message: 'Prometheus query failed: Get "http://prometheus.monitoring:9090/api/v1/query_range": dial tcp 10.96.0.12:9090: connect: connection refused',
					lastChangeTime: ago(5)
				}
			}
		]
	};

	return [c1, c2, c3, c4, c5, c6, c7];
}

let built: Case[] = [];
const caseFor = (ns: string, name: string) => built.find((c) => NS(c.app) === ns && c.app === name);

function fixtureOf(c: Case, index: number): Fixture {
	const failed = c.bake === 'Failed';
	const head: Obj = {
		timestamp: ago(c.deployed),
		bakeStatus: c.bake,
		bakeStatusMessage: c.bakeMessage,
		...(failed
			? {
					bakeStartTime: ago(c.deployed - 2),
					bakeEndTime: ago(c.bakeEnd ?? 3),
					failedHealthChecks: c.snapshot.map((n) => {
						const chk = c.checks.find((x) => x.name === n)!;
						const st = chk.status as { message: string; lastChangeTime?: string; observations?: Obj[] };
						const o = c.snapObs?.[n] ?? (st.observations ?? []).filter((x) => x.healthy !== true).map((x) => ({ ...x, observedTime: st.lastChangeTime ?? x.observedTime }));
						return { name: n, namespace: NS(c.app), message: st.message, ...(o.length ? { observations: o } : {}) };
					})
				}
			: { bakeStartTime: ago(c.deployed - 2) })
	};
	return build(c.app, `hf${index + 1}`, (n) => `1.${n}.0`, 1, 4, [
		{ tier: 'dev', site: 'default', wave: 1, cluster: 'dev', at: 4, bake: 'Succeeded' },
		{ tier: 'staging', site: 'default', wave: 1, cluster: 'dev', at: 4, bake: 'Succeeded' },
		{ tier: 'prod', site: 'default', wave: 1, cluster: 'prod', at: 4, bake: c.bake, head, spec: { healthCheckSelector: { matchLabels: { app: c.app } } } }
	]);
}

let fixtures: Fixture[] = [];
const build_ = (): void => {
	built = cases();
	fixtures = built.map(fixtureOf);
	for (const c of built) keepFailed(NS(c.app), c.app, true);
};

/**
 * Read-time restamp of a cached rollout of this set: the head's times (timestamp, bake start/end, the snapshots' observedTime) shift by
 * the exact amount that makes `timestamp` read `c.deployed` minutes ago NOW, so a capture at any moment shows the spec's ages
 * (C5 failed 14m ago for 3m, C6 failed 10m ago OK 1m). The state caches rollouts at reset; checks are rebuilt per read (`healthFailuresChecks`).
 */
function restamp(r: Obj): void {
	const m = r.metadata as { namespace?: string; name?: string } | undefined;
	const c = m?.name ? caseFor(m.namespace ?? '', m.name) : undefined;
	const head = (r.status as { history?: Obj[] } | undefined)?.history?.[0] as Obj | undefined;
	if (!c || !head || typeof head.timestamp !== 'string') return;
	const delta = Date.now() - c.deployed * 60_000 - Date.parse(head.timestamp);
	if (Math.abs(delta) < 1000) return;
	const shift = (v: unknown): unknown => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(Date.parse(v) + delta).toISOString() : v);
	for (const k of ['timestamp', 'bakeStartTime', 'bakeEndTime']) if (head[k]) head[k] = shift(head[k]);
	for (const f of (head.failedHealthChecks as { observations?: Obj[] }[] | undefined) ?? []) for (const o of f.observations ?? []) if (o.observedTime) o.observedTime = shift(o.observedTime);
}

/** the per-rollout health-check answer for a health-failures prod rollout; undefined for any other rollout. */
export function healthFailuresChecks(ns: string, name: string): { healthChecks: Obj[] } | undefined {
	let c = caseFor(ns, name);
	// Every case is rebuilt on read: each time is `Date.now()` minus its minutes, so a capture at any moment reads 6m / 9m / 7m ... (a
	// Failed case built once at install drifted: the reviewer saw C1 at 38m).
	if (c) c = cases().find((x) => x.app === c!.app) ?? c;
	return c ? { healthChecks: c.checks.map((k) => checkOf(c!.app, ns, k)) } : undefined;
}

/** the fleet health-check list answer: one item per rollout WITH a healthCheckSelector (these seven), exactly their per-rollout answer. */
export function healthFailuresFleet(): Obj {
	return {
		rolloutHealthChecks: {
			items: built.map((c) => ({
				metadata: { namespace: NS(c.app), name: c.app, annotations: { [SOURCE_CLUSTER]: 'prod' } },
				healthChecks: healthFailuresChecks(NS(c.app), c.app)!.healthChecks
			}))
		},
		clusterErrors: []
	};
}

export const HEALTH_FAILURES_APPS = ['checkout-gateway', 'checkout-web', 'payments-api', 'orders-hub', 'search-indexer', 'catalog-api', 'inventory-api'] as const;

const HEADLINES = ['Tune connection pool sizes', 'Add retry budget to outbound calls', 'Fix flaky readiness handler'];
const ghOf = (fs: Fixture[]): Record<string, AppFixture> =>
	Object.fromEntries(fs.map((f) => [f.app, curated(OWNER, f.app, f.releases.map((r) => r.tag), HEADLINES, undefined, `Initial ${f.app} release`)]));
const mergeOf = (fs: Fixture[]): Record<string, number> =>
	Object.fromEntries(fs.flatMap((f) => f.releases.map((r, k) => [r.tag, (f.releases.length - k) * 150 + 20] as const)));

/**
 * OPT-IN, called from dev-mock-api.ts before the state is built. `withReleaseSwitch` keeps the release-switch apps registered beside these
 * (both flags can be on at once). `install(false)` takes the apps out.
 */
export function install(on = true, withReleaseSwitch = false): void {
	if (!on) {
		setExtraFixtures('health-failures', null);
		setExtraHealthChecks(null);
		built = [];
		return;
	}
	build_();
	setExtraHealthChecks({ one: healthFailuresChecks, fleet: healthFailuresFleet });
	setExtraFixtures('health-failures', { environments: () => fixtures.flatMap(environmentsOf), rollouts: () => (build_(), fixtures.flatMap(rolloutsOf)), restamp });
	registerExtraApps({ ...(withReleaseSwitch ? RS_GH : {}), ...ghOf(fixtures) }, { ...(withReleaseSwitch ? RS_MERGE : {}), ...mergeOf(fixtures) });
}
