/**
 * View-model of the Changes "Cards" page: which rides are cards, the fact line of a card and of a row, the diff slot.
 * Pure functions over change-view / data output; nothing here invents a fact.
 */
import type { TChange } from './data';
import { rideAction, addsToTitle, folioFacts, type Ride, type ChangeState } from './change-view';

/** the state word of a card's fact line and a row's place text, the product's own (Failing, Waiting, Held, Checking, Deploying) */
export const STATE_WORD: Record<ChangeState, string> = { failed: 'Failing', approval: 'Waiting', held: 'Held', deploying: 'Deploying', checking: 'Checking', healthy: 'Healthy', landed: 'Landed' };
/** the hue class of a state word (state only; healthy and landed are neutral) */

/** a ride needs the viewer when it fails, or waits for an approval the viewer can give (rideAction = Rollouts' own rowAction) */
export const needsViewer = (r: Ride): boolean => r.state === 'failed' || (r.state === 'approval' && rideAction(r)?.kind === 'approve');

/**
 * The words after the state word, with the leading verb phrase folded into it: "Waits for approval in 2 prod regions" ->
 * "approval in 2 prod regions", "Checking in us-east-2" -> "in us-east-2". The place segment ("prod-ap-south") of a viewer's own
 * approval is dropped (the journey strip names the place) and so is the trailing "waiting" after the region count.
 */
export function factRest(words: string, _state?: ChangeState): string {
	let w = words.replace(/ · prod-[a-z0-9-]+(?= ·)/i, '').replace(/(\d+ of \d+ regions?) waiting$/i, '$1');
	w = w.replace(/^(Waits|Waiting|Failing|Checking|Deploying|Held|Healthy|Landed)\b( for)?\s*/i, '');
	return w;
}

/** the diff slot: the range's own size, only when the range carries this change (a commit of that title is in it); otherwise empty, never invented */
export function diffOf(r: Ride, c: TChange): { add: number; del: number } | null {
	if (r.state !== 'failed' && r.state !== 'deploying' && r.state !== 'checking') return null;
	const f = folioFacts(r);
	if (!f.stat || !f.commits.some((k) => !addsToTitle(k, c.title))) return null;
	return { add: f.stat.add, del: f.stat.del };
}

/** the failing line of a card: the failing check's message (the check's name rides behind it, in the title attribute) */
export function failureLine(c: TChange): { text: string; check: string | null } | null {
	const f = c.failure;
	if (!f) return null;
	return f.check ? { text: f.message?.split(/;\s/)[0] ?? f.line, check: f.check } : { text: f.line, check: null };
}

/**
 * r34 r2: a commit and the PR that merged it are ONE change. A commit-only item (no PR number) whose app and title equal a PR item's is
 * that PR's merge commit seen on its own: the list keeps the PR (the object with a page and a number) and drops the bare commit, so
 * "Add regional failover for mesh sidecars" is not both Checking and #77 Landed.
 */
export function dedupeCommitOfPr<T extends Pick<TChange, 'title' | 'prNumber' | 'apps'>>(items: T[]): T[] {
	const key = (c: T) => `${c.apps.join(',')}|${(c.title ?? '').trim().toLowerCase()}`;
	const prs = new Set(items.filter((c) => c.prNumber != null).map(key));
	return items.filter((c) => c.prNumber != null || !c.title || !prs.has(key(c)));
}

/**
 * r34 r2 (truth): ONE N-of-M for an approval's scope, the one /apps prints (Facia `waitScope`): the prod regions that WAIT, of the app's
 * prod regions ("5 of 6 regions", "6 regions" when all). The fact line of a card used the roster row's fold ("1 of 5 regions waiting":
 * the one place the viewer's Approve acts on, of the five the row folds) beside a journey that said "1 of 6": three numbers for one
 * wait. `states` = data.regionStates(app). Returns null when the app has one prod place or none waits.
 */
export function waitScope(states: { ink: string }[]): string | null {
	const k = states.filter((r) => r.ink === 'waiting').length;
	if (states.length < 2 || !k) return null;
	return k === states.length ? `${k} regions` : `${k} of ${states.length} regions`;
}
/** replace the row-fold's "1 of 5 regions" in a fact with the shared scope */
export const withScope = (fact: string, scope: string | null): string => (scope ? fact.replace(/\b\d+ of \d+ regions?\b/, scope) : fact);
