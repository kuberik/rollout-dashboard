<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ EVERY GATE HOLDING ONE ROLLOUT, ONE LINE EACH, INSIDE A CARD.
	 *
	 * `BlockingStoryPanel` is the page-level object — a filled banner, one per
	 * page, `COMPOSITION-GRAMMAR.md` §4. This is the same story at CARD scale,
	 * and the difference is deliberate: a second fill inside a card would
	 * flatten the one object on the page that is allowed one.
	 *
	 * ⛔ IT LISTS THEM ALL. The component this replaces printed the FIRST
	 * matching branch — one gate, chosen by whether it published an allow-list
	 * — so a rollout held by an approval, an upstream deploy and a closed
	 * window rendered as a single line about the approval. Three surfaces did
	 * that with three different first-matches, which is how one product came to
	 * name three different culprits for one rollout.
	 *
	 * ⛔ NO STRINGS HERE EITHER. `short` and the clock come off the story.
	 */
	import {
		UserCircleSolid,
		CalendarWeekSolid,
		HourglassSolid,
		ArrowRightAltSolid
	} from 'flowbite-svelte-icons';
	import { formatTimeUntil } from '$lib/api/schedules';
	import { now } from '$lib/stores/time';
	import type { BlockingStory, ClassifiedGate } from '$lib/view-models/blocking-story';

	let {
		story,
		class: className = ''
	}: { story: BlockingStory; class?: string } = $props();

	function iconFor(g: ClassifiedGate) {
		if (g.clears === 'person') return UserCircleSolid;
		if (g.clears === 'upstream') return ArrowRightAltSolid;
		if (g.clears === 'clock') return CalendarWeekSolid;
		return HourglassSolid;
	}

	// The clock's arithmetic is `api/schedules.ts`'s, the same function the
	// banner and `/versions` call, so two objects on one screen cannot print
	// two different times for one window.
	function whenFor(g: ClassifiedGate): string | null {
		if (!g.clearsAt) return null;
		const until = formatTimeUntil(g.clearsAt, $now);
		return until ? `reopens in ${until} (${new Date(g.clearsAt).toLocaleString()})` : null;
	}
</script>

{#if story.blocked && story.gates.length > 0}
	<ul class="mt-1.5 flex flex-col gap-1 {className}">
		{#each story.gates as g (g.id)}
			{@const Icon = iconFor(g)}
			{@const when = whenFor(g)}
			<li class="t-micro flex min-w-0 items-start gap-1.5 text-gray-500 dark:text-gray-400">
				<Icon class="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				<span class="min-w-0">
					<!-- ONE EXPRESSION, NOT AN `{#if}`. The block form ate the
					     leading space and rendered `deploy window— reopens in 12h`. -->
					<span>{when ? `${g.short} — ${when}` : g.short}</span>
					<!-- THE IDENTIFIER IS A HANDLE AND IS DRESSED AS ONE: mono,
					     muted, on its own line, labelled with the word that says
					     what it is. Inline it inherited the sentence's wrap point
					     and a 300px card split `schedule-gate-fk44d` into `fk` /
					     `44d`, which reads as two identifiers. -->
					<span
						class="t-code-sm block break-all text-gray-500 dark:text-gray-400"
						title="The rule holding this: {g.id}">rule: {g.id}</span
					>
				</span>
			</li>
		{/each}
		<!-- ⛔ `verdict`, NOT `resolution`. The manual-deploy clause is a
		     PAGE-level promise and the banner carries it; repeated under every
		     row it was the same sentence three times in one viewport. -->
		<li class="t-micro mt-0.5 text-gray-500 dark:text-gray-400">{story.verdict}</li>
	</ul>
{/if}
