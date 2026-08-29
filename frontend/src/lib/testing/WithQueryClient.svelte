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
		props = {}
	}: {
		/** The component under test. Rendered as the provider's only child. */
		component: Component<Record<string, unknown>>;
		props?: Record<string, unknown>;
	} = $props();

	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: Infinity }
		}
	});
</script>

<QueryClientProvider {client}>
	<Rendered {...props} />
</QueryClientProvider>
