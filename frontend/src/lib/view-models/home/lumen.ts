/**
 * THE HOME PAGE MODEL (lumen). One pure call from the home view-model to
 * everything the Home route draws, so the route derives nothing.
 *
 * `flights()` (lumen-model.ts) gives the sections; this adds what the lab's
 * `/lab/lumen` page computed in its own <script>: the landed (all-live) fold
 * and its groups, the lead app and the order of the rest, the flattened
 * flights for the lumen line, the Watch line's kind word and sub-text, the
 * starred flags, and the status/totals sentences.
 *
 * Starred apps come from the caller (`opts.starredApps`, the viewer's stars
 * store); the lab hard-coded two. An empty set means nothing is starred.
 */
import * as msg from '$lib/paraglide/messages';
import { href } from '$lib/paths';
import { holdPhrase, type HoldReason, type HomeModel } from '../home-model';
import { signalEvidence, bakeSpanText, type SignalFacts } from '../fleet-signals';
import {
	flights,
	checkNames,
	TIERS,
	type AppFlights as ModelAppFlights,
	type Flight,
	type Tier
} from './lumen-model';
import {
	checkName,
	type Kind,
	type Need,
	type Watch as TarnWatch,
	type Rolling as TarnRolling
} from './tarn-model';

export type { Flight, Tier, Kind, Need };
export type { WatchFacts } from './tarn-model';
export type { LiveChange } from './lumen-model';

/** How many Watch lines show before `+N more`. */
export const WATCH_SHOWN = 6;

export type LumenStatus = {
	/** fleet-wide envs failing right now */
	failing: number;
	healthy: number;
	total: number;
	/** `3 failing` ('' when nothing fails) */
	failingText: string;
	/** `35 of 37 prod healthy` */
	healthyText: string;
	/** the whole line: `3 failing · 35 of 37 prod healthy` */
	text: string;
};

export type LumenTotals = {
	/** your changes, each counted once (a change shipped to two apps counts once) */
	changes: number;
	/** of those, not yet live everywhere it is headed */
	inFlight: number;
	/** of those, live in prod */
	live: number;
	/** apps with your changes */
	apps: number;
	/** `16 changes · 10 in progress · 6 live` */
	text: string;
};

export type WatchLine = TarnWatch & {
	starred: boolean;
	/** the kind in words before the evidence: `failing`, `slow bake`, `held` … */
	kindWord: string;
	/** the evidence after the kind word, each part led by ` · ` (`' · error-rate check · 8m'`) */
	sub: string;
};

/** A Watch fact about an app of yours that none of your rows carry, worded as
 *  a Watch line and marked as not about your changes. */
export type OtherLine = WatchLine & { notYours: true };

/** One app of yours: its rows, its finished changes, and `others`. */
export type AppFlights = Omit<ModelAppFlights, 'others'> & { others: OtherLine[] };

export type RollingLine = TarnRolling & { starred: boolean };

export type QuietApp = {
	app: string;
	/** the app's own page, finished (`AppModel.href`) */
	appHref: string;
	starred: boolean;
};

/** A change that is live in prod on an all-live app, listed once. */
export type LandedChange = {
	ref: string;
	title: string;
	href: string;
	where: string;
	since: string;
	app: string;
};

/** All-live apps carrying the same changes are one entry (`billing-api + billing-worker 1`). */
export type LandedGroup = { key: string; apps: string[]; n: number };

export type LumenHome = {
	now: Date;
	tiers: Tier[];
	status: LumenStatus;
	/** decision 1: only your own failing changes */
	needs: Need[];
	/** apps with your changes still moving, in tarn's order (failed → waiting → moving) */
	busy: AppFlights[];
	/** apps whose changes of yours are all live */
	allLive: AppFlights[];
	totals: LumenTotals;
	/** every flight of `busy`, flattened (the lumen line) */
	allFlights: Flight[];
	/** the app with most of your work in flight leads when it has ≥ 3 flights not in Needs you */
	lead: AppFlights | null;
	/** the other busy apps: stuck first, then with flights, then stub-only (decision 3) */
	rest: AppFlights[];
	landed: LandedChange[];
	landedGroups: LandedGroup[];
	/** Watch, decision 4 applied (no other-team approvals) */
	watch: WatchLine[];
	watchShown: WatchLine[];
	/** lines beyond `WATCH_SHOWN` */
	watchMore: number;
	/** where the Watch section's "more" link goes (the activity page), finished */
	watchMoreHref: string;
	rolling: RollingLine[];
	quiet: QuietApp[];
};

export type LumenOptions = {
	/** the viewer's starred apps; omitted or empty = nothing starred */
	starredApps?: ReadonlySet<string>;
};

const KIND_WORD: Record<Kind, () => string> = {
	done: msg.home_m_kind_done,
	deploying: msg.home_m_kind_deploying,
	checking: msg.home_m_kind_checking,
	held: msg.home_m_kind_held,
	approval: msg.home_m_kind_approval,
	failed: msg.home_m_kind_failed,
	rolledback: msg.home_m_kind_rolledback,
	pending: msg.home_m_kind_pending,
	slow: msg.home_m_kind_slow,
	flapping: msg.home_m_kind_flapping,
	recovered: msg.home_m_kind_recovered,
	longwait: msg.home_m_kind_longwait
};

/** A hold in the Watch line's short form, after the kind word `held`: `on a dependency`, `is pinned`. */
function holdOn(r: HoldReason | null): string {
	switch (r) {
		case null:
		case 'rule':
			return msg.home_m_on_rule();
		case 'dependency':
			return msg.home_m_on_dependency();
		case 'order':
			return msg.home_m_on_order();
		case 'check':
			return msg.home_m_on_check();
		default:
			return holdPhrase(r);
	}
}

/** A signal's evidence as the Watch line prints it after its kind word. */
function signalSub(app: string, f: SignalFacts): string {
	switch (f.kind) {
		case 'check-failing':
			return f.check
				? msg.home_m_check_name({ name: checkName(app, f.check) })
				: msg.home_m_health_check();
		case 'slow-bake':
			return msg.home_m_span_set_to({ span: bakeSpanText(f.spanMs), set: bakeSpanText(f.bakeTimeMs) });
		default:
			return signalEvidence(f);
	}
}

/** The Watch line's sub-text after its kind word (the lab page's `wsub`), worded from `w.facts`. */
export function watchSub(w: TarnWatch): string {
	const f = w.facts;
	let ev: string;
	switch (f.kind) {
		case 'rolled-back':
			ev = '';
			break;
		case 'held':
			ev =
				f.reason === 'check' && f.checks?.length
					? msg.home_m_on_check_named({ name: checkNames(w.app, f.checks) })
					: f.reason === 'dependency' && f.provider
						? msg.home_m_on_named({ name: f.provider })
						: holdOn(f.reason);
			break;
		case 'failed-env':
			ev = msg.home_m_evidence_failed_check();
			break;
		case 'approval':
			ev = msg.home_m_evidence_approval_elsewhere({ version: f.version });
			break;
		case 'signal':
			ev = f.signal ? signalSub(w.app, f.signal) : w.evidence;
			break;
	}
	const age = w.age ? (w.kind === 'rolledback' ? msg.home_m_ago({ age: w.age }) : w.age) : '';
	return [ev, age]
		.filter(Boolean)
		.map((x) => ` · ${x}`)
		.join('');
}

/** An app's own page; `AppModel.href` is the same path, built by the home model. */
const appPath = (app: string) => href(`/apps/${encodeURIComponent(app)}`);

export function buildLumenHome(model: HomeModel, now: Date, opts: LumenOptions = {}): LumenHome {
	const starred = opts.starredApps ?? new Set<string>();
	const appHrefOf = new Map(model.apps.map((a) => [a.app, a.href] as const));
	const p = flights(model, now, starred);
	const line = (w: TarnWatch): WatchLine => ({
		...w,
		starred: starred.has(w.app),
		kindWord: KIND_WORD[w.kind](),
		sub: watchSub(w)
	});
	const withOthers = (g: ModelAppFlights): AppFlights => ({
		...g,
		others: g.others.map((w) => ({ ...line(w), notYours: true as const }))
	});
	const busy = p.busy.map(withOthers);
	const allLive = p.allLive.map(withOthers);

	const failingText = p.status.failing ? msg.home_m_status_failing({ n: p.status.failing }) : '';
	const healthyText = msg.home_m_status_healthy({
		healthy: p.status.healthy,
		total: p.status.total
	});
	const status: LumenStatus = {
		...p.status,
		failingText,
		healthyText,
		text: [failingText, healthyText].filter(Boolean).join(' · ')
	};

	const t = p.totals;
	const totals: LumenTotals = {
		changes: t.changes,
		inFlight: t.inFlight,
		live: t.live,
		apps: t.apps,
		text:
			t.changes === 1
				? msg.home_m_totals_one({ inFlight: t.inFlight, live: t.live })
				: msg.home_m_totals({ changes: t.changes, inFlight: t.inFlight, live: t.live })
	};

	const allFlights = busy.flatMap((g) => g.flights);

	const seen = new Set<string>();
	const landed = allLive
		.flatMap((g) => g.live.map((l) => ({ ...l, app: g.app })))
		.filter((x) => (seen.has(x.ref) ? false : (seen.add(x.ref), true)));

	const groups = new Map<string, LandedGroup>();
	for (const g of allLive) {
		const key = g.live
			.map((l) => l.ref)
			.sort()
			.join(',');
		const e = groups.get(key) ?? { key, apps: [], n: g.live.length };
		e.apps.push(g.app);
		groups.set(key, e);
	}
	const landedGroups = [...groups.values()];

	const lead =
		busy[0] && busy[0].flights.filter((f) => !f.inNeeds).length >= 3 ? busy[0] : null;
	const weight = (g: AppFlights) =>
		g.flights.some((f) => f.stuck) ? 0 : g.flights.some((f) => !f.inNeeds) ? 1 : 2;
	const rest = (lead ? busy.slice(1) : busy).slice().sort((u, v) => weight(u) - weight(v));

	const watch: WatchLine[] = p.watch.map(line);

	return {
		now,
		tiers: TIERS,
		status,
		needs: p.needs,
		busy,
		allLive,
		totals,
		allFlights,
		lead,
		rest,
		landed,
		landedGroups,
		watch,
		watchShown: watch.slice(0, WATCH_SHOWN),
		watchMore: Math.max(0, watch.length - WATCH_SHOWN),
		watchMoreHref: href('/activity'),
		rolling: p.rolling.map((r) => ({ ...r, starred: starred.has(r.app) })),
		quiet: p.quiet.map((app) => ({
			app,
			appHref: appHrefOf.get(app) ?? appPath(app),
			starred: starred.has(app)
		}))
	};
}
