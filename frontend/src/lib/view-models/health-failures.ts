/**
 * Health-check failures as evidence rows (take C, health-conditions).
 *
 * Reads ONLY what a HealthCheck already carries plus one optional field: `status.status`, `message`, `lastErrorTime`
 * (the witness), `lastChangeTime`, `observations[]` (name, kind, value, limit, total, direction, unit, window, healthy,
 * and the new `message`), and the `history[].failedHealthChecks[].observations` snapshot. No conditions, no failures[],
 * no flap counts, no labels, no links, no "can't run": a check that cannot evaluate is a Pending check whose `message`
 * is the provider error. Never parses `name` or `message`.
 */
import type { HealthCheck, HealthObservation } from '../../types';
import { classifyCheck } from './health-witness';
import { formatAgoCompact } from '../utils';
import { num } from './attention';

export type CheckVerdict = 'failing' | 'pending' | 'recovered' | 'passing';
/** the check's class decides the row's glyph and the identity's type: a kustomization names a resource, a prometheus alert an alertname */
export type CheckClass = 'kustomization' | 'datadog' | 'prometheus' | 'incidents' | 'other';

export function classOf(hc: Pick<HealthCheck, 'spec'> | null | undefined): CheckClass {
	const c = (hc?.spec?.class ?? '').toLowerCase();
	if (c.includes('incident')) return 'incidents';
	if (c.includes('kustomization')) return 'kustomization';
	if (c.includes('prometheus')) return 'prometheus';
	if (c.includes('datadog')) return 'datadog';
	return 'other';
}

/** the figure of one observation, as two spans: the number the reader scans and the budget / unit words that qualify it */
export type Figure = { value: string; note: string };

const DEC = /^-?\d+(\.\d+)?$/;
const isDec = (s: unknown): s is string => typeof s === 'string' && DEC.test(s.trim());
const tight = (u: string) => u === '%' || u === '‰';
const withUnit = (v: string, u: string) => (u ? (tight(u) ? `${v}${u}` : `${v} ${u}`) : v);

export function figureOf(o: HealthObservation): Figure | null {
	const unit = o.unit ?? '';
	if (o.kind === 'Threshold') {
		if (!isDec(o.value) || !isDec(o.limit) || (o.direction !== 'Above' && o.direction !== 'Below')) return null;
		const side = o.direction === 'Above' ? 'over' : 'under';
		return { value: withUnit(num(o.value), unit), note: `${side} ${withUnit(num(o.limit), unit)}${o.window ? `, ${o.window} window` : ''}` };
	}
	if (o.kind === 'Ratio') {
		if (!isDec(o.value) || !isDec(o.total) || Number(o.total) <= 0) return null;
		return { value: `${num(o.value)} of ${num(o.total)}`, note: unit };
	}
	if (o.kind === 'Count') {
		if (!isDec(o.value)) return null;
		return { value: num(o.value), note: unit };
	}
	return null; // State: a word, not a measurement
}

export type ObsRow = {
	key: string;
	state: 'failing' | 'pending' | 'recovered';
	cls: CheckClass;
	/** observation `name`, verbatim */
	name: string;
	figure: Figure | null;
	/** observation `message`, verbatim; never truncated, never parsed */
	message?: string;
	obs: HealthObservation;
};

const rowOf = (o: HealthObservation, i: number, state: ObsRow['state'], cls: CheckClass): ObsRow => ({
	key: `${state}/${o.name}/${i}`,
	state,
	cls,
	name: o.name,
	figure: figureOf(o),
	message: o.message?.trim() || undefined,
	obs: o
});

/** a history snapshot's check (`history[].failedHealthChecks[]`) */
export type SnapCheck = { name: string; namespace?: string; message?: string; observations?: HealthObservation[] };

export type Recovery = {
	/** when it first failed: the earliest `observedTime` of the snapshot's failing observations, else the witness `lastErrorTime` */
	failedAt: string | null;
	/** `lastChangeTime`: when it went back to Healthy */
	okSince: string;
	/** the snapshot's failing observations, in recovered ink, figures as they failed */
	rows: ObsRow[];
};

export type CheckView = {
	key: string;
	name: string;
	cls: CheckClass;
	verdict: CheckVerdict;
	/** `status.message`: the fallback line when no observation carries the evidence */
	message?: string;
	/** failing: the failing observations; pending: those not yet healthy; else [] */
	rows: ObsRow[];
	/** failing / pending: `lastChangeTime`, else `lastErrorTime` */
	since: string | null;
	recovery: Recovery | null;
};

export const displayName = (hc: HealthCheck) => hc?.metadata?.annotations?.['kuberik.com/display-name'] || hc?.metadata?.name || 'health check';

const earliest = (ts: (string | undefined)[]): string | null => {
	const ok = ts.filter((t): t is string => !!t && Number.isFinite(Date.parse(t)));
	return ok.length ? ok.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
};

export function verdictOf(hc: HealthCheck, windowStart: Date | null): CheckVerdict {
	return classifyCheck(hc, windowStart);
}

export function rowsOf(hc: HealthCheck, verdict: CheckVerdict): ObsRow[] {
	const obs = hc?.status?.observations ?? [];
	const cls = classOf(hc);
	if (verdict === 'failing') return obs.filter((o) => o.healthy === false).map((o, i) => rowOf(o, i, 'failing', cls));
	if (verdict === 'pending') return obs.filter((o) => o.healthy !== true).map((o, i) => rowOf(o, i, 'pending', cls));
	return [];
}

export function checkView(hc: HealthCheck, windowStart: Date | null, snaps: SnapCheck[] = []): CheckView {
	const verdict = verdictOf(hc, windowStart);
	const st = hc?.status;
	const cls = classOf(hc);
	const rows = rowsOf(hc, verdict);
	let recovery: Recovery | null = null;
	if (verdict === 'recovered') {
		const snap = snaps.find((s) => s.name === hc.metadata?.name);
		const failing = (snap?.observations ?? []).filter((o) => o.healthy === false);
		const okSince = st?.lastChangeTime ?? st?.lastErrorTime ?? '';
		recovery = {
			failedAt: earliest(failing.map((o) => o.observedTime)) ?? st?.lastErrorTime ?? null,
			okSince,
			rows: failing.map((o, i) => rowOf(o, i, 'recovered', cls))
		};
	}
	return {
		key: `${hc.metadata?.name ?? ''}/${hc.metadata?.namespace ?? ''}`,
		name: displayName(hc),
		cls,
		verdict,
		message: st?.message?.trim() || undefined,
		rows,
		since: verdict === 'failing' || verdict === 'pending' ? (st?.lastChangeTime ?? st?.lastErrorTime ?? null) : null,
		recovery
	};
}

/** a check we only know from the history entry (no live HealthCheck): it failed, so its failing observations are the rows */
export function snapView(s: SnapCheck, live?: HealthCheck | null): CheckView {
	const failing = (s.observations ?? []).filter((o) => o.healthy !== true);
	const cls = live ? classOf(live) : 'other';
	return {
		key: `${s.name}/${s.namespace ?? ''}`,
		name: live ? displayName(live) : s.name,
		cls,
		verdict: 'failing',
		message: s.message?.trim() || undefined,
		rows: failing.map((o, i) => rowOf(o, i, 'failing', cls)),
		since: earliest(failing.map((o) => o.observedTime)),
		recovery: null
	};
}

/** the checks a failed deploy is about: every check on the history entry (live view when the HealthCheck is still there), then any other check failing now */
export function poolOf(live: HealthCheck[], snaps: SnapCheck[], windowStart: Date | null): CheckView[] {
	const out: CheckView[] = [];
	const seen = new Set<string>();
	for (const s of snaps) {
		seen.add(s.name);
		const l = live.find((h) => h.metadata?.name === s.name);
		out.push(l ? checkView(l, windowStart, snaps) : snapView(s));
	}
	for (const h of live) {
		if (seen.has(h.metadata?.name ?? '')) continue;
		const v = checkView(h, windowStart, snaps);
		if (v.verdict === 'failing') out.push(v);
	}
	return out;
}

export type Worst = { check: CheckView; row: ObsRow | null; recovered: boolean };

/** the worst failing observation (a drawable figure first, live before snapshot as `poolOf` orders them), else the first recovered one; null when nothing is evidence */
export function worstOf(pool: CheckView[]): Worst | null {
	const failing = pool.flatMap((check) => check.rows.filter((r) => r.state === 'failing').map((row) => ({ check, row })));
	const w = failing.find((x) => x.row.figure) ?? failing[0];
	if (w) return { ...w, recovered: false };
	const rec = pool.find((c) => c.recovery && c.recovery.rows.length > 0);
	if (rec) return { check: rec, row: rec.recovery!.rows.find((r) => r.figure) ?? rec.recovery!.rows[0], recovered: true };
	return null;
}

export const failingRowCount = (pool: CheckView[]) => pool.reduce((n, c) => n + c.rows.filter((r) => r.state === 'failing').length, 0);
export const failingCheckCount = (pool: CheckView[]) => pool.filter((c) => c.rows.some((r) => r.state === 'failing')).length;

/** `{value} {note}` ("812 ms over 500 ms, 5m window"), the figure as one phrase */
export const figureText = (f: Figure | null) => (f ? `${f.value}${f.note ? ` ${f.note}` : ''}` : '');

/** the short cause for the cards and strips: Threshold `{name} {value} / {limit}`, Ratio `{name} {value}/{total} {unit}`, else `{name}`; recovered `{name} recovered` */
export function shortCause(row: ObsRow, recovered = false): string {
	if (recovered) return `${row.name} recovered`;
	const o = row.obs;
	const unit = o.unit ?? '';
	if (row.figure && o.kind === 'Threshold') return `${row.name} ${row.figure.value} / ${withUnit(num(o.limit!), unit)}`;
	if (row.figure && o.kind === 'Ratio') return `${row.name} ${num(o.value!)}/${num(o.total!)}${unit ? ` ${unit}` : ''}`;
	return row.name;
}

/** the same without the name (the strips' only room): "812 ms / 500 ms", "1/3 ready", else '' */
export function shortFact(row: ObsRow): string {
	const s = shortCause(row);
	return s === row.name ? '' : s.slice(row.name.length + 1);
}

/**
 * The one-line evidence for cards and strips: the worst observation's name and figure, the budget words, the observation itself
 * (for the attention figure), the quiet `+n more` note and the recovered flag. null when the pool carries no observation evidence
 * (callers keep today's check + message).
 */
export type Evidence = { /** recovered: when the check went OK (ISO) */ okSince?: string | null; name: string; cls: CheckClass; /** the cause line of rows and strips (spec rule 7): `{name} {value} / {limit}`, `{name} {value}/{total} {unit}`, `{name} recovered`, else the name */ cause: string; message: string; /** the strips' only room: the fact without the name */ short: string; observations: HealthObservation[]; note: string | null; recovered: boolean };
export function evidenceLine(pool: CheckView[]): Evidence | null {
	const w = worstOf(pool);
	if (!w || !w.row) return null;
	const r = w.row;
	if (w.recovered) return { name: r.name, cls: r.cls, cause: shortCause(r, true), message: 'recovered', short: 'recovered', /* the snapshot figure the card draws in recovered ink */ observations: [r.obs], okSince: w.check.recovery?.okSince ?? null, note: null, recovered: true };
	const more = failingRowCount(pool) - 1;
	const short = shortFact(r);
	return {
		name: r.name,
		cls: r.cls,
		cause: shortCause(r),
		message: r.figure?.note ? `${r.figure.note}` : (r.message ?? 'failing'),
		short: short || 'failing',
		observations: [r.obs],
		note: more > 0 ? `+${more} more` : null,
		recovered: false
	};
}

/** a history snapshot's failed checks as the strips draw them: one check line and the `+n more` count of further failing observations. null without observations. */
export function snapshotCause(snaps: SnapCheck[]): { check: { name: string; message: string }; more: number } | null {
	const pool = snaps.map((x) => snapView(x));
	const ev = evidenceLine(pool);
	if (!ev) return null;
	return { check: { name: ev.name, message: ev.short }, more: Math.max(0, failingRowCount(pool) - 1) };
}

/** the compact age of a check's fact line ("6m") */
export const agoOf = (iso: string | null | undefined, now: Date): string | null => (iso ? formatAgoCompact(iso, now) : null);

/** `HH:MM`, 24h, the way the recovered strip and the fact line print a moment */
export const clock = (iso: string, secs = false): string =>
	new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(secs ? { second: '2-digit' } : {}), hour12: false });

/** the recovered strip's geometry, as 0..1 fractions of the axis (bake start .. now), clamped. The axis starts where the bake (the check) started, not at the deploy: the label says `check 09:21`. */
export type WindowStrip = { startLabel: string; failedPct: number; okPct: number; failedLabel: string; okLabel: string; };
export function windowStrip(rec: Recovery, axisStart: Date | null, now: Date): WindowStrip | null {
	if (!rec.failedAt || !rec.okSince) return null;
	const f = Date.parse(rec.failedAt), ok = Date.parse(rec.okSince);
	if (!Number.isFinite(f) || !Number.isFinite(ok)) return null;
	const start = Math.min(axisStart ? axisStart.getTime() : f, f);
	const end = Math.max(now.getTime(), ok);
	const span = Math.max(1, end - start);
	const pct = (t: number) => Math.max(0, Math.min(1, (t - start) / span));
	const failedPct = pct(f), okPct = Math.max(pct(ok), failedPct);
	return {
		startLabel: `check ${clock(new Date(start).toISOString())}`,
		failedPct,
		okPct,
		failedLabel: `failed ${clock(rec.failedAt)}`,
		okLabel: `OK ${clock(rec.okSince)}`
	};
}

/**
 * THE FAILURE BANNER'S EVIDENCE, one function for every banner that states a failed deploy (the rollout Overview's FailurePanel, the
 * /rollouts /changes /envs hero, the /apps/<app> banner): the observation the banner leads with, the check line, and the one message line.
 * `ago` is the compact age of the worst check ("12m"), printed as "· 12m ago"; pass null when the banner's meta line already says "for 12m".
 * Recovered (every check OK now): check line `{name}: {figure} at {failedAt}`, message `Recovered at {okAt}, so a retry is reasonable.`.
 */
export type BannerEvidence = { observations: HealthObservation[]; check: { name: string; message?: string; cls?: string }; message: string; recovered: boolean; pool: CheckView[] };
export function bannerEvidence(pool: CheckView[], pendingN: number, ago: string | null): BannerEvidence | null {
	const worst = worstOf(pool);
	if (!worst?.row) return null;
	const r = worst.row;
	if (worst.recovered) {
		const at = worst.check.recovery?.failedAt;
		const ok = worst.check.recovery?.okSince;
		return {
			observations: [],
			check: { name: r.name, cls: r.cls, message: `${figureText(r.figure)}${at ? ` at ${clock(at)}` : ''}`.trim() || undefined },
			message: `Recovered${ok ? ` at ${clock(ok)}` : ''}, so a retry is reasonable.`,
			recovered: true,
			pool
		};
	}
	const n = failingCheckCount(pool);
	/* "12m ago" stays together: non-breaking spaces inside the time unit */
	const tail = ago ? `\u00a0· ${ago} ago` : '';
	return {
		observations: [r.obs],
		check: { name: r.name, cls: r.cls, message: r.message },
		message: `${n} health check${n === 1 ? '' : 's'} failing${pendingN > 0 ? `, ${pendingN} pending` : ''}${tail}`,
		recovered: false,
		pool
	};
}

/**
 * THE CHECKS OF A HISTORY ENTRY, classified and ordered as the Overview's health card has them. For the CURRENT entry the live HealthChecks
 * classify each snapshot check (failing / pending / recovered), so a pending check stays pending and a recovered one reads "OK HH:MM";
 * the order is the card's: failing, pending, recovered, then the rest, each in the live list's own order. A past entry (`live` empty) is
 * every snapshot as a failed check (`snapView`).
 */
export function historyPool(snaps: SnapCheck[], live: HealthCheck[], windowStart: Date | null): CheckView[] {
	const rank = (v: CheckView) => (v.verdict === 'failing' ? 0 : v.verdict === 'pending' ? 1 : v.verdict === 'recovered' ? 2 : 3);
	const idx = (v: CheckView, s: SnapCheck) => { const i = live.findIndex((h) => h.metadata?.name === s.name); return i < 0 ? live.length : i; };
	return snaps
		.map((s, i) => {
			const l = live.find((h) => h.metadata?.name === s.name);
			const v = l ? checkView(l, windowStart, snaps) : snapView(s);
			return { v, i, at: idx(v, s) };
		})
		.sort((a, b) => rank(a.v) - rank(b.v) || a.at - b.at || a.i - b.i)
		.map((x) => x.v);
}
