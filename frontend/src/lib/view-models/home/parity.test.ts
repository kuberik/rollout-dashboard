import { describe, expect, it } from 'vitest';
import expected from './expected/lab-home-model.json';
import { buildHomeModel } from '../home-model';
import { homeInput } from './fixture';

const SIGNAL_KEY_TIME = /\|\d{4}-\d{2}-\d{2}T[^|]*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
/** Clock fields: the fixture was captured days after the lab export, so absolute instants and raw ms ages differ by construction. */
const TIME_KEYS = new Set(['ageMs', 'durationMs', 'leftMs', 'bakeLeftMs', 'elapsedMs', 'sinceMs']);

function normalize(v: unknown, path: string[] = []): unknown {
	if (Array.isArray(v)) return v.map((x, i) => normalize(x, [...path, String(i)]));
	if (v && typeof v === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v)) {
			if (k === 'now') continue;
			// product-only: the structured facts each phrase is worded from (the lab export predates them)
			if (k === 'facts') continue;
			// product-only: a rolled-back change the running build carries again (`EnvChange.liveAgain`)
			if (k === 'liveAgain') continue;
			// product-only: the dependency a held change waits on and its Gates tab (`EnvChange.waitsOn`, `waitsOnHref`)
			if (k === 'waitsOn' || k === 'waitsOnHref') continue;
			// product-only: when a held place's hold began (`AppEnv.heldSince`)
			if (k === 'heldSince') continue;
			// product-only: the finished page links of each app and each of its places (`AppModel.href`, `AppEnv.href`)
			if (k === 'href' && (path.at(-2) === 'envs' || (path.length === 2 && path[0] === 'apps')))
				continue;
			if (k === 'key' && path.includes('signals') && typeof x === 'string') {
				out[k] = x.replace(SIGNAL_KEY_TIME, '|<t>');
				continue;
			}
			if (typeof x === 'string' && ISO.test(x)) {
				out[k] = '<iso>';
				continue;
			}
			if (TIME_KEYS.has(k)) {
				out[k] = '<ms>';
				continue;
			}
			out[k] = normalize(x, [...path, k]);
		}
		return out;
	}
	return v;
}

function diffs(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
	if (out.length > 200) return out;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) out.push(`${path}: length ${a.length} != ${b.length}`);
		for (let i = 0; i < Math.min(a.length, b.length); i++) diffs(a[i], b[i], `${path}[${i}]`, out);
		return out;
	}
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		for (const k of keys)
			diffs(
				(a as Record<string, unknown>)[k],
				(b as Record<string, unknown>)[k],
				`${path}.${k}`,
				out
			);
		return out;
	}
	if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
	return out;
}

/**
 * PARITY WITH THE LAB. `expected/lab-home-model.json` is the home lab's own
 * export (`lib/lab/home-model.json`, written by design/home-r12-data
 * 3d168544's `buildHomeModel` on the demo's `incident` scenario). The
 * fixture is the same scenario's raw inputs, captured later. With `now`
 * pinned to the fixture's `capturedAt`, the product module reproduces every
 * field except clock values (absolute instants, raw ms ages) and the
 * capture-time stamp inside `signals[].key`.
 *
 * Two deliberate departures from the lab export (2026-10-25): checkout-api's
 * and hello-frontend-app's `envs[].myChanges` and `merged` are this model's
 * output on the corrected fixture. The lab's demo GitHub data carried build
 * tags (`b-42`, `rel-66`) where commit SHAs belong, so the lab read #13, #80,
 * #81 and rel-64 as merged-but-unreleased; the fixture's changes now carry
 * the revisions the rollouts run, and those changes are placed by env.
 * The eu-west/hello prod `pipeline.bake: fail` values likewise follow the
 * fixture's controller-possible Failed heads.
 *
 * (2026-10-31, authors) The fixture's PR authors follow the mock GitHub endpoint, so
 * the viewer (danielreed) no longer authors checkout-api #81, hello-frontend-app #13,
 * orders-api #90 or hello-world's e4f5a6b, and does author platform-telemetry #20 (carried
 * by telemetry-collector, -forwarder, -indexer, -worker, now `tier: starred`). The
 * expectation's `myChanges` on those apps (and tier) are the model's output on the
 * corrected fixture; the lab export is otherwise unchanged. There is no script that
 * regenerates `expected/lab-home-model.json`: it was patched at those paths only.
 *
 * (2026-10-25, fix3) checkout-api prod-ap-southeast-2 and prod-us-east-2 also
 * carry #81 as `held-by-rule`: its build b-43 is refused there by the
 * RolloutDependency on payments ~2.9.0 (2.4.1 provided). `pr-pipeline.ts`
 * reads that cell as `promoting` (its gates alone allow b-43) while the shared
 * held predicate (`PrCell.held`, contract holds included) says the place
 * refuses it; the lab dropped it as not-yet-reached and showed #81 as live.
 *
 * (2026-10-25, fix4) The fixture now carries the `dependency-<name>` gates the
 * controller writes into `status.gates`, so b-43's cell there is
 * `waiting-upstream` on the dependency gate itself, and every held entry is
 * dated the same way #81 is: its build's arrival one tier upstream. A held cell
 * has no time of its own (`pr-pipeline.ts` builds it with `since: null`), and
 * the lab left it `null`. So invoice-api #40 (prod us-east, awaiting approval,
 * 15:11), orders-api #90 (staging, 15:29) and recommender-svc #28 (prod,
 * 13:41) carry a `since` in the expectation where the lab had `null`.
 *
 * (2026-10-25, fix5) The fixture's RolloutDependency statuses are regenerated
 * with the controller's `evaluateDependency`: a build's requirement comes from
 * its image, so b-43 needs payments ~2.9.0 at every consumer, and payments-svc
 * serves 2.4.1 everywhere. prod-us-east-1 used to admit b-43 (the captured
 * status disagreed with prod-ap-southeast-2's about the same build); it now
 * refuses it, so us-east-1 carries #81 as `held-by-rule` like ap-southeast-2.
 *
 * (2026-10-25, fix6) hello-world's staging used to deploy f68d0ac at 19:16,
 * before dev finished baking it (19:36), and a1b2c3d at 13:16, before dev had
 * built it. The environment-controller only admits a build downstream after
 * the upstream env's bake Succeeded. a1b2c3d's dev build, deploy and bake
 * therefore move one hour earlier, so prod's 17:31 arrival (Home: "since
 * 17:31") still follows staging's bake of it. Staging takes f68d0ac at 19:37
 * and is still waiting for health checks at capture (`Deploying`). That is
 * why prod stays on a1b2c3d: its promotion gate now admits nothing, where it
 * used to admit f68d0ac. No pin is involved. `spec.wantedVersion` is unset,
 * and the fixture's `status.wantedVersion` copies the head on every rollout.
 * The expectation therefore reads hello-world as `deploying in staging`
 * (4m, staging cell active, bake pending, its changes live there since
 * a1b2c3d's arrival). sinceDelta.deploys is 153: staging's history gains the
 * 7c8d9e0 bake (2026-10-23 20:01) that prod's 11:31 promotion of it needs.
 */
/**
 * Deliberate departures from the lab export, each `[app, field, value]` on
 * `apps[]`, applied to the expectation before comparing.
 *
 * - (2026-10-25, fix3) A failure's age is time since it began failing: the
 *   failed attempt's `bakeEndTime`, falling back to the deploy start only when
 *   the entry has none (`eventAge('failed')`'s rule). The lab dated a failing
 *   check with no controller condition from the deploy (`history[0].timestamp`),
 *   so hello-frontend-app prod read 30m in Needs you and 20m in Your changes,
 *   and checkout-worker staging 3m and 2m. Both now read the failure's own end.
 * - (2026-10-25, fix6) edge-mesh dev's InProgress bake started at 19:00:32,
 *   32 minutes before the captured deploy (19:32:32). The controller only
 *   starts a bake after the deploy, so the deploy moved back to the bake's
 *   start. The bake start stays, because Home's slow-bake watch line ("bake
 *   41m, usually 12m") is computed from it. edge-mesh's in-motion figure counts
 *   from the deploy, so it now reads 41m where the lab read 9m.
 */
const DEPARTURES: [string, string, unknown][] = [
	['checkout-worker', 'figure', '2m'],
	['hello-frontend-app', 'figure', '20m'],
	['edge-mesh', 'figure', '41m'],
	// fix8: invoice-api prod eu-west has no gate, so the controller took a11c202 at 10:32 (when dev
	// had it), not 11:25; its failure began at 10:33: 9h
	['invoice-api', 'figure', '9h'],
	// fix8: payments-core's prod regions took 9b7e410/2a55f0c at 23:41, hours after the build, with no
	// gate to explain the wait; they carry a person's release-approval gate (it admitted the build
	// each runs). f4a2c19 and c0d3e88 now wait for that approval, and the app leads with it
	['payments-core', 'figure', '4h'],
	['payments-core', 'phrase', 'waits for approval in prod-us-east'],
	[
		'payments-core',
		'primaryAction',
		{ label: 'Review approval', href: '/rollouts/prod/payments-core-prod-us-east/payments-core' }
	]
];

/**
 * Signals the lab export has and the product deliberately drops, `[app, kind]`.
 *
 * - (2026-10-25, fix7 A1) edge-mesh dev's slow bake. The lab compared the bake
 *   (41m) with the rollout's earlier bakes (12m). The rollout-controller ends a
 *   bake exactly at bakeStartTime + spec.bakeTime, and edge-mesh dev's is 60m,
 *   so a bake 41m in is on schedule. Slow now means past spec.bakeTime by more
 *   than `SIGNAL_WINDOWS.slowBakeMarginMs`.
 */
const DROPPED_SIGNALS: [string, string][] = [['edge-mesh', 'slow-bake']];

/**
 * Signals the product has and the lab export does not, `[index, signal]` (normalized).
 *
 * - (2026-10-25, hc-v2) telemetry-collector prod's error-rate check flaps: it
 *   failed 7b3c9f1's deploy at 18:24 (recorded in that entry's
 *   failedHealthChecks), passed when 4a8d2e6's bake started, failed again at
 *   19:33 and is Healthy now. The lab had no HealthCheck feed (`healthChecks:
 *   null`), so it had no check signals at all. The added 7b3c9f1 deploy also
 *   counts in fleet.sinceDelta.deploys: 155 -> 156.
 */
const ADDED_SIGNALS: [number, Record<string, unknown>][] = [
	[
		3,
		{
			key: 'check-flapping|telemetry-collector|prod|<t>',
			kind: 'check-flapping',
			app: 'telemetry-collector',
			env: 'prod',
			phrase: 'error-rate 2× in 1h, expected 0',
			since: '<iso>',
			ageMs: '<ms>',
			href: '/rollouts/prod/telemetry-collector-prod/telemetry-collector'
		}
	]
];

/**
 * Deliberate departures on one change in one env, `[app, env, ref, field, value]`
 * on `apps[].envs[].myChanges[]`.
 *
 * - (2026-10-25, fix7 B3) The controller ends a bake at bakeStartTime +
 *   spec.bakeTime and, with no bake configuration, marks a deploy Succeeded at
 *   once, so an InProgress bake needs a bakeTime. invoice-api test is now set to
 *   10m and checkout-api's prod regions to 30m (#80 in us-east-2 25m in: 5
 *   minutes left). The lab had no bakeTime there and so no minutes. (fix8 F1:
 *   invoice-api test's bake of #43 is over, see ENV_DEPARTURES.)
 */
const CHANGE_DEPARTURES: [string, string, string, string, unknown][] = [
	['checkout-api', 'prod-us-east-2', '#80', 'checkingMinutesLeft', 5],
	// 2026-11-09: the corrected incident fixture / mock GitHub endpoint titles checkout-worker's #14 "Add retry budget to payment webhook"; the frozen lab export still says "Add dead-letter queue for failed checkout events".
	['checkout-worker', 'dev', '#14', 'title', 'Add retry budget to payment webhook'],
	['checkout-worker', 'staging', '#14', 'title', 'Add retry budget to payment webhook']
];

/**
 * Deliberate departures on one env, `[app, env, patch]`: scalar fields set,
 * `myChanges[i]` merged with `patch.myChanges[i]`.
 *
 * - (2026-10-25, fix7 B1) invoice-api staging is promoted After test (an
 *   environment-controller gate, `promotion-staging`). Nothing held staging
 *   back from a11c707 (#42), whose test bake Succeeded at 17:36, so the
 *   rollout-controller took it at 17:37: staging runs a11c707, #42 is its
 *   occupant and #41 the superseded predecessor (the lab had a11c606 with #41
 *   and #40). fleet.sinceDelta.deploys counts that deploy: 153 -> 154.
 * - (2026-10-25, fix7 B1) invoice-api prod us-west had no gate, so the
 *   controller would already have taken a11c909. Every invoice-api prod region
 *   needs a person's approval, as us-east does: us-west carries the same
 *   manual-approval gate (approving a11c404, which it runs), so #40 waits for a
 *   reviewer there too, and #38 (contained in a11c404) is listed after #39.
 * - (2026-10-25, fix8 F1) invoice-api test is promoted After dev (an
 *   environment-controller gate, `promotion-test`), as the rest of its history
 *   (every deploy at dev's bake end) already said. So it took a11c808 at 18:32,
 *   when dev's bake Succeeded, not at 19:38, and its 10m bake Succeeded at
 *   18:42: test is healthy, #43 its occupant and #42 the superseded predecessor
 *   (the lab had #43 in bake). staging (After test) then took a11c808 at 18:43:
 *   #43 and #42 there. fleet.sinceDelta.deploys counts staging's deploy:
 *   154 -> 155.
 * - (2026-10-25, hc HC-1) #41 is in the build staging runs and not in prod, so
 *   it is unfinished and stays placed at staging, its furthest reached env, as
 *   a third (superseded) entry: fix 3's two-per-env cap never hides an
 *   unfinished change (fix8 F1 had let it drop out).
 */
const ENV_DEPARTURES: [string, string, Record<string, unknown>][] = [
	[
		'invoice-api',
		'test',
		{
			state: 'healthy',
			pipeline: { bake: 'done' },
			myChanges: [{ state: 'healthy', checkingMinutesLeft: null }, { state: 'superseded' }]
		}
	],
	[
		'invoice-api',
		'staging',
		{
			version: 'a11c808',
			myChanges: [
				{
					ref: '#43',
					title: 'Fix timezone handling in due-date calculation',
					href: '/changes/github.com/exampleco/invoice-api/pull/43'
				},
				{
					ref: '#42',
					title: 'Raise default invoice line-item limit to 500',
					href: '/changes/github.com/exampleco/invoice-api/pull/42'
				},
				{
					ref: '#41',
					title: 'Add bulk invoice export endpoint',
					href: '/changes/github.com/exampleco/invoice-api/pull/41',
					mergedAt: '<iso>',
					since: '<iso>',
					checkingMinutesLeft: null,
					repo: 'invoice-api',
					apps: ['invoice-api'],
					state: 'superseded'
				}
			]
		}
	],
	...['prod-ap-south', 'prod-eu-west', 'prod-sa-east', 'prod-us-east', 'prod-us-west'].map(
		(env): [string, string, Record<string, unknown>] => [
			'payments-core',
			env,
			{ state: 'awaiting-approval' }
		]
	),
	[
		'invoice-api',
		'prod-us-west',
		{
			state: 'awaiting-approval',
			myChanges: [
				{
					ref: '#40',
					title: 'Encrypt invoice PDFs at rest',
					href: '/changes/github.com/exampleco/invoice-api/pull/40',
					state: 'awaiting-approval'
				},
				{
					ref: '#39',
					title: 'Add support for partial invoice credits',
					href: '/changes/github.com/exampleco/invoice-api/pull/39',
					state: 'healthy'
				},
				{
					ref: '#38',
					title: 'Switch invoice numbering to a per-tenant sequence',
					href: '/changes/github.com/exampleco/invoice-api/pull/38',
					mergedAt: '<iso>',
					since: '<iso>',
					checkingMinutesLeft: null,
					repo: 'invoice-api',
					apps: ['invoice-api'],
					state: 'superseded'
				}
			]
		}
	]
];

/**
 * - (2026-10-25, fix7 B2) checkout-api prod af-south-1's 14:41 rollback to b-40
 *   (sarahmiller, "Rolled back: error rate over SLO") is still in effect. A
 *   dashboard rollback pins (spec.wantedVersion); without the pin the
 *   controller would already have taken b-43, which af-south-1's promotion gate
 *   admits. The pinned place is a Needs-you entry of the model (Home's view is
 *   unchanged: decision 1 keeps Needs you to your own failing changes).
 */
const ADDED_NEEDS_YOU: [number, Record<string, unknown>][] = [
	[
		1,
		{
			app: 'checkout-api',
			env: 'prod-af-south-1',
			cause: 'other',
			phrase: 'is pinned',
			href: '/rollouts/prod/checkout-api-prod-af-south-1/checkout-api'
		}
	],
	// fix8: payments-core prod's release-approval (see DEPARTURES); the model's Needs-you list holds
	// it, Home's view does not (decision 4: other teams' approvals are not on Home)
	[
		7,
		{
			app: 'payments-core',
			env: 'prod-us-east',
			cause: 'approval',
			phrase: 'waits for approval',
			href: '/rollouts/prod/payments-core-prod-us-east/payments-core'
		}
	]
];

/**
 * - (2026-10-25, signal) standalone-api, mapped. Its Rollout (standalone-prod),
 *   its dependency gate and its RolloutDependency on ledger-core were already in
 *   the fixture, each as its controller writes it: ledger-core prod serves 5.1.0,
 *   s-11 needs >=5.4.0 and s-12 ^6.0.0, so the gate admits only s-10, which it
 *   runs (Satisfied=False, WaitingForProvider, since s-11 arrived at 11:41). The
 *   lab never showed the app because no Environment mapped it; the fixture now
 *   carries the environment-controller's Environment for its one place, prod. So
 *   the model has one more app (held in prod for 8h), one more Needs-you entry
 *   of the fleet's (not the viewer's: Home's Needs you is unchanged), and one more
 *   prod place, healthy (it runs s-10 without fault): Home's Watch line
 *   `held · on ledger-core · 8h`.
 */
const ADDED_APPS: Record<string, unknown>[] = [
	{
		app: 'standalone-api',
		tier: 'active',
		figure: '8h',
		phrase: 'held in prod',
		primaryAction: null,
		secondaryAction: null,
		envs: [
			{
				env: 'prod',
				label: 'prod',
				tier: 'prod',
				isProdRegion: true,
				state: 'held-by-rule',
				version: '1.10.0-10',
				arrivedAt: '<iso>',
				myChanges: [],
				pipeline: {
					tracks: [{ name: null, stages: [{ state: 'done' }] }],
					bake: 'done',
					activeStep: null,
					isFallback: true
				}
			}
		],
		merged: []
	}
];
const ADDED_FLEET_NEEDS_YOU: Record<string, unknown> = {
	app: 'standalone-api',
	env: 'prod',
	cause: 'dependency',
	phrase: 'waits on a dependency',
	href: '/rollouts/prod/standalone-prod/standalone-api'
};

function applyDepartures(want: unknown): unknown {
	const ny = (want as { fleet: { needsYou: Record<string, unknown>[] } }).fleet.needsYou;
	for (const [i, row] of ADDED_NEEDS_YOU) ny.splice(i, 0, row);
	{
		// signal: standalone-api, mapped (see ADDED_APPS)
		const w = want as {
			apps: { app: string }[];
			fleet: { mappedApps: number; prodHealthy: { healthy: number; total: number } };
		};
		const at = ny.findIndex((x) => x.app === 'telemetry-indexer');
		if (at < 0) throw new Error('fleet needsYou: telemetry-indexer not found');
		ny.splice(at, 0, ADDED_FLEET_NEEDS_YOU);
		for (const a of ADDED_APPS) w.apps.push(a as { app: string });
		w.apps.sort((x, y) => (x.app < y.app ? -1 : x.app > y.app ? 1 : 0));
		w.fleet.mappedApps += ADDED_APPS.length;
		w.fleet.prodHealthy.healthy += 1;
		w.fleet.prodHealthy.total += 1;
	}
	type C = Record<string, unknown> & { ref: string };
	type E = Record<string, unknown> & { env: string; myChanges: C[] };
	for (const [app, env, patch] of ENV_DEPARTURES) {
		const e = (want as { apps: { app: string; envs: E[] }[] }).apps
			.find((a) => a.app === app)
			?.envs.find((x) => x.env === env);
		if (!e) throw new Error(`departure for unknown env ${app} ${env}`);
		for (const [k, v] of Object.entries(patch)) {
			if (k === 'myChanges')
				(v as Record<string, unknown>[]).forEach((c, i) =>
					e.myChanges[i] ? Object.assign(e.myChanges[i], c) : e.myChanges.push(c as C)
				);
			else if (k === 'pipeline') Object.assign(e[k] as object, v);
			else e[k] = v;
		}
	}
	// fix7 B1 staging a11c707 + fix8 F1 staging a11c808 + hc-v2 telemetry-collector prod 7b3c9f1
	(want as { fleet: { sinceDelta: { deploys: number } } }).fleet.sinceDelta.deploys += 3;
	type A = { app: string; envs: { env: string; myChanges: C[] }[] };
	for (const [app, env, ref, field, value] of CHANGE_DEPARTURES) {
		const c = (want as { apps: A[] }).apps
			.find((a) => a.app === app)
			?.envs.find((e) => e.env === env)
			?.myChanges.find((x) => x.ref === ref);
		if (!c) throw new Error(`departure for unknown change ${app} ${env} ${ref}`);
		c[field] = value;
	}
	const w = want as { signals: { app: string; kind: string }[] };
	w.signals = w.signals.filter(
		(x) => !DROPPED_SIGNALS.some(([app, kind]) => x.app === app && x.kind === kind)
	);
	for (const [i, sig] of ADDED_SIGNALS) w.signals.splice(i, 0, sig as (typeof w.signals)[number]);
	const apps = (want as { apps: Record<string, unknown>[] }).apps;
	for (const [app, field, value] of DEPARTURES) {
		const a = apps.find((x) => x.app === app);
		if (!a) throw new Error(`departure for unknown app ${app}`);
		a[field] = value;
	}
	return want;
}

describe('home model parity with the lab export', () => {
	it('reproduces lib/lab/home-model.json on the incident fixture', () => {
		const model = buildHomeModel(homeInput());
		const got = normalize(JSON.parse(JSON.stringify(model)));
		const want = applyDepartures(normalize(expected));
		const d = diffs(got, want);
		expect(d).toEqual([]);
	});
});
