/**
 * LEAD TIME — how long a build takes to get from the first environment to
 * production. `/apps` criterion 3: *"which ship slowly?"*
 *
 * MEASURED, NEVER MODELLED. The only inputs are timestamps that are already in
 * `status.history`: for each build, when the first environment ran it and when
 * production first ran it. The difference is one observation; the answer is the
 * MEDIAN over every build for which both observations exist. No average (one
 * build parked over a weekend would own the number), no extrapolation, and no
 * estimate when the sample is empty.
 *
 * PRODUCTION IS A SET, SO ARRIVAL IS THE FIRST ARRIVAL. With six prod regions,
 * "reached production" is when the build lands in the FIRST of them — that is
 * the moment the change is serving users. Using the last region would make lead
 * time a measure of fan-out speed, which is a different question and one the
 * detail page's spine answers by showing the pins scattered.
 *
 * WHY IT MAY RETURN NULL, and why that is the point. Deploy history is a
 * bounded window (`versionHistoryLimit`), so a build that reached prod before
 * the window opened is simply not observable. An app with one environment has
 * no hop at all. In both cases this returns null and the column prints an
 * em-dash: `DESIGN.md` — never render an unresolvable comparison as a definite
 * claim, and never name a fact you cannot evidence.
 */

export type LeadDeploy = {
	/** Display sha. */
	version: string;
	/** Deploy time, ms epoch. */
	ms: number;
};

export type LeadEnv = {
	/** What the caption names. `dev`, `prod`. */
	label: string;
	/** Promotion order rank — lower is earlier. `getEnvironmentRank`. */
	order: number;
	/** Production regions are a SET; every other tier is a step on the LINE. */
	prod: boolean;
	/** `status.history`, in any order. */
	deploys: readonly LeadDeploy[];
};

export type LeadTimeVM = {
	medianMs: number;
	/** Builds for which BOTH ends were observed. */
	samples: number;
	fromLabel: string;
	toLabel: string;
};

/**
 * THE SORTED-MIDDLE MEDIAN, AND THE ONE PLACE IT IS WRITTEN. (2026-09-02)
 *
 * `/` and `/apps` each carried a byte-identical `[...xs].sort(...); const mid
 * = ...` block to fold their per-app `leadTime` medians into one fleet
 * figure — a "median of medians" with no shared name, so the two pages could
 * drift the instant one of them adjusted a tie-break. This file already
 * carries the ONE median inside `leadTime` itself; a second unnamed copy of
 * the same eight lines two call sites away is the duplication `HowItsGoing`
 * was built to end. `null` for an empty sample, never `0` — a fleet with no
 * observed trip has no figure, not a zero-length one.
 */
export function median(xs: readonly number[]): number | null {
	if (xs.length === 0) return null;
	const sorted = [...xs].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * MEDIAN BAKE SPAN — `bakeStartTime` → `bakeEndTime`, across whatever set of
 * rollouts the caller scopes to (one app's cells, one environment's slots).
 * `/apps/[name]` and `/envs/[name]` each carried their own copy of this loop,
 * identical down to the guard clauses. A bake still running has no
 * `bakeEndTime` and is excluded rather than clamped to "now" — an in-flight
 * window is not a duration yet.
 */
export function medianBakeSpan(
	rollouts: readonly {
		status?: {
			history?: readonly {
				bakeStartTime?: string | null;
				bakeEndTime?: string | null;
			}[];
		};
	}[]
): number | null {
	const spans: number[] = [];
	for (const r of rollouts) {
		for (const h of r.status?.history ?? []) {
			if (!h.bakeStartTime || !h.bakeEndTime) continue;
			const a = new Date(h.bakeStartTime).getTime();
			const b = new Date(h.bakeEndTime).getTime();
			if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
			spans.push(b - a);
		}
	}
	return median(spans);
}

/** Earliest deploy of each build in one environment. A redeploy of the same
 *  build is not a second arrival. */
function firstSeen(env: LeadEnv): Map<string, number> {
	const out = new Map<string, number>();
	for (const d of env.deploys) {
		// `Number.isFinite` and nothing else. An earlier `d.ms <= 0` guard was
		// meant to reject "no timestamp" and instead rejected a legitimate
		// epoch-zero one — a magic-value test standing in for a validity test.
		// The caller already drops entries with no parsable timestamp.
		if (!d.version || !Number.isFinite(d.ms)) continue;
		const prev = out.get(d.version);
		if (prev === undefined || d.ms < prev) out.set(d.version, d.ms);
	}
	return out;
}

export function leadTime(envs: readonly LeadEnv[]): LeadTimeVM | null {
	if (envs.length < 2) return null;

	const ordered = [...envs].sort((a, b) => a.order - b.order);
	const from = ordered[0];

	// The destination: production as a set, or — for an app with no production
	// tier at all — the last step on its own line.
	const prod = ordered.filter((e) => e.prod && e !== from);
	const targets = prod.length > 0 ? prod : [ordered[ordered.length - 1]];
	if (targets.length === 1 && targets[0] === from) return null;

	const source = firstSeen(from);
	const arrival = new Map<string, number>();
	for (const t of targets) {
		if (t === from) continue;
		for (const [version, ms] of firstSeen(t)) {
			const prev = arrival.get(version);
			if (prev === undefined || ms < prev) arrival.set(version, ms);
		}
	}

	const samples: number[] = [];
	for (const [version, startMs] of source) {
		const endMs = arrival.get(version);
		if (endMs === undefined) continue;
		const delta = endMs - startMs;
		// A non-positive delta means the build was seen in production first —
		// a hotfix applied downstream, or a retention window that clipped the
		// upstream deploy. Either way it is not a lead time for this hop.
		if (delta <= 0) continue;
		samples.push(delta);
	}

	if (samples.length === 0) return null;
	samples.sort((a, b) => a - b);
	const mid = samples.length >> 1;
	const medianMs =
		samples.length % 2 === 1 ? samples[mid] : Math.round((samples[mid - 1] + samples[mid]) / 2);

	return {
		medianMs,
		samples: samples.length,
		fromLabel: from.label,
		toLabel: prod.length > 0 ? 'prod' : targets[0].label
	};
}

/**
 * Compact span for the `Lead` column. Same unit boundaries as
 * `formatTimeAgoCompact` so a lead time and an age are directly comparable
 * down a screen.
 */
export function compactSpan(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h`;
	const d = Math.floor(h / 24);
	if (d < 90) return `${d}d`;
	const mo = Math.floor(d / 30);
	if (mo < 12) return `${mo}mo`;
	return `${Math.floor(mo / 12)}y`;
}
