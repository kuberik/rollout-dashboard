<script lang="ts">
	import '../app.css';
	import Navbar from '../lib/Navbar.svelte';
	import Sidebar from '../lib/Sidebar.svelte';
	import MobileTabBar from '../lib/MobileTabBar.svelte';
	import LiveRegion from '$lib/components/LiveRegion.svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { queryRetry, queryRetryDelay, pollWhenHealthy } from '$lib/api/errors';

	/**
	 * ⛔ `retry` AND `refetchInterval` ARE DECISIONS. THEY USED TO BE DEFAULTS.
	 *
	 * TanStack retries three times by default and then keeps the interval poll
	 * running forever, which on this product meant a URL that cannot resolve
	 * fired **15 identical 500s in 35 seconds** while the page showed skeleton
	 * placeholders and never left `isLoading`. `/commits` did the same with
	 * **16 consecutive 401s**. Neither number can go down by trying again.
	 *
	 * The policy lives in `$lib/api/errors` next to `ApiError` so the rule and
	 * the thing it reasons about cannot drift apart. In one line: **a 404 or a
	 * 401 is never retried; a 5xx is retried twice and then polled slowly** so
	 * a controller restart still heals the page on its own.
	 */
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 1000,
				refetchInterval: pollWhenHealthy(5000),
				refetchOnWindowFocus: false,
				retry: queryRetry,
				retryDelay: queryRetryDelay
			}
		}
	});
</script>

<QueryClientProvider client={queryClient}>
	<div class="flex h-screen flex-col bg-white dark:bg-gray-900">
		<!-- ⭐ SKIP LINK. Measured before it existed: EVERY page cost a keyboard
		     user 10 identical tab stops (logo, breadcrumb, theme, six sidebar
		     links, collapse) before the first thing on the page. On `/activity`
		     the eleventh stop was still not content — it was the first of forty
		     chart marks. The link is `sr-only` at rest, so nothing on `/`,
		     `/rollouts` or rollout detail changes visually until it has focus,
		     which is the one exception the craft rules grant. -->
		<a
			href="#main-content"
			class="sr-only rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-lg focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[200] dark:bg-gray-800 dark:text-white"
		>
			Skip to main content
		</a>
		<Navbar />
		<div class="flex min-w-0 flex-grow flex-row overflow-hidden">
			<Sidebar />
			<main id="main-content" tabindex="-1" class="min-w-0 flex-1 overflow-y-auto focus:outline-none">
				<div class="relative h-full min-w-0">
					<slot />
				</div>
			</main>
		</div>
		<MobileTabBar />
		<LiveRegion />
	</div>
</QueryClientProvider>
