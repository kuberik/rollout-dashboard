/**
 * AUTO-ROLLBACK, MOCK ONLY (feat/auto-rollback preview). Three apps whose prod Rollout opted in to `spec.autoRollback`,
 * one per state the dashboard has to say. The fields are the controller's contract (`status.history[].deployKind`,
 * `rollbackOf`, `failedHealthChecks[].failures[]`, `status.candidates[].failedBake`, the `AutoRollback` condition).
 *
 *   OPT-IN: `MOCK_SCENARIO=auto-rollback` or `MOCK_FIXTURES=auto-rollback` (dev-mock-api.ts). Without it nothing here is imported.
 *
 *   app               prod rollout state
 *   cart-service      (a) rolled back automatically: 2.4.0 failed on cart-smoke-test (rolls back); cart-flaky-ui-test
 *                         also failed but opted out. 2.3.0 runs again; 2.4.0 is held (candidates[].failedBake).
 *   catalog-sync      (b) failed bake, NOT rolled back: only the opted-out catalog-flaky-ui-test failed (NotATrigger).
 *   payments-gateway  (c) force-deployed build failed: not rolled back automatically (ManualDeploy), Roll back is the primary action.
 *   search-indexer    (d) NOT opted in (no spec.autoRollback): an automatic build failed on a test the check would roll back
 *                         on; nothing rolled back, so History reads "would roll back", never "rolls back".
 *
 * Every time is relative to the read (`restamp`), so a capture at any moment reads the same ages.
 */
import { registerExtraApps, curated, OWNER, type AppFixture } from './github-data';
import { setExtraFixtures, keepFailed } from './extra-fixtures';
import { build, environmentsOf, rolloutsOf, type Fixture } from './release-switch-fixtures';

type Obj = Record<string, unknown>;
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const NS = (app: string) => `${app}-prod-default`;
const KUST = (app: string) => `${app}-kustomization-health-check`;

const fixtureOf = (app: string, prefix: string, last: number, at: number): Fixture =>
	build(app, prefix, (n) => `2.${n}.0`, 1, last, [
		{ tier: 'dev', site: 'default', wave: 1, cluster: 'dev', at: last, bake: 'Succeeded' },
		{ tier: 'staging', site: 'default', wave: 1, cluster: 'dev', at: last, bake: 'Succeeded' },
		{ tier: 'prod', site: 'default', wave: 1, cluster: 'prod', at, bake: 'Succeeded' }
	]);

const CART = fixtureOf('cart-service', 'ar1', 4, 3);
const CATALOG = fixtureOf('catalog-sync', 'ar2', 5, 4);
const PAYMENTS = fixtureOf('payments-gateway', 'ar3', 4, 4);
const SEARCH = fixtureOf('search-indexer', 'ar4', 4, 4);
const FIXTURES = [CART, CATALOG, PAYMENTS, SEARCH];
export const AUTO_ROLLBACK_APPS = FIXTURES.map((f) => f.app);

const verOf = (f: Fixture, n: number) => {
	const r = f.releases[n - 1];
	return { tag: r.tag, version: r.version, revision: r.revision, created: r.created };
};
const SYSTEM = { kind: 'System', name: 'rollout-controller' };
const cond = (type: string, status: 'True' | 'False', reason: string, message: string) => ({ type, status, reason, message, lastTransitionTime: ago(3), observedGeneration: 1 });
const ok = (f: Fixture, id: number, n: number, m: number): Obj => ({ id, version: verOf(f, n), timestamp: ago(m), bakeStatus: 'Succeeded', bakeStartTime: ago(m - 2), bakeEndTime: ago(m - 12), deployKind: 'Automatic', triggeredBy: SYSTEM });

/** the three prod Rollouts, built from the shared release-switch generator and then given their own status */
function shape(f: Fixture, r: Obj): Obj {
	const m = r.metadata as { namespace: string; name: string };
	if (m.namespace !== NS(f.app)) return r;
	const st = r.status as Obj;
	if (f === SEARCH) {
		return {
			...r,
			spec: { ...(r.spec as Obj), healthCheckSelector: { matchLabels: { app: f.app } } },
			status: {
				...st,
				history: [
					{
						id: 4,
						version: verOf(f, 4),
						timestamp: ago(30),
						bakeStatus: 'Failed',
						bakeStartTime: ago(28),
						bakeEndTime: ago(17),
						bakeStatusMessage: '1 test failed',
						deployKind: 'Automatic',
						triggeredBy: SYSTEM,
						failedHealthChecks: [
							{
								name: KUST(f.app),
								namespace: NS(f.app),
								class: 'kustomization',
								message: '1 test failed',
								rollbackOn: ['ApplyFailed', 'NotReady', 'TestFailed', 'Unclassified'],
								failures: [{ source: `RolloutTest ${NS(f.app)}/search-smoke-test`, kind: 'TestFailed', reason: 'RolloutTestFailed', message: 'GET /search?q=boots returned 503', rollsBack: true, why: 'CheckRollbackOn' }]
							}
						]
					},
					ok(f, 3, 3, 250),
					ok(f, 2, 2, 530),
					ok(f, 1, 1, 950)
				]
			}
		};
	}
	const spec = { ...(r.spec as Obj), autoRollback: { enabled: true }, healthCheckSelector: { matchLabels: { app: f.app } } };
	if (f === CART) {
		const tag = (n: number) => f.releases[n - 1].tag;
		const failedChecks = [
			{
				name: KUST(f.app),
				namespace: NS(f.app),
				class: 'kustomization',
				message: '2 tests failed',
				rollbackOn: ['ApplyFailed', 'NotReady', 'TestFailed', 'Unclassified'],
				failures: [
					{ source: `RolloutTest ${NS(f.app)}/cart-smoke-test`, kind: 'TestFailed', reason: 'RolloutTestFailed', message: 'POST /cart returned 500 for 3 of 3 attempts', rollsBack: true, why: 'CheckRollbackOn' },
					{ source: `RolloutTest ${NS(f.app)}/cart-flaky-ui-test`, kind: 'TestFailed', reason: 'RolloutTestFailed', message: 'timed out waiting for the checkout button', rollsBack: false, why: 'SourceOptedOut' }
				]
			}
		];
		return {
			...r,
			spec,
			status: {
				...st,
				currentVersion: tag(3),
				wantedVersion: tag(3),
				conditions: [cond('AutoRollback', 'True', 'RolledBack', `Rolled back 2.4.0 to 2.3.0: RolloutTest ${NS(f.app)}/cart-smoke-test failed`)],
				candidates: [{ tag: tag(4), gated: true, created: f.releases[3].created, firstSeen: f.releases[3].created, failedBake: true }],
				history: [
					{ id: 5, version: verOf(f, 3), timestamp: ago(6), bakeStatus: 'Succeeded', bakeStartTime: ago(6), bakeEndTime: ago(1), deployKind: 'AutoRollback', rollbackOf: 4, triggeredBy: SYSTEM, message: `Automatic rollback: 2.4.0 failed bake (RolloutTest ${NS(f.app)}/cart-smoke-test)` },
					{ id: 4, version: verOf(f, 4), timestamp: ago(31), bakeStatus: 'Failed', bakeStartTime: ago(29), bakeEndTime: ago(7), bakeStatusMessage: '2 tests failed', deployKind: 'Automatic', triggeredBy: SYSTEM, failedHealthChecks: failedChecks },
					ok(f, 3, 3, 200),
					ok(f, 2, 2, 470),
					ok(f, 1, 1, 900)
				]
			}
		};
	}
	if (f === CATALOG) {
		return {
			...r,
			spec,
			status: {
				...st,
				candidates: [{ tag: f.releases[4].tag, gated: true, created: f.releases[4].created, firstSeen: f.releases[4].created }],
				conditions: [cond('AutoRollback', 'False', 'NotATrigger', `Not rolled back: RolloutTest ${NS(f.app)}/catalog-flaky-ui-test failed and opted out (rollout.kuberik.com/rollback: false)`)],
				history: [
					{
						id: 4,
						version: verOf(f, 4),
						timestamp: ago(24),
						bakeStatus: 'Failed',
						bakeStartTime: ago(22),
						bakeEndTime: ago(9),
						bakeStatusMessage: '1 test failed',
						deployKind: 'Automatic',
						triggeredBy: SYSTEM,
						failedHealthChecks: [
							{
								name: KUST(f.app),
								namespace: NS(f.app),
								class: 'kustomization',
								message: '1 test failed',
								rollbackOn: ['ApplyFailed', 'NotReady', 'TestFailed', 'Unclassified'],
								failures: [{ source: `RolloutTest ${NS(f.app)}/catalog-flaky-ui-test`, kind: 'TestFailed', reason: 'RolloutTestFailed', message: 'screenshot differs from baseline by 0.4%', rollsBack: false, why: 'SourceOptedOut' }]
							}
						]
					},
					ok(f, 3, 3, 240),
					ok(f, 2, 2, 520),
					ok(f, 1, 1, 940)
				]
			}
		};
	}
	return {
		...r,
		spec,
		status: {
			...st,
			conditions: [cond('AutoRollback', 'False', 'ManualDeploy', '2.4.0 was deployed by hand (force deploy), so it is not rolled back automatically')],
			history: [
				{
					id: 4,
					version: verOf(f, 4),
					timestamp: ago(18),
					bakeStatus: 'Failed',
					bakeStartTime: ago(16),
					bakeEndTime: ago(5),
					bakeStatusMessage: '1 of 9 resources unhealthy',
					message: 'Force deployed past a held gate',
					deployKind: 'ForceDeploy',
					triggeredBy: { kind: 'User', name: 'Dana Whitaker' },
					failedHealthChecks: [
						{
							name: KUST(f.app),
							namespace: NS(f.app),
							class: 'kustomization',
							message: '1 of 9 resources unhealthy',
							rollbackOn: ['ApplyFailed', 'NotReady', 'TestFailed', 'Unclassified'],
							failures: [{ source: `Deployment ${NS(f.app)}/payments-gateway`, kind: 'NotReady', reason: 'ProgressDeadlineExceeded', message: 'ReplicaSet "payments-gateway-6d9f" has timed out progressing', rollsBack: true, why: 'CheckRollbackOn' }]
						}
					]
				},
				ok(f, 3, 3, 260),
				ok(f, 2, 2, 540),
				ok(f, 1, 1, 960)
			]
		}
	};
}

const rollouts = (): Obj[] => FIXTURES.flatMap((f) => rolloutsOf(f).map((r) => shape(f, r as Obj)));

/** the head deployed N minutes before THIS read: every history time shifts by the same amount */
const HEAD_AGE: Record<string, number> = { 'cart-service': 6, 'catalog-sync': 24, 'payments-gateway': 18, 'search-indexer': 30 };
function restamp(r: Obj): void {
	const m = r.metadata as { namespace?: string; name?: string } | undefined;
	const want = m?.name && m.namespace === NS(m.name) ? HEAD_AGE[m.name] : undefined;
	const history = (r.status as { history?: Obj[] } | undefined)?.history;
	const head = history?.[0];
	if (want == null || !head || typeof head.timestamp !== 'string') return;
	const delta = Date.now() - want * 60_000 - Date.parse(head.timestamp);
	if (Math.abs(delta) < 1000) return;
	const shift = (v: unknown): unknown => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(Date.parse(v) + delta).toISOString() : v);
	const walk = (o: Obj): void => {
		for (const k of ['timestamp', 'bakeStartTime', 'bakeEndTime', 'bakeHoldStartTime']) if (o[k]) o[k] = shift(o[k]);
	};
	history!.forEach((e) => walk(e));
	const c = (r.status as { conditions?: Obj[] }).conditions?.[0];
	if (c?.lastTransitionTime) c.lastTransitionTime = shift(c.lastTransitionTime);
}

const GH: Record<string, AppFixture> = Object.fromEntries(
	FIXTURES.map((f) => [f.app, curated(OWNER, f.app, f.releases.map((r) => r.tag), ['Tune connection pool sizes', 'Add retry budget to outbound calls', 'Fix stale totals after a coupon is removed', 'Cache price lookups for 30 seconds'], undefined, `Initial ${f.app} release`)])
);
const MERGE: Record<string, number> = Object.fromEntries(FIXTURES.flatMap((f) => f.releases.map((r, k) => [r.tag, (f.releases.length - k) * 150 + 20] as const)));

/** OPT-IN, called from dev-mock-api.ts before the state is built. `install(false)` takes the apps out. */
export function install(on = true): void {
	if (!on) {
		setExtraFixtures('auto-rollback', null);
		return;
	}
	for (const f of [CATALOG, PAYMENTS, SEARCH, CART]) keepFailed(NS(f.app), f.app, true);
	setExtraFixtures('auto-rollback', { environments: () => FIXTURES.flatMap(environmentsOf), rollouts, restamp });
	registerExtraApps(GH, MERGE);
}
