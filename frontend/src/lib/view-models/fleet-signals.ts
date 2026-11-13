/**
 * ⭐ FLEET SIGNALS (Home round 8, truth item 15, 2026-10-16) — WHAT MIGHT
 * BE WRONG, NOT ONLY WHAT IS ALREADY FAILING.
 *
 * Pure. Every fact is read through the helper that already decides it:
 * `card.checkFailure` (health-witness: a check failing now), `classifyCheck`
 * + `deployWindowStart` (the lastErrorTime witness: recovered), `deployActs`
 * (a rollback), `spec.bakeTime` (the bake the controller runs), `waitCause`
 * (a stall: a wait nothing in the model explains), `regionTally` (prod
 * drift), `waitingSince` / `eventAge` (how long a hold has lasted),
 * `nodeState` (failed). This file counts nothing those helpers count; it
 * only decides which facts are SIGNALS and attaches "the last thing that
 * changed before it".
 *
 * Severity: `failure` (a check failing now, a failed deploy or bake) is the
 * loud kind; everything else is `signal`, quieter but listed.
 */
import { availableReleases } from '$lib/releases/registry.svelte';
import type { RolloutCard } from '$lib/rollout-cards';
import type { HealthCheck } from '$lib/../types';
import { tierOf, nodeState, type Lane, type Tier } from '$lib/view-models/promotion-lanes';
import { classifyCheck, deployWindowStart } from '$lib/view-models/health-witness';
import { deployActs } from '$lib/history-marks';
import { waitCause, spanText } from '$lib/view-models/wait-cause';
import { regionTally } from '$lib/view-models/home-status';
import { waitingSince } from '$lib/view-models/fleet-facts';
import { eventAge } from '$lib/view-models/event-age';
import { kApp } from '$lib/view-models/kstairs';
import { shortenVersion, getDisplayVersion, failureKind, parseGoDuration } from '$lib/utils';
import { shortRevision } from '$lib/version-utils';
import * as msg from '$lib/paraglide/messages';
import { healthCheckKey } from '$lib/health-check-key';

export { healthCheckKey };

export type SignalKind =
	| 'check-failing'
	| 'failed'
	| 'check-flapping'
	| 'check-recovered'
	| 'prod-rollout'
	| 'slow-bake'
	| 'retry'
	| 'rollback'
	| 'stall'
	| 'long-wait'
	| 'prod-drift'
	| 'aging-hold'
	| 'correlated';

/**
 * ⭐ (Home round 11 shared fix) — WHICH SIGNAL KINDS EARN A ROW ON THE HOME
 * HEADER'S FLEET PULSE (`FleetPulseStrip`), as one pure, tested set rather
 * than a copy hand-kept inside `ControlCenter.svelte`.
 *
 * `'stall'` is deliberately NOT here. `signalCaption.ts` renders it as a
 * bare `idle ${span}` — "dev idle 17m" — and a reader scanning the fleet
 * pulse for "what needs me" reads that as noise: idle is the ABSENCE of a
 * signal, not one. `wait-cause.ts`'s own doc comment still calls a stall "a
 * real problem state… never hidden" — that is true of the "Needs a person"
 * tally (`ControlCenter.svelte`'s `nCause`-driven count, a SEPARATE
 * consumer of `waitCause` that does not go through this set), so a genuine
 * stall still surfaces there. This set narrows only what counts as
 * worth-a-glance on the header's own one-line-per-app strip.
 */
export const HOME_PULSE_WORTH_LOOK: ReadonlySet<SignalKind> = new Set([
	'check-failing',
	'check-flapping',
	'check-recovered',
	'slow-bake',
	'long-wait'
]);

export type PrRefLite = { number: string | null; title: string; href: string; author?: string };

export type LastChange = { id: string; title: string | null; href: string | null; app: string; env: string; at: string; sameApp: boolean };

export type FleetSignal = {
	key: string;
	kind: SignalKind;
	severity: 'failure' | 'signal';
	app: string;
	apps?: string[];
	env: string;
	tier: Tier;
	since: string;
	evidence: string;
	/** The facts `evidence` is worded from, for a caller that words them
	 *  itself (Home) instead of matching the sentence. Set on the kinds Home
	 *  shows (`HOME_PULSE_WORTH_LOOK` + `failed`). */
	facts?: SignalFacts;
	href: string;
	lastChange: LastChange | null;
};

/** What a Home-shown signal is made of, as data. */
export type SignalFacts =
	/** `check`: the check's own name (`<app>-error-rate`), null when the witness names none */
	| { kind: 'check-failing'; check: string | null }
	| { kind: 'failed'; failure: 'healthcheck' | 'deploy' }
	/** `failures`: separate failure episodes of this check inside `spanMs` (now minus the first) */
	| { kind: 'check-flapping'; check: string; failures: number; spanMs: number }
	| { kind: 'check-recovered'; failedAgoMs: number }
	/** `bakeTimeMs`: the rollout's own spec.bakeTime */
	| { kind: 'slow-bake'; spanMs: number; bakeTimeMs: number }
	| { kind: 'long-wait'; waitedMs: number; usualMs: number };

/**
 * A bake's length for the slow-bake evidence: whole minutes up to three
 * hours (`75m`, `60m`), so the overrun shows against the set time; the
 * compact span beyond that. `spanText` alone rounds 75m and 60m both to `1h`.
 */
export function bakeSpanText(ms: number): string {
	const v = Math.max(0, ms);
	return v < 3 * 3600e3 ? `${Math.round(v / 60e3)}m` : spanText(v);
}

/** `evidence` worded from `SignalFacts` (paraglide). */
export function signalEvidence(f: SignalFacts): string {
	switch (f.kind) {
		case 'check-failing':
			return (f.check == null ? msg.home_m_health_check_failing() : msg.home_m_sig_check_failing({ name: f.check })).slice(0, 48);
		case 'failed':
			return f.failure === 'healthcheck' ? msg.home_m_evidence_failed_check() : msg.home_m_failed_to_deploy();
		case 'check-flapping':
			return msg.home_m_sig_flapping({ name: f.check, n: f.failures, span: spanText(Math.max(0, f.spanMs)) });
		case 'check-recovered':
			return msg.home_m_sig_recovered({ age: spanText(Math.max(0, f.failedAgoMs)) });
		case 'slow-bake':
			return msg.home_m_sig_slow_bake({ span: bakeSpanText(f.spanMs), set: bakeSpanText(f.bakeTimeMs) });
		case 'long-wait':
			return msg.home_m_sig_long_wait({ span: spanText(Math.max(0, f.waitedMs)), usual: spanText(Math.max(0, f.usualMs)) });
	}
}

export type FleetSignalsInput = {
	cards: readonly RolloutCard[];
	lanes: readonly Lane[];
	/** keyed by `healthCheckKey(cluster, namespace, rollout)` */
	healthChecks?: Map<string, HealthCheck[]> | null;
	prFor: (sha7: string) => PrRefLite | null;
	isApproval: (c: RolloutCard) => boolean;
	now: Date;
	href: (c: RolloutCard) => string;
	appHref: (app: string) => string;
};

/** Thresholds, in one place so a test can name them. */
export const SIGNAL_WINDOWS = {
	prodRolloutMs: 6 * 3600e3,
	retryMs: 24 * 3600e3,
	rollbackMs: 24 * 3600e3,
	/** how far back an earlier failure of the same check counts toward flapping */
	flapWindowMs: 24 * 3600e3,
	agingHoldMs: 2 * 3600e3,
	correlatedMs: 10 * 60e3,
	correlatedWindowMs: 2 * 3600e3,
	slowBakeFactor: 1.5,
	/**
	 * How far past `spec.bakeTime` a bake may run before it reads as slow. The
	 * controller requeues for the bake's end instant and marks it Succeeded on
	 * that reconcile, so a healthy controller overruns by seconds. Five minutes
	 * absorbs a controller restart or leader hand-over (lease 15s, re-list and
	 * requeue under a minute on the demo clusters) and clock skew between the
	 * controller and the browser, so what remains is a controller that did not
	 * get back to the rollout, which is worth a look.
	 */
	slowBakeMarginMs: 5 * 60e3,
	/**
	 * The shortest wait that can read as long, whatever this place usually
	 * waits. A promotion takes up to two environment-controller passes (its
	 * requeueInterval defaults to 1m: one pass reads the upstream bake, the
	 * next writes the gate's allowedVersions) before the rollout-controller
	 * reconciles the gate update and starts the deploy. That is about 2m of
	 * ordinary polling jitter that a history of quick deploys (a usual of 0s)
	 * cannot show, so 3m keeps a minute of room above it. Waits past
	 * `NORMAL_CYCLE_MS` are stalls, not long waits.
	 */
	longWaitFloorMs: 3 * 60e3
} as const;

/** A wait still inside the normal cycle that has run past this place's usual (`usualMs`) and the floor. */
export function isLongWait(waitedMs: number, usualMs: number): boolean {
	return waitedMs >= Math.max(SIGNAL_WINDOWS.longWaitFloorMs, usualMs * SIGNAL_WINDOWS.slowBakeFactor);
}

const ago = (ms: number) => spanText(Math.max(0, ms));
const iso = (t: number) => new Date(t).toISOString();
const isProd = (c: RolloutCard) => !!c.envName && tierOf(c.envName) === 'prod';
const keyOf = (c: RolloutCard) => `${c.ns}/${c.name}`;


/** Every deploy the fleet knows, newest first: the source for "what changed before". */
function allDeploys(cards: readonly RolloutCard[]) {
	const out: { at: number; card: RolloutCard; version: string; rev: string }[] = [];
	for (const c of cards) {
		for (const h of c.rollout.status?.history ?? []) {
			const at = h.timestamp ? Date.parse(h.timestamp) : NaN;
			if (!Number.isFinite(at)) continue;
			const v = h.version ? getDisplayVersion(h.version) || '' : '';
			const rev = h.version?.revision ? shortRevision(shortenVersion(h.version.revision)) : shortRevision(shortenVersion(v));
			out.push({ at, card: c, version: shortenVersion(v), rev });
		}
	}
	return out.sort((a, b) => b.at - a.at);
}

/** How long a release usually waits before this place deploys it: release created → deploy, median of ≥ 2. */
function usualLagMs(c: RolloutCard): number | null {
	const rel = availableReleases(c.rollout) ?? [];
	const lags: number[] = [];
	for (const h of c.rollout.status?.history ?? []) {
		const v = h.version ? getDisplayVersion(h.version) : null;
		const r = rel.find((x) => !!x && (x.tag === v || x.version === v || x.tag === h.version?.tag));
		if (!r?.created || !h.timestamp) continue;
		const d = Date.parse(h.timestamp) - Date.parse(r.created);
		if (Number.isFinite(d) && d >= 0) lags.push(d);
	}
	if (lags.length < 2) return null;
	lags.sort((a, b) => a - b);
	return lags[Math.floor(lags.length / 2)];
}

export function fleetSignals(input: FleetSignalsInput): FleetSignal[] {
	const { cards, lanes, healthChecks, prFor, isApproval, now, href, appHref } = input;
	const T = now.getTime();
	const deploys = allDeploys(cards);
	const out: FleetSignal[] = [];

	/** The last change before `t`: the same place first, else the nearest prod deploy fleet-wide. */
	function lastChangeBefore(t: number, c: RolloutCard | null, app: string): LastChange | null {
		const pick = (d: (typeof deploys)[number], sameApp: boolean): LastChange => {
			const pr = d.rev ? prFor(d.rev) : null;
			return { id: pr?.number ?? d.version, title: pr?.title ?? null, href: pr?.href ?? null, app: d.card.name, env: d.card.envDisplay || d.card.envName, at: iso(d.at), sameApp };
		};
		const same = (c ? deploys.find((d) => d.at < t && keyOf(d.card) === keyOf(c)) : null) ?? deploys.find((d) => d.at < t && d.card.name === app);
		if (same) return pick(same, true);
		const other = deploys.find((d) => d.at < t && isProd(d.card));
		return other ? pick(other, false) : null;
	}
	function push(s: Omit<FleetSignal, 'key' | 'lastChange' | 'evidence'> & { evidence?: string }, c: RolloutCard | null) {
		const evidence = s.evidence ?? (s.facts ? signalEvidence(s.facts) : '');
		out.push({ ...s, evidence, key: `${s.kind}|${s.app}|${s.env}|${s.since}`, lastChange: lastChangeBefore(Date.parse(s.since), c, s.app) });
	}
	const placeOf = (c: RolloutCard) => c.envDisplay || c.envName;
	const prodRollouts = new Map<string, { card: RolloutCard; v: string; since: string; places: string[] }>();

	for (const c of cards) {
		if (!c.envName) continue;
		const tier = tierOf(c.envName);
		const head = c.rollout.status?.history?.[0];
		const st = nodeState(c);

		// ── Failures (loud). ───────────────────────────────────────────────
		if (c.checkFailure) {
			const at = eventAge(c, 'failed') ?? head?.bakeEndTime ?? head?.timestamp ?? iso(T);
			push({ kind: 'check-failing', severity: 'failure', app: c.name, env: placeOf(c), tier, since: at, facts: { kind: 'check-failing', check: c.checkFailure.check ?? null }, href: href(c) }, c);
		} else if (st === 'failed') {
			const at = eventAge(c, 'failed') ?? head?.timestamp ?? iso(T);
			push({ kind: 'failed', severity: 'failure', app: c.name, env: placeOf(c), tier, since: at, facts: { kind: 'failed', failure: failureKind(c.failureCategory === 'healthcheck' ? 'health check' : (c.bakeStatusMessage ?? null)) }, href: href(c) }, c);
		}

		// ── The lastErrorTime witness: recovered, and flapping. ───────────
		const hcs = healthChecks?.get(healthCheckKey(c.sourceCluster, c.ns, c.name)) ?? [];
		const window = deployWindowStart(c.rollout);
		const history = c.rollout.status?.history ?? [];
		for (const hc of hcs) {
			if (classifyCheck(hc, window) !== 'recovered') continue;
			const errAt = Date.parse(hc.status!.lastErrorTime!);
			const hcName = hc.metadata?.name;
			const name = hc.metadata?.annotations?.['kuberik.com/display-name'] ?? hcName ?? 'check';
			// ⭐ HC-2 (2026-10-25). Flapping: this check failed in an EARLIER deploy
			// inside the window (an older entry's failedHealthChecks names it, which
			// the rollout-controller writes when the bake fails and keeps on that
			// entry), passed again (the head's bake started, and the controller
			// starts a bake only when every check is Healthy with a lastChangeTime
			// after the deploy), failed again after that (lastErrorTime past the
			// head's bakeStartTime), and is Healthy now: two full off/on cycles.
			// The old reading (the HEAD's failedHealthChecks plus a retry before
			// lastErrorTime) claimed the same check failed before the retry, which
			// the controller cannot write: a retry clears failedHealthChecks.
			const bakeStart = head?.bakeStartTime ? Date.parse(head.bakeStartTime) : NaN;
			const earlier = history.slice(1).filter((h) => {
				const at = Date.parse(h.bakeEndTime ?? h.timestamp ?? '');
				return (
					Number.isFinite(at) &&
					T - at < SIGNAL_WINDOWS.flapWindowMs &&
					(h.failedHealthChecks ?? []).some((f) => f.name === hcName)
				);
			});
			const flapping = earlier.length > 0 && Number.isFinite(bakeStart) && errAt > bakeStart;
			const firstAt = flapping
				? Math.min(...earlier.map((h) => Date.parse(h.bakeEndTime ?? h.timestamp ?? '')))
				: errAt;
			push(
				{
					kind: flapping ? 'check-flapping' : 'check-recovered',
					severity: 'signal',
					app: c.name,
					env: placeOf(c),
					tier,
					since: hc.status!.lastErrorTime!,
					facts: flapping
						? { kind: 'check-flapping', check: name, failures: earlier.length + 1, spanMs: T - firstAt }
						: { kind: 'check-recovered', failedAgoMs: T - errAt },
					href: href(c)
				},
				c
			);
		}

		// ── Slow bakes: running or ran past the bake its rollout is set to. ─
		// The rollout-controller ends a bake exactly at bakeStartTime + spec.bakeTime
		// (handleBakeTime requeues for that instant) and, with no bakeTime, at once.
		// So a bake is slow only when it outlives spec.bakeTime by more than
		// SLOW_BAKE_MARGIN_MS; within the bake time it is on schedule, however it
		// compares with earlier bakes.
		const bakeTimeMs = c.rollout.spec?.bakeTime ? parseGoDuration(c.rollout.spec.bakeTime) : 0;
		if (head?.bakeStartTime && bakeTimeMs > 0) {
			const start = Date.parse(head.bakeStartTime);
			const end = head.bakeEndTime ? Date.parse(head.bakeEndTime) : T;
			const span = end - start;
			const recent = T - end < SIGNAL_WINDOWS.retryMs;
			if (recent && span > bakeTimeMs + SIGNAL_WINDOWS.slowBakeMarginMs)
				push({ kind: 'slow-bake', severity: 'signal', app: c.name, env: placeOf(c), tier, since: head.bakeStartTime, facts: { kind: 'slow-bake', spanMs: span, bakeTimeMs }, href: href(c) }, c);
		}

		// ── Retries in the last 24h. ─────────────────────────────────────
		if (head?.lastRetryTimestamp && T - Date.parse(head.lastRetryTimestamp) < SIGNAL_WINDOWS.retryMs)
			push({ kind: 'retry', severity: 'signal', app: c.name, env: placeOf(c), tier, since: head.lastRetryTimestamp, evidence: msg.home_m_sig_retried({ age: ago(T - Date.parse(head.lastRetryTimestamp)) }), href: href(c) }, c);

		// ── Rollbacks in the last 24h (deployActs decides what a rollback is). ─
		const acts = deployActs(c.rollout);
		(c.rollout.status?.history ?? []).forEach((h, i) => {
			if (acts[i]?.kind !== 'rollback' || !h.timestamp) return;
			if (T - Date.parse(h.timestamp) >= SIGNAL_WINDOWS.rollbackMs) return;
			const a = acts[i] as Extract<NonNullable<(typeof acts)[number]>, { kind: 'rollback' }>;
			push({ kind: 'rollback', severity: 'signal', app: c.name, env: placeOf(c), tier, since: h.timestamp, evidence: msg.home_m_evidence_rolled_back_to({ version: shortenVersion(a.to) }), href: href(c) }, c);
		});

		// ── Recent prod rollouts: one per (app, build), its regions counted. ──
		if (tier === 'prod' && head?.timestamp && T - Date.parse(head.timestamp) < SIGNAL_WINDOWS.prodRolloutMs && st !== 'failed') {
			const v = head.version ? shortenVersion(getDisplayVersion(head.version) || '') : '';
			const k = `${c.name}|${v}`;
			const g = prodRollouts.get(k);
			if (g) {
				g.places.push(placeOf(c));
				if (Date.parse(head.timestamp) < Date.parse(g.since)) g.since = head.timestamp;
			} else prodRollouts.set(k, { card: c, v, since: head.timestamp, places: [placeOf(c)] });
		}

		// ── Aging holds and pins. ─────────────────────────────────────────
		if (st === 'held') {
			// The hold's own instant: an approval from its held event, a rule from
			// when the refused build started waiting.
			const since = isApproval(c)
				? eventAge(c, 'held')
				: (() => {
						const w = waitingSince(c);
						return w ? iso(w) : eventAge(c, 'held');
					})();
			if (since && T - Date.parse(since) >= SIGNAL_WINDOWS.agingHoldMs)
				push({ kind: 'aging-hold', severity: 'signal', app: c.name, env: placeOf(c), tier, since, evidence: (isApproval(c) ? msg.home_m_sig_approval_waiting : msg.home_m_held_for)({ age: ago(T - Date.parse(since)) }), href: href(c) }, c);
		} else if (c.pinnedVersion && head?.timestamp && T - Date.parse(head.timestamp) >= SIGNAL_WINDOWS.agingHoldMs) {
			push({ kind: 'aging-hold', severity: 'signal', app: c.name, env: placeOf(c), tier, since: head.timestamp, evidence: msg.home_m_sig_pinned({ age: ago(T - Date.parse(head.timestamp)) }), href: href(c) }, c);
		}
	}

	for (const g of prodRollouts.values()) {
		const env = g.places.length > 1 ? 'prod' : g.places[0];
		push({ kind: 'prod-rollout', severity: 'signal', app: g.card.name, env, tier: 'prod', since: g.since, evidence: g.places.length > 1 ? msg.home_m_sig_to_regions({ version: g.v, n: g.places.length }) : msg.home_m_sig_to_env({ version: g.v, env }), href: g.places.length > 1 ? appHref(g.card.name) : href(g.card) }, g.places.length > 1 ? null : g.card);
	}

	// ── Per app: stalls (waitCause) and prod drift (regionTally). ────────
	for (const lane of lanes) {
		const m = kApp(lane, isApproval);
		const cause = waitCause(m, { now, idOf: (v) => (v ? shortenVersion(v) : ''), isApproval });
		// A wait still inside the normal cycle, but longer than this place usually waits.
		if (cause?.kind === 'cycle' && cause.waitedMs != null) {
			const place = cause.place;
			const node = [...lane.stages, ...lane.prod].find((n) => (place === 'prod' ? n.tier === 'prod' : n.env === place)) ?? null;
			const usual = node ? usualLagMs(node.card) : null;
			if (usual != null && isLongWait(cause.waitedMs, usual))
				push({ kind: 'long-wait', severity: 'signal', app: lane.app, env: place, tier: place === 'prod' ? 'prod' : tierOf(place), since: iso(T - cause.waitedMs), facts: { kind: 'long-wait', waitedMs: cause.waitedMs, usualMs: usual }, href: node ? href(node.card) : appHref(lane.app) }, node?.card ?? null);
		}
		if (cause?.kind === 'stalled') {
			const place = cause.place;
			const node = [...lane.stages, ...lane.prod].find((n) => (place === 'prod' ? n.tier === 'prod' : n.env === place)) ?? null;
			push({ kind: 'stall', severity: 'signal', app: lane.app, env: place, tier: place === 'prod' ? 'prod' : tierOf(place), since: iso(T - cause.forMs), evidence: msg.home_m_sig_idle({ env: place, age: ago(cause.forMs) }), href: node ? href(node.card) : appHref(lane.app) }, node?.card ?? null);
		}
		if (lane.prod.length > 1) {
			const t = regionTally(lane.prod, (v) => (v ? shortenVersion(v) : ''));
			const builds = t.buckets.filter((b) => b.id).map((b) => b.id);
			// regionTally's 'not deployed' bucket, by state: running nothing
			const notDeployed = lane.prod.filter((n) => n.state === 'none' || !n.card.version).length;
			if (new Set(builds).size > 1 || notDeployed) {
				const latest = Math.max(...lane.prod.map((n) => (n.card.timestamp ? Date.parse(n.card.timestamp) : 0)));
				push(
					{
						kind: 'prod-drift',
						severity: 'signal',
						app: lane.app,
						env: 'prod',
						tier: 'prod',
						since: iso(latest || T),
						evidence: notDeployed
							? msg.home_m_sig_regions_not_deployed({ n: notDeployed, total: t.total })
							: msg.home_m_sig_regions_on_builds({ total: t.total, builds: new Set(builds).size }),
						href: appHref(lane.app)
					},
					null
				);
			}
		}
	}

	// ── Correlated: >= 2 apps deployed to prod within 10 minutes. ───────
	const firstPerBuild = new Map<string, (typeof deploys)[number]>();
	for (const d of deploys) {
		if (!isProd(d.card) || T - d.at >= SIGNAL_WINDOWS.correlatedWindowMs) continue;
		const k = `${d.card.name}|${d.version}`;
		const cur = firstPerBuild.get(k);
		if (!cur || d.at < cur.at) firstPerBuild.set(k, d);
	}
	const prodRecent = [...firstPerBuild.values()].sort((a, b) => a.at - b.at);
	const used = new Set<number>();
	for (let i = 0; i < prodRecent.length; i++) {
		if (used.has(i)) continue;
		const group = [i];
		// A burst: each next deploy within 10 minutes of the one before it.
		for (let j = i + 1; j < prodRecent.length && prodRecent[j].at - prodRecent[group[group.length - 1]].at <= SIGNAL_WINDOWS.correlatedMs; j++) group.push(j);
		const apps = [...new Set(group.map((g) => prodRecent[g].card.name))];
		if (apps.length < 2) continue;
		group.forEach((g) => used.add(g));
		const first = prodRecent[i];
		const span = prodRecent[group[group.length - 1]].at - first.at;
		push({ kind: 'correlated', severity: 'signal', app: apps[0], apps, env: 'prod', tier: 'prod', since: iso(first.at), evidence: msg.home_m_sig_correlated({ n: apps.length, span: ago(Math.max(60e3, span)) }), href: appHref(apps[0]) }, null);
	}

	// Failures first, then signals, newest first.
	return out.sort((a, b) => (a.severity === b.severity ? Date.parse(b.since) - Date.parse(a.since) : a.severity === 'failure' ? -1 : 1));
}
