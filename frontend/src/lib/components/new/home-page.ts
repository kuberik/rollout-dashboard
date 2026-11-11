/**
 * THE HOME PAGE VIEW-MODEL (r39 build; mock .work/home-r34/direction/r39/home.html + kit/model.js `homeModel`/`homeAsks`/`fleetModel`).
 * Pure composition over the data.ts helpers and the Changes view-model (the SAME classification of the viewer's changes), so Home, Changes and
 * Rollouts can never disagree about a rollout or a change. Nothing is invented here:
 *   asks      the rollouts that need the viewer (data.ts `inbox`: failures of their changes, approvals they can give), failures first
 *   repos     "Your changes": the viewer's repos with something in flight, MINUS the changes an ask already carries (each fact once)
 *   landed    the viewer's changes that landed today (the section header's right-hand link)
 *   fleet     trouble elsewhere (failing / held rollouts that are not the viewer's) and the last deploys
 * Honest fallbacks: the list payload has no `observations[]`, so a failing ask leads with the check NAME + message (attention.ts), never a
 * figure; an approval ask leads with "N of M prod regions" only when `regionStates` says several prod regions wait (the count the change's own
 * line prints), else it is title-led. The viewer is 'you', never their own avatar; the lane drawing is built by the component (Footprint `laneOf`).
 */
import { liveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { approvalIdentity,
	inbox, rollouts, fleet24hEvents, ago, isViewer, personOf, holdSince, buildInQuestionFacts, gateName, regionStates, pretty, buildIdentity, NOW, type HomeState, type TRow
} from './data';
import { rowAction, actionHref } from './rollout-view';
import { chipPlace, changeLineOf } from './rollouts-page';
import { classifyChanges, groupByRepo, cardOf, tiersOf, type RepoGroup, type Rollup } from './changes-page';
import { TIERS } from './change-view';
import { severity, approvalWord } from './state-words';
import { siteCount, siteKey, regionsPhrase } from '$lib/view-models/regions';
import { attentionModel, type AttentionModel } from '$lib/view-models/attention';
import type { RepoCardModel } from '$lib/view-models/repo-card';

export type AskItem = {
	key: string;
	row: TRow;
	model: AttentionModel;
	app: string;
	href: string;
	failed: boolean;
	rollbackHref: string | null;
	/** the change the ask is about: its PR ref and title, who wrote it ('you' = the viewer) */
	id: { name: string; ref?: string; title?: string; person?: string; you?: boolean };
};
/** `mark` is the StatusMark state of the row: failing, held by a rule, waiting on an approval, or moving (QA #6: an approval-held or moving rollout must show on Home even when it is not the viewer's ask). */
export type FleetTrouble = { key: string; app: string; failing: boolean; mark: 'failed' | 'held' | 'approval' | 'deploying' | 'checking'; word: 'Failing' | 'Held' | 'Waiting for approval' | 'Needs your approval' | 'Deploying' | 'Checking'; href: string; places: { tier: string; place: string }[] };
export type FleetDeploy = { key: string; app: string; tier: string; place: string; at: string; age: string; failing: boolean; href: string };
export type HomePage = {
	asks: AskItem[];
	asksRollup: Rollup;
	repos: { repo: string; href: string; card: RepoCardModel }[];
	landedToday: { count: number; title: string; href: string } | null;
	fleet: { trouble: FleetTrouble[]; deploys: FleetDeploy[] };
	counts: { failing: number; toApprove: number };
	/** nothing needs the viewer: the calm state */
	calm: boolean;
};

/** the one severity order (state-words.ts SEVERITY), keyed by the row's mark */
const SEV_STATE = { failed: 'failed', approval: 'awaiting-approval', held: 'held-by-rule', deploying: 'deploying', checking: 'checking' } as const;
const TROUBLE_ORDER = (m: keyof typeof SEV_STATE) => severity(SEV_STATE[m]);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const nice = (p: string | null | undefined): string | undefined => (p ? pretty(p) ?? p : undefined);

/** who wrote the change an ask is about: the failing build for a failure, the held build for an approval */
function identityOf(r: TRow, hs: HomeState, failed: boolean): AskItem['id'] {
	if (failed) {
		const c = changeLineOf(r);
		return { name: r.app, ref: c?.ref, title: c?.title, person: c?.you ? undefined : nice(c?.person), you: c?.you };
	}
	const a = approvalIdentity(r);
	return { name: r.app, ref: a.ref, title: a.title, person: a.person, you: a.you };
}

/** one ask (the card model of a failing place or an approval the viewer can give); `noTier` = the page is one tier (/envs/<name>): no tier chip, the place is the title line's */
export function askOf(r: TRow, hs: HomeState, o: { noTier?: boolean } = {}): AskItem {
	const failed = r.group === 'failed';
	const a = rowAction(r);
	const id = identityOf(r, hs, failed);
	const model = attentionModel({
		state: failed ? 'failed' : 'approval',
		age: failed ? ago(r.since) : ago(holdSince(r, hs) ?? buildInQuestionFacts(r)?.since ?? r.since),
		tier: o.noTier ? '' : r.tier, place: (/regions?$/.test(chipPlace(r) ?? '') ? '' : chipPlace(r)) ?? '',
		check: failed ? { name: r.failure?.check ?? null, message: r.failure?.message ?? r.failure?.line ?? '' } : null,
		observations: failed ? r.failure?.observations ?? null : null,
		regions: !failed && r.tier === 'prod' ? regionStates(r.app, hs) : null,
		gateSentence: failed ? null : gateName(r, hs)?.sentence ?? null,
		title: id.title ?? r.app
	});
	return { key: r.key, row: r, model, app: r.app, href: r.href, failed, rollbackHref: failed && a?.kind === 'rollback' ? actionHref(a) : null, id };
}

export function homePage(hs: HomeState, starred?: ReadonlySet<string>): HomePage {
	const R = rollouts(hs, starred);
	/* failures first (prod before the rest: the roster's urgency order already does it), then approvals; the sort is stable */
	const rows = inbox(hs, starred).items.map((i) => i.row).sort((a, b) => Number(b.group === 'failed') - Number(a.group === 'failed'));
	const asks = rows.map((r) => askOf(r, hs));
	const failing = asks.filter((a) => a.failed).length;
	const toApprove = asks.length - failing;
	const askKeys = new Set(rows.map((r) => r.key));

	const { mineP } = classifyChanges(hs);
	/* "Your changes": what is in flight and not already carried by an ask above; a repo whose every change is an ask is not repeated */
	const live = mineP.filter((p) => p.state !== 'landed' && !(p.ride.row && askKeys.has(p.ride.row.key)));
	const landedAll = mineP.filter((p) => p.state === 'landed');
	const groups = groupByRepo(live).map((g): RepoGroup => ({ ...g, landed: landedAll.filter((l) => l.c.repo === g.repo) }));
	const repos = groups.map((g) => ({ repo: g.repo, href: g.href, card: cardOf(g, tiersOf([...g.changes, ...g.landed])) }));

	const today = NOW.toISOString().slice(0, 10);
	const landedTodayP = landedAll.filter((p) => (p.ride.since ?? p.c.since ?? '').slice(0, 10) === today);
	const landedToday = landedTodayP.length
		? { count: landedTodayP.length, title: landedTodayP.map((p) => `${p.ride.app} ${p.ref} ${p.c.title}`).join('\n'), href: '/changes' }
		: null;

	/* Fleet: what is going on elsewhere = failing / held / approval-waiting / moving rollouts that are not the viewer's and not an ask, one per app + state */
	const mineKeys = new Set(mineP.map((p) => p.ride.row?.key).filter((k): k is string => !!k));
	const by = new Map<string, FleetTrouble & { since: string }>();
	for (const r of R.rows) {
		if ((r.group !== 'failed' && r.group !== 'held' && r.group !== 'approval' && r.group !== 'moving') || askKeys.has(r.key) || mineKeys.has(r.key)) continue;
		const failedRow = r.group === 'failed';
		const k = `${r.app}|${r.group}`;
		const place = (chipPlace(r) ?? '');
		const kind = failedRow ? { mark: 'failed' as const, word: 'Failing' as const }
			: r.group === 'held' ? { mark: 'held' as const, word: 'Held' as const }
			: r.group === 'approval' ? { mark: 'approval' as const, word: approvalWord(false) as FleetTrouble['word'] }
			: r.state === 'checking' ? { mark: 'checking' as const, word: 'Checking' as const } : { mark: 'deploying' as const, word: 'Deploying' as const };
		const x = by.get(k) ?? { key: k, app: r.app, failing: failedRow, ...kind, href: r.href, places: [] as FleetTrouble['places'], since: r.since ?? '' };
		x.places.push({ tier: r.tier, place });
		if ((r.since ?? '') < x.since) x.since = r.since ?? '';
		by.set(k, x);
	}
	const trouble = [...by.values()].sort((a, b) => TROUBLE_ORDER(a.mark) - TROUBLE_ORDER(b.mark) || a.since.localeCompare(b.since)).map(({ since: _s, ...t }) => t);

	const failingApps = new Set(R.rows.filter((r) => r.group === 'failed').map((r) => r.app));
	/* QA round 2 B1: ONE row per app, never a batch named after its first app. The row is the app's latest deploy: its build, the FURTHEST environment that build reached (a build the dev tier took and staging has not is "dev"), when it last moved. No fact lives only in a tooltip. */
	const byApp = new Map<string, ReturnType<typeof fleet24hEvents>>();
	for (const e of fleet24hEvents(hs)) byApp.set(e.app, [...(byApp.get(e.app) ?? []), e]);
	const deploys: FleetDeploy[] = [...byApp.entries()].map(([app, evs]) => {
		const latest = [...evs].sort((p, q) => q.at.localeCompare(p.at))[0];
		const same = evs.filter((x) => x.kind === latest.kind && x.build === latest.build);
		const top = Math.max(...same.map((x) => TIERS.indexOf(x.tier)));
		const there = same.filter((x) => TIERS.indexOf(x.tier) === top);
		const e = there.sort((p, q) => q.at.localeCompare(p.at))[0];
		const raw = e.place.replace(/^prod-/, '');
		/* QA #10: count SITES (distinct places), never events: three redeploys of one build in one place are one place, and a lone default site has no region wording at all */
		const nSites = siteCount(there.map((i) => i.place));
		const place = regionsPhrase(nSites) ?? (siteKey(raw) === 'default' ? '' : raw);
		const at = same.reduce((m, x) => (x.at > m ? x.at : m), e.at);
		return { key: `${latest.kind}|${latest.build}|${app}`, app, tier: e.tier, place, at, age: ago(at), failing: latest.kind === 'failed' && failingApps.has(app), href: nSites === 1 ? e.href : `/apps/${encodeURIComponent(app)}` };
	}).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

	return {
		asks,
		asksRollup: [...(failing ? [{ text: `${failing} failing`, ink: 'danger' as const }] : []), ...(toApprove ? [{ text: `${toApprove} to approve`, ink: 'held' as const }] : [])],
		repos, landedToday,
		fleet: { trouble, deploys },
		counts: { failing, toApprove },
		calm: !asks.length
	};
}
export { plural as _plural, TIERS as _TIERS };

/**
 * The Home nav item's badge: how many asks Home's Attention shows (the same `inbox` rows `homePage` draws as cards), read from the LIVE
 * source only. Null until a page has installed the live FleetSource (FleetGate), so the badge never counts the built-in fixture.
 */
export function homeAskCount(): number | null {
	if (!liveSource()) return null;
	return inbox('incident').items.length;
}
