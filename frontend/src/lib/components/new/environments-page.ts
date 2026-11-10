/**
 * ENVIRONMENTS page view-model (r39 build; mock .work/home-r34/direction/r39/environments.html, kit parts/envtile.js).
 * Dev / Test / Staging tiles -> Production band (the wide tile, its regions as cells) -> Arrived in production. No Attention band.
 * Every number comes from envsModel (data.ts `environments`, un-flipped so a CHECKING place is never an approval square), `inbound`,
 * `lastDeploy` and `arrivals`; nothing is mock-only. Pure, so it is unit-tested (environments-page.test.ts); the .svelte files only draw.
 *
 * Honest differences from the mock: a tier's "moving" places are worded by what they are (deploying / checking / in progress) where the
 * mock says "deploying" for all; the arrivals window is the product's (ARRIVALS_WINDOW, 12 h) where the mock says 24 h; a last deploy
 * that failed or was rolled back says so ("failed 3m") where the mock prints the age alone.
 */
import { siteCount, siteKey } from '$lib/view-models/regions';
import { envsModel, plural, type Mark } from './envs-model';
import { inbound, isArriving, lastDeploy, ago, ARRIVALS_WINDOW, TIER_NAME, type HomeState, type TierKey } from './data';

export type Ink = 'danger' | 'held' | 'active' | 'muted';
export type StatePart = { text: string; you?: string };
export type TileMark = 'failed' | 'approval-yours' | 'approval' | 'deploying' | 'checking' | 'rest';
export type TileLast = { app: string; build: string; age: string; word: string | null; you: boolean; author: string | null; href: string };
export type RegionCell = { key: string; label: string; mark: Mark; failing: number; waiting: number; moving: number; movingWord: string; href: string };
export type EnvTile = {
	key: TierKey; name: string; href: string; places: number; apps: number;
	failing: number; waiting: number; yours: number; moving: number; rest: number;
	mark: TileMark; lead: StatePart & { ink: Ink }; parts: StatePart[]; calm: boolean; label: string;
	arriving: { builds: number; apps: string[] };
	last: TileLast | null;
	regions: { cells: RegionCell[]; healthy: number } | null;
};
export type Arrival = { key: string; app: string; build: string | null; place: string; age: string; href: string };
export type EnvironmentsPage = { tiles: EnvTile[]; prod: EnvTile | null; arrivals: Arrival[]; window: string; empty: boolean };

/** the state line (kit `envStateLine`): the worst fact leads in its ink, the rest follow muted; nothing adverse = "All N healthy" */
export function stateLine(t: { places: number; failing: number; waiting: number; yours: number; moving: number; rest: number }, movingWord: string): { lead: StatePart & { ink: Ink }; parts: StatePart[]; mark: TileMark } {
	const parts: StatePart[] = [];
	if (t.waiting) parts.push({ text: `${t.waiting} waiting`, you: t.yours ? `${t.yours} for you` : undefined });
	if (t.moving) parts.push({ text: `${t.moving} ${movingWord}` });
	if (t.rest) parts.push({ text: `${t.rest} healthy` });
	const mv: TileMark = movingWord === 'checking' ? 'checking' : 'deploying';
	if (t.failing) return { lead: { text: `${t.failing} failing`, ink: 'danger' }, parts, mark: 'failed' };
	if (t.waiting) return { lead: { ...parts.shift()!, ink: 'held' }, parts, mark: t.yours ? 'approval-yours' : 'approval' };
	if (t.moving) return { lead: { ...parts.shift()!, ink: 'active' }, parts, mark: mv };
	return { lead: { text: `All ${t.places} healthy`, ink: 'muted' }, parts: [], mark: 'rest' };
}

/** a proportional bar's segments, in order (failing · waiting · deploying · healthy); zero segments are dropped */
export function barSegments(t: { failing: number; waiting: number; moving: number; rest: number }): { k: 'f' | 'w' | 'm' | 'r'; v: number }[] {
	return ([['f', t.failing], ['w', t.waiting], ['m', t.moving], ['r', t.rest]] as const).filter(([, v]) => v > 0).map(([k, v]) => ({ k, v }));
}

/** the Production band's cells: the places with something to say (base "production" first among equals), the rest fold to one count */
export function regionCells(m: ReturnType<typeof envsModel>): { cells: RegionCell[]; healthy: number } {
	const word = (mk: Mark) => (mk === 'checking' ? 'checking' : 'deploying');
	const all = [...(m.base ? [m.base] : []), ...m.busy, ...m.rest];
	const cell = (r: (typeof all)[number]): RegionCell => ({ key: r.label + (r.regionless ? '*' : ''), label: r.label, mark: r.mark, failing: r.failing, waiting: r.waiting, moving: r.moving, movingWord: word(r.mark), href: r.envHref });
	/* QA #10: cells are SITES. One site (the default one, or places that share a label) has no region cells and no region wording: the tile's state bar already says it */
	if (siteCount(all.map((r) => (r.regionless ? '' : r.label))) <= 1) return { cells: [], healthy: 0 };
	const adverse = all.filter((r) => r.mark !== 'newest').map(cell);
	return { cells: adverse, healthy: all.length - adverse.length };
}

export function environmentsPage(hs: HomeState): EnvironmentsPage {
	const m = envsModel(hs);
	const tiles = m.tiers.map((t): EnvTile => {
		const rows = t.rows;
		const placesOf = (rs: { regions?: unknown[] }[]) => rs.reduce((n, r) => n + Math.max(1, r.regions?.length ?? 1), 0);
		/* "for you": places whose approval only the viewer can give (a place still checking is not an approval yet) */
		const yours = Math.min(t.waiting, placesOf(rows.filter((r) => r.group === 'approval' && r.needsYou && !r.stillChecking)));
		const kinds = new Set(rows.filter((r) => r.group === 'moving' || r.stillChecking).map((r) => (r.state === 'deploying' ? 'deploying' : 'checking')));
		const movingWord = kinds.size > 1 ? 'in progress' : kinds.has('checking') ? 'checking' : 'deploying';
		const c = { places: t.counts.places, failing: t.failing, waiting: t.waiting, yours, moving: t.moving, rest: t.places - t.failing - t.waiting - t.moving };
		const s = stateLine(c, movingWord);
		const inb = inbound(hs, t.key).filter(isArriving);
		const ld = lastDeploy(hs, t.key);
		const last: TileLast | null = ld ? { app: ld.app, build: ld.build, age: ago(ld.at), word: ld.kind === 'failed' ? 'failed' : ld.kind === 'rolledBack' ? 'rolled back' : null, you: ld.viewerTriggered, author: ld.viewerTriggered ? null : ld.author, href: ld.historyHref } : null;
		return {
			key: t.key, name: TIER_NAME[t.key] ?? t.key, href: `/envs/${t.key}`, places: t.places, apps: t.apps,
			failing: c.failing, waiting: c.waiting, yours, moving: c.moving, rest: c.rest,
			mark: s.mark, lead: s.lead, parts: s.parts, calm: !c.failing && !c.waiting && !c.moving,
			label: `${t.places} places: ${c.failing} failing, ${c.waiting} waiting, ${c.moving} ${movingWord}, ${c.rest} healthy`,
			arriving: { builds: inb.length, apps: [...new Set(inb.map((x) => x.app))] },
			last,
			regions: t.key === 'prod' ? (regionCells(m).cells.length || regionCells(m).healthy ? regionCells(m) : null) : null
		};
	});
	return {
		tiles: tiles.filter((t) => t.key !== 'prod'), prod: tiles.find((t) => t.key === 'prod') ?? null,
		arrivals: m.arrivals.map((a) => ({ key: a.key, app: a.app, build: a.build, place: siteKey(a.place) === 'default' ? '' : a.place, age: ago(a.at), href: a.href ?? `/apps/${a.app}` })),
		window: ARRIVALS_WINDOW, empty: !tiles.length
	};
}
export { plural };
