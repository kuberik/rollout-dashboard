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
	 * ⭐ ROUND 2 (2026-10-08, design review 4, coordinator ruling): a missing
	 * address is NOT an incident. The previous version reached for `AlertPanel`
	 * — the product's BLOCKING-FACT banner — for a 404, which is the same
	 * category error as spending the STUCK-only amber token on it (both were
	 * findings on this file). `NotFound.svelte` is the calm composition: see
	 * its own doc comment for the full reasoning. This file now only decides
	 * WHICH destination to guess from the broken address.
	 *
	 * ⭐ IT ALSO GUESSES, CAREFULLY. `/environments/foo` is not a random
	 * string: its first segment names a real section, so the way out offered
	 * first is that section rather than the home page. The guess is drawn from
	 * `SECTIONS` below, which is the same six destinations the sidebar prints —
	 * it can only ever offer a place that exists, and when the first segment
	 * matches nothing it offers Home and says nothing clever.
	 *
	 * A genuine RENDER ERROR (not a 404) is a different fact — something IS
	 * broken — and keeps `ErrorState`'s danger treatment below, unchanged by
	 * this round.
	 */
	import { page } from '$app/state';
	import { href, appPath } from '$lib/paths';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import NotFound from '$lib/components/NotFound.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList from '$lib/components/FactList.svelte';
	import { pageTitle } from '$lib/page-title';
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

	/** The sidebar's destinations, keyed by the URL segment a person types.
	 *  `href()` is resolved once here — `base` is a build-time constant.
	 *  No per-section icon: `NotFound`'s single way-out link has no icon
	 *  slot (it is one plain `.nav-link` among others, not a tile). */
	const SECTIONS: Record<string, { label: string; href: string }> = {
		rollouts: { label: 'Rollouts', href: href('/rollouts') },
		apps: { label: 'Apps', href: href('/apps') },
		environments: { label: 'Environments', href: href('/environments') },
		envs: { label: 'Environments', href: href('/environments') },
		versions: { label: 'Changes', href: href('/changes') },
		revisions: { label: 'Changes', href: href('/changes') },
		changes: { label: 'Changes', href: href('/changes') },
		namespaces: { label: 'Rollouts', href: href('/rollouts') },
		activity: { label: 'Activity', href: href('/activity') }
	};

	const status = $derived(page.status);
	// The RAW pathname (base included) is what actually gets shown as the
	// "Address" fact below — that is genuinely what was requested. The
	// first-segment guess against `SECTIONS`, though, has to be taken on the
	// base-LESS route path, or every guess under a sub-path build reads the
	// base itself (`/demo`) as the first segment instead of the real one.
	const pathname = $derived(page.url?.pathname ?? '');
	const routePath = $derived(appPath(pathname));
	const firstSegment = $derived(routePath.split('/').filter(Boolean)[0] ?? '');
	const section = $derived(SECTIONS[firstSegment] ?? null);
	const isNotFound = $derived(status === 404);

	const nextStep = $derived(
		section
			? `Nothing in the dashboard answers to this address. ${section.label} is a real section, so the name after it is probably the part that is wrong.`
			: 'Nothing in the dashboard answers to this address. It may have been renamed, or the link that brought you here may be out of date.'
	);
</script>

<svelte:head>
	<title>{pageTitle(isNotFound ? 'Address not found' : 'Error')}</title>
</svelte:head>

<div class="h-full w-full overflow-y-auto bg-ground">
	{#if isNotFound}
		<NotFound
			title="Not found"
			headline="This address does not exist"
			{nextStep}
			facts={[
				{ label: 'Address', value: pathname, handle: true },
				{ label: 'Status', value: `HTTP ${status}`, handle: true }
			]}
			backHref={section?.href ?? href('/')}
			backLabel={section ? `Go to ${section.label}` : 'Home'}
			showHome={!!section}
			onBack={() => history.back()}
		/>
	{:else}
		<ErrorState
			error={page.error}
			subject="this page"
			backHref={href('/')}
			backLabel="Back to Home"
			class="px-4 pt-6 pb-10 sm:px-6"
		/>
	{/if}
</div>
