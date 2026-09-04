<script lang="ts">
	import '../app.css';
	import Navbar from '../lib/Navbar.svelte';
	import Sidebar from '../lib/Sidebar.svelte';
	import MobileTabBar from '../lib/MobileTabBar.svelte';
	import LiveRegion from '$lib/components/LiveRegion.svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { queryRetry, queryRetryDelay, pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { startEventStream } from '$lib/api/events';
	import { afterNavigate } from '$app/navigation';

	/**
	 * ⛔ P12 — FOCUS RESET TO BODY ON EVERY NAVIGATION. (2026-09-03,
	 * operator walk)
	 *
	 * > *"Enter on a card navigates and leaves activeElement === BODY.
	 * > Reaching content again is 10 tabs (skip link → logo → theme → 6
	 * > sidebar items → Collapse)."*
	 *
	 * SvelteKit's client router swaps the page component but does nothing
	 * about focus — the element that was activated (a card, a row) is
	 * destroyed with the old page, and the browser's only remaining option
	 * is `<body>`. `#main-content` already carries `tabindex="-1"` for the
	 * skip link; landing focus there after a REAL navigation puts a keyboard
	 * user one Tab from the new page's own content instead of ten.
	 *
	 * Three guards keep this from misfiring:
	 *  - `nav.type === 'enter'` is the very first load — never steal focus
	 *    from wherever the browser or a fragment/`autofocus` already put it.
	 *  - same-route navigations (a tab strip's `?tab=` swap, `?deploy=`
	 *    arrival, a filter pill) are excluded by comparing route IDs — those
	 *    are page-local state changes with their own, more specific focus
	 *    handling (e.g. rollout detail's own arrival-row focus), not a trip
	 *    to a new page.
	 *  - if something has already claimed focus by the time this runs (an
	 *    arrival feature that focused a specific row), it is not overridden.
	 *
	 * ⚠️ MEASURED RACE: checking `document.activeElement` synchronously
	 * inside `afterNavigate` is NOT safe on its own. The OLD page's focused
	 * element (the card that was just activated) is sometimes still
	 * `document.activeElement` at the instant this callback runs — it has
	 * not been torn down yet — so the naive guard reads "something already
	 * has focus" and skips, and only AFTER that does the old element's
	 * removal blank focus to `<body>` with nothing left to claim it. One
	 * `requestAnimationFrame` is enough to run after that teardown (and
	 * before it, if any other page-level effect wants to claim focus more
	 * specifically) — verified over repeated runs against the synchronous
	 * version, which landed on `<body>` roughly one time in three.
	 */
	let mainEl: HTMLElement | undefined = $state();
	afterNavigate((nav) => {
		// From `sm` up `<main>` is the scroller, and SvelteKit only resets the
		// DOCUMENT's offset on a fresh navigation — leave Back/Forward to the
		// browser, put every other arrival at the top of the new page.
		if (nav.type !== 'popstate' && mainEl && getComputedStyle(mainEl).overflowY === 'auto') {
			mainEl.scrollTop = 0;
		}
		if (nav.type === 'enter') return;
		if (!nav.to) return;
		if (nav.from?.route?.id === nav.to.route?.id) return;
		requestAnimationFrame(() => {
			const active = document.activeElement;
			const claimed = active && active !== document.body && active.isConnected;
			if (claimed) return;
			/**
			 * ⭐ `preventScroll: true`. (2026-09-03, scroll model rewrite) The
			 * DOCUMENT is the scroller now (see `app.css`'s "THE DOCUMENT
			 * SCROLLS"), which means `Element.focus()` on a target outside the
			 * viewport is now free to do what a bare `.focus()` call does by
			 * default — scroll it into view. That is exactly wrong here: a
			 * real navigation already lands SvelteKit's own scroll reset at
			 * the top of the new page (or restores a Back offset — see the
			 * same note), and this focus move must not fight that a frame
			 * later.
			 */
			document.getElementById('main-content')?.focus({ preventScroll: true });
		});
	});

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
	/**
	 * ⭐ PERF-2026-09-04 §C.6/C.7 — REFETCH ON CHANGE, NOT ON A TIMER. The
	 * backend now pushes one small SSE event per informer add/update/delete
	 * (`GET /api/events/stream`, `$lib/api/events`), coalesced every 250ms —
	 * it knows the instant anything changes, so a query no longer has to poll
	 * blind to find out. `staleTimeWhenHealthy`/`pollWhenHealthy`'s second
	 * argument make BOTH numbers below conditional on `$lib/api/events`'
	 * `isEventStreamHealthy()`, checked fresh on every read:
	 *
	 * - stream connected → `staleTime: 30_000`, `refetchInterval: 60_000` —
	 *   push does the real work; polling is only the safety net.
	 * - stream down (still connecting, dropped, tab hidden >60s) → the exact
	 *   prior numbers (`1000` / `5000`), so a stream outage is invisible to
	 *   the reader: the page just goes back to how it always worked.
	 *
	 * This is the ONLY thing that changed here — `refetchOnWindowFocus`,
	 * `retry` and `retryDelay` are untouched, and per-page overrides that
	 * call `pollWhenHealthy`/set their own `staleTime` keep polling at
	 * exactly their prior fixed rate (they don't pass a `streamedMs`, so
	 * `pollWhenHealthy` falls through to its old one-argument behavior).
	 */
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: staleTimeWhenHealthy(1000, 30000),
				refetchInterval: pollWhenHealthy(5000, 60000),
				refetchOnWindowFocus: false,
				retry: queryRetry,
				retryDelay: queryRetryDelay
			}
		}
	});
	// Starts the one SSE change-stream client for this tab and wires it to
	// invalidate the query keys above — see $lib/api/events' own doc comment
	// for the reconnect/hidden-tab/backpressure story. No-ops under SSR.
	startEventStream(queryClient);
</script>

<QueryClientProvider client={queryClient}>
	<!-- ⭐ TWO SCROLL MODELS, ONE BREAKPOINT. (2026-09-04, from the human: "we
	     broke how desktop looks like when we recently changed scrolling
	     behaviour … navbar / sidebar bounces on chrome scrolling. it should be
	     fixed in place.") Below `sm` the DOCUMENT scrolls — the phone model
	     d7248c4 introduced, with the tab bar fixed and every native scroll
	     behaviour live. From `sm` up the shell is exactly the viewport again
	     (`h-dvh overflow-hidden`), the navbar and the full-height sidebar are
	     static chrome, and `<main>` is the ONE scroller with
	     `overscroll-behavior: contain` — so Chrome's rubber-band never moves
	     the chrome, and the sidebar spans the viewport instead of ending at
	     its last link. `sm` is the breakpoint because it is where the sidebar
	     appears and the tab bar leaves: one width, one model each side. -->
	<div class="flex flex-col bg-white sm:h-dvh sm:overflow-hidden dark:bg-gray-900">
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
		<div class="flex min-w-0 flex-row sm:min-h-0 sm:flex-1">
			<Sidebar />
			<!--
				⭐ `<main>` IS A PLAIN BLOCK NOW — THE DOCUMENT IS THE SCROLLER.
				(2026-09-03, scroll model rewrite — see `app.css`'s "THE DOCUMENT
				SCROLLS" for the full account and why.) This used to be `flex-1
				overflow-y-auto` with its own `scrollbar-gutter: stable`, the ONE
				thing in the whole product that ever scrolled, inside a shell
				pinned to exactly `h-screen`. That made every native phone scroll
				behaviour (rubber-banding, pull-to-refresh, Back's own scroll
				restore, an anchor's `scrollIntoView`) act on a document that
				never moved. `scrollbar-gutter: stable` is on `html` now, so the
				content box is still one width whether or not the page scrolls —
				same fix, same reasoning, moved to where the scrolling happens.
			-->
			<main
				id="main-content"
				tabindex="-1"
				bind:this={mainEl}
				class="min-w-0 flex-1 focus:outline-none sm:overflow-y-auto sm:[overscroll-behavior:contain] sm:[scrollbar-gutter:stable]"
			>
				<div class="relative min-w-0 sm:min-h-full">
					<slot />
				</div>
			</main>
		</div>
		<MobileTabBar />
		<LiveRegion />
	</div>
</QueryClientProvider>
