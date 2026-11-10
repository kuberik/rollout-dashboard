/**
 * JOURNEY LINE ADAPTERS — pure, tested mappers from the PR pipeline
 * (`pr-pipeline.ts`) and the promotion lanes (`promotion-lanes.ts`) into
 * `JourneyStop[]`, the one shape `JourneyLine.svelte` draws. See that
 * component's own doc comment for the role and the references.
 *
 * PURE ON PURPOSE. Every function here is a plain mapping with no side
 * effects and no closures captured into the data it returns — an action
 * descriptor never carries an `onAction` callback (ROUND 3 ruling: "no
 * adapter returns an action that could mutate on its own"). A stop whose
 * action is a mutation (`kind: 'rollback'`) has no `href`; the component's
 * own `onAction` prop is where the caller wires its confirm dialog
 * (`ChangeVersionModal` in rollback mode, exactly like `/apps/[name]`'s
 * `openRollback`). Every other action kind carries an `href` and is a plain
 * link — nothing here can open a dialog or make a request on its own.
 */
import { tierOf, type Tier, type NodeState, type Lane, type LaneNode } from './promotion-lanes';
import { isEnvHeld } from '../rollout-cards';
import { rolloutPath } from '../source-dashboard';
import type { PrCell, PrService, PrState } from './pr-pipeline';
import { shortenVersion } from '../utils';
import { lagLabel } from './env-rank';
// Verbs come from NextStep's one table (DESIGN-LANGUAGE §3.19): the Gates-tab
// link navigates, so it is "Review"; "Why held" has no step of its own.
import { stepLabel } from '$lib/components/NextStep.svelte';

export type JourneyActionKind = 'rollback' | 'review' | 'why-held' | 'open';

export type JourneyAction = {
	kind: JourneyActionKind;
	label: string;
	/** Present for every kind except `rollback`: those are plain links. A
	 *  `rollback` action has none — it is a button, wired to the caller's
	 *  own `onAction` (the confirm dialog), never a navigable URL. */
	href?: string;
};

export type JourneyStopCounts = {
	failed?: number;
	held?: number;
	stuck?: number;
	deploying?: number;
	checking?: number;
	live?: number;
	/** Every subject this stop speaks for at this tier, reached or not. */
	total?: number;
};

export type JourneyStop = {
	key: string;
	tier: Tier;
	/** The environment name as written (`prod-us-east-2`), or `prod` for an
	 *  aggregated prod SET / change-level stop. */
	env: string;
	state: NodeState;
	/** When this stop was reached (its arrival, used for the "+Nm" label).
	 *  `null`/unset on a stop that was never reached. */
	reachedAt?: string | null;
	/** How long the FRONTIER has sat in this state (used for its duration
	 *  label). Same instant as `reachedAt` in practice — one timestamp, two
	 *  readings depending on whether the stop is the frontier. */
	since?: string | null;
	href: string;
	/** The prod SET's own regions, or an aggregated change-stop's member
	 *  envs — only present on an aggregate stop. */
	regions?: { env: string; state: NodeState }[];
	/** The callout's second line — already an honest sentence fragment
	 *  (`PrCell.reason`), never a raw gate id. */
	reason?: string;
	action?: JourneyAction;
	/** Per-tier tally for a change-level (multi-service) stop — see
	 *  `journeyFromChange`. Present only there. */
	counts?: JourneyStopCounts;
	/** The stop's truthful accessible name/title ("prod · rolled back to
	 *  3f1ed09", "prod · not reached yet", "dev · live 4a8d2e6") — supplied
	 *  by the adapter, which alone knows whether the stop was really
	 *  reached. The component never invents one generically (that is how a
	 *  bare sha ends up printed on a stop the subject never reached). */
	label?: string;
	/** The build actually running here, shown after the env name only when
	 *  it differs from the journey's own revision — a later build already
	 *  carrying this change says so instead of looking unreached. */
	buildLabel?: string;
	/** This rollout's own median time-in-state (`PrCell.usuallyMs`), carried
	 *  through so the first not-reached ("next") stop can caption itself
	 *  "next · usually ~5m". */
	usuallyMs?: number | null;
	/**
	 * ⭐ A RESOLVED FAILURE IS NOT A CURRENT FAILURE, AND NOT REACHED EITHER
	 * (design-rollout fix, 2026-10-10, round 2). `true` only on a cell whose
	 * `PrState` is `rolled-back`: the change WAS here, failed, and was rolled
	 * back off this env, which now runs an older build again — the opposite
	 * of "reached and live". The component draws it as a hollow not-reached
	 * ring (never filled, never on the solid segment), skips it when picking
	 * "next", and never gives it the callout — `pickNext`/`pickFrontier`
	 * both read this flag directly rather than re-deriving it from `state`.
	 */
	resolved?: boolean;
};

/** States where the subject has actually arrived — the line is solid up to
 *  the furthest one of these, and only one of these shows a time label that
 *  means "reached" rather than "next"/nothing. */
const REACHED: ReadonlySet<NodeState> = new Set([
	'newest',
	'failed',
	'stuck',
	'held',
	'deploying',
	'checking'
]);

export function isReached(state: NodeState): boolean {
	return REACHED.has(state);
}

/** Worst-first precedence — the same family as `promotion-lanes.ts`'s
 *  `STATE_ORDER`, reused here so the two never disagree about "worse". */
const PRIORITY: NodeState[] = [
	'failed',
	'stuck',
	'held',
	'deploying',
	'checking',
	'behind',
	'newest',
	'none'
];

function worstOf(states: NodeState[]): NodeState {
	let best: NodeState = 'none';
	let bestI = PRIORITY.length;
	for (const s of states) {
		const i = PRIORITY.indexOf(s);
		if (i < bestI) {
			bestI = i;
			best = s;
		}
	}
	return best;
}

/**
 * `PrState` → `NodeState`, per the task's mapping table — with `cell.stuck`
 * and `isEnvHeld` (`rollout-cards.ts`) read FIRST, ahead of the state table:
 * a stuck cell is `'stuck'` no matter its nominal state, and a
 * `gated`/`pinned`/`waiting-upstream` cell only draws `'held'` when
 * `isEnvHeld` confirms the WHOLE rollout is held (every candidate, not just
 * this one) — otherwise it is an ordinary not-yet-reached wait, `'behind'`,
 * same as `queued`/`promoting`. This mirrors `changeStateRankFor`
 * (`rollout-cards.ts`): a bare gate hold on a candidate a newer build could
 * still clear is never promoted to the amber "needs a person" state.
 *
 * ⭐ A RESOLVED FAILURE IS NOT A CURRENT FAILURE, AND NOT REACHED EITHER
 * (design-rollout fix, 2026-10-10, round 2). `rolled-back` IS, by
 * definition, "a failed cell whose rollout's current state is no longer
 * failed" — the operator rolled back, and the env now runs an OLDER build
 * again. Reading it as `'failed'` kept a resolved incident drawn red and
 * eligible to be the frontier's callout forever; reading it as `'newest'`
 * (round 1 of this fix) was also wrong — a filled, reached dot with the
 * solid line running through it says the change is LIVE there, which is
 * false, it was undone. Mapped here to `'behind'`: the same NOT-reached
 * bucket a genuine not-yet-promoted wait uses, so it draws a hollow ring,
 * sits on the dashed segment, and is excluded from `isReached`. It is never
 * picked as "next" either (`pickNext` reads `JourneyStop.resolved`
 * directly, set by this function's callers) — it did not fail to arrive
 * yet, it arrived, failed, and was taken back off. `cellNodeLabel` below is
 * what actually says "resolved" in the node's own label.
 */
export function nodeStateFromCell(
	cell: Pick<PrCell, 'state' | 'stuck' | 'held' | 'superseded'>
): NodeState {
	if (cell.stuck) return 'stuck';
	if (isEnvHeld(cell)) return 'held';
	switch (cell.state as PrState) {
		case 'live':
			return 'newest';
		case 'rolled-back':
			return 'behind';
		case 'failed':
		case 'cancelled':
			/**
			 * ⭐ RED INK ONLY FOR A LIVE FAILURE (tl-integrate qa9 B1, the
			 * same rule JourneyLine must honour). `pr-pipeline.ts`'s own
			 * `earlierLanded` guard already keeps a cell from reporting
			 * `failed` once a LATER build has succeeded here — that case
			 * comes through as `state: 'live', superseded: true` instead,
			 * so `cell.superseded` should never be `true` alongside
			 * `state: 'failed'/'cancelled'` in practice. This branch is
			 * defensive insurance at the adapter boundary, not a path the
			 * current pipeline is known to take: if a superseded failure
			 * ever does reach here, it reads as resolved (`'behind'`,
			 * excluded from `isReached`/the callout) rather than as a
			 * live, red, actionable failure — same bucket `rolled-back`
			 * uses. Callers set `JourneyStop.resolved` from this same
			 * condition (see `journeyFromCells`/`journeyFromChange`).
			 */
			return cell.superseded ? 'behind' : 'failed';
		case 'deploying':
		case 'retrying':
			return 'deploying';
		case 'baking':
			return 'checking';
		case 'queued':
		case 'promoting':
		case 'waiting-upstream':
		case 'gated':
		case 'pinned':
			return 'behind';
		default:
			return 'none';
	}
}

/**
 * A RESOLVED cell — rolled back, or a (defensively-handled) superseded
 * failure/cancellation — is neither a current failure nor reached: the
 * subject was here, is not any more, and nobody needs to act on it now.
 * Every `resolved:` field on a `JourneyStop` is set from this one check so
 * the three adapters below never drift apart on what counts. See
 * `nodeStateFromCell`'s own `failed`/`cancelled` branch for why
 * `superseded` almost never actually holds alongside those states today.
 */
function isResolvedCell(cell: Pick<PrCell, 'state' | 'superseded'>): boolean {
	return (
		cell.state === 'rolled-back' ||
		((cell.state === 'failed' || cell.state === 'cancelled') && cell.superseded)
	);
}

/** The frontier is the furthest REACHED stop in tier order — the one whose
 *  state decides the callout, if it needs one. `null` when nothing has been
 *  reached at all. */
export function pickFrontier(stops: JourneyStop[], tiers: Tier[]): JourneyStop | null {
	const byTier = new Map(stops.map((s) => [s.tier, s] as const));
	let frontier: JourneyStop | null = null;
	for (const t of tiers) {
		const s = byTier.get(t);
		if (s && isReached(s.state)) frontier = s;
	}
	return frontier;
}

/**
 * The first NOT-reached stop AFTER the frontier, in tier order — "next". A
 * `resolved` stop is not reached either, but it is never "next": it
 * already happened and was undone, it is not queued ahead of the subject.
 *
 * ⭐ ROUND (B)-1 FIX — NEVER BEFORE THE FRONTIER. `isReached` does not
 * imply "every earlier tier is also reached" — the stops a caller hands in
 * are not guaranteed contiguous (a held/gated earlier tier can sit behind a
 * later tier that is, for whatever reason, already reached). The frontier
 * is defined as the FURTHEST reached stop, so an earlier not-reached stop
 * is behind it, not ahead of it, and must never be labelled "next" — that
 * reads as "the thing about to happen" on a stop the journey has already
 * passed. Only a not-reached stop strictly AFTER the frontier's tier index
 * can be "next".
 */
export function pickNext(stops: JourneyStop[], tiers: Tier[]): JourneyStop | null {
	const byTier = new Map(stops.map((s) => [s.tier, s] as const));
	const frontier = pickFrontier(stops, tiers);
	const frontierIndex = frontier ? tiers.indexOf(frontier.tier) : -1;
	for (let i = frontierIndex + 1; i < tiers.length; i++) {
		const s = byTier.get(tiers[i]);
		if (s && !isReached(s.state) && !s.resolved) return s;
	}
	return null;
}

/** A callout is owed only when the frontier needs a person or is in flight —
 *  never on a plain `'newest'` frontier (live everywhere so far). */
export function needsCallout(state: NodeState): boolean {
	return state === 'failed' || state === 'stuck' || state === 'held' || state === 'deploying' || state === 'checking';
}

/** The frontier's state as one human word — "Live" once nothing needs a
 *  person (a plain `newest` frontier), else the same word its own callout
 *  headline already uses. Shared so the callout and `journeyFrontier`
 *  below never say two different things about the same stop. */
export function frontierStateWord(state: NodeState): string {
	switch (state) {
		case 'failed':
			return 'Failed';
		case 'stuck':
			return 'Stuck';
		case 'held':
			return 'Held';
		case 'checking':
			return 'Checking';
		case 'deploying':
			return 'Deploying';
		default:
			return 'Live';
	}
}

export type JourneyFrontierInfo = {
	stop: JourneyStop;
	/** The env name the frontier sits in — `stop.env` (the real environment
	 *  name, never the internal tier bucket). */
	place: string;
	/** When the frontier arrived at, or started waiting in, its state —
	 *  `stop.since`, falling back to `stop.reachedAt`. */
	since: string | null;
	/** The frontier's state as one word — see `frontierStateWord`. */
	stateWord: string;
};

/**
 * ⭐ (B)-4 — THE ONE FRONTIER. Every reader of "where has this change
 * reached, and what is it doing there right now" — `JourneyLine`'s own
 * figure and callout, a `HeldBanner`, a Changes-row state word — MUST call
 * this (or read a value this produced), never re-derive `pickFrontier` and
 * a time/word independently. Two call sites computing "now" and "what
 * word" on their own is exactly how the place and the elapsed time drifted
 * apart from each other in earlier rounds (the banner said one environment
 * and duration, the row said another). `null` when nothing has been
 * reached yet — there is no frontier to report.
 */
export function journeyFrontier(stops: JourneyStop[], tiers: Tier[]): JourneyFrontierInfo | null {
	const stop = pickFrontier(stops, tiers);
	if (!stop) return null;
	return {
		stop,
		place: stop.env,
		since: stop.since ?? stop.reachedAt ?? null,
		stateWord: frontierStateWord(stop.state)
	};
}

/**
 * ⭐ THE ONE DURATION FORMAT (lead addendum 2/5, item 1 — "no '+39h 7m'
 * beside '+3d', pick the existing roughLabel/plusDurationLabel family and
 * make every label go through it"). Minutes under an hour, "Xh Ym" from an
 * hour out to 48h, days beyond that — every duration this module prints
 * (signed "+Nm" elapsed-since-merge spans AND bare "waiting"/"live"/
 * "queued" state durations) now calls this one function rather than each
 * keeping its own threshold. `formatTimeAgoCompact` (`utils.ts`) switches
 * to days at 24h instead of 48h — fine for a generic "N ago" timestamp
 * elsewhere in the product, but mixed into this component it produced
 * exactly the inconsistency reported ("+39h 7m" on one stop, "+3d" on the
 * next merely because one crossed 24h and the other crossed 48h).
 */
function bareDurationLabel(ms: number): string {
	const m = Math.round(ms / 60000);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	// Past two days, days: "391h 33m" is a figure nobody reads.
	if (h >= 48) return `${Math.round(h / 24)}d`;
	const rem = m % 60;
	return rem ? `${h}h ${rem}m` : `${h}h`;
}

function minutesLabel(ms: number): string {
	return `+${bareDurationLabel(ms)}`;
}

/** "+24m" — a raw duration (`typicalMs`) as a plus-prefixed span, for a
 *  not-yet-reached stop's "typical +24m" caption. Same formatting as
 *  `reachedLabel`'s `startAt` branch, exported for the component to use
 *  directly on a duration that has no timestamp of its own. */
export function plusDurationLabel(ms: number): string {
	return minutesLabel(ms);
}

/**
 * "+4m" after `startAt` (the journey's own start — a merge), or "live 3h"
 * when no start is given.
 *
 * ⭐ GRAMMAR FIX (lead addendum 2/5) — "live 3h", NOT "3h ago". A reached
 * stop with no known merge time used to read as a bare "N ago", the same
 * phrasing a generic timestamp anywhere else in the product uses — which
 * gave no reason for the duration (ago since WHAT?) and, worse, read as
 * stale/historical on a stop that is in fact the subject's current,
 * healthy state. "live" names what the duration is measuring: how long the
 * subject has been live here. Every other `NodeState` that can reach this
 * branch (a reached stop earlier than the frontier, not held — held has
 * its own `frontierLabel` caption) is, in practice, also a settled,
 * nothing-to-do state, so the same word fits.
 */
export function reachedLabel(at: string, startAt: string | null | undefined, now: Date): string {
	if (startAt) return minutesLabel(new Date(at).getTime() - new Date(startAt).getTime());
	return `live ${bareDurationLabel(now.getTime() - new Date(at).getTime())}`;
}

/** The frontier's own state duration — "6m" in flight, "waiting 3h" held. */
export function frontierLabel(state: NodeState, since: string | null | undefined, now: Date): string {
	if (!since) return '';
	const dur = bareDurationLabel(now.getTime() - new Date(since).getTime());
	return state === 'held' ? `waiting ${dur}` : dur;
}

/**
 * ⭐ (lead addendum 2/5, item 1) — "queued 16d" · the first unreached stop
 * AFTER the frontier (`next`, `pickNext`) names how long it has been
 * sitting there, same bare-duration formatting `frontierLabel` uses (no
 * `+` sign — this is a state duration, not an elapsed-since-merge span).
 * `''` when `since` is unknown — the caller falls back to the bare "next"
 * word in that case, same as before this grammar existed.
 */
export function queuedLabel(since: string | null | undefined, now: Date): string {
	if (!since) return '';
	return `queued ${bareDurationLabel(now.getTime() - new Date(since).getTime())}`;
}

/** "~5m" / "~1h" — the rough caption on the first not-reached ("next")
 *  stop, from `PrCell.usuallyMs`. */
export function roughLabel(ms: number): string {
	const m = Math.round(ms / 60000);
	if (m < 60) return `~${Math.max(1, m)}m`;
	return `~${Math.round(m / 60)}h`;
}

/**
 * ⭐ (lead addendum 5, item 3) — "in 4a8d2e6", only when it differs from the
 * subject's own revision. Centralises what used to be four copies of the
 * same `rev && opts.revision && rev !== opts.revision ? shortenVersion(rev)
 * : undefined` ternary, one per adapter, and adds the "in " prefix every
 * caller was missing — a bare sha sitting next to the env name read as a
 * second, unrelated fact rather than "this is the carrier build serving
 * it". `JourneyLine`'s own doc comment already names this the ONE place a
 * build id repeats ("`F`, the sha once"): this function is that one place.
 */
function carrierBuildLabel(revision: string | null | undefined, subjectRevision: string | null | undefined): string | undefined {
	if (!revision || !subjectRevision || revision === subjectRevision) return undefined;
	return `in ${shortenVersion(revision)}`;
}

function cellHref(cell: Pick<PrCell, 'cluster' | 'namespace' | 'rolloutName'>, sub?: string): string {
	return rolloutPath(cell.cluster, cell.namespace, cell.rolloutName, sub);
}

/**
 * ⭐ (lead addendum 5, item 5) — TRUE ON THE SAME EVIDENCE `holdCause`
 * ITSELF USED. `holdCausePredicate`/`holdCausePhrase` (`blocking-story.ts`)
 * emit the exact phrase "is waiting on an approval" ONLY from their
 * `input.person.length > 0` branch — a BlockingStory-level classification,
 * broader than the single-gate `pick.kind === 'approval'` guess
 * `gateApprovalGuess` is set from (`pr-pipeline.ts` line ~1145). A cell can
 * therefore have `holdCause` already saying "waiting on an approval" while
 * `gateApprovalGuess` stayed `false` (reported: telemetry-indexer still got
 * "Why held" there) — two signals about the same fact, one of them stale.
 * Reading the text `holdCause` itself produced keeps `actionFor` from ever
 * disagreeing with the reason the callout is already showing right next to
 * it.
 */
function holdCauseIsApproval(holdCause: string | null | undefined): boolean {
	return !!holdCause && holdCause.includes('waiting on an approval');
}

function actionFor(
	state: NodeState,
	href: string,
	cell?: Pick<PrCell, 'gateApprovalGuess' | 'holdCause'>
): JourneyAction | undefined {
	switch (state) {
		case 'failed':
			// Mutates nothing by itself: no href, a button, the caller's own
			// `onAction` opens the rollback confirm dialog.
			return { kind: 'rollback', label: stepLabel('rollback') };
		case 'held':
			return cell?.gateApprovalGuess || holdCauseIsApproval(cell?.holdCause)
				? { kind: 'review', label: stepLabel('approve', { navigate: true }), href }
				: { kind: 'why-held', label: 'Why held', href };
		case 'deploying':
		case 'checking':
		case 'stuck':
			return { kind: 'open', label: stepLabel('open'), href };
		default:
			return undefined;
	}
}

/**
 * ⭐ ROUND 4, ITEM 2 — HELD REASONS USE `cell.holdCause`
 * (`holdCausePhrase`, blocking-story.ts — "waiting on an approval"), the
 * SAME cause phrase Home and the Overview read, never the vaguer
 * `cell.reason` fallback ("waiting on a rule") for exactly the `held`
 * state. Every other state keeps `cell.reason` — `holdCause` is set only
 * when `pr-pipeline.ts`'s `buildCell` already knows the cell is held.
 */
function stopReason(cell: Pick<PrCell, 'reason' | 'holdCause'>, state: NodeState): string | undefined {
	if (state === 'held' && cell.holdCause) return cell.holdCause;
	return cell.reason;
}

function cellNodeLabel(
	env: string,
	cell: Pick<PrCell, 'state' | 'revision' | 'superseded'>,
	nodeState: NodeState
): string {
	const rev = cell.revision ? shortenVersion(cell.revision) : null;
	// A failure/cancellation superseded by a later, successful build reads
	// "resolved" the same way a rollback does — see `isResolvedCell`/
	// `nodeStateFromCell`'s own doc comment for why this is defensive
	// insurance rather than a path known to fire today.
	if ((cell.state === 'failed' || cell.state === 'cancelled') && cell.superseded) {
		return `${env} · ${cell.state === 'failed' ? 'failed' : 'cancelled'}${rev ? ` on ${rev}` : ''}, resolved`;
	}
	switch (cell.state as PrState) {
		case 'rolled-back':
			return `${env} · rolled back${rev ? ` to ${rev}` : ''}, resolved`;
		case 'cancelled':
			return `${env} · cancelled`;
		case 'live':
			return `${env} · live${rev ? ` ${rev}` : ''}`;
		case 'deploying':
		case 'retrying':
			return `${env} · deploying${rev ? ` ${rev}` : ''}`;
		case 'baking':
			return `${env} · checking${rev ? ` ${rev}` : ''}`;
		default:
			break;
	}
	switch (nodeState) {
		case 'failed':
			return `${env} · failed${rev ? ` on ${rev}` : ''}`;
		case 'stuck':
			return `${env} · stuck`;
		case 'held':
			return `${env} · held`;
		case 'behind':
			return `${env} · queued`;
		default:
			return `${env} · not reached yet`;
	}
}

/**
 * ONE SERVICE'S JOURNEY (a PR/commit's page, `/changes`). One stop per cell
 * at a stage tier; `prod` folds every prod-tier cell of this service into
 * one aggregated stop (the prod SET), its state the worst region's.
 *
 * `opts.tiers` is the SHARED column list (`laneTiers`-style) a caller
 * computes once for every row in a list, so stops line up across rows —
 * this function never invents its own tier order. A tier with no cell for
 * this service is simply absent from the result; the component draws the
 * dashed "skipped" segment for any tier in `tiers` with no matching stop.
 */
export function journeyFromCells(
	service: Pick<PrService, 'cells'>,
	opts: { tiers: Tier[]; startAt?: string | null; revision?: string | null } = { tiers: [] }
): JourneyStop[] {
	const byTier = new Map<Tier, PrCell[]>();
	for (const cell of service.cells) {
		const t = tierOf(cell.envName);
		(byTier.get(t) ?? byTier.set(t, []).get(t)!).push(cell);
	}

	const effectiveTiers = opts.tiers.length ? opts.tiers : [...byTier.keys()];
	const stops: JourneyStop[] = [];
	for (const tier of effectiveTiers) {
		const cells = byTier.get(tier);
		if (!cells || cells.length === 0) continue;

		if (tier === 'prod' && cells.length > 1) {
			const regions = cells.map((c) => ({ env: c.envName, state: nodeStateFromCell(c) }));
			const state = worstOf(regions.map((r) => r.state));
			const worst = cells.reduce((a, b) =>
				PRIORITY.indexOf(nodeStateFromCell(b)) < PRIORITY.indexOf(nodeStateFromCell(a)) ? b : a
			);
			const href = cellHref(worst);
			stops.push({
				key: `prod:${cells.map((c) => c.envName).join(',')}`,
				tier,
				env: 'prod',
				state,
				reachedAt: isReached(state) ? worst.since : null,
				since: worst.since,
				href,
				regions,
				reason: stopReason(worst, state),
				action: actionFor(state, state === 'held' ? cellHref(worst, 'gates') : href, worst),
				label: cellNodeLabel('prod', worst, state),
				buildLabel: carrierBuildLabel(worst.revision, opts.revision),
				usuallyMs: worst.usuallyMs,
				resolved: isResolvedCell(worst)
			});
			continue;
		}

		const cell = cells[0];
		const state = nodeStateFromCell(cell);
		const href = cellHref(cell);
		stops.push({
			key: `${cell.cluster}:${cell.namespace}:${cell.rolloutName}`,
			tier,
			env: cell.envName,
			state,
			reachedAt: isReached(state) ? cell.since : null,
			since: cell.since,
			href,
			reason: stopReason(cell, state),
			action: actionFor(state, state === 'held' ? cellHref(cell, 'gates') : href, cell),
			label: cellNodeLabel(cell.envName, cell, state),
			buildLabel: carrierBuildLabel(cell.revision, opts.revision),
			usuallyMs: cell.usuallyMs,
			resolved: isResolvedCell(cell)
		});
	}
	return stops;
}

/**
 * MANY SERVICES, ONE ROW (`/changes`'s wide multi-service callout). Folds
 * every service's cells into one stop PER TIER, counted — "1 failed ·
 * 1 held" or "3/3 live" — rather than drawing a node per service. The
 * stop's state is the worst service's at that tier; its `href` is the
 * caller's (the change page filtered to that tier), because only the page
 * knows that URL shape.
 */
export function journeyFromChange(
	services: Pick<PrService, 'cells'>[],
	opts: {
		tiers: Tier[];
		startAt?: string | null;
		revision?: string | null;
		hrefForTier: (tier: Tier) => string;
	}
): JourneyStop[] {
	const byTier = new Map<Tier, PrCell[]>();
	for (const service of services) {
		for (const cell of service.cells) {
			const t = tierOf(cell.envName);
			(byTier.get(t) ?? byTier.set(t, []).get(t)!).push(cell);
		}
	}

	const stops: JourneyStop[] = [];
	for (const tier of opts.tiers) {
		const cells = byTier.get(tier);
		if (!cells || cells.length === 0) continue;

		const withState = cells.map((c) => ({ cell: c, state: nodeStateFromCell(c) }));
		const counts: JourneyStopCounts = { total: cells.length };
		const bump = (k: keyof JourneyStopCounts) => (counts[k] = (counts[k] ?? 0) + 1);
		for (const { state } of withState) {
			if (state === 'failed') bump('failed');
			else if (state === 'held') bump('held');
			else if (state === 'stuck') bump('stuck');
			else if (state === 'deploying') bump('deploying');
			else if (state === 'checking') bump('checking');
			else if (state === 'newest') bump('live');
		}
		const state = worstOf(withState.map((w) => w.state));
		const worstEntries = withState.filter((w) => w.state === state);
		const worst = worstEntries[0].cell;
		const href = opts.hrefForTier(tier);
		const extra = worstEntries.length - 1;
		stops.push({
			key: `change:${tier}`,
			tier,
			env: tier === 'prod' ? 'prod' : worst.envName,
			state,
			reachedAt: isReached(state) ? worst.since : null,
			since: worst.since,
			href,
			reason: (() => {
				const base = stopReason(worst, state);
				return extra > 0 ? `${base ?? ''}${base ? ' · ' : ''}+${extra} more`.trim() : base;
			})(),
			action: actionFor(state, href, worst),
			counts,
			label: `${tier === 'prod' ? 'prod' : worst.envName} · ${counts.live ?? 0}/${counts.total} live`,
			usuallyMs: worst.usuallyMs,
			resolved: isResolvedCell(worst)
		});
	}
	return stops;
}

function laneNodeLabel(env: string, n: Pick<LaneNode, 'state' | 'behind'>): string {
	switch (n.state) {
		case 'newest':
			return `${env} · on the newest`;
		case 'behind':
			// ⭐ shared/age-lag-total: ONE LAG UNIT — `env-rank.ts`'s `lagLabel`,
			// never a bare `${n.behind} behind`.
			return `${env} · ${lagLabel({ builds: n.behind })}`;
		case 'failed':
			return `${env} · failed`;
		case 'stuck':
			return `${env} · stuck`;
		case 'held':
			return `${env} · held`;
		case 'deploying':
			return `${env} · deploying`;
		case 'checking':
			return `${env} · checking`;
		default:
			return `${env} · not reached yet`;
	}
}

/**
 * ONE SERVICE'S NEWEST BUILD, ACROSS ITS WHOLE CHAIN (the repository page).
 * `Lane` already carries exactly the fields a stop needs (`LaneNode.state`
 * IS a `NodeState`), so this is a thin reshape rather than a second state
 * mapping — `buildLanes` (`promotion-lanes.ts`) is still the one place that
 * decides a node's state.
 */
export function journeyFromLane(
	lane: Pick<Lane, 'stages' | 'prod'>,
	opts: { startAt?: string | null; revision?: string | null } = {}
): JourneyStop[] {
	const stageStops = lane.stages.map((n) => laneNodeToStop(n, opts));
	if (lane.prod.length === 0) return stageStops;
	if (lane.prod.length === 1) return [...stageStops, laneNodeToStop(lane.prod[0], opts)];

	const regions = lane.prod.map((n) => ({ env: n.env, state: n.state }));
	const state = worstOf(regions.map((r) => r.state));
	const worst = lane.prod.reduce((a, b) => (PRIORITY.indexOf(b.state) < PRIORITY.indexOf(a.state) ? b : a));
	const href = rolloutPath(worst.card.sourceCluster, worst.card.ns, worst.card.name);
	const newestCount = regions.filter((r) => r.state === 'newest').length;
	stageStops.push({
		key: `prod:${lane.prod.map((n) => n.card.ns + n.card.name).join(',')}`,
		tier: 'prod',
		env: 'prod',
		state,
		reachedAt: isReached(state) ? worst.card.timestamp : null,
		since: worst.card.timestamp,
		href,
		regions,
		reason: worst.card.bakeStatusMessage ?? undefined,
		action: actionFor(state, state === 'held' ? rolloutPath(worst.card.sourceCluster, worst.card.ns, worst.card.name, 'gates') : href, undefined),
		label: `prod · ${newestCount}/${regions.length} on the newest`,
		buildLabel: carrierBuildLabel(worst.card.version, opts.revision)
	});
	return stageStops;
}

function laneNodeToStop(n: LaneNode, opts: { startAt?: string | null; revision?: string | null }): JourneyStop {
	const href = rolloutPath(n.card.sourceCluster, n.card.ns, n.card.name);
	const gatesHref = rolloutPath(n.card.sourceCluster, n.card.ns, n.card.name, 'gates');
	const reason =
		n.card.checkFailure != null
			? 'Health check failing'
			: n.card.bakeStatusMessage != null
				? n.card.bakeStatusMessage
				: undefined;
	return {
		key: `${n.card.ns}:${n.card.name}`,
		tier: n.tier,
		env: n.env,
		state: n.state,
		reachedAt: isReached(n.state) ? n.card.timestamp : null,
		since: n.card.timestamp,
		href,
		reason,
		action: actionFor(n.state, n.state === 'held' ? gatesHref : href, undefined),
		label: laneNodeLabel(n.env, n),
		buildLabel: carrierBuildLabel(n.card.version, opts.revision)
	};
}
