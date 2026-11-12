/**
 * THE CHANGES PAGE VIEW-MODEL (r39 build; mock .work/home-r34/direction/r39/changes.html + kit/model.js `changesModel`).
 * Pure composition over the data.ts / change-view helpers (the SAME classification the change page and the old Changes page used: `rides()` with
 * `rideTruth`, so a change that runs healthily everywhere is landed, a change whose build fails in a place is failing there). Nothing is invented.
 *   banner     the lead failing change of yours (AlertPanel; the change line = that change's title / #ref / you)
 *   attention  the other changes that need you: failing first, then approvals you can give (title-led Attention cards)
 *   mine       "Your changes": one repo card per repo with something in flight (env row + beads, "N landed" at the end)
 *   rest       "At rest": your repos with nothing in flight (quiet rows, newest landed change)
 *   team       "Team": the others' repos in flight (quieter cards, same filled finish)
 * Honest fallbacks: no `observations[]` on the list payload, so a failing card leads with the check NAME + message (attention.ts), never a figure;
 * a prod approval card counts its regions (the region meter, as on Home); other approvals stay title-led.
 */
import { oldestFirst } from '$lib/instant';
import {
	changes, rollouts, ago, isViewer, personOf, personName, waitClock, avatarSrc, regionStates, type HomeState, type TChange, type TRow, type TierKey, noReleasesApp
} from './data';
import { rides, waitsOnMe, rideAction, ownTier, TIERS, type Ride } from './change-view';
import { dedupeCommitOfPr } from './change-cards';
import { rideTruth } from './change-truth';
import { rowAction, actionHref } from './rollout-view';
import { attentionModel, type AttentionModel } from '$lib/view-models/attention';
import { repoCardModel, rollupParts, type RepoCardModel, type RepoChange, type RollupPart } from '$lib/view-models/repo-card';
import type { BeadState } from '$lib/view-models/bead';
import type { ChangeLine } from './rollouts-page';
import { servicesOf, spreadOf, type Svc } from './change/service-spread';

const NONTIER = (w: string | null | undefined) => !!w && !/^(production|prod|staging|dev|test)$/.test(w);

/** the change's short ref: #PR, else the 7-char sha */
export const refOf = (c: Pick<TChange, 'prNumber' | 'ref'>): string => (c.prNumber ? `#${c.prNumber}` : String(c.ref ?? '').slice(0, 7));
/** the tier whose gate holds the change / where it fails: a prod place is "prod", otherwise the change's own tier */
export const gateOf = (c: Pick<TChange, 'where' | 'at'>): string => (/prod/.test(c.where ?? '') ? 'prod' : c.at ?? '');
/** the region / cluster beside the tier when the place is not just the tier ("eu-west") */
export const placeOf = (c: Pick<TChange, 'where'>): string => (NONTIER(c.where) ? c.where.replace(/^prod-/, '').replace(/ prod regions$/, ' regions') : '');

export type PChange = {
	c: TChange;
	ride: Ride;
	state: BeadState;
	/** 'merged' | a tier | 'landed' */
	col: string;
	ref: string;
	mine: boolean;
	/** a change that ships as several services: each at its own stage; `col`/`state` above are the headline (least advanced / worst service) and `worst` names that service */
	services?: Svc[];
	worst?: string;
};

export type AttentionItem = { key: string; p: PChange; model: AttentionModel; href: string; openHref: string; rollbackHref: string | null; yours: boolean; id: { name: string; ref: string; person?: string; you: boolean }; card: RepoCardModel };
export type RepoGroup = { repo: string; changes: PChange[]; landed: PChange[]; flying: number; worst: number; href: string };
export type RestRepo = { key: string; repo: string; href: string; ref: string; title: string; age: string };
export type Banner = { p: PChange; title: string; check: { name: string; message: string } | null; line: string | null; change: ChangeLine; openHref: string; rollbackHref: string | null };
export type Rollup = (string | { text: string; ink: 'danger' | 'held' })[];

export type ChangesPage = {
	banner: Banner | null;
	attention: AttentionItem[];
	attentionRollup: Rollup;
	mine: { repo: string; href: string; card: RepoCardModel }[];
	mineRollup: Rollup;
	rest: RestRepo[];
	team: { repo: string; href: string; card: RepoCardModel }[];
	teamRollup: Rollup;
	counts: { failing: number; toApprove: number; repos: number; restRepos: number; teamRepos: number };
	empty: boolean;
};

const SEV: Record<string, number> = { failed: 0, 'approval-yours': 1, held: 2, deploying: 3, checking: 3, approval: 4, landed: 9 };

/** a ride's own state as a bead state: an approval the viewer can give is `approval-yours` */
function beadState(r: Ride): BeadState {
	if (r.state === 'approval') return rideAction(r)?.kind === 'approve' ? 'approval-yours' : 'approval';
	if (r.state === 'healthy') return 'checking';
	return r.state as BeadState;
}
/** the column a change sits in: a held/waiting change in the tier it reached (null = merged, not deployed yet), a moving / failing one where it is */
function colOf(c: TChange, r: Ride, s: BeadState): string {
	if (s === 'landed') return 'landed';
	if (s === 'approval' || s === 'approval-yours' || s === 'held') return c.reach ?? r.reach ?? 'merged';
	return c.at ?? r.reach ?? ownTier(c) ?? 'merged';
}

export function groupByRepo(ps: PChange[]): RepoGroup[] {
	const m = new Map<string, PChange[]>();
	for (const p of ps) m.set(p.c.repo, [...(m.get(p.c.repo) ?? []), p]);
	return [...m].map(([repo, xs]) => {
		xs.sort((a, b) => Date.parse(a.c.mergedAt) - Date.parse(b.c.mergedAt));
		const fly = xs.filter((x) => x.state !== 'landed');
		return { repo, changes: fly, landed: xs.filter((x) => x.state === 'landed'), flying: fly.length, worst: Math.min(9, ...xs.map((x) => SEV[x.state] ?? 9)), href: xs[xs.length - 1].c.changeHref ?? xs[xs.length - 1].c.href };
	}).sort((a, b) => a.worst - b.worst || b.flying - a.flying || a.repo.localeCompare(b.repo));
}
export const rc = (p: PChange): RepoChange => ({ ref: p.ref, title: p.c.title, state: p.state, col: p.col, href: p.c.changeHref ?? p.c.href, key: p.c.key, noReleases: p.c.apps.length > 0 && p.c.apps.every((a) => !!noReleasesApp(a)) ? noReleasesApp(p.c.apps[0])!.label : undefined });
export function cardOf(g: RepoGroup, tiers: readonly string[], o: { team?: boolean } = {}): RepoCardModel {
	const apps = [...new Set([...g.changes, ...g.landed].flatMap((p) => p.c.apps))];
	return { ...repoCardModel({ repo: g.repo, tiers, changes: g.changes.map(rc), landed: g.landed.map((l) => ({ ref: l.ref, title: l.c.title })), team: o.team, compact: true }), apps };
}
export const tiersOf = (ps: PChange[]) => TIERS.filter((t) => ps.some((p) => p.c.tiers.includes(t)));
/** section rollup: failing takes ink, everything else is subtle (rail-d), then the scope word */
function sectionRollup(ps: PChange[], scope: string): Rollup {
	return [...rollupParts(ps.map((p) => ({ state: p.state }))).map((x) => (x.ink === 'danger' ? { text: x.text, ink: 'danger' as const } : x.text)), scope];
}
const plural = (n: number, w: string, many = w + 's') => `${n} ${n === 1 ? w : many}`;

/** every live change classified once, as the Changes page and Home both read it: the viewer's (mine) and the team's, with the lead failing change's key */
export function classifyChanges(hs: HomeState): { mineP: PChange[]; teamP: PChange[]; leadKey: string | null } {
	const C = changes(hs, { rolledBackLands: true });
	const R = rollouts(hs);
	const live = dedupeCommitOfPr(C.items.filter((i) => !i.rolledBack));
	const isMine = (i: TChange) => i.mine || waitsOnMe(i, R.rows);
	const mineAll = live.filter(isMine);
	const teamAll = live.filter((i) => !isMine(i));
	const leadKey = C.lead && mineAll.includes(C.lead) ? C.lead.key : null;
	const truth = (c: TChange) => rideTruth(c, hs);
	const classify = (items: TChange[], lead: string | null, mine: boolean): PChange[] =>
		rides(items, R.rows, lead, truth).flatMap((ride) => ride.items.map((c) => {
			const state = beadState(ride);
			const p: PChange = { c, ride, state, col: colOf(c, ride, state), ref: refOf(c), mine };
			const services = ride.state === 'landed' ? null : servicesOf(c, hs);
			if (services) { const sp = spreadOf(services); Object.assign(p, { services, col: sp.col, state: sp.state as BeadState, worst: sp.service }); }
			return p;
		}));
	return { mineP: classify(mineAll, leadKey, true), teamP: classify(teamAll, null, false), leadKey };
}

export function changesPage(hs: HomeState): ChangesPage {
	const { mineP, teamP, leadKey } = classifyChanges(hs);

	/* the banner: the first failing change (rides() puts the lead first, then the shared urgency order) */
	const failedP = mineP.filter((p) => p.state === 'failed');
	const lead = failedP.find((p) => p.c.key === leadKey) ?? failedP[0] ?? null;
	const rowOf = (p: PChange): TRow | null => p.ride.row;
	const rollbackOf = (p: PChange): string | null => {
		const r = rowOf(p);
		const a = r ? rowAction(r) : null;
		if (a?.kind === 'rollback') return actionHref(a);
		return p.c.action && /rollback|roll back/i.test(p.c.action.label + p.c.action.href) ? p.c.action.href : null;
	};
	const changeLine = (p: PChange): ChangeLine => { const you = isViewer(p.c.who); const person = personName(p.c.who); return { title: p.c.title, ref: p.ref, person: you ? 'you' : person ?? undefined, you, src: you || !person ? null : avatarSrc(person) ?? null }; };
	const banner: Banner | null = lead
		? { p: lead, title: `${lead.ride.app} failed in ${gateOf(lead.c) || lead.c.at}${placeOf(lead.c) ? ` · ${placeOf(lead.c)}` : ''}`, check: lead.c.failure?.check ? { name: lead.c.failure.check, message: lead.c.failure.message ?? '' } : null, line: lead.c.failure?.line ?? null, change: changeLine(lead), openHref: lead.ride.href, rollbackHref: rollbackOf(lead) }
		: null;

	/* Attention: your changes that need you (failing, or an approval you can give), minus the banner's; failing first, then oldest ask first */
	const askSince = (p: PChange): string | null => {
		const r = rowOf(p);
		if (p.state === 'approval-yours') return (r ? waitClock(r, hs) : null) ?? p.ride.since ?? p.c.since;
		return p.ride.since ?? p.c.since;
	};
	const attP = mineP.filter((p) => (p.state === 'failed' || p.state === 'approval-yours') && p !== lead)
		.sort((a, b) => Number(b.state === 'failed') - Number(a.state === 'failed') || oldestFirst(askSince(a), askSince(b)));
	const attention: AttentionItem[] = attP.map((p) => {
		const failed = p.state === 'failed';
		const you = isViewer(p.c.who);
		const person = personName(p.c.who);
		const model = attentionModel({
			state: failed ? 'failed' : 'approval', age: ago(askSince(p)), tier: failed ? p.c.at ?? '' : gateOf(p.c), place: failed ? placeOf(p.c) : '',
			check: failed ? { name: p.c.failure?.check ?? null, message: p.c.failure?.message ?? p.c.failure?.line ?? '' } : null,
			observations: failed ? p.c.failure?.observations ?? null : null,
			regions: !failed && gateOf(p.c) === 'prod' ? regionStates(p.ride.app, hs) : null,
			gateSentence: failed || (p.c.scope ?? '').includes(' of ') ? null : (p.c.scope ?? '').replace(/^Wait(?:s|ing) for your approval · /, '').replace(/^prod-/, '') || null,
			title: p.c.title
		});
		const one: RepoGroup = { repo: p.c.repo, changes: [p], landed: [], flying: 1, worst: 0, href: '' };
		return {
			key: p.c.key, p, model, href: p.c.changeHref ?? p.ride.href, openHref: p.c.changeHref ?? p.ride.href, rollbackHref: failed ? rollbackOf(p) : null, yours: !failed,
			id: { name: p.ride.app, ref: p.ref, person: you ? undefined : person ?? undefined, you },
			card: cardOf(one, TIERS.filter((t) => p.c.tiers.includes(t)))
		};
	});

	const mineG = groupByRepo(mineP), teamG = groupByRepo(teamP);
	const mineFly = mineG.filter((g) => g.flying), restG = mineG.filter((g) => !g.flying);
	const teamFly = teamG.filter((g) => g.flying);
	const people = new Set(teamP.filter((p) => p.state !== 'landed').map((p) => p.c.who)).size;
	const rest: RestRepo[] = restG.map((g) => { const n = g.landed[g.landed.length - 1]; return { key: g.repo, repo: g.repo, href: n.c.changeHref ?? n.c.href, ref: n.ref, title: n.c.title, age: `landed ${ago(n.ride.since ?? n.c.since ?? n.c.mergedAt)}` }; });
	const failing = attP.filter((p) => p.state === 'failed').length;
	const toApprove = attP.length - failing;

	return {
		banner, attention,
		attentionRollup: [...(failing ? [{ text: `${failing} failing`, ink: 'danger' as const }] : []), ...(toApprove ? [{ text: `${toApprove} to approve`, ink: 'held' as const }] : [])],
		mine: mineFly.map((g) => ({ repo: g.repo, href: g.href, card: cardOf(g, tiersOf([...g.changes, ...g.landed])) })),
		mineRollup: sectionRollup(mineP, plural(mineG.length, 'repo')),
		rest,
		team: teamFly.map((g) => ({ repo: g.repo, href: g.href, card: cardOf(g, tiersOf([...g.changes, ...g.landed]), { team: true }) })),
		teamRollup: sectionRollup(teamP, plural(people, 'person', 'people')),
		counts: { failing: failedP.length, toApprove, repos: mineG.length, restRepos: restG.length, teamRepos: teamFly.length },
		empty: !mineP.length && !teamP.length
	};
}
