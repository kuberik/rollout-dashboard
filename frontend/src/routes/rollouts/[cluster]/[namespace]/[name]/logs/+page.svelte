<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { Button } from 'flowbite-svelte';
	import LogsViewer from '$lib/components/LogsViewer.svelte';

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	// Support ?tab=tests or ?tab=pods query parameter
	const tabFromUrl = $derived(page.url.searchParams.get('tab'));
	const initialTab = $derived.by(() => {
		if (tabFromUrl === 'tests') return 'tests';
		return 'pods';
	});

	let activeTab = $state<'pods' | 'tests'>('pods');

	// Set initial tab from URL on mount
	$effect(() => {
		if (tabFromUrl === 'tests' || tabFromUrl === 'pods') {
			activeTab = tabFromUrl;
		}
	});

	// The rollup sentence ("2,031 lines · 2 pods · Streaming") LogsViewer
	// computes from the counts it owns, SPLIT at its own joint — `count` is
	// the leading figure, `rest` is everything after it — so the head row
	// below can print them at two type roles instead of one. See
	// `LogsSummary` in LogsViewer.svelte for why: the sr-only `h1` note there
	// explains what used to live in this slot. `errorCount`/`errorsFiltered`/
	// `toggleErrorFilter` are the same bound-out shape for the error rollup
	// (finding #3c) — mirrored here rather than imported because
	// `LogsSummary` lives in `LogsViewer.svelte`'s instance script, not its
	// `module` context, so it isn't an importable type.
	let summary = $state<{
		count: number;
		rest: string;
		errorCount: number;
		errorsFiltered: boolean;
		toggleErrorFilter: () => void;
	}>({ count: 0, rest: '', errorCount: 0, errorsFiltered: false, toggleErrorFilter: () => {} });
</script>

<svelte:head>
	<title>kuberik | {name} ({namespace}) Logs</title>
</svelte:head>

<!-- ⭐ `min-h-0 flex-1`, NOT `h-full`. The rollout layout's scroller is a flex
     column now (the tab strip moved inside it so the strip and the page are
     centred in the SAME content box), and `height: 100%` in there resolves
     against the scroller's full height — which would make this tab exactly one
     tab strip taller than its pane and give the only tab that must not scroll a
     49px scrollbar. As a flex item it takes the remainder instead. -->
<div class="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden px-4 py-6 dark:bg-gray-900 sm:px-6">
	<div class="mb-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-2 sm:mb-4">
		<!-- ⛔ THIS `h1` SAID "Logs" DIRECTLY UNDER A TAB STRIP WHOSE ACTIVE TAB
		     ALREADY SAYS "Logs" — the same duplicate-heading defect `/apps`,
		     `/activity` and this rollout's own History tab were fixed for.
		     `sr-only`, not deleted: the skip link lands on `main` and the page
		     outline still needs a level-1 heading. What fills the visible slot
		     is the rollup LogsViewer already prints, promoted up — the one
		     thing the tab strip does not say.

		     ⛔ AND THE VISIBLE SLOT WAS THE WRONG TYPE ROLE. (defect #2) A
		     bare `t-headline` (17/600) put the whole sentence — count and
		     qualifiers alike — one size below `/activity`, `/versions`,
		     `/dependencies`, `/rollouts` and this rollout's own sibling
		     `/history` tab, every one of which leads this exact slot with a
		     `t-display` (24px) figure and carries the rest of the sentence at
		     `t-dense` on its baseline. `LogsViewer` now hands back `summary`
		     split at that joint instead of one joined string. -->
		<h1 class="sr-only">Logs</h1>
		<div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
			<span class="t-display tabular-nums text-gray-900 dark:text-white"
				>{summary.count.toLocaleString()}</span
			>
			<p class="t-dense min-w-0 text-gray-500 dark:text-gray-400">{summary.rest || 'Logs'}</p>
			<!-- ⭐ THE ERROR COUNT, ALSO HERE. (2026-09-03, design pass 6,
			     operator-walk finding #3c) `LogsViewer`'s own Card rollup
			     carries the same control right beside the log pane; this
			     copy is the one a reader sees FIRST, before scrolling past
			     the tab strip to the pane itself — both toggle the identical
			     `Level` filter via the same `toggleErrorFilter` callback
			     `LogsViewer` binds out through `summary`, so the two can
			     never disagree about whether the filter is on. -->
			{#if summary.errorCount > 0}
				<button
					type="button"
					class="nav-link text-red-600 dark:text-red-400"
					aria-pressed={summary.errorsFiltered}
					onclick={summary.toggleErrorFilter}
				>
					{summary.errorCount} error{summary.errorCount === 1 ? '' : 's'}
				</button>
			{/if}
		</div>
		<!-- Tab buttons inline on mobile.
		     ⛔ `py-1.5` MADE THIS 28PX AGAINST THE FILTER DROPDOWNS' 34PX, 60PX
		     BELOW IN THE SAME PANE. (2026-09-03, design pass 6, finding #12)
		     Flowbite's `Button size="xs"` (`LogsViewer`'s Source/Level/Columns
		     triggers) is `px-3 py-2 text-xs` plus a 1px border each side — 34px.
		     This segmented control carried the border on the WRAPPER, not each
		     button, so matching the wrapper's own padding to `py-1.5` undershot
		     by 6px: `py-1.5`(12) + `text-xs` line-height(16) = 28, +2 border on
		     the wrapper = 30, still short. `py-2` unconditionally (dropping the
		     `sm:py-2` duplicate — it is no longer a step up from anything) gives
		     16+16=32 per button, +2 wrapper border = 34, matching exactly. -->
		<!-- `aria-pressed`, not `role="tab"`. A tablist commits a keyboard
		     contract this control does not implement (arrow-key roving focus
		     between tabs per the ARIA APG) — adding the role without it would
		     announce a pattern that then does not work. `aria-pressed` on a
		     plain two-button toggle group needs no extra keyboard wiring: Tab
		     already reaches both buttons and Enter/Space already activates
		     them. (2026-09-03, design pass 6, operator-walk finding #2.) -->
		<div class="flex rounded border border-gray-200 dark:border-gray-700">
			<button
				aria-pressed={activeTab === 'pods'}
				class="px-3 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm {activeTab === 'pods'
					? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
					: 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'} rounded-l"
				onclick={() => (activeTab = 'pods')}
			>
				Pods
			</button>
			<button
				aria-pressed={activeTab === 'tests'}
				class="px-3 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm {activeTab === 'tests'
					? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
					: 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'} rounded-r"
				onclick={() => (activeTab = 'tests')}
			>
				Tests
			</button>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">

		<!-- Tab content -->
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			{#if activeTab === 'pods'}
				<LogsViewer {namespace} {name} {cluster} filterType="pod" bind:summary />
			{:else}
				<LogsViewer {namespace} {name} {cluster} filterType="test" bind:summary />
			{/if}
		</div>
	</div>
</div>
