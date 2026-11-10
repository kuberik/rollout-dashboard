/**
 * r34 — Environments view-model: pure derivations over `environments(state)` from data.ts (never raw
 * roster-data). Holds what the page needs and data.ts does not yet export; each block below is marked
 * TODO(truth) and is replaced by the truth lane's `heldCauses` / `arrivals` / regionless-prod exports
 * when they land. Pure, so it is unit-testable.
 */
import { environments, rollouts, inbound as inboundOf, lastDeploy as lastDeployOf, lead as leadOf, fleetCounts, arrivals as arrivalsOf, heldCauses, failureReason, checkClock, waitingBuild, ago, ARRIVALS_WINDOW, TIERS, TIER_NAME, type HomeState, type TierKey, type HeldCause, type TRow } from './data';

import type { EnvState } from '$lib/view-models/home-model';
import { stateWord } from './state-words';
export type Env = ReturnType<typeof environments>;
export type TierRow = Env['tiers'][number];
export type RegionRow = Env['regions'][number];
export type Dot = { mark: Mark; title: string };
export type Mark = 'failed' | 'approval' | 'held' | 'deploying' | 'checking' | 'newest';

/** GlyphState (roster) -> the StatusMark state. Rest is the product's quiet 6px dot. */
export function markOf(g: string): Mark {
	return g === 'failed' ? 'failed' : g === 'approval' ? 'approval' : g === 'held' || g === 'waiting' ? 'held' : g === 'deploying' ? 'deploying' : g === 'checking' ? 'checking' : 'newest';
}

export type Cause = { key: string; tier: TierKey; title: string; releases: string; places: number; apps: string[]; href: string; rule: boolean };
/** The Gates tab of a rollout row's href (the hold's own page). */
export const gatesHref = (href: string) => (/\/gates$/.test(href) ? href : href.replace(/\/$/, '') + '/gates');
/** "Waiting on X" (data.ts) -> the product's "Waits on X" */
export const waitsWord = (cause: string) => cause.replace(/^Waiting /, 'Waits ');
const releasesOf = (cause: string) =>
	cause === 'Waiting for approval' ? 'Releases when someone approves'
	: cause.startsWith('Waiting on check') ? 'Releases when the check passes'
	: cause.startsWith('Waiting on a dependency') ? 'Releases when the dependency is healthy'
	: cause.startsWith('Waiting on ') ? `Releases when ${cause.slice(11)} is healthy`
	: cause === 'Pinned' ? 'Releases when it is unpinned'
	: cause === 'Waiting for the deploy window' ? 'Releases when the window opens'
	: 'Releases when the rule allows it';

/** One cause per (tier, hold cause) from data.ts heldCauses; places counted per region. */
function causesFrom(hc: HeldCause[]): Cause[] {
	const by = new Map<string, Cause>();
	for (const h of hc) for (const r of h.rows) {
		const id = `${r.tier}|${h.key}`;
		const c = by.get(id) ?? { key: h.key, tier: r.tier as TierKey, title: waitsWord(h.cause), releases: releasesOf(h.cause), places: 0, apps: [], href: gatesHref(r.href), rule: h.cause !== 'Waiting for approval' };
		c.places += Math.max(1, r.regions?.length ?? 1);
		if (!c.apps.includes(r.app)) c.apps.push(r.app);
		by.set(id, c);
	}
	return [...by.values()];
}

/** r34 v2-r6: THE edge sentence, shared by the canvas and /envs/<name> (text-compared): "4 arriving", else "2 apps next", else nothing. */
export function edgeLine(moving: number, next: number, held = 0): { n: number; word: string; text: string } | null {
	const app = (n: number) => (n === 1 ? 'app' : 'apps');
	/* EV6: a held edge says how many are held ("1 app in progress · 2 held"); the chip keeps the cause only */
	const tail = held ? ` · ${held} ${app(held)} held` : '';  /* EF13: the unit is said ("3 apps held"): the header counts PLACES ("4 places held") */
	/* r34 mix-environments: ONE word for a build on its way into an environment, on every page: "arriving" (the spine's pill, the list's track) */
	if (moving) return { n: moving, word: `arriving${tail}`, text: `${moving} arriving${tail}` };
	if (next) return { n: next, word: `${app(next)} next${tail}`, text: `${next} ${app(next)} next${tail}` };
	if (held) return { n: held, word: `${app(held)} held`, text: `${held} ${app(held)} held` };
	return null;
}
/** EV1 (envdetail-8): the edge tooltip groups each app under ITS OWN count: "2 apps in progress: a, b · 3 apps held: c, d, e". An app is listed once, in the first group it belongs to
 *  (in progress, else next, else held), so an in-progress app is never listed under "held". */
export function edgeTitle(moving: string[], next: string[], held: string[]): string {
	const app = (n: number) => (n === 1 ? 'app' : 'apps');
	const seen = new Set<string>();
	const take = (l: string[]) => l.filter((a) => (seen.has(a) ? false : (seen.add(a), true)));
	const m = take(moving), n = take(next), h = take(held);
	return [m.length && `${m.length} arriving: ${m.join(', ')}`, n.length && `${n.length} ${app(n.length)} next: ${n.join(', ')}`, h.length && `${h.length} ${app(h.length)} held: ${h.join(', ')}`].filter(Boolean).join(' · ');
}
/** r34 v2-r6: a tier tile's state line, shared by the canvas tile and /envs/<name>'s neighbour tiles: size in places + the worst ADVERSE fact only. */
export function tileWords(t: { places: number; failing: number }, k: { holds: number; approvals: number }): string {
	const adv = [t.failing && `${t.failing} failing`, k.holds && `${k.holds} held`, k.approvals && `${k.approvals} to approve`].filter(Boolean) as string[];
	return [`${t.places} ${t.places === 1 ? 'place' : 'places'}`, ...adv.slice(0, 1)].join(' · ');
}
/** envdetail-10 EX1: THE one place name = the rollout tab's environment label (rollout-view tabEnv): a production region is `prod-<region>`, the un-regioned base place `production`. Every chip, banner line, band cell and tooltip on both Environments pages says this. */
export const placeName = (region: string | null | undefined) => (!region || region === 'prod' || region === 'production' ? 'production' : region.startsWith('prod-') ? region : `prod-${region}`);
/** EX2: columns of the places' square grid: rows are EVEN and at most `cap` (19) wide. `avail` = the width the squares may use; pitch = dot + gap. */
export function dotCols(n: number, avail: number, dot: number, gap: number, cap = 19): number {
	const fit = Math.floor((avail + gap) / (dot + gap));
	if (n <= 0 || fit < 1) return 0;
	const rows = Math.ceil(n / Math.min(fit, cap));
	return Math.ceil(n / rows);
}
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export type RegionTile = { label: string; regionless: boolean; places: number; failing: number; waiting: number; holds: number; approvals: number; moving: number; worst: string; mark: Mark; href: string; envHref: string };
export type PlaceLike = { state: string };
/** F1: a rule hold (held-by-rule) is the amber mark; an approval wait is the neutral ring. Severity: failing, hold, moving, approval, rest. */
export function markOfPlaces(ps: PlaceLike[]): Mark {
	if (ps.some((p) => p.state === 'failed')) return 'failed';
	if (ps.some((p) => p.state === 'held-by-rule')) return 'held';
	if (ps.some((p) => p.state === 'deploying')) return 'deploying';
	if (ps.some((p) => p.state === 'checking')) return 'checking';
	if (ps.some((p) => p.state === 'awaiting-approval')) return 'approval';
	return 'newest';
}
const MSEV: Record<Mark, number> = { failed: 0, held: 1, deploying: 2, checking: 2, approval: 3, newest: 4 };

/** r34 truth-5 (lead ruling 2026-11-01): the unflip changes only what these pages DRAW (marks, dots, the in-progress partition); every COUNT of approvals is fleetCounts().places.approval (the tab's gate word), so a place that is checking AND gated counts under both facts.
 *  EG1 (envdetail-7): data.ts's environments()/rollouts() class a place the tab shows as approval-gated WHILE its own deploy is still checked as an approval wait
 *  (`stillChecking`). The tab's pill says CHECKING and the owner's rule is "follow the tab": on the Environments pages such a place is a CHECKING place (yellow dot,
 *  checking mark, an "in progress" count), never an approval square. ONE place undoes the flip for everything these pages draw: tiers, regions, dots, counts. */
export type Unflip = { hrefs: Set<string>; raw: Map<string, string>; places: number };
export function unflipOf(state: HomeState): Unflip {
	const R = rollouts(state);
	const ck = R.rows.filter((r) => r.stillChecking);
	return { hrefs: new Set(ck.map((r) => r.href)), raw: new Map(R.c.tiers.flatMap((t) => t.places).map((p) => [p.href, p.state as string])), places: ck.reduce((n, r) => n + r.regions.length, 0) };
}
type RegionShape = { places: { href: string; state: EnvState }[]; failing: number; waiting: number; moving: number; rest: number; worst: string };
export function unflipRegion<T extends RegionShape>(r: T, u: Unflip): T {
	const places = r.places.map((p) => (p.state === 'awaiting-approval' && u.hrefs.has(p.href) ? { ...p, state: (u.raw.get(p.href) === 'deploying' ? 'deploying' : 'checking') as EnvState } : p));
	const n = { failing: 0, waiting: 0, moving: 0, rest: 0 };
	for (const p of places) { if (p.state === 'failed') n.failing++; else if (p.state === 'awaiting-approval' || p.state === 'held-by-rule') n.waiting++; else if (p.state === 'deploying' || p.state === 'checking') n.moving++; else n.rest++; }
	return { ...r, ...n, places, worst: n.failing ? 'failed' : n.waiting ? 'waiting' : n.moving ? 'deploying' : 'rest' };
}

export function envsModel(state: HomeState) {
	const e0 = environments(state);
	const U = unflipOf(state);
	const e = { ...e0, regions: e0.regions.map((r) => unflipRegion(r, U)), regionless: e0.regionless ? unflipRegion(e0.regionless, U) : null };
	const flipOf = (t: { key: string; rows: { stillChecking: boolean; regions: unknown[] }[] }) => t.rows.filter((r) => r.stillChecking).reduce((n, r) => n + r.regions.length, 0);
	const byKey = new Map(e.tiers.map((t) => { const f = flipOf(t); return [t.key, f ? { ...t, moving: t.moving + f, waiting: t.waiting - f, counts: { ...t.counts, moving: t.counts.moving + f, waiting: t.counts.waiting - f } } : t] as const; }));
	const tiers = TIERS.map((k) => byKey.get(k)).filter((t): t is TierRow => !!t);
	const prod = byKey.get('prod') ?? null;
	const hc = heldCauses(state);
	const causes = causesFrom(hc);
	/* F5: a row says its cause in the rail's words */
	const causeByRow = new Map(hc.flatMap((h) => h.rows.map((r) => [r.key, waitsWord(h.cause)] as const)));
	const causesIn = (k: TierKey) => causes.filter((c) => c.tier === k).sort((a, b) => Number(b.rule) - Number(a.rule) || b.places - a.places);
	/* an edge INTO a tier: places deploying/checking into it, and what holds builds back there (primary cause first) */
	/* F2: EVERY tier has an incoming edge; Dev's comes from the builds stub. Label = the tier's moving count; sum = the header's. */
	const edges = tiers.map((t, i) => {
		const csAll = causesIn(t.key);
		/* H2/H4: "+N causes" counts the DISTINCT RULE causes on this edge beyond the one named; an approval wait is not a hold and is never counted */
		/* r34 v2-r6 (owner 2026-11-02): an edge carries NO build id (a build belongs to one app). It says, in APPS, what crosses it:
		   `moving` = apps with a place deploying/checking in this tier now; `next` = apps whose newest build runs upstream, is not here yet and
		   nothing holds (it arrives on its own); held/approval apps are said by the hanging chip (its cause), never twice on the line. */
		const appsOf = (g: string) => [...new Set(t.rows.filter((r) => r.group === g).map((r) => r.app))];
		const checkingApps = [...new Set(t.rows.filter((r) => r.stillChecking).map((r) => r.app))];
		const movingApps = [...new Set([...appsOf('moving'), ...checkingApps])];
		const heldApps = appsOf('held');
		const approvalApps = appsOf('approval').filter((a) => !checkingApps.includes(a));
		const inb = inboundOf(state, t.key);
		const nextApps = [...new Set(inb.filter((x) => !x.reason && !movingApps.includes(x.app) && !heldApps.includes(x.app) && !approvalApps.includes(x.app)).map((x) => x.app))];
		/* envdetail-9 EW5 (EV1): the label's held count and the tooltip's held list come from ONE list: an app already counted as in progress is never counted again as held */
		const heldOnly = heldApps.filter((a) => !movingApps.includes(a) && !nextApps.includes(a));
		/* envdetail-10 EX3: the hanging chip's causes come from the SAME held list as the label ("N apps held"): a cause whose apps are all in progress / next here is not a hold on this edge */
		const cs = csAll.filter((c) => c.apps.some((a) => (c.rule ? heldOnly : approvalApps).includes(a)));
		const rules = cs.filter((c) => c.rule);
		const line = edgeLine(movingApps.length, nextApps.length, heldOnly.length);
		return { from: i === 0 ? 'builds' : tiers[i - 1].key, to: t.key, arriving: t.moving, moving: movingApps.length, movingApps, next: nextApps.length, nextApps, heldApps: heldOnly, approvalApps, line, title: edgeTitle(movingApps, nextApps, heldOnly), causes: cs, primary: cs[0] ?? null, more: Math.max(0, rules.length - 1), rule: rules.length > 0 };
	});
	/* region tiles: the regions with something to say (failing, waiting, moving), regionless prod among them by severity; the rest fold */
	const tile = (r: { label: string; apps: number; failing: number; waiting: number; moving: number; worst: string; href: string; places: PlaceLike[] }, regionless: boolean): RegionTile => ({
		label: r.label, regionless, places: r.apps, failing: r.failing, waiting: r.waiting, moving: r.moving, worst: r.worst, href: r.href,
		holds: r.places.filter((p) => p.state === 'held-by-rule').length, approvals: r.places.filter((p) => p.state === 'awaiting-approval' || U.hrefs.has((p as unknown as { href: string }).href)).length, mark: markOfPlaces(r.places),
		envHref: regionless ? '/envs/prod' : `/envs/prod-${r.label}`
	});
	/* U1: the un-regioned base place ("production", /envs/prod) is NOT a region: it is `base`, drawn apart; `busy`/`rest` are regions only */
	const all = e.regions.map((r) => tile(r, false));
	const base: RegionTile | null = e.regionless ? tile(e.regionless, true) : null;
	/* F4: busy first (failing, hold, moving, approval), then the at-rest regions (folded in the canvas) */
	const bySev = (a: RegionTile, b: RegionTile) => MSEV[a.mark] - MSEV[b.mark] || b.failing - a.failing || b.holds - a.holds || b.moving - a.moving || b.approvals - a.approvals || a.label.localeCompare(b.label);
	const busy = all.filter((r) => r.mark !== 'newest').sort(bySev);
	const rest = all.filter((r) => r.mark === 'newest').sort(bySev);
	const restRegions = rest.length;
	/* the production tier tile opens its worst place's rollout (no Environment record is named `production`) */
	const PSEV: Record<string, number> = { failed: 0, 'held-by-rule': 1, deploying: 2, checking: 2, 'awaiting-approval': 3 };
	const worstProd = [...(prod?.placesList ?? [])].sort((a, b) => (PSEV[a.state] ?? 9) - (PSEV[b.state] ?? 9))[0] ?? null;
	/* F3: the production tile's fact line names the worst place as a fact with its time in state */
	const worstRow = worstProd ? (prod?.rows ?? []).find((r) => r.app === worstProd.app && r.href === worstProd.href) ?? null : null;
	/* r34 v2-r6: EVERY tile with something adverse names its apps on a second line, worst kind first (failing, held, to approve), the oldest first:
	   "invoice-api +1 · 9h". Builds never appear on a tile (a build belongs to one app). */
	const factOf = (t: TierRow) => {
		for (const [g, word] of [['failed', 'failing'], ['held', 'held'], ['approval', 'to approve']] as const) {
			/* ED1: the NEWEST failure leads everywhere (the page's banner primary, focus tile, first row); held and approval waits name the longest-waiting first */
			const rs = t.rows.filter((r) => r.group === g).sort((p, q) => g === 'failed' ? String(q.since ?? '').localeCompare(String(p.since ?? '')) : String(p.since ?? '~').localeCompare(String(q.since ?? '~')));
			const apps = [...new Map(rs.map((r) => [r.app, r])).values()];
			if (apps.length) return { app: apps[0].app, href: apps[0].href, word, since: apps[0].since ?? null, more: apps.length - 1, apps: apps.map((r) => r.app), count: null as string | null };
		}
		/* envdetail-10 EX4 (§6): a tier with nothing adverse but something moving says its state in WORD + app slot: "Deploying · 4 apps" / "Checking · payments-core" */
		const mv = t.rows.filter((r) => r.group === 'moving' || r.stillChecking);
		if (mv.length) {
			const apps = [...new Map(mv.map((r) => [r.app, r])).values()];
			/* envdetail-11 EV5: a tier with BOTH deploying and checking apps says the edge's word, "in progress" */
			const kindsMv = new Set(mv.map((r) => (r.state === 'deploying' ? 'deploying' : 'checking')));
			const word = kindsMv.size > 1 ? 'in progress' : kindsMv.has('deploying') ? 'deploying' : 'checking';
			return { app: apps[0].app, href: apps[0].href, word, since: apps[0].since ?? null, more: 0, apps: apps.map((r) => r.app), count: apps.length > 1 ? `${apps.length} apps` : null as string | null };
		}
		return null;
	};
	const tierFacts = new Map(tiers.map((t) => [t.key, factOf(t)]));
	const worstFact = prod ? tierFacts.get('prod') ?? null : null;
	/* per-tier counts split by kind: a rule hold is not an approval wait (F1) */
	/* M1: holds and approvals are the ROWS' regions (fleetCounts' unit), so a group rollup, the header and the rows say one number */
	const placesIn = (rows: { regions?: unknown[] }[]) => rows.reduce((n, r) => n + Math.max(1, r.regions?.length ?? 1), 0);
	const tierKinds = new Map(tiers.map((t) => [t.key, { holds: placesIn(t.rows.filter((r) => r.group === 'held')), approvals: placesIn(t.rows.filter((r) => r.group === 'approval')), mark: markOfPlaces(t.placesList) }]));
	/* the rail's Holding card: one line per cause, merged across tiers */
	const lines = new Map<string, { key: string; title: string; rule: boolean; releases: string; href: string; apps: string[]; places: number; tiers: { tier: TierKey; places: number }[] }>();
	for (const c of causes.filter((x) => x.rule)) {
		const l = lines.get(c.key) ?? { key: c.key, title: c.title, rule: c.rule, releases: c.releases, href: c.href, apps: [], places: 0, tiers: [] };
		l.places += c.places; l.tiers.push({ tier: c.tier, places: c.places });
		for (const a of c.apps) if (!l.apps.includes(a)) l.apps.push(a);
		lines.set(c.key, l);
	}
	const holdLines = [...lines.values()].sort((a, b) => Number(b.rule) - Number(a.rule) || b.places - a.places || a.title.localeCompare(b.title));
	const arrivals = arrivalsOf(state);
	/* r34 v2 dots: ONE per place in its state (the tab strip's `prod ●●●`); Production draws its REGIONS (18 = 18), the band below is the legend */
	const DOTWORD: Record<Mark, string> = { failed: 'Failing', held: 'Held', deploying: 'Deploying', checking: 'Checking', approval: stateWord('approval')!, newest: 'At rest' };
	const dotOf = (s: string): Mark => markOfPlaces([{ state: s }]);
	/* G1/G3: every dot has a title "place · state · app"; Production draws its base place first, then its REGIONS */
	/* r34 v2-r6 (COMP 9): a place the tab shows as approval-gated while its deploy is still checked is an approval square, as its row says */
	const stOf = (p: { state: string }, _t?: TierRow) => p.state; /* EG1: ONE state source = the place's own state (the flip is undone in unflipRegion/tiers above) */
	const tierDots = new Map<TierKey, Dot[]>(tiers.map((t) => [t.key, t.placesList.map((p) => { const mark = dotOf(stOf(p as never, t)); return { mark, title: `${t.key === 'prod' ? placeName(p.label) : p.label} · ${DOTWORD[mark]} · ${p.app}` }; })]));
	/* the tier in focus: most failing, then most holds + approvals; none when nothing is adverse (calm and quiet keep every title at 14) */
	const score = (t: TierRow) => { const k = tierKinds.get(t.key)!; return t.failing * 100 + k.holds * 10 + k.approvals; };
	const focusTier = [...tiers].sort((a, b) => score(b) - score(a))[0];
	const focus: TierKey | null = focusTier && score(focusTier) > 0 ? focusTier.key : null;
	/* the last deploy anywhere: the fleet activity stream's newest non-failed event (data.ts rollouts().activity); author is a login */
	/* M2: the fleet's newest deploy (data.ts lastDeploy): app · place · author · age, linking to THAT rollout's History */
	const ld = lastDeployOf(state);
	const lastDeploy = ld ? { href: ld.historyHref, login: ld.who, trigger: ld.trigger, automatic: ld.trigger === 'Automatic', mine: ld.viewerTriggered, at: ld.at, app: ld.app, where: ld.place } : null;
	const fc = fleetCounts(state);
	const failedApps = [...new Set((prod?.rows ?? []).filter((r) => r.group === 'failed').map((r) => r.app))];
	const failedAll = [...new Map(tiers.flatMap((t) => t.rows).filter((r) => r.group === 'failed').map((r) => [r.app, { app: r.app, href: r.href }])).values()];
	/* M1: the marks present anywhere (legend) come from the same counts as the rows */
	const present = new Set<Mark>();
	if (fc.places.failing) present.add('failed');
	if (fc.places.held) present.add('held');
	if (fc.places.approval > 0) present.add('approval');
	for (const t of tiers) for (const r of t.rows) { if (r.state === 'deploying') present.add('deploying'); if (r.state === 'checking' || r.stillChecking) present.add('checking'); }
	const sum = (f: (t: TierRow) => number) => tiers.reduce((n, t) => n + f(t), 0);
	const totals = { failing: sum((t) => t.failing), waiting: sum((t) => t.waiting), moving: sum((t) => t.moving), holds: fc.places.held, approvals: fc.places.approval };
	return { stOf, present, failedApps, failedAll, tierDots, tierFacts, focus, lastDeploy, tiers, prod, base, regionsAll: e.regions, regionless: e.regionless, causeByRow, busy, rest, restRegions, worstProd, worstFact, tierKinds, causes, holdLines, edges, arrivals, totals, window: ARRIVALS_WINDOW, TIER_NAME };
}
export type EnvsModel = ReturnType<typeof envsModel>;

/** The header facts, in PLACES: adverse first, zero facts omitted. */
export function metaFacts(m: EnvsModel): { text: string; adverse: boolean }[] {
	const f: { text: string; adverse: boolean }[] = [];
	/* EX4: ONE order everywhere (failing · in progress · held · to approve), the same as the Production rollup */
	if (m.totals.failing) f.push({ text: `${m.totals.failing} failing`, adverse: true });
	if (m.totals.moving) f.push({ text: `${m.totals.moving} in progress`, adverse: false });
	if (m.totals.holds) f.push({ text: `${m.totals.holds} held`, adverse: false });
	if (m.totals.approvals) f.push({ text: `${m.totals.approvals} to approve`, adverse: false });
	return f;
}

/** G5: columns of the Production band from 600px of canvas: cells are >= ~190px (a chip, a mark and "N places" never truncate); among 2..max columns the one that fills whole rows best (cost = empty slots in the last row + steps below max). The fold is ONE cell, spanning the empty slots of its row (at most 3 wide). */
export function bandCols(cells: number, hasFold: boolean, width: number): { cols: number; span: number } {
	const max = Math.min(8, Math.max(2, Math.floor((width + 6) / 256)));
	const n = cells + (hasFold ? 1 : 0);
	let best = max, bestCost = Infinity, bestLeft = 0;
	for (let c = max; c >= 2; c--) { const left = (c - (n % c)) % c; const cost = left + (max - c); if (cost < bestCost) { best = c; bestCost = cost; bestLeft = left; } }
	return { cols: best, span: 1 }; // M7: the fold is ONE short cell at the end of the content, never a bar
}

/** r2 (AD truth): a Production row that stands for N regions must say N, so the card's rows sum to the tier's places.
 *  RolloutRow prints the count for every case but the viewer's own approval (its chip names the place where they act, the count lives in the opened pane).
 *  The Environments card hands such a row to RolloutRow with needsYou off (the action stays), so it says "Waiting for approval · 5 regions" at every width. */
export function regionsVerb(r: { tier: string; group: string; needsYou: boolean; stillChecking?: boolean; regions: unknown[] }): string | null {
	if (r.tier !== 'prod' || r.regions.length < 2) return null;
	if (r.group === 'approval' && r.needsYou && !r.stillChecking) return `${stateWord('approval')} · ${r.regions.length} regions`;
	return null;
}
