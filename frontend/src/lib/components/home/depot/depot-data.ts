/**
 * r30 DEPOT — the YARD's data (lineage: new object, name never used before; pocket drew the
 * environments as a vertical spine of text stations, conduit as bands of text; the yard draws each
 * APP as a card on a dotted canvas, placed in the environment band where something is happening to
 * it, Railway-style, with the change in flight attached under the card as a tray).
 *
 * Derived from pocket's `compass` (the real HomeModel + raw histories): no new truth, only a new
 * grouping. Every card answers "which app, where, in what state, carrying whose change".
 */
import type { AppEnv, EnvState } from '$lib/view-models/home-model';
import { changeBySha, ME, NOW, viewerLogin, liveViewer, type HomeState } from '../sketch/home-data';
import { dur } from '../sketch/home-view';
import { changesDoor, compass, TIERS, type Compass, type TierKey } from '../pocket/pocket-data';
import type { GlyphState } from './StateGlyph.svelte';

export const pretty = (login: string | null | undefined) =>
	!login ? null : login.includes('-') ? login.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : login === 'danielreed' ? 'Daniel Reed' : login;
export const isMe = (login: string | null | undefined) => !!login && (login.toLowerCase() === viewerLogin().toLowerCase() || (!liveViewer() && login === 'danielreed'));
export const ago = (iso: string | null | undefined) => (iso ? dur(NOW.getTime() - Date.parse(iso)) : '');

const tierOf = (e: { isProdRegion: boolean; tier: string }): TierKey =>
	e.isProdRegion || e.tier === 'prod' ? 'prod' : e.tier === 'dev' ? 'dev' : e.tier === 'test' ? 'test' : 'staging';
const RANK: Partial<Record<EnvState, number>> = { failed: 0, 'awaiting-approval': 1, deploying: 2, checking: 3, 'held-by-rule': 4 };
const GLYPH: Partial<Record<EnvState, GlyphState>> = { failed: 'failed', 'awaiting-approval': 'approval', deploying: 'deploying', checking: 'checking', 'held-by-rule': 'held' };
const WORD: Partial<Record<EnvState, string>> = { failed: 'Failing', 'awaiting-approval': 'Waits for approval', deploying: 'Deploying', checking: 'Checking', 'held-by-rule': 'Held by a rule' };

export type Tray = { ref: string | null; title: string; who: string | null; mine: boolean; href: string };
export type YardCard = {
	key: string;
	app: string;
	tier: TierKey;
	state: EnvState;
	glyph: GlyphState;
	word: string;
	where: string | null;
	since: string | null;
	href: string;
	tray: Tray | null;
	/** a failure of yours or an approval only you can give: the card is part of "needs you" */
	needsYou: boolean;
	/** the page's lead: drawn as the strip above, the card says so quietly */
	lead: boolean;
};
export type Band = { key: TierKey; name: string; places: number; rest: number; cards: YardCard[]; restApps: string[] };
export type Act = { key: string; at: string; app: string; glyph: GlyphState; verb: string; where: string; ref: string | null; title: string | null; who: string | null; mine: boolean; href: string };
export type Depot = {
	c: Compass;
	bands: Band[];
	figures: { apps: number; envs: number; moving: number; merged: number; mine: number; failing: number; prodFailing: number; approvals: number; deploys: number; prodArrivals: number };
	activity: Act[];
	changes: ReturnType<typeof changesDoor>;
};

const NAME: Record<TierKey, string> = { dev: 'Dev', test: 'Test', staging: 'Staging', prod: 'Production' };

export function depot(state: HomeState): Depot {
	const c = compass(state);
	const { v, m } = c;
	const L = v.lead;
	const leadApp = L ? L.meta.split(' · ')[0] : null;
	const approvalApps = new Set([...v.approvals.map((a) => a.app), ...(L?.kind === 'approval' && leadApp ? [leadApp] : [])]);
	const failApps = new Set([...v.failures.map((f) => f.app), ...(L?.kind === 'failing' && leadApp ? [leadApp] : [])]);

	const bands: Band[] = TIERS.map((key) => {
		const byApp = new Map<string, AppEnv[]>();
		const restApps: string[] = [];
		let places = 0, rest = 0;
		for (const a of m.apps) {
			const here = a.envs.filter((e) => e.state !== 'not-deployed' && tierOf(e) === key);
			if (!here.length) continue;
			places += here.length;
			const busy = here.filter((e) => RANK[e.state] !== undefined);
			rest += here.length - busy.length;
			if (busy.length) byApp.set(a.app, busy);
			else restApps.push(a.app);
		}
		const cards: YardCard[] = [];
		for (const [app, ps] of byApp) {
			const worst = [...ps].sort((x, y) => (RANK[x.state] ?? 9) - (RANK[y.state] ?? 9))[0];
			const same = ps.filter((p) => p.state === worst.state);
			const ver = worst.version?.slice(0, 7) ?? null;
			const mineCh = worst.myChanges.find((ch) => ch.state === worst.state) ?? worst.myChanges[0];
			/* the change IN FLIGHT: on a held/approval place the running version is the OLD one, so the
			   candidate comes from the view's own approval/held rows; on deploying/checking/failed places
			   the running version IS the change. Unknown → no tray (never a wrong one). */
			const ap = worst.state === 'awaiting-approval' ? v.approvals.find((a) => a.app === app) : null;
			const ny = worst.state === 'held-by-rule' || worst.state === 'awaiting-approval' ? v.notYours.find((n) => n.app === app && n.key.endsWith(`@${worst.env}`)) ?? v.notYours.find((n) => n.app === app) : null;
			const held = worst.state === 'held-by-rule' || worst.state === 'awaiting-approval';
			const ch = mineCh
				? { ref: mineCh.ref, title: mineCh.title, author: viewerLogin() }
				: ap
					? { ref: ap.ref ?? ap.build, title: ap.ref ? ap.title : `build ${ap.build}`, author: ap.author }
					: ny
						? { ref: ny.ref, title: ny.title ?? `build ${ny.ref}`, author: ny.whose }
						: held
							? null
							: changeBySha(app, ver);
			const isLead = !!L && leadApp === app && ((L.kind === 'failing' && worst.state === 'failed') || (L.kind === 'approval' && worst.state === 'awaiting-approval'));
			const mine = !!mineCh || isMe(ch?.author);
			cards.push({
				key: `${key}-${app}`,
				app,
				tier: key,
				state: worst.state,
				glyph: GLYPH[worst.state] ?? 'rest',
				word: worst.state === 'awaiting-approval' && approvalApps.has(app) ? 'Waits for your approval' : (WORD[worst.state] ?? worst.state),
				where: key === 'prod' ? (same.length > 1 ? `${same.length} regions` : worst.label === 'prod' ? null : worst.label) : null,
				since: (worst.state === 'awaiting-approval' || worst.state === 'held-by-rule' ? worst.heldSince : null) ?? worst.arrivedAt,
				href: worst.href,
				tray: ch ? { ref: ch.title?.startsWith('build ') ? null : (ch.ref ?? null), title: ch.title ?? `build ${ver}`, who: pretty(ch.author), mine, href: worst.href } : !held && ver ? { ref: null, title: `build ${ver}`, who: null, mine: false, href: worst.href } : null,
				needsYou: (worst.state === 'failed' && failApps.has(app)) || (worst.state === 'awaiting-approval' && approvalApps.has(app)),
				lead: isLead
			});
		}
		cards.sort((a, b) => (a.lead ? -1 : 0) - (b.lead ? -1 : 0) || (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || Number(b.needsYou) - Number(a.needsYou) || a.app.localeCompare(b.app));
		return { key, name: NAME[key], places, rest, cards, restApps };
	}).filter((b) => b.places);

	const failing = (L?.kind === 'failing' ? 1 : 0) + v.failures.length;
	const ch = changesDoor(state);
	const activity: Act[] = c.activity.map((a) => ({
		key: a.key,
		at: a.at,
		app: a.app,
		glyph: a.kind === 'failed' ? 'failed' : 'arrived',
		verb: a.kind === 'failed' ? 'Failed in' : 'Arrived in',
		where: a.env === 'prod' ? 'production' : a.env,
		ref: a.ref,
		title: a.title,
		who: pretty(a.author),
		mine: isMe(a.author),
		href: a.href
	}));
	return {
		c,
		bands,
		figures: {
			apps: c.apps.length,
			envs: bands.length,
			moving: c.tiers.reduce((n, t) => n + t.moving.length, 0),
			merged: ch.merged24,
			mine: ch.mine24,
			failing,
			prodFailing: v.prod.failing.length,
			approvals: v.approvals.length + (L?.kind === 'approval' ? 1 : 0),
			deploys: c.pulse.total,
			prodArrivals: c.pulse.prodArrivals
		},
		activity,
		changes: ch
	};
}
