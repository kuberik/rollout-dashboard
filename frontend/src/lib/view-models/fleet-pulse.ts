/**
 * THE FLEET'S PULSE — the figures and the time axis Home v2 leads with.
 * (CRAFT-STUDY P2 "numbers lead", P3 "draw time and change": a figure with
 * its delta against the previous period, and a deploy series with releases
 * marked on it, the PlanetScale #1369 device — "what changed here".)
 *
 * MEASURED, NEVER MODELLED. Every input is a `status.history` entry
 * (`timestamp` = when the deploy started, `bakeStatus` = how it ended) or a
 * release's `created` time. A figure whose sample is empty is `null` and the
 * page prints an em dash; a previous period the history does not reach is
 * `null` too, so no delta is ever drawn against nothing (history is a bounded
 * window, `versionHistoryLimit`).
 *
 * Lead time keeps `HomeRail`'s / `/apps`' construction exactly — each app's
 * median trip from its first environment to its FIRST production region,
 * then the middle app — restricted to trips that ARRIVED inside the window,
 * so the number answers "how long did builds take to reach prod lately".
 *
 * ⭐ `deploys`/`failed`/`failedResolved`/`held` DELEGATE TO `fleet-facts.ts`
 * NOW (shared/fleet-facts, 2026-10-10), when a caller passes `opts.cards` —
 * the one derivation every fleet-wide count reads, so Home's deploy/failed/
 * held figures cannot drift from the map's or /activity's. `bins`/`markers`/
 * `leadMs` stay this file's own job (a time series, not a fleet-wide total)
 * and keep reading every rollout directly, `envFor`/`isHeld` included, so a
 * caller with no cards handy (older tests) still gets the exact figures it
 * always did.
 */
import type { Rollout } from '../../types';
import type { RolloutCard } from '$lib/rollout-cards';
import { getEnvironmentRank } from '$lib/env-order';
import { getDisplayVersion, shortenVersion } from '$lib/utils';
import { median } from './lead-time';
import { fleetFacts, RANGE_SPEC, type FleetFactsOpts, type PulseRange } from './fleet-facts';

export type { PulseRange } from './fleet-facts';
export { PULSE_RANGES, RANGE_SPEC, deltaPct } from './fleet-facts';

export type PulseBin = {
	start: number;
	end: number;
	succeeded: number;
	failed: number;
	inFlight: number;
	/** The same bin one period earlier, for the grey comparison. null when history does not reach it. */
	prev: number | null;
};

export type PulseMarker = {
	key: string;
	ms: number;
	app: string;
	version: string;
	kind: 'release' | 'failed';
	/** A failure that is no longer the rollout's current state (history, not alarm). */
	resolved?: boolean;
	/** Where it happened (the environment). */
	env?: string;
	/** The rollout the marker opens. */
	rollout: Rollout;
};

export type PulseFigure = { value: number | null; prev: number | null };

export type FleetPulse = {
	range: PulseRange;
	start: number;
	end: number;
	bins: PulseBin[];
	markers: PulseMarker[];
	/** Every first production arrival in the window (ms), unthinned. */
	releases: number[];
	deploys: PulseFigure;
	failed: PulseFigure;
	/** Every failure in the window is resolved (none is a rollout's current state). */
	failedResolved: boolean;
	/** Median trip to production, ms. */
	leadMs: PulseFigure;
	leadApps: number;
	/** Held right now: count, median and longest wait since the waiting build was released. */
	held: { count: number; medianMs: number | null; longestMs: number | null };
	/** True when the history reaches back through the whole previous period. */
	hasPrev: boolean;
};

type Entry = { ms: number; status: string; version: string; rollout: Rollout; env: string; app: string };

function appOf(r: Rollout): string {
	return r.metadata?.name ?? '';
}
function envOf(r: Rollout): string {
	return (
		(r.metadata?.annotations?.['rollout.kuberik.com/environment'] as string | undefined) ??
		(r.metadata?.labels?.['rollout.kuberik.com/environment'] as string | undefined) ??
		''
	);
}

function entries(rollouts: Rollout[], envFor: (r: Rollout) => string): Entry[] {
	const out: Entry[] = [];
	for (const r of rollouts) {
		const env = envFor(r);
		for (const h of r.status?.history ?? []) {
			if (!h.timestamp) continue;
			const ms = new Date(h.timestamp).getTime();
			if (!Number.isFinite(ms)) continue;
			out.push({ ms, status: h.bakeStatus ?? '', version: getDisplayVersion(h.version) ?? '', rollout: r, env, app: appOf(r) });
		}
	}
	return out;
}

const isPrd = (env: string) => getEnvironmentRank(env) >= 7;
/** A failed entry that is still the rollout's newest deploy is a current failure. */
function isCurrentFailure(e: Entry): boolean {
	const h0 = e.rollout.status?.history?.[0];
	return !!h0 && h0.bakeStatus === 'Failed' && !!h0.timestamp && new Date(h0.timestamp).getTime() === e.ms;
}
const settled = (s: string) => s !== 'InProgress' && s !== 'Deploying';

function leadFor(all: Entry[], from: number, to: number): { ms: number | null; apps: number } {
	const byApp = new Map<string, Entry[]>();
	for (const e of all) {
		if (!e.env || !settled(e.status)) continue;
		(byApp.get(e.app) ?? byApp.set(e.app, []).get(e.app)!).push(e);
	}
	const perApp: number[] = [];
	for (const list of byApp.values()) {
		const minRank = Math.min(...list.map((e) => getEnvironmentRank(e.env)));
		if (minRank >= 7) continue; // prod-only app: no hop to measure
		const source = new Map<string, number>();
		const arrival = new Map<string, number>();
		for (const e of list) {
			if (!e.version) continue;
			if (getEnvironmentRank(e.env) === minRank) source.set(e.version, Math.min(source.get(e.version) ?? Infinity, e.ms));
			if (isPrd(e.env)) arrival.set(e.version, Math.min(arrival.get(e.version) ?? Infinity, e.ms));
		}
		const trips: number[] = [];
		for (const [v, a] of arrival) {
			const s = source.get(v);
			if (s == null || a < s || a < from || a >= to) continue;
			trips.push(a - s);
		}
		const m = median(trips);
		if (m != null) perApp.push(m);
	}
	return { ms: median(perApp), apps: perApp.length };
}

export function fleetPulse(
	rollouts: Rollout[],
	nowMs: number,
	range: PulseRange,
	opts: {
		envFor?: (r: Rollout) => string;
		isHeld?: (r: Rollout) => boolean;
		maxMarkers?: number;
		/** ⭐ When passed, `deploys`/`failed`/`failedResolved`/`held` are read
		 *  straight off `fleet-facts.ts` (`fleetFacts(cards, rollouts, ...)`)
		 *  instead of this function's own tally — the one computation every
		 *  other fleet-wide surface already reads. `envFor`/`isHeld` above
		 *  still drive `bins`/`markers`/`leadMs`, which are a time series this
		 *  file still owns. Omit it and every figure falls back to the
		 *  pre-2026-10-10 self-contained tally below, so a caller with no
		 *  cards handy (an older test) keeps its exact old numbers. */
		cards?: RolloutCard[];
		factsOpts?: FleetFactsOpts;
	} = {}
): FleetPulse {
	const spec = RANGE_SPEC[range];
	const end = nowMs;
	const start = end - spec.span;
	const prevStart = start - spec.span;
	const envFor = opts.envFor ?? envOf;
	const all = entries(rollouts, envFor);
	const oldest = all.reduce((m, e) => Math.min(m, e.ms), Infinity);
	const hasPrev = oldest <= prevStart + spec.span / spec.bins;

	const binW = spec.span / spec.bins;
	const bins: PulseBin[] = Array.from({ length: spec.bins }, (_, i) => ({
		start: start + i * binW,
		end: start + (i + 1) * binW,
		succeeded: 0,
		failed: 0,
		inFlight: 0,
		prev: hasPrev ? 0 : null
	}));
	let deploys = 0;
	let failed = 0;
	let prevDeploys = 0;
	let prevFailed = 0;
	for (const e of all) {
		if (e.ms >= start && e.ms <= end) {
			const i = Math.min(spec.bins - 1, Math.floor((e.ms - start) / binW));
			deploys++;
			if (e.status === 'Failed') {
				bins[i].failed++;
				failed++;
			} else if (!settled(e.status)) bins[i].inFlight++;
			else bins[i].succeeded++;
		} else if (hasPrev && e.ms >= prevStart && e.ms < start) {
			const i = Math.min(spec.bins - 1, Math.floor((e.ms - prevStart) / binW));
			bins[i].prev = (bins[i].prev ?? 0) + 1;
			prevDeploys++;
			if (e.status === 'Failed') prevFailed++;
		}
	}

	// Markers: a build's FIRST arrival in production (the moment users got it),
	// and every failed deploy. Newest first, thinned so two never sit closer
	// than 9% of the axis, capped.
	const firstProd = new Map<string, Entry>();
	for (const e of all) {
		if (!isPrd(e.env) || e.ms < start || e.ms > end || !e.version) continue;
		const k = `${e.app}|${e.version}`;
		const cur = firstProd.get(k);
		if (!cur || e.ms < cur.ms) firstProd.set(k, e);
	}
	const raw: PulseMarker[] = [
		...[...firstProd.values()].map((e) => ({
			key: `r|${e.app}|${e.version}`,
			ms: e.ms,
			app: e.app,
			version: shortenVersion(e.version),
			kind: 'release' as const,
			rollout: e.rollout
		})),
		...all
			.filter((e) => e.status === 'Failed' && e.ms >= start && e.ms <= end)
			.map((e) => ({
				key: `f|${e.app}|${e.env}|${e.version}|${e.ms}`,
				ms: e.ms,
				app: e.app,
				version: shortenVersion(e.version),
				kind: 'failed' as const,
				rollout: e.rollout,
				env: e.env,
				resolved: !isCurrentFailure(e)
			}))
	].sort((a, b) => (a.kind === b.kind ? b.ms - a.ms : a.kind === 'failed' ? -1 : 1));
	const markers: PulseMarker[] = [];
	const gap = spec.span * 0.09;
	// Every failed deploy is drawn (the Failed figure counts them, so the marks
	// and the number come from one list, home-map r5); only RELEASES are
	// thinned around them and capped.
	for (const m of raw) {
		if (m.kind === 'failed') {
			markers.push(m);
			continue;
		}
		if (markers.length >= (opts.maxMarkers ?? 6)) break;
		if (markers.some((x) => Math.abs(x.ms - m.ms) < gap)) continue;
		markers.push(m);
	}
	markers.sort((a, b) => a.ms - b.ms);

	const lead = leadFor(all, start, end + 1);
	const prevLead = hasPrev ? leadFor(all, prevStart, start) : { ms: null, apps: 0 };

	// Held now: how long the build each held rollout is waiting for has existed.
	const waits: number[] = [];
	if (opts.isHeld) {
		for (const r of rollouts) {
			if (!opts.isHeld(r)) continue;
			const v0 = r.status?.history?.[0]?.version;
			const cur = v0 ? getDisplayVersion(v0) || null : null;
			const rel = r.status?.availableReleases ?? [];
			const curIdx = rel.findIndex((x) => !!x && (x.version === cur || x.tag === cur));
			const newer = (r.status?.releaseCandidates?.length ? r.status.releaseCandidates : rel.slice(curIdx + 1)).filter(
				(x) => x.created
			);
			const oldestNewer = newer.reduce((m, x) => Math.min(m, new Date(x.created!).getTime()), Infinity);
			if (Number.isFinite(oldestNewer)) waits.push(Math.max(0, nowMs - oldestNewer));
		}
	}

	// ⭐ DELEGATION. When `opts.cards` is given, the four fleet-wide totals
	// below are overwritten with `fleet-facts.ts`'s own numbers — computed a
	// second time here is unavoidable (this function's own `all`/bins pass
	// needs the entries regardless, for the time series), but the VALUE a
	// caller reads is the shared one, not this function's private tally.
	const facts = opts.cards ? fleetFacts(opts.cards, rollouts, nowMs, range, opts.factsOpts) : null;

	return {
		range,
		start,
		end,
		bins,
		markers,
		releases: [...firstProd.values()].map((e) => e.ms),
		deploys: facts ? { value: facts.deploys.value, prev: facts.deploys.prev } : { value: deploys, prev: hasPrev ? prevDeploys : null },
		failed: facts ? { value: facts.failed.inWindow.value, prev: facts.failed.inWindow.prev } : { value: failed, prev: hasPrev ? prevFailed : null },
		failedResolved: facts
			? facts.failed.inWindow.value > 0 && facts.failed.resolvedInWindow === facts.failed.inWindow.value
			: failed > 0 && all.filter((e) => e.status === 'Failed' && e.ms >= start && e.ms <= end).every((e) => !isCurrentFailure(e)),
		leadMs: { value: lead.ms, prev: prevLead.ms },
		leadApps: lead.apps,
		held: facts
			? { count: facts.held.apps, medianMs: facts.held.medianMs, longestMs: facts.held.longestMs }
			: {
					// Apps, like every other count on Home (AD r6 Q4): an app held in three
					// regions is one held app.
					count: opts.isHeld ? new Set(rollouts.filter(opts.isHeld).map((r) => r.metadata?.name ?? '')).size : 0,
					medianMs: median(waits),
					longestMs: waits.length ? Math.max(...waits) : null
				},
		hasPrev
	};
}
