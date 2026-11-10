/**
 * Home "lumen" (lab round 20/21): your changes as flights in progress, on top
 * of `tarn-model.ts`'s sections. Lifted from the lab's
 * `lumen/lumen-model.ts`; the starred set now comes from the caller.
 *
 * - Every change of yours that is not live in every env it is headed to is a
 *   `Flight`: where it is now (env/region + state word + time in state) and
 *   the next step in words, derived from the model alone (pipeline step,
 *   bake, held cause, the env ahead of it). When the data cannot say, the
 *   state is written and no ETA is invented.
 * - Finished changes (in prod, nothing stopped) fold per app (`live`).
 *
 * Unfinished = the change's furthest position (the ledger) is not a healthy
 * or superseded prod region.
 */
import { formatTimeAgoCompact } from '$lib/utils';
import * as msg from '$lib/paraglide/messages';
import { holdPhrase } from '../home-model';
import {
	ledger,
	kindOf,
	needs as tarnNeeds,
	rows as tarnRows,
	totals as tarnTotals,
	watch as tarnWatch,
	rolling as tarnRolling,
	quiet as tarnQuiet,
	place,
	checkName,
	failedSince,
	type HomeModel,
	type Kind,
	type AppModel,
	type Watch
} from './tarn-model';

export type Tier = 'dev' | 'test' | 'staging' | 'prod';
export const TIERS: Tier[] = ['dev', 'test', 'staging', 'prod'];

export type Flight = {
	ref: string;
	title: string;
	href: string;
	app: string;
	tier: Tier;
	kind: Kind;
	/** `dev`, `staging`, `prod us-east` */
	where: string;
	/** `deploying`, `in bake`, `held`, `stuck`, `rolled back` … */
	word: string;
	/** time in this state, compact (`2m`, `4h`); '' when the data has none */
	age: string;
	/** what the row prints for the age: `held 4h` for a stuck change, else `age` */
	ageLabel: string;
	/** the next step in words */
	next: string;
	/** carried in full by Needs you; drawn here as one tier-3 line */
	inNeeds: boolean;
	/** r21 decision 3: held longer than an hour reads as stuck, at full weight */
	stuck: boolean;
	/** a quiet link for a change that waits on someone or something (decisions 2, 3) */
	link: { label: string; href: string } | null;
};

export type LiveChange = { ref: string; title: string; href: string; where: string; since: string };
export type AppFlights = {
	app: string;
	/** the app's own page, finished (`AppModel.href`) */
	appHref: string;
	flights: Flight[];
	live: LiveChange[];
	rank: number;
	/** The app's Watch facts that none of your rows carry (someone else's
	 *  rollback, a hold on someone else's build), in Watch's order. An app in
	 *  Your changes is not repeated in Watch, so these would otherwise vanish. */
	others: Watch[];
};

/**
 * The Watch lines about `a` that no row of yours already carries (tl ruling
 * 2026-10-25, fix3 Q1): a failure is carried when your change fails there
 * (Needs you owns it), a rollback when your change was rolled back there, a
 * hold when your change is held there; a held line keeps only the places no
 * change of yours is held at. Approvals stay off Home (decision 4).
 */
export function othersOf(m: HomeModel, a: AppModel, now: Date): Watch[] {
	const envAt = (pl: string) => a.envs.find((e) => place(e) === pl);
	const mineIs = (pl: string, s: string) => !!envAt(pl)?.myChanges.some((c) => c.state === s);
	const out: Watch[] = [];
	for (const w of tarnWatch(m, now, new Set())) {
		if (w.app !== a.app || w.kind === 'approval') continue;
		if (w.facts.kind === 'held') {
			const keep = w.places.filter((pl) => !mineIs(pl, 'held-by-rule'));
			if (!keep.length) continue;
			if (keep.length === w.places.length) out.push(w);
			else {
				// re-aged from the kept places' own hold start (the longest-held), not the deploy
				// time of the build there nor the app's figure, which may date a dropped place
				const first = envAt(keep[0]);
				const starts = keep
					.map((pl) => envAt(pl)?.heldSince)
					.filter((t): t is string => !!t)
					.map((t) => Date.parse(t));
				const since = starts.length ? Math.min(...starts) : null;
				out.push({
					...w,
					places: keep,
					place: keep.join(msg.home_m_list_sep()),
					href: first?.href ?? w.href,
					age: since != null ? ago(new Date(since).toISOString(), now) : '',
					ageMs: since != null ? now.getTime() - since : 0
				});
			}
			continue;
		}
		if (w.facts.kind === 'rolled-back' && mineIs(w.place, 'rolled-back')) continue;
		if (w.kind === 'failed' && mineIs(w.place, 'failed')) continue;
		out.push(w);
	}
	return out;
}

const ago = (iso: string | null | undefined, now: Date) =>
	iso ? formatTimeAgoCompact(iso, now) : '';
const tierOf = (t: string): Tier => (t === 'dev' || t === 'test' || t === 'staging' ? t : 'prod');
const whereOf = place;

function heldPhrase(m: HomeModel, a: AppModel, env: { env: string; label: string }) {
	const ny = m.fleet.needsYou.find(
		(x) => x.app === a.app && (x.env === env.env || x.env.endsWith(env.label))
	);
	if (!ny) return msg.home_m_waits_on_rule();
	// a check hold names its check when the data has it (`waits on integration-tests`).
	// `home_m_hold_check_named` reads the same as `home_m_hold_on_named` in English and stays a
	// separate key on purpose: its {name} is a LIST of check names, the other's one service, so
	// a translation needs a different noun, number or case for each.
	if (ny.facts.reason === 'check' && ny.facts.checks?.length)
		return msg.home_m_hold_check_named({ name: checkNames(a.app, ny.facts.checks) });
	// a dependency hold names its provider, as a held change of yours does (`c.waitsOn`)
	if (ny.facts.reason === 'dependency' && ny.facts.provider)
		return msg.home_m_hold_on_named({ name: ny.facts.provider });
	return holdPhrase(ny.facts.reason);
}

/** Check names as Home prints them: each without the app's own prefix, joined. */
export const checkNames = (app: string, checks: readonly string[]) =>
	checks.map((c) => checkName(app, c)).join(msg.home_m_list_sep());

/**
 * The page with round 21's content decisions applied on top of tarn:
 * 1. Needs you holds only what YOU can act on for YOUR changes: your failing
 *    changes (Roll back). A failing starred app with none of your changes is
 *    a Watch line.
 * 2. Your own change waiting for approval is not yours to approve: it stays in
 *    Your changes (`waits for a reviewer`), never in Needs you.
 * 4. Other teams' approvals are not on Home (not in Watch, not in the status line).
 * 5. The status line is fleet health only.
 */
export function page(m: HomeModel, now: Date, starred: ReadonlySet<string>) {
	const ny = tarnNeeds(m, now, starred).filter((n) => n.kind === 'failed' && n.why !== 'starred');
	const rs = tarnRows(m, now);
	const above = new Set([...ny.map((x) => x.app), ...rs.map((x) => x.app)]);
	const w = tarnWatch(m, now, above).filter((x) => x.kind !== 'approval');
	const aboveW = new Set([...above, ...w.map((x) => x.app)]);
	const ro = tarnRolling(m, now, aboveW, starred);
	const q = tarnQuiet(m, new Set([...aboveW, ...ro.map((x) => x.app)]), starred);
	let failing = 0;
	for (const a of m.apps) for (const e of a.envs) if (e.state === 'failed') failing++;
	const status = {
		failing,
		healthy: m.fleet.prodHealthy.healthy,
		total: m.fleet.prodHealthy.total
	};
	return { status, needs: ny, rows: rs, totals: tarnTotals(m), watch: w, rolling: ro, quiet: q };
}

/** Hours from `iso` to `now`, null when there is no instant. */
const hoursSince = (iso: string | null | undefined, now: Date) =>
	iso ? (now.getTime() - Date.parse(iso)) / 3.6e6 : null;

/**
 * The gate fact at the place after `idx` in the app's promotion order: that one env, or, when it
 * is a prod region, every prod region after `idx` (Home names prod as one place). `'approval'`
 * when a person's approval gate holds a build there, `'held'` when a rule holds one, else null.
 * Envs further ahead are never consulted: their gates do not hold a change at the next env.
 */
export function gateAhead(a: AppModel, idx: number): 'approval' | 'held' | null {
	const next = a.envs[idx + 1];
	if (!next) return null;
	const place = next.isProdRegion ? a.envs.slice(idx + 1).filter((y) => y.isProdRegion) : [next];
	if (place.some((y) => y.state === 'awaiting-approval')) return 'approval';
	if (place.some((y) => y.state === 'held-by-rule')) return 'held';
	return null;
}

export function flights(m: HomeModel, now: Date, starred: ReadonlySet<string>) {
	const p = page(m, now, starred);
	const needRefs = new Set(
		p.needs.map((n) => (n.why === 'starred' ? '' : `${n.app}|${n.why.ref}`))
	);
	const out: AppFlights[] = [];
	for (const row of p.rows) {
		const a = m.apps.find((x) => x.app === row.app)!;
		const mine = ledger(a, now);
		const fl: Flight[] = [];
		const live: LiveChange[] = [];
		for (const x of mine) {
			const e = x.env;
			const c = e.myChanges.find((y) => y.ref === x.ref)!;
			if (e.isProdRegion && (x.state === 'healthy' || x.state === 'superseded')) {
				live.push({ ref: x.ref, title: x.title, href: x.href, where: whereOf(e), since: x.time });
				continue;
			}
			// the env ahead of this one in the app's own promotion order (prod regions are a set: "prod")
			const ahead = a.envs.slice(x.idx + 1);
			const nextEnv = ahead[0];
			const nextName = nextEnv ? (nextEnv.isProdRegion ? msg.home_m_prod() : nextEnv.label) : '';
			// What the NEXT place's gates say, and nothing further ahead: a gate two envs on does not
			// hold this change at the next one. The next place is one env, or the prod regions as one
			// set. An approval gate admits builds a person approved, one by one, so the change needs
			// approval there; it does not queue behind another change's approval. A hold (dependency
			// or check) refuses builds there now. No gate: the next env takes the build once it is
			// out of this env (its bake Succeeded), which is all a promotion gate waits for.
			const nextGate = gateAhead(a, x.idx);
			const gateClause = (base: string) =>
				nextGate === 'approval'
					? msg.home_m_gate_needs_approval({ what: base })
					: nextGate === 'held'
						? msg.home_m_gate_env_held({ what: base, env: nextName })
						: base;
			let word = '';
			let where = whereOf(e);
			let age = ago(c.since, now);
			let next = '';
			let stuck = false;
			let link: Flight['link'] = null;
			const pl = e.pipeline;
			switch (x.state) {
				case 'deploying': {
					word = msg.home_m_word_deploying();
					const step =
						pl?.activeStep && !pl.isFallback
							? msg.home_m_step({ index: pl.activeStep.index, total: pl.activeStep.total })
							: '';
					const bake = !!pl && pl.bake === 'pending';
					const what =
						bake && nextName
							? gateClause(msg.home_m_bake_then({ env: nextName }))
							: bake
								? msg.home_m_bake()
								: nextName
									? gateClause(msg.home_m_then({ env: nextName }))
									: msg.home_m_settle();
					next = [step, msg.home_m_next({ what })].filter(Boolean).join(' · ');
					break;
				}
				case 'checking': {
					word = pl?.bake === 'active' ? msg.home_m_word_in_bake() : msg.home_m_word_checking();
					const left =
						c.checkingMinutesLeft != null
							? ` · ${msg.home_m_minutes_left({ n: c.checkingMinutesLeft })}`
							: '';
					next =
						(nextName
							? msg.home_m_next({ what: gateClause(msg.home_m_env_after_bake({ env: nextName })) })
							: msg.home_m_next_live_after_bake()) + left;
					break;
				}
				case 'held-by-rule': {
					// held by a rule: no remedy on Home, but past an hour it is the developer's real blocker.
					// The age is this change's own time held (`EnvChange.since`); when the model cannot date
					// it, no age and no "stuck" — never the app's figure (someone else's hold) nor the
					// place's own arrival (the build running there, not this change).
					const h = hoursSince(c.since, now);
					stuck = h != null && h >= 1;
					word = stuck ? msg.home_m_word_stuck() : msg.home_m_word_held();
					// every prod region holding this same change, named once (`prod ap-southeast-2, us-east-2`)
					const regions = e.isProdRegion
						? a.envs.filter(
								(y) =>
									y.isProdRegion &&
									y.myChanges.some((z) => z.ref === x.ref && z.state === 'held-by-rule')
							)
						: [e];
					if (regions.length > 1)
						where = msg.home_m_place_prod({
							region: regions.map((y) => y.label).join(msg.home_m_list_sep())
						});
					// the link opens the first place named, on its Gates tab when a dependency holds it
					const at = regions[0] ?? e;
					const atChange = at.myChanges.find((z) => z.ref === x.ref) ?? c;
					// one provider service ({name}); see `heldPhrase` for why the check key stays separate
					next = c.waitsOn ? msg.home_m_hold_on_named({ name: c.waitsOn }) : heldPhrase(m, a, e);
					link = c.waitsOn
						? { label: msg.home_m_link_open_dependency(), href: atChange.waitsOnHref ?? at.href }
						: { label: msg.home_m_link_open_check(), href: e.href };
					break;
				}
				case 'awaiting-approval': {
					// your own change: you cannot approve it (decision 2)
					word = msg.home_m_word_waits_reviewer();
					// every prod region waiting to approve this same change, named once, as a held
					// change's regions are (`prod us-east, us-west`)
					const regions = e.isProdRegion
						? a.envs.filter(
								(y) =>
									y.isProdRegion &&
									y.myChanges.some((z) => z.ref === x.ref && z.state === 'awaiting-approval')
							)
						: [e];
					if (regions.length > 1)
						where = msg.home_m_place_prod({
							region: regions.map((y) => y.label).join(msg.home_m_list_sep())
						});
					// this change's own wait (`EnvChange.since`), not the arrival of the build running
					// there; across regions, the longest wait
					const waits = regions
						.map((y) => y.myChanges.find((z) => z.ref === x.ref)?.since)
						.filter((t): t is string => !!t)
						.sort((p, q) => Date.parse(p) - Date.parse(q));
					age = ago(waits[0] ?? c.since, now);
					next = msg.home_m_next_deploys_once_approved({
						env: (regions.length ? regions : [e]).map((y) => y.label).join(msg.home_m_list_sep())
					});
					// the link opens the first place named
					link = { label: msg.home_m_link_open_approval(), href: (regions[0] ?? e).href };
					break;
				}
				case 'failed':
					word = msg.home_m_word_failing();
					// the same instant Needs you prints for this place
					age = ago(failedSince(m, a, e), now);
					next = msg.home_m_stopped_failed_check();
					break;
				case 'rolled-back':
					word = msg.home_m_word_rolled_back();
					// the build running there now carries this change again: not gone
					next =
						c.liveAgain && x.nowRuns
							? msg.home_m_back_in_with({ env: e.label, ref: x.nowRuns })
							: x.nowRuns
								? msg.home_m_now_runs({ env: e.label, ref: x.nowRuns })
								: msg.home_m_rolled_back_there();
					break;
				default: {
					// healthy / superseded before prod: it has passed here and waits for the next promotion
					word = msg.home_m_word_passed();
					age = ago(c.since ?? e.arrivedAt, now);
					// Only the next place's gate facts decide what is next. A newer build baking
					// or deploying here is not one: neither controller makes the next env wait
					// for this env's current bake. A promotion gate admits every build whose bake
					// here Succeeded, this one included.
					next = nextName ? msg.home_m_next({ what: gateClause(nextName) }) : '';
				}
			}
			fl.push({
				ref: x.ref,
				title: x.title,
				href: x.href,
				app: a.app,
				tier: tierOf(e.tier),
				kind: kindOf(x.state),
				where,
				word,
				age,
				ageLabel: stuck && age ? msg.home_m_held_for({ age }) : age,
				next,
				inNeeds: needRefs.has(`${a.app}|${x.ref}`),
				stuck,
				link
			});
		}
		const ti = (f: Flight) => TIERS.indexOf(f.tier);
		// what waits on someone or something reads first, then the furthest along
		const blocked = (f: Flight) =>
			f.stuck || f.kind === 'approval' || f.kind === 'failed' ? 0 : 1;
		fl.sort(
			(u, v) =>
				blocked(u) - blocked(v) ||
				ti(v) - ti(u) ||
				v.ref.localeCompare(u.ref, undefined, { numeric: true })
		);
		out.push({
			app: a.app,
			appHref: a.href,
			flights: fl,
			live,
			rank: row.rank,
			others: othersOf(m, a, now)
		});
	}
	const busy = out.filter((x) => x.flights.length);
	const allLive = out.filter((x) => !x.flights.length);
	// header totals in words that add up: each change once (a change shipped to two apps counts once)
	const keys = new Map<string, boolean>();
	for (const g of out) {
		for (const f of g.flights) keys.set(f.ref, true);
		for (const l of g.live) if (!keys.has(l.ref)) keys.set(l.ref, false);
	}
	const inFlight = [...keys.values()].filter(Boolean).length;
	const totals = { changes: keys.size, inFlight, live: keys.size - inFlight };
	return { ...p, busy, allLive, totals: { ...p.totals, ...totals } };
}
