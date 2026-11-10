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
	/**
	 * Newest first, by the event's own last timestamp (2026-09-26). The API
	 * hands events over in whatever order the cluster listed them, and the
	 * demo fixtures in creation order — so a card could read "25 minutes ago"
	 * above "24 minutes ago" (film critic 24). A "Recent events" card that is
	 * not in time order is not a recent-events card. Events without a usable
	 * timestamp keep their incoming order at the end.
	 */
	const eventTime = (e: any): number => {
		const t = Date.parse(e?.lastTimestamp ?? e?.eventTime ?? e?.firstTimestamp ?? '');
		return Number.isNaN(t) ? -Infinity : t;
	};
	const sortedEvents = $derived([...events].sort((a, b) => eventTime(b) - eventTime(a)));
	const visibleEvents = $derived(showAllEvents ? sortedEvents : sortedEvents.slice(0, 5));

	/**
	 * ⭐ THE IDENTIFIER WRAP. (2026-09-03, design pass 7, finding #2)
	 * `event.involvedObject` names a Kubernetes object — a replicaset like
	 * `hello-frontend-app-7d9f8b6c99` — and Tailwind's default `break-words`
	 * is licensed to snap it anywhere the box cannot fit an unbroken run. At
	 * 390 this row split mid-token (`hello-fronte` / `nd-app-7d9f8b6c99`),
	 * the exact defect `app.css`'s `.ident` rule exists to close — see that
	 * rule's own note, and `FactList.svelte`'s `handleParts`, whose split
	 * this copies rather than imports (it lives in that component's instance
	 * script, not a shared module). `.ident` refuses to break anywhere but a
	 * `<wbr>`, so every `-`/`/` joint needs one or the whole string just
	 * overflows instead of wrapping. */
	function identParts(value: string): string[] {
		return value.split(/(?<=[-/])/);
	}
</script>

<!--
	⭐ NOW USES `Card`. (defect #4, design re-check, coordinator follow-up)
	`COMPOSITION-GRAMMAR.md`'s own numbers name `Recent Events` as one of the
	four reference cards that must measure 47px, same as `Deployment
	Pipeline`, `Health Checks` and `Resources` — this hand-rolled header had
	no `min-h` and measured 45px. Small, single-slot body: the cleanest of
	the four to migrate outright rather than patch a floor onto.
-->
<Card icon={CalendarWeekSolid} title="Recent events" padded={false}>
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
		<span class="t-ui-sm text-fg-subtle">{events.length} event{events.length !== 1 ? 's' : ''}</span>
	{/snippet}
	{#if events.length === 0}
		<p class="t-body px-4 py-3 text-fg-subtle">
			{#if deployedAt}
				Nothing since the deploy started · {formatTimeAgoCompact(deployedAt.toISOString(), $now)}
			{:else}
				No recent events
			{/if}
		</p>
	{:else}
		<div class="divide-y divide-line-subtle">
			{#each visibleEvents as event}
				<!-- `{@const}`'s parent must be a block, never a nested element —
				     computed here, at the `{#each}`'s own top, rather than three
				     `<div>`s down beside the span that uses it. -->
				{@const identParts_ = identParts(`${event.involvedObject?.kind ?? ''}/${event.involvedObject?.name ?? ''}`)}
				<div class="flex items-start gap-3 px-4 py-3">
					{#if event.type === 'Warning'}
						<ExclamationCircleSolid class="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
					{:else}
						<InfoCircleSolid class="mt-0.5 h-4 w-4 flex-shrink-0 text-fg-subtle" />
					{/if}
					<div class="min-w-0 flex-1">
						<!-- One line: reason, the object clamped, the time pinned right (AD
						     round 2: long paths pushed the time to a ragged second line). -->
						<div class="flex flex-wrap items-baseline gap-x-2">
							<span class="t-ui-sm shrink-0 text-fg">{event.reason}</span>
							<!-- Phone: the path takes its own truncated line under reason + time
							     (AD round 3); inline from `sm`. -->
							<span class="ident t-code-sm order-last min-w-0 basis-full truncate whitespace-nowrap text-fg-subtle sm:order-none sm:basis-auto sm:flex-1"
								>{#each identParts_ as part, pi (pi)}{part}{#if pi < identParts_.length - 1}<wbr
									/>{/if}{/each}</span
							>
							<span class="t-meta ml-auto shrink-0 tabular-nums text-fg-subtle">{formatTimeAgo(event.lastTimestamp, $now)}</span>
						</div>
						<p class="t-meta mt-0.5 text-fg-muted">{event.message}</p>
					</div>
				</div>
			{/each}
		</div>
		{#if events.length > 5}
			<button
				onclick={() => { showAllEvents = !showAllEvents; }}
				class="t-ui-sm w-full border-t border-line-subtle px-4 py-2 text-accent-text hover:bg-hover"
			>
				{showAllEvents ? 'Show fewer' : `Show all ${events.length} events`}
			</button>
		{/if}
	{/if}
</Card>
