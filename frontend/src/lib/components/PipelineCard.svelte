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
	import { cellStateSentence, reasonTail } from '$lib/pr-cell-copy';
	import { envFamilyWord } from '$lib/version-utils';
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

	/**
	 * ⭐ CHANGES-2026-09-10 §7, ITEM 1/2 — THE FRONTIER CELL. The first
	 * not-yet-live cell in `service.cells`' own order (`pr-pipeline.ts`
	 * already sorts it `envRank` ascending — dev → prod), i.e. the next
	 * environment this change has not reached. `null` when every cell is
	 * already `live` (nothing left to estimate or promote). Cells are keyed
	 * `cluster/envName` — the same key `PipelineCard`'s own `{#each}` already
	 * uses, so identity survives a mid-flight state change with no index to
	 * go stale.
	 */
	const frontierKey = $derived.by<string | null>(() => {
		const cell = service.cells.find((c) => c.state !== 'live');
		return cell ? `${cell.cluster}/${cell.envName}` : null;
	});

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

	/**
	 * ⛔ FIX PASS ITEM 7, 2026-09-10 — A CARD WHOSE EVERY ROW SAYS THE SAME
	 * THING PRINTS ONE LINE, NOT N ROWS. Measured live: `hello-api-app` held
	 * three (identical) "not built yet" rows, one per environment — the
	 * exact "twelve rows of `not built yet`" defect CHANGES-2026-09-10.md's
	 * own intro names as the thing to cut, still present at the CARD grain
	 * (§2c item 1 folds it at the card-ROLLUP level already; this is the
	 * card BODY). Folds only when `cellStateSentence` — the row's own
	 * sentence, same call `PipelineRow` makes — agrees for every cell, not
	 * merely `state`: two `gated` cells held by two DIFFERENT rules are not
	 * "the same" even though their state matches.
	 */
	const foldedSentence = $derived.by<string | null>(() => {
		if (service.cells.length < 2) return null;
		const first = cellStateSentence(service.cells[0], now);
		if (!service.cells.every((c) => cellStateSentence(c, now) === first)) return null;
		const envNames = service.cells.map((c) => c.envName.toLowerCase()).join(' · ');
		/**
		 * ⭐ FIX PASS ITEM 2, 2026-09-10 — THE FOLDED SENTENCE STAYS WHOLE.
		 * The card used to print only the state sentence and the env list —
		 * "waiting on hello-api-app in dev · staging · prod" — dropping the
		 * ADDED fact `joinDependencyReasons` attaches to `reason`
		 * ("— its build of this change does not exist yet"). `reasonTail`
		 * strips the shared "waiting on hello-api-app" prefix so it is not
		 * printed twice; folds only when every cell's tail agrees too (not
		 * merely its state sentence) — two cells held for the SAME state but
		 * DIFFERENT specific reasons are not "the same" here either.
		 */
		const firstTail = reasonTail(service.cells[0], now);
		const tailAgrees = service.cells.every((c) => reasonTail(c, now) === firstTail);
		const tail = tailAgrees && firstTail ? ` — ${firstTail}` : '';
		return `${first} in ${envNames}${tail}`;
	});

	/**
	 * ⭐ ROUND 2, R2.3 — THE STAGE LINE, THEN THE PRODUCTION SET.
	 * `DESIGN-INTENT.md`'s own rule for a promotion order: dev → staging is a
	 * LINE (one thing follows another, so a connector between them is a true
	 * fact) and the PRD-family regions below it are a SET (three prod regions
	 * do not promote to one another, so a connector between them would claim
	 * an order that does not exist). `service.cells` already arrives sorted
	 * `envRank` ascending (`pr-pipeline.ts`); this only SPLITS that one order
	 * into the two groups `PipelineRow`'s own connector needs to tell apart —
	 * it does not re-sort either half.
	 */
	const stageCells = $derived(service.cells.filter((c) => envFamilyWord(c.envName) !== 'PRD'));
	const prodCells = $derived(service.cells.filter((c) => envFamilyWord(c.envName) === 'PRD'));
</script>

<Card
	icon={ChevronDoubleRightOutline}
	title={service.appName}
	titleHref={`/apps/${encodeURIComponent(service.appName)}`}
	verdict={service.furthest}
	verdictCompact={service.furthestCompact}
	verdictTone={tone}
	padded={false}
>
	{#if foldedSentence}
		<!-- ⛔ FIX PASS ITEM 7 — ONE LINE, NOT A RUN OF IDENTICAL ROWS. -->
		<p class="t-body px-4 py-2.5 text-gray-600 dark:text-gray-300">{foldedSentence}</p>
	{:else}
		<!-- R2.3: an `ol` (ordered promotion), not a `ul` — the stage rows
		     genuinely have an order; the production rows below them are a
		     SET, but the list element itself is one continuous document
		     order, same as `DeploymentPipelineCard`'s own `navRow` list. -->
		<ol class="divide-y divide-gray-100 dark:divide-gray-700/60">
			{#each stageCells as cell, i (`${cell.cluster}/${cell.envName}`)}
				<PipelineRow
					{cell}
					appName={service.appName}
					{localClusterName}
					{multiCluster}
					{environments}
					{rolloutDependencies}
					{now}
					isFrontier={frontierKey === `${cell.cluster}/${cell.envName}`}
					connectorAbove={i > 0}
					connectorBelow={i < stageCells.length - 1}
				/>
			{/each}
			{#each prodCells as cell (`${cell.cluster}/${cell.envName}`)}
				<!-- No connector into or within the production SET — see
				     `prodCells`'s own doc comment. -->
				<PipelineRow
					{cell}
					appName={service.appName}
					{localClusterName}
					{multiCluster}
					{environments}
					{rolloutDependencies}
					{now}
					isFrontier={frontierKey === `${cell.cluster}/${cell.envName}`}
					connectorAbove={false}
					connectorBelow={false}
				/>
			{/each}
		</ol>
	{/if}
</Card>
