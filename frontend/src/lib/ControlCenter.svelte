<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import type { ClusterError } from '$lib/api/rollouts';
	import { buildRolloutCards, cardVerdict } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { rankLabel, rankRole, rankTitle, rankBehindBy } from '$lib/view-models/env-rank';
	import { getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { shortenVersion } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { getStatusCircleClass, BAKE_WORD, bakeTitle } from '$lib/bake-status';
	import { derivePipeline, kruiseRolloutsForRollout } from '$lib/pipeline';
	import { rolloutPath } from '$lib/source-dashboard';
	import { computeBakeProgress } from '$lib/view-models/bake-progress';
	import { Button } from 'flowbite-svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import RolloutStepper from '$lib/components/RolloutStepper.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { ChevronRightOutline, CloseCircleSolid, ClockSolid } from 'flowbite-svelte-icons';
	import type { Rollout, Environment, Kustomization, KruiseRollout } from '../types';
	import { pollWhenHealthy } from '$lib/api/errors';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) } })
	);
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const kustomizations = $derived<Kustomization[]>(query.data?.kustomizations?.items || []);
	const kruiseRollouts = $derived<KruiseRollout[]>(query.data?.kruiseRollouts?.items || []);
	const clusterErrors = $derived<ClusterError[]>(query.data?.clusterErrors || []);
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const cards = $derived<RolloutCard[]>(buildRolloutCards(rollouts, environments, $now));

	function href(c: RolloutCard): string {
		return rolloutPath(c.sourceCluster || localClusterName, c.ns, c.name);
	}

	const needsYou = $derived.by<RolloutCard[]>(() => {
		const out = cards.filter((c) => c.statusKey === 'failed' || c.stuck != null);
		return out.sort(
			(a, b) => (a.statusKey === 'failed' ? 0 : 1) - (b.statusKey === 'failed' ? 0 : 1)
		);
	});

	const inMotion = $derived.by<RolloutCard[]>(() => cards.filter((c) => c.isRunning));

	// Healthy = succeeded and not stuck. Split into those on their newest build
	// (Steady) and those still running an older build than their upstream
	// (Trailing) — healthy but not caught up, the promotion candidates.
	const healthy = $derived.by<RolloutCard[]>(() =>
		cards.filter((c) => c.statusKey === 'succeeded' && !c.stuck)
	);
	// ⛔ THE SPLIT READS `rank`, NOT `behind`. (2026-08-30) `c.behind` was
	// `null` whenever the old per-rollout derivation could not answer, and
	// `(null ?? 0) === 0` put those rollouts in STEADY — where the card then
	// printed the word `newest`. On the live hub that filed `hello-world-app`
	// in staging, nineteen builds behind, under "Steady", on the same page
	// where its dev twin — running the IDENTICAL build — sat under "Trailing".
	// `rankBehindBy` is 0 only for `newest`, `diverged` and `unknown`, and the
	// last two are not steady either, so they are split out below.
	const trailing = $derived.by<RolloutCard[]>(() =>
		healthy.filter((c) => rankBehindBy(c.rank) > 0 || c.rank.kind === 'diverged')
	);
	const steadyAll = $derived.by<RolloutCard[]>(() =>
		healthy.filter((c) => c.rank.kind === 'newest' || c.rank.kind === 'unknown')
	);
	const pendingCards = $derived.by<RolloutCard[]>(() =>
		cards.filter((c) => c.statusKey === 'pending')
	);
	const pendingCount = $derived(pendingCards.length);
	// Steady section grid also surfaces pending rollouts (no deploy yet) so
	// they aren't invisible — they're counted separately in the header but
	// still need a chip so the user knows which app is waiting.
	const steadySectionAll = $derived<RolloutCard[]>([...steadyAll, ...pendingCards]);
	const STEADY_PREVIEW = 8;
	const steadySectionPreview = $derived(steadySectionAll.slice(0, STEADY_PREVIEW));



	// Downstream promotion target for a rollout: the Environment (of the same
	// app) whose relationship points "After" this env — i.e. the env that
	// deploys next once this one is healthy.
	function nextEnvLabel(c: RolloutCard): string | null {
		if (!c.envName) return null;
		const appName = c.rollout.metadata?.name;
		const next = environments.find(
			(e) =>
				e.spec?.rolloutRef?.name === appName &&
				e.spec?.relationship?.type === 'After' &&
				e.spec?.relationship?.environment === c.envName
		);
		return next?.spec?.environment ? shortEnvLabel(next.spec.environment) : null;
	}

	// Per-track status detail for an in-motion card. The check window is a
	// whole-rollout phase (one line). Deploying is reported per active canary track — each
	// track's name + how far its canary steps have advanced (the real
	// substitute for the mock's per-track pod counts, which the list API
	// doesn't carry).
	// Each message is split into parts so only the status VERB is coloured
	// (deploying=blue / checking=yellow); the track name + detail stay neutral.
	function motionMessages(
		c: RolloutCard
	): { track: string | null; verb: string; verbTone: string; title: string; detail: string }[] {
		const summary = derivePipeline(
			c.rollout,
			kruiseRolloutsForRollout(c.rollout, kustomizations, kruiseRollouts)
		);
		const multi = summary.tracks.length > 1;

		if (c.bakeStatus === 'InProgress') {
			const start = c.rollout.status?.history?.[0]?.bakeStartTime;
			const p = computeBakeProgress(start, c.rollout.spec?.bakeTime, $now);
			const detail = p
				? `· ${Math.round(p.elapsedMs / 60000)}m of ${Math.round(p.totalMs / 60000)}m`
				: '';
			return [
				{
					track: null,
					verb: BAKE_WORD.InProgress,
					verbTone: 'text-yellow-700 dark:text-yellow-400',
					title: bakeTitle('InProgress'),
					detail
				}
			];
		}

		const active = summary.tracks.filter((t) => t.stages.includes('active'));
		const tracks = active.length > 0 ? active : summary.tracks.slice(0, 1);
		return tracks.map((t) => {
			const idx = t.stages.indexOf('active');
			return {
				track: multi && t.name && t.name !== 'deploy' ? t.name : null,
				verb: BAKE_WORD.Deploying,
				verbTone: 'text-blue-600 dark:text-blue-400',
				title: bakeTitle('Deploying'),
				detail: idx >= 0 ? `· step ${idx + 1}/${t.stages.length}` : ''
			};
		});
	}

	// Needs-you action affordance: link to the rollout's detail page (where
	// the real retry/reconcile/promote controls live) with copy that
	// matches the specific trouble the card is flagging.
	function attnActionLabel(c: RolloutCard): string {
		if (c.statusKey === 'failed') return 'Retry deploy';
		if (c.stuck?.kind === 'baking') return 'Promote now';
		return 'Reconcile';
	}
</script>

<svelte:head>
	<title>kuberik</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!--
		THE ONLY PAGE IN THE PRODUCT WITH NO h1 (fixed 2026-08-27).

		`/rollouts`, `/apps`, `/versions`, `/environments`, `/activity` and every
		detail route open on an `<h1>`; this page opened on four sibling `<h2>`s
		("Needs you now", "In motion", "Trailing", "Steady") with nothing above
		them, so heading-order navigation landed inside a section with no page
		title, and `routes/page.svelte.test.ts`'s `should render h1` has been red
		since the scaffold.

		IT IS `sr-only` AND MUST STAY `sr-only`. The human's standing constraint
		is that `/` does not change visually; `sr-only` is a 1px clip, so this
		adds zero pixels. Home is deliberately the one page with no printed
		title — the navbar wordmark and the Home tab already name it, and the
		four section headings are the page's real structure.
	-->
	<h1 class="sr-only">Home</h1>

	{#if clusterErrors.length > 0}
		<div
			class="mb-4 flex flex-col gap-1 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 dark:border-amber-800/40 dark:bg-amber-900/10"
		>
			{#each clusterErrors as ce (ce.name)}
				<div class="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
					<svg
						class="h-3.5 w-3.5 shrink-0"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
							clip-rule="evenodd"
						/>
					</svg>
					<span><span class="font-semibold">{ce.name}</span> unreachable — {ce.error}</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if query.isLoading}
		<div class="space-y-6">
			<div class="h-28 w-full animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each [0, 1, 2] as n (n)}
					<div class="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
				{/each}
			</div>
		</div>
	{:else if query.isError}
		<div class="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/15 dark:text-red-300">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if cards.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<p class="text-base font-semibold text-gray-900 dark:text-white">No rollouts yet</p>
			<p class="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
				Once you create <code
					class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Rollout</code
				> resources, the fleet overview will appear here.
			</p>
		</div>
	{:else}

		<!-- Needs you now -->
		{#if needsYou.length > 0}
			<section class="mb-8">
				<div class="mb-3 flex items-center gap-2">
					<span class="h-[5px] w-[5px] shrink-0 rounded bg-red-500"></span>
					<h2 class="text-base font-semibold text-gray-900 dark:text-white">Needs you now</h2>
					<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{needsYou.length}</span>
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each needsYou as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						{@const why =
							c.statusKey === 'failed'
								? c.failureCategory
									? `${c.failureCategory} failed`
									: 'deploy failed'
								: c.stuck?.kind === 'baking'
									? `${BAKE_WORD.InProgress} >1h`
									: c.stuck?.kind === 'deploying'
										? `${BAKE_WORD.Deploying} >1h`
										: `behind ${c.stuck?.peerEnv ?? ''}`}
						<div
							class="environment-theme-scope flex flex-col gap-3 rounded-xl border border-gray-200 bg-red-50/40 p-4 dark:border-gray-700 dark:bg-red-900/10"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<a href={href(c)} class="flex items-center gap-3 hover:opacity-80">
								<span
									class="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
										c.bakeStatus
									)}"
								>
									<BakeStatusIcon bakeStatus={c.bakeStatus} size="medium" />
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline gap-2">
										<span class="truncate font-mono text-sm font-semibold text-gray-900 dark:text-white"
											>{c.name}</span
										>
										{#if c.stuck}<StuckBadge reason={c.stuck} />{/if}
									</div>
									<span
										class="block truncate text-[11px] text-gray-500 dark:text-gray-400"
										>{#if c.title && c.title !== c.name}{c.title} · {/if}<span class="font-mono">{c.ns}</span></span
									>
								</div>
								{#if c.envDisplay}
									<Chip role="env" theme={c.theme} label={c.envDisplay} wide class="shrink-0" />
								{/if}
							</a>
							<div class="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
								{#if c.statusKey === 'failed'}
									<CloseCircleSolid class="h-3.5 w-3.5 shrink-0" />
								{:else}
									<ClockSolid class="h-3.5 w-3.5 shrink-0" />
								{/if}
								<span class="truncate">{why}</span>
							</div>
							<div class="border-t border-gray-100 pt-3 dark:border-gray-700/60">
								<RolloutStepper
									summary={derivePipeline(
										c.rollout,
										kruiseRolloutsForRollout(c.rollout, kustomizations, kruiseRollouts)
									)}
									triggered={c.statusKey !== 'pending'}
								>
									{#snippet trailing()}
										<span
											class="font-mono text-xs text-gray-600 dark:text-gray-300"
											title={c.version ?? ''}>{c.version ? shortenVersion(c.version) : '—'}</span
										>
										<Button size="xs" color="light" href={href(c)}>{attnActionLabel(c)}</Button>
									{/snippet}
								</RolloutStepper>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- In motion -->
		{#if inMotion.length > 0}
			<section class="mb-8">
				<div class="mb-3 flex items-center gap-2">
					<span class="relative flex h-[5px] w-[5px] shrink-0">
						<span class="absolute inset-0 animate-ping rounded bg-blue-400/60"></span>
						<span class="relative h-[5px] w-[5px] rounded bg-blue-500"></span>
					</span>
					<h2 class="text-base font-semibold text-gray-900 dark:text-white">In motion</h2>
					<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{inMotion.length}</span>
					<span class="text-xs text-gray-500 dark:text-gray-400"
						>deploying &amp; checking right now</span
					>
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each inMotion as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						{@const next = nextEnvLabel(c)}
						<a
							href={href(c)}
							class="environment-theme-scope flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<div class="flex items-center gap-3">
								<span
									class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
										c.bakeStatus
									)}"
								>
									<BakeStatusIcon bakeStatus={c.bakeStatus} size="small" />
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<span class="truncate font-mono text-sm font-semibold text-gray-900 dark:text-white"
											>{c.name}</span
										>
										<span class="relative flex h-1.5 w-1.5 shrink-0" title="live">
											<span
												class="absolute inset-0 animate-ping rounded-full {c.bakeStatus ===
												'Deploying'
													? 'bg-blue-400/60'
													: 'bg-yellow-400/60'}"
											></span>
											<span
												class="relative h-1.5 w-1.5 rounded-full {c.bakeStatus === 'Deploying'
													? 'bg-blue-500'
													: 'bg-yellow-500'}"
											></span>
										</span>
									</div>
									<span
										class="block truncate text-[11px] text-gray-500 dark:text-gray-400"
										>{#if c.title && c.title !== c.name}{c.title} · {/if}<span class="font-mono">{c.version ? shortenVersion(c.version) : '—'}</span></span
									>
								</div>
								{#if c.envDisplay}
									<Chip role="env" theme={c.theme} label={c.envDisplay} wide class="shrink-0" />
								{/if}
							</div>
							<RolloutStepper
								summary={derivePipeline(
									c.rollout,
									kruiseRolloutsForRollout(c.rollout, kustomizations, kruiseRollouts)
								)}
								triggered={c.statusKey !== 'pending'}
							/>
							<div class="mt-1.5 flex items-start justify-between gap-3 text-xs">
								<div class="flex min-w-0 flex-col gap-0.5">
									{#each motionMessages(c) as msg (msg.track ?? msg.verb)}
										<span class="truncate text-gray-500 dark:text-gray-400">
											{#if msg.track}<b class="font-semibold text-gray-700 dark:text-gray-300">{msg.track}</b>{' '}{/if}<span class="font-medium {msg.verbTone}" title={msg.title}>{msg.verb}</span>{#if msg.detail}{' '}{msg.detail}{/if}
										</span>
									{/each}
								</div>
								{#if next}
									<span class="shrink-0 text-gray-500 dark:text-gray-400"
										>next: <span class="font-medium text-gray-600 dark:text-gray-300">{next}</span
										></span
									>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Trailing: healthy but running an older build than upstream —
		     the promotion candidates. -->
		{#if trailing.length > 0}
			<section class="mb-8">
				<div class="mb-3 flex items-center gap-2">
					<span class="h-[5px] w-[5px] shrink-0 rounded bg-amber-500"></span>
					<h2 class="text-base font-semibold text-gray-900 dark:text-white">Trailing</h2>
					<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{trailing.length}</span>
					<span class="text-xs text-gray-500 dark:text-gray-400">healthy, but behind a newer build</span>
				</div>
				<!-- THE COMPACT ROW PICKS ITS OWN COLUMN COUNT (2026-08-26). It used to be
				     `sm:grid-cols-2 xl:grid-cols-3`, and `xl` is 1280 — where three columns
				     leave each row 347px. That was survivable while the env chip was clamped
				     to 72px and became a defect the moment it was not: measured at 1280,
				     un-clipping the region names took truncated APP names from 1 of 29 to 9,
				     and `edge-mesh` beside `PROD-AP-SOUTHEAST-2` rendered as `edge-m…`. Trading
				     one ellipsised identifier for another is not a fix.

				     A viewport breakpoint was the wrong control: what decides whether this row
				     fits is the ROW's width, and the sidebar plus the page gutters mean the
				     same viewport yields different row widths. `auto-fill` with a 24rem floor
				     asks the question directly. Measured, light, `/`: 1440 → 3 cols at 400px,
				     0 of 29 names truncated (was 3 cols / 0); 1280 → 2 cols at 528px, 0
				     truncated (was 3 cols / 9); 1024 → 2 cols, unchanged; 390 → 1 col.
				     `auto-fill` and not `auto-fit` so a section holding one or two rollouts
				     keeps card-width cards instead of stretching one to 1216px, which is what
				     the fixed 3-column grid did. -->
				<div class="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(24rem,1fr))]">
					{#each trailing as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						<!-- `{@const}` has to be the immediate child of the `{#each}`, not of
						     the `<a>` — Svelte 5 refuses it anywhere else. -->
						{@const verdict = cardVerdict(
							c,
							rankLabel(c.rank),
							rankTitle(c.rank, c.envDisplay || c.name)
						)}
						<a
							href={href(c)}
							class="environment-theme-scope flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<span
								class="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
									c.bakeStatus
								)}"
							>
								<BakeStatusIcon bakeStatus={c.bakeStatus} size="small" />
							</span>
							<span class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-gray-900 dark:text-white"
								>{c.name}</span
							>
							{#if c.envDisplay}
								<Chip role="env" theme={c.theme} label={c.envDisplay} wide class="shrink-0" />
							{/if}
							<!-- The rank and the build it describes, joined — the same unit
							     `/rollouts` uses and the same `Chip`. They were two loose
							     items here: a 10px mono sha and, next to it, an amber
							     `−1 vs dev` in a 10px sans that is in no type role. The
							     upstream env moves into the title; amber goes back to being
							     `stuck` and nothing else. -->
							<!-- ⛔ THE NUMBER AND THE WORD BOTH COME OFF `c.rank` NOW.
							     (2026-08-30) `−${c.behind.behindBy}` counted against this
							     rollout's OWN release list, which gave two different numbers
							     to two environments running one build. It is the shared
							     ladder rank — `env-rank.ts` — and the spelling is `19 behind`,
							     the one every rebuilt page already uses. Same Chip, same
							     roles, same geometry. -->
							<!-- ⛔ `/` SAID NOTHING WHEN PRODUCTION WENT BACKWARDS, AND THE FIRST FIX
							     COST THE APP NAME. A live UX critique rolled prod back to a one-hour-old
							     build and *"`/` rendered it exactly like a forward deploy"*; adding a
							     `ROLLED BACK` and a `PINNED` mark beside this chip then took the name's
							     width to ZERO on a 398px row and overflowed it (415/398). `cardVerdict`
							     puts the word INSIDE the chip that already states a verdict and keeps the
							     rank sentence in the same chip's title — same element, same role, same
							     geometry, nothing added to the row. `pinned` goes through the same
							     chip for the same reason — a loose `PINNED` mark took this name
							     to 85 of 108 on its own. -->
							<Chip
								role={rankRole(c.rank)}
								label={verdict.label}
								title={verdict.title}
								wide
								value={c.version ? shortenVersion(c.version) : '—'}
								valueTitle={c.version ?? undefined}
								class="min-w-0 shrink-0"
							/>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Steady -->
		<section>
			<div class="mb-3 flex items-center gap-2">
				<span class="h-[5px] w-[5px] shrink-0 rounded bg-green-700 dark:bg-green-400"></span>
				<h2 class="text-base font-semibold text-gray-900 dark:text-white">Steady</h2>
				<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{steadyAll.length}</span>
				{#if pendingCount > 0}
					<span class="text-xs text-gray-500 dark:text-gray-400">· {pendingCount} pending</span>
				{/if}
				<a
					href="/rollouts"
					class="ml-auto inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
				>
					View all rollouts <ChevronRightOutline class="h-3 w-3" />
				</a>
			</div>
			{#if steadySectionAll.length === 0}
				<p class="text-sm text-gray-500 dark:text-gray-400">No healthy rollouts yet.</p>
			{:else}
				<!-- THE COMPACT ROW PICKS ITS OWN COLUMN COUNT (2026-08-26). It used to be
				     `sm:grid-cols-2 xl:grid-cols-3`, and `xl` is 1280 — where three columns
				     leave each row 347px. That was survivable while the env chip was clamped
				     to 72px and became a defect the moment it was not: measured at 1280,
				     un-clipping the region names took truncated APP names from 1 of 29 to 9,
				     and `edge-mesh` beside `PROD-AP-SOUTHEAST-2` rendered as `edge-m…`. Trading
				     one ellipsised identifier for another is not a fix.

				     A viewport breakpoint was the wrong control: what decides whether this row
				     fits is the ROW's width, and the sidebar plus the page gutters mean the
				     same viewport yields different row widths. `auto-fill` with a 24rem floor
				     asks the question directly. Measured, light, `/`: 1440 → 3 cols at 400px,
				     0 of 29 names truncated (was 3 cols / 0); 1280 → 2 cols at 528px, 0
				     truncated (was 3 cols / 9); 1024 → 2 cols, unchanged; 390 → 1 col.
				     `auto-fill` and not `auto-fit` so a section holding one or two rollouts
				     keeps card-width cards instead of stretching one to 1216px, which is what
				     the fixed 3-column grid did. -->
				<div class="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(24rem,1fr))]">
					{#each steadySectionPreview as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						<a
							href={href(c)}
							class="environment-theme-scope flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<span
								class="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
									c.bakeStatus
								)}"
							>
								<BakeStatusIcon bakeStatus={c.bakeStatus} size="small" />
							</span>
							<span
								class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-gray-900 dark:text-white"
								>{c.name}</span
							>
							{#if c.envDisplay}
								<Chip role="env" theme={c.theme} label={c.envDisplay} wide class="shrink-0" />
							{/if}
							<!-- Same joined unit. Before this the card printed the sha in
							     10px mono and then, beside it, a bare 9px uppercase word —
							     `newest` in green, `pending`/`behind` in gray — a type role
							     that does not exist in the scale, in a second geometry, for
							     the exact fact `/rollouts` states with a chip attached to the
							     sha. One badge now, and the word is inside the one chip. -->
							<!-- ⛔ FOUR BRANCHES BECAME TWO, AND THE `{:else}` THAT
							     PRINTED `newest` IS THE ONE THAT HAD TO GO. (2026-08-30)
							     It was reached whenever `c.behind` was null, which is what
							     the old derivation returned for "cannot say" — so the
							     card's most confident word was rendered from its least
							     confident state. The verdict decides now, and an
							     unresolvable one prints `unknown` in the `unranked` role.
							     Same Chip, same roles, same geometry. -->
							{#if c.statusKey === 'pending'}
								<Chip
									role="rank"
									label="pending"
									title="No deploy yet"
									value={c.version ? shortenVersion(c.version) : '—'}
									valueTitle={c.version ?? undefined}
									class="min-w-0 shrink-0"
								/>
							{:else}
								<!-- ⛔ `/` SAID NOTHING WHEN PRODUCTION WENT BACKWARDS, AND THE FIRST FIX
								     COST THE APP NAME. A live UX critique rolled prod back to a one-hour-old
								     build and *"`/` rendered it exactly like a forward deploy"*; adding a
								     `ROLLED BACK` and a `PINNED` mark beside this chip then took the name's
								     width to ZERO on a 398px row and overflowed it (415/398). `cardVerdict`
								     puts the word INSIDE the chip that already states a verdict and keeps the
								     rank sentence in the same chip's title — same element, same role, same
								     geometry, nothing added to the row. `pinned` goes through the same
								     chip for the same reason — a loose `PINNED` mark took this name
								     to 85 of 108 on its own. -->
								{@const verdict = cardVerdict(
									c,
									rankLabel(c.rank),
									rankTitle(c.rank, c.envDisplay || c.name)
								)}
								<Chip
									role={rankRole(c.rank)}
									label={verdict.label}
									title={verdict.title}
									wide
									value={c.version ? shortenVersion(c.version) : '—'}
									valueTitle={c.version ?? undefined}
									class="min-w-0 shrink-0"
								/>
							{/if}
						</a>
					{/each}
				</div>
				{#if steadySectionAll.length > steadySectionPreview.length}
					<a
						href="/rollouts"
						class="mt-2 inline-block text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
					>
						+{steadySectionAll.length - steadySectionPreview.length} more in the full rollouts list
					</a>
				{/if}
			{/if}
		</section>
	{/if}
</div>
