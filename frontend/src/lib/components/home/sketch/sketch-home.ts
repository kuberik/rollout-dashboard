/**
 * r28 sketch — one derivation for every version. Reads the real HomeModel (pinned home-incident
 * fixture) and answers the page's questions: what leads, your changes in flight, what needs
 * attention elsewhere (with whose it is), what was rolled back, environment health, in motion.
 * `calm` drops failures (and their rolled-back echoes) so the calm state can be shot too.
 */
import { oldestFirst, newestFirst } from '$lib/instant';
import type { AppEnv, AppModel, EnvState, HomeModel } from '$lib/view-models/home-model';
import fixture from '$lib/view-models/home/fixtures/incident-input.json';
import { liveSource } from './fleet-source.svelte';
import { formatTransitionAt } from '$lib/api/schedules';

export type Tone = 'danger' | 'held' | 'active' | 'progress' | 'success' | 'neutral';
export type Stop = { label: string; tier: string; state: EnvState; prod: boolean; here: boolean; since: string | null; prev: string | null };

export type YourChange = {
	key: string;
	ref: string;
	title: string;
	href: string;
	app: string;
	appHref: string;
	state: EnvState;
	/** places where the change sits in `state` */
	where: string[];
	/** the sentence: "Failing in prod", "Waits for approval in 2 prod regions" */
	status: string;
	next: string | null;
	since: string | null;
	tone: Tone;
	stops: Stop[];
	action: { label: string; href: string } | null;
	/** the failing check's own sentence at the lead place, when one is failing */
	evidence: string | null;
	mergedAt: string | null;
	/** the build the lead place returns to on Roll back (another of the place's entries, healthy/superseded) */
	rollbackTo: string | null;
};

/** The ONE wording of the ask a rule hold leaves with the approval. A window is named as the deploy window (never by its gate's name), with its opening time when the schedule is joined (`opensAt`, as `windowCause` prints it); promotion order says so; any other hold is named and will not clear by itself. */
export const alsoApprovalAsk = (a: { other: string; persistent: boolean; kind?: 'window' | 'order' | 'hold' }, opensAt: string | null = null): string => {
	const kind = a.kind ?? (a.persistent ? 'hold' : 'window');
	if (kind === 'window') return `Approve now; it deploys when the deploy window opens${opensAt ? ` ${formatTransitionAt(opensAt)}` : ''}`;
	if (kind === 'order') return 'Approve now; it deploys when promotion order allows it';
	return `Approving won't deploy until ${a.other} clears`;
};
export type Elsewhere = {
	/** the other hold an approval ask names (`alsoApprovalAsk`); null for a plain approval */
	ask?: string | null;
	key: string;
	app: string;
	href: string;
	whose: string;
	kind: 'approval' | 'held' | 'flapping' | 'failing' | 'dependency';
	status: string;
	since: string | null;
	tone: Tone;
	canAct: boolean;
	action: { label: string; href: string } | null;
	/** the newest change on this app (approvals: what you would approve) */
	change: { ref: string; title: string } | null;
};

export type RolledBack = { key: string; app: string; env: string; ref: string | null; href: string; note: string };
export type TierHealth = { tier: string; total: number; healthy: number; failing: number; held: number; moving: number };
export type Motion = { key: string; app: string; env: string; state: EnvState; since: string | null; href: string; step: string | null };

export type SketchHome = {
	me: string;
	lead: YourChange | null;
	leadReason: string;
	yours: YourChange[];
	elsewhere: Elsewhere[];
	rolledBack: RolledBack[];
	tiers: TierHealth[];
	motion: Motion[];
	counts: { yoursNeedYou: number; approvals: number; yoursInFlight: number; elsewhere: number };
	prod: { healthy: number; total: number };
};

const RANK: Record<EnvState, number> = {
	failed: 0,
	'awaiting-approval': 1,
	'held-by-rule': 2,
	deploying: 3,
	checking: 4,
	'rolled-back': 5,
	'not-deployed': 6,
	healthy: 7,
	superseded: 8
};

export const toneOf = (s: EnvState): Tone =>
	s === 'failed'
		? 'danger'
		: s === 'awaiting-approval'
			? 'held'
			: s === 'held-by-rule'
				? 'neutral'
			: s === 'deploying'
				? 'active'
				: s === 'checking'
					? 'active'
					: s === 'healthy'
						? 'success'
						: 'neutral';

const VERB: Partial<Record<EnvState, string>> = {
	failed: 'Failing in',
	'awaiting-approval': 'Waits for approval in',
	'held-by-rule': 'Held in',
	deploying: 'Deploying to',
	checking: 'Checking in'
};

function placeList(envs: AppEnv[]): string {
	if (envs.length === 1) return envs[0].env;
	const prod = envs.filter((e) => e.isProdRegion);
	if (prod.length === envs.length) return `${prod.length} prod regions`;
	return `${envs.length} places`;
}

type ChLite = { repo: string; author: string; title: string; htmlUrl: string };
const lite = new WeakMap<object, { owners: Map<string, string>; newest: Map<string, { ref: string; title: string }> }>();
/** owners and newest change per repo, from the live changes (the pinned fixture's when nothing is installed) */
function index() {
	const list = (liveSource()?.changes ?? (fixture as { changes: ChLite[] }).changes) as unknown as ChLite[];
	let ix = lite.get(list);
	if (ix) return ix;
	const owners = new Map<string, string>();
	const newest = new Map<string, { ref: string; title: string }>();
	for (const c of list) {
		if (!owners.has(c.repo)) owners.set(c.repo, c.author);
		const last = c.htmlUrl.split('/').pop() ?? '';
		if (!newest.has(c.repo)) newest.set(c.repo, { ref: /^\d+$/.test(last) ? `#${last}` : last.slice(0, 7), title: c.title });
	}
	lite.set(list, (ix = { owners, newest }));
	return ix;
}
function changeOf(app: string) {
	for (const [repo, ch] of index().newest) if (app === repo || app.startsWith(repo)) return ch;
	return null;
}
export function ownerOf(app: string, me: string): string {
	const { owners } = index();
	for (const [repo, who] of owners) if (app === repo || app.startsWith(repo)) return who === me ? 'you' : who;
	if (app.startsWith('telemetry')) return owners.get('platform-telemetry') ?? 'platform';
	return 'unowned';
}

function calmState(s: EnvState): EnvState {
	return s === 'failed' || s === 'rolled-back' ? 'healthy' : s;
}

/**
 * A wave blocker that ended badly (`bake failed|cancelled on <rev>`) is a failure like any other, and calm
 * hides failures: it becomes Ready. Structural on purpose: the model field is owned by the view models, and
 * a place that carries no blocker passes through untouched.
 */
function calmEnv(e: AppEnv): AppEnv {
	const b = (e as { blocker?: { outcome?: string } | null }).blocker;
	if (!b || (b.outcome !== 'failed' && b.outcome !== 'cancelled')) return e;
	return { ...e, blocker: null, waveReady: true } as AppEnv;
}

/** quiet = calm + no approvals anywhere (nothing waits on a person). */
export function quietModel(m: HomeModel): HomeModel {
	const c = calmModel(m);
	const q = (s: EnvState): EnvState => (s === 'awaiting-approval' ? 'healthy' : s);
	return {
		...c,
		signals: c.signals.filter((s) => s.kind !== 'check-flapping'),
		apps: c.apps.map((a) => ({ ...a, envs: a.envs.map((e) => ({ ...e, state: q(e.state), myChanges: e.myChanges.map((x) => ({ ...x, state: q(x.state) })) })) }))
	};
}

export function calmModel(m: HomeModel): HomeModel {
	return {
		...m,
		signals: m.signals.filter((s) => s.kind !== 'check-failing'),
		apps: m.apps.map((a) => ({
			...a,
			envs: a.envs.map((e) => ({
				...calmEnv(e),
				state: calmState(e.state),
				myChanges: e.myChanges.map((c) => ({ ...c, state: calmState(c.state) }))
			}))
		}))
	};
}

function nextFor(a: AppModel, idx: number, state: EnvState): string | null {
	if (state === 'failed') return 'Roll back, or ship a fix';
	if (state === 'awaiting-approval') return 'Needs an approver';
	if (state === 'held-by-rule') return 'Waits on its gate';
	const after = a.envs[idx + 1];
	if (state === 'deploying' || state === 'checking') return after ? `Then ${after.isProdRegion ? 'prod' : after.env}` : 'Last stop';
	return null;
}

export function buildSketch(m: HomeModel, me: string): SketchHome {
	// ── your changes: one row per (app, change), at its most urgent place
	const yours: YourChange[] = [];
	for (const a of m.apps) {
		const refs = new Map<string, { title: string; href: string; hits: { e: AppEnv; i: number; s: EnvState; since: string | null }[] }>();
		a.envs.forEach((e, i) => {
			for (const c of e.myChanges) {
				const r = refs.get(c.ref) ?? { title: c.title, href: c.href, hits: [] };
				r.hits.push({ e, i, s: c.state, since: c.since });
				refs.set(c.ref, r);
			}
		});
		for (const [ref, r] of refs) {
			const active = r.hits.filter((h) => RANK[h.s] <= 4);
			if (!active.length) continue;
			const worst = Math.min(...active.map((h) => RANK[h.s]));
			const at = active.filter((h) => RANK[h.s] === worst);
			const s = at[0].s;
			const stops: Stop[] = a.envs.map((e) => {
				const mine = e.myChanges.find((c) => c.ref === ref);
				return {
					label: e.isProdRegion ? e.label : e.env,
					tier: e.tier,
					state: mine ? mine.state : 'not-deployed',
					prod: e.isProdRegion || e.tier === 'prod',
					here: at.some((h) => h.e === e),
					since: mine?.since ?? (mine && (mine.state === 'healthy' || mine.state === 'superseded') ? e.arrivedAt : null),
					prev: e.myChanges.find((c) => c.ref !== ref && (c.state === 'healthy' || c.state === 'superseded'))?.ref ?? (e.version ? e.version.slice(0, 7) : null)
				};
			});
			const lead = at[0].e;
			yours.push({
				key: `${a.app}/${ref}`,
				ref,
				title: r.title,
				href: r.href,
				app: a.app,
				appHref: a.href,
				state: s,
				where: at.map((h) => h.e.env),
				status: `${VERB[s] ?? ''} ${placeList(at.map((h) => h.e))}`.trim(),
				next: nextFor(a, at[0].i, s),
				since: at.map((h) => h.since).filter(Boolean).sort()[0] ?? null,
				tone: toneOf(s),
				stops,
				mergedAt: lead.myChanges.find((c) => c.ref === ref)?.mergedAt ?? null,
				rollbackTo: lead.myChanges.find((c) => c.ref !== ref && (c.state === 'healthy' || c.state === 'superseded'))?.ref ?? null,
				evidence: m.signals.find((g) => g.app === a.app && g.env === lead.env && g.kind === 'check-failing')?.phrase ?? null,
				action:
					s === 'failed'
						? { label: `Roll back ${lead.env}`, href: lead.href }
						: null
			});
		}
	}
	yours.sort((x, y) => RANK[x.state] - RANK[y.state] || newestFirst(x.since, y.since));

	// ── lead: your failing change in prod > approval you can give that blocks > your stuck change > most active
	const prodFail = yours.filter((y) => y.state === 'failed' && y.stops.some((s) => s.here && s.prod));
	const anyFail = yours.filter((y) => y.state === 'failed');
	let lead: YourChange | null = null;
	let leadReason = '';
	if (prodFail.length) {
		lead = prodFail.sort((x, y) => newestFirst(x.since, y.since))[0];
		leadReason = 'Your change is failing in production';
	} else if (anyFail.length) {
		lead = anyFail[0];
		leadReason = 'Your change is failing';
	} else {
		const moving =
			yours.find((y) => (y.state === 'deploying' || y.state === 'checking') && y.stops.some((s) => s.here && s.prod)) ??
			yours.find((y) => y.state === 'deploying' || y.state === 'checking') ??
			yours[0] ??
			null;
		lead = moving;
		leadReason = moving ? 'your change in motion' : '';
	}

	// ── elsewhere: not-yours apps needing someone
	/* a place is said by its display name (`eu-west`), never its raw environment (`prod-eu-west`) */
	const placeName = (e: { env: string; label: string; isProdRegion?: boolean }): string => (e.isProdRegion ? e.label : e.env);
	const elsewhere: Elsewhere[] = [];
	const myApps = new Set(yours.map((y) => y.app));
	for (const a of m.apps) {
		const whose = ownerOf(a.app, me);
		a.envs.forEach((e) => {
			/* covered by yours, except the ask: a place held by a rule that ALSO needs an approval keeps its approval entry, whoever's change it is (the yours row cannot carry the ask) */
			const own = e.myChanges.some((c) => RANK[c.state] <= 2);
			if (own && !(e.state === 'held-by-rule' && e.alsoApproval)) return;
			if (e.state === 'awaiting-approval' || e.state === 'held-by-rule' || e.state === 'failed') {
			/* a held place whose approval ALSO refuses the build keeps BOTH entries: the rule hold, and the ask (approving ahead is useful; the ask names the other hold) */
			for (const kind of (e.state === 'held-by-rule' && e.alsoApproval ? (own ? ['approval'] : ['held', 'approval']) : [e.state === 'awaiting-approval' ? 'approval' : e.state === 'failed' ? 'failing' : 'held']) as ('approval' | 'failing' | 'held')[]) {
				const ask = kind === 'approval' && e.state === 'held-by-rule' ? e.alsoApproval : null;
				const prev = elsewhere.find((x) => x.app === a.app && x.kind === kind);
				if (prev) {
					prev.status = `${VERB[kind === 'approval' ? 'awaiting-approval' : e.state]} ${prev.status.match(/(\d+) prod/) ? Number(prev.status.match(/(\d+) prod/)![1]) + 1 : 2} prod regions`;
					continue;
				}
				const need = m.fleet.needsYou.find((n) => n.app === a.app && n.env === e.env);
				elsewhere.push({
					key: `${a.app}@${e.env}`,
					app: a.app,
					href: e.href,
					whose: myApps.has(a.app) && whose === 'you' ? 'you' : whose,
					kind,
					status:
						ask ? `${VERB['awaiting-approval']} ${placeName(e)} · ${alsoApprovalAsk(ask, need?.facts.window?.opensAt ?? null).replace(/^\w/, (c) => c.toLowerCase())}`
						: kind === 'held' && need
							? `${need.phrase.replace(/^\w/, (c) => c.toUpperCase())} in ${placeName(e)}`
							: `${VERB[e.state]} ${placeName(e)}`,
					since: e.heldSince ?? e.arrivedAt,
					tone: toneOf(e.state),
					canAct: kind === 'approval',
					ask: ask ? alsoApprovalAsk(ask, need?.facts.window?.opensAt ?? null) : null,
					action: kind === 'approval' ? { label: 'Review', href: e.href } : null,
					change: changeOf(a.app)
				});
			}
			}
		});
	}
	for (const s of m.signals.filter((s) => s.kind === 'check-flapping')) {
		elsewhere.push({
			key: s.key,
			app: s.app,
			href: s.href,
			whose: ownerOf(s.app, me),
			kind: 'flapping',
			status: `Check flapping in ${s.env}: ${s.phrase}`,
			since: s.since,
			tone: 'neutral',
			canAct: false,
			action: null,
			change: null
		});
	}
	const ER = { failing: 0, approval: 1, held: 2, dependency: 2, flapping: 3 };
	elsewhere.sort((x, y) => ER[x.kind] - ER[y.kind] || oldestFirst(x.since, y.since));

	// ── rolled back
	const rolledBack: RolledBack[] = [];
	for (const a of m.apps)
		for (const e of a.envs) {
			const mine = e.myChanges.find((c) => c.state === 'rolled-back');
			if (e.state === 'rolled-back' || mine)
				rolledBack.push({
					key: `${a.app}@${e.env}`,
					app: a.app,
					env: e.env,
					ref: mine?.ref ?? null,
					href: e.href,
					note: mine ? (mine.liveAgain ? 'live again in a later build' : 'needs a follow-up fix') : 'rolled back to the previous build'
				});
		}

	// ── tiers + motion
	const tierMap = new Map<string, TierHealth>();
	const motion: Motion[] = [];
	for (const a of m.apps)
		for (const e of a.envs) {
			const t = tierMap.get(e.tier) ?? { tier: e.tier, total: 0, healthy: 0, failing: 0, held: 0, moving: 0 };
			t.total++;
			if (e.state === 'failed') t.failing++;
			else if (e.state === 'held-by-rule' || e.state === 'awaiting-approval') t.held++;
			else if (e.state === 'deploying' || e.state === 'checking') t.moving++;
			else t.healthy++;
			tierMap.set(e.tier, t);
			if (e.state === 'deploying' || e.state === 'checking')
				motion.push({
					key: `${a.app}@${e.env}`,
					app: a.app,
					env: e.env,
					state: e.state,
					since: e.arrivedAt,
					href: e.href,
					step: e.pipeline.activeStep ? `step ${e.pipeline.activeStep.index}/${e.pipeline.activeStep.total}` : null
				});
		}
	const order = ['dev', 'test', 'staging', 'prod'];
	const tiers = [...tierMap.values()].sort((x, y) => order.indexOf(x.tier) - order.indexOf(y.tier));
	const prodT = tierMap.get('prod');

	return {
		me,
		lead,
		leadReason,
		yours,
		elsewhere,
		rolledBack,
		tiers,
		motion,
		counts: {
			yoursNeedYou: yours.filter((y) => y.state === 'failed').length,
			approvals: elsewhere.filter((e) => e.canAct).length,
			yoursInFlight: yours.length,
			elsewhere: elsewhere.length
		},
		prod: { healthy: prodT ? prodT.total - prodT.failing : 0, total: prodT?.total ?? 0 }
	};
}
