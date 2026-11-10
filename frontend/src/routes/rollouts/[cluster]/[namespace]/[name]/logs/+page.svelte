<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { outageEscalation } from '$lib/view-models/outage-escalation.svelte';
	import LogsViewer from '$lib/components/LogsViewer.svelte';
	import RolloutTabHeader from '$lib/components/RolloutTabHeader.svelte';
	import NotFound from '$lib/components/NotFound.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy } from '$lib/api/errors';
	import type { Rollout } from '../../../../../../types';
	import { pageTitle } from '$lib/page-title';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { href } from '$lib/paths';

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	// Support ?tab=tests or ?tab=pods query parameter
	const tabFromUrl = $derived(page.url.searchParams.get('tab'));

	// The header's build + state pill: the same cache entry the layout and
	// the Overview read, so this costs no extra request.
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster,
			options: { refetchInterval: pollWhenHealthy(5000, 300_000, cluster) }
		})
	);
	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null | undefined);

	/**
	 * ⭐ NOT FOUND, LIKE THE SIBLING History TAB (squad-rollout coordinator,
	 * 2026-10-09). Before this, a missing rollout left `rollout` `undefined`
	 * forever — `LogsViewer` doesn't know or care whether its own name/
	 * namespace props point at a real object, so its "Connecting to pods…"
	 * spinner just span, honestly reporting a connection that was never
	 * going to open. `loading`/`error`/`!rollout` is the exact three-way
	 * split `history/+page.svelte` already uses on the SAME query shape
	 * (`rolloutQueryOptions` resolves a missing rollout to `{ rollout: null
	 * }`, not a thrown error — a 404 is not a fetch failure).
	 */
	// PALROW r8 (AD palette r7 item 3): a full outage escalates to ErrorState
	// after two failed answers instead of retrying on the skeleton forever
	// (`view-models/outage-escalation.svelte.ts`).
	const outage = outageEscalation(
		() => rolloutQuery,
		() => `${cluster}/${namespace}/${name}`
	);
	const rolloutLoading = $derived(outage.loading);
	const rolloutError = $derived(outage.error);

	let activeTab = $state<'pods' | 'tests'>('pods');

	// Set initial tab from URL on mount
	$effect(() => {
		if (tabFromUrl === 'tests' || tabFromUrl === 'pods') {
			activeTab = tabFromUrl;
		}
	});

	/**
	 * ⭐ REFERENCE REGION: `PageHeader` object form, the same header History
	 * and the Overview open with, so the title stays in one place across tab
	 * switches (TL review round 3). The name comes from the URL; no query.
	 */

	/**
	 * ⭐ THE HEADER META: "1 pod · 3m ago". `podCount` is reported UP from
	 * `LogsViewer` (see its own `onPodCount` doc comment) rather than
	 * re-derived here, so the page head and the Sources pane can never
	 * disagree about how many pods are in view. The build itself is
	 * deliberately NOT repeated here — `RolloutTabHeader`'s title line
	 * already prints it (`/ build`) a few pixels above this row, and
	 * restating it would be exactly the "one fact, once" violation the
	 * design language calls out.
	 *
	 * ⭐ `formatTimeAgoCompact` + "ago", NOT "since … ago" (art director
	 * round 1, must-fix #10: "the Overview meta says '28m ago'; Logs says
	 * 'since 28 minutes ago'. Use the same relative-time format as the
	 * Overview"). `formatTimeAgo`'s own spelled-out "28 minutes ago" was a
	 * SECOND relative-time vocabulary for the exact same fact the title
	 * bar's sibling tab already states in `formatTimeAgoCompact`'s "28m"
	 * — this is that same function, same word order, same tab strip.
	 */
	let podCount = $state(0);
	const sinceLabel = $derived.by((): string | null => {
		const latest = rollout?.status?.history?.[0];
		const since = latest?.bakeStartTime || latest?.timestamp;
		return since ? `${formatTimeAgoCompact(since, $now)} ago` : null;
	});
</script>

<svelte:head>
	<title>{pageTitle(`${name} (${namespace}) Logs`)}</title>
</svelte:head>

{#if rolloutLoading}
	<!-- Same skeleton vocabulary as the sibling Overview/History tabs
	     (2026-09-04, load-state audit finding 11) — a reader who switches
	     tabs mid-load should see one loading language, not a bare spinner
	     here and a full composition next door. -->
	<div class="mx-auto w-full px-4 py-6 sm:px-6">
		<div class="mb-5 flex flex-col gap-2" aria-hidden="true">
			<span class="skel-block h-6 w-48"></span>
			<span class="skel-block h-3.5 w-64"></span>
		</div>
		<CardSkeleton titleWidth="w-28" rollupWidth="w-32" bodyHeight={420} />
	</div>
{:else if rolloutError}
	<!-- ⭐ ITEM 1 (AD palette round 8): NO WRAPPER HERE — see History's
	     identical note. `ErrorState` supplies its own rollout-page inset. -->
	<ErrorState
		error={rolloutError}
		subject="this rollout's logs"
		backHref={href('/rollouts')}
		backLabel="Back to all rollouts"
		onRetry={() => rolloutQuery.refetch()}
	/>
{:else if !rollout}
	<!-- The calm not-found composition the Overview/History tabs use
	     (NotFound.svelte): same object, same words, same way out — no
	     banner, no hue. A missing rollout is not an incident. -->
	<NotFound
		eyebrow="Rollout"
		title={name}
		headline="This rollout does not exist"
		nextStep="It may have been deleted, or the address may be wrong."
		facts={[
			{ label: 'Rollout', value: `${namespace}/${name}`, handle: true },
			...(cluster ? [{ label: 'Cluster', value: cluster, handle: true }] : []),
			{ label: 'Server answered', value: 'not found' }
		]}
		backHref={href('/rollouts')}
		backLabel="Back to all rollouts"
	/>
{:else}
	<!-- ⭐ `min-h-0 flex-1`, NOT `h-full`. The rollout layout's scroller is a flex
	     column now (the tab strip moved inside it so the strip and the page are
	     centred in the SAME content box), and `height: 100%` in there resolves
	     against the scroller's full height — which would make this tab exactly one
	     tab strip taller than its pane and give the only tab that must not scroll a
	     49px scrollbar. As a flex item it takes the remainder instead. -->
	<div class="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden px-4 py-6 sm:px-6">
		<!-- No env chip after the title: the breadcrumb names the environment
		     and the Overview / History headers carry none (one fact, once). -->
		<RolloutTabHeader {name} {rollout} quietRollback class="mb-6 shrink-0">
			{#snippet meta()}
				{#if podCount > 0}
					<span>{podCount} pod{podCount === 1 ? '' : 's'}</span>
				{/if}
				{#if sinceLabel}
					<!-- No age on the phone meta line beside another fact (r11, item 5). -->
					<span class={podCount > 0 ? 'max-lg:hidden' : ''}>{sinceLabel}</span>
				{/if}
			{/snippet}
		</RolloutTabHeader>

		<!-- ⭐ ONE PERSISTENT `LogsViewer`, NOT A REMOUNT PER TAB (TL review
		     round 3: "switching must keep keyboard focus on the control — it
		     currently drops to BODY on remount"). Pods↔Tests used to be a
		     `{#if}`/`{:else}` swap between two separately-mounted instances,
		     which is exactly what dropped focus: the DOM node carrying it was
		     destroyed. `filterType` is a plain reactive prop now; `LogsViewer`
		     resets its own per-stream state on a genuine prop change (see its
		     own `resetStreamState`/`lastFilterType` — the "clean slate" behaviour
		     survives, just without a remount to ride in on), so the SAME button
		     the reader just clicked is still focused afterwards. -->
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<LogsViewer
				{namespace}
				{name}
				{cluster}
				{rollout}
				filterType={activeTab === 'pods' ? 'pod' : 'test'}
				onSelectView={(v) => (activeTab = v === 'test' ? 'tests' : 'pods')}
				onPodCount={(n) => (podCount = n)}
			/>
		</div>
	</div>
{/if}
