/**
 * HELD FOR — how long held builds have been waiting, counted ONE way for
 * every page that shows it (Home's KPI, /activity's tile). Coordinator
 * 2026-10-10: one number, from one function.
 *
 * ⭐ DELEGATES TO `fleet-facts.ts` NOW (shared/fleet-facts, 2026-10-10): that
 * module is the one place every fleet-wide count — held included — is
 * computed. This file keeps its own narrow shape and signature so none of
 * its callers (Home, `/activity`) had to change, but the arithmetic is no
 * longer duplicated here.
 *
 * - `apps`: apps whose Fleet row itself reads Held (its lane leads with
 *   held, worst node wins — `fleetFacts.held.apps`, home-map's own rule:
 *   "an app failing somewhere and held elsewhere reads failed, so it is not
 *   counted here");
 * - `places`: held blocks on Home's Promotion Map (app × stage, production
 *   one plate — `fleetFacts.held.plates`), which is what the map's stage
 *   captions sum ("in 4 places");
 * - a held rollout's WAIT starts when the oldest build newer than the one it
 *   runs was released (that build has been waiting since); the figure is the
 *   MEDIAN wait (one long hold does not own the number), `longest` is the
 *   maximum and names its subject.
 * A rollout whose waiting build has no release time contributes to the
 * counts but not to the durations; with no durations, `medianMs` is null.
 */
import type { RolloutCard } from '$lib/rollout-cards';
import { fleetFacts, heldLanes, waitingSince, type FleetFactsOpts } from './fleet-facts';

export { waitingSince, heldLanes };

export type HeldFor = {
	apps: number;
	places: number;
	medianMs: number | null;
	longestMs: number | null;
	longestSubject: { app: string; env: string } | null;
	/** ⭐ shared/held-label (2026-10-11): passed straight through from
	 *  `fleetFacts.held` — see that type's own doc. Lets Home's KPI tile
	 *  read the held-by-a-rule sentence/count without re-deriving it. */
	ruleApps: number;
	ruleSingle: { app: string; env: string; causeLabel: string } | null;
	ruleLongestMs: number | null;
};

export function heldFor(cards: readonly RolloutCard[], nowMs: number, opts: FleetFactsOpts = {}): HeldFor {
	// `fleetFacts` needs a window and a rollout list to compute deploys/failed,
	// which `heldFor` does not use — `held` itself is a RIGHT-NOW fact, not
	// windowed, so the range and the (empty) rollout list below are inert.
	const f = fleetFacts(cards as RolloutCard[], [], nowMs, '7d', opts);
	return {
		apps: f.held.apps,
		places: f.held.plates,
		medianMs: f.held.medianMs,
		longestMs: f.held.longestMs,
		longestSubject: f.held.longestSubject,
		ruleApps: f.held.ruleApps,
		ruleSingle: f.held.ruleSingle,
		ruleLongestMs: f.held.ruleLongestMs
	};
}
