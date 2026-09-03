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
		check: ShieldCheckSolid
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
		class: className = 'mb-4'
	}: {
		story: BlockingStory;
		actions?: Snippet;
		showRules?: boolean;
		class?: string;
	} = $props();

	const icon = $derived(iconForStory(story));

	const gates = $derived(showRules ? story.gates : []);

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
	 */
</script>

{#snippet gateBody()}
	<!-- THE SAME OBJECT THE CARD SCALE DRAWS, in the banner's own ink.
	     `tone="banner"` is the only difference and it is a COLOUR argument, not
	     a content one: `FactList` reads `currentColor` off `AlertPanel`'s
	     footnote class, so the record speaks in the severity's voice exactly
	     like the summary above it and the `.nav-link` beside it. -->
	<GateRecord {gates} foot={story.resolution} tone="banner" />
{/snippet}

{#if story.pinnedTo || story.blocked}
	<!-- ⚠️ THE SNIPPET IS PASSED CONDITIONALLY, NOT GUARDED INSIDE ITSELF. A
	     snippet reference is always truthy, so handing one over unconditionally
	     would give `AlertPanel` a body it must render — and with no gates that
	     is a labelled control opening onto nothing, which is the empty
	     disclosure its own test file forbids. With no gates the story still has
	     a `resolution`, so it falls back to the sentence form and `Details`. -->
	<AlertPanel
		severity={story.pinnedTo ? 'pinned' : story.severity}
		title={story.headline}
		message={story.consequence}
		footnote={gates.length === 0 ? story.resolution : undefined}
		footnoteBody={gates.length === 0 ? undefined : gateBody}
		footnoteCount={gates.length === 0 ? undefined : gates.length}
		{icon}
		{actions}
		class={className}
		pulse={story.severity === 'warning' && !story.pinnedTo}
	/>
{/if}
