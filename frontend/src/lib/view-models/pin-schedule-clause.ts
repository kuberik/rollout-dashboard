/**
 * ⭐ THE PIN'S SENTENCE NAMES EVERY HOLD, NOT ONLY THE PIN. (2026-09-03,
 * operator-walk finding P10 — `/environments`'s card copy read *"2 newer
 * builds are available and none of them will deploy while the pin is set."*
 * on a rollout where a closed deploy window ALSO holds it — the pin is not
 * the only thing stopping them.)
 *
 * `blockingStory`'s pin branch (`blocking-story.ts`) short-circuits before it
 * ever classifies the rollout's OTHER gates — correctly: a pin outranks
 * every gate, and clearing it is genuinely the one thing that restarts
 * automatic deploys. But a reader who clears the pin and sees nothing move
 * has not been told why: the window is ALSO closed, and clearing the pin
 * alone will not let anything through until it reopens.
 *
 * `blocking-story.ts` is the product's one shared classifier and stays
 * untouched — the pin-outranks-everything short-circuit there is
 * deliberate, see its own comment. This module AUGMENTS a `BlockingStory`
 * object the caller already built, by independently classifying the
 * rollout's other gates with the SAME exported `classifyGate` every other
 * surface uses, so the added clause cannot name a schedule this module
 * disagrees with.
 */
import type { Rollout } from '../../types';
import { classifyGate, type BlockingStory, type GateContext } from './blocking-story';

/**
 * `story`, unchanged unless `story.pinnedTo` AND one of the rollout's other
 * gates is a closed deploy window with a known reopening time — in which
 * case `story.consequence` grows a clause naming it, e.g. *"…while the pin
 * is set, and Business Hours Only reopens 1:00 PM."* When more than one
 * clock gate holds the rollout, the EARLIEST reopening is named — the same
 * "earliest wins" rule `blockingStory`'s own `clearsAt` reduction uses.
 */
export function withPinScheduleClause(
	story: BlockingStory,
	rollout: Rollout,
	ctx: GateContext
): BlockingStory {
	if (!story.pinnedTo) return story;
	const namespace = rollout.metadata?.namespace;
	let earliest: { label: string; clearsAt: string } | null = null;
	for (const g of rollout.status?.gates ?? []) {
		if (!g?.name) continue;
		const c = classifyGate(g, namespace, ctx);
		if (c.clears !== 'clock' || !c.clearsAt) continue;
		if (!earliest || new Date(c.clearsAt) < new Date(earliest.clearsAt)) {
			earliest = { label: c.label, clearsAt: c.clearsAt };
		}
	}
	if (!earliest) return story;
	// Same format `heldCauseText` (`$lib/rollout-cards`) already prints a
	// clock's reopening time in — `1:00 PM`, not an absolute date-time.
	const time = new Date(earliest.clearsAt).toLocaleTimeString([], {
		hour: 'numeric',
		minute: '2-digit'
	});
	return {
		...story,
		consequence: `${story.consequence.replace(/\.\s*$/, '')}, and ${earliest.label} reopens ${time}.`
	};
}
