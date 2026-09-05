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
	import { provideShellChrome } from '$lib/shell-chrome.svelte';
	import { ScrollDirectionTracker } from '$lib/scroll-direction.svelte';

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
	let { children }: { children?: import('svelte').Snippet } = $props();
	let mainEl: HTMLElement | undefined = $state();

	// ⭐ THE SHELL SLOT A ROUTE'S SECONDARY NAV RENDERS INTO. See
	// `shell-chrome.svelte.ts`'s own doc comment for why this exists at all
	// (Chrome's rubber-band bounce visibly detaching the rollout tab strip
	// from the navbar) — this root layout is the ONE place that provides it.
	const shellChrome = provideShellChrome();

	// ⭐ THE MOBILE HEADER'S AUTO-HIDE DECISION. (2026-09-05) Below `sm` the
	// DOCUMENT is the scroller (see app.css's "THE DOCUMENT SCROLLS"), so a
	// plain `window`/document `scroll` listener is exactly the right signal
	// — at `sm`+ the document never scrolls (the shell is `h-dvh
	// overflow-hidden`), so `window.scrollY` stays 0 and this tracker never
	// reports hidden there; `.header-group`'s own media query is still what
	// makes that state inert, this is just cheap to leave running unguarded.
	const headerScroll = new ScrollDirectionTracker(24);
	let headerGroupEl: HTMLElement | undefined = $state();

	$effect(() => {
		if (typeof window === 'undefined') return;
		function onScroll() {
			headerScroll.update(window.scrollY);
		}
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// ⭐ PUBLISHES `--header-h`, THE SAME IDIOM `MobileTabBar.svelte` USES FOR
	// `--tabbar-h`. Below `sm` the header group is `position: fixed` (see
	// app.css), so nothing else reserves the room it used to take in normal
	// flow — `body`'s `padding-top` reads this var UNCONDITIONALLY on the
	// hidden/shown state (only gated by breakpoint) so hiding the header
	// never changes how much room the page below it has. Measures the whole
	// group (navbar + the rollout tab strip when one is published), so a
	// route with no tab strip gets a shorter reservation automatically.
	$effect(() => {
		if (typeof document === 'undefined' || !headerGroupEl) return;
		const el = headerGroupEl;
		function measure() {
			document.documentElement.style.setProperty('--header-h', `${el.getBoundingClientRect().height}px`);
		}
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		window.addEventListener('resize', measure);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', measure);
		};
	});

	// ⭐ WHICH COLUMN THE TAB STRIP RENDERS IN. (2026-09-05, regression fix —
	// from the human, with a screenshot: "the strip spans the FULL width
	// above the sidebar, so the sidebar starts below it with an empty dark
	// band at its top... at sm+ the strip must occupy only the main
	// column... while the sidebar keeps starting directly under the
	// navbar.") Below `sm` there is no sidebar, so the strip belongs in
	// `.header-group` with `Navbar` (see above) — one fixed auto-hiding
	// unit. At `sm`+ the strip must NOT be a child of anything that spans
	// the sidebar's column, or the sidebar's own row starts one strip-height
	// too low. `isDesktop` picks which of the two render sites below is
	// live; only one is ever mounted; `shellChrome.tabStrip` itself doesn't
	// change; only WHERE it's rendered does.
	let isDesktop = $state(
		typeof window !== 'undefined' ? window.matchMedia('(min-width: 640px)').matches : false
	);

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(min-width: 640px)');
		function update() {
			isDesktop = mql.matches;
		}
		update();
		mql.addEventListener('change', update);
		return () => mql.removeEventListener('change', update);
	});

	afterNavigate((nav) => {
		// A real navigation always lands with the header shown, whichever way
		// the reader was scrolling on the page they left. Seeded from the
		// ACTUAL scroll offset (see `ScrollDirectionTracker.reset`'s own
		// comment) — usually 0, but Chrome restores a prior offset on a
		// plain reload, and a stale 0 baseline there mis-reads the next real
		// scroll's direction.
		headerScroll.reset(typeof window !== 'undefined' ? window.scrollY : 0);
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
	 * - stream connected → `staleTime: 120_000`, `refetchInterval: 300_000` —
	 *   push does the real work; polling is only the safety net.
	 * - stream down (still connecting, dropped, tab hidden >60s) → the exact
	 *   prior numbers (`1000` / `5000`), so a stream outage is invisible to
	 *   the reader: the page just goes back to how it always worked.
	 *
	 * ⭐ PERF-2026-09-04 §C.7 EVENT-OBJECT FOLLOW-UP — the safety net widened
	 * again, 60s/30s → 300s/120s, now that `./events`' `applyChangeEvents`
	 * PATCHES caches straight from the event's own `object` (fleet lists,
	 * rollout detail, health-checks, schedules) instead of only invalidating
	 * them. A patched cache is already exactly what a refetch would produce,
	 * so the 60s poll it used to lean on was pure waste; the 300s number is a
	 * true safety net for the cases patching still falls back to invalidating
	 * (no `object` — oversized or an unknown kind) or for drift this module
	 * hasn't accounted for.
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
				staleTime: staleTimeWhenHealthy(1000, 120000),
				refetchInterval: pollWhenHealthy(5000, 300000),
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
		<!-- ⭐ THE HEADER GROUP: `Navbar` ONLY AT `sm`+, `Navbar` + THE TAB
		     STRIP BELOW IT. (2026-09-05, regression fix) The strip used to
		     render in here at every width, which put it ABOVE the
		     `Sidebar + <main>` row and made it span the FULL shell width —
		     the sidebar's own row then started one strip-height too low,
		     with an empty band above it and the strip's padded content
		     sitting over nothing. Below `sm` there is no sidebar, so
		     spanning the full width is correct and this is still where the
		     strip belongs, jointly auto-hiding with `Navbar` as one
		     `position: fixed` unit (`.header-group` in `app.css`). At `sm`+
		     the strip moves to the main column below (`isDesktop`) — this
		     div is `Navbar`-only there, so the sidebar's top edge is always
		     exactly the navbar's bottom edge, tab strip or not. -->
		<div bind:this={headerGroupEl} class="header-group" data-hidden={headerScroll.hidden}>
			<Navbar />
			{#if shellChrome.tabStrip && !isDesktop}
				<div class="shrink-0">
					{@render shellChrome.tabStrip()}
				</div>
			{/if}
		</div>
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
			<!-- ⭐ THIS COLUMN, NOT `.header-group`, IS WHERE THE TAB STRIP
			     LIVES AT `sm`+. (2026-09-05, regression fix) It is a sibling
			     of `<main>` inside `Sidebar`'s OWN row, so it only ever
			     occupies the width `<main>` occupies — never the sidebar's
			     column, never the full shell width — with no separate
			     `--sidebar-w` offset math needed: whatever pushes `<main>`
			     right of the sidebar pushes this the same amount, because
			     they share this flex column. Below `sm` the strip renders in
			     `.header-group` instead (`isDesktop` above), so this
			     `{#if}` is simply empty there. -->
			<div class="flex min-w-0 flex-1 flex-col sm:min-h-0">
				{#if shellChrome.tabStrip && isDesktop}
					<div class="shrink-0">
						{@render shellChrome.tabStrip()}
					</div>
				{/if}
				<main
					id="main-content"
					tabindex="-1"
					bind:this={mainEl}
					class="min-w-0 flex-1 focus:outline-none sm:overflow-y-auto sm:[overscroll-behavior:contain] sm:[scrollbar-gutter:stable]"
				>
					<div class="relative min-w-0 sm:min-h-full">
						{@render children?.()}
					</div>
				</main>
			</div>
		</div>
		<MobileTabBar />
		<LiveRegion />
	</div>
</QueryClientProvider>
