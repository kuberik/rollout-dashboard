/**
 * ⭐ THE ONE "CAN I OFFER THIS DEPLOY" RULE. (coordinator ruling, shared
 * commit `shared/offerable-deploy`, 2026-10-11.)
 *
 * `/envs/[name]`, `/namespaces/[name]` and `/apps/[name]` each grew their
 * own answer to "may this row's Deploy button fire" — the envs page read
 * `newestDeployableCandidate` (gates only, `promotion.ts`), the app page
 * read `newestPromotableCandidate` (gates + contract holds, `app-tasks.ts`),
 * and QA found the gap between both: `app-ti-1440-light.png` showed the app
 * page offering `4a8d2e6` to prod while dev — the build's immediate
 * upstream — was still checking it, and `ns-ca-staging-*.png` showed
 * `/namespaces` offering a build (`b-45`) held by a dependency contract at
 * staging. Two different half-rules, two different ways to be wrong.
 *
 * `offerableDeploy` folds both existing rules AND the missing
 * upstream-settlement check into one function, so a caller gets either a
 * candidate to print ("Deploy 4.45.0-45") or a REASON it withheld one — the
 * reason is what lets a page say why the button is not there instead of
 * just omitting it.
 *
 * ⭐ BUILT DIRECTLY ON `held.ts` (shared/held-predicate, 82b85963) — NOT a
 * re-derivation. `card.held`, `card.heldCause` and `card.waitsForEnv` are
 * `heldVerdict`'s own output, precomputed once per `RolloutCard`
 * (`rollout-cards.ts`'s doc: "`fleet-groups.ts`'s `isHeld` and
 * `promotion-lanes.ts`'s `nodeState` read those fields exactly as they read
 * any other precomputed card fact" — this module is a third reader, same
 * rule). `waitsForEnv` is held.ts's own "not reached yet" signal (chain
 * sequencing dominates every other hold bucket); this function never calls
 * `blockingStory`/`heldVerdict` itself.
 *
 * ⛔ WHAT THIS DOES NOT DO. It does not fetch anything or decide WHICH
 * rollout is "the immediate upstream stage" — that join is `card.
 * waitsForEnv` (held.ts) plus the caller's own `peersByEnv` map, same shape
 * `waitsFor`'s own `HeldContext` already takes. It does not pick which
 * build the newest-promotable candidate across the WHOLE app is (that is
 * `/apps/[name]`'s own task-bucketing) — only whether THIS card may offer
 * ITS OWN newest promotable build right now.
 */
import { getDisplayVersion } from '$lib/utils';
import type { RolloutCard } from '$lib/rollout-cards';
import { contractHeldVersionsForRollout, newestPromotableCandidate } from './app-tasks';
import { isDeployable, promotionCandidates } from './promotion';
import { getEnvironmentRank } from '$lib/env-order';
import type { RolloutGraph } from './dependency-graph';

export type OfferableDeployReason =
	| 'upstream-running'
	| 'upstream-failed'
	| 'held'
	| 'gate'
	| 'deploying'
	| 'none';

export type OfferableDeployCandidate = {
	/**
	 * The build to print. ALWAYS `getDisplayVersion`'s output — never the
	 * raw promotion tag (`main-1785...`), which is an image reference, not a
	 * version a person should read.
	 */
	display: string;
	/** The raw tag — for wiring the deploy action itself (`ChangeVersionModal`
	 *  and every gate check key on the tag), never for display. */
	tag: string;
	/** The upstream stage this build is promoting FROM — `card.waitsForEnv`
	 *  when the chain named one, `null` on a first stage (dev) or when the
	 *  card's own environment is unresolved. */
	upstreamEnv: string | null;
};

export type OfferableDeployCtx = {
	/** The shared dependency graph — built once per page (`/apps/[name]`'s
	 *  own `network`), passed straight to `newestPromotableCandidate`. */
	graph: RolloutGraph;
	/**
	 * Every other `RolloutCard` for the SAME app, keyed by its raw
	 * `envName` — the SAME shape held.ts's own `waitsFor`/`HeldContext`
	 * takes, so a caller already building that map for `waitsFor` passes
	 * the identical value here. Used to tell "upstream is still running"
	 * from "upstream failed" from "upstream just hasn't started" when
	 * `card.waitsForEnv` says this card has not been reached yet, AND to find
	 * the nearest earlier stage whose settled build is the only one this card
	 * may be offered. REQUIRED: without it the upstream check cannot run. A
	 * caller holding only one card passes a map of just that card.
	 */
	peersByEnv: Map<string, RolloutCard>;
};

export type OfferableDeployResult =
	| { candidate: OfferableDeployCandidate; reason: null }
	| { candidate: null; reason: OfferableDeployReason };

/**
 * Can this card offer a Deploy control right now, and for which build?
 *
 * Checked in order — each is a distinct reason a page needs to tell apart,
 * and the first one that applies wins:
 *
 *   1. (d) a deploy is already running in the TARGET — offering a second
 *      one races the controller; `/envs/[name]`'s own comment calls this
 *      out ("never over a running deploy"). Reads `card.isRunning`
 *      (`rollout-cards.ts`'s own `bakeStatus` read), never re-derived.
 *   2. (a) the immediate upstream stage's run of ITS OWN current build has
 *      not settled. `card.waitsForEnv` (held.ts) is already the "this has
 *      not reached here yet" fact; the peer card named there (from
 *      `ctx.peersByEnv`) says whether that stage is actively deploying
 *      (`upstream-running`), failed outright (`upstream-failed`), or
 *      neither is known (falls through to the conservative `gate` bucket
 *      rather than inventing a running/failed state it cannot prove).
 *   3. (b) held HERE — `card.held` is held.ts's own verdict, gates AND
 *      dependency contract already folded in by the hold-one-rule. No
 *      candidate may be offered while it is true.
 *   4. (c) the gates allow it, and a build survives both checks —
 *      `newestPromotableCandidate` (`app-tasks.ts`) is the SAME per-
 *      candidate gate+contract read `/apps/[name]`'s own promote bucket
 *      uses, so the specific build offered here cannot disagree with it
 *      even when `card.held` is false only because an OLDER candidate
 *      happens to clear while the newest one does not.
 */
export function offerableDeploy(
	card: RolloutCard,
	ctx: OfferableDeployCtx
): OfferableDeployResult {
	// (d) nothing deploying in the target right now.
	if (card.isRunning) return { candidate: null, reason: 'deploying' };

	// (a) immediate upstream stage settled — card.waitsForEnv is held.ts's
	// own chain-sequencing signal; it dominates every other hold bucket, so
	// it is checked before `card.held`.
	if (card.waitsForEnv) {
		const peer = ctx.peersByEnv.get(card.waitsForEnv);
		if (peer?.isRunning) return { candidate: null, reason: 'upstream-running' };
		if (peer?.statusKey === 'failed') return { candidate: null, reason: 'upstream-failed' };
		// Peer unknown, idle, or itself held/behind a further stage — a real
		// refusal, but not one this function can name as a specific running
		// or failed state.
		return { candidate: null, reason: 'gate' };
	}

	// (b) held here — gates or a dependency contract, already folded by
	// held.ts's own hold-one-rule.
	if (card.held) return { candidate: null, reason: 'held' };

	const candidates = promotionCandidates(card.rollout);
	if (candidates.length === 0) return { candidate: null, reason: 'none' };

	// ⭐ (a) AGAIN, WHEN NO GATE NAMES THE CHAIN (lead, squad-fleet QA r6 B3):
	// `waitsForEnv` is only set when a chain gate REFUSES. A gate that allows
	// (or no gate at all) still never makes a build offerable here before the
	// immediate upstream stage has run it to Succeeded — telemetry-worker's
	// prod was offered 4a8d2e6 while dev was still deploying it, and every
	// payments-core prod region f4a2c19 while staging ran c0d3e88. With the
	// app's other stages in hand (`peersByEnv`), the offer is the build the
	// NEAREST earlier stage runs, settled, newer than what runs here, allowed
	// by this card's gates and not contract-held. A first stage (no earlier
	// peer) takes builds straight from CI, so it falls through to the newest
	// promotable candidate as before.
	const myRank = getEnvironmentRank(card.envName);
	const earlier = [...ctx.peersByEnv.values()].filter(
		(p) => p !== card && p.envName && getEnvironmentRank(p.envName) < myRank
	);
	if (earlier.length > 0) {
		const nearest = Math.max(...earlier.map((p) => getEnvironmentRank(p.envName)));
		const upstream = earlier.filter((p) => getEnvironmentRank(p.envName) === nearest);
		if (upstream.some((p) => p.isRunning)) return { candidate: null, reason: 'upstream-running' };
		if (upstream.every((p) => p.statusKey === 'failed')) return { candidate: null, reason: 'upstream-failed' };
		const here = card.rollout.status?.history?.[0]?.version?.tag ?? null;
		const held = contractHeldVersionsForRollout(ctx.graph, card.rollout, card.ns, card.sourceCluster || undefined);
		for (const p of upstream) {
			const head = p.rollout.status?.history?.[0];
			const tag = head?.version?.tag ?? null;
			if (!tag || head?.bakeStatus !== 'Succeeded' || tag === here) continue;
			if (!isDeployable(card.rollout, tag)) continue;
			const display = getDisplayVersion({ ...head!.version!, tag });
			if (held.has(display)) continue;
			return { candidate: { display, tag, upstreamEnv: p.envName }, reason: null };
		}
		return { candidate: null, reason: 'none' };
	}

	// (c) the per-candidate gate+contract read — may still differ from
	// `card.held` (false) when the NEWEST candidate is refused but an older
	// one is not; `newestPromotableCandidate` is the one function that walks
	// the list in order and cannot disagree with `/apps/[name]`'s own
	// promote bucket about which build that is.
	const candidate = newestPromotableCandidate(ctx.graph, card.rollout, card.ns, card.sourceCluster || undefined);
	if (!candidate?.tag) return { candidate: null, reason: 'gate' };

	const display = getDisplayVersion({ ...candidate, tag: candidate.tag });
	return {
		candidate: { display, tag: candidate.tag, upstreamEnv: card.waitsForEnv ?? null },
		reason: null
	};
}
