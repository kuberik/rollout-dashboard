/**
 * View-model of the Changes page (r34 round 6, the Tidemark list). Pure functions over data.ts output; nothing here
 * invents a fact. The page answers the developer's question in three cards, in the question's own order:
 *   "which one is failing or waiting on me"  -> Failing or waiting
 *   "where are my changes right now"         -> On the way
 *   "when did they land"                     -> Landed
 */
import { newestFirst, latest } from '$lib/instant';
import type { TChange, TierKey, HeldCause, TRow, HomeState, ApprovalTarget } from './data';
import { approvalTarget, urgency, lastHealthy, buildOf, candidateBuilds, deployedBuild, buildInQuestionFacts, avatarSrc, NOW } from './data';
import { rangeJson } from './github-read.svelte';
import { formatTimeAgoCompact } from '$lib/utils';
import { rowAction, actionLabel } from './rollout-view';
import { stateWord } from './state-words';
import { displayTimeZone } from '$lib/timezone.svelte';
import { source } from '$lib/components/home/sketch/home-data';

/** the four tier slots of every Tidemark, in promotion order (an app without a tier leaves its slot blank) */
export const TIERS: TierKey[] = ['dev', 'test', 'staging', 'prod'];
export const TIER_TITLE: Record<TierKey, string> = { dev: 'dev', test: 'test', staging: 'staging', prod: 'production' };
const rank = (k: TierKey) => TIERS.indexOf(k);

export type ChangeState = 'failed' | 'approval' | 'held' | 'deploying' | 'checking' | 'healthy' | 'landed';
export function changeState(c: TChange): ChangeState {
	if (c.group === 'failed') return 'failed';
	if (c.group === 'landed') return 'landed';
	if (c.glyph === 'approval') return 'approval';
	if (c.glyph === 'held' || c.glyph === 'waiting') return 'held';
	if (c.glyph === 'deploying') return 'deploying';
	if (c.glyph === 'checking') return 'checking';
	return 'healthy';
}

export type Bucket = 'stopped' | 'moving' | 'landed';
export const bucketOf = (s: ChangeState): Bucket => (s === 'failed' || s === 'approval' || s === 'held' ? 'stopped' : s === 'landed' ? 'landed' : 'moving');

/** the tier where the change's state happens (the Tidemark's own node) */
export const ownTier = (c: Pick<TChange, 'at' | 'reach'>): TierKey | null => c.at ?? c.reach ?? null;

/** a Tidemark slot: the tier is absent from the app's path (blank), reached (done), the change's own (carries the state), or ahead (to do) */
export type Slot = { tier: TierKey; kind: 'absent' | 'done' | 'own' | 'todo' };
export function slots(c: Pick<TChange, 'tiers' | 'reach' | 'at'>, appTiers: TierKey[] = []): Slot[] {
	const own = ownTier(c);
	/* the app's own strip decides (its Runs-in places); a tier the tab does not draw is not slotted */
	const has = new Set<TierKey>([...(appTiers.length ? appTiers : c.tiers?.length ? c.tiers : TIERS), ...(own ? [own] : [])]);
	const reach = c.reach ? rank(c.reach) : -1;
	return TIERS.map((t) => ({ tier: t, kind: !has.has(t) ? 'absent' : t === own ? 'own' : rank(t) <= reach ? 'done' : 'todo' }));
}

/** the row's state words, the rollout tab's own: Failing in eu-west / Waiting for approval in 2 prod regions / Waits on
 *  check offline-eval in production / Deploying to dev / Checking in us-east-2 / Healthy in staging / Landed in production */
export function stateWords(c: TChange, s: ChangeState, causes: HeldCause[], yours = false): string {
	const where = c.where;
	switch (s) {
		case 'failed': return `Failing in ${where}`;
		case 'approval': if (yours && c.scope) return c.scope; return `${stateWord('approval', { yours })} in ${where}`;
		case 'held': return `${holdWord(c, causes)} in ${where}`;
		case 'deploying': return `Deploying to ${where}`;
		case 'checking': return `Checking in ${where}`;
		case 'healthy': return `Healthy in ${where}`;
		case 'landed': return `Landed in ${where}`;
	}
}

/** a held change says what holds it in the Holding card's own words ("Waits on check offline-eval") */
export function holdWord(c: Pick<TChange, 'href'>, causes: HeldCause[]): string {
	const h = causes.find((x) => x.rows.some((r) => r.href === c.href));
	return h && h.cause !== 'Held by a rule' ? (h.cause === stateWord('approval') ? h.cause : h.cause.replace(/^Waiting on/, 'Waits on').replace(/^Waiting for/, 'Waits for')) : 'Held';
}

/** the app whose rollout tab the change's place links to (`/rollouts/<cluster>/<ns>/<name>` -> name) */
export function appOf(c: Pick<TChange, 'href' | 'apps' | 'repo'>): string {
	const p = c.href.split('/').filter(Boolean);
	return p[0] === 'rollouts' && p[3] ? p[3] : (c.apps[0] ?? c.repo);
}

/** the phone row's short state ("Waiting · prod"): the state word and the tier slot that carries it, nothing else (r34 changes-6, owner §5) */
const SHORT_WORD: Record<ChangeState, string> = { failed: 'Failing', approval: 'Waiting', held: 'Held', deploying: 'Deploying', checking: 'Checking', healthy: 'Healthy', landed: 'Landed' };
export const shortState = (s: ChangeState, place: string | null): string => (place ? `${SHORT_WORD[s]} · ${place}` : SHORT_WORD[s]);

/** a build without a PR is named by its build mono only ("d0ff17e"), never "Deploy d0ff17e" */
export function changeName(c: Pick<TChange, 'title' | 'prHref' | 'refLabel'>): { ref: string; title: string | null } {
	const t = c.title.trim().toLowerCase();
	const r = c.refLabel.toLowerCase();
	return !c.prHref && (t === r || t === `deploy ${r}`) ? { ref: c.refLabel, title: null } : { ref: c.refLabel, title: c.title };
}

/**
 * A ROW = one place in one state, carrying every change that rides that build. Four changes waiting for the one
 * approval in invoice-api's 2 prod regions are ONE approval, so they are one row with four titles: the approval is
 * stated once and each change once. Landed changes are one row each (each has its own landing time).
 */
/** an approval the viewer can give (rowAction kind approve on the change's place): it is theirs to act on, so it sits under Mine */
export function waitsOnMe(c: Pick<TChange, 'href' | 'group' | 'glyph'>, rows: TRow[]): boolean {
	if (c.group === 'failed' || c.group === 'landed' || c.glyph !== 'approval') return false;
	const r = rows.find((x) => x.href === c.href);
	return !!r && rowAction(r)?.kind === 'approve';
}

export type Ride = { key: string; state: ChangeState; bucket: Bucket; app: string; href: string; items: TChange[]; since: string | null; row: TRow | null; /** the furthest tier a place that runs the change reaches (the detail model's containment), when known */ reach: TierKey | null };
/** what the change's own page says about where it runs (change-words.truthOf): the list's group, strand and words read the SAME places */
export type RideTruth = { landed: boolean; reach: TierKey | null; /** the change page's own statement kind, and the href of the place that leads it (a failing place) */ kind?: string; leadHref?: string | null };
/** a place cannot wait (or fail, or deploy) longer than the change has existed: the age is never older than the merge */
const notBeforeMerge = (since: string | null, mergedAt: string | null | undefined): string | null =>
	since && mergedAt && Date.parse(mergedAt) > Date.parse(since) ? mergedAt : since;
export function rides(items: TChange[], rows: TRow[], leadKey: string | null, truth?: (c: TChange) => RideTruth | null): Ride[] {
	const m = new Map<string, Ride>();
	for (const c of items) {
		let s = changeState(c);
		/* one source for group, strand and words: a change that runs in every production place has LANDED, whatever the roster's own tier says */
		const t = truth && (s === 'healthy' || s === 'landed') ? truth(c) : null;
		if (t?.landed) s = 'landed';
		/* the change page's statement wins over the roster's group: a change whose build FAILS in a place is failing there, not landed (hello-frontend-app 8375506) */
		const href = t?.leadHref && (t.kind === 'failed' || t.landed) ? t.leadHref : c.href;
		if (t?.kind === 'failed' && t.leadHref) s = 'failed';
		const since = notBeforeMerge(c.since, c.mergedAt);
		const k = s === 'landed' ? `landed|${c.key}` : `${s}|${href}|${c.where}`;
		const r = m.get(k) ?? { key: k, state: s, bucket: bucketOf(s), app: appOf(c), href, items: [], since, row: rows.find((x) => x.href === href) ?? null, reach: t?.reach ?? null };
		r.items.push(c);
		r.since = latest([since, r.since]);
		m.set(k, r);
	}
	const out = [...m.values()];
	/* a held or waiting change's age is the wait of the build that waits (the change page's own "waiting 19m"), never the rollout's older hold */
	for (const r of out) if ((r.state === 'approval' || r.state === 'held') && r.row) { const w = buildInQuestionFacts(r.row)?.since; if (w) r.since = notBeforeMerge(w, r.items[0].mergedAt) ?? w; }
	/* changes-7 (X14): a failing place's age is the TAB's own ("failed 20m" = the failing check's end), whichever change the row carries: Mine and Others never disagree about one build */
	for (const r of out) if (r.state === 'failed' && r.row?.since) r.since = notBeforeMerge(r.row.since, r.items[0].mergedAt) ?? r.row.since;
	for (const r of out) r.items.sort((a, b) => newestFirst(a.mergedAt, b.mergedAt));
	const asRow = (r: Ride) => ({
		group: r.state === 'failed' ? 'failed' : r.state === 'approval' ? 'approval' : r.state === 'held' ? 'held' : r.state === 'landed' ? 'rest' : 'moving',
		state: r.state === 'approval' ? 'awaiting-approval' : r.state === 'held' ? 'held-by-rule' : r.state === 'deploying' ? 'deploying' : r.state === 'checking' ? 'checking' : 'healthy',
		tier: ownTier(r.items[0]) ?? 'dev',
		since: r.since
	}) as Parameters<typeof urgency>[0];
	const lead = (r: Ride) => Number(!!leadKey && r.items.some((c) => c.key === leadKey));
	/* stopped: the lead first, then the shared urgency order; moving: furthest along first; landed: newest first */
	const B: Record<Bucket, number> = { stopped: 0, moving: 1, landed: 2 };
	out.sort((a, b) =>
		a.bucket !== b.bucket ? B[a.bucket] - B[b.bucket]
		: a.bucket === 'stopped' ? lead(b) - lead(a) || urgency(asRow(a), asRow(b))
		: a.bucket === 'moving' ? rank(ownTier(b.items[0]) ?? 'dev') - rank(ownTier(a.items[0]) ?? 'dev') || newestFirst(a.since, b.since)
		: newestFirst(a.since, b.since));
	return out;
}

/** the Tidemark's slots for a ride: a hold sits on the tier of the place that holds it (the tab's own prod "waiting on an approval"), a landed or healthy change
 *  reaches the furthest place that runs it; failing keeps the roster's tier. Tiers below the own tier are done. */
export function rideSlots(r: Pick<Ride, 'state' | 'row' | 'reach' | 'items'>, appTiers: TierKey[] = []): Slot[] {
	const c = r.items[0];
	const held = (r.state === 'approval' || r.state === 'held' || r.state === 'failed') && r.row ? (r.row.tier as TierKey) : null;
	/* one tier source (AD r5 #3): a landed row's words name the tier the roster landed it in; the strand fills at least that far */
	const fromRuns = r.state === 'landed' || r.state === 'healthy' ? (r.state === 'landed' && ownTier(c) && (!r.reach || rank(ownTier(c)!) > rank(r.reach)) ? ownTier(c) : r.reach) : null;
	const own = held ?? fromRuns ?? ownTier(c);
	return slots({ tiers: c.tiers, reach: held ?? fromRuns ?? c.reach, at: own }, appTiers);
}

/** the one action a row offers: exactly the action the Rollouts page offers on the same rollout row (`rowAction`),
 *  and only while the change is in that state (a landed change linking to a failing place offers nothing). */
export function rideAction(r: Pick<Ride, 'state' | 'row'>): TRow['action'] {
	if (!r.row || (r.state !== 'failed' && r.state !== 'approval')) return null;
	return rowAction(r.row);
}

/** the Holding rail names the held REGIONS ("held in us-east-1, ap-southeast-2 · checkout-api") */
export function heldPlace(r: Pick<TRow, 'app' | 'tier' | 'regions' | 'where' | 'place'>): string {
	const named = r.regions.filter((x) => x !== 'prod');
	const where = r.tier === 'prod' ? (named.length ? named.join(', ') : 'production') : r.place || r.where;
	return `held in ${where} · ${r.app}`;
}

export const plural = (k: number, w: string, many = w + 's') => `${k} ${k === 1 ? w : many}`;

/** changes-7 (X12): the page's ONE filled action. Rollouts' lead failing place is the only primary; when several rides share that place only the first (the lead) wears it. */
export function primaryKey(stopped: Pick<Ride, 'key' | 'state' | 'href'>[], primaryHref: string | null): string | null {
	return primaryHref ? (stopped.find((r) => r.state === 'failed' && r.href === primaryHref)?.key ?? null) : null;
}

/** changes-7 (X15): ONE sentence for a row of coloured squares, in the tab's words, naming every colour ("1 failing · 2 waiting"); grey squares are not coloured and are not named.
 *  `heldByRule`: the orange squares are held by a rule (the tab's "Held"), not waiting for an approval. */
export type SquareInk = 'failed' | 'waiting' | 'moving' | 'checking' | 'healthy' | 'behind';
export function squaresSentence(inks: SquareInk[], heldByRule = false): string {
	const n = (k: SquareInk) => inks.filter((x) => x === k).length;
	const parts: [number, string][] = [[n('failed'), 'failing'], [n('waiting'), heldByRule ? 'held' : 'waiting'], [n('moving'), 'deploying'], [n('checking'), 'checking'], [n('healthy'), 'deployed']];
	const out = parts.filter(([k]) => k > 0).map(([k, w]) => `${k} ${w}`).join(' · ');
	return out || (inks.length ? 'not reached' : '');
}

/** changes-7 (X19): a list of tiers reads in PATH order, dev -> test -> staging ("Live in dev, test and staging"), whatever order the detail model sorted it in */
export function pathOrder(words: string): string {
	const m = /^(.* in )((?:[a-z]+, )*[a-z]+ and [a-z]+)$/.exec(words);
	if (!m) return words;
	const names = m[2].split(/, | and /);
	if (!names.every((x) => (TIERS as string[]).includes(x))) return words;
	const sorted = [...names].sort((a, b) => TIERS.indexOf(a as TierKey) - TIERS.indexOf(b as TierKey));
	return m[1] + (sorted.length === 1 ? sorted[0] : `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`);
}

/** changes-7 (X23a): the place in the TAB's env name ("prod-eu-west": the namespace without the app), a folded set of regions by its count ("5 prod regions") */
export function placeShort(r: Pick<Ride, 'href' | 'app' | 'items' | 'state'>): string | null {
	const w = r.items[0]?.where ?? '';
	if (/^\d+ prod regions$/.test(w)) return w;
	/* a landed / healthy row spans the places that run it: the change's own words, not one region */
	if (r.state === 'landed' || r.state === 'healthy') return w === 'production' ? 'prod' : w || null;
	const p = r.href.split('/').filter(Boolean);
	const ns = p[0] === 'rollouts' ? p[2] : null;
	if (!ns) return null;
	return ns.startsWith(`${r.app}-`) ? ns.slice(r.app.length + 1) : ns;
}

/** changes-7 (X13) / changes-9 (Z2): a row that carries several changes labels what it SPANS, counted from what the row shows: "4 changes · 1 held build" (the distinct held builds those changes ride, `heldShown`), else "4 changes · 1 build" (one wording in every state) when none is held */
export function spanLabel(changes: number, heldBuilds: number): string {
	return heldBuilds > 0 ? `${plural(changes, 'change')} · ${plural(heldBuilds, 'held build')}` : `${plural(changes, 'change')} · 1 build`;
}

/* ═══ the Folio's facts (r34 v2): the commits of the build in focus, from the same mock range endpoint the Overview reads ═══ */
export type FolioCommit = { sha: string; title: string; author: string | null; at: string | null; url: string | null };
export type FolioFacts = {
	/** the build in focus (the 20 mono): the failing/deployed build, or the one waiting */
	build: string | null;
	/** the last healthy build of the place (failing rows only) */
	lastGood: { build: string; at: string } | null;
	commits: FolioCommit[];
	/** `+39 −24 · 3 files`, present only when the range endpoint carries it */
	stat: { add: number; del: number; files: number } | null;
};
/** the viewer's own login has the account's picture (avatarSrc); everyone else is a monogram. A face never sits on the viewer's own work. */
export const isViewer = (login: string | null | undefined): boolean => !!login && !!avatarSrc(login);

/* the rollout's own history, read from the same fixture the tabs are served from (data.ts keeps `rawOf` private; a `commitRange(row)` export there would replace this) */
type RawH = { version: { revision?: string; tag?: string; version?: string }; timestamp: string; bakeEndTime?: string; bakeStatus?: string };
const RAWS = () => source().rollouts as unknown as { rollouts: { metadata: { name: string; namespace: string }; status: { history?: RawH[] } }[] }['rollouts'];
const histOf = (href: string): RawH[] => {
	const p = href.split('/').filter(Boolean);
	return p[0] === 'rollouts' ? (RAWS().find((r) => r.metadata.namespace === p[2] && r.metadata.name === p[3])?.status.history ?? []) : [];
};
/** the clock the History tab prints ("Oct 31, 22:19"), in the display zone */
export const clock = (ts: string | null | undefined, withDay = true): string => {
	/* the mock serves every instant shifted to the real clock (home-incident `rebasedHomeFixture`); the tabs print that clock, so do we */
	const d = ts ? new Date(Date.parse(ts) + Date.now() - NOW.getTime()) : null;
	if (!d || isNaN(d.getTime())) return '';
	return d.toLocaleString('en-US', { ...(withDay ? { month: 'short', day: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false, timeZone: displayTimeZone() });
};
/** "1m", "45s", "2h 5m" — the History tab's "Failed after 1m" */
export function span(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}
/** the deploy's own times, as the History entry prints them: started, ended (checks finished / failed), how long it took */
export function deployTimes(href: string): { started: string; ended: string | null; took: string | null } | null {
	const h = histOf(href)[0];
	if (!h) return null;
	const took = h.bakeEndTime ? Date.parse(h.bakeEndTime) - Date.parse(h.timestamp) : NaN;
	return { started: h.timestamp, ended: h.bakeEndTime ?? null, took: isNaN(took) ? null : span(took) };
}

/** the change's title once more in a commit list adds nothing ("Release commit for build x" does; the PR's own title does not) */
const norm = (t: string) => t.replace(/\s*\(#\d+\)\s*$/, '').trim().toLowerCase();
export const addsToTitle = (k: Pick<FolioCommit, 'title'>, prTitle: string) => norm(k.title) !== norm(prTitle);

export function folioFacts(r: Pick<Ride, 'state' | 'row' | 'href'>): FolioFacts {
	const row = r.row;
	/* the build in focus is named as the Rollouts page names it ("2.66.0-66"): the deployed build for a failing/moving/landed place, the waiting one for a gated place */
	const none: FolioFacts = { build: row ? deployedBuild(row).build || buildOf(row) : null, lastGood: null, commits: [], stat: null };
	if (!row) return none;
	if (r.state === 'approval' || r.state === 'held') {
		const hb = candidateBuilds(row);
		return { ...none, build: buildInQuestionFacts(row)?.build ?? hb[0]?.build ?? none.build, commits: hb.map((h) => ({ sha: h.build, title: (h.title ?? '').split('\n')[0], author: h.author, at: null, url: null })) };
	}
	const p = r.href.split('/').filter(Boolean);
	const lg = r.state === 'failed' ? lastHealthy(row) : null;
	/* the range the Overview reads: history[1] -> history[0] by full revision (a short build resolves another ladder rung and reads a different diffstat) */
	const hist = histOf(r.href);
	const base = hist[1]?.version.revision, head = hist[0]?.version.revision;
	if ((r.state === 'failed' || r.state === 'deploying' || r.state === 'checking') && base && head && p[0] === 'rollouts' && p[3]) {
		try {
			/* changes-8 (Y1): the range the TABS read = the home-incident router (it re-headlines a range github-data can only answer with "Release commit for build X" from the fixture's own change: title AND author), github-data's own answer otherwise */
			const j = rangeJson(p[2], p[3], base, head, p[1]) ?? {};
			const commits = (j.commits ?? []).map((c) => ({ sha: c.sha.slice(0, 7), title: (c.message ?? '').split('\n')[0], author: c.author ?? null, at: c.commitDate ?? null, url: c.url ?? null })).reverse();
			return { ...none, lastGood: lg, commits, stat: j.changedFiles ? { add: j.additions ?? 0, del: j.deletions ?? 0, files: j.changedFiles } : null };
		} catch { /* no mock for this app */ }
	}
	return { ...none, lastGood: lg };
}

/** the ONE button label: Approve keeps the product's word (owner has not ruled on approve-in-place); Roll back names its target */
export function actionWords(a: NonNullable<TRow['action']>, row: Pick<TRow, 'state' | 'href'> | null): string {
	if (a.kind === 'rollback') return 'Roll back'; /* owner 2026-11-03: a trigger is the bare verb; the dialog names the build */
	/* changes-9 (Z7): an approval row's button only navigates to the rollout: it says so (owner-open ruling, one form everywhere) */
	if (a.kind === 'approve') return 'Approve';
	return actionLabel(a);
}

/** calm/quiet open the newest change of a bucket (most recent `since`) */
export const newest = (rs: Ride[]): Ride | null => [...rs].sort((a, b) => newestFirst(a.since, b.since))[0] ?? null;

/** the approval a ride's Approve button acts on (data.ts approvalTarget over the ride's own place); null when the ride has none */
export const rideApproval = (r: Pick<Ride, 'row'>, state: HomeState): ApprovalTarget | null => (r.row ? approvalTarget(r.row, state) : null);

/** a state sentence split into units that never break across lines ("5 prod regions", "eu-west", "integration-tests"); the text is unchanged */
export function nowrapParts(words: string): { t: string; nw: boolean }[] {
	const out: { t: string; nw: boolean }[] = [];
	let i = 0;
	for (const m of words.matchAll(/\bin (?:\d+ (?:prod )?regions?|[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*)$|\d+ (?:prod )?regions?|[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)+/g)) {
		if (m.index! > i) out.push({ t: words.slice(i, m.index), nw: false });
		out.push({ t: m[0], nw: true });
		i = m.index! + m[0].length;
	}
	if (i < words.length) out.push({ t: words.slice(i), nw: false });
	return out;
}

/** a commit's age as the range endpoint dates it (the mock stamps commit dates on the real clock, so they are aged on it). Empty when the date is in the future,
 *  and empty when the commit would read YOUNGER than the change's merge ("merged 9h · commit 6h" cannot be true): the tab's age or none, never a contradiction. */
export const commitAge = (at: string | null | undefined, mergedAt?: string | null): string => {
	if (!at || Date.parse(at) > Date.now()) return '';
	if (mergedAt) { const merged = Date.parse(mergedAt) + Date.now() - NOW.getTime(); if (Date.parse(at) > merged) return ''; }
	return formatTimeAgoCompact(at, new Date());
};

/** changes-10 (X3): an approval's button is a link to the rollout's Gates tab, where approvals live (the same target as /needs-you's button); an approval the viewer cannot give is reviewed there too. */
export const gatesTarget = (href: string) => (/\/gates$/.test(href) ? href : href.replace(/\/$/, '') + '/gates');
export function reviewHref(r: Pick<Ride, 'state' | 'href'>, action: { kind: string; href: string } | null | undefined): string | null {
	if (r.state !== 'approval') return null;
	return gatesTarget(action?.kind === 'approve' ? action.href || r.href : r.href);
}
