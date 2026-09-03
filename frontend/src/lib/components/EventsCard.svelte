<svelte:options runes={true} />

<script lang="ts">
	import { ExclamationCircleSolid, InfoCircleSolid, CalendarWeekSolid } from 'flowbite-svelte-icons';
	import { formatTimeAgo, formatTimeAgoCompact } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import Card from './Card.svelte';

	/**
	 * ⭐ `deployedAt` IS THE ANCHOR FOR THE HONEST EMPTY ROW. (F16, 2026-09-03)
	 * `No recent events` was true but unanchored — the reader cannot tell
	 * whether it means "quiet for an hour" or "this card has never received
	 * an event". The rollout's own current deploy timestamp turns it into a
	 * dated claim (`Nothing since the deploy started · 2d`), the same
	 * `history[0].timestamp` `HealthChecksCard`'s `windowStart` and rollout
	 * detail's `errorCutoff` already anchor to. `null` (no deploy on record)
	 * keeps the older, honestly-unanchored sentence.
	 */
	let { events, deployedAt = null }: { events: any[]; deployedAt?: Date | null } = $props();

	let showAllEvents = $state(false);
	const visibleEvents = $derived(showAllEvents ? events : events.slice(0, 5));
</script>

<!--
	⭐ NOW USES `Card`. (defect #4, design re-check, coordinator follow-up)
	`COMPOSITION-GRAMMAR.md`'s own numbers name `Recent Events` as one of the
	four reference cards that must measure 47px, same as `Deployment
	Pipeline`, `Health Checks` and `Resources` — this hand-rolled header had
	no `min-h` and measured 45px. Small, single-slot body: the cleanest of
	the four to migrate outright rather than patch a floor onto.
-->
<Card icon={CalendarWeekSolid} title="Recent Events" padded={false}>
	<!--
		⛔ AN EMPTY ROLLUP SLOT WAS A BLANK WHERE ITS THREE SIBLINGS PRINT AN
		ANSWER. (F11, 2026-09-03) `Health Checks` says `1/1 healthy`,
		`Resources` says `6/6 ready`, `Deployment Pipeline` says `2/2 done` —
		every one of them states its N/N even in the all-good case. This
		card's own rollup only rendered when `events.length > 0`, so the
		fourth header in the same rail measured a 0-width child at its right
		edge: not absent, RENDERED EMPTY, over a body that already says `No
		recent events`. `COMPOSITION-GRAMMAR.md` §1's rule for the identical
		shape on `Available Version Upgrades` ("the rollup is not conditional
		on having something to say") applies here unchanged — `0 events` is
		the honest reading of a header whose body has already looked and
		found nothing, the same "the empty state PROVES the page looked"
		argument `/dependencies` makes for its own empty card.
	-->
	{#snippet rollup()}
		<span class="text-xs text-gray-500 dark:text-gray-400">{events.length} event{events.length !== 1 ? 's' : ''}</span>
	{/snippet}
	{#if events.length === 0}
		<p class="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
			{#if deployedAt}
				Nothing since the deploy started · {formatTimeAgoCompact(deployedAt.toISOString(), $now)}
			{:else}
				No recent events
			{/if}
		</p>
	{:else}
		<div class="divide-y divide-gray-100 dark:divide-gray-700">
			{#each visibleEvents as event}
				<div class="flex items-start gap-3 px-4 py-2.5">
					{#if event.type === 'Warning'}
						<ExclamationCircleSolid class="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-700 dark:text-yellow-400" />
					{:else}
						<InfoCircleSolid class="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<span class="text-xs font-semibold text-gray-700 dark:text-gray-300">{event.reason}</span>
							<span class="text-xs text-gray-500 dark:text-gray-400">{event.involvedObject?.kind}/{event.involvedObject?.name}</span>
							<span class="ml-auto text-xs text-gray-500 dark:text-gray-400">{formatTimeAgo(event.lastTimestamp, $now)}</span>
						</div>
						<p class="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{event.message}</p>
					</div>
				</div>
			{/each}
		</div>
		{#if events.length > 5}
			<button
				onclick={() => { showAllEvents = !showAllEvents; }}
				class="w-full border-t border-gray-100 px-4 py-2 text-xs text-blue-600 hover:bg-gray-50 dark:border-gray-700 dark:text-blue-400 dark:hover:bg-gray-700/50"
			>
				{showAllEvents ? 'Show fewer' : `Show all ${events.length} events`}
			</button>
		{/if}
	{/if}
</Card>
