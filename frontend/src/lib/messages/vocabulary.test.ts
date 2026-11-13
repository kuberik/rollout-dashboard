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
	concept: 'state' | 'obstacle' | 'newest' | 'object' | 'action' | 'environment';
	re: RegExp;
	/** when set, only literals of these kinds are checked */
	kinds?: string[];
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
			'lib/components/CopyButton.svelte\tcode\tCould not copy …. The browser blocked clipboard access — select the text and copy it manually.',
			// Squad-rollout Lane P round 2 (2026-10-09): the palette's "Copy
			// build sha" action hit the same clipboard failure and now spells
			// it with `CopyButton.svelte`'s own `label`-shaped sentence
			// (`label = 'build …'`) — byte-identical after interpolation,
			// same reason, just a second file that can trip it.
			'lib/CommandPalette.svelte\tcode\tCould not copy …. The browser blocked clipboard access — select the text and copy it manually.'
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
			'routes/rollouts/[cluster]/[namespace]/[name]/history/+page.svelte\ttitle\tAutomatic deploys are paused until this pin is cleared.',
			// Same one consequence sentence, now also on the revision detail page's
			// per-place "Not yet" row (operator-walk finding 1: a pin outranks every
			// gate here too, same precedence `blocking-story.ts`'s own `blockingStory()`
			// already uses) and on the revision ledger view-model that feeds the list
			// page's own pinned rows -- not a fresh spelling per surface.
			// CHANGES-2026-09-10.md §1 — this page moved from
			// `routes/revisions/[...slug]/+page.svelte` to
			// `routes/changes/[...slug]/+page.svelte` (renamed, relinked);
			// the sentence itself is unchanged.
			"routes/changes/[...slug]/+page.svelte\tcode\tPinned to … — automatic deploys are paused until the pin is cleared.",
			'lib/view-models/revision-ledger.ts\tcode\tPinned to … — automatic deploys are paused until the pin is cleared.'
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
		id: 'gated / is gated / gated on (state)',
		concept: 'state',
		// ⛔ 2026-09-10 (PR-view fix pass, item 3): the noun rule below
		// (`\bgates?\b`) does NOT match the PARTICIPLE "gated" — "gated by
		// X" and "gated in dev" both shipped live on the PR page and slipped
		// this guard for exactly that reason. `\bgated\b` alone already
		// covers "is gated", "gated on", "gated by" and "gated in dev" — the
		// three explicit alternatives before it are redundant with it but
		// left in place as the record of what was actually seen.
		re: /\bis gated\b|\bgated on\b|\bgated\b/i,
		why: '"gated"/"gated on"/"gated by"/"gated in <env>" are `gate` wearing a verb. Retired in favour of `depends on` / `held`. See CLAUDE.md (a, b).',
		allow: [
			// The rollout Gates tab's own graph column header (2026-10-08) --
			// see the "gate / gates (obstacle)" rule's own allowlist below for
			// the full reason. "Gated by" names the column's CONTENT (every
			// gate on this rollout, both directions), not a competing spelling
			// of the `held` state. Squad-rollout Lane G round 2, item 3
			// (2026-10-09): the label became a `t-label` column head ("Gated
			// by · N"), same exception, new exact literal.
			'lib/components/RolloutNeighbourhood.svelte\ttext\tGated by',
			// 2026-11-09: the signed rollout-tab baseline restore re-drew the column head as "Gated by · N" (literal now carries the dot); same exception, exact new literal.
			'lib/components/RolloutNeighbourhood.svelte\ttext\tGated by ·'
		]
	},
	{
		id: 'gate / gates (obstacle)',
		concept: 'obstacle',
		re: /\bgates?\b/i,
		why: '"gate" never appears in user-facing text -- the generic noun is `rule`, the kind is named where it matters. See CLAUDE.md (b).',
		allow: [
			// The rollout detail tab is named "Gates" by the product owner
			// (2026-10-08) -- it draws every kind of gate on one rollout, both
			// directions, and the old generic-noun ban predates that naming.
			// Narrowly scoped to this tab's own files, not a reopening of the
			// rule for the rest of the product.
			// truth-4: the Inbox/Changes place note reuses the Gates tab's own sub-line verbatim ("1 gate holding", "N of M gates holding" --
			// data.ts tabPill, the tab's rollup), so it must not drift from the tab it summarises. Same exception, new consumers.
			'lib/components/new/data.ts\tcode\t… gate… holding',
			'lib/components/new/data.ts\tcode\t… of … gates holding',
			'lib/components/new/inbox-model.ts\tcode\t1 gate holding',
			'routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte\ttext\tSee gates',
			'lib/components/RolloutNeighbourhood.svelte\ttext\tGates nothing',
			'lib/components/RolloutNeighbourhood.svelte\taria-label\tGates of … in …',
			'lib/components/RolloutNeighbourhood.svelte\ttext\tNothing gates this rollout',
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\tNothing gates this rollout',
			// The header `meta` row and the card's own rollup (added
			// 2026-10-09, squad-rollout): "N of M gates holding" / "M gates,
			// none holding" / "no gates" — same tab, same exception.
			// Round 4 nit (2026-10-10, AD item 10): "no gates" (lowercase) →
			// "No gates" — same tab, same exception, capitalised to match the
			// Card rollup's own "No gates on this rollout".
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\tgate … · all passing … No gates …',
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\tgate … holding …',
			// rollout-tabs item 4 (2026-10-25): the lg+ status line under the Gates
			// title, "N gate(s) holding · age" / "no gates" -- same tab, same exception.
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\t… gate …',
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\tgate … holding',
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\tno gates',
			'lib/view-models/gate-fact.ts\tcode\t… gate…',
			'lib/view-models/gate-fact.ts\tcode\t… gate… holding',
			'lib/view-models/gate-fact.ts\tcode\t… of … gates holding',
			'lib/view-models/gate-fact.ts\tcode\t1 gate failing',
			'lib/view-models/gate-fact.ts\tcode\t1 of … gates failing',
			// Squad-rollout Lane G round 2 (2026-10-09, item 3/4): the
			// "Gating N" column head is now "Gates · N" (the tab's own noun,
			// matching "Gated by" opposite it); both empty-card states now say
			// "No gates on this rollout" (one vocabulary for the tab, where
			// one used to say "no rules holds this rollout right now" and the
			// other echoed "Nothing gates…") with a next-step sentence that
			// defines the word and a docs link out. Same tab, same exception.
			'lib/components/RolloutNeighbourhood.svelte\ttext\tGates ·',
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\t… A health check is failing, but there is no newer build for it to hold back. … A health check is still pending, but there is no newer build for it to hold back. … … … … … Its health checks are passing. … A gate — an approval, a deploy window, a dependency or a health check — holds a build until its rule passes. …',
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttitle\tBuilds of this rollout a gate is holding right now',
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\tLearn about gates ›',
			'routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte\ttext\tNo gates on this rollout',
			// Squad-rollout Lane P round 2 (2026-10-09): the palette's "This
			// rollout" section names the Gates TAB by its own proper name,
			// same as the tab strip itself ("Overview"/"History"/"Logs"/
			// "Gates") — a destination label, not the obstacle noun this rule
			// retired. Narrowly scoped to this one row.
			'lib/CommandPalette.svelte\tcode\tGo to Gates'
		]
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
			'routes/environments/+page.svelte\ttext\tAll … app … here … up to date',
			// Round 3 (coordinator review): the fold button's markup simplified
			// (dropped the chevron icon, now a plain `.btn-secondary.btn-sm`
			// matching the product's one fold grammar), which collapsed the
			// scanned text to one fewer gap than before — same two strings,
			// same exception.
			'routes/environments/+page.svelte\ttext\tHide … up-to-date app …',
			'routes/environments/+page.svelte\ttext\tShow … up-to-date app …',
			// truth-4, owner ruling 2026-11-02 ("Live" retired): an at-rest environment says two facts in two slots -- health ("Healthy") and
			// currency, "Up to date" or "N builds behind" -- computed against the APP's own newest build. "Up to date" is that slot's ruled word
			// on /apps/<name> (app-model.ts currency) (the change page's Places card, ChangePlaceRow, is retired), not the retired per-subject convergence claim.
			'lib/components/new/app/app-model.ts\tcode\tUp to date',
			// change-strip r2 (coordinator ruling): the site picker's rows carry the same currency slot origin/main's "Where it runs" printed
			// ("Deployed · Up to date" / "· 3 builds behind"), on the Change page (stages-model) and on the App / Rollout strip (PromotionLane).
			'lib/components/new/stages/stages-model.ts\tcode\tUp to date',
			'lib/components/PromotionLane.svelte\tcode\tUp to date'
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
	},
	// ── U-11/U-13 (2026-10-08, polish pass, TL ruling). See CLAUDE.md's
	// "The vocabulary decision, continued" (e)/(f) for the full reasoning.
	{
		id: 'Change Version (title case)',
		concept: 'action',
		// Case-SENSITIVE on purpose — "Change version" (sentence case) is the
		// kept spelling (the open-ended picker entry point); only the title-
		// cased "Change Version" is retired.
		re: /\bChange Version\b/,
		why: '"Change Version" (title case) is retired in favour of sentence-case "Change version" — the one surviving spelling of the open-ended picker entry point. See CLAUDE.md (e).'
	},
	{
		id: 'Promote as a person\'s button label',
		concept: 'action',
		// Anchored to the WHOLE literal — a button/action label renders as
		// its own short, standalone string ("Promote", "Promote now"), never
		// as a clause inside a longer sentence, so anchoring avoids
		// false-positiving on the (kept) narrative use of "promote" for the
		// AUTOMATIC advance ("will promote automatically", "promotes to the
		// next environment on its own").
		re: /^promote( now)?[.!]?$/i,
		why: '"Promote"/"Promote now" is retired as a PERSON\'S button label — promote is reserved for the automatic advance the controller performs on its own. See CLAUDE.md (e).'
	},
	{
		id: 'STG / PRD as a drawn environment label (environment)',
		concept: 'environment',
		re: /\b(STG|PRD)\b/,
		why: '"STG"/"PRD" are retired abbreviations — every drawn environment family word is the full uppercase name (DEV/STAGING/PROD/TEST). See CLAUDE.md (f).'
	},
	{
		id: 'trigger button label carrying a build, sha, version or place',
		concept: 'action',
		// Owner rule, 2026-11-03 (e), restated 2026-11-13: "A trigger button
		// never carries the target or build ... not `Roll back eu-west to #36`,
		// not `Roll back to a11c101`". Visible labels are the bare verb (Roll
		// back, Deploy, Approve, Skip once); the detail lives in `title` and
		// `aria-label`, which the census reports as their own kinds and this rule
		// ignores. Only `text` (button inner text) and `code` (label builders)
		// can be a visible label. DIALOG titles and their confirm buttons name
		// their target by decision (e) and are allowlisted below by exact line.
		re: /^(Roll ?back|Redeploy|Deploy|Approve|Pin|Unpin|Skip|Promote)\s+(to\b|at\b|in\b|for\b|on\b|…|\S*\d)/,
		kinds: ['text', 'code'],
		why: 'A visible button label is the bare verb; the build, sha or place goes in title/aria-label or the dialog it opens. See CLAUDE.md (e).',
		allow: [
			// dialog title
			'lib/components/ChangeVersionModal.svelte\tcode\tDeploy … to …',
			// dialog title/confirm
			'lib/components/ChangeVersionModal.svelte\tcode\tPin … to …',
			// dialog title
			'lib/components/ChangeVersionModal.svelte\tcode\tRoll back … to …',
			// dialog explanation sentence
			'lib/components/new/app/AppDetail.svelte\tcode\tDeploy … to ….',
			// confirm dialog question, not a button
			'lib/components/new/approvals.svelte.ts\tcode\tApprove … … …?',
			// dialog title
			'lib/components/RecoveryModeWarningModal.svelte\tcode\tDeploy … to …',
			// dialog confirm button per (e)
			'lib/components/RecoveryModeWarningModal.svelte\tcode\tDeploy to …',
			// dialog title
			'lib/components/RecoveryModeWarningModal.svelte\tcode\tRoll back … to …',
			// dialog title (h2)
			'lib/components/SkipRuleModal.svelte\ttext\tSkip … once',
			// dialog confirm button; the count is the scope of the act
			'lib/components/SkipRuleModal.svelte\tcode\tSkip for ${toSend.length === 1 ? \'1 rollout\' :',
			// dialog confirm button per (e)
			'lib/view-models/deploy-risk.ts\tcode\tDeploy to …',
			// dialog confirm button per (e)
			'lib/view-models/deploy-risk.ts\tcode\tRedeploy to …',
			// accessibility skip-link, not a trigger
			'routes/+layout.svelte\ttext\tSkip to main content'
		]
	},
	{
		id: 'Rollback (one word, title case) as a button verb',
		concept: 'action',
		// Case-sensitive — the kept noun is lowercase "rollback" ("one
		// rollback", "the rollback is automatic"); the retired spelling is
		// the capitalized one-word button/title verb ("Rollback" instead of
		// "Roll back").
		re: /\bRollback\b/,
		why: '"Rollback" (one word) is retired as a button/title VERB — the verb is "Roll back" (two words); "rollback" (lowercase, one word) survives only as the noun. See CLAUDE.md (e).'
	}
];

describe('vocabulary: a retired spelling may not reappear', () => {
	const literals = scanLiterals();

	for (const rule of DENY) {
		test(`${rule.id} -- ${rule.why}`, () => {
			const allow = new Set(rule.allow ?? []);
			const violations = literals.filter((l) => {
				if (rule.kinds && !rule.kinds.includes(l.kind)) return false;
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
