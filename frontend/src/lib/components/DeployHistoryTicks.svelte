<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE SIX-TICK DEPLOY HISTORY — real content for a row that otherwise
	 * has nothing between its name and its verdict chip. (2026-09-03, lists
	 * lane, design pass 9 re-check, findings 4 & 8.)
	 *
	 * `/namespaces/<ns>` printed an 863px-wide row with a 489px hole between
	 * the app name and the `newest`/`N behind` chip, and `/envs/prod` had an
	 * identical 168px hole between the last chain chip and the rank chip on
	 * every row — both are the SAME defect: a grid track (or a flex row) sized
	 * to hold more than the row currently draws. The fix is not a wider chip
	 * or a narrower column; it is a fact this page was not printing. The data
	 * already exists on every rollout it fetches (`status.history`), and no
	 * other surface draws it at row scale — the fleet-wide sparkline
	 * (`DeployVolumeSparkline`, `HowItsGoing`'s own) counts DEPLOYS over TIME
	 * across a whole population; this counts OUTCOMES for ONE rollout, so the
	 * two are not the same fact drawn twice.
	 *
	 * ⛔ NOT A NEW PALETTE. Colour comes from `getBakeStatusColor` — the same
	 * function `BakeStatusIcon` and every status disc already read — so a red
	 * tick and a red disc are the same red without a second lookup table to
	 * keep in sync.
	 *
	 * ── READING ORDER ────────────────────────────────────────────────────
	 * `history[0]` is the newest entry (every caller on this branch reads it
	 * that way — see `/namespaces/<ns>` and `/envs/<name>`'s own `latest`).
	 * The strip reads OLDEST → NEWEST, LEFT → RIGHT, the same direction time
	 * runs on every chart in the product; reversing only the slice (not the
	 * whole array) keeps this cheap on a list row.
	 */
	import { getBakeStatusColor, bakeWord } from '$lib/bake-status';
	import { formatDate } from '$lib/utils';
	import type { HistoryEntry } from '../../types';

	const TICK_COLOR: Record<ReturnType<typeof getBakeStatusColor>, string> = {
		green: 'bg-green-500 dark:bg-green-400',
		red: 'bg-red-500 dark:bg-red-400',
		yellow: 'bg-yellow-400 dark:bg-yellow-300',
		blue: 'bg-blue-500 dark:bg-blue-400',
		gray: 'bg-gray-300 dark:bg-gray-600'
	};

	let {
		history,
		max = 6,
		class: className = ''
	}: {
		/** Most-recent-first, the same order `status.history` already comes in. */
		history: HistoryEntry[] | null | undefined;
		max?: number;
		class?: string;
	} = $props();

	// Oldest → newest, left → right — see the note above.
	const ticks = $derived([...(history ?? []).slice(0, max)].reverse());
</script>

{#if ticks.length > 0}
	<span
		class="inline-flex shrink-0 items-center gap-[3px] {className}"
		role="img"
		aria-label="Last {ticks.length} deploy{ticks.length === 1 ? '' : 's'} here: {ticks
			.map((t) => bakeWord(t.bakeStatus))
			.join(', ')}"
	>
		{#each ticks as t, i (t.id ?? i)}
			<span
				class="h-2.5 w-1.5 shrink-0 rounded-sm {TICK_COLOR[getBakeStatusColor(t.bakeStatus)]}"
				title="{bakeWord(t.bakeStatus)}{t.timestamp ? ` — ${formatDate(t.timestamp)}` : ''}{t.version
					?.tag
					? ` — ${t.version.tag}`
					: ''}"
			></span>
		{/each}
	</span>
{/if}
