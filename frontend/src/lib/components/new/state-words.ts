/**
 * THE ONE STATE VOCABULARY (r34 r2-shared, AD round 2): every list, path station and row prints a state with these words, in this
 * case, in this hue. `/apps` (EnvSlots) is the reference. Sentence case, no verbs of motion for a hold:
 *   failed -> "Failing"            approval -> "Waiting for approval" ("Needs your approval" when the viewer can give it; ONE helper, `approvalWord`)
 *   held -> "Held"                 deploying -> "Deploying"             checking -> "Checking"
 * `compact` is for a slot that is 104px wide (a StagePath M station label): the approval word is "Waiting" there and the full
 * phrase rides the station's title / aria-label (never dropped). Healthy / landed / at rest are NOT states: neutral, no word.
 */
import { TONE } from '$lib/view-models/state-tone';

export type StateKind = 'failed' | 'approval' | 'held' | 'deploying' | 'checking';

/** accepts the product's other spellings of the same five states */
const ALIAS: Record<string, StateKind> = {
	failed: 'failed', failing: 'failed', stuck: 'failed',
	approval: 'approval', waiting: 'approval',
	held: 'held', hold: 'held',
	deploying: 'deploying', current: 'deploying',
	checking: 'checking'
};
export const stateKind = (s: string | null | undefined): StateKind | null => (s ? (ALIAS[s] ?? null) : null);

export function stateWord(s: string | null | undefined, o: { yours?: boolean; compact?: boolean } = {}): string | null {
	const k = stateKind(s);
	if (!k) return null;
	switch (k) {
		case 'failed': return 'Failing';
		case 'approval': return o.compact ? 'Waiting' : o.yours ? 'Needs your approval' : 'Waiting for approval';
		case 'held': return 'Held';
		case 'deploying': return 'Deploying';
		case 'checking': return 'Checking';
	}
}

/** the hue of the word: state only (utility classes of the product's own state tokens) */
export const stateInk = (s: string | null | undefined): string => { const k = stateKind(s); return k ? TONE[k].ink : 'text-fg-muted'; };

/** THE ONE APPROVAL WORD (r39 coordinator decision b, 2026-11-08): "Needs your approval" when the viewer can give it, "Waiting for approval" otherwise. */
export const approvalWord = (yours: boolean): string => stateWord('approval', { yours })!;

/** The approval word with its place: "Waiting for approval in prod" / "Needs your approval in staging". Every claim names its place (the subject test); a bare word
 *  is for a column that already is the place (a row's state cell). Facia's banner and the app page's banner both print this. */
export const approvalIn = (yours: boolean, place: string | null | undefined): string => `${approvalWord(yours)}${place ? ' in ' + place : ''}`;

/** The place a rollout row speaks about, as a person says it: a folded prod row is "prod", a single prod site "prod-<site>", else its own place. */
export const rowPlaceName = (r: { regionsOf?: unknown; regions: readonly unknown[]; place: string; tier: string }): string =>
	r.regionsOf || r.regions.length > 1 || r.place === 'production' ? 'prod' : r.tier === 'prod' && !/^prod/.test(r.place) ? `prod-${r.place}` : r.place;

/** THE ONE COUNT PHRASE for places waiting on an approval: "1 needs approval", "3 need approval" (QA2 #6; /apps and /envs/<name> print it). */
export const needApprovalCount = (n: number): string => `${n} ${n === 1 ? 'needs' : 'need'} approval`;

/** THE ONE SEVERITY ORDER lives in `view-models/severity.ts` (its doc comment says why); re-exported here for the pages that already import it from the vocabulary. */
export { SEVERITY_ORDER as SEVERITY, severityRank as severity, mostSevere } from '$lib/view-models/severity';

/** `RolloutAsk` hands its page this until the fleet data `approvalAskAt` reads has answered. */
export const ASK_LOADING = 'loading' as const;
export type AskState = typeof ASK_LOADING | object | null;
/**
 * The held banner on the rollout page and its Gates tab, as ONE view (no late pop-in, the owner's rule: a view loads in place).
 * An approval wait ("prod is waiting on an approval") reads, by what is known: while the fleet loads, the neutral "Waiting for approval in prod" with
 * the action slot RESERVED at the button's size; for an approver "Needs your approval in prod" with the button; for anyone else today's wording and
 * no slot (it collapses). Every other headline is the same in all three states and reserves nothing.
 */
export function askView(ask: AskState, headline: string | null, place: string | null | undefined): { headline: string | null; slot: 'reserved' | 'approve' | 'none' } {
	if (!headline || !/waiting on an approval$/.test(headline)) return { headline, slot: 'none' };
	if (ask === ASK_LOADING) return { headline: approvalIn(false, place), slot: 'reserved' };
	return ask ? { headline: approvalIn(true, place), slot: 'approve' } : { headline, slot: 'none' };
}
