<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import {
		ObjectsColumnSolid,
		ClockArrowOutline,
		ShareNodesSolid,
		TerminalOutline
	} from 'flowbite-svelte-icons';
	import { type Snippet } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutQueryOptions, rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy } from '$lib/api/errors';

	let { children }: { children: Snippet } = $props();

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	const activeUrl = $derived(page.url.pathname);
	// Base path (cluster embedded) shared by every tab.
	const base = $derived(`/rollouts/${cluster}/${namespace}/${name}`);

	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster,
			options: {
				refetchInterval: pollWhenHealthy(5000)
			}
		})
	);

	/**
	 * THE DEPENDENCIES TAB HAS TWO SOURCES, AND GATING IT ON ONE HID IT FROM
	 * THE ROLLOUTS THAT NEED IT MOST.
	 *
	 * The tab used to be `Environments` and showed only when the rollout had
	 * an `Environment` with `environmentInfos` — which is right for the
	 * promotion chain and wrong for the other axis. A rollout with a
	 * `RolloutDependency` and NO `Environment` binding is exactly the case
	 * where a cross-service contract gate is the ONLY thing holding it back,
	 * and it could not reach the tab at all.
	 *
	 * `rolloutDependencies` rides the LIST payload, whose key is shared with
	 * `/rollouts`, so this is a cache read on any navigation from a list page.
	 * The predicate is deliberately narrow — THIS rollout, in THIS namespace.
	 * A gate in a sibling environment's namespace gates a different rollout
	 * instance, and that instance has its own tab.
	 */
	const listQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000) } })
	);

	const environment = $derived(rolloutQuery.data?.environment);

	const hasEnvironment = $derived(
		environment?.status?.environmentInfos && environment.status.environmentInfos.length > 0
	);

	/**
	 * ⭐ A `RolloutDependency` IS AN EDGE AND IT HAS TWO ENDS. THIS USED TO
	 * MATCH ONE.
	 *
	 * The predicate was `rolloutRef.name === name` — the CONSUMER end only —
	 * which is the same bug one grade up from the one above it: a rollout that
	 * PROVIDES a contract and consumes none has no `rolloutRef` pointing at it
	 * anywhere, so if it also had no `Environment` binding the tab did not
	 * appear at all. `hello-api-app` is exactly that rollout on the live
	 * cluster, and it is the one whose owner most needs to know somebody is
	 * gated on it before they roll back.
	 *
	 * `providerRef.namespace` is resolved server-side, but it is defaulted here
	 * too: the CRD lets it be empty, in which case it means the dependency's
	 * own namespace.
	 */
	const hasDependencies = $derived(
		(listQuery.data?.rolloutDependencies?.items ?? []).some(
			(d) =>
				(d.spec?.rolloutRef?.name === name && d.metadata?.namespace === namespace) ||
				(d.spec?.providerRef?.name === name &&
					(d.spec?.providerRef?.namespace || d.metadata?.namespace) === namespace)
		)
	);

	const tabs = $derived([
		{ label: 'Overview', href: base, icon: ObjectsColumnSolid, show: true },
		{ label: 'History', href: `${base}/history`, icon: ClockArrowOutline, show: true },
		// ⛔ THE ICON IS A GRAPH, NOT A STACK. `LayersSolid` was chosen when this
		// tab was called `Environments` — stacked layers read as stacked
		// environments — and it survived the rename. For a relation BETWEEN two
		// services it says nothing. `ShareNodesSolid` is three nodes joined by
		// two edges, i.e. the smallest possible dependency graph, and it is
		// already the product's mark for this exact relation: `BlockReason`'s
		// contract branch and the dependencies page's own banner both draw it.
		// Zero new vocabulary.
		{
			label: 'Dependencies',
			href: `${base}/dependencies`,
			icon: ShareNodesSolid,
			show: hasEnvironment || hasDependencies
		},
		{ label: 'Logs', href: `${base}/logs`, icon: TerminalOutline, show: true }
	]);

	const isActive = (href: string) => {
		if (href === base) return activeUrl === href;
		return activeUrl.startsWith(href);
	};
</script>

<!--
	⛔ NO `SvelteFlowProvider` HERE. This layout used to wrap every rollout tab in
	one, left over from a promotion flow that has not rendered on these pages
	since May 2026. Nothing under it needed the context — `DependencyNetwork`
	brings its own via `GraphCanvas` — and the import alone put the whole
	`@xyflow/svelte` runtime on the CRITICAL PATH of the rollout detail page,
	Overview, History and Logs included, for a graph none of them draw.
-->
<div class="flex h-full flex-col overflow-hidden">
	<!-- Horizontal tabs: replaces the rollout sub-sidebar so the page
	     no longer has two stacked sidebars. -->
	<nav
		class="sticky top-0 z-10 shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
		aria-label="Rollout sections"
	>
		<!-- Tabs split evenly across the row on mobile (icon-only), expand
		     to icon+label on sm+. No overflow-x-auto — the tabs always fit. -->
		<div class="flex items-stretch px-2 sm:justify-start sm:gap-0 sm:px-4">
			{#each tabs.filter((t) => t.show) as t (t.href)}
				{@const active = isActive(t.href)}
				<a
					href={t.href}
					aria-current={active ? 'page' : undefined}
					title={t.label}
					class="group inline-flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:flex-initial sm:shrink-0
						{active
							? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
							: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
				>
					<t.icon class="h-4 w-4 shrink-0" />
					<span class="hidden sm:inline">{t.label}</span>
				</a>
			{/each}
		</div>
	</nav>

	<!-- Content -->
	<div class="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
		{@render children()}
	</div>
</div>
