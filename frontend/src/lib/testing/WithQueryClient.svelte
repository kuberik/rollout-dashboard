<svelte:options runes={true} />

<script lang="ts">
	/**
	 * TEST-ONLY HARNESS. No route imports this, so it is tree-shaken out of the
	 * app build entirely.
	 *
	 * WHY IT EXISTS. `routes/+layout.svelte` wraps the whole app in a
	 * `QueryClientProvider`; every page below it calls `createQuery`, which calls
	 * `useQueryClient()` at component INIT and throws
	 *
	 *     No QueryClient was found in Svelte context.
	 *
	 * if the client is missing. `render(Page)` from `@testing-library/svelte`
	 * mounts the page with no layout above it, so a page test throws before it
	 * produces a single DOM node — which is what `routes/page.svelte.test.ts`
	 * had been doing since the SvelteKit scaffold.
	 *
	 * It cannot be solved with `render(Page, { context })`: the provider's
	 * context key is a module-private `Symbol('QueryClient')` in
	 * `@tanstack/svelte-query/dist/context.js`, so a test cannot build the map
	 * by hand. `QueryClientProvider` takes its content as a `children` SNIPPET,
	 * and a snippet can only be authored in a `.svelte` file — hence this one.
	 *
	 * THE CLIENT IS DELIBERATELY INERT: no retries, no window-focus refetch, no
	 * cache retention. A page test asserts structure, not fetched data, and a
	 * retrying query keeps timers alive past the end of the test.
	 */
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import type { Component } from 'svelte';

	let {
		component: Rendered,
		props = {},
		client: externalClient
	}: {
		/** The component under test. Rendered as the provider's only child. */
		component: Component<Record<string, unknown>>;
		props?: Record<string, unknown>;
		/**
		 * ⭐ REVISIONS-2026-09-06, ITEM 2 — AN ESCAPE HATCH FOR A LIVE CACHE
		 * PATCH. Most tests never need this: a fresh, inert client per render
		 * is the right default. A test proving that the UI reacts correctly
		 * to the SAME mechanism the real app's SSE stream uses
		 * (`applyChangeEvents` writing straight into the cache via
		 * `setQueryData`, never a network refetch) needs a HANDLE on the
		 * client it rendered with, so it can push a second payload after
		 * mount and assert on the update — `queryClient.setQueryData(key,
		 * data)` from outside the render call. Optional and additive: every
		 * existing caller that omits it gets byte-identical behaviour.
		 */
		client?: QueryClient;
	} = $props();

	// `$derived.by` — the compiler's own idiom for "reads a prop", so the
	// tests below get a real client with NO svelte-check noise. It still
	// only evaluates once in practice: `externalClient` is passed once at
	// mount and never reassigned by anything these tests do.
	const client = $derived.by(
		() =>
			externalClient ??
			new QueryClient({
				defaultOptions: {
					queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: Infinity }
				}
			})
	);
</script>

<QueryClientProvider {client}>
	<Rendered {...props} />
</QueryClientProvider>
