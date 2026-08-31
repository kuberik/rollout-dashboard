<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⛔ THE PRODUCT HAD NO `+error.svelte` AT ALL.
	 *
	 * Every address SvelteKit could not match rendered the framework's own
	 * fallback: the two words **404 Not Found**, black on white, no navbar, no
	 * sidebar, no link. A UX critic hit it by typing `/environments/<unknown>`
	 * — a URL the product's own vocabulary invites, since the section is called
	 * Environments and the detail route is `/envs/<name>` — and had no way back
	 * except the browser's Back button.
	 *
	 * The frustrating part is that the product already knows how to do this
	 * well. The critic singled out the rollout not-found state for praise: it
	 * says WHAT HAPPENED, WHAT IT MEANS, THE ADDRESS THAT WAS QUERIED, and
	 * gives A WAY OUT. This file is that state, for every unmatched route, in
	 * the same `AlertPanel` the rest of the product's blocking facts use.
	 *
	 * ⭐ IT ALSO GUESSES, CAREFULLY. `/environments/foo` is not a random
	 * string: its first segment names a real section, so the way out offered
	 * first is that section rather than the home page. The guess is drawn from
	 * `SECTIONS` below, which is the same six destinations the sidebar prints —
	 * it can only ever offer a place that exists, and when the first segment
	 * matches nothing it offers Home and says nothing clever.
	 */
	import { page } from '$app/state';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import {
		HomeOutline,
		GridOutline,
		RocketOutline,
		LayersSolid,
		ClockOutline,
		TagOutline,
		ChevronRightOutline,
		ArrowLeftOutline
	} from 'flowbite-svelte-icons';

	/** The sidebar's destinations, keyed by the URL segment a person types. */
	const SECTIONS: Record<string, { label: string; href: string; icon: typeof HomeOutline }> = {
		rollouts: { label: 'Rollouts', href: '/rollouts', icon: GridOutline },
		apps: { label: 'Apps', href: '/apps', icon: RocketOutline },
		environments: { label: 'Environments', href: '/environments', icon: LayersSolid },
		envs: { label: 'Environments', href: '/environments', icon: LayersSolid },
		versions: { label: 'Revisions', href: '/versions', icon: TagOutline },
		revisions: { label: 'Revisions', href: '/versions', icon: TagOutline },
		namespaces: { label: 'Rollouts', href: '/rollouts', icon: GridOutline },
		activity: { label: 'Activity', href: '/activity', icon: ClockOutline }
	};

	const status = $derived(page.status);
	const pathname = $derived(page.url?.pathname ?? '');
	const firstSegment = $derived(pathname.split('/').filter(Boolean)[0] ?? '');
	const section = $derived(SECTIONS[firstSegment] ?? null);
	const isNotFound = $derived(status === 404);

	const title = $derived(
		isNotFound ? 'This address does not exist' : 'This page could not be loaded'
	);

	const message = $derived.by(() => {
		if (!isNotFound) {
			return (
				page.error?.message ||
				'The dashboard hit an error rendering this page. It is not a problem with your cluster.'
			);
		}
		if (section) {
			return `Nothing in the dashboard answers to this address. ${section.label} is a real section, so the name after it is probably the part that is wrong.`;
		}
		return 'Nothing in the dashboard answers to this address. It may have been renamed, or the link that brought you here may be out of date.';
	});
</script>

<svelte:head>
	<title>kuberik | {isNotFound ? 'Address not found' : 'Error'}</title>
</svelte:head>

<div class="h-full w-full overflow-y-auto p-3 sm:p-5 dark:bg-gray-900">
	<h1 class="mb-4 text-xl font-bold text-gray-900 dark:text-white">
		{status}
		{isNotFound ? 'Not found' : 'Error'}
	</h1>

	<AlertPanel
		severity={isNotFound ? 'warning' : 'error'}
		class="mb-0 max-w-3xl"
		{title}
		{message}
		footnote={`The address requested was ${pathname}.`}
	>
		{#snippet actions()}
			<!-- ⚠️ `AlertPanel` LAYS ACTIONS OUT IN A NON-WRAPPING ROW (`flex
			     items-center gap-3`), which is right for the two-button states that
			     built it and overflows at 390 with three. The snippet supplies its
			     own wrapping box so the panel does not have to change for a caller
			     that needs one more way out. -->
			<div class="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
				{#if section}
					{@const Icon = section.icon}
					<a href={section.href} class="btn btn-secondary">
						<Icon class="h-4 w-4 shrink-0" aria-hidden="true" />
						Go to {section.label}
						<ChevronRightOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
					</a>
				{/if}
				<a href="/" class="btn btn-secondary">
					<HomeOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
					Back to Home
				</a>
				<button type="button" class="btn btn-secondary" onclick={() => history.back()}>
					<ArrowLeftOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
					Go back
				</button>
			</div>
		{/snippet}
	</AlertPanel>
</div>
