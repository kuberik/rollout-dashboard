import { describe, test, expect } from 'vitest';
import { scanLiterals } from './scan';

/**
 * THE VOCABULARY GUARD. (2026-09-03, vocabulary pass, coordinator task.)
 *
 * `drift.test.ts` catches a NEW string; it says nothing about whether that
 * string uses a RETIRED WORD for a concept this product already has a
 * canonical spelling for. That is exactly how the sprawl this pass fixed
 * happened: fourteen spellings for "a rollout that cannot move" (`Held`,
 * `blocked`, `STUCK`, five `paused` variants, four `waiting on` variants,
 * `can't go any further yet`...), nine for the obstacle itself (`gate` vs
 * `rule` vs `schedule` vs `contract`), and a dozen more across the newest/
 * behind pair and the object noun (`version`/`tag`/`release`/`build`). Each
 * one compiled, passed review, and was individually reasonable — the defect
 * only exists in aggregate, which a per-string census cannot see and a
 * denylist can.
 *
 * -- THE RULE ---------------------------------------------------------------
 *
 * One regex per retired spelling, checked against EVERY literal
 * `scanLiterals()` finds (the same census `drift.test.ts` diffs). A literal
 * that matches is a violation UNLESS it is on that rule's own allowlist --
 * an exact `file\tkind\ttext` triple, so an exception is a specific line
 * somebody can read and re-justify, not a blanket carve-out for a whole file
 * or a whole word.
 *
 * -- WHY A LITERAL, NOT A GREP OVER SOURCE -----------------------------------
 *
 * `scanLiterals()` already excludes identifiers, type names, CSS classes,
 * k8s annotation keys and code comments -- the exact things that legitimately
 * still say `gate` (`GateSummary`, `ClassifiedGate`, `gate.kuberik.com/...`,
 * `tk-gate`) because they are not prose a reader sees. Grepping `src/**` for
 * `gate` would false-positive on all of them; this reuses the same
 * prose-only extraction the message census already trusts.
 *
 * -- THE DECISIONS THESE RULES ENFORCE, RECORDED IN FULL IN `lib/CLAUDE.md` --
 *
 *   (a) STATE   -- the word is `held` (chip `HELD`, sentence "is held").
 *                  `stuck`, `pinned`, `trailing`, `needs you` are their own,
 *                  narrower states and are NOT retired -- only the words that
 *                  competed with `held` to say the same thing are.
 *   (b) OBSTACLE -- the generic noun is `rule` everywhere; `gate` never
 *                  appears in user-facing text. The KIND is named where it
 *                  matters (`contract`, `deploy window`, `approval`,
 *                  `health check`) -- `schedule` is retired as the KIND word
 *                  in favour of `deploy window`.
 *   (c) NEWEST/BEHIND -- `on the newest` for the per-subject convergence
 *                  claim (`upToDateHeadline`, `rankTitle`, the per-app
 *                  rollups). `up to date` survives ONLY as the ENVIRONMENT-
 *                  level fleet-parity phrase on `/environments` ("all N apps
 *                  here are up to date" / "N up-to-date apps") -- a
 *                  genuinely different claim (parity across apps within one
 *                  place, not one subject's own distance to its own newest)
 *                  that the same word had already settled on before this
 *                  pass and that decision text explicitly permits keeping.
 *   (d) OBJECT/VERB -- the deployable object is a `build` except where the
 *                  literal OCI tag is being shown (`Show all repo tags`,
 *                  `Copy Tag`) or where `version`/`release` name a genuinely
 *                  different thing (a contract's semver requirement is a
 *                  `version`, not a `build`; a per-service instantiation of a
 *                  build is a `release`). `ship`/`roll out`/`go out`/`move`/
 *                  `upgrade` are retired as VERBS for the act of deploying;
 *                  `deploy` and `promote` are the two that remain.
 */

const DENY: Array<{
	id: string;
	concept: 'state' | 'obstacle' | 'newest' | 'object';
	re: RegExp;
	why: string;
	/** `file\tkind\ttext` triples -- exact catalogue lines, not files or words. */
	allow?: string[];
}> = [
	{
		id: 'blocked (state)',
		concept: 'state',
		re: /\bblocked\b/i,
		why: '"blocked" competed with `held` to name the same state. See CLAUDE.md (a).',
		allow: [
			// The browser's clipboard permission, not a rollout state.
			'lib/components/CopyButton.svelte\tcode\tCopy … — failed, clipboard blocked',
			'lib/components/CopyButton.svelte\tcode\tCould not copy …. The browser blocked clipboard access — select the text and copy it manually.'
		]
	},
	{
		id: 'paused (state)',
		concept: 'state',
		re: /\bpaused\b/i,
		why: '"paused" was one of five spellings for the same held state. See CLAUDE.md (a).',
		allow: [
			// A test-retry pipeline mid-execution, not the auto-promotion
			// "held" state -- a different, narrower fact (this deploy's own
			// checks are re-running) that "held" would misname.
			'lib/components/RetryTestsModal.svelte\ttext\tRe-run tests. Pipeline stays paused until they pass.',
			// PINNED is its own state (CLAUDE.md (a)) and this is its one,
			// consistently-spelled consequence sentence, used identically
			// everywhere a pin appears -- not a competing spelling of `held`.
			'lib/rollout-cards.ts\tcode\tPinned to … — automatic deploys are paused until the pin is cleared.',
			'lib/RolloutGrid.svelte\ttitle\tPinned to … — automatic deploys are paused until the pin is cleared.',
			// Same one consequence sentence, now also on `/`'s Held section and
			// `/environments`' row chip -- see `lib/CLAUDE.md`'s finding 1
			// (2026-09-03, UX-walk iteration 2): a pinned rollout gets the
			// SAME `PINNED` chip and title everywhere it is listed, not a
			// fresh spelling per surface.
			'lib/ControlCenter.svelte\ttitle\tPinned to … — automatic deploys are paused until the pin is cleared.',
			'routes/environments/+page.svelte\ttitle\tPinned to … — automatic deploys are paused until the pin is cleared.',
			'routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte\ttext\tPinned to … — automatic deploys are paused until the pin is cleared.',
			'routes/rollouts/[cluster]/[namespace]/[name]/history/+page.svelte\ttitle\tAutomatic deploys are paused until this pin is cleared.'
		]
	},
	{
		id: "can't go any further (state)",
		concept: 'state',
		re: /can.t go any further/i,
		why: 'Retired in favour of `is held`. See CLAUDE.md (a).'
	},
	{
		id: "cannot / can't deploy ... yet (state)",
		concept: 'state',
		re: /\b(cannot|can.t) deploy\b.*\byet\b/i,
		why: 'Retired in favour of `is held`. See CLAUDE.md (a).'
	},
	{
		id: 'is gated on (state)',
		concept: 'state',
		re: /\bis gated\b|\bgated on\b/i,
		why: '"gated on" is `gate` wearing a verb. Retired in favour of `depends on` / `held`. See CLAUDE.md (a, b).'
	},
	{
		id: 'gate / gates (obstacle)',
		concept: 'obstacle',
		re: /\bgates?\b/i,
		why: '"gate" never appears in user-facing text -- the generic noun is `rule`, the kind is named where it matters. See CLAUDE.md (b).'
	},
	{
		id: 'schedule as the obstacle noun (obstacle)',
		concept: 'obstacle',
		// The KIND word is fine ("a deploy window", "the schedule's zone");
		// what is retired is `schedule` used as the COUNTABLE noun a
		// disclosure counts ("1 schedule" / "N schedules"), which collided
		// with the SAME gate's `1 rule` elsewhere. See CLAUDE.md (b).
		re: /\d+ schedules?\b/i,
		why: '"N schedule(s)" as a count noun collided with `N rule(s)` for the same gate. See CLAUDE.md (b).'
	},
	{
		id: "'up to date' outside the fleet-parity exception (newest)",
		concept: 'newest',
		re: /\bup.to.date\b/i,
		why: 'Retired as the per-subject convergence phrase in favour of `on the newest`; survives only as the environment-level fleet-parity phrase. See CLAUDE.md (c).',
		allow: [
			'routes/environments/+page.svelte\ttext\tAll … app … here are up to date',
			'routes/environments/+page.svelte\ttext\tHide … up-to-date app … …',
			'routes/environments/+page.svelte\ttext\tShow … up-to-date app … …'
		]
	},
	{
		id: 'go out / goes out (verb)',
		concept: 'object',
		re: /\bgo(es)? out\b/i,
		why: '"go out" is retired as a synonym for the verb `deploy`. See CLAUDE.md (d).'
	},
	{
		id: 'roll(ing) out (verb)',
		concept: 'object',
		re: /\broll(s|ing)?\s+out\b/i,
		why: '"roll out"/"rolling out" is retired as a synonym for the verb `deploy`. See CLAUDE.md (d).',
		allow: [
			// Not this pass's file (component lane, not the rollout-detail /
			// ChangeVersionModal / apps lane this rule was added from) --
			// flagged, not fixed here. Same defect as the two instances this
			// rule's own sweep did fix (ChangeVersionModal's toast, `/apps`'
			// lede): `N rolling out` names the same in-flight deploy state as
			// `STATUS_WORD`'s `deploying`/`checking` elsewhere on this page.
			'lib/components/RolloutStepper.svelte\tcode\t… rolling out'
		]
	}
];

describe('vocabulary: a retired spelling may not reappear', () => {
	const literals = scanLiterals();

	for (const rule of DENY) {
		test(`${rule.id} -- ${rule.why}`, () => {
			const allow = new Set(rule.allow ?? []);
			const violations = literals.filter((l) => {
				if (!rule.re.test(l.text)) return false;
				const key = `${l.file}\t${l.kind}\t${l.text}`;
				return !allow.has(key);
			});
			expect(
				violations,
				violations.length === 0
					? ''
					: `${rule.id} reappeared in:\n` +
							violations.map((v) => `  ${v.file}\t${v.kind}\t${v.text}`).join('\n') +
							`\n\nIf this is a deliberate, narrower exception (not the concept this rule ` +
							`retired), add its exact "file\\tkind\\ttext" line to this rule's own ` +
							`\`allow\` list in vocabulary.test.ts, with a one-line reason -- do not widen ` +
							`the regex or delete the rule.`
			).toEqual([]);
		});
	}
});
