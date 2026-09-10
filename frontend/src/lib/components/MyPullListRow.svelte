<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE ROW, SHARED BY HOME'S "Your pull requests" CARD AND `/me` — Approach
	 * B, items A/B. `#n title` (the row's own `.tap-link` destination), the
	 * repo short name, a state word, and the one-word-per-service progress
	 * summary (`my-pulls.ts`'s `myPullSummary`).
	 *
	 * ⛔ NO NEW CHIP GEOMETRY. `Chip.svelte`'s roles are a closed, carefully
	 * measured vocabulary for RANK (`newest`/`N behind`) and controller state
	 * (`held`/`checking`/`deploying`) — a PR's GitHub `open`/`merged` state is
	 * neither, and giving it a chip box risked reading as one of those
	 * existing meanings (a `MERGED` box in `newest`'s own green, next to an
	 * unrelated rank chip elsewhere on the same page, is exactly the "one hue
	 * answers one question" rule this product keeps re-deriving). This follows
	 * `ActivityRail.svelte`'s OWN established idiom instead — a bake-status
	 * word as plain `t-micro` colored text inside one flowing sentence, no
	 * box — which already carries a THIRD, independent colour axis (deploy
	 * state) alongside rank and verdict tone without collision.
	 *
	 * ONE FLEX-WRAP SENTENCE, deliberately (see `ActivityRail.svelte`'s own
	 * long comment on why: two flush ends fighting a `justify-between` row is
	 * the defect that produced 390 overlaps twice already). Nothing here is
	 * `justify-between`; the row simply wraps whatever does not fit.
	 */
	import { prPath } from '$lib/pr-ref';
	import type { MyPull } from '$lib/api/my-pulls';

	let { pull, summary }: { pull: MyPull; summary: string } = $props();

	const stateWord = $derived(pull.state === 'merged' ? 'MERGED' : 'OPEN');
	// Blue = still moving (an OPEN PR can still gain commits, merge, close —
	// the same "in progress" meaning `Card`'s own `active` tone already
	// carries); green = settled (a MERGED PR's own GitHub record is done,
	// same meaning as `Card`'s `good`). Reusing those two tones, not a new
	// pair invented for this one row.
	const stateTone = $derived(
		pull.state === 'merged'
			? 'text-green-700 dark:text-green-400'
			: 'text-blue-700 dark:text-blue-400'
	);
</script>

<li class="environment-theme-scope">
	<div
		class="tap-zone -mx-2 block rounded px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
	>
		<div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
			<span class="t-micro shrink-0 font-semibold {stateTone}">{stateWord}</span>
			<a
				href={prPath(pull.owner, pull.repo, pull.number)}
				class="tap-link t-dense min-w-0 truncate text-gray-900 dark:text-white"
				>#{pull.number} {pull.title}</a
			>
			<span class="t-micro shrink-0 text-gray-500 dark:text-gray-400">{pull.repo}</span>
			<span class="t-micro min-w-0 truncate text-gray-500 dark:text-gray-400">{summary}</span>
		</div>
	</div>
</li>
