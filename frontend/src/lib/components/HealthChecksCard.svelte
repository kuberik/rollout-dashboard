<svelte:options runes={true} />

<script lang="ts">
	import type { HealthCheck } from '../../types';
	import StatusSpinner from './StatusSpinner.svelte';
	import Card from './Card.svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		ClockArrowOutline
	} from 'flowbite-svelte-icons';
	import { formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { classifyCheck, recoveredLabel, recoveredTitle } from '$lib/view-models/health-witness';

	/**
	 * ⭐ `windowStart` IS THE FIX FOR "4/4 healthy AND NOTHING ELSE".
	 *
	 * A critic recovered a failing check to `Healthy` leaving `lastErrorTime` in
	 * place — the witness semantics this system deliberately relies on, which
	 * rollout and stepgate read to catch transient failures they would otherwise
	 * miss. The API returned `{"status":"Healthy","lastErrorTime":"…01:39:09Z",
	 * "message":"p99 latency back within SLO"}` while the other three checks had
	 * no `lastErrorTime` at all. This card rendered **`Health Checks — 4/4
	 * healthy`** and stopped, because with no failing and no pending rows the
	 * body below never rendered: **no list, and no expander to open.** There was
	 * no affordance anywhere in the product to learn a check had been erroring
	 * ninety seconds earlier, so the operator concluded the alert that paged
	 * them was noise.
	 *
	 * `null` (the default) means the caller has no deploy to anchor the window
	 * to, and every check then reads as plain `passing` — the pre-2026-08-31
	 * behaviour, and the honest one: an error with no attempt to be evidence
	 * about is not a witness. See `view-models/health-witness.ts` for why the
	 * window is `max(deployedAt, lastRetryAt)` and not a fixed age.
	 */
	let {
		healthChecks,
		windowStart = null
	}: { healthChecks: HealthCheck[]; windowStart?: Date | null } = $props();

	let expandedMessages = $state<Set<string>>(new Set());

	function toggleMessage(key: string) {
		const next = new Set(expandedMessages);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedMessages = next;
	}

	// ⛔ FOUR STATES NOW, AND THE FOUR SETS ARE DISJOINT. `recovered` used to sit
	// inside `healthyChecks`, which is exactly why it was invisible: counted as
	// part of `4/4 healthy`, then drawn as one more green chip in a row that
	// only renders when something else is already wrong.
	const failedChecks = $derived(
		healthChecks.filter((hc) => classifyCheck(hc, windowStart) === 'failing')
	);
	const pendingChecks = $derived(
		healthChecks.filter((hc) => classifyCheck(hc, windowStart) === 'pending')
	);
	const recovered = $derived(
		healthChecks.filter((hc) => classifyCheck(hc, windowStart) === 'recovered')
	);
	const healthyChecks = $derived(
		healthChecks.filter((hc) => classifyCheck(hc, windowStart) === 'passing')
	);
	function errorAgo(hc: HealthCheck): string {
		return hc.status?.lastErrorTime ? formatTimeAgo(hc.status.lastErrorTime, $now) : 'earlier';
	}

	/**
	 * ⭐ THIS CARD NOW USES `Card`, NOT A HAND-ROLLED HEADER. (defect #4,
	 * design re-check) `COMPOSITION-GRAMMAR.md`'s own numbers: every header
	 * on the reference page measures 47px because `Card` floors it there;
	 * this component's own `px-4 py-3` bar with no `min-h` measured 45px —
	 * two numbers for what is meant to be one idiom. `Card`'s `icon` prop
	 * takes the same conditional glyph this header always chose; the rollup
	 * is a snippet because the four states here (failing/pending/recovered/
	 * healthy) need four different inks that `Card`'s four `VerdictTone`
	 * values don't all cover (no `warning` tone exists — amber is reserved
	 * for `stuck`, see `Card.svelte`'s own note on why) — this rollup is the
	 * one legitimate case for `warning` yellow at header scale, unchanged
	 * from before the migration.
	 */
	const HeaderIcon = $derived(
		failedChecks.length > 0
			? ExclamationCircleSolid
			: pendingChecks.length > 0
				? ClockSolid
				: recovered.length > 0
					? ClockArrowOutline
					: CheckCircleSolid
	);
	const headerIconClass = $derived(
		failedChecks.length > 0
			? 'text-red-500 dark:text-red-400'
			: pendingChecks.length > 0 || recovered.length > 0
				? 'text-yellow-700 dark:text-yellow-400'
				: 'text-green-700 dark:text-green-400'
	);
</script>

{#if healthChecks.length > 0}
	<Card icon={HeaderIcon} iconClass={headerIconClass} title="Health Checks" padded={false}>
		{#snippet rollup()}
			{#if failedChecks.length > 0}
				<span class="text-xs font-semibold text-red-600 dark:text-red-400"
					>{failedChecks.length} failing{pendingChecks.length > 0
						? ` · ${pendingChecks.length} pending`
						: ''}{recovered.length > 0 ? ` · ${recovered.length} recovered` : ''} · {healthyChecks.length}
					passing</span
				>
			{:else if pendingChecks.length > 0}
				<span class="text-xs text-yellow-700 dark:text-yellow-400"
					>{pendingChecks.length} pending{recovered.length > 0
						? ` · ${recovered.length} recovered`
						: ''} · {healthyChecks.length} passing</span
				>
			{:else if recovered.length > 0}
				<!-- ⛔ THE ROLLUP THAT READ `4/4 healthy` DURING AN INCIDENT.
				     COMPOSITION-GRAMMAR §1: this line is the card's whole answer for a
				     reader who does not open it, and it answered wrong. The counts are
				     DISJOINT and sum to the total, so `3 passing · 1 recovered` over
				     four checks still adds up; `4/4 · 1 recovered` would have been the
				     same all-clear with a footnote. -->
				<span class="text-xs text-yellow-700 dark:text-yellow-400"
					>{healthyChecks.length} passing · {recovered.length} recovered</span
				>
			{:else}
				<span class="text-xs text-green-700 dark:text-green-400"
					>{healthChecks.length}/{healthChecks.length} healthy</span
				>
			{/if}
		{/snippet}
		{#each failedChecks as hc (hc.metadata?.name + '/' + hc.metadata?.namespace)}
			<div
				class="border-b border-gray-100 bg-red-50 px-4 py-3 last:border-b-0 dark:border-gray-700/60 dark:bg-red-950/15"
			>
				<div class="flex items-start gap-3">
					<ExclamationCircleSolid
						class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500 dark:text-red-400"
					/>
					<div class="min-w-0 flex-1">
						<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
							<span class="text-sm font-semibold text-gray-900 dark:text-white">
								{hc.metadata?.annotations?.['kuberik.com/display-name'] || hc.metadata?.name}
							</span>
							<div class="flex shrink-0 items-center gap-2 text-xs">
								{#if hc.status?.lastChangeTime}
									<span class="text-gray-500 dark:text-gray-400"
										>{formatTimeAgo(hc.status.lastChangeTime, $now)}</span
									>
								{/if}
								<span
									class="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300"
								>
									{hc.status?.status || 'Unknown'}
								</span>
							</div>
						</div>
						{#if hc.status?.message}
							{@const key = 'f-' + hc.metadata?.name + '/' + hc.metadata?.namespace}
							{@const expanded = expandedMessages.has(key)}
							<p
								class="text-sm leading-relaxed text-gray-600 dark:text-gray-400"
								class:line-clamp-3={!expanded}
							>
								{hc.status.message}
							</p>
							{#if hc.status.message.length > 200}
								<button
									onclick={() => toggleMessage(key)}
									class="mt-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
								>
									{expanded ? 'Show less' : 'Show more'}
								</button>
							{/if}
						{/if}
					</div>
				</div>
			</div>
		{/each}
		{#each pendingChecks as hc (hc.metadata?.name + '/' + hc.metadata?.namespace)}
			<div
				class="border-b border-gray-100 bg-yellow-50 px-4 py-2.5 last:border-b-0 dark:border-gray-700/60 dark:bg-yellow-950/10"
			>
				<div class="flex items-start gap-3">
					<StatusSpinner size="4" color="yellow" class="mt-0.5" />
					<div class="min-w-0 flex-1">
						<span class="text-sm text-gray-700 dark:text-gray-300">
							{hc.metadata?.annotations?.['kuberik.com/display-name'] || hc.metadata?.name}
						</span>
						{#if hc.status?.message}
							{@const key = 'p-' + hc.metadata?.name + '/' + hc.metadata?.namespace}
							{@const expanded = expandedMessages.has(key)}
							<p
								class="mt-0.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400"
								class:line-clamp-3={!expanded}
							>
								{hc.status.message}
							</p>
							{#if hc.status.message.length > 200}
								<button
									onclick={() => toggleMessage(key)}
									class="mt-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
								>
									{expanded ? 'Show less' : 'Show more'}
								</button>
							{/if}
						{/if}
					</div>
					<span
						class="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300"
					>
						{hc.status?.status || 'Pending'}
					</span>
				</div>
			</div>
		{/each}
		{#each recovered as hc (hc.metadata?.name + '/' + hc.metadata?.namespace)}
			<!--
					⭐ THE ROW THAT DID NOT EXIST. A check that is passing NOW but errored
					inside this deploy's window reads as RECOVERED, not clean.
				
					⛔ AT REST, NOT BEHIND AN EXPANDER. That was the whole failure: with
					nothing failing and nothing pending, this card's body did not render,
					so there was no control to open and nothing to open it onto. A witness
					you have to already suspect is not a witness.
				
					⚠️ THE STATE COMES FIRST — *"passing, last errored 2m ago"*. The check
					really is passing and a reader who takes only the first word must not
					be misled into paging someone; a reader who stops at the second clause
					has still learned the thing their alert was about.
				-->
			<div
				class="border-b border-gray-100 bg-yellow-50 px-4 py-2.5 last:border-b-0 dark:border-gray-700/60 dark:bg-yellow-950/10"
			>
				<div class="flex items-start gap-3">
					<ClockArrowOutline
						class="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-700 dark:text-yellow-400"
					/>
					<div class="min-w-0 flex-1">
						<span class="text-sm text-gray-700 dark:text-gray-300">
							{hc.metadata?.annotations?.['kuberik.com/display-name'] || hc.metadata?.name}
						</span>
						<p class="mt-0.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
							<!-- ⚠️ THE SEPARATOR IS INSIDE THE EXPRESSION. Written as literal
								     text around the `{#if}`, Svelte trims the leading space and it
								     rendered `3 minutes ago— p99 latency…`, which reads as a
								     hyphenated word rather than a clause break. -->
							{recoveredLabel(errorAgo(hc))}{#if hc.status?.message}{` — ${hc.status.message}`}{/if}
						</p>
					</div>
					<span
						class="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300"
						title={recoveredTitle(hc, errorAgo(hc))}>recovered</span
					>
				</div>
			</div>
		{/each}
		{#if healthyChecks.length > 0}
			<!--
				⭐ A ROW PER CHECK, NOT A CHIP TRAY. (F16, 2026-09-03) With the body
				gated on `problemChecks.length > 0`, an all-clear rollout's card
				measured 49px — header and rollup, nothing else — the exact defect
				`COMPOSITION-GRAMMAR.md` §7 names ("the rail is a stack of small
				complete answers", not a header that stops). This list is
				unconditional now (siblings of the three `{#each}` above, not
				nested under a guard that excludes them), and each row states its
				own name and state word rather than compressing four checks into a
				tray of unlabelled pills — `4/4 healthy` now has four rows under it.
			-->
			<div
				class="flex flex-col {failedChecks.length + pendingChecks.length + recovered.length > 0
					? 'border-t border-gray-100 dark:border-gray-700'
					: ''}"
			>
				{#each healthyChecks as hc (hc.metadata?.name + '/' + hc.metadata?.namespace)}
					<div
						class="flex items-center gap-3 border-b border-gray-100 px-4 py-2 last:border-b-0 dark:border-gray-700/60"
					>
						<CheckCircleSolid class="h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />
						<span class="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
							{hc.metadata?.annotations?.['kuberik.com/display-name'] || hc.metadata?.name}
						</span>
						<span class="shrink-0 text-xs font-medium text-green-700 dark:text-green-400"
							>passing</span
						>
					</div>
				{/each}
			</div>
		{/if}
	</Card>
{/if}
