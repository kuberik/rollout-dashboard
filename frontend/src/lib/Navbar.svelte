<svelte:options runes={true} />

<script lang="ts">
	import { isApplePlatform } from '$lib/shortcut-hint';
	import { setWaveEnvironments } from '$lib/view-models/wave-environments.svelte';
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { parseChangeSlug } from '$lib/pr-ref';
	import { MoonOutline, SunOutline, SearchOutline } from 'flowbite-svelte-icons';
	import LogoDark from '$lib/assets/logo-rotate-dark.svg?raw';
	import LogoLight from '$lib/assets/logo-rotate-light.svg?raw';
	import { theme } from '$lib/stores/theme';
	import { setDisplayTimeZone, timeZonePreference } from '$lib/timezone.svelte';
	import { displayTimeZoneName } from '$lib/display-time';
	import type { Rollout } from '../types';
	import { ChevronSortOutline } from 'flowbite-svelte-icons';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, rolloutQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey } from '$lib/api/github';
	import { myPullsQueryOptions } from '$lib/api/my-pulls';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import GithubConnectButton from '$lib/components/GithubConnectButton.svelte';
	import { getEnvironmentThemeStyle, getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import type { Environment } from '../types';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { href, appPath } from '$lib/paths';
	import type { GateContext } from '$lib/view-models/blocking-story';
	import { cardContext } from '$lib/view-models/card-context';

	let currentTheme = $state<'light' | 'dark'>('light');
	const timeZoneTitle = $derived(
		timeZonePreference.zone === 'utc'
			? 'Times shown in UTC. Switch to local time'
			: `Times shown in local time (${displayTimeZoneName()}). Switch to UTC`
	);
	let switcherOpen = $state(false);
	let isMac = $state(false);

	/**
	 * ⛔ U-26 — THE BREADCRUMB ENV CHIP UNCAPS ONLY WHERE THERE IS ROOM.
	 * (2026-10-08.) The chip below was deliberately NOT `wide` (see its own
	 * comment) because at a narrow width — right at `sm`, where this crumb
	 * first appears — a long namespace/name pair and a 147px region chip on
	 * one non-wrapping row genuinely do compete for space. But that reasoning
	 * does not hold at 1440, where the finding measured ~350px sitting empty
	 * while `PROD-US-EAST-2` clipped to `PROD-US…` for no width reason at
	 * all. `lg` (1024px) is the floor the rollout layout itself already
	 * treats as "plenty of room" (`.dpc-desktop`'s own master-detail split).
	 */
	const roomForWideEnvChip = new MediaQuery('(min-width: 1024px)', false);

	theme.subscribe((value) => {
		currentTheme = value;
	});

	onMount(() => {
		theme.init();
		isMac = isApplePlatform(navigator.platform);
	});

	const isRolloutPage = $derived(appPath(page.url.pathname).match(/^\/rollouts\/[^/]+\/[^/]+/) !== null);
	const appDetailMatch = $derived(appPath(page.url.pathname).match(/^\/apps\/([^/]+)/));
	const envDetailMatch = $derived(appPath(page.url.pathname).match(/^\/envs\/([^/]+)/));
	const nsDetailMatch = $derived(appPath(page.url.pathname).match(/^\/namespaces\/([^/]+)/));
	// /changes/<host>/<owner>/<repo>/(pull/<n> | <sha>): the crumb names the change by its short ref ("#14", "a1b2c3d").
	const changeRef = $derived.by(() => {
		const m = appPath(page.url.pathname).match(/^\/changes\/(.+)$/);
		if (!m) return null;
		const parsed = parseChangeSlug(m[1].split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } }));
		if (!parsed) return null;
		return parsed.ref.kind === 'pull' ? `#${parsed.ref.number}` : parsed.ref.sha.slice(0, 7);
	});

	// Section breadcrumb: every page belongs to a section. Render as a
	// plain static link (no dropdown) — sidebar is the section switcher.
	// `base` is a build-time constant, so resolving `href()` once here (not
	// per-render) is safe.
	type Section = { key: string; label: string; href: string };
	const SECTIONS: readonly Section[] = [
		{ key: 'control', label: 'Home', href: href('/') },
		{ key: 'rollouts', label: 'Rollouts', href: href('/rollouts') },
		{ key: 'apps', label: 'Apps', href: href('/apps') },
		{ key: 'environments', label: 'Environments', href: href('/environments') },
		{ key: 'activity', label: 'Activity', href: href('/activity') },
		{ key: 'changes', label: 'Changes', href: href('/changes') },
		// Reached from a rollout's Dependencies tab ("Whole network ›"), not from
		// the sidebar — so the crumb is the only thing on the page that names it.
		{ key: 'dependencies', label: 'Dependencies', href: href('/dependencies') }
	];
	const currentSection = $derived.by<Section>(() => {
		const p = appPath(page.url.pathname);
		if (p.startsWith('/apps')) return SECTIONS[2];
		if (p.startsWith('/environments') || p.startsWith('/envs/')) return SECTIONS[3];
		if (p.startsWith('/activity')) return SECTIONS[4];
		if (p.startsWith('/changes') || p.startsWith('/revisions') || p.startsWith('/versions'))
			return SECTIONS[5];
		if (p.startsWith('/dependencies')) return SECTIONS[6];
		if (p.startsWith('/rollouts') || p.startsWith('/namespaces/')) return SECTIONS[1];
		return SECTIONS[0];
	});

	// Palette scope for the item ⇅ button — rollouts / apps / envs / namespaces.
	type PaletteScope = 'rollout' | 'app' | 'env' | 'namespace';
	let paletteScope = $state<PaletteScope | null>(null);

	// Detail context: rendered as breadcrumb 'Item ⇅' on detail pages.
	const detailContext = $derived.by(() => {
		if (isRolloutPage) return { kind: 'rollout' as const };
		if (appDetailMatch) return { kind: 'item' as const, item: decodeURIComponent(appDetailMatch[1]), mono: false };
		if (envDetailMatch) return { kind: 'item' as const, item: decodeURIComponent(envDetailMatch[1]), mono: false };
		if (nsDetailMatch) return { kind: 'item' as const, item: decodeURIComponent(nsDetailMatch[1]), mono: false };
		if (changeRef) return { kind: 'item' as const, item: changeRef, mono: true };
		return null;
	});

	const cluster = $derived(page.params.cluster as string | undefined);
	const namespace = $derived(page.params.namespace as string | undefined);
	const name = $derived(page.params.name as string | undefined);

	// ⭐ PERF-2026-09-04 §C.7 SLICE 4 — STREAM-AWARE. `['rollout', ns, name,
	// cluster]` is invalidated by the change stream (Rollout events, plus any
	// gate/schedule/health-check event in the same namespace) — see
	// `events.ts`'s `ROLLOUT_SCOPED_KEY_TAGS`.
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace: namespace || '',
			name: name || '',
			cluster,
			options: {
				// ⭐ CLUSTER-AWARE — this rollout's own cluster, not the fleet-wide
				// "every cluster up" gate. See rollout detail's identical comment.
				refetchInterval: pollWhenHealthy(5000, 60000, cluster),
				enabled: isRolloutPage && !!namespace && !!name
			}
		})
	);

	// `['rollouts', 'all']` is invalidated the same way; no `refetchInterval`
	// override here means it already inherits the app-wide stream-aware
	// default (`+layout.svelte`), so only `staleTime` needed converting.
	const allRolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({
			options: {
				staleTime: staleTimeWhenHealthy(30000, 30000)
			}
		})
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	/**
	 * ⭐ APPROACH B, ITEM C — THE PALETTE'S GLOBAL PR TITLE CACHE. `Navbar` is
	 * the one component that mounts `CommandPalette` and it lives in the root
	 * layout, so this query runs once for the tab's lifetime rather than
	 * being re-created per route — the same reasoning `allRolloutsQuery`
	 * above already relies on. Gated on `connected` so a cluster where
	 * GitHub was never set up (or this browser never connected it) never
	 * fires the request at all, rather than eating one guaranteed 401.
	 * `pollWhenHealthy(300000, …)` (inside `myPullsQueryOptions`) already
	 * stops polling on that 401 if the gate is ever wrong.
	 */
	const githubStatusQuery = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000,
		refetchInterval: false as const
	}));
	const myPullsQuery = createQuery(() =>
		myPullsQueryOptions({ days: 30, enabled: githubStatusQuery.data?.connected ?? false })
	);
	const myPulls = $derived(myPullsQuery.data?.pulls ?? []);

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const allRollouts = $derived(allRolloutsQuery.data?.rollouts?.items || []);
	const allEnvironments = $derived<Environment[]>(allRolloutsQuery.data?.environments?.items || []);
	/* batch4 #3b: the shell holds the fleet's Environments on EVERY route (rollout tabs, palette, cards), so no count reads a build that failed upstream in a place's wave chain (failed-builds.ts) */
	$effect(() => { setWaveEnvironments(allEnvironments); return () => setWaveEnvironments(null); });
	// ⛔ U-2 CLASS FIX (2026-10-09). The command palette's `cardNeedsYou`
	// filter reads `RolloutCard.stuck`, which now runs the same
	// `detectRolloutStuck` join every list surface does — see
	// `rollout-cards.ts`'s own doc comment. Without a real `GateContext` the
	// palette would (conservatively) over-count rather than silently
	// under-count like before, but every surface should supply the same
	// join rather than lean on that fallback.
	//
	// ⛔ shared/cards-join (2026-10-11): this used to stop at `gateContext`,
	// with no `contractHoldsFor` passed down to `CommandPalette` at all — a
	// rollout held ONLY by a `RolloutDependency` contract read `held: false`
	// in the palette while `/` correctly called it held. `cardContext` is
	// Home's own construction, lifted — see that module's own doc.
	const paletteCardCtx = $derived(
		cardContext({
			rollouts: allRollouts,
			environments: allRolloutsQuery.data?.environments ?? null,
			rolloutDependencies: allRolloutsQuery.data?.rolloutDependencies ?? null
		})
	);
	const paletteGateContext = $derived<GateContext>(paletteCardCtx.gateContext);
	const rolloutTheme = $derived(
		rollout ? getRolloutEnvironmentTheme(rollout, rolloutQuery.data?.environment) : null
	);
	const rolloutThemeStyle = $derived(
		rolloutTheme ? getEnvironmentThemeStyle(rolloutTheme) : undefined
	);


	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			if (!switcherOpen) {
				paletteScope = null; // global scope by default on ⌘K
				switcherOpen = true;
			} else {
				switcherOpen = false;
			}
		}
	}

	$effect(() => {
		// When the palette closes, reset its scope so the next open is clean.
		if (!switcherOpen) paletteScope = null;
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<nav
	class="environment-theme-scope relative sticky top-0 z-50 w-full bg-ground {isRolloutPage ? '' : 'border-b border-line'}"
	style={rolloutThemeStyle}
	aria-label="Global"
>
	<!-- The env band OVERLAYS the bar's top padding; it does not stack above
	     it. As a 4px block it made the navbar 57px on rollout detail and 53px
	     everywhere else, so every sidebar item and the page under it dropped
	     4px the moment you opened a rollout and rose again when you left. -->
	<!-- ⛔ THE 4px ENVIRONMENT STRIPE IS GONE (design language, 2026-10-08,
	     coordinator review). Identity is quiet: a full-width band in the
	     environment's hue made PROD's fuchsia the loudest hue on every prod
	     rollout page. The environment is named by the neutral env chip in the
	     breadcrumb and the page header. -->
	<div class="flex min-h-[52px] w-full flex-wrap items-center justify-between px-2 py-2 sm:px-6">
		<div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
			<a href={href('/')} class="flex shrink-0 items-center space-x-2 sm:hidden rtl:space-x-reverse">
				<div class="flex h-7 w-7 items-center justify-center sm:h-8 sm:w-8">
					<div
						class="h-full w-full [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
					>
						{@html currentTheme === 'dark' ? LogoDark : LogoLight}
					</div>
				</div>
				<span class="t-heading hidden text-fg-muted sm:inline"
					>kuberik</span
				>
			</a>

			<!-- Section breadcrumb: section name LINK navigates to the list
			     page; item chevron opens the unified CommandPalette scoped
			     to that kind. Same palette everywhere. Hidden on the home page —
			     the logo is the home affordance, no named crumb. -->
			{#if currentSection.key === 'control'}
				<!-- From `sm` up the bar is the page's location; Home names itself
				     (the logo is the home affordance only on the phone). -->
				<span class="t-ui hidden px-2 text-fg sm:inline">Home</span>
			{:else}
			<div class="flex min-w-0 items-center gap-1">
				
				<!-- Below `sm` the SECTION word yields to the ITEM when there is one.
				     (operator walk, 2026-09-03) At 390 the two crumbs split ~100px
				     and both ellipsised — `R… / hello…` on a rollout, `Enviro… / p…`
				     on an environment — so the bar named nothing. The bottom tab bar
				     already says which section a phone is in; the item name is the
				     one thing only this bar can say, so it gets the width. -->
				<a
					href={currentSection.href}
					class="truncate rounded px-2 py-1 t-ui text-fg transition-colors hover:bg-hover {detailContext
						? 'hidden sm:inline'
						: ''}"
				>{currentSection.label}</a>

				{#if detailContext?.kind === 'rollout' && rollout}
					<span class="t-body hidden select-none text-fg-disabled sm:inline" aria-hidden="true">/</span>
					<button
						type="button"
						onclick={() => { paletteScope = 'rollout'; switcherOpen = true; }}
						class="group flex min-w-0 items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-hover"
						aria-haspopup="dialog"
						aria-expanded={switcherOpen}
						aria-label={isMac ? 'Switch rollout (⌘K)' : 'Switch rollout (Ctrl K)'}
						title={isMac ? 'Switch rollout (⌘K)' : 'Switch rollout (Ctrl K)'}
					>
						<span class="flex min-w-0 items-baseline gap-1.5">
							<span class="t-body hidden truncate text-fg-subtle sm:inline">
								{rollout.metadata?.namespace}
							</span>
							<span class="t-body hidden text-fg-disabled sm:inline">/</span>
							<span class="t-ui truncate text-fg">
								{rollout.metadata?.name}
							</span>
							{#if rolloutTheme}
								<span class="hidden shrink-0 sm:inline-flex">
									<!-- NOT `wide` BELOW `lg` (2026-08-26, reversed in part
									     2026-10-08 — see `roomForWideEnvChip`). Every other env
									     chip in the product was widened in the clipping pass;
									     this one and the two in `CommandPalette` were kept
									     capped, because at `sm` the breadcrumb prints the
									     namespace and the rollout name in full immediately to
									     its left on a SINGLE NON-WRAPPING ROW, and a 147px
									     region chip there takes its width straight out of the
									     rollout name -- the exact row-eating the 12ch cap
									     exists to prevent.
									     ⛔ U-26 — BUT THAT TRADE DOES NOT HOLD AT 1440, where the
									     finding measured ~350px sitting empty while
									     `PROD-US-EAST-2` clipped to `PROD-US…` regardless. Wide
									     only from `lg`, where the row has the room this
									     component cannot see for itself. The full name is still
									     in `title` below `lg`, and the rollout page's own H1
									     chip, 60px below it, has always been `wide`. -->
									<Chip
										role="env"
										theme={rolloutTheme}
										label={shortEnvLabel(rolloutTheme) || rolloutTheme.label}
										title={rolloutTheme.label}
										wide={roomForWideEnvChip.current}
									/>
								</span>
							{/if}
						</span>
						<!-- U-26: `self-center leading-none` — the kbd's own line box (15.4px
						     at this `t-micro` size) sat slightly below the 14px chevron icon
						     beside it even under the row's `items-center`; pinning both to the
						     same cross-axis centre and collapsing the kbd's line-height removes
						     the half-pixel-scale drift. -->
						<kbd class="t-code-sm hidden shrink-0 self-center leading-none text-fg-subtle transition-colors group-hover:text-fg-muted md:inline-block">
							{isMac ? '⌘K' : 'Ctrl K'}
						</kbd>
						<ChevronSortOutline class="h-3 w-3 shrink-0 text-fg-subtle transition-colors group-hover:text-fg" />
					</button>
				{:else if detailContext?.kind === 'item'}
					<span class="t-body hidden select-none text-fg-disabled sm:inline" aria-hidden="true">/</span>
					{@const itemScope = appDetailMatch ? 'app' : envDetailMatch ? 'env' : nsDetailMatch ? 'namespace' : null}
					<button
						type="button"
						onclick={() => { if (itemScope) { paletteScope = itemScope; switcherOpen = true; } }}
						disabled={!itemScope}
						class="group flex min-w-0 items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
						aria-haspopup={itemScope ? 'dialog' : undefined}
						aria-expanded={itemScope ? switcherOpen : undefined}
						aria-label={itemScope ? `Switch ${currentSection.label.toLowerCase()}` : undefined}
					>
						<span class="truncate text-fg {detailContext.mono ? 't-code' : 't-ui'}" title={detailContext.item}>
							{detailContext.item}
						</span>
						{#if itemScope}
							<ChevronSortOutline class="h-3 w-3 shrink-0 text-fg-subtle transition-colors group-hover:text-fg" />
						{/if}
					</button>
				{/if}
			</div>
			{/if}
		</div>
		<!-- From `sm` up these live in the sidebar's footer; the phone keeps them here. -->
		<div class="flex shrink-0 items-center gap-2 sm:hidden">

			<!-- ⭐ THE ONLY WAY TO OPEN THE PALETTE, ON THE HOME PAGE, AT ANY
			     WIDTH, WAS A PHYSICAL KEYBOARD SHORTCUT. (P8 follow-on,
			     2026-09-03) The breadcrumb's item chevron only renders on
			     detail pages (`currentSection.key !== 'control'`), and `/`
			     itself is deliberately crumb-less, so there was never a click
			     target for the palette there — measured: `SearchOutline` was
			     imported into this file and never rendered. At 390 there is no
			     physical keyboard to press ⌘K/Ctrl K on, so this button is the
			     ONLY way in on a phone, not a convenience. -->
			<!-- ⛔ ITEM 10 (integration round 3): was its own `rounded-lg
			     bg-gray-100 p-2` box — a FILLED pill with no border, a
			     different shape from every other icon button this bar now
			     draws. `.btn .btn-secondary .btn-icon` is the one 36px
			     square (height, radius, border token) `Deploy`/`View on
			     GitHub` already use; icon buttons never invent a second
			     one. -->
			<button
				type="button"
				class="btn btn-ghost btn-icon"
				onclick={() => {
					paletteScope = null;
					switcherOpen = true;
				}}
				aria-haspopup="dialog"
				aria-expanded={switcherOpen}
				aria-label={isMac ? 'Search (⌘K)' : 'Search (Ctrl K)'}
				title={isMac ? 'Search (⌘K)' : 'Search (Ctrl K)'}
			>
				<SearchOutline class="h-5 w-5" strokeWidth="1.75" />
			</button>
			<GithubConnectButton />
			<!-- Grafana's "Browser time / UTC" switch: one tap flips every clock the
			     dashboard prints, for on-call reading deploys against alerts in UTC.
			     See `$lib/timezone.svelte`. -->
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				onclick={() => setDisplayTimeZone(timeZonePreference.zone === 'utc' ? 'local' : 'utc')}
				aria-label={timeZoneTitle}
				title={timeZoneTitle}
			>
				{timeZonePreference.zone === 'utc' ? 'UTC' : 'Local'}
			</button>
			<!-- ⛔ D-13 (integrate-fixa, 2026-10-08) — SunSolid/MoonSolid were the
			     only solid glyphs among this bar's icon buttons (Search is
			     `SearchOutline`, the breadcrumb's chevrons are `ChevronSortOutline`);
			     swapped to the outline pair so every icon button in the top bar
			     draws from the same glyph family. Box/size unchanged. -->
			<!-- ITEM 10: same `.btn-secondary.btn-icon` box as Search above —
			     see that button's own comment. -->
			<button
				class="btn btn-ghost btn-icon"
				onclick={() => theme.toggle()}
				aria-label={currentTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
				title={currentTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
			>
				{#if currentTheme === 'dark'}
					<SunOutline class="h-5 w-5" strokeWidth="1.75" />
				{:else}
					<MoonOutline class="h-5 w-5" strokeWidth="1.75" />
				{/if}
			</button>
		</div>
	</div>
</nav>

<CommandPalette
	bind:open={switcherOpen}
	bind:scope={paletteScope}
	rollouts={allRollouts}
	environments={allEnvironments}
	gateContext={paletteGateContext}
	contractHoldsFor={paletteCardCtx.contractHoldsFor}
	{localClusterName}
	currentNamespace={namespace}
	currentName={name}
	loading={allRolloutsQuery.isLoading}
	{myPulls}
	rolloutDependencies={allRolloutsQuery.data?.rolloutDependencies?.items ?? []}
/>

