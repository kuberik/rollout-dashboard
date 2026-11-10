/**
 * Home sections 0–5, derived once from the home view-model (lifted from the
 * lab's `tarn/tarn-model.ts`, round 18, per `.work/home-r18/CONTENT.md`).
 * Nothing invented: words are the spec's (through paraglide), numbers and
 * times are the model's.
 *
 * Sections: 0 status · 1 Needs you · 2 Your changes · 3 Watch · 4 Rolling out
 * · 5 Quiet. Section 2 legitimately repeats an app from section 1; sections
 * 3–5 never repeat an app drawn in 1–2, nor each other (each app lands in its
 * highest section).
 *
 * Product changes from the lab: the starred set comes from the caller (the
 * lab hard-coded two apps); the per-app `Row` keeps only what Home reads
 * (order and rank), not the lab's track/outcome prose.
 */
import {
	type AppEnv,
	type AppModel,
	type EnvChange,
	type EnvState,
	type HoldReason,
	type HomeModel
} from '../home-model';
import type { SignalFacts } from '../fleet-signals';
import { formatTimeAgoCompact } from '$lib/utils';
import * as msg from '$lib/paraglide/messages';
import { formatWhen } from './field-model';

export type { AppModel, HomeModel, EnvState };

/** The one glyph vocabulary of the page: one shape per kind of fact. */
export type Kind =
	| 'done'
	| 'deploying'
	| 'checking'
	| 'held'
	| 'approval'
	| 'failed'
	| 'rolledback'
	| 'pending'
	| 'slow'
	| 'flapping'
	| 'recovered'
	| 'longwait';

const KIND_OF: Record<EnvState, Kind> = {
	healthy: 'done',
	superseded: 'done',
	deploying: 'deploying',
	checking: 'checking',
	'held-by-rule': 'held',
	'awaiting-approval': 'approval',
	failed: 'failed',
	'rolled-back': 'rolledback',
	'not-deployed': 'pending'
};
export const kindOf = (s: EnvState): Kind => KIND_OF[s];

/** `prod eu-west` for a prod region, the env's own label otherwise. */
export const place = (e: { isProdRegion: boolean; env: string; label: string }) =>
	e.isProdRegion && e.env !== 'prod' ? msg.home_m_place_prod({ region: e.label }) : e.label;

/** A check's name as Home prints it: without the app's own `<app>-` prefix. */
export const checkName = (app: string, check: string) =>
	check.startsWith(`${app}-`) ? check.slice(app.length + 1) : check;
const ago = (iso: string | null | undefined, now: Date) =>
	iso ? formatTimeAgoCompact(iso, now) : '';

// ── the viewer's ledger: every change once, at its furthest position ──

export type Mine = {
	ref: string;
	title: string;
	href: string;
	app: string;
	env: AppEnv;
	idx: number;
	state: EnvState;
	/** "15:17", or the arrival upstream for a change waiting at a gate, or the merge. */
	time: string;
	timeWord: 'arrived' | 'waiting since' | 'merged';
	/** the other apps this same change deploys to */
	shared: string[];
	/** rolled back: what runs there now */
	nowRuns: string | null;
};

const EXC = (s: EnvState | undefined) => s === 'failed' || s === 'rolled-back';
const DONE = (s: EnvState | undefined) => s === 'healthy' || s === 'superseded';

/**
 * Every one of the viewer's changes on this app once, at its furthest
 * position. A failure or rollback pins the change where it happened; a
 * superseded copy never outranks a live one; among prod regions an
 * unfinished one outranks a live one.
 */
export function ledger(a: AppModel, now: Date): Mine[] {
	const furthest = new Map<string, number>();
	a.envs.forEach((e, i) => {
		for (const c of e.myChanges) {
			const prev = furthest.get(c.ref);
			if (EXC(c.state)) furthest.set(c.ref, i);
			else if (prev === undefined) furthest.set(c.ref, i);
			else {
				const ps = a.envs[prev].myChanges.find((x) => x.ref === c.ref)?.state;
				// prod regions are a set, not a sequence: a region the change has
				// not finished (held, in bake…) outranks one where it is live
				const parallel = a.envs[prev].isProdRegion && e.isProdRegion;
				if (parallel && !DONE(ps) && DONE(c.state)) continue;
				if (!EXC(ps) && (c.state !== 'superseded' || ps === 'superseded')) furthest.set(c.ref, i);
			}
		}
	});
	const out: Mine[] = [];
	a.envs.forEach((e, i) => {
		for (const c of e.myChanges) {
			if (furthest.get(c.ref) !== i) continue;
			out.push(mineOf(a, e, i, c, now));
		}
	});
	return out;
}

function mineOf(a: AppModel, e: AppEnv, i: number, c: EnvChange, now: Date): Mine {
	let time = c.since ? formatWhen(c.since, now) : '';
	let timeWord: Mine['timeWord'] = 'arrived';
	if (!time && (c.state === 'awaiting-approval' || c.state === 'held-by-rule')) {
		// waiting at a gate: it has not arrived here; it has been waiting since it arrived upstream
		const up = a.envs
			.slice(0, i)
			.reverse()
			.map((x) => x.myChanges.find((y) => y.ref === c.ref))
			.find((y) => y?.since);
		if (up?.since) {
			time = formatWhen(up.since, now);
			timeWord = 'waiting since';
		}
	}
	if (!time && c.state === 'healthy' && e.arrivedAt) time = formatWhen(e.arrivedAt, now);
	if (!time) {
		time = formatWhen(c.mergedAt, now);
		timeWord = 'merged';
	}
	let nowRuns: string | null = null;
	if (c.state === 'rolled-back') {
		const live = e.myChanges.find((x) => x.state === 'healthy');
		nowRuns = live ? live.ref : e.version;
	}
	return {
		ref: c.ref,
		title: c.title,
		href: c.href,
		app: a.app,
		env: e,
		idx: i,
		state: c.state,
		time,
		timeWord,
		shared: (c.apps ?? []).filter((x) => x !== a.app),
		nowRuns
	};
}

// ── 0 · status line (fleet-wide) ──

export function status(m: HomeModel) {
	let failing = 0;
	let approvals = 0;
	for (const a of m.apps)
		for (const e of a.envs) {
			if (e.state === 'failed') failing++;
			if (e.state === 'awaiting-approval') approvals++;
		}
	return {
		failing,
		approvals,
		healthy: m.fleet.prodHealthy.healthy,
		total: m.fleet.prodHealthy.total
	};
}

// ── 1 · Needs you ──

export type Need = {
	key: string;
	app: string;
	/** the app's own page, finished (`AppModel.href`) */
	appHref: string;
	place: string;
	kind: 'failed' | 'approval';
	/** `Failing` / `Needs approval` */
	word: string;
	age: string;
	ageMs: number;
	/** `error-rate check failing` / `waits for a reviewer`, never ellipsized */
	cause: string;
	/** your change, or `'starred'` when it is not your change */
	why: { ref: string; title: string; href: string } | 'starred';
	action: { label: string; href: string };
	prod: boolean;
};

export const isYours = (a: AppModel) => a.envs.some((e) => e.myChanges.length > 0);

function checkCause(
	m: HomeModel,
	a: AppModel,
	env: string
): { cause: string; since: string | null } {
	const s = m.signals.find((x) => x.kind === 'check-failing' && x.app === a.app && x.env === env);
	if (!s) return { cause: msg.home_m_health_check_failing(), since: null };
	const check = s.facts?.kind === 'check-failing' ? s.facts.check : null;
	const cause = check
		? msg.home_m_check_failing({ name: checkName(a.app, check) })
		: msg.home_m_health_check_failing();
	return { cause, since: s.since };
}

/**
 * Since when a failed place has been failing: the place's check-failing
 * signal, else the failed change's own instant, else the deploy. The ONE
 * source of a failure's age, so Needs you and Your changes agree.
 */
export function failedSince(m: HomeModel, a: AppModel, e: AppEnv): string | null {
	return (
		checkCause(m, a, e.env).since ??
		e.myChanges.find((c) => c.state === 'failed' && c.since)?.since ??
		e.arrivedAt
	);
}

export function needs(m: HomeModel, now: Date, starred: ReadonlySet<string>): Need[] {
	const out: Need[] = [];
	for (const a of m.apps) {
		const yours = isYours(a);
		if (!yours && !starred.has(a.app)) continue;
		for (const e of a.envs) {
			if (e.state !== 'failed' && e.state !== 'awaiting-approval') continue;
			const mine = e.myChanges.find((c) => c.state === e.state);
			const why = mine
				? { ref: mine.ref, title: mine.title, href: mine.href }
				: starred.has(a.app)
					? ('starred' as const)
					: null;
			if (!why) continue;
			// THIS place's own rollout, never matched out of the app's lead
			// actions: two failing prod regions each roll back their own.
			const href = e.href;
			if (e.state === 'failed') {
				const { cause } = checkCause(m, a, e.env);
				const t = failedSince(m, a, e);
				out.push({
					key: `${a.app}|${e.env}`,
					app: a.app,
					appHref: a.href,
					place: place(e),
					kind: 'failed',
					word: msg.home_m_need_failing(),
					age: ago(t, now),
					ageMs: t ? now.getTime() - Date.parse(t) : 0,
					cause,
					why,
					action: { label: msg.home_m_action_roll_back({ env: e.label }), href },
					prod: e.isProdRegion
				});
			} else {
				const t = a.figure && a.facts.lead === 'awaiting-approval' ? null : e.arrivedAt;
				out.push({
					key: `${a.app}|${e.env}`,
					app: a.app,
					appHref: a.href,
					place: place(e),
					kind: 'approval',
					word: msg.home_m_need_approval(),
					age: t ? ago(t, now) : (a.figure ?? ''),
					ageMs: t ? now.getTime() - Date.parse(t) : 0,
					cause: msg.home_m_waits_for_reviewer(),
					why,
					action: { label: msg.home_m_action_review_approval(), href },
					prod: e.isProdRegion
				});
			}
		}
	}
	const rank = (n: Need) => (n.kind === 'failed' ? (n.prod ? 0 : 1) : 2);
	return out.sort((x, y) => rank(x) - rank(y) || y.ageMs - x.ageMs);
}

// ── 2 · Your changes ──

/** One app with your changes: its order key (`rank`: 0 failed/rolled back, 1 waiting, 2 moving, 3 all live). */
export type Row = { app: string; count: number; rank: number };

export function rows(m: HomeModel, now: Date): Row[] {
	const out: Row[] = [];
	for (const a of m.apps) {
		const mine = ledger(a, now);
		if (!mine.length) continue;
		const n = (s: EnvState) => mine.filter((x) => x.state === s).length;
		const rank =
			n('failed') + n('rolled-back')
				? 0
				: n('awaiting-approval') + n('held-by-rule')
					? 1
					: n('deploying') + n('checking')
						? 2
						: 3;
		out.push({ app: a.app, count: mine.length, rank });
	}
	return out.sort((x, y) => x.rank - y.rank || y.count - x.count || x.app.localeCompare(y.app));
}

const STOPPED: EnvState[] = ['failed', 'rolled-back', 'held-by-rule'];

/** Header totals: each change once (a change shipped to two apps counts once). */
export function totals(m: HomeModel) {
	const byKey = new Map<string, string[]>();
	const apps = new Set<string>();
	for (const a of m.apps)
		for (const e of a.envs)
			for (const c of e.myChanges) {
				apps.add(a.app);
				const k = `${c.repo ?? a.app}|${c.ref}`;
				const st = byKey.get(k) ?? [];
				st.push(e.isProdRegion ? c.state : `pre:${c.state}`);
				byKey.set(k, st);
			}
	let live = 0;
	let way = 0;
	let stopped = 0;
	for (const st of byKey.values()) {
		const raw = st.map((s) => s.replace('pre:', '') as EnvState);
		if (raw.some((s) => STOPPED.includes(s))) stopped++;
		else if (
			raw.some((s) => s === 'deploying' || s === 'checking' || s === 'awaiting-approval') ||
			!st.some((s) => !s.startsWith('pre:'))
		)
			way++;
		else live++;
	}
	return { changes: byKey.size, apps: apps.size, live, way, stopped };
}

// ── 3 · Watch ──

/** What a Watch line's evidence is made of, so the page words it from data. */
export type WatchFacts =
	/** one of the model's signals */
	| { kind: 'signal'; signal: SignalFacts | null }
	/** a failed place with no check-failing signal */
	| { kind: 'failed-env' }
	| { kind: 'rolled-back'; version: string }
	| { kind: 'approval'; version: string }
	/** `reason` null: no needs-you entry explains the hold */
	| { kind: 'held'; reason: HoldReason | null; checks?: string[]; provider?: string };

export type Watch = {
	key: string;
	kind: Kind;
	app: string;
	/** the app's own page, finished (`AppModel.href`) */
	appHref: string;
	/** `places` joined for a reader (`dev, staging`); one place for every kind but `held` */
	place: string;
	/** each place this line covers, in promotion order */
	places: string[];
	evidence: string;
	facts: WatchFacts;
	age: string;
	ageMs: number;
	href: string;
	sev: number;
};

const SOFT: Record<string, Kind> = {
	'slow-bake': 'slow',
	'check-flapping': 'flapping',
	'check-recovered': 'recovered',
	'long-wait': 'longwait',
	'check-failing': 'failed',
	// a failed deploy is a failure, never `checking`
	failed: 'failed'
};

export function watch(m: HomeModel, now: Date, above: Set<string>): Watch[] {
	const out: Watch[] = [];
	const ms = (iso: string | null) => (iso ? now.getTime() - Date.parse(iso) : 0);
	for (const s of m.signals) {
		if (above.has(s.app)) continue;
		const a = m.apps.find((x) => x.app === s.app);
		const e = a?.envs.find((x) => x.env === s.env);
		if (!a || !e) continue;
		out.push({
			key: s.key,
			kind: SOFT[s.kind] ?? 'checking',
			app: s.app,
			appHref: a.href,
			place: place(e),
			places: [place(e)],
			evidence: s.phrase,
			facts: { kind: 'signal', signal: s.facts },
			age: s.kind === 'slow-bake' ? '' : ago(s.since, now),
			ageMs: ms(s.since),
			href: s.href,
			sev: s.kind === 'check-failing' || s.kind === 'failed' ? 0 : 4
		});
	}
	for (const a of m.apps) {
		if (above.has(a.app)) continue;
		// failures elsewhere, not already a check-failing signal
		for (const e of a.envs.filter(
			(x) => x.state === 'failed' && !m.signals.some((s) => s.app === a.app && s.env === x.env)
		))
			out.push({
				key: `f|${a.app}|${e.env}`,
				kind: 'failed',
				app: a.app,
				appHref: a.href,
				place: place(e),
				places: [place(e)],
				evidence: msg.home_m_evidence_failed_check(),
				facts: { kind: 'failed-env' },
				age: ago(e.arrivedAt, now),
				ageMs: ms(e.arrivedAt),
				href: e.href,
				sev: 0
			});
		// rollbacks in the last 24h
		for (const e of a.envs.filter((x) => x.state === 'rolled-back' && ms(x.arrivedAt) < 86_400_000))
			out.push({
				key: `rb|${a.app}|${e.env}`,
				kind: 'rolledback',
				app: a.app,
				appHref: a.href,
				place: place(e),
				places: [place(e)],
				evidence: msg.home_m_evidence_rolled_back_to({ version: e.version ?? '' }),
				facts: { kind: 'rolled-back', version: e.version ?? '' },
				age: ago(e.arrivedAt, now),
				ageMs: ms(e.arrivedAt),
				href: e.href,
				sev: 1
			});
		// approvals elsewhere (dropped from Home by decision 4, in `lumen-model.ts`)
		for (const e of a.envs.filter((x) => x.state === 'awaiting-approval'))
			out.push({
				key: `ap|${a.app}|${e.env}`,
				kind: 'approval',
				app: a.app,
				appHref: a.href,
				place: place(e),
				places: [place(e)],
				evidence: msg.home_m_evidence_approval_elsewhere({ version: e.version ?? '' }),
				facts: { kind: 'approval', version: e.version ?? '' },
				age: a.figure ?? ago(e.arrivedAt, now),
				ageMs: ms(e.arrivedAt),
				href: e.href,
				sev: 2
			});
		// held by a rule: one line per (app, cause), places folded
		const held = a.envs.filter((x) => x.state === 'held-by-rule');
		if (held.length) {
			const ny = m.fleet.needsYou.find(
				(x) => x.app === a.app && held.some((e) => x.env === e.env || x.env.endsWith(e.label))
			);
			out.push({
				key: `h|${a.app}`,
				kind: 'held',
				app: a.app,
				appHref: a.href,
				place: held.map(place).join(msg.home_m_list_sep()),
				places: held.map(place),
				evidence: ny?.phrase ?? msg.home_m_waits_on_rule(),
				facts: ny?.facts.checks
					? { kind: 'held', reason: ny.facts.reason, checks: ny.facts.checks }
					: ny?.facts.provider
						? { kind: 'held', reason: ny.facts.reason, provider: ny.facts.provider }
						: { kind: 'held', reason: ny?.facts.reason ?? null },
				age: a.figure ?? '',
				ageMs: ms(held[0].arrivedAt),
				href: held[0].href,
				sev: 3
			});
		}
	}
	return out.sort((x, y) => x.sev - y.sev || y.ageMs - x.ageMs);
}

// ── 4 · Rolling out ──

/** `step`: `deploying · step 2 of 4`, `checking`, `in bake` (a lone `step 1 of 1` is dropped). */
export type Rolling = {
	app: string;
	/** the app's own page, finished (`AppModel.href`) */
	appHref: string;
	kind: Kind;
	place: string;
	step: string;
	age: string;
	/** this place's own rollout page (`AppEnv.href`) */
	href: string;
};

export function rolling(
	m: HomeModel,
	now: Date,
	above: Set<string>,
	starred: ReadonlySet<string>
): Rolling[] {
	const out: (Rolling & { star: number })[] = [];
	for (const a of m.apps) {
		if (above.has(a.app)) continue;
		for (const e of a.envs.filter((x) => x.state === 'deploying' || x.state === 'checking')) {
			const p = e.pipeline;
			const hasStep = !!p?.activeStep && (!p.isFallback || e.state === 'deploying');
			// a one-step pipeline's "step 1 of 1" says nothing; the lab page stripped it
			const stepWords =
				hasStep && p.activeStep && !(p.activeStep.index === 1 && p.activeStep.total === 1)
					? msg.home_m_step({ index: p.activeStep.index, total: p.activeStep.total })
					: '';
			const inBake = !hasStep && p?.bake === 'active';
			const stateWord =
				e.state === 'deploying' ? msg.home_m_rolling_deploying() : msg.home_m_rolling_checking();
			out.push({
				app: a.app,
				appHref: a.href,
				kind: kindOf(e.state),
				place: place(e),
				href: e.href,
				step: inBake
					? msg.home_m_word_in_bake()
					: [stateWord, stepWords].filter(Boolean).join(' · '),
				age: ago(e.arrivedAt, now),
				star: starred.has(a.app) ? 0 : 1
			});
		}
	}
	return out
		.sort((x, y) => x.star - y.star || x.app.localeCompare(y.app))
		.map((x) => ({
			app: x.app,
			appHref: x.appHref,
			kind: x.kind,
			place: x.place,
			step: x.step,
			age: x.age,
			href: x.href
		}));
}

// ── 5 · Quiet ──

export function quiet(m: HomeModel, above: Set<string>, starred: ReadonlySet<string>): string[] {
	return m.apps
		.map((a) => a.app)
		.filter((x) => !above.has(x))
		.sort((x, y) => Number(!starred.has(x)) - Number(!starred.has(y)) || x.localeCompare(y));
}
