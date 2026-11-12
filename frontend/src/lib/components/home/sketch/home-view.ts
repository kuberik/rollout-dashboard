/**
 * r28 CONSOLIDATED Home — what each block of the 1·2·3 cascade shows, derived once from the real
 * HomeModel (`buildSketch` for the per-change rows) plus the raw rollout history the model does not
 * carry (when a given BUILD reached each place, for the lead's timed track).
 *
 *   1  lead            your failing change in prod > the top approval only you can give > your
 *                      most recently moving change
 *   2  failures | approvals only you can give      (the rest of what needs you)
 *   3  yours on the way | not yours, stuck | production
 */
import { newestFirst, latest, isLater } from '$lib/instant';
import type { AppModel, HomeModel } from '$lib/view-models/home-model';
import { buildSketch, ownerOf, type Elsewhere, type YourChange } from './sketch-home';
import { changeBySha, historyAt, homeModel, source, viewerLogin, NOW, type HomeState } from './home-data';

/** Passes of one build less than 8 minutes apart are one step ("Passed dev and test"): the
 *  track draws time linearly, and a 5-minute gap is narrower than its own label. */
function mergeClose(steps: Step[]) {
	for (let i = steps.length - 1; i > 0; i--) {
		const a = steps[i - 1], b = steps[i];
		if (a.state === 'done' && b.state === 'done' && a.label.startsWith('Passed ') && b.label.startsWith('Passed ') && a.at && b.at && Date.parse(b.at) - Date.parse(a.at) < 8 * 60000) {
			steps.splice(i - 1, 2, { label: `${a.label} and ${b.label.slice(7)}`, at: b.at, state: 'done', note: `${clock(a.at)} and ${clock(b.at)}` });
		}
	}
}
/** Places whose before → after are identical are one row ("ap-south, eu-west → c0d3e88"). */
function group(rows: PreviewRow[]): PreviewRow[] {
	const out: PreviewRow[] = [];
	for (const r of rows) {
		const g = out.find((o) => o.before === r.before && o.after === r.after && o.beforeTone === r.beforeTone);
		if (g) g.place = `${g.place}, ${r.place}`;
		else out.push({ ...r });
	}
	return out;
}
import type { PreviewRow } from './ActionPreview.svelte';

export type Step = { label: string; at: string | null; state: 'done' | 'active' | 'fail' | 'pending'; note?: string | null };
/** A gap's own words, drawn on the segment INTO step i (index = target). */
export type Lead = {
	kind: 'failing' | 'approval' | 'moving';
	eyebrow: string;
	ref: string | null;
	title: string;
	href: string;
	meta: string;
	check: { name: string; message: string } | null;
	/** one measured fact for the lead's left column (quiet: how long the previous build took) */
	fact: string | null;
	action: { label: string; href: string } | null;
	steps: Step[];
	/** words on the live (last timed → now) segment */
	live: string | null;
	/** the time slot's word over the first step that has not happened */
	next: string;
	preview: { rows: PreviewRow[]; action: string; rest: string | null; foot: string } | null;
};
export type Approval = { /** the other hold an approval ask names, when the approval is not the only hold (`alsoApprovalAsk`) */ note?: string | null; key: string; app: string; ref: string | null; title: string; author: string; places: number; placeWord: string; since: string | null; href: string; build: string | null };
export type Fail = YourChange & { place: string };
export type Moving = YourChange & { reached: number; total: number };
export type NotYours = { key: string; app: string; ref: string | null; title: string | null; whose: string; status: string; since: string | null; href: string; flapping: boolean };
export type Production = {
	total: number;
	failing: { app: string; env: string; whose: string; ref: string | null; href: string }[];
	held: number;
	moving: number;
	rolledBack: { key: string; app: string; env: string; ref: string | null; href: string; note: string }[];
	signals: { key: string; app: string; whose: string; text: string; since: string | null; href: string }[];
};
export type HomeView = {
	lead: Lead | null;
	failures: Fail[];
	approvals: Approval[];
	moving: Moving[];
	waiting: YourChange[];
	held: YourChange[];
	yoursTotal: number;
	notYours: NotYours[];
	prod: Production;
};

const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const isProd = (a: AppModel, env: string) => a.envs.find((e) => e.env === env)?.isProdRegion || a.envs.find((e) => e.env === env)?.tier === 'prod';
export function dur(ms: number): string {
	const m = Math.max(0, Math.round(ms / 60000));
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
	return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** The build an approval is for: the one the last place before prod already runs. */
function approvalOf(m: HomeModel, e: Elsewhere): Approval {
	const a = m.apps.find((x) => x.app === e.app)!;
	const pre = a.envs.filter((x) => !x.isProdRegion && x.tier !== 'prod' && x.state === 'healthy');
	const build = pre.length ? pre[pre.length - 1].version : null;
	const ch = changeBySha(e.app, build);
	const waiting = a.envs.filter((x) => x.state === 'awaiting-approval' || (x.state === 'held-by-rule' && x.alsoApproval));
	let passed: string | null = null;
	for (const x of pre) {
		const hh = historyAt(e.app, x.env).find((q) => build && q.sha === build.slice(0, 7));
		if (hh && (!passed || isLater(hh.at, passed))) passed = hh.at;
	}
	const since = latest([e.since, passed]);
	return {
		key: e.key,
		app: e.app,
		ref: ch?.ref ?? null,
		title: ch?.title ?? (build ? `build ${build.slice(0, 7)}` : e.app),
		author: ch?.author ?? e.whose,
		places: waiting.length,
		placeWord: waiting.length === 1 ? waiting[0].env : `${waiting.length} prod regions`,
		since,
		href: e.href,
		build: build ? build.slice(0, 7) : null,
		note: e.ask ?? null
	};
}

function failingLead(m: HomeModel, y: YourChange): Lead {
	const a = m.apps.find((x) => x.app === y.app)!;
	const here = a.envs.find((e) => e.env === y.where[0])!;
	const hist = historyAt(y.app, here.env);
	const passed = y.stops.filter((s) => !s.here && (s.state === 'healthy' || s.state === 'superseded') && s.since);
	const p = here.pipeline;
	const how = p.isFallback ? 'all at once, no canary' : p.activeStep ? `canary step ${p.activeStep.index} of ${p.activeStep.total}` : 'after every canary step';
	const failedAt = hist[0]?.bakeEnd ?? y.since;
	const back = changeBySha(y.app, y.rollbackTo);
	const placeLabel = here.isProdRegion ? here.env : here.env;
	const check = y.evidence ? y.evidence.replace(/ failing$/, '') : null;
	const others = a.envs.filter((e) => e !== here);
	return {
		kind: 'failing',
		eyebrow: `Your change is failing in ${placeLabel}`,
		ref: y.ref,
		title: y.title,
		href: here.href,
		meta: `${y.app} · merged by you ${clock(y.mergedAt)}`,
		fact: null,
		check: check ? { name: check, message: hist[0]?.bake === 'Failed' ? 'reported an error during the bake' : 'failing' } : null,
		action: { label: `Roll back ${placeLabel}${y.rollbackTo ? ` to ${y.rollbackTo}` : ''}`, href: here.href },
		steps: [
			{ label: 'Released', at: y.mergedAt, state: 'done' },
			...passed.map((s) => ({ label: `Passed ${s.label}`, at: s.since, state: 'done' as const })),
			{ label: `Deployed to ${placeLabel}`, at: here.arrivedAt, state: 'done', note: how },
			{ label: 'Bake failed', at: failedAt, state: 'fail', note: check },
			{ label: `Roll back`, at: null, state: 'pending', note: y.rollbackTo ? `${placeLabel} goes back to ${y.rollbackTo}` : null }
		],
		live: `failing ${dur(NOW.getTime() - t(failedAt))}`,
		next: 'if you roll back',
		preview: {
			action: `Roll back ${placeLabel}`,
			rows: [
				...others.map((e) => ({ place: e.env, before: y.ref, beforeTone: 'neutral' as const, after: null })),
				{ place: here.env, before: y.ref, beforeTone: 'danger' as const, after: y.rollbackTo ?? 'previous' }
			],
			rest: null,
			foot: `Changes 1 of ${a.envs.length} places${back ? `; ${y.rollbackTo} is “${back.title}”` : ''}. ${others.map((e) => e.env).join(' and ')} keep ${y.ref}.`
		}
	};
}

function approvalLead(m: HomeModel, ap: Approval): Lead {
	const a = m.apps.find((x) => x.app === ap.app)!;
	const ch = changeBySha(ap.app, ap.build);
	const pre = a.envs.filter((x) => !x.isProdRegion && x.tier !== 'prod');
	const steps: Step[] = [];
	if (ch) steps.push({ label: 'Released', at: ch.mergedAt, state: 'done' });
	let last: string | null = ch?.mergedAt ?? null;
	for (const e of pre) {
		const h = historyAt(ap.app, e.env).find((x) => ap.build && x.sha === ap.build);
		if (h) {
			steps.push({ label: `Passed ${e.env}`, at: h.at, state: 'done' });
			last = h.at;
		}
	}
	const waitFrom = ap.since ?? last;
	mergeClose(steps);
	steps.push({ label: `Deploys to ${ap.placeWord}`, at: null, state: 'pending', note: 'on its own after that' });
	const prods = a.envs.filter((e) => e.isProdRegion || e.tier === 'prod');
	const changing = prods.filter((e) => e.state === 'awaiting-approval');
	const stays = prods.filter((e) => e.state !== 'awaiting-approval');
	return {
		kind: 'approval',
		eyebrow: 'Waiting on your approval · nothing of yours is failing',
		ref: ap.ref,
		title: ap.title,
		href: ap.href,
		meta: `${ap.app} · ${ap.author}'s change · build ${ap.build ?? '?'}`,
		check: null,
		fact: null,
		action: { label: 'Review', href: ap.href },
		steps,
		live: `waits for you · ${dur(NOW.getTime() - t(waitFrom))}`,
		next: 'once you approve',
		preview: {
			action: 'approval',
			rows: group(changing.map((e) => ({ place: e.label, before: (e.version ?? '').slice(0, 7), beforeTone: 'neutral' as const, after: ap.build ?? ap.ref ?? '' }))),
			rest: stays.length ? `${stays.map((e) => e.label).join(', ')} stay${stays.length === 1 ? 's' : ''} on ${(stays[0].version ?? '').slice(0, 7)}${stays.length > 1 ? ' and others' : ''}: no approval rule there` : null,
			foot: `Changes ${changing.length} of ${prods.length} prod regions. Dev, test and staging are not touched.`
		}
	};
}

function movingLead(m: HomeModel, y: YourChange): Lead {
	const a = m.apps.find((x) => x.app === y.app)!;
	const i = a.envs.findIndex((e) => e.env === y.where[0]);
	const here = a.envs[i];
	const ahead = a.envs.slice(i + 1);
	const aheadPre = ahead.filter((e) => !e.isProdRegion && e.tier !== 'prod');
	const aheadProd = ahead.filter((e) => e.isProdRegion || e.tier === 'prod');
	const verb = y.state === 'deploying' ? 'Deploying to' : 'Checking in';
	// which prod places of this app carry an approval rule (read from the captured state, where they hold)
	const raw = homeModel('incident').apps.find((x) => x.app === y.app);
	const needApprover = (raw?.envs ?? []).filter((e) => e.state === 'awaiting-approval' && ahead.some((x) => x.env === e.env)).map((e) => e.label);
	// what the previous build took over the same road, from history (a measured fact, not an ETA)
	const prev = historyAt(y.app, here.env)[1];
	let prevFact: string | null = null;
	if (prev) {
		let lastEnv: string | null = null;
		let lastAt: string | null = null;
		for (const e of aheadPre) {
			const h = historyAt(y.app, e.env).find((x) => x.sha === prev.sha);
			if (h) { lastEnv = e.env; lastAt = h.at; }
		}
		if (lastEnv && lastAt) prevFact = `Your previous build, ${prev.sha}, went from ${here.env} to ${lastEnv} in ${dur(t(lastAt) - t(prev.at))}.`;
	}
	return {
		kind: 'moving',
		eyebrow: 'Nothing needs you · your change is moving',
		ref: y.ref,
		title: y.title,
		href: here.href,
		meta: `${y.app} · merged by you ${clock(y.mergedAt)}`,
		check: null,
		fact: prevFact,
		action: null,
		steps: [
			{ label: 'Released', at: y.mergedAt, state: 'done' },
			{ label: `${verb} ${here.env}`, at: y.since, state: 'active', note: here.pipeline.activeStep ? `canary step ${here.pipeline.activeStep.index} of ${here.pipeline.activeStep.total}` : null },
			...aheadPre.map((e) => ({ label: e.env, at: null, state: 'pending' as const })),
			...(aheadProd.length ? [{ label: aheadProd.length === 1 ? aheadProd[0].env : `${aheadProd.length} prod regions`, at: null, state: 'pending' as const, note: needApprover.length ? `${needApprover.join(' and ')} need${needApprover.length === 1 ? 's' : ''} an approver` : 'promotes on its own' }] : [])
		],
		live: `${dur(NOW.getTime() - t(y.since))} so far`,
		next: 'next',
		preview: {
			action: `${y.ref} arrives`,
			rows: group([
				{ place: `${here.env} (deploying)`, before: historyAt(y.app, here.env)[1]?.sha ?? '', beforeTone: 'neutral' as const, after: y.ref },
				...ahead.map((e) => ({ place: e.label, before: (e.version ?? '').slice(0, 7), beforeTone: 'neutral' as const, after: needApprover.includes(e.label) ? `${y.ref} · approver` : y.ref }))
			]),
			rest: null,
			foot: `Reaches ${a.envs.length} places; ${needApprover.length ? `${needApprover.join(' and ')} wait for an approver, the rest promote on their own` : 'every step promotes on its own'}.`
		}
	};
}

export function clock(iso: string | null) {
	return iso ? new Date(iso).toISOString().slice(11, 16) : '';
}

export function buildView(m: HomeModel, state: HomeState): HomeView {
	const h = buildSketch(m, viewerLogin());
	const approvalsAll = h.elsewhere.filter((e) => e.canAct).map((e) => approvalOf(m, e));
	const failed = h.yours.filter((y) => y.state === 'failed');
	const prodFail = failed
		.filter((y) => y.stops.some((s) => s.here && s.prod))
		.sort((x, y) => newestFirst(x.since, y.since));
	let lead: Lead | null = null;
	let leadChange: YourChange | null = null;
	let leadApproval: Approval | null = null;
	if (prodFail.length || failed.length) {
		leadChange = prodFail[0] ?? failed[0];
		lead = failingLead(m, leadChange);
	} else if (approvalsAll.length) {
		leadApproval = approvalsAll[0];
		lead = approvalLead(m, leadApproval);
	} else {
		const mv = h.yours.filter((y) => y.state === 'deploying' || y.state === 'checking').sort((x, y) => newestFirst(x.since, y.since));
		if (mv.length) {
			leadChange = mv[0];
			lead = movingLead(m, leadChange);
		}
	}

	const failures: Fail[] = failed.filter((y) => y !== leadChange).map((y) => ({ ...y, place: y.where.length > 1 ? `${y.where.length} places` : y.where[0], action: { label: `Roll back ${y.where[0]}`, href: y.action?.href ?? y.href } }));
	const approvals = approvalsAll.filter((x) => x !== leadApproval);
	const rest = h.yours.filter((y) => y.state !== 'failed' && y !== leadChange);
	const moving: Moving[] = rest
		.filter((y) => y.state === 'deploying' || y.state === 'checking')
		.map((y) => ({ ...y, reached: y.stops.filter((s) => s.state === 'healthy' || s.state === 'superseded' || s.state === 'checking').length, total: y.stops.length }));
	const waiting = rest.filter((y) => y.state === 'awaiting-approval');
	const held = rest.filter((y) => y.state === 'held-by-rule');

	const signals = h.elsewhere.filter((e) => e.kind === 'flapping').map((e) => ({ key: e.key, app: e.app, whose: e.whose, text: e.status.replace(/^Check flapping in (\S+): /, 'Check flapping in $1: '), since: e.since, href: e.href }));
	const notYours: NotYours[] = h.elsewhere
		.filter((e) => !e.canAct && e.kind !== 'flapping')
		.map((e) => {
			const ref = e.change?.ref ?? null;
			const flapping = e.kind === 'flapping';
			return {
				key: e.key,
				app: e.app,
				ref: flapping ? null : ref,
				title: flapping ? null : (e.change?.title ?? null),
				whose: flapping ? e.whose : (authorOf(e.app, ref) ?? e.whose),
				status: flapping ? e.status.replace(/^Check flapping in (\S+): /, 'Check flapping in $1 · ') : e.status,
				since: e.since,
				href: e.href,
				flapping
			};
		});

	// production: count places; name the failing ones and say whose they are
	const failingProd: Production['failing'] = [];
	let total = 0;
	let heldN = 0;
	let movingN = 0;
	for (const a of m.apps)
		for (const e of a.envs) {
			if (!(e.isProdRegion || e.tier === 'prod')) continue;
			total++;
			if (e.state === 'failed') {
				const mine = h.yours.find((y) => y.app === a.app && y.where.includes(e.env) && y.state === 'failed');
				failingProd.push({ app: a.app, env: e.env, whose: mine ? 'you' : ownerOf(a.app, viewerLogin()), ref: mine?.ref ?? null, href: e.href });
			} else if (e.state === 'held-by-rule' || e.state === 'awaiting-approval') heldN++;
			else if (e.state === 'deploying' || e.state === 'checking') movingN++;
		}
	void isProd;
	return {
		lead,
		failures,
		approvals,
		moving,
		waiting,
		held,
		yoursTotal: rest.length,
		notYours,
		prod: { total, failing: failingProd, held: heldN, moving: movingN, rolledBack: h.rolledBack, signals }
	};
}

const PRS = (): { repo: string; number?: number; author: string }[] => source().changes as unknown as { repo: string; number?: number; author: string }[];
function authorOf(app: string, ref: string | null): string | null {
	if (!ref) return null;
	const n = Number(ref.replace('#', ''));
	const c = PRS().find((x) => app.startsWith(x.repo) && x.number === n);
	return c ? (c.author === viewerLogin() ? 'you' : c.author) : null;
}
