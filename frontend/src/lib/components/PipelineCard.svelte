<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE PR-CENTRIC PIPELINE'S ONE CARD PER SERVICE. Design doc: `luka-
	 * polish-revisions-pass-6-design-20260910-092839.md`, "Frontend" section.
	 * Standard `Card` (47px header, icon, rollup); one row per `cluster/env`
	 * cell, ordered by `envRank` (`pr-pipeline.ts`'s own sort — this
	 * component renders `service.cells` in the order it already arrives).
	 * No coverage bar — this is a timeline, not a fleet-wide tally.
	 *
	 * The header's icon reuses `ChevronDoubleRightOutline` — the SAME glyph
	 * `PromotionPipeline`'s own card header spends (`../CLAUDE.md`: "a
	 * promotion order takes `ChevronDoubleRightOutline`") — because this
	 * card draws the identical shape (a service's build moving dev → prod)
	 * at a different scale; the icon is structural, not decoration
	 * (`../CLAUDE.md`'s icon rule), so it should not invent a second glyph
	 * for one meaning.
	 *
	 * Row rendering itself lives in `PipelineRow.svelte`: the "why?"
	 * disclosure's `$state` (is THIS row's gate detail open) has to belong
	 * to a per-row component, not a snippet, because runes only run at a
	 * component's own top level.
	 */
	import { ChevronDoubleRightOutline } from 'flowbite-svelte-icons';
	import Card from './Card.svelte';
	import PipelineRow from './PipelineRow.svelte';
	import type { PrService, PrCell } from '$lib/view-models/pr-pipeline';
	import type { Environment, RolloutDependency } from '../../types';

	let {
		service,
		localClusterName,
		environments,
		rolloutDependencies,
		now = new Date()
	}: {
		service: PrService;
		/** Fallback for a hub-local cell's empty `cluster`, same as every
		 *  other `rolloutPath()` call site (`c.sourceCluster || localClusterName`). */
		localClusterName: string;
		environments: Environment[];
		rolloutDependencies: { items?: RolloutDependency[] } | null;
		now?: Date;
	} = $props();

	const multiCluster = $derived(
		new Set(service.cells.map((c) => c.cluster || localClusterName)).size > 1
	);

	/** No amber option on `Card` (`Card.svelte`'s own rule: a blocked card
	 *  states its fact in a banner, not by staining the whole header) — the
	 *  rollup's tone is restrained to the four values the component has. */
	function verdictTone(cells: PrCell[]): 'neutral' | 'good' | 'adverse' | 'active' | 'held' {
		if (cells.some((c) => c.state === 'failed')) return 'adverse';
		if (cells.some((c) => c.state === 'cancelled' || c.state === 'rolled-back')) return 'held';
		if (
			cells.some((c) => c.state === 'deploying' || c.state === 'baking' || c.state === 'retrying')
		)
			return 'active';
		if (cells.length > 0 && cells.every((c) => c.state === 'live')) return 'good';
		return 'neutral';
	}
	const tone = $derived(verdictTone(service.cells));
</script>

<Card
	icon={ChevronDoubleRightOutline}
	title={service.appName}
	titleHref={`/apps/${encodeURIComponent(service.appName)}`}
	verdict={service.furthest}
	verdictTone={tone}
	padded={false}
>
	<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
		{#each service.cells as cell (`${cell.cluster}/${cell.envName}`)}
			<PipelineRow
				{cell}
				appName={service.appName}
				{localClusterName}
				{multiCluster}
				{environments}
				{rolloutDependencies}
				{now}
			/>
		{/each}
	</ul>
</Card>
