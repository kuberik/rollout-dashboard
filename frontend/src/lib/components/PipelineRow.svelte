<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE `cluster/env` ROW inside `PipelineCard`. Split out from the card so
	 * the "why?" disclosure's `$state` (whether THIS row is open, which
	 * gates its lazy fetch) belongs to the row that owns it — Svelte 5 runes
	 * only run at a component's own top level, so a per-row toggle inside a
	 * `{#each}` needs a per-row component, not a snippet with local state.
	 *
	 * See `PipelineCard.svelte`'s own doc comment for the row grammar and
	 * the disclosure's fetch-once contract.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import Chip from './Chip.svelte';
	import FactList, { type Fact } from './FactList.svelte';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { rolloutPath } from '$lib/source-dashboard';
	import { buildGateContext, classifyGate } from '$lib/view-models/blocking-story';
	import type { PrCell, PrState } from '$lib/view-models/pr-pipeline';
	import { cellStateSentence, cellReasonText, usuallyLabel, sinceLabel } from '$lib/pr-cell-copy';
	import type { Environment, RolloutDependency } from '../../types';

	let {
		cell,
		appName,
		localClusterName,
		multiCluster,
		environments,
		rolloutDependencies,
		now = new Date()
	}: {
		cell: PrCell;
		appName: string;
		localClusterName: string;
		multiCluster: boolean;
		environments: Environment[];
		rolloutDependencies: { items?: RolloutDependency[] } | null;
		now?: Date;
	} = $props();

	/** HELD names a build that exists somewhere but cannot land in THIS cell
	 *  yet — the same three precedence-3/4 states `pr-pipeline.ts` groups
	 *  together (a candidate revision resolved, something is keeping it out). */
	const HELD_STATES: ReadonlySet<PrState> = new Set(['gated', 'waiting-upstream', 'pinned']);

	const sentence = $derived(cellStateSentence(cell, now));
	const reason = $derived(cellReasonText(cell, now));
	/**
	 * ⛔ SUPPRESSED FOR `live` — caught live on `/pr/…/kuberik-testing/1`:
	 * `cellStateSentence` already prints "live since 43m ago" for this
	 * state, so the row's own trailing "time since" column was the SAME
	 * clock twice in one row ("live since 43m ago … 43m ago"). Every other
	 * state's sentence names no instant, so the column is the only place
	 * that fact appears — this is the one case it would restate the
	 * sentence, and CLAUDE.md's "one fact, drawn, is the end of its
	 * sentence" rule is the same one `cellReasonText` already applies.
	 */
	const since = $derived(cell.state === 'live' ? null : sinceLabel(cell, now));
	const href = $derived(rolloutPath(cell.cluster || localClusterName, cell.namespace, cell.rolloutName));

	let whyOpen = $state(false);

	const whyQuery = createQuery(() => ({
		...rolloutQueryOptions({
			namespace: cell.gateHint?.namespace ?? '',
			name: cell.gateHint?.rolloutName ?? '',
			cluster: cell.gateHint?.cluster || undefined
		}),
		// ⛔ NEVER UP FRONT: `enabled` is off until this row's own `<details>`
		// opens, and once the fetch settles `staleTime: Infinity` means
		// closing and reopening never fires it again.
		enabled: !!cell.gateHint && whyOpen,
		staleTime: Infinity,
		refetchInterval: false as const,
		refetchOnWindowFocus: false as const,
		refetchOnReconnect: false as const
	}));

	const KIND_LABEL: Record<string, string> = {
		schedule: 'a deploy-window schedule',
		check: 'a check',
		promotion: 'a promotion order',
		dependency: 'a service dependency',
		approval: 'a manual approval',
		unknown: 'an unclassified rule'
	};

	const gateFacts = $derived.by<Fact[] | null>(() => {
		const hint = cell.gateHint;
		const data = whyQuery.data;
		if (!hint || !data) return null;
		const gate = data.rollout?.status?.gates?.find((g) => g.name === hint.gateName);
		if (!gate) return null;
		const ctx = buildGateContext({
			environments: { items: environments },
			rolloutDependencies,
			rolloutGates: data.rolloutGates ?? null
		});
		const classified = classifyGate(gate, hint.namespace, ctx);
		return [
			{ label: 'Kind', value: KIND_LABEL[classified.kind] ?? classified.kind },
			{ label: 'Rule', value: classified.label }
		];
	});
</script>

<li class="pc-row tap-zone flex min-h-11 flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2">
	<a
		{href}
		class="tap-link hit-32 flex shrink-0 items-center gap-1.5"
		aria-label={`Open the ${cell.envName.toUpperCase()} rollout for ${appName}`}
	>
		{#if multiCluster}
			<span class="t-micro text-gray-400 dark:text-gray-500"
				>{cell.cluster || localClusterName}/</span
			>
		{/if}
		<Chip
			role="env"
			theme={cell.theme}
			label={cell.envName}
			wide
			title={`${appName} in ${cell.envName.toUpperCase()}`}
		/>
	</a>

	<span class="t-body flex flex-wrap items-center gap-1.5 text-gray-900 dark:text-white">
		{sentence}
		{#if HELD_STATES.has(cell.state)}
			<Chip
				role="held"
				label="held"
				title={`${cell.envName.toUpperCase()} cannot take ${cell.releaseLabel || 'this build'} yet`}
			/>
		{:else if cell.state === 'rolled-back'}
			<Chip role="unranked" label="rolled back" />
		{/if}
	</span>

	{#if reason}
		<span class="t-micro basis-full text-gray-500 sm:basis-auto dark:text-gray-400">{reason}</span>
	{/if}

	<span class="t-micro ml-auto shrink-0 text-gray-400 dark:text-gray-500"
		>{usuallyLabel(cell.usuallyMs)}</span
	>

	{#if since}
		<time class="t-micro shrink-0 text-gray-400 dark:text-gray-500">{since}</time>
	{/if}

	{#if cell.gateHint}
		<details class="basis-full sm:basis-auto" bind:open={whyOpen}>
			<summary
				class="t-micro inline-flex cursor-pointer list-none items-center gap-1 rounded text-gray-500 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none dark:text-gray-400 dark:hover:text-white [&::-webkit-details-marker]:hidden"
			>
				why?
			</summary>
			{#if whyQuery.isLoading}
				<p class="t-micro mt-1 text-gray-400 dark:text-gray-500">Loading…</p>
			{:else if whyQuery.data}
				{#if gateFacts}
					<FactList facts={gateFacts} class="mt-1" />
				{:else}
					<p class="t-micro mt-1 text-gray-400 dark:text-gray-500">This rule no longer applies.</p>
				{/if}
			{:else if whyQuery.isError}
				<p class="t-micro mt-1 text-gray-400 dark:text-gray-500">Could not load this rule.</p>
			{/if}
		</details>
	{/if}
</li>
