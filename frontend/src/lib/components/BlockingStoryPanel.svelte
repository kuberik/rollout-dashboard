<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * ⭐ THE GLYPH IS THE STORY'S, AND IT IS EXPORTED SO EVERY SURFACE PICKS IT
	 * THE SAME WAY.
	 *
	 * Measured on the running product: rollout detail rendered this same
	 * sentence — *"Three things are holding PROD … someone approves it … this
	 * will not clear on its own"* — behind a CALENDAR, because the banner there
	 * belonged to `ScheduleStatus` and a schedule's glyph is a calendar. A
	 * calendar over "someone has to approve this" says the opposite of the words
	 * beside it, which is the picture-scale version of the defect this whole
	 * pass exists to close.
	 *
	 * ⭐ NARROWED 2026-09-03: the CHOICE now lives in `blocking-story.ts`, as
	 * `story.iconKind` — worst-first, the same order `blockingStory` sorts its
	 * gates in, computed ONCE where the gates are classified. This module is
	 * left holding only the MAPPING from that kind to a glyph, so a surface
	 * with no `BlockingStoryPanel` in sight (`/envs/<name>`'s banner,
	 * `/dependencies`', `/versions/<rev>`'s) can still ask the one function
	 * that speaks for the icon rather than hand-picking its own — which is
	 * exactly how the same fact ended up behind a calendar on `/envs/prod`, a
	 * padlock on `/dependencies` and a person on `/versions/<rev>` while this
	 * banner drew a share-node for it.
	 */
	import {
		UserCircleSolid,
		CalendarWeekSolid,
		ShieldCheckSolid,
		ShareNodesSolid,
		ChevronDoubleRightOutline,
		LockSolid,
		QuestionCircleSolid
	} from 'flowbite-svelte-icons';
	import type { BlockingStory as Story, StoryIconKind } from '$lib/view-models/blocking-story';

	/**
	 * ⭐ `'pending'` GETS THE SAME GLYPH AS `unknown` AND FOR THE SAME REASON
	 * A QUESTION MARK IS TRUE OF BOTH: neither claims a kind. `unknown` means
	 * "we asked every source and none can attribute this"; `pending` means
	 * "we have not asked /schedules yet, so this might not even be a
	 * `check`". Reusing the glyph is not a coincidence to fix — a hourglass
	 * or a spinner here would be a THIRD claim ("time will fix this") this
	 * gate has not earned either. See `StoryIconKind`'s own doc comment.
	 */

	/**
	 * ⛔ A PERSON GLYPH OVER "we cannot tell what clears this" IS THE SAME
	 * PICTURE-SCALE LIE AS THE CALENDAR THIS MAP WAS WRITTEN TO KILL — see
	 * `unknown` below. And NOT AN HOURGLASS for `check`: an hourglass means
	 * *time will fix this*, which is `clock`'s meaning, and a `check` gate is
	 * precisely the kind that is NOT on a clock (not passing, and nothing
	 * published a window). Two kinds may not share one meaning; a shield-check
	 * is a guard that has not cleared. `dependency`/`promotion` are two
	 * mechanisms, not one bare direction (`ArrowRightAltSolid` names no
	 * object, and at the banner's 40px rendered as a solid smudge) — a
	 * cross-service contract and a promotion order each already have a mark
	 * elsewhere in the product: `ShareNodesSolid` is `contractBlockReason`'s
	 * and the `/dependencies` graph's, `ChevronDoubleRightOutline` is the
	 * `Promotion pipeline` card header's on `/apps/<name>`.
	 */
	const ICON_FOR_KIND: Record<StoryIconKind, typeof UserCircleSolid> = {
		pinned: LockSolid,
		person: UserCircleSolid,
		unknown: QuestionCircleSolid,
		dependency: ShareNodesSolid,
		promotion: ChevronDoubleRightOutline,
		clock: CalendarWeekSolid,
		check: ShieldCheckSolid,
		pending: QuestionCircleSolid
	};

	export function iconForKind(kind: StoryIconKind) {
		return ICON_FOR_KIND[kind];
	}

	export function iconForStory(story: Story) {
		return iconForKind(story.iconKind);
	}
</script>

<script lang="ts">
	/**
	 * ⭐ THE ONE BLOCKING BANNER. Four surfaces render this component and no
	 * surface spells the sentence itself, which is the entire point: `/apps`,
	 * `/apps/<name>`, `/environments` and rollout detail each used to derive
	 * their own wording from a different subset of the same gates, and two of
	 * them ended up giving opposite answers to *"do I need to wake someone up?"*
	 * for the same rollout at the same second.
	 *
	 * COMPOSITION IS `AlertPanel`'s, which is `COMPOSITION-GRAMMAR.md` §4 — a
	 * full-width filled field, a 40px circular icon, a bold headline, and a
	 * second line carrying the concrete consequence. The only thing chosen here
	 * is the GLYPH, and it is chosen from the story's own worst-first ordering
	 * so the picture and the words cannot disagree: a calendar over *"someone
	 * has to approve this"* says the opposite of the sentence beside it.
	 *
	 * ⛔ NO STRINGS LIVE HERE. `headline`, `consequence` and `resolution` come
	 * off `BlockingStory` verbatim. A component that "improves" one of them
	 * re-opens the defect.
	 */
	import AlertPanel from './AlertPanel.svelte';
	import GateRecord from './GateRecord.svelte';
	import SkeletonBar from './skeleton/SkeletonBar.svelte';
	import { type BlockingStory } from '$lib/view-models/blocking-story';
	import type { Snippet } from 'svelte';

	let {
		story,
		/** Extra controls in the banner's right-hand slot (e.g. a details popover). */
		actions,
		/**
		 * Put the gates' own record behind the disclosure. On by default: the
		 * consequence names each gate in HUMAN terms and a reader who then has
		 * to go and find the object needs its kind, its clock and its handle.
		 * Off where the surround already draws them.
		 */
		showRules = true,
		/**
		 * ⭐ A SECOND TRUE FACT ABOUT THE SAME ROLLOUT, FOLDED INSIDE THIS ONE
		 * PANEL. (P9, second re-check, finding 10) A rollout that is both held
		 * by a gate AND has gone backwards used to render TWO full-width
		 * bands — this panel's amber blocking story, then a second, blue
		 * `Rolled back` panel directly under it — 264px above a 90px status
		 * card, for one rollout. Both facts were true; nether was wrong; the
		 * DEFECT was spending a whole banner's fill on the second one.
		 *
		 * `story.consequence` is still the headline fact — it is the one a
		 * reader has to act on — and `secondaryFact` rides underneath it as a
		 * quieter line, in the SAME severity ink, inside the SAME fill. It
		 * never gets its own colour, its own icon or its own pulse: two
		 * facts, one panel.
		 *
		 * ⛔ NOT A REPLACEMENT FOR THE DISCLOSURE. The gates' own record
		 * still lives behind `showRules`; this is for a fact that is not a
		 * gate at all (a completed rollback, say) and therefore has nowhere
		 * else on this panel to go.
		 */
		secondaryFact,
		class: className = 'mb-4'
	}: {
		story: BlockingStory;
		actions?: Snippet;
		showRules?: boolean;
		secondaryFact?: string | null;
		class?: string;
	} = $props();

	const icon = $derived(iconForStory(story));

	const gates = $derived(showRules ? story.gates : []);

	const hasSecondaryFact = $derived(!!secondaryFact);

	/**
	 * ⭐ THE DISCLOSED TIER IS A RECORD NOW, NOT A PARAGRAPH, AND THE TRIGGER
	 * COUNTS. (2026-09-02)
	 *
	 * ── WHAT IT WAS ──────────────────────────────────────────────────────────
	 *
	 * One string: `${story.resolution} · rule: ${ids.join(', ')}` — a verdict
	 * sentence with a comma-joined list of generated Kubernetes names welded to
	 * the end of it, behind a control labelled `Details`.
	 *
	 * ── WHY IT CHANGED ───────────────────────────────────────────────────────
	 *
	 * On 2026-09-02 the CARD scale of this exact content — `BlockingStoryLines`
	 * → `RulePopover`, the same gates off the same story — became an aligned
	 * record behind a control reading `1 rule` / `N rules`. This object was
	 * left alone on the argument that *"its body is a SENTENCE, not a set with
	 * a count"*. Half of that is true (the verdict is a sentence) and half of
	 * it is not: the rest of the body was a SET, and it is the set the count
	 * belongs to. On `/environments` at 1440 the two render **90px apart** —
	 * the banner saying `Details` over `· rule: a, b`, the card below it saying
	 * `2 rules` over an aligned block per gate. One affordance, two shapes, two
	 * grammars, one viewport.
	 *
	 * ── THE TIER BOUNDARY DID NOT MOVE ───────────────────────────────────────
	 *
	 * `headline` and `consequence` still print; the mechanism is still one
	 * click away; `resolution` — the verdict PLUS the manual-deploy clause,
	 * which is the promise that stops a reader treating a gate as an outage —
	 * is still the last thing in the disclosure, in the same words and the same
	 * order. Only its SHAPE changed.
	 *
	 * ⛔ AND NO GATE GETS A `Clears` ROW HERE. `consequence` is printed and it
	 * already carries every gate's clause — that is what it is for. The record
	 * holds what the banner does not: which object, of what kind, on what
	 * clock, under what name. `GateRecord`'s `clearsFor` defaults to null for
	 * exactly this reason.
	 *
	 * ⛔ THE COLOUR NO LONGER SWITCHES ON `pinnedTo` HERE. (F2, 2026-09-03)
	 * This used to render `severity={story.pinnedTo ? 'pinned' : story.severity}`
	 * — a hand-picked ORANGE for the pin case, ignoring the `info` (blue)
	 * `blockingStory()` itself already computes for that branch. Orange is
	 * not this product's hue for "a state a person chose"; blue is
	 * (`Rolled back`, two panels down on rollout detail, already spends it
	 * for the identical reason). `story.severity` is the one place the rule
	 * lives now (see its own doc comment in `blocking-story.ts`) — a caller
	 * that re-derives colour from `pinnedTo` can drift from it exactly as
	 * this one did.
	 */
</script>

{#snippet gateBody()}
	<!-- THE SAME OBJECT THE CARD SCALE DRAWS, in the banner's own ink.
	     `tone="banner"` is the only difference and it is a COLOUR argument, not
	     a content one: `FactList` reads `currentColor` off `AlertPanel`'s
	     footnote class, so the record speaks in the severity's voice exactly
	     like the summary above it and the `.nav-link` beside it. -->
	<GateRecord {gates} foot={story.kindPending ? null : story.resolution} tone="banner" />
	{#if story.kindPending}
		<!-- ⭐ THE VERDICT SENTENCE ITSELF IS WITHHELD TOO. (2026-09-04, load-
		     state audit finding 4) `story.resolution` says "This clears on its
		     own once the check passes." — true of a genuine `check`, and a
		     naming of the wrong mechanism if this gate turns out to be a
		     `clock` gate once `/schedules` answers. `GateRecord`'s own
		     `factsFor` already withholds the per-gate `Kind`/`Clears` facts for
		     a `pending` gate (see that file); this is the record's LAST line,
		     same rule. -->
		<SkeletonBar width="w-56" height="h-3" class="mt-2" />
	{/if}
{/snippet}

{#snippet consequenceWithSecondaryFact()}
	<!-- ⭐ TWO FACTS, ONE FILL. See `secondaryFact`'s own doc comment. The
	     headline fact keeps its full-strength sentence; the second rides
	     underneath, quieter (`opacity-80`, same ink — never a second colour)
	     so it reads as a footnote to THIS panel rather than a panel of its
	     own. -->
	<p>{story.consequence}</p>
	<p class="mt-1 opacity-80">{secondaryFact}</p>
{/snippet}

{#snippet consequencePending()}
	<!-- ⭐ THE REASON LINE, WITHHELD. (2026-09-04, load-state audit finding
	     4, this page's own hero gate claim) `story.consequence` for a
	     `kindPending` story reads "Nothing promotes itself until a check
	     starts passing." — the exact "A check is not passing" shape the
	     audit measured, and the same claim this gate might not deserve once
	     `/schedules` answers (it could be "…until the deploy window
	     reopens in 6h 4m — 09:00 America/New_York"). Width approximates
	     that longer, real sentence rather than the shorter wrong one, so
	     the flip does not shrink-then-grow. -->
	<SkeletonBar width="w-72" height="h-3.5" />
	{#if hasSecondaryFact}
		<p class="mt-1 opacity-80">{secondaryFact}</p>
	{/if}
{/snippet}

{#if story.pinnedTo || story.blocked}
	<!-- ⚠️ THE SNIPPET IS PASSED CONDITIONALLY, NOT GUARDED INSIDE ITSELF. A
	     snippet reference is always truthy, so handing one over unconditionally
	     would give `AlertPanel` a body it must render — and with no gates that
	     is a labelled control opening onto nothing, which is the empty
	     disclosure its own test file forbids. With no gates the story still has
	     a `resolution`, so it falls back to the sentence form and `Details`. -->
	<AlertPanel
		severity={story.severity}
		title={story.headline}
		message={story.kindPending || hasSecondaryFact ? undefined : story.consequence}
		messageBody={story.kindPending
			? consequencePending
			: hasSecondaryFact
				? consequenceWithSecondaryFact
				: undefined}
		footnote={gates.length === 0 ? story.resolution : undefined}
		footnoteBody={gates.length === 0 ? undefined : gateBody}
		footnoteCount={gates.length === 0 ? undefined : gates.length}
		{icon}
		{actions}
		class={className}
		pulse={story.severity === 'warning'}
	/>
{/if}
