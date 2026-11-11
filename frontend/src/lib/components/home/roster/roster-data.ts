/**
 * r31 ROSTER — the data for four attention-first list pages (Rollouts, Changes, Environments, Apps)
 * and the "Needs you" inbox. Lineage: new name, never used before. Linear-led: every page is a list
 * GROUPED BY STATE (Linear My issues: In Review / In Progress / Backlog), worst group first, one
 * distinct glyph per state; one drawn object only where it carries structure (Environments).
 *
 * No new truth: everything derives from pocket's `compass` (the real HomeModel over the pinned
 * home-incident fixture) and depot's helpers. Only the grouping is new. ADD ONLY: older versions
 * import from here and must keep rendering unchanged.
 */
import { stars } from '$lib/stores/stars.svelte';
import type { EnvPipeline, EnvState } from '$lib/view-models/home-model';
import { changeBySha, ME, NOW, viewerLogin, type HomeState } from '../sketch/home-data';
import { changesDoor, compass, TIERS, type TierKey } from '../pocket/pocket-data';
import { ago, isMe, pretty } from '../depot/depot-data';
import type { GlyphState } from '../depot/StateGlyph.svelte';

export { ago, pretty, isMe };
export const TIER_NAME: Record<TierKey, string> = { dev: 'Dev', test: 'Test', staging: 'Staging', prod: 'Production' };

export type GroupKey = 'failed' | 'approval' | 'held' | 'moving' | 'rest';
export const GROUP_NAME: Record<GroupKey, string> = { failed: 'Failing', approval: 'Waiting for approval', held: 'Held', moving: 'In progress', rest: 'At rest' };
export const GROUP_GLYPH: Record<GroupKey, GlyphState> = { failed: 'failed', approval: 'approval', held: 'held', moving: 'deploying', rest: 'rest' };

const tierOf = (e: { isProdRegion: boolean; tier: string }): TierKey =>
	e.isProdRegion || e.tier === 'prod' ? 'prod' : e.tier === 'dev' ? 'dev' : e.tier === 'test' ? 'test' : 'staging';
const groupOf = (s: EnvState): GroupKey =>
	s === 'failed' ? 'failed' : s === 'awaiting-approval' ? 'approval' : s === 'held-by-rule' ? 'held' : s === 'deploying' || s === 'checking' ? 'moving' : 'rest';
const glyphOf = (s: EnvState): GlyphState =>
	s === 'failed' ? 'failed' : s === 'awaiting-approval' ? 'approval' : s === 'held-by-rule' ? 'held' : s === 'deploying' ? 'deploying' : s === 'checking' ? 'checking' : 'rest';

/** craft r6 (N1): the environments an app really has, in promotion order: the SAME list the app tab's environment strip draws
 *  (dev | test | staging | prod, only those the app has). A change spanning several apps takes the union. */
const TORDER: TierKey[] = ['dev', 'test', 'staging', 'prod'];
export function appTiers(m: { apps: { app: string; envs: { isProdRegion: boolean; tier: string }[] }[] }, names: string[]): TierKey[] {
	const have = new Set<TierKey>();
	for (const a of m.apps) if (names.includes(a.app)) for (const e of a.envs) have.add(tierOf(e));
	return TORDER.filter((t) => have.has(t));
}

export type Change = { ref: string | null; title: string; who: string | null; mine: boolean };
export type RolloutRow = {
	key: string;
	app: string;
	tier: TierKey;
	/** where, in words: "production", "staging", "eu-west", "5 prod regions" */
	where: string;
	regions: string[];
	state: EnvState;
	group: GroupKey;
	glyph: GlyphState;
	/** what is happening, short: "Failing", "Deploying", "Checking", "Held by a rule", "Waits on payments-svc" */
	word: string;
	change: Change | null;
	version: string | null;
	since: string | null;
	href: string;
	/** a failure of your change, or an approval you can give */
	needsYou: boolean;
	/** the place reads its approval or rule hold while its own build is still baking */
	stillChecking?: boolean;
	lead: boolean;
	action: { label: string; href: string; kind: 'rollback' | 'approve' | 'open' } | null;
	/** one line of cause, from the model's own words (failing check, hold reason) */
	cause: string | null;
	/** a held-by-rule row whose approval ALSO refuses the build: the row says so; `yours` = the viewer can approve (Home keeps the ask) */
	alsoApproval?: { yours: boolean; other: string; persistent: boolean; kind: 'window' | 'order' | 'hold' } | null;
	/** v05: this place's own rollout steps (main's Home RolloutStepper data) */
	pipeline?: EnvPipeline | null;
};
export type RolloutGroup = { key: GroupKey; rows: RolloutRow[]; places: number };
export type RestApp = { app: string; places: number; tiers: TierKey[]; href: string };

/** craft r7 (N2r): ONE rule for Landed and Arrivals. A change/build has landed (arrived) in a place when ITS OWN build went live there and passed
 *  its checks. A later, different build failing there does not un-land it; its own build failing, or still checking/deploying there, means it
 *  did not land there. This predicate is the state test (a place whose current build is failing/checking/deploying is not a landing place);
 *  Landed's wording falls back to the tier name when only a later build is failing, Arrivals' liveRegions adds the own-build match. */
const isLiveHealthy = (s: string) => s !== 'failed' && s !== 'not-deployed' && s !== 'deploying' && s !== 'checking';

/** craft r2: a git sha shortens to 7; a semver tag ("4.43.0-43") is already short and is never cut. */
const shortVersion = (v: string | null | undefined): string | null => (!v ? null : /^[0-9a-f]{8,40}$/.test(v) ? v.slice(0, 7) : v);

export function rollouts(state: HomeState) {
	const c = compass(state);
	const { v, m } = c;
	const L = v.lead;
	const leadApp = L ? L.meta.split(' · ')[0] : null;
	const appr = new Map(v.approvals.map((a) => [a.app, a]));
	const needs = new Map(m.fleet.needsYou.map((n) => [`${n.app}@${n.env}`, n]));

	type P = { prov: string | null; app: string; env: string; label: string; tier: TierKey; state: EnvState; version: string | null; since: string | null; href: string; mine: Change | null; pipeline: EnvPipeline | null; also: { other: string; persistent: boolean; kind: 'window' | 'order' | 'hold' } | null; stillChecking: boolean };
	/* craft r7 (N5): a held place waits on a PROVIDER when its tab says so. `needsYou` holds one entry per app and hold
	   category, so a held place with no entry of its own takes the app's held entries when they all agree (the tab's sentence is the
	   same gate: "waiting for payments-svc"); an entry of its own with another reason (a check, a pin) is never overridden. */
	const stateOf = (app: string, env: string) => m.apps.find((a) => a.app === app)?.envs.find((e) => e.env === env)?.state;
	const appProv = (app: string): string | null => {
		const es = m.fleet.needsYou.filter((n) => n.app === app && stateOf(app, n.env) === 'held-by-rule');
		const ps = new Set(es.map((n) => n.facts.provider ?? ''));
		return es.length && ps.size === 1 ? ([...ps][0] || null) : null;
	};
	const providerOf = (app: string, env: string): string | null => { const own = needs.get(`${app}@${env}`); return own ? (own.facts.provider ?? null) : appProv(app); };
	const busy: P[] = [];
	const restBy = new Map<string, RestApp>();
	for (const a of m.apps)
		for (const e of a.envs) {
			if (e.state === 'not-deployed') continue;
			const tier = tierOf(e);
			if (groupOf(e.state) === 'rest') {
				const r = restBy.get(a.app) ?? { app: a.app, places: 0, tiers: [], href: a.href };
				r.places++;
				if (!r.tiers.includes(tier)) r.tiers.push(tier);
				restBy.set(a.app, r);
				continue;
			}
			const my = e.myChanges.find((ch) => ch.state === e.state) ?? null;
			busy.push({
				prov: e.state === 'held-by-rule' ? providerOf(a.app, e.env) : null, app: a.app, env: e.env, label: e.label, tier, state: e.state, version: shortVersion(e.version),
				/* craft r7 (nit): a failing place's age is the failure's (the change's failed entry), not the deploy's */
				since: (e.state === 'awaiting-approval' || e.state === 'held-by-rule' ? e.heldSince : null) ?? (e.state === 'failed' ? e.myChanges.find((ch) => ch.state === 'failed')?.since : null) ?? e.arrivedAt,
				href: e.href, stillChecking: !!e.stillChecking, also: e.state === 'held-by-rule' ? (e.alsoApproval ?? null) : null, mine: my ? { ref: my.ref, title: my.title, who: pretty(viewerLogin()), mine: true } : null, pipeline: e.pipeline ?? null
			});
		}

	/* fold prod regions of one app in one state on one build into one row */
	const rows: RolloutRow[] = [];
	for (const p of busy) {
		const g = groupOf(p.state);
		const same = rows.find((r) => r.app === p.app && r.tier === 'prod' && p.tier === 'prod' && r.state === p.state && (r.glyph === 'waiting') === !!p.prov && r.stillChecking === p.stillChecking && (p.state === 'awaiting-approval' || p.state === 'held-by-rule' || r.version === p.version));
		if (same) {
			same.regions.push(p.label);
			same.where = `${same.regions.length} prod regions`;
			continue;
		}
		const ap = p.state === 'awaiting-approval' ? appr.get(p.app) : undefined;
		const ny = v.notYours.find((n) => n.key === `${p.app}@${p.env}`) ?? (p.state === 'held-by-rule' ? v.notYours.find((n) => n.app === p.app && n.key.endsWith(p.label)) : undefined);
		const held = p.state === 'held-by-rule' || p.state === 'awaiting-approval';
		const sha = held ? null : changeBySha(p.app, p.version);
		const change: Change | null = p.mine
			?? (ap ? { ref: ap.ref ?? ap.build, title: ap.ref ? ap.title : `build ${ap.build}`, who: pretty(ap.author), mine: isMe(ap.author) } : null)
			?? (ny ? { ref: ny.ref, title: ny.title ?? `build ${ny.ref}`, who: pretty(ny.whose), mine: isMe(ny.whose) } : null)
			?? (sha ? { ref: sha.ref, title: sha.title, who: pretty(sha.author), mine: isMe(sha.author) } : null)
			?? (!held && p.version ? { ref: null, title: `build ${p.version}`, who: null, mine: false } : null);
		if (change && change.ref && change.title === `build ${change.ref}`) change.ref = null;
		const isLead = !!L && leadApp === p.app && ((L.kind === 'failing' && p.state === 'failed') || (L.kind === 'approval' && p.state === 'awaiting-approval'));
		const nyEntry = needs.get(`${p.app}@${p.env}`);
		const failMine = p.state === 'failed' && (!!change?.mine || isLead || v.failures.some((f) => f.app === p.app) || starred.has(p.app));
		const viewerAsks = !!appr.get(p.app) || (L?.kind === 'approval' && leadApp === p.app); /* the viewer can give this approval: it is in `v.approvals`, or it is the lead (which `v.approvals` leaves out); ONE expression for needsYou and alsoApproval.yours */
		const needsYou = failMine || (p.state === 'awaiting-approval' && !!ap) || (p.state === 'held-by-rule' && !!p.also && viewerAsks); /* a rule holds the build but the approval ALSO refuses it: Home keeps the ask */
		const word =
			p.state === 'failed' ? 'Failing'
			: p.state === 'awaiting-approval' ? (ap ? 'Waits for your approval' : 'Waits for approval')
			: p.state === 'held-by-rule' ? (p.prov ? `Waits on ${p.prov}` : ny?.status?.startsWith('Waits on a dependency') ? 'Waits on a dependency' : 'Held by a rule')
			: p.state === 'deploying' ? 'Deploying' : 'Checking';
		const cause = isLead && L?.check ? `${L.check.name} ${L.check.message}` : nyEntry?.phrase ?? null;
		rows.push({
			key: `${p.app}@${p.env}`, app: p.app, tier: p.tier,
			where: p.tier === 'prod' ? (p.label === 'prod' ? 'production' : p.label) : p.label,
			regions: [p.label], state: p.state, group: g, glyph: p.prov ? 'waiting' : glyphOf(p.state), word, change, version: p.version, since: p.since, href: p.href,
			needsYou, lead: isLead, stillChecking: p.stillChecking,
			action: isLead && L?.action ? { label: L.action.label.replace(/ to [0-9a-f]{7}$/, ''), href: L.action.href, kind: 'rollback' }
				: p.state === 'failed' && needsYou ? { label: 'Roll back', href: p.href, kind: 'rollback' }
				: p.state === 'awaiting-approval' && ap ? { label: 'Approve', href: p.href, kind: 'approve' } : null,
			cause, pipeline: p.pipeline,
			alsoApproval: p.also ? { ...p.also, yours: viewerAsks } : null
		});
	}
	const TR: Record<TierKey, number> = { prod: 0, staging: 1, test: 2, dev: 3 };
	rows.sort((a, b) => Number(b.lead) - Number(a.lead) || Number(b.needsYou) - Number(a.needsYou) || TR[a.tier] - TR[b.tier] || (b.since ?? '').localeCompare(a.since ?? ''));
	const order: GroupKey[] = ['failed', 'approval', 'held', 'moving'];
	const groups: RolloutGroup[] = order
		.map((k) => ({ key: k, rows: rows.filter((r) => r.group === k), places: rows.filter((r) => r.group === k).reduce((n, r) => n + r.regions.length, 0) }))
		.filter((g) => g.rows.length);
	const rest = [...restBy.values()].filter((r) => !rows.some((x) => x.app === r.app)).sort((a, b) => a.app.localeCompare(b.app));
	const restPlaces = [...restBy.values()].reduce((n, r) => n + r.places, 0);
	const restAll = [...restBy.values()].sort((a, b) => a.app.localeCompare(b.app));

	const failing = rows.filter((r) => r.group === 'failed').reduce((n, r) => n + r.regions.length, 0);
	const prodFailing = rows.filter((r) => r.group === 'failed' && r.tier === 'prod').reduce((n, r) => n + r.regions.length, 0);
	const yourApprovals = rows.filter((r) => r.group === 'approval' && r.needsYou).length;
	const moving = rows.filter((r) => r.group === 'moving').reduce((n, r) => n + r.regions.length, 0);
	return {
		c, rows, groups, rest, restAll, restPlaces,
		figures: { failing, prodFailing, yourApprovals, moving, places: c.places, apps: c.apps.length },
		activity: c.activity.map((a) => ({ ...a, who: pretty(a.author), mine: isMe(a.author), where: a.env === 'prod' ? 'production' : a.env })),
		tiers: c.tiers
	};
}

export type Rollouts = ReturnType<typeof rollouts>;

/* ── craft r4 (R3-1): ARRIVALS, ONE data function. "What reached production in the last 12 h", one row per app, newest first.
   The row is the app's NEWEST arrival (pocket already folds one build's regions inside 30 min into "N regions"); older entries of
   the same app are not added to it: summing them counted a region once per build ("13 regions" for an app with 5), and
   de-duplicating the strings gave "8 regions", which is why three drawings of one list disagreed. The place string is computed
   here once: the region/environment when it arrived in one place, "N regions" otherwise. Failed deploys are not arrivals (they are
   the Failing card's). Rollouts' rail and Environments' main column both render exactly these rows. ── */
export type ArrivalRow = { key: string; app: string; n: number; place: string; at: string };
export const ARRIVALS_WINDOW = '12 h';
export function arrivalRows(activity: { app: string; env: string; where: string; at: string; kind: string; ref?: string | null }[], models: { app: string; envs: EnvLike[] }[] = []): ArrivalRow[] {
	const seen = new Set<string>();
	const out: ArrivalRow[] = [];
	/* craft r6 (N2): a place is counted only where that build is LIVE NOW: a prod environment of the app that is not failing and whose
	   running build arrived within the entry's 30 min fold (and, where a tag resolves to a change, is that change). An entry whose build is
	   live nowhere (replaced, failed) is not an arrival; the app's next-newest live entry stands in. */
	const liveRegions = (a: { app: string; at: string; ref?: string | null }) => {
		const m = models.find((x) => x.app === a.app);
		if (!m) return null;
		return m.envs.filter((e) => tierOf(e) === 'prod' && isLiveHealthy(e.state) && !!e.version && (changeBySha(a.app, shortVersion(e.version))?.ref ?? a.ref) === a.ref && Math.abs(Date.parse(e.arrivedAt ?? a.at) - Date.parse(a.at)) < 30 * 60000).map((e) => e.label);
	};
	for (const a of [...activity].filter((x) => x.kind !== 'failed').sort((p, q) => q.at.localeCompare(p.at))) {
		if (seen.has(a.app)) continue;
		const live = liveRegions(a);
		if (live && !live.length) continue;
		seen.add(a.app);
		const m = /^(\d+) regions$/.exec(a.env);
		const n = live ? live.length : m ? +m[1] : 1;
		out.push({ key: a.app, app: a.app, n, place: live ? (n > 1 ? `${n} prod regions` : live[0] === 'prod' ? 'production' : live[0]) : m ? `${m[1]} prod regions` : a.where, at: a.at });
	}
	return out;
}
export { changesDoor, TIERS, NOW, ME };
export type { TierKey };

/** the inbox count: places that need you (your failing changes, approvals you can give) */
export function needsYouCount(state: HomeState) {
	return rollouts(state).rows.filter((r) => r.needsYou).length;
}

/* ── v02: CHANGES — "where is my change, and is anything wrong with it?" Mine: every place the
   model positions one of your changes (EnvChange), folded per change; Team: the last 24h of merges,
   placed through the Rollouts rows that carry them. Groups: failing → waiting → moving → landed. ── */
export type ChangeGroupKey = 'failed' | 'waiting' | 'moving' | 'landed';
export const CHANGE_GROUP_NAME: Record<ChangeGroupKey, string> = { failed: 'Failing', waiting: 'Waiting', moving: 'Moving', landed: 'Landed' };
export const CHANGE_GROUP_GLYPH: Record<ChangeGroupKey, GlyphState> = { failed: 'failed', waiting: 'approval', moving: 'deploying', landed: 'arrived' };
export type ChangeItem = {
	key: string;
	ref: string;
	title: string;
	repo: string;
	apps: string[];
	who: string | null;
	mine: boolean;
	group: ChangeGroupKey;
	glyph: GlyphState;
	/** the frontier fact: "Failing in production", "Waits for approval in 2 prod regions", "In staging" */
	fact: string;
	/** craft r4: the place the fact happens in ("2 prod regions", "staging"), computed once from the rollout rows */
	where: string;
	/** furthest tier the change has arrived in (running or baking), null if nowhere yet */
	reach: TierKey | null;
	/** the tier where the frontier fact happens (coloured on the meter) */
	at: TierKey | null;
	since: string | null;
	mergedAt: string;
	href: string;
	action: { label: string; href: string } | null;
	/** craft r6 (N1): the environments of the app(s) this change belongs to, in promotion order (the reach meter's nodes) */
	tiers: TierKey[];
	/** craft r5 (D3): the change was rolled back where it stood: it is not "landed" (group stays 'landed' for older versions; v09 splits it out) */
	rolledBack?: boolean;
};
const RANK_T: Record<TierKey, number> = { dev: 0, test: 1, staging: 2, prod: 3 };
const placeWord = (tier: TierKey, labels: string[]) =>
	tier === 'prod' ? (labels.length > 1 ? `${labels.length} prod regions` : labels[0] === 'prod' ? 'production' : labels[0]) : labels[0];

type EnvLike = { app?: string; label: string; tier: string; isProdRegion: boolean; state: EnvState; version: string | null; arrivedAt: string | null; heldSince: string | null; myChanges: { ref: string }[] };
/**
 * craft r6 (N3): a change is LANDED only when nothing is pending downstream. A change whose build is not yet at an environment of
 * its app (the env's own ledger does not list it) while that environment is held (approval or rule) since before the change merged
 * is held THERE: it belongs to Waiting on others with that place. Returns the furthest held tier, its regions and whether a person
 * (approval) or a rule holds it.
 */
export function heldDownstream(m: { apps: { app: string; envs: EnvLike[] }[] }, names: string[], ref: string, mergedAt: string) {
	const hits: EnvLike[] = [];
	for (const a of m.apps)
		if (names.includes(a.app))
			for (const e of a.envs)
				if ((e.state === 'awaiting-approval' || e.state === 'held-by-rule') && e.heldSince && mergedAt >= e.heldSince && !e.myChanges.some((c) => c.ref === ref)) hits.push(e);
	if (!hits.length) return null;
	const top = hits.reduce<TierKey>((b, e) => (RANK_T[tierOf(e)] > RANK_T[b] ? tierOf(e) : b), tierOf(hits[0]));
	const here = hits.filter((e) => tierOf(e) === top);
	return { tier: top, labels: here.map((e) => e.label), state: (here.some((e) => e.state === 'awaiting-approval') ? 'awaiting-approval' : 'held-by-rule') as EnvState };
}
/**
 * craft r6 (N2): the regions where a landed change is LIVE NOW. An environment that is failing runs a build that did not take, so a
 * ledger "healthy" place in it does not count; the regions of that tier whose running build was cut after the change merged
 * (before the hold, for a gated environment) and is not failing stand in. One derivation for Changes, Needs you and Arrivals.
 */
export function liveLabels(m: { apps: { app: string; envs: EnvLike[] }[] }, names: string[], tier: TierKey, mergedAt: string): string[] {
	const out: string[] = [];
	for (const a of m.apps)
		if (names.includes(a.app))
			for (const e of a.envs)
				if (tierOf(e) === tier && isLiveHealthy(e.state) && (e.heldSince ? mergedAt < e.heldSince : !!e.arrivedAt && mergedAt <= e.arrivedAt) && !out.includes(e.label)) out.push(e.label);
	return out;
}

/** craft r6 (D3b): when the build a change rode in was rolled back at a place: the timestamp of the NEXT history entry there (the rollback deploy). */
function rollbackAt(events: { t: number; app: string; env: string; sha: string }[], names: string[], label: string, ref: string): string | null {
	for (const app of names) {
		const evs = events.filter((e) => e.app === app && e.env === label).sort((a, b) => a.t - b.t);
		const i = evs.findIndex((e) => changeBySha(app, e.sha)?.ref === ref);
		if (i >= 0 && evs[i + 1]) return new Date(evs[i + 1].t).toISOString();
	}
	return null;
}

export function changes(state: HomeState, opts: { rolledBackLands?: boolean } = {}) {
	const c = compass(state);
	const { m } = c;
	const R = rollouts(state);
	/* mine */
	type Pl = { tier: TierKey; label: string; state: EnvState; envState: EnvState; since: string | null; href: string };
	const mineBy = new Map<string, { ref: string; title: string; repo: string; apps: Set<string>; mergedAt: string; href: string; places: Pl[] }>();
	for (const a of m.apps)
		for (const e of a.envs)
			for (const ch of e.myChanges) {
				const k = `${ch.repo}${ch.ref}`;
				const x = mineBy.get(k) ?? { ref: ch.ref, title: ch.title, repo: ch.repo, apps: new Set<string>(), mergedAt: ch.mergedAt, href: ch.href, places: [] };
				x.apps.add(a.app);
				x.places.push({ tier: tierOf(e), label: e.label, state: ch.state, envState: e.state, since: ch.since, href: e.href });
				mineBy.set(k, x);
			}
	const items: ChangeItem[] = [];
	const W: Record<string, number> = { failed: 0, 'rolled-back': 1, 'awaiting-approval': 2, 'held-by-rule': 3, deploying: 4, checking: 5 };
	for (const [k, x] of mineBy) {
		const worst = [...x.places].sort((p, q) => (W[p.state] ?? 9) - (W[q.state] ?? 9) || RANK_T[q.tier] - RANK_T[p.tier])[0];
		const arrived = x.places.filter((p) => !['awaiting-approval', 'held-by-rule', 'not-deployed'].includes(p.state));
		const reach = arrived.length ? arrived.reduce<TierKey>((b, p) => (RANK_T[p.tier] > RANK_T[b] ? p.tier : b), arrived[0].tier) : null;
		const g0: ChangeGroupKey = worst.state === 'failed' || (worst.state === 'rolled-back' && !opts.rolledBackLands) ? 'failed' : worst.state === 'rolled-back' ? 'landed' : worst.state === 'awaiting-approval' || worst.state === 'held-by-rule' ? 'waiting' : worst.state === 'deploying' || worst.state === 'checking' ? 'moving' : 'landed';
		const hd = g0 === 'landed' && worst.state !== 'rolled-back' ? heldDownstream(m, [...x.apps], x.ref, x.mergedAt) : null;
		const g: ChangeGroupKey = hd ? 'waiting' : g0;
		/* craft r4 (R3-3): place and age of a change are the ROLLOUT ROWS' own (the places whose env state is the worst state and which
		   carry this change), so a change reads "Held in 2 prod regions · 10h" on every page. The ledger's own per-place list counts a
		   place whose env is busy with another build ("held" in us-east-2 while it Checks a different change) and dates the hold from
		   the change's arrival, which is why Changes used to say "3 regions · 1h 30m" for the same hold. The ledger stays the fallback
		   (rolled back, landed: no rollout row exists). */
		const rows0 = R.rows.filter((r) => r.change?.ref === x.ref && x.apps.has(r.app) && r.state === worst.state && r.tier === worst.tier);
		const same = rows0.length ? [...new Set(rows0.flatMap((r) => r.regions))] : x.places.filter((p) => p.state === worst.state && p.tier === worst.tier).map((p) => p.label);
		const where = hd ? placeWord(hd.tier, hd.labels) : placeWord(worst.tier, same);
		/* craft r7 (N5): a held place that waits on a provider says so, in the rollout row's own words */
		const waitOf = (tier: TierKey, labels: string[]) => R.rows.find((r) => r.state === 'held-by-rule' && x.apps.has(r.app) && r.tier === tier && r.word.startsWith('Waits on') && r.regions.some((l) => labels.includes(l)))?.word ?? null;
		const heldWord = hd ? (hd.state === 'held-by-rule' ? waitOf(hd.tier, hd.labels) : null) : worst.state === 'held-by-rule' ? waitOf(worst.tier, same) : null;
		const rowSince = rows0.find((r) => r.since)?.since ?? null;
		/* craft r6 (N2): a landed change stands where its build is live now, never in a failing region */
		const liveHere = reach ? x.places.filter((p) => p.tier === reach && isLiveHealthy(p.envState) && p.state !== 'failed' && p.state !== 'rolled-back').map((p) => p.label) : [];
		const liveFall = reach && !liveHere.length ? liveLabels(m, [...x.apps], reach, x.mergedAt) : [];
		const front = g === 'landed' ? (reach ? (liveHere.length || liveFall.length ? placeWord(reach, liveHere.length ? liveHere : liveFall) : (reach === 'prod' ? 'production' : reach)) : where) : where;
		/* craft r6 (D3b): a rolled-back change's age is the rollback itself: the history entry that replaced the build that was rolled back */
		const rbAt = worst.state === 'rolled-back' ? rollbackAt(c.events, [...x.apps], worst.label, x.ref) : null;
		const fact =
			hd ? (hd.state === 'awaiting-approval' ? `Waits for approval in ${where}` : `${heldWord ?? 'Held'} in ${where}`)
			: worst.state === 'failed' ? `Failing in ${where}`
			: worst.state === 'rolled-back' ? `Rolled back in ${where}`
			: worst.state === 'awaiting-approval' ? `Waits for approval in ${where}`
			: worst.state === 'held-by-rule' ? `${heldWord ?? 'Held'} in ${where}`
			: worst.state === 'deploying' ? `Deploying to ${where}`
			: worst.state === 'checking' ? `Checking in ${where}`
			: `In ${front}`;
		const rr = R.rows.find((r) => r.change?.ref === x.ref && x.apps.has(r.app) && r.action && r.state === worst.state);
		items.push({
			key: k, ref: x.ref, title: x.title, repo: x.repo, apps: [...x.apps], tiers: appTiers(m, [...x.apps]), who: pretty(viewerLogin()), mine: true, group: g,
			glyph: hd ? (hd.state === 'awaiting-approval' ? 'approval' : heldWord ? 'waiting' : 'held') : g === 'failed' ? 'failed' : worst.state === 'rolled-back' ? 'rest' : worst.state === 'awaiting-approval' ? 'approval' : worst.state === 'held-by-rule' ? (heldWord ? 'waiting' : 'held') : worst.state === 'deploying' ? 'deploying' : worst.state === 'checking' ? 'checking' : 'arrived',
			fact, reach, at: hd ? hd.tier : g === 'landed' ? reach : worst.tier, since: hd ? (arrived.find((p) => p.tier === reach)?.since ?? x.mergedAt) : rbAt ?? (g === 'landed' ? (arrived.find((p) => p.tier === reach)?.since ?? x.mergedAt) : rowSince ?? worst.since ?? x.mergedAt), where: g === 'landed' && worst.state !== 'rolled-back' ? front : where,
			mergedAt: x.mergedAt, href: worst.href, action: !hd && rr?.action ? { label: rr.action.label, href: rr.action.href } : null,
			rolledBack: worst.state === 'rolled-back'
		});
	}
	/* team: last 24h of merges by others, placed through the rollout rows carrying them */
	const door = changesDoor(state);
	for (const r of door.rows) {
		if (r.mine) continue;
		const rr = R.rows.filter((x) => x.change?.ref === r.ref && x.app.startsWith(r.app));
		if (!rr.length && !r.reached) continue; /* no release anywhere: not affected */
		const worst = rr.sort((p, q) => (W[p.state] ?? 9) - (W[q.state] ?? 9))[0];
		const hdT = !worst ? heldDownstream(m, rr.length ? [...new Set(rr.map((x) => x.app))] : [r.app], r.ref, r.at) : null;
		const namesT = rr.length ? [...new Set(rr.map((x) => x.app))] : m.apps.filter((a) => a.app.startsWith(r.app)).map((a) => a.app);
		const g: ChangeGroupKey = hdT ? 'waiting' : !worst ? 'landed' : worst.group === 'failed' ? 'failed' : worst.group === 'approval' || worst.group === 'held' ? 'waiting' : 'moving';
		const whereT = hdT ? placeWord(hdT.tier, hdT.labels) : '';
		const heldWordT = hdT && hdT.state === 'held-by-rule' ? R.rows.find((x) => x.state === 'held-by-rule' && namesT.includes(x.app) && x.tier === hdT.tier && x.word.startsWith('Waits on') && x.regions.some((l) => hdT.labels.includes(l)))?.word ?? null : null;
		const fact = hdT ? (hdT.state === 'awaiting-approval' ? `Waits for approval in ${whereT}` : `${heldWordT ?? 'Held'} in ${whereT}`) : !worst ? `In ${r.reached === 'prod' ? 'production' : r.reached}` : g === 'failed' ? `Failing in ${worst.where}` : worst.state === 'awaiting-approval' ? `Waits for approval in ${worst.where}` : worst.state === 'held-by-rule' ? `${worst.word.startsWith('Waits on') ? worst.word : 'Held'} in ${worst.where}` : `${worst.word} ${worst.state === 'deploying' ? 'to' : 'in'} ${worst.where}`;
		items.push({
			key: r.key, ref: r.ref, title: r.title, repo: r.app, tiers: appTiers(m, rr.length ? [...new Set(rr.map((x) => x.app))] : [r.app]), apps: [...new Set(rr.map((x) => x.app))].length ? [...new Set(rr.map((x) => x.app))] : [r.app], who: r.who, mine: false, group: g,
			glyph: hdT ? (hdT.state === 'awaiting-approval' ? 'approval' : heldWordT ? 'waiting' : 'held') : !worst ? 'arrived' : worst.glyph === 'held' ? 'held' : worst.glyph, fact, where: hdT ? whereT : worst ? worst.where : (r.reached === 'prod' ? 'production' : (r.reached ?? '')), reach: r.reached, at: hdT ? hdT.tier : worst ? worst.tier : r.reached,
			since: worst?.since ?? r.at, mergedAt: r.at, href: worst?.href ?? r.href, action: null
		});
	}
	const order: ChangeGroupKey[] = ['failed', 'waiting', 'moving', 'landed'];
	const sortIt = (a: ChangeItem, b: ChangeItem) => (b.since ?? '').localeCompare(a.since ?? '');
	const group = (mine: boolean) => order.map((k) => ({ key: k, rows: items.filter((i) => i.mine === mine && i.group === k).sort(sortIt) })).filter((g) => g.rows.length);
	return {
		items, mine: group(true), team: group(false), door,
		figures: {
			failing: items.filter((i) => i.mine && i.group === 'failed' && i.fact.startsWith('Failing')).length,
			waiting: items.filter((i) => i.mine && i.group === 'waiting').length,
			moving: items.filter((i) => i.mine && i.group === 'moving').length,
			teamFailing: items.filter((i) => !i.mine && i.group === 'failed').length
		}
	};
}

/* ── v03: ENVIRONMENTS — "is each environment healthy, and what is arriving?" The tiers in promotion
   order with their busy places (the rollouts rows of that tier), production split by region. ── */
export type Region = { label: string; apps: number; worst: GlyphState; failing: number; waiting: number; moving: number; rest: number; href: string };
export function environments(state: HomeState) {
	const R = rollouts(state);
	const c = R.c;
	const tiers = TIERS.map((k) => {
		const t = c.tiers.find((x) => x.key === k);
		if (!t) return null;
		const rows = R.rows.filter((r) => r.tier === k);
		const arrivals = R.activity.filter((a) => a.kind !== 'failed' && (k === 'prod' ? a.env === 'prod' || !['dev', 'test', 'staging'].includes(a.env) : a.env === k));
		/* craft r2: waiting = approvals AND rule-held places (pocket's `held` is approvals only) */
		const failing = t.failed.length, moving = t.moving.length, waiting = t.places.filter((p) => p.state === 'awaiting-approval' || p.state === 'held-by-rule').length;
		return {
			key: k, name: TIER_NAME[k], places: t.places.length, apps: t.apps, rest: t.healthy, failing, moving, waiting,
			yours: rows.filter((r) => r.needsYou && r.group === 'approval').length,
			glyph: (failing ? 'failed' : rows.some((r) => r.needsYou) ? 'approval' : moving ? 'deploying' : waiting ? 'waiting' : 'rest') as GlyphState,
			rows, arrivals, placesList: t.places
		};
	}).filter((x): x is NonNullable<typeof x> => !!x);
	const prod = c.tiers.find((x) => x.key === 'prod');
	const byReg = new Map<string, Region>();
	for (const p of prod?.places ?? []) {
		const r = byReg.get(p.label) ?? { label: p.label, apps: 0, worst: 'rest' as GlyphState, failing: 0, waiting: 0, moving: 0, rest: 0, href: p.href };
		r.apps++;
		if (p.state === 'failed') r.failing++;
		else if (p.state === 'awaiting-approval' || p.state === 'held-by-rule') r.waiting++;
		else if (p.state === 'deploying' || p.state === 'checking') r.moving++;
		else r.rest++;
		byReg.set(p.label, r);
	}
	const regions = [...byReg.values()].map((r) => ({ ...r, worst: (r.failing ? 'failed' : r.waiting ? 'waiting' : r.moving ? 'deploying' : 'rest') as GlyphState }))
		.sort((a, b) => b.failing - a.failing || b.waiting - a.waiting || b.apps - a.apps || a.label.localeCompare(b.label));
	return { R, tiers, regions };
}

/* ── v04: APPS — "which of my apps need attention, and how far is each one's newest build?" One row
   per app: its worst place (from the Rollouts rows), how far its newest build has reached, the
   model's own primary action. Groups: needs you → in progress → waiting on others → quiet. ── */
export type AppItem = {
	app: string; href: string; group: 'needs' | 'moving' | 'waiting' | 'quiet'; glyph: GlyphState;
	fact: string; change: Change | null; reach: TierKey | null; at: TierKey | null; since: string | null;
	places: number; onNewest: number; newest: string | null; envs: number; tiers: TierKey[];
	action: { label: string; href: string; kind: string } | null; lead: boolean; deploys24: number;
};
export function apps(state: HomeState) {
	const R = rollouts(state);
	const c = R.c;
	const RT: Record<TierKey, number> = { dev: 0, test: 1, staging: 2, prod: 3 };
	const items: AppItem[] = c.apps.map((a) => {
		const model = c.m.apps.find((x) => x.app === a.app)!;
		const rows = R.rows.filter((r) => r.app === a.app);
		const worst = rows[0] ?? null; /* R.rows are sorted lead → needs you → prod first */
		const w = rows.find((r) => r.group === 'failed') ?? rows.find((r) => r.needsYou) ?? rows.find((r) => r.group === 'moving') ?? worst;
		const group: AppItem['group'] = !w ? 'quiet' : w.group === 'failed' || w.needsYou ? 'needs' : w.group === 'moving' ? 'moving' : 'waiting';
		const envs = model.envs.filter((e) => e.state !== 'not-deployed');
		const onNew = envs.filter((e) => e.version?.slice(0, 7) === a.newest && !['awaiting-approval', 'held-by-rule'].includes(e.state));
		const reach = onNew.length ? onNew.map((e) => tierOf(e)).reduce((b, t) => (RT[t] > RT[b] ? t : b)) : null;
		/* craft r4 (R3-4): one outcome grammar for a change and an app: Failing in X / Waits for approval in X / Held in X / Deploying to X */
		const fact = !w ? `${a.places} ${a.places === 1 ? 'place' : 'places'} at rest` : w.group === 'failed' ? `Failing in ${w.where}` : w.state === 'awaiting-approval' ? `Waits for approval in ${w.where}` : w.group === 'moving' ? `${w.word} ${w.state === 'deploying' ? 'to' : 'in'} ${w.where}` : `${w.word.startsWith('Waits on') ? w.word : 'Held'} in ${w.where}`;
		return {
			app: a.app, href: a.href, group, glyph: !w ? 'rest' : w.group === 'failed' ? 'failed' : w.needsYou ? 'approval' : w.group === 'moving' ? w.glyph : 'waiting',
			fact, change: w?.change ?? null, reach, at: w ? w.tier : reach, since: w?.since ?? null,
			places: a.places, onNewest: a.onNewest, newest: a.newest, envs: new Set(envs.map((e) => tierOf(e))).size, tiers: appTiers(c.m, [a.app]),
			action: w?.action ?? null, lead: !!w?.lead, deploys24: c.events.filter((e) => e.app === a.app).length
		};
	});
	const lastDeploy = (app: string) => Math.max(0, ...c.events.filter((e) => e.app === app).map((e) => e.t));
	const order = ['needs', 'moving', 'waiting', 'quiet'] as const;
	const rank = (i: AppItem) => (i.lead ? 0 : i.glyph === 'failed' ? 1 : 2);
	const groups = order.map((k) => ({ key: k, rows: items.filter((i) => i.group === k).sort((a, b) => rank(a) - rank(b) || (k === 'quiet' ? lastDeploy(b.app) - lastDeploy(a.app) : (b.since ?? '').localeCompare(a.since ?? ''))) })).filter((g) => g.rows.length);
	return { R, items, groups };
}
