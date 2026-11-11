/**
 * changes-7 (X12): what the change's places say about it, as the History tab does. `change-words.truthOf` calls a place FAILING for a change
 * whenever the place's current build fails and carries the change. But a place that already ran the change HEALTHILY (an earlier build
 * of the same place, "a11c101 · Add currency precision check", Succeeded) did not fail on it: the failing build is a later change's
 * (#37 in a11c202). Such a change has landed there; it is not "Failing in eu-west", it offers no roll back.
 */
import type { HomeState, TChange } from './data';
import { historyOfChange, regionStates } from './data';
import { TIERS, squaresSentence, type RideTruth, type SquareInk } from './change-view';
import { classified, statementOf } from './change/detail-model';

export function rideTruth(c: TChange, scenario: HomeState): RideTruth {
	const { all, places } = classified(c, scenario);
	const hist = historyOfChange(c, scenario);
	const ps = places.map((p) => (p.kind === 'failed' && hist.some((h) => h.href === p.href && h.outcome === 'Succeeded') ? { ...p, kind: 'running' as const } : p));
	const running = ps.filter((p) => p.kind === 'running');
	const reach = running.reduce<RideTruth['reach']>((b, p) => (b === null || TIERS.indexOf(p.tier) > TIERS.indexOf(b) ? p.tier : b), null);
	const st = statementOf(c, ps, all);
	/* r34 r2: a change that runs healthily in EVERY place its app has has landed, even when the app has no production tier (checkout-worker: dev + staging) */
	const everywhere = st.kind === 'healthy' && ps.length > 0 && ps.every((p) => p.kind === 'running') && all.every((u) => ps.some((p) => p.href === u.href));
	return { landed: st.kind === 'landed' || everywhere, reach, kind: st.kind, leadHref: st.lead?.href ?? null };
}

/** changes-9 (Z2): the held builds a ride SHOWS: the distinct held builds its changes ride, never the gate's whole queue ("4 changes · 5 held builds" printed 4 PRs of 1 build) */
export function heldShown(items: Pick<TChange, 'heldBuild'>[]): number {
	return new Set(items.map((c) => c.heldBuild?.build).filter((b): b is string => !!b)).size;
}

/**
 * changes-11 (V1): the prod squares of the opened scale are the REGION's state in the tab's colours (regionStates: red failing, orange held/waiting,
 * green only where the tab is green, grey behind), never "this change is live here" recoloured. The sentence derives from the same inks, so the squares
 * and the words cannot disagree. "Your change is live here" is said by the Places list's Live word.
 */
export function regionSquares(app: string, scenario: HomeState): { inks: SquareInk[]; heldRule: boolean; sentence: string } {
	const regions = regionStates(app, scenario);
	const heldRule = regions.some((r) => r.state === 'held-by-rule') && !regions.some((r) => r.state === 'awaiting-approval');
	const inks = regions.map((r) => (r.ink === 'moving' && r.state === 'checking' ? 'checking' : r.ink === 'healthy' && r.currency !== 'none' && !r.onNewest ? 'behind' : r.ink) as SquareInk);
	return { inks, heldRule, sentence: squaresSentence(inks, heldRule) };
}
