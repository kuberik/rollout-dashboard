<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ══ `/namespaces/[name]` — ONTO THE GRAMMAR ═══════════════════════════
	 *
	 * This was **the last page in the product drawing its own caption-over-box
	 * chrome around an activity rail.** `/apps/[name]` and `/envs/[name]` both
	 * wrap `ActivityRail` in a `Card` with `chrome={false}`; this page did not
	 * even call `ActivityRail` — it carried a HAND-COPIED 70-line duplicate of
	 * it, with its own `STATUS_DOT` / `STATUS_TEXT` / `STATUS_LABEL` tables,
	 * its own day grouping and its own dot rail. Two copies of one object is
	 * how the two came to disagree: the rail's own copy had already been
	 * taught to print `prev → new`, to drop the word `Succeeded` beside a
	 * green dot, and to link a build by REVISION; this copy had none of it.
	 * The duplicate is deleted and the shared component is called.
	 *
	 * ── THE FOUR STAT TILES ARE GONE, AND THAT IS THE SAME DEFECT ──────────
	 * `ROLLOUTS 5` / `HEALTHY 4` / `FAILING 0` / `DEPLOYS·24H 12` were four
	 * `t-label` captions floating over four bordered boxes — the shape
	 * `COMPOSITION-GRAMMAR.md` names as what every rejected page is made of —
	 * spending four 24px numerals on numbers the page states again eight
	 * pixels below. `FAILING 0` in particular is a 24px numeral drawing the
	 * NORM, and it is the tile the colour audit caught at **1.47:1**.
	 *
	 * They are replaced by the `/apps` idiom: ONE summary sentence under the
	 * `h1`, and the two real verdicts moved into the two card headers where
	 * the reference page keeps its rollups. The 24h sparkline went with them —
	 * see `lastDeploy` below for the number it was drawing and why it was
	 * unreadable beside the list it sat next to.
	 *
	 * ── COLOUR ────────────────────────────────────────────────────────────
	 * The audit's three findings on this page: green on a 24px numeral (the
	 * tile is gone), the word `Succeeded` printed as PROSE in the state hue
	 * (`ActivityRail` does not print it at all — a green dot already said it),
	 * and `FAILING 0` at 1.47:1 (gone with the tile). Nothing on this page
	 * spends a status hue on the norm now.
	 *
	 * ── 2026-09-01: THE ROW WAS STILL A SPREADSHEET, AND IT LED WITH A SHA ─
	 * Three things landed together, and each of them is a rule this page was
	 * the last or nearly the last surface to be missing:
	 *
	 *   1. `.tap-zone` / `.tap-link` instead of a stretched invisible `<a>`.
	 *   2. The joined `[verdict][sha]` chip from `env-rank.ts` — see `ranks`.
	 *      This page did not import `env-rank` at all while `/rollouts`, which
	 *      draws the same row, has always printed the joined chip.
	 *   3. A disclosure for the tail, and the env chip moved to the LEFT of
	 *      the name where `/`, `/rollouts`, `/activity` and `ActivityRail` all
	 *      put it. It used to sit to the right of the version, so this page
	 *      read its row in a different order from every other list.
	 */
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, sourceClusterName, rolloutPath } from '$lib/source-dashboard';
	import { versionPathForRollout } from '$lib/version-utils';
	import {
		getDisplayVersion,
		categorizeFailure,
		formatStatusTime,
		formatTimeAgo,
		detectStuck,
		formatDate,
		shortenVersion
	} from '$lib/utils';
	import { rankVerdictsByRollout, rankLabel, rankRole, rankTitle } from '$lib/view-models/env-rank';
	import {
		getRolloutEnvironmentTheme,
		getEnvironmentThemeStyle,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { now } from '$lib/stores/time';
	import {
		ArrowLeftOutline,
		LayersSolid,
		RocketSolid,
		ClockSolid,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import Card from '$lib/components/Card.svelte';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../../../types';

	const namespace = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({
			options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) }
		})
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	type AppEntry = {
		rollout: Rollout;
		env: Environment | null;
		envName: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		title: string;
		sourceCluster: string;
	};

	const apps = $derived.by<AppEntry[]>(() => {
		const nsRollouts = rollouts.filter((r) => r.metadata?.namespace === namespace);
		return nsRollouts
			.map((r) => {
				const env = environments.find((e) => rolloutMatchesEnvironment(r, e)) || null;
				const theme = getRolloutEnvironmentTheme(r, env);
				return {
					rollout: r,
					env,
					envName: env?.spec?.environment || '',
					theme,
					title: r.status?.title || r.metadata?.name || '',
					sourceCluster: sourceClusterName(r)
				};
			})
			.sort((a, b) => {
				const sa = a.rollout.status?.history?.[0]?.bakeStatus === 'Failed' ? 0 : 1;
				const sb = b.rollout.status?.history?.[0]?.bakeStatus === 'Failed' ? 0 : 1;
				if (sa !== sb) return sa - sb;
				return (a.rollout.metadata?.name || '').localeCompare(b.rollout.metadata?.name || '');
			});
	});

	const failedCount = $derived(
		apps.filter((a) => a.rollout.status?.history?.[0]?.bakeStatus === 'Failed').length
	);
	const activeCount = $derived(
		apps.filter((a) => {
			const s = a.rollout.status?.history?.[0]?.bakeStatus;
			return s === 'InProgress' || s === 'Deploying';
		}).length
	);
	/**
	 * ⛔ NOT `deploys in the last 24h`, AND THE SPARKLINE IS GONE WITH IT.
	 *
	 * The tile said `DEPLOYS · 24H  0` while the rail beside it listed EIGHT
	 * deploys, because the newest one is 34 hours old. Both numbers were
	 * right and the pair was unreadable at a glance — the same shape as the
	 * green tick beside `PROD is 14 builds behind`. And `DeployVolumeSparkline`
	 * over an empty 24h window draws literally nothing, so the page carried a
	 * blank graphic captioned with a zero.
	 *
	 * `last deploy 1d ago` is the fact a reader actually wants from a
	 * namespace header — how fresh is this place — and it can never contradict
	 * the list under it.
	 */
	const lastDeploy = $derived.by<string | null>(() => {
		let newest: string | null = null;
		for (const a of apps) {
			for (const h of a.rollout.status?.history ?? []) {
				if (!h.timestamp) continue;
				if (!newest || new Date(h.timestamp).getTime() > new Date(newest).getTime())
					newest = h.timestamp;
			}
		}
		return newest;
	});
	/**
	 * `ActivityRail`'s own rule, applied by DATA rather than by assumption:
	 * *"a chip that is identical on every row is a mark that cannot mark
	 * anything."* A namespace is not an environment, so the chip is CORRECT in
	 * general — and on a namespace that happens to hold one environment it is
	 * eight copies of one word.
	 */
	const showEnvInRail = $derived(
		new Set(apps.map((a) => shortEnvLabel(a.theme) || a.envName)).size > 1
	);
	const activityCount = $derived.by(() => {
		let n = 0;
		for (const a of apps) n += (a.rollout.status?.history ?? []).length;
		return Math.min(n, 20);
	});

	/**
	 * THE CARD'S ANSWER, TAKEN WITHOUT READING A ROW. It states what it
	 * MEASURED — the last deploy of each rollout — and goes green only when
	 * that is true of every one of them. It deliberately does NOT say
	 * "healthy": a clean last deploy is not the same claim as a fleet on the
	 * newest version, and conflating the two is the exact pair `/apps` shipped
	 * as a lie (a green tick beside `PROD is 14 builds behind`).
	 */
	const rolloutsRollup = $derived.by(() => {
		const n = apps.length;
		if (failedCount > 0)
			return { text: `${failedCount} of ${n} failing`, tone: 'adverse' as const };
		if (activeCount > 0) return { text: `${activeCount} deploying now`, tone: 'active' as const };
		return { text: `all ${n} deployed cleanly`, tone: 'good' as const };
	});

	/**
	 * ⭐ THE ROW LEADS WITH THE RELATIVE VERSION, NOT THE SHA. (2026-09-01)
	 *
	 * This page printed a bare `t-code` sha in the right-hand column and did
	 * not import `env-rank` at all — while `/rollouts`, which draws the
	 * STRUCTURALLY IDENTICAL row, prints the joined `[verdict][sha]` chip. So
	 * one row shape carried two different answers depending on which page you
	 * reached it from, and this one carried the answer `DESIGN-INTENT.md`
	 * calls noise: *"relative version beats absolute. `−2 from newest` and
	 * `matches STG` are the signal; the sha is usually noise."*
	 *
	 * ⛔ AND IT IS THE SHARED DERIVATION, NOT A SECOND ONE. `rankVerdictsByRollout`
	 * is fed the WHOLE fleet (`rollouts`), never the namespace's slice: the
	 * ladder is per-app and an app's environments routinely live in different
	 * namespaces, so ranking against `apps` alone would build a ladder from a
	 * subset of the app's own cells and could answer `unreleased` for a build
	 * that is on the line. Same function, same numbers as `/` and `/rollouts`.
	 */
	const ranks = $derived(rankVerdictsByRollout(rollouts, environments));

	/**
	 * ── THE TAIL IS DISCLOSED, NOT PRINTED ────────────────────────────────
	 * `COMPOSITION-GRAMMAR.md` §8. The list is sorted failures-first, so the
	 * rows past the fold are by construction the ones that are fine. Eight is
	 * the point at which the card stops being a list and starts being a
	 * spreadsheet; below it the control would be drawing the norm.
	 */
	const ROLLOUTS_SHOWN = 8;
	let rolloutsExpanded = $state(false);
	const visibleApps = $derived(rolloutsExpanded ? apps : apps.slice(0, ROLLOUTS_SHOWN));

	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}
	function previousSucceededVersion(r: Rollout | null, currentV: string | null): string | null {
		if (!r) return null;
		for (const h of r.status?.history ?? []) {
			if (h.bakeStatus !== 'Succeeded') continue;
			const v = getDisplayVersion(h.version);
			if (v && v !== currentV) return v;
		}
		return null;
	}
</script>

<svelte:head>
	<title>kuberik | {namespace}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!--
		⭐ THE HUB FAILS SOFT. `/api/rollouts` answers 200 with the spokes that
		replied and names the ones that did not in `clusterErrors`, so this page
		can be PARTLY true — and until now only `/` and `/rollouts` said so.
		A rollout on an unreachable spoke is absent from every count here, and
		absent is not healthy. Renders nothing when every cluster answered.
	-->
	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this namespace"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<div class="space-y-6">
			<div class="space-y-2">
				<div class="h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-4 w-1/3 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
			</div>
			<div class="grid gap-6 lg:grid-cols-[1fr_320px]">
				<div class="h-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			</div>
		</div>
	{:else if query.isError}
		<!--
			⛔ WAS `Failed to load: <status code>` IN A ONE-LINE RED BOX. With
			`/api/rollouts` at 503 that left the page as a title and a whisper —
			indistinguishable at a glance from this page's own empty state, which
			is the reading that gets an operator to go back to bed at 3am. A
			request that FAILED is a different fact from one that succeeded and
			returned nothing, and `ErrorState` is the object that says so.
		-->
		<ErrorState
			error={query.error}
			subject="this namespace"
			backHref="/rollouts"
			backLabel="Back to all rollouts"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-0"
		/>
	{:else if apps.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<LayersSolid class="mb-3 h-10 w-10 text-gray-500 dark:text-gray-400" />
			<p class="t-body font-semibold text-gray-900 dark:text-white">Namespace not found</p>
			<p class="t-dense mt-1 max-w-sm text-gray-500 dark:text-gray-400">
				No rollouts in namespace
				<code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">{namespace}</code>.
			</p>
			<!-- Navigation, so it is a link. See `app.css`'s `.nav-link` block. -->
			<a href="/rollouts" class="nav-link mt-2">
				<ArrowLeftOutline aria-hidden="true" />
				Back to rollouts
			</a>
		</div>
	{:else}
		<!-- ══ HEADER — the `/apps` idiom: an h1 and ONE sentence ═══════════ -->
		<!-- ⚠️ THE `h1` STAYS DRAWN: the navbar names the SECTION and this page
		     names the NAMESPACE. ⭐ ONE HEAD ROW, `mb-5` — the meta line joins
		     the name on its baseline instead of forming a second band of chrome,
		     so the first content lands at y=72 like every other page. -->
		<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
			<h1 class="t-display-id min-w-0 truncate text-gray-900 dark:text-white">{namespace}</h1>
			<p class="t-dense min-w-0 text-gray-500 dark:text-gray-400">
				Namespace · {apps.length} rollout{apps.length === 1 ? '' : 's'}
				{#if failedCount > 0}
					· <span class="font-medium text-gray-700 dark:text-gray-200">{failedCount} failing</span>
				{/if}
				{#if activeCount > 0}
					· {activeCount} deploying now
				{/if}
				{#if lastDeploy}
					· last deploy {formatTimeAgo(lastDeploy, $now)}
				{/if}
			</p>
		</div>

		<div class="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
			<!-- ══ WHAT RUNS HERE ══════════════════════════════════════════ -->
			<Card
				icon={RocketSolid}
				title="Rollouts"
				verdict={rolloutsRollup.text}
				verdictTone={rolloutsRollup.tone}
				verdictTitle="Counts the last deploy of every rollout in this namespace"
				padded={false}
				class="min-w-0"
			>
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each visibleApps as a (a.rollout.metadata?.name)}
						{@const latest = a.rollout.status?.history?.[0]}
						{@const status = latest?.bakeStatus || 'None'}
						{@const ver = latest?.version ? getDisplayVersion(latest.version) : null}
						{@const failureCategory =
							status === 'Failed' ? categorizeFailure(latest?.bakeStatusMessage) : null}
						{@const prevV = status === 'Failed' ? previousSucceededVersion(a.rollout, ver) : null}
						{@const stuck = detectStuck(a.rollout, { now: $now })}
						{@const rank = ranks.get(a.rollout) ?? { kind: 'unknown' as const }}
						{@const appName = a.rollout.metadata?.name || ''}
						<li
							class="environment-theme-scope"
							style={a.theme ? getEnvironmentThemeStyle(a.theme) : undefined}
						>
							<!-- ⭐ `.tap-zone`, NOT AN INVISIBLE OVERLAY ANCHOR AND NOT A
							     WRAPPER. This row used to stretch an `<a class="absolute
							     inset-0">` with an `aria-label` across itself, which meant
							     the only thing carrying the row's destination was a rectangle
							     with no text: a keyboard user got a focus ring around nothing
							     they could read, and every other control in the row needed a
							     hand-written `z-[1]` to survive. The mechanism is the one in
							     `app.css` — the NAME is the anchor, its `::after` covers the
							     row, and `.tap-zone` raises the sha link on its own. Zero
							     added tab stops, no `<a>` inside an `<a>`. -->
							<!-- ⚠️ A GRID, NOT A FLEX ROW, AND THE REASON IS 390. The joined
							     `[verdict][sha]` chip is wider than the bare sha it replaced,
							     and in a flex row it took `hello-frontend-app` down to
							     `hello…` on a phone — destroying the one string that
							     identifies the row, which is the same defect that killed the
							     `/apps` convergence bar. Below `sm` the verdict drops to its
							     own line under the name and the name gets the full track;
							     from `sm` up the row is what it was. -->
							<div
								class="tap-zone grid grid-cols-[36px_minmax(0,1fr)_16px] items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-gray-50 sm:grid-cols-[36px_minmax(0,1fr)_auto_16px] dark:hover:bg-gray-700/30"
							>
								<span
									class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
										status
									)}"
								>
									<BakeStatusIcon bakeStatus={status} size="medium" />
								</span>
								<div class="flex min-w-0 flex-1 flex-col gap-0.5">
									<div class="flex min-w-0 items-center gap-2">
										{#if a.envName || a.theme}
											<Chip
												role="env"
												theme={a.theme}
												label={shortEnvLabel(a.theme) || a.envName || a.theme?.label || ''}
												wide
												class="shrink-0"
											/>
										{/if}
										<a
											href={rolloutPath(
												a.sourceCluster || localClusterName,
												a.rollout.metadata?.namespace || '',
												appName
											)}
											class="tap-link t-code min-w-0 truncate font-semibold text-gray-900 dark:text-white"
											>{appName}</a
										>
										{#if stuck}<StuckBadge reason={stuck} />{/if}
										{#if a.rollout.spec?.wantedVersion}<PinBadge
												version={a.rollout.spec.wantedVersion}
												size="xs"
											/>{/if}
									</div>
									<div class="flex min-w-0 items-baseline gap-2">
										{#if a.title !== appName}<span
												class="t-micro truncate text-gray-500 dark:text-gray-400">{a.title}</span
											>{/if}
										{#if failureCategory}
											<span
												class="t-micro truncate text-gray-500 dark:text-gray-400"
												title={latest?.bakeStatusMessage ?? ''}
												>· {failureCategory} failed{#if prevV}
													· was <span class="font-mono">{prevV}</span>{/if}</span
											>
										{/if}
									</div>
								</div>
								<div
									class="col-start-2 flex min-w-0 items-center gap-2 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end sm:gap-1"
								>
									<!-- ⭐ THE VERDICT FIRST, THE SHA SECOND, IN ONE BOX — the
									     `/rollouts` unit, from the ONE derivation
									     (`env-rank.ts`). `rankLabel` / `rankRole` / `rankTitle`
									     are total, so there is no branch here and no place for
									     a fourth spelling of `N behind` to appear. -->
									{#if ver}
										<Chip
											role={rankRole(rank)}
											label={rankLabel(rank)}
											title={rankTitle(rank, appName)}
											value={shortenVersion(ver)}
											valueHref={versionPathForRollout(a.rollout, appName, ver)}
											valueTitle={ver}
											wide
											class="min-w-0"
										/>
									{:else}
										<Chip
											role="unranked"
											label="never deployed"
											title="This app has never deployed here"
											wide
											class="min-w-0"
										/>
									{/if}
									{#if latest?.timestamp}
										<span
											class="t-code-sm {isRunning(status)
												? 'text-yellow-700 dark:text-yellow-400'
												: 'text-gray-500 dark:text-gray-400'}"
											title={formatDate(latest.timestamp)}
										>
											{formatStatusTime(status, latest.timestamp, $now)}
										</span>
									{/if}
								</div>
								<!-- THE ROW OPENS SOMETHING, AND NOTHING SAID SO. The whole
								     row has been a link since before this pass and carried no
								     affordance at all; `/apps` and `/versions` rows both end
								     in this chevron. -->
								<ChevronRightOutline
									class="col-start-3 row-start-1 h-4 w-4 shrink-0 text-gray-500 sm:col-start-4 dark:text-gray-400"
									aria-hidden="true"
								/>
							</div>
						</li>
					{/each}
				</ul>
				<!-- ONE CONTROL FOR THE TAIL, and it disappears once the tail is open —
				     a button that says `show 0 more` is an object drawing the norm. Same
				     shape and voice as the reference page's `Show 8 ready resources ›`. -->
				{#if !rolloutsExpanded && apps.length > ROLLOUTS_SHOWN}
					<button
						type="button"
						class="t-micro w-full border-t border-gray-100 px-4 py-2.5 text-left text-gray-500 hover:text-gray-700 hover:underline dark:border-gray-700/60 dark:text-gray-400 dark:hover:text-gray-200"
						onclick={() => (rolloutsExpanded = true)}
						>Show {apps.length - ROLLOUTS_SHOWN} more rollouts ›</button
					>
				{/if}
			</Card>

			<!-- ══ WHAT JUST HAPPENED ═══════════════════════════════════════
			     THE SHARED RAIL, IN A TITLED CARD. `chrome={false}` hands the
			     frame to `Card` so the two do not nest — the same call
			     `/apps/[name]` and `/envs/[name]` already make. The 24h
			     sparkline is the rollup: it summarises exactly the list under
			     it, which is the only place it carries anything. -->
			<Card icon={ClockSolid} title="Recent activity" padded={false} class="min-w-0">
				{#snippet rollup()}
					<span class="t-micro text-gray-500 tabular-nums dark:text-gray-400"
						>{activityCount} deploy{activityCount === 1 ? '' : 's'}</span
					>
					<a
						href={`/activity?ns=${encodeURIComponent(namespace)}`}
						class="t-micro text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
						aria-label={`View all activity for ${namespace}`}>view all ›</a
					>
				{/snippet}
				<ActivityRail
					rollouts={apps.map((a) => a.rollout)}
					{environments}
					limit={20}
					{localClusterName}
					showEnv={showEnvInRail}
					chrome={false}
					collapseAfter={8}
					activityHref={`/activity?ns=${encodeURIComponent(namespace)}`}
				/>
			</Card>
		</div>
	{/if}
</div>
