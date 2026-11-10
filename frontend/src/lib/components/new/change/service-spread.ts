/**
 * Per-service placement of a multi-service change (platform-telemetry #20 ships as four apps). ONE pure function, read by the change page,
 * the Changes repo cards, Home "Your changes" and attention (via classifyChanges), so they cannot disagree.
 * Each service stands at its own position, taken from the change page's own place classification (`classified`: a place RUNS the change /
 * WAITS for it at a gate / FAILS on it). The change's headline position is its LEAST advanced service; its headline state is its WORST
 * service's, with that service named. Reference: design/visuals-r42 226ffc78 (servicesOf / spreadOf), re-based on `classified`, whose
 * lookup is by the change's REPO (not the app name), so a gate holding the change's build is found on every service.
 */
import type { TChange, HomeState } from '../data';
import { classified } from './detail-model';
import { mostSevere } from '../state-words';

const RANK: Record<string, number> = { merged: 0, dev: 1, test: 2, staging: 3, prod: 4 };
export type SvcState = 'failed' | 'approval-yours' | 'held' | 'deploying' | 'checking' | 'approval' | 'landed';
/** `tier` = the furthest tier whose current build carries the change; `next` = the tier whose gate holds the change's build; `done` = runs healthily in the app's last tier */
export type Svc = { app: string; tier: string; state: SvcState; next: string | null; since: number | null; href: string | null; done: boolean };
/** a service's state in the product's ONE severity order (state-words.ts SEVERITY): what needs a person outranks checking / deploying */
const SEV_KEY: Record<SvcState, string> = { failed: 'failed', 'approval-yours': 'awaiting-approval', approval: 'awaiting-approval', held: 'held-by-rule', checking: 'checking', deploying: 'deploying', landed: 'healthy' };
const ms = (s: string | null | undefined) => Date.parse(s ?? '') || null;

export function servicesOf(c: TChange, hs: HomeState): Svc[] | null {
	if (c.apps.length < 2) return null;
	const { all, places } = classified(c, hs);
	return [...c.apps].sort().map((app) => {
		const last = all.filter((u) => u.app === app).reduce((m, u) => (RANK[u.tier] > RANK[m] ? u.tier : m), 'merged');
		const runs = places.filter((x) => x.app === app && x.kind === 'running');
		const reached = runs.reduce((m, u) => (RANK[u.tier] > RANK[m] ? u.tier : m), 'merged');
		const fail = places.find((x) => x.app === app && x.kind === 'failed');
		if (fail && RANK[fail.tier] >= RANK[reached]) return { app, tier: fail.tier, state: 'failed' as const, next: null, since: ms(fail.since), href: fail.href, done: false };
		const gate = places.filter((x) => x.app === app && x.kind === 'waiting' && RANK[x.tier] > RANK[reached]).sort((a, b) => RANK[a.tier] - RANK[b.tier])[0];
		if (gate) {
			const st: SvcState = gate.group === 'held' ? 'held' : gate.row?.action?.kind === 'approve' ? 'approval-yours' : 'approval';
			return { app, tier: reached, state: st, next: gate.tier, since: ms(gate.since), href: gate.href, done: false };
		}
		const here = runs.filter((x) => x.tier === reached);
		const moving = here.find((x) => x.state === 'deploying') ?? here.find((x) => x.state === 'checking');
		const done = reached === last && !moving;
		const at = here.map((x) => ms(x.at)).filter((n): n is number => n != null).sort((a, b) => b - a)[0] ?? null;
		return { app, tier: reached, state: moving ? (moving.state as SvcState) : done ? 'landed' : 'checking', next: null, since: at, href: (moving ?? here[0])?.href ?? null, done };
	});
}

/** the change's headline: its LEAST advanced service's tier, its WORST service's state, and that service's name */
export function spreadOf(svcs: Svc[]): { col: string; state: SvcState; service: string; inLast: number; last: string } {
	const col = svcs.reduce((m, s) => (s.done ? m : (RANK[s.tier] ?? 0) < (RANK[m] ?? 9) ? s.tier : m), 'prod-done');
	/* equals: the one the viewer can act on first, then the furthest along (prod before dev) */
	const order = [...svcs].sort((a, b) => Number(b.state === 'approval-yours') - Number(a.state === 'approval-yours') || (RANK[b.next ?? b.tier] ?? 0) - (RANK[a.next ?? a.tier] ?? 0));
	const worst = mostSevere(order, (s) => SEV_KEY[s.state])!;
	const last = svcs.reduce((m, s) => ((RANK[s.tier] ?? 0) > (RANK[m] ?? 0) ? s.tier : m), 'merged');
	return { col: col === 'prod-done' ? last : col, state: worst.state === 'landed' ? 'checking' : worst.state, service: worst.app, inLast: svcs.filter((s) => s.done).length, last };
}
