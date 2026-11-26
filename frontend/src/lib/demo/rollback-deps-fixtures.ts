/**
 * ROLLBACK AND THE DEPENDENCIES AROUND IT, MOCK ONLY. Provider/consumer pairs whose prod Rollouts carry every state the
 * dashboard has to say about an automatic rollback that could break a running consumer. The fields are the controller's
 * contract (`status.autoRollback`, `status.history[].autoRollback`, the `AutoRollback` condition's reasons,
 * `RolloutDependency.spec.providerRollback`).
 *
 *   OPT-IN: `MOCK_SCENARIO=rollback-deps` or `MOCK_FIXTURES=rollback-deps` (dev-mock-api.ts). Without it nothing here is imported.
 *
 *   provider -> consumer(s)            what the provider's prod Rollout says
 *   ledger-books -> checkout            blocked: 6.0.0 failed, the newest earlier good build (5.1.0) would break checkout
 *                  reporting-web       (its edge sets no providerRollback: Allow, the default, so it is not named in the block)
 *   rates-api -> pricing-web,          blocked by two consumers, one deployed by hand: "and 1 more"
 *                tax-service
 *   inventory-core -> fulfilment-web   constrained: 7.0.0 failed, rolled back to 6.0.2, skipped 5.1.0
 *   orders-api -> catalog-web          baking 3.4.1: a rollback check that fails would go to 3.4.0, skipping 3.3.0
 *   shipping-core -> label-web         baking 2.1.0: every earlier good build would break label-web
 *   notifications-core -> mailer-web   failed 4.0.0 was blocked; mailer-web has moved and the rollback is now safe
 *   ledger-books -> invoice-core       TargetRequires: invoice-core 4.1.0 failed and its usual rollback target needs ledger ^5.0.0, but ledger-books serves 6.0.0
 *   pricing-core -> storefront-web     healthy; a manual Roll back to 4.9.0 or 5.0.0 warns (GET .../rollback-check)
 *
 * Every time is relative to the read (`restamp`), so a capture at any moment reads the same ages.
 */
import { registerExtraApps, curated, OWNER, type AppFixture } from './github-data';
import { setExtraFixtures, setExtraRollbackCheck, keepFailed } from './extra-fixtures';
import { build, environmentsOf, rolloutsOf, type Fixture } from './release-switch-fixtures';
import { SOURCE_CLUSTER } from './mock-data';

type Obj = Record<string, unknown>;
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const NS = (app: string) => `${app}-prod-default`;
const SYSTEM = { kind: 'System', name: 'rollout-controller' };

/** versions oldest-deployed first (the order the Rollout ran them, not semver order), the index of the head, its bake, and what each consumer build requires */
type Cfg = { prefix: string; vers: string[]; head: number; bake: string; requires?: Record<string, Record<string, string>> };
const CFG: Record<string, Cfg> = {
	'ledger-books': { prefix: 'lc', vers: ['5.0.0', '5.1.0', '6.0.0'], head: 3, bake: 'Failed' },
	checkout: { prefix: 'co', vers: ['3.1.0', '3.2.0'], head: 2, bake: 'Succeeded', requires: { '3.2.0': { ledger: '^6.0.0' } } },
	'reporting-web': { prefix: 'rw', vers: ['1.3.0', '1.4.0'], head: 2, bake: 'Succeeded', requires: { '1.4.0': { ledger: '^6.0.0' } } },
	'rates-api': { prefix: 'ra', vers: ['2.0.0', '2.1.0', '3.0.0'], head: 3, bake: 'Failed' },
	'pricing-web': { prefix: 'pw', vers: ['8.1.0', '8.2.0'], head: 2, bake: 'Succeeded', requires: { '8.2.0': { rates: '^3.0.0' } } },
	'tax-service': { prefix: 'ts', vers: ['4.0.0', '4.0.1'], head: 2, bake: 'Succeeded', requires: { '4.0.1': { rates: '^3.0.0' } } },
	'inventory-core': { prefix: 'ic', vers: ['6.0.2', '5.1.0', '7.0.0'], head: 3, bake: 'Failed' },
	'fulfilment-web': { prefix: 'fw', vers: ['2.0.0', '2.1.0'], head: 2, bake: 'Succeeded', requires: { '2.1.0': { inventory: '^6.0.0' } } },
	'orders-api': { prefix: 'oa', vers: ['3.4.0', '3.3.0', '3.4.1'], head: 3, bake: 'InProgress' },
	'catalog-web': { prefix: 'cw', vers: ['6.0.0', '6.1.0'], head: 2, bake: 'Succeeded', requires: { '6.1.0': { orders: '^3.4.0' } } },
	'shipping-core': { prefix: 'sc', vers: ['1.9.0', '2.0.0', '2.1.0'], head: 3, bake: 'InProgress' },
	'label-web': { prefix: 'lw', vers: ['4.0.0', '4.1.0'], head: 2, bake: 'Succeeded', requires: { '4.1.0': { shipping: '^2.1.0' } } },
	'notifications-core': { prefix: 'nc', vers: ['3.1.0', '3.2.0', '4.0.0'], head: 3, bake: 'Failed' },
	'mailer-web': { prefix: 'mw', vers: ['3.0.0', '2.9.0'], head: 2, bake: 'Succeeded', requires: { '3.0.0': { notifications: '^4.0.0' }, '2.9.0': { notifications: '^3.0.0' } } },
	'invoice-core': { prefix: 'iv', vers: ['3.9.0', '4.0.0', '4.1.0'], head: 3, bake: 'Failed' },
	'pricing-core': { prefix: 'pc', vers: ['4.9.0', '5.0.0', '5.1.0'], head: 3, bake: 'Succeeded' },
	'storefront-web': { prefix: 'sw', vers: ['8.9.0', '9.0.0'], head: 2, bake: 'Succeeded', requires: { '9.0.0': { pricing: '^5.1.0' } } }
};
const FIX: Record<string, Fixture> = Object.fromEntries(
	Object.entries(CFG).map(([app, c]) => [app, build(app, c.prefix, (n) => c.vers[n - 1], 1, c.vers.length, [{ tier: 'prod', site: 'default', wave: 1, cluster: 'prod', at: c.head, bake: c.bake }])])
);
const FIXTURES = Object.values(FIX);
export const ROLLBACK_DEPS_APPS = FIXTURES.map((f) => f.app);

const tagOf = (app: string, version: string) => FIX[app].releases.find((r) => r.version === version)!.tag;
const rel = (app: string, version: string) => FIX[app].releases.find((r) => r.version === version)!;
const verOf = (app: string, version: string) => {
	const r = rel(app, version);
	return { tag: r.tag, version: r.version, revision: r.revision, created: r.created };
};

/** one DependencyBreak (ConsumerRequires): the consumer, the build it runs, what that build needs of the contract */
const brk = (consumer: string, contract: string, version: string, requires: string, extra: Obj = {}): Obj => ({
	kind: 'ConsumerRequires',
	rollout: consumer,
	namespace: NS(consumer),
	dependency: `${consumer}-needs-${contract}`,
	contract,
	requires,
	version,
	reason: 'ConstraintNotSatisfied',
	...extra
});

const cond = (type: string, status: 'True' | 'False', reason: string, message: string) => ({ type, status, reason, message, lastTransitionTime: ago(3), observedGeneration: 1 });
const failedChecks = (app: string, test: string, message: string) => [
	{
		name: `${app}-kustomization-health-check`,
		namespace: NS(app),
		class: 'kustomization',
		message: '1 test failed',
		failures: [{ source: `RolloutTest ${NS(app)}/${test}`, kind: 'TestFailed', reason: 'RolloutTestFailed', message, severity: 'Critical', rollsBack: true, why: 'AtOrAboveThreshold' }]
	}
];
/** the failed head's own fields, merged onto the generated history entry */
const failedHead = (app: string, test: string, message: string, selection: Obj | null): Obj => ({
	bakeStartTime: ago(28),
	bakeEndTime: ago(17),
	bakeStatusMessage: '1 test failed',
	deployKind: 'Automatic',
	triggeredBy: SYSTEM,
	failedHealthChecks: failedChecks(app, test, message),
	...(selection ? { autoRollback: selection } : {})
});

const BLOCK_MSG = (provider: string, target: string, consumer: string, requires: string, held: string) =>
	`Not rolled back: rolling ${provider} back to ${target} would break ${consumer} (needs ${requires}). No earlier good build serves what every running consumer needs; ${held} stays held.`;

/** the Rollouts, built from the shared release-switch generator and then given their own status */
function shape(f: Fixture, r: Obj): Obj {
	const st = r.status as Obj;
	const hist = (st.history as Obj[]).map((e) => ({ ...e }));
	const app = f.app;
	const c = CFG[app];
	// what each consumer build requires, on the build itself
	for (const e of hist) {
		const v = e.version as Obj;
		const need = c.requires?.[v.version as string];
		if (need) e.version = { ...v, requires: need };
	}
	const out = (over: Obj, spec: Obj = {}): Obj => ({ ...r, spec: { ...(r.spec as Obj), healthCheckSelector: { matchLabels: { app } }, ...spec }, status: { ...st, ...over, history: over.history ?? hist } });
	const optIn = { autoRollback: { minSeverity: 'Critical' } };
	const headTag = (v: string) => tagOf(app, v);
	const candidate = (v: string) => [{ tag: headTag(v), gated: true, created: rel(app, v).created, firstSeen: rel(app, v).created, failedBake: true }];

	switch (app) {
		case 'ledger-books': {
			const sel = { usualTarget: tagOf(app, '5.1.0'), blockedBy: [brk('checkout', 'ledger', '3.2.0', '^6.0.0')] };
			hist[0] = { ...hist[0], ...failedHead(app, 'ledger-smoke-test', 'POST /postings returned 500 for 3 of 3 attempts', sel) };
			return out({ conditions: [cond('AutoRollback', 'False', 'ConsumerRequires', BLOCK_MSG('ledger-books', '5.1.0', 'checkout', 'ledger ^6.0.0', '6.0.0'))], candidates: candidate('6.0.0') }, optIn);
		}
		case 'rates-api': {
			const sel = {
				usualTarget: tagOf(app, '2.1.0'),
				blockedBy: [brk('pricing-web', 'rates', '8.2.0', '^3.0.0'), brk('tax-service', 'rates', '4.0.1', '^3.0.0', { deployKind: 'ForceDeploy' })]
			};
			hist[0] = { ...hist[0], ...failedHead(app, 'rates-contract-test', 'GET /rates/EUR returned 502', sel) };
			return out({ conditions: [cond('AutoRollback', 'False', 'ConsumerRequires', BLOCK_MSG('rates-api', '2.1.0', 'pricing-web', 'rates ^3.0.0', '3.0.0') + ' (and 1 more)')], candidates: candidate('3.0.0') }, optIn);
		}
		case 'inventory-core': {
			const failedTag = headTag('7.0.0');
			const sel = {
				usualTarget: headTag('5.1.0'),
				target: headTag('6.0.2'),
				skipped: [{ tag: headTag('5.1.0'), version: '5.1.0', breaks: [brk('fulfilment-web', 'inventory', '2.1.0', '^6.0.0')] }]
			};
			const failed = { ...hist[0], id: 4, ...failedHead(app, 'inventory-smoke-test', 'GET /stock/sku-1182 returned 500', null) };
			const good = (v: string, id: number, m: number) => ({ id, version: verOf(app, v), timestamp: ago(m), bakeStatus: 'Succeeded', bakeStartTime: ago(m - 2), bakeEndTime: ago(m - 12), deployKind: 'Automatic', triggeredBy: SYSTEM });
			const history = [
				{ id: 5, version: verOf(app, '6.0.2'), timestamp: ago(6), bakeStatus: 'Succeeded', bakeStartTime: ago(6), bakeEndTime: ago(1), deployKind: 'AutoRollback', rollbackOf: 4, triggeredBy: SYSTEM, message: 'Automatic rollback: 7.0.0 failed bake', autoRollback: sel },
				failed,
				good('5.1.0', 3, 200),
				good('6.0.2', 2, 470)
			];
			return out(
				{
					currentVersion: headTag('6.0.2'),
					wantedVersion: headTag('6.0.2'),
					conditions: [cond('AutoRollback', 'True', 'RolledBack', `Rolled back 7.0.0 to 6.0.2: RolloutTest ${NS(app)}/inventory-smoke-test failed. Skipped 5.1.0: fulfilment-web needs inventory ^6.0.0.`)],
					candidates: [{ tag: failedTag, gated: true, created: rel(app, '7.0.0').created, firstSeen: rel(app, '7.0.0').created, failedBake: true }],
					history
				},
				optIn
			);
		}
		case 'orders-api': {
			const live = {
				for: headTag('3.4.1'),
				usualTarget: headTag('3.3.0'),
				target: headTag('3.4.0'),
				skipped: [{ tag: headTag('3.3.0'), version: '3.3.0', breaks: [brk('catalog-web', 'orders', '6.1.0', '^3.4.0')] }],
				evaluatedTime: ago(2)
			};
			hist[0] = { ...hist[0], bakeStatusMessage: 'Checking', deployKind: 'Automatic', triggeredBy: SYSTEM };
			return out({ autoRollback: live }, optIn);
		}
		case 'shipping-core': {
			const live = { for: headTag('2.1.0'), usualTarget: headTag('2.0.0'), blockedBy: [brk('label-web', 'shipping', '4.1.0', '^2.1.0')], evaluatedTime: ago(2) };
			hist[0] = { ...hist[0], bakeStatusMessage: 'Checking', deployKind: 'Automatic', triggeredBy: SYSTEM };
			return out({ autoRollback: live }, optIn);
		}
		case 'notifications-core': {
			// 4.0.0 failed while mailer-web (then on 3.0.0, which needs ^4.0.0) ran; mailer-web has since moved to 2.9.0 (needs ^3.0.0)
			const sel = { usualTarget: tagOf(app, '3.2.0'), blockedBy: [brk('mailer-web', 'notifications', '3.0.0', '^4.0.0')] };
			hist[0] = { ...hist[0], ...failedHead(app, 'notifications-smoke-test', 'POST /send returned 503', sel) };
			const live = { for: headTag('4.0.0'), usualTarget: headTag('3.2.0'), target: headTag('3.2.0'), evaluatedTime: ago(1) };
			return out({ conditions: [cond('AutoRollback', 'False', 'ConsumerRequires', BLOCK_MSG('notifications-core', '3.2.0', 'mailer-web', 'notifications ^4.0.0', '4.0.0'))], candidates: candidate('4.0.0'), autoRollback: live }, optIn);
		}
		case 'invoice-core': {
			// the usual target (4.0.0) needs ledger ^5.0.0 but ledger-books serves 6.0.0: a TargetRequires block, no consumer is named
			const sel = { usualTarget: tagOf(app, '4.0.0'), blockedBy: [{ kind: 'TargetRequires', rollout: 'ledger-books', namespace: NS('ledger-books'), dependency: 'invoice-core-needs-ledger', contract: 'ledger', requires: '^5.0.0', version: '6.0.0', reason: 'ConstraintNotSatisfied' }] };
			hist[0] = { ...hist[0], ...failedHead(app, 'invoice-smoke-test', 'POST /invoices returned 500', sel) };
			return out({ conditions: [cond('AutoRollback', 'False', 'TargetRequires', 'Not rolled back: 4.0.0 needs ledger ^5.0.0 but ledger-books serves 6.0.0. No earlier good build can run against what its providers serve; 4.1.0 stays held.')], candidates: candidate('4.1.0') }, optIn);
		}
		case 'pricing-core':
			return out({}, optIn);
		default:
			return out({});
	}
}

const rollouts = (): Obj[] => FIXTURES.flatMap((f) => rolloutsOf(f).map((r) => shape(f, r as Obj)));

/** the edges: provider -> consumer on one contract; Allow (the default, unset) on reporting-web, an explicit Block everywhere else */
const EDGES: { provider: string; consumer: string; contract: string; policy?: 'Block' }[] = [
	{ provider: 'ledger-books', consumer: 'checkout', contract: 'ledger', policy: 'Block' },
	{ provider: 'ledger-books', consumer: 'reporting-web', contract: 'ledger' },
	{ provider: 'rates-api', consumer: 'pricing-web', contract: 'rates', policy: 'Block' },
	{ provider: 'rates-api', consumer: 'tax-service', contract: 'rates', policy: 'Block' },
	{ provider: 'inventory-core', consumer: 'fulfilment-web', contract: 'inventory', policy: 'Block' },
	{ provider: 'orders-api', consumer: 'catalog-web', contract: 'orders', policy: 'Block' },
	{ provider: 'shipping-core', consumer: 'label-web', contract: 'shipping', policy: 'Block' },
	{ provider: 'notifications-core', consumer: 'mailer-web', contract: 'notifications', policy: 'Block' },
	{ provider: 'ledger-books', consumer: 'invoice-core', contract: 'ledger', policy: 'Block' },
	{ provider: 'pricing-core', consumer: 'storefront-web', contract: 'pricing', policy: 'Block' }
];
const dependencies = (): Obj[] =>
	EDGES.map((e) => {
		const head = FIX[e.provider].releases[CFG[e.provider].head - 1];
		return {
			apiVersion: 'kuberik.com/v1alpha1',
			kind: 'RolloutDependency',
			metadata: { name: `${e.consumer}-needs-${e.contract}`, namespace: NS(e.consumer), annotations: { [SOURCE_CLUSTER]: 'prod' } },
			spec: { contract: e.contract, providerRef: { name: e.provider, namespace: NS(e.provider) }, rolloutRef: { name: e.consumer }, ...(e.policy ? { providerRollback: e.policy } : {}) },
			status: {
				providedVersion: head.version,
				providedTag: head.tag,
				admittedVersions: [],
				blockedReleases: [],
				gateName: `dependency-${e.consumer}-needs-${e.contract}`,
				conditions: [
					{ type: 'Ready', status: 'True', reason: 'GateSynced', message: 'Gate allows 0 release(s)' },
					{ type: 'Satisfied', status: 'True', reason: 'DependencySatisfied', message: `No release is waiting on contract "${e.contract}"` }
				]
			}
		};
	});

/** GET .../rollback-check?tag=: what a manual rollback to `tag` breaks. Only pricing-core, ledger-books and rates-api have consumers that care. */
const CHECKS: Record<string, (version: string) => Obj[]> = {
	'pricing-core': (v) => (['4.9.0', '5.0.0'].includes(v) ? [brk('storefront-web', 'pricing', '9.0.0', '^5.1.0')] : []),
	'ledger-books': (v) => (v === '5.1.0' || v === '5.0.0' ? [brk('checkout', 'ledger', '3.2.0', '^6.0.0'), brk('reporting-web', 'ledger', '1.4.0', '^6.0.0', { allowed: true })] : []),
	'rates-api': (v) => (v === '3.0.0' ? [] : [brk('pricing-web', 'rates', '8.2.0', '^3.0.0'), brk('tax-service', 'rates', '4.0.1', '^3.0.0', { deployKind: 'ForceDeploy' })])
};
function rollbackCheck(ns: string, name: string, tag: string): { breaks: Obj[]; hiddenConsumers?: number } | undefined {
	const f = FIX[name];
	if (!f || ns !== NS(name)) return undefined;
	const version = f.releases.find((r) => r.tag === tag)?.version;
	if (!version) return undefined;
	const breaks = CHECKS[name]?.(version) ?? [];
	// pricing-core 4.9.0 also breaks two consumers in namespaces the viewer cannot list: their rows are removed and only counted
	return { breaks, ...(name === 'pricing-core' && version === '4.9.0' ? { hiddenConsumers: 2 } : {}) };
}

/** the head deployed N minutes before THIS read: every history time shifts by the same amount */
const HEAD_AGE: Record<string, number> = { 'ledger-books': 30, 'rates-api': 30, 'inventory-core': 6, 'orders-api': 4, 'shipping-core': 5, 'notifications-core': 30, 'invoice-core': 30 };
function restamp(r: Obj): void {
	const m = r.metadata as { namespace?: string; name?: string } | undefined;
	const want = m?.name && m.namespace === NS(m.name) ? HEAD_AGE[m.name] : undefined;
	const history = (r.status as { history?: Obj[] } | undefined)?.history;
	const head = history?.[0];
	if (want == null || !head || typeof head.timestamp !== 'string') return;
	const delta = Date.now() - want * 60_000 - Date.parse(head.timestamp);
	if (Math.abs(delta) < 1000) return;
	const shift = (v: unknown): unknown => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(Date.parse(v) + delta).toISOString() : v);
	history!.forEach((e) => {
		for (const k of ['timestamp', 'bakeStartTime', 'bakeEndTime', 'bakeHoldStartTime']) if (e[k]) e[k] = shift(e[k]);
	});
	const st = r.status as { conditions?: Obj[]; autoRollback?: Obj };
	const c = st.conditions?.[0];
	if (c?.lastTransitionTime) c.lastTransitionTime = shift(c.lastTransitionTime);
	if (st.autoRollback?.evaluatedTime) st.autoRollback.evaluatedTime = shift(st.autoRollback.evaluatedTime);
}

const GH: Record<string, AppFixture> = Object.fromEntries(
	FIXTURES.map((f) => [f.app, curated(OWNER, f.app, f.releases.map((r) => r.tag), ['Tune connection pool sizes', 'Add retry budget to outbound calls', 'Cache lookups for 30 seconds'], undefined, `Initial ${f.app} release`)])
);
const MERGE: Record<string, number> = Object.fromEntries(FIXTURES.flatMap((f) => f.releases.map((r, k) => [r.tag, (f.releases.length - k) * 150 + 20] as const)));

/** OPT-IN, called from dev-mock-api.ts before the state is built. `install(false)` takes the apps out. */
export function install(on = true): void {
	if (!on) {
		setExtraFixtures('rollback-deps', null);
		setExtraRollbackCheck(null);
		return;
	}
	for (const f of FIXTURES) if (CFG[f.app].bake === 'Failed') keepFailed(NS(f.app), f.app, true);
	setExtraFixtures('rollback-deps', { environments: () => FIXTURES.flatMap(environmentsOf), rollouts, dependencies, restamp });
	setExtraRollbackCheck(rollbackCheck);
	registerExtraApps(GH, MERGE);
}
