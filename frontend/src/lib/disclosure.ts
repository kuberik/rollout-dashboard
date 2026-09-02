/**
 * ⭐ THE TRIGGER GRAMMAR FOR EVERY DISCLOSURE IN THE PRODUCT, IN ONE PLACE.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * The label on a disclosure control has collapsed twice already and both
 * collapses were caused by the grammar living at the CALL SITES:
 *
 *   1. (2026-09-01) Five question shapes for one control — `What clears
 *      this`, `What happens next`, `Can I still deploy`, `What this stops`,
 *      `Which rules`. `/environments` rendered four of them in one viewport.
 *      From the human: *"i'm not sure i particularly like that format 'what
 *      clears this'."* They became nouns.
 *   2. (2026-09-02) The card scale moved to `1 rule` / `N rules` and the
 *      BANNER stayed on `Details`, so `/environments` again showed both, one
 *      viewport apart, on the same affordance over the same content.
 *
 * ── THE RULE, AND IT IS ABOUT THE CONTENT, NOT ABOUT THE COMPONENT ───────
 *
 * The trigger names WHAT IS BEHIND IT. Three shapes of content, three forms,
 * and nothing else is permitted:
 *
 *   A SET you can count       → `countLabel(n, noun)` — `1 rule`, `3 rules`,
 *     of ONE kind                `2 services`. The count is the thing a reader
 *                                uses to decide whether to open it, which is
 *                                the `Show 8 ready resources ›` shape
 *                                `COMPOSITION-GRAMMAR.md` §8 names and this
 *                                product already spends on the `Resources`
 *                                card. Sets take the count even at n = 1: a
 *                                one-gate banner and a two-gate banner must
 *                                not read as different KINDS of control.
 *
 *   ONE RECORD with fields    → `Details`. NOT `1 request`: a count of one
 *                                over a thing there can only ever be one of
 *                                reads as pedantry, and the reader learns
 *                                nothing from it. The record's shape is
 *                                carried by the `<dl>` behind the control,
 *                                not by the word in front of it.
 *
 *   A GENUINE SENTENCE        → `Details`. Unchanged, and still the honest
 *                                default: where there is no shape, prose is
 *                                correct and a count would be a lie.
 *
 * ⛔ NO VERBS, NO INTERROGATIVES, NO CLAIMS. A label states the KIND of thing
 * behind the control; it may not state a fact of its own, because a fact
 * nobody expands is a fact nobody reads. If you find yourself writing a verb,
 * the thing you want to say belongs in the banner's `message`, where it is
 * printed.
 */

/**
 * `1 rule` / `3 rules` — a count and its kind. The noun is the CALLER's,
 * because only the caller knows what it counted; the plural is this
 * function's, so six call sites cannot grow six pluralisation rules.
 *
 * English `-s` only. Every noun this product counts behind a disclosure is
 * regular (`rule`, `service`, `contract`, `check`); the day one is not, it
 * takes an explicit `plural` argument rather than a lookup table.
 */
export function countLabel(n: number, noun: string, plural = `${noun}s`): string {
	return `${n} ${n === 1 ? noun : plural}`;
}
