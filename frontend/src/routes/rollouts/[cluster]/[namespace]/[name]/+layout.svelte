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
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';

	let { children }: { children: Snippet } = $props();

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	const activeUrl = $derived(page.url.pathname);
	// Base path (cluster embedded) shared by every tab.
	const base = $derived(`/rollouts/${cluster}/${namespace}/${name}`);

	// ⭐ PERF-2026-09-04 §C.7 SLICE 4 — STREAM-AWARE (see Navbar.svelte's
	// identical comment on the same key tag).
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster,
			options: {
				// ⭐ CLUSTER-AWARE — this rollout's own cluster, not the fleet-wide
				// "every cluster up" gate. See +page.svelte's identical comment.
				refetchInterval: pollWhenHealthy(5000, 60000, cluster)
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
	// ⭐ STREAM-AWARE (see RolloutGrid.svelte's identical comment).
	const listQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000, 60000) } })
	);

	const environment = $derived(rolloutQuery.data?.environment);

	const hasEnvironment = $derived(
		environment?.status?.environmentInfos && environment.status.environmentInfos.length > 0
	);

	/**
	 * ⭐ HAS THE EVIDENCE FOR `hasEnvironment`/`hasDependencies` ITSELF
	 * ARRIVED YET? (2026-09-04, load-state audit finding 3: "Three tabs then
	 * four: `Logs` moves +147px at 1440; at 390 the `flex-1` tabs re-width
	 * 114→86 so `History` moves −42px and a finger over it lands on
	 * `Dependencies`.") `hasEnvironment` rides `rolloutQuery` and
	 * `hasDependencies` rides `listQuery` — two different requests that do
	 * not resolve in the same frame, so the strip painted 3 tabs, then
	 * silently became 4 once the slower one landed. `depsKnown` is `true`
	 * only once BOTH have answered, which is what `tabs` below reads to
	 * decide whether the Dependencies tab is `pending` (reserve the slot,
	 * disabled), `active` (a real fourth tab) or `hidden` (this rollout
	 * genuinely has neither — the pre-existing, correct final state).
	 */
	const depsKnown = $derived(rolloutQuery.data !== undefined && listQuery.data !== undefined);

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

	/**
	 * ⭐ ARITY-STABLE: ALWAYS FOUR ENTRIES, NEVER THREE-THEN-FOUR.
	 * (2026-09-04, load-state audit finding 3) The Dependencies tab used to
	 * be filtered OUT of this array entirely until `show` resolved true,
	 * which is what let the strip's own `flex-1` siblings re-width mid-
	 * visit. It is always in the array now; `state` says how to RENDER it —
	 * `'pending'` reserves the exact slot a real fourth tab would take
	 * (disabled, muted) while `depsKnown` is false, `'active'` is the
	 * unchanged final "yes" state, and `'hidden'` is the unchanged final
	 * "no" state — rendered `invisible` (not removed), so even a rollout
	 * that genuinely has neither an `Environment` nor a `RolloutDependency`
	 * keeps the OTHER three tabs at the exact width four tabs would give
	 * them. See the template below for how each `state` renders.
	 */
	const tabs = $derived([
		{ label: 'Overview', href: base, icon: ObjectsColumnSolid, state: 'active' as const },
		{ label: 'History', href: `${base}/history`, icon: ClockArrowOutline, state: 'active' as const },
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
			state: (!depsKnown ? 'pending' : hasEnvironment || hasDependencies ? 'active' : 'hidden') as
				| 'pending'
				| 'active'
				| 'hidden'
		},
		{ label: 'Logs', href: `${base}/logs`, icon: TerminalOutline, state: 'active' as const }
	]);

	const isActive = (href: string) => {
		if (href === base) return activeUrl === href;
		return activeUrl.startsWith(href);
	};

	/* THE STRIP SCROLLS NOW (see the `overflow-x-auto` note on its row below),
	   which means the ACTIVE tab can load off-screen: at 640 the tab strip is
	   narrower than its four tabs' natural width, and without this a reader
	   who follows a link straight to `/logs` lands on a strip showing
	   `History | Dependencies | Lo…` with no visible cue that its own active
	   tab is the clipped one. `inline: 'nearest'`, not `'center'`: centring
	   would move a tab that is ALREADY fully visible (the common case, every
	   width above ~460px shows all four) purely because it is not dead
	   centre, which reads as the page fighting the reader's own scroll.

	   ⚠️ `void activeUrl` ALONE USED TO MISS THE CASE THAT ACTUALLY
	   OVERFLOWS, BEFORE THE TAB STRIP BECAME ARITY-STABLE. (2026-09-04,
	   load-state audit finding 3) `tabs`' `Dependencies` entry used to be
	   FILTERED OUT of the array while `hasEnvironment || hasDependencies`
	   was still resolving, so the strip could paint THREE tabs (fits in
	   449px) and silently become FOUR (488px, the overflowing case) once a
	   query resolved — a `scrollWidth` change with no `activeUrl` change to
	   trigger this effect. All four entries render on every paint now (see
	   `tabs`' own comment); the `Dependencies` slot's WIDTH never changes,
	   only its `state` (`pending` → `active`/`hidden`) — `hidden` is
	   `invisible`, not removed, so it still occupies its flex-1 share and
	   `scrollWidth` is constant across every state transition. Depending on
	   `tabs` itself (not just `activeUrl`) is kept anyway: a direct load of
	   `/dependencies` while its tab is still `pending` needs this effect to
	   re-run the moment `state` flips to `active` and `aria-current` lands
	   on it, which a `ResizeObserver` (box size, not scroll position) would
	   not catch either. */
	let tabStripEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		void activeUrl;
		void tabs;
		tabStripEl
			?.querySelector('[aria-current="page"]')
			?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
	});
</script>

<!--
	⛔ NO `SvelteFlowProvider` HERE. This layout used to wrap every rollout tab in
	one, left over from a promotion flow that has not rendered on these pages
	since May 2026. Nothing under it needed the context — `DependencyNetwork`
	brings its own via `GraphCanvas` — and the import alone put the whole
	`@xyflow/svelte` runtime on the CRITICAL PATH of the rollout detail page,
	Overview, History and Logs included, for a graph none of them draw.
-->
<!--
	⛔ THIS PANE NO LONGER OWNS A SCROLL CONTAINER, AND THAT IS THE SAME BUG ONE
	LEVEL UP.

	It used to be `flex h-full flex-col overflow-hidden` wrapping an inner
	`overflow-y-auto` pane, i.e. rollout detail was the ONE route in the product
	that did not scroll `<main>`. `mx-auto max-w-7xl` centres in its scroller's
	CONTENT box and a scroll container takes its scrollbar out of that box, so
	two nested scrollers reserve two gutters and this page came out a whole
	scrollbar narrower than every page you arrive from. Measured with the gutter
	reserved at 1800: 357→1589 here against 364→1596 everywhere else. Fixing the
	strip and leaving the extra scroller in place would have moved the defect
	rather than removed it.

	Now `<main>` scrolls this page like every other page, `sticky top-0` on the
	strip below pins against `<main>` exactly as it pinned against the inner
	pane, and `min-h-full` + `flex flex-col` keeps the Logs tab able to claim the
	viewport's remaining height without a second scrollbar.
-->
<div class="flex min-h-full flex-col pb-16 md:pb-0">
	<!--
		══ THE TAB STRIP IS NO LONGER FULL-BLEED ═══════════════════════════

		⛔ THE ONE DOCUMENTED EXCEPTION TO THE PAGE CONTAINER WAS THE DEFECT
		THE HUMAN WAS POINTING AT. (2026-09-02: *"rollout detail and
		environment list still have larger margin than the rest of the
		pages."* — "still", one commit after the container was unified and
		this strip was written down as a deliberate exception.)

		The strip's BACKGROUND and its bottom hairline are chrome for the
		whole pane and stay full-bleed. Its TABS were full-bleed too, at
		`px-2 sm:px-4`, so the first tab's box sat 16px from the pane edge
		while the content below it sat in the product's container. Measured
		on the running page, first tab box → content left edge:

		    1280 →   8px      1440 →   8px      1680 → 120px
		    1800 → 180px      2560 → 560px

		Every other route's topmost element IS the container's left edge, so
		rollout detail is the ONE page in the product that draws a reference
		line at the pane edge and then insets its content from it by a
		quarter of the viewport. That step is what reads as "a larger
		margin", and no census of container edges can see it — the container
		was correct the whole time. Same shape as the Dependencies tab's
		`max-w-[64rem]` one commit ago: the outer wrapper is uniform and
		something inner is not.

		⭐ THE TAB *BOX* ALIGNS WITH THE CONTENT EDGE, NOT THE TAB *LABEL*.
		The tab carries `px-3`, so its label lands 12px in — exactly the way
		a `Card`'s border sits at the block edge and its title sits 16px
		inside. What aligns is the thing that draws a line: the active tab's
		`border-b-2` is now a segment of the container's own left edge.

		⭐ AND IT HAD TO SHARE THE CONTENT'S SCROLL BOX, NOT JUST ITS WIDTH
		CLASS. The strip used to be a SIBLING of the scrolling pane, so it
		was centred in a box one scrollbar wider than the box the page was
		centred in. Putting the same `max-w-7xl` on both would have left them
		half a scrollbar apart — the jitter this rule exists to remove,
		reintroduced by the fix for it. Both are children of `<main>` now, so
		there is one content box and one centre.
	-->
	<nav
		class="sticky top-0 z-10 shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
		aria-label="Rollout sections"
	>
		<!--
			⛔ FOUR ANONYMOUS 16px GLYPHS IN 97px CELLS, ABOVE A BOTTOM NAV THAT
			LABELS ALL SIX OF ITS OWN ITEMS. (defect #6, 2026-09-02) `hidden
			sm:inline` dropped this strip's labels below `sm` while
			`MobileTabBar.svelte` — the OTHER navigation bar on the same screen
			at that width — keeps every one of its own, at 10px under its icon.
			Two navigation bars on one screen, one of them unlabelled, reads as
			if this strip were decoration rather than navigation.

			The fix borrows that exact idiom instead of inventing a second one:
			icon on top, a 10px label under it, `truncate` so `Dependencies`
			(the longest tab name) clips with an ellipsis rather than wrapping
			the cell taller than its siblings. `sm:` reverts to the original
			single-row icon+label at `text-sm` — this only ever fires below
			`sm`, the one width the defect was measured at.
		-->
		<!-- `overflow-x-auto no-scrollbar`, NOT a bare `flex`. (2026-09-03, design
		     pass 6, operator-walk finding: `main.scrollWidth` 464 vs `clientWidth`
		     449 at 640.) Right at the `sm` boundary the tabs switch from the
		     stacked icon+10px-label cell to the horizontal icon+`text-sm`-label
		     row, and `sm:shrink-0` on each tab (added so a tab keeps its label on
		     one line instead of wrapping) stops the row from shrinking to fit —
		     four tabs' natural width exceeds 449px of content box, and since this
		     div has no overflow of its own the excess painted OUTSIDE it and
		     inflated `<main>`'s `scrollWidth` instead, the ancestor that actually
		     owns scrolling. `app.css`'s `.no-scrollbar` was already written for
		     exactly this shape ("horizontal-scrolling tab strips like the rollout
		     detail tabs") but had never been wired to this strip. Containing the
		     overflow here — a strip that scrolls internally instead of stretching
		     its parent — keeps every tab reachable without widening the page. -->
		<div bind:this={tabStripEl}
			class="mx-auto flex w-full max-w-7xl items-stretch overflow-x-auto px-4 no-scrollbar sm:justify-start sm:gap-0 sm:px-6">
			<!--
				⭐ NO `.filter()` HERE ANY MORE — SEE `tabs`' OWN COMMENT. All four
				entries render on every paint; `state` decides the TREATMENT, not
				presence:
				  'active'  — the unchanged tab, a real `<a href>`.
				  'pending' — the slot is reserved (same box, same flex-1 share)
				              but the tab is not yet a destination: no `href` (an
				              anchor with none is neither focusable nor a link),
				              `aria-disabled`, muted ink.
				  'hidden'  — this rollout has neither an `Environment` nor a
				              `RolloutDependency`, so this tab is never a real
				              destination — `invisible` (NOT `display:none` /
				              removed) keeps its flex-1 share reserved so `Logs`
				              and the other siblings do not re-width the moment
				              this resolves, `aria-hidden` + `tabindex="-1"` keeps
				              it out of the a11y tree and the tab order.
			-->
			<!--
				⛔ `hidden` IS REMOVED, NOT `invisible`. (2026-09-04, regression sweep:
				"a 148 px hole between History and Logs at 1440, a blank quarter of
				the strip at 390, on every rollout that has no dependencies, forever".)
				Arity-stability is about the LOAD transition: the slot is reserved
				while `pending` (unknown), and the strip re-flows exactly once when
				the answer resolves to "no such tab" — a one-time 148 px move on
				those rollouts is the honest cost; a permanent dead slot is not.
			-->
			{#each tabs.filter((t) => t.state !== 'hidden') as t (t.href)}
				{@const active = t.state === 'active' && isActive(t.href)}
				{@const pending = t.state === 'pending'}
				{@const hidden = false}
				<a
					href={t.state === 'active' ? t.href : undefined}
					aria-current={active ? 'page' : undefined}
					aria-disabled={pending ? 'true' : undefined}
					aria-hidden={hidden ? 'true' : undefined}
					tabindex={t.state === 'active' ? undefined : -1}
					title={t.label}
					class="group flex flex-1 flex-col items-center justify-center gap-0.5 border-b-2 px-1 py-2 text-[10px] font-medium transition-colors sm:flex-initial sm:shrink-0 sm:flex-row sm:gap-2 sm:px-3 sm:py-2.5 sm:text-sm
						{hidden ? 'invisible' : ''}
						{pending ? 'cursor-default opacity-40' : ''}
						{active
							? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
							: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
				>
					<t.icon class="h-4 w-4 shrink-0" />
					<span class="max-w-full truncate leading-tight">{t.label}</span>
				</a>
			{/each}
		</div>
	</nav>

	{@render children()}
</div>
