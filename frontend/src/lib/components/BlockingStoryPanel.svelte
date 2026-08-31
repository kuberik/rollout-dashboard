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
	 * Worst-first, the same order `blockingStory` sorts its gates in.
	 */
	import {
		UserCircleSolid,
		CalendarWeekSolid,
		HourglassSolid,
		ArrowRightAltSolid,
		LockSolid,
		QuestionCircleSolid
	} from 'flowbite-svelte-icons';
	import type { BlockingStory as Story } from '$lib/view-models/blocking-story';

	export function iconForStory(story: Story) {
		if (story.pinnedTo) return LockSolid;
		if (story.person.length > 0) return UserCircleSolid;
		// ⛔ A PERSON GLYPH OVER "we cannot tell what clears this" IS THE SAME
		// PICTURE-SCALE LIE AS THE CALENDAR THIS FUNCTION WAS WRITTEN TO KILL.
		// An unattributed gate gets a question mark and nothing else does.
		if (story.unknown.length > 0) return QuestionCircleSolid;
		if (story.upstream.length > 0) return ArrowRightAltSolid;
		if (story.clock.length > 0) return CalendarWeekSolid;
		return HourglassSolid;
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
	import { ruleHandle, type BlockingStory } from '$lib/view-models/blocking-story';
	import type { Snippet } from 'svelte';

	let {
		story,
		/** Extra controls in the banner's right-hand slot (e.g. a details popover). */
		actions,
		/**
		 * Print the gate object names as a `rule:` footnote. On by default: the
		 * consequence names each gate in HUMAN terms and a reader who then has
		 * to go and find the object needs the handle. Off where the surround
		 * already prints them.
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

	const rules = $derived(showRules ? ruleHandle(story) : null);

	// The footnote carries the VERDICT first and the handles second. The verdict
	// is the line that answers "do I get up?"; the object names are a lookup key
	// and are never allowed to lead.
	//
	// ⭐ IT IS BEHIND `AlertPanel`'s DISCLOSURE NOW, AND THE LABEL SAYS WHAT
	// KIND OF THING IS THERE. (2026-08-31) Measured at 390 on
	// `hello-dep-dev/hello-frontend-app`: this footnote alone was 151 of the
	// banner's 314 characters and four of its lines, and on the live rollout it
	// mostly RESTATED the consequence above it — `consequence` said *"Nothing
	// promotes itself until hello-api-app ships a newer api than 1.66.0"* and
	// the verdict said *"Nobody has to approve anything — this clears when the
	// deploy in front of it lands."* Two sentences, one fact, one on top of the
	// other, on every gated rollout in the product.
	//
	// The half that is NOT a restatement is the `person` case (*"This will not
	// clear on its own"*), and the headline there already says
	// *"… is waiting on an approval"*. So the verdict is the answer you go
	// looking for, not the one you are handed — which is exactly what a
	// disclosure is for. `rule:` is a generated object id an operator cannot
	// act on directly; it is a lookup key and has never belonged in the first
	// second of reading.
	const footnote = $derived(rules ? `${story.resolution} · rule: ${rules}` : story.resolution);
</script>

{#if story.pinnedTo || story.blocked}
	<AlertPanel
		severity={story.pinnedTo ? 'pinned' : story.severity}
		title={story.headline}
		message={story.consequence}
		{footnote}
		footnoteLabel="What clears this"
		{icon}
		{actions}
		class={className}
		pulse={story.severity === 'warning' && !story.pinnedTo}
	/>
{/if}
