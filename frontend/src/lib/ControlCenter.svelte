<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import type { ClusterError } from '$lib/api/rollouts';
	import { buildRolloutCards, cardVerdict, cardStateMark } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { rankLabel, rankRole, rankTitle, rankBehindBy } from '$lib/view-models/env-rank';
	import {
		isNeedsYou,
		isInMotion,
		isTrailing,
		isHeld,
		isSteady,
		isPending
	} from '$lib/view-models/fleet-groups';
	import { checkFailureTitle } from '$lib/view-models/health-witness';
	import { getEnvironmentThemeStyle, shortEnvLabel } from '$lib/environment-theme';
	import { shortenVersion, getDisplayVersion } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { getStatusCircleClass, BAKE_WORD, bakeTitle } from '$lib/bake-status';
	import { derivePipeline, kruiseRolloutsForRollout } from '$lib/pipeline';
	import { rolloutPath, rolloutMatchesEnvironment } from '$lib/source-dashboard';
	import { computeBakeProgress } from '$lib/view-models/bake-progress';
	import { compactSpan } from '$lib/view-models/lead-time';
	import { Button } from 'flowbite-svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import RolloutStepper from '$lib/components/RolloutStepper.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import HomeRail from '$lib/components/HomeRail.svelte';
	import {
		ChevronRightOutline,
		CloseCircleSolid,
		ClockSolid,
		ExclamationCircleSolid
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment, Kustomization, KruiseRollout } from '../types';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';

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

	// ⛔ THE FIVE BUCKETS LIVE IN `view-models/fleet-groups.ts` NOW.
	// (2026-08-31) They used to live here, and `/rollouts` — the page an
	// operator opens to scan everything — carried its OWN four, one of which
	// (`Healthy`) folded Trailing and Steady together. The result was
	// `Attention 0 · In motion 1 · Pending 0 · Healthy 14` on a fleet that
	// this page was filing under Trailing at the same second. Same predicates,
	// one module, both pages import it.
	const needsYou = $derived.by<RolloutCard[]>(() => {
		const out = cards.filter(isNeedsYou);
		return out.sort(
			(a, b) => (a.statusKey === 'failed' ? 0 : 1) - (b.statusKey === 'failed' ? 0 : 1)
		);
	});

	const inMotion = $derived.by<RolloutCard[]>(() => cards.filter(isInMotion));

	// Healthy = succeeded and not stuck. Split into those at the head of their
	// own release list (Steady) and those with newer builds they could still
	// take (Trailing) — healthy but not caught up, the promotion candidates.
	//
	// ⛔ TRAILING ITSELF SPLITS AGAIN, ON `c.held`. (2026-09-03, operator-walk
	// finding 5) `hello-frontend-app` is held in all three environments by a
	// `RolloutDependency` contract nothing in this cluster can satisfy — and
	// this section's own header used to read *"Trailing — healthy, but behind
	// a newer build"* over all three, with the only signal that anything was
	// different a WORDLESS orange pause glyph (`deploy succeeded, held` lives
	// only in `sr-only` text — no hover exists on touch, so a phone reader
	// never gets it at all). "Behind, promoting normally" and "behind,
	// permanently blocked" are different facts and had one header. `held`
	// gets its own section, between `In motion` and `Trailing`, and its own
	// cards say the word `held` out loud — see the section below.
	// ⛔ `isHeld` MOVED TO `fleet-groups.ts`, 2026-09-03 (F4 third re-check,
	// finding 5). This was the only place the predicate existed — `/rollouts`
	// had no equivalent split and counted these same rollouts under its own
	// `Trailing` pill, so the same four rollouts read `Held 4` here and
	// `Trailing 4` there. Both pages import the shared predicate now.
	const held = $derived.by<RolloutCard[]>(() => cards.filter(isHeld));
	const trailing = $derived.by<RolloutCard[]>(() => cards.filter((c) => isTrailing(c) && !c.held));
	const steadyAll = $derived.by<RolloutCard[]>(() => cards.filter(isSteady));
	const pendingCards = $derived.by<RolloutCard[]>(() => cards.filter(isPending));
	const pendingCount = $derived(pendingCards.length);
	// Steady section grid also surfaces pending rollouts (no deploy yet) so
	// they aren't invisible — they're counted separately in the header but
	// still need a chip so the user knows which app is waiting.
	const steadySectionAll = $derived<RolloutCard[]>([...steadyAll, ...pendingCards]);
	// ⛔ THE CAP USED TO FIRE AT 8 REGARDLESS OF WHETHER THE PAGE HAD ROOM.
	// (2026-09-02) At 1440×900 with the rail beside it, the left column ended
	// at y=468 while the rail ran to y=924 — 450×857px of empty page under a
	// header that read `+4 more in the full rollouts list`, hiding cards to
	// save space the page was not using. `STEADY_CAP` is a ceiling for a
	// fleet large enough that an unbounded grid would genuinely be a wall of
	// cards, not a budget for THIS fleet's height. Below it, every steady
	// card renders and there is no "+N more" to draw at all.
	const STEADY_CAP = 24;
	const steadySectionPreview = $derived(
		steadySectionAll.length <= STEADY_CAP ? steadySectionAll : steadySectionAll.slice(0, STEADY_CAP)
	);



	// Downstream promotion target for a rollout: the Environment (of the same
	// app) whose relationship points "After" this env — i.e. the env that
	// deploys next once this one is healthy.
	//
	// ⛔ "NEXT: STAGING" WHEN STAGING ALREADY HAS THE BUILD IS A PROMISE THE
	// PAGE HAD ALREADY KEPT. (2026-09-03, operator-walk finding 12) A card
	// mid-check printed `checking · 14s of 15s … next: staging` while staging
	// was on the identical sha — NEWEST in this same screen's Steady list a
	// moment later. `next` used to answer only "which environment is
	// downstream", never "has it already arrived there" — so a hop already
	// closed still read as a hop still open. `alreadyHasIt` compares the
	// downstream environment's OWN current version (read off its rollout,
	// not this card's) against the version THIS card is deploying, both
	// through `getDisplayVersion` so a sha and a display tag compare equal.
	function nextEnvLabel(c: RolloutCard): { label: string; alreadyHasIt: boolean } | null {
		if (!c.envName) return null;
		const appName = c.rollout.metadata?.name;
		const next = environments.find(
			(e) =>
				e.spec?.rolloutRef?.name === appName &&
				e.spec?.relationship?.type === 'After' &&
				e.spec?.relationship?.environment === c.envName
		);
		if (!next?.spec?.environment) return null;
		const nextRollout = rollouts.find((r) => rolloutMatchesEnvironment(r, next));
		const nextVersion = nextRollout?.status?.history?.[0]?.version
			? getDisplayVersion(nextRollout.status.history[0].version)
			: null;
		const alreadyHasIt = !!nextVersion && !!c.version && nextVersion === c.version;
		return { label: shortEnvLabel(next.spec.environment), alreadyHasIt };
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
			// ⛔ NOT `Math.round(ms / 60000)`. (2026-09-02) A 15s bake rounds to
			// `0m of 0m` on both sides of the fraction — a card that has been
			// baking for two minutes and one that started ten seconds ago printed
			// the identical string. `compactSpan` (the same formatter
			// `HomeRail`'s "Typical to prod" row already uses) picks the unit the
			// duration actually needs, so 15s prints `15s of 15s` and only
			// crosses into minutes once the bake is long enough to round sanely.
			const detail = p ? `· ${compactSpan(p.elapsedMs)} of ${compactSpan(p.totalMs)}` : '';
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
		// ⛔ THE DEPLOYING PHASE HAD NO ELAPSED TIME ANYWHERE ON `/`. (2026-09-02)
		// A deploy running two minutes and one that started ten seconds ago
		// rendered the identical `deploying · step 1/3`. `history[0].timestamp`
		// is the deployment's own start time — the same field `c.timestamp`
		// already carries — so elapsed is `$now` minus that, formatted with the
		// same `compactSpan` the bake branch above uses.
		const deployStartMs = c.timestamp ? new Date(c.timestamp).getTime() : NaN;
		const elapsed = Number.isFinite(deployStartMs)
			? compactSpan(Math.max(0, $now.getTime() - deployStartMs))
			: null;
		return tracks.map((t) => {
			const idx = t.stages.indexOf('active');
			const parts: string[] = [];
			if (elapsed) parts.push(elapsed);
			if (idx >= 0) parts.push(`step ${idx + 1}/${t.stages.length}`);
			return {
				track: multi && t.name && t.name !== 'deploy' ? t.name : null,
				verb: BAKE_WORD.Deploying,
				verbTone: 'text-blue-600 dark:text-blue-400',
				title: bakeTitle('Deploying'),
				detail: parts.length ? `· ${parts.join(' · ')}` : ''
			};
		});
	}

	// Needs-you action affordance: link to the rollout's detail page (where
	// the real retry/reconcile/promote controls live) with copy that
	// matches the specific trouble the card is flagging.
	function attnActionLabel(c: RolloutCard): string {
		if (c.statusKey === 'failed') return 'Retry deploy';
		// ⛔ NOT `Retry deploy`, AND NOT `Reconcile`. The deploy here succeeded;
		// what is failing is a check the dashboard cannot clear and a redeploy
		// would not fix. The only honest offer is to go and look at it — and
		// rollout detail is the one surface that names the check and quotes its
		// reason. Ranked ahead of the stuck branches: a blown SLO outranks a slow
		// promotion.
		if (c.checkFailure) return 'Investigate';
		if (c.stuck?.kind === 'baking') return 'Promote now';
		return 'Reconcile';
	}
</script>

<svelte:head>
	<title>kuberik</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
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

	<!--
		⛔ WAS A 12px AMBER ASIDE. The hub fails soft — a spoke that does not answer
		still returns `200` with the rest — so every group count on this page can be
		computed over a subset, and "Needs you 0" over a subset is the same lie as a
		blank page. `PartialDataNotice` is the product's `AlertPanel`, not a new idiom.
		INVISIBLE WHEN `clusterErrors` IS EMPTY, so `/` is unchanged in the healthy
		state the human's standing constraint is about.
	-->
	<PartialDataNotice
		errors={clusterErrors}
		subject="this page"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<div class="space-y-6">
			<div class="h-28 w-full animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each [0, 1, 2] as n (n)}
					<div class="h-28 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700"></div>
				{/each}
			</div>
		</div>
	{:else if query.isError}
		<!--
			⛔ HOME IS THE PAGE WHERE A BLANK IS MOST DANGEROUS. It has no printed
			title (the `h1` above is `sr-only`), so with `/api/rollouts` at 503 the
			WHOLE VISIBLE PAGE was one 14px line: `Failed to load: Request failed
			(503)`. Nothing said the cluster was unreachable, nothing offered a
			retry, and an operator scanning for "does anything need me" got silence
			— which on this page is the shape of an all-clear.
		-->
		<ErrorState
			error={query.error}
			subject="the fleet"
			backHref="/rollouts"
			backLabel="Go to Rollouts"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-2"
		/>
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
		<!--
			══ TWO COLUMNS, AND A REAL RIGHT RAIL ══════════════════════════════
			`COMPOSITION-GRAMMAR.md` §7. This page was a flat grid of fifteen
			small cards followed by 60% empty viewport at 1440 — it answered its
			own three criteria ("is anything on fire · what needs me, in what
			order · what can I resolve right now") correctly with *nothing*, and
			then stopped composing. The reference page the human calls beautiful
			is a main column plus a stack of small complete answers; `/apps` and
			`/envs/<name>` already ship that exact rail, with these exact two
			cards. `/` is the third.

			⛔ THE GROUPS LEAD AND THE RAIL FOLLOWS THEM IN DOCUMENT ORDER, so at
			every width below 1440 — the phone included — an operator still meets
			"what needs me" first and the rail is what they scroll to. A rail
			that pushes the severity groups below the fold on a phone would be
			the page's whole purpose spent on furniture.

			⚠️ 1440 AND 320px ARE MEASURED, NOT CHOSEN, and they are `/apps`'s
			own pair for the reason its note gives: 320 is the narrowest width at
			which `How it's going` still prints its own title beside its rollup.
			At 1440 the content container is 1201, so the main column is
			1201 − 320 − 24 = 857 and the card grid's `auto-fill` floor of 24rem
			yields TWO columns of 424 instead of three of 395 — which is what
			un-truncates `hello-frontend-app` in the Trailing group, the one
			place on this page where the DEVIATION was the thing being clipped.
			At 1280 the same arithmetic leaves 697px, i.e. ONE column, which is
			worse than the two-of-516 that width has today — so below 1440 the
			rail goes under the groups at full width, exactly as both siblings'
			do. Re-derive this pair if the container or the 24rem floor moves; do
			not nudge it.
		-->
		<div
			class="min-[1440px]:grid min-[1440px]:grid-cols-[minmax(0,1fr)_320px] min-[1440px]:items-start min-[1440px]:gap-6"
		>
		<div class="min-w-0">

		<!-- Needs you now -->
		{#if needsYou.length > 0}
			<section class="mb-8">
				<div class="mb-3 flex items-center gap-2">
					<span class="h-[5px] w-[5px] shrink-0 rounded bg-red-500"></span>
					<h2 class="text-base font-semibold text-gray-900 dark:text-white">Needs you now</h2>
					<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{needsYou.length}</span>
				</div>
				<!-- ⛔ THE ROW PICKS ITS OWN COLUMN COUNT, LIKE THE TWO GROUPS BELOW IT.
				     (2026-09-02) This was `sm:grid-cols-2 lg:grid-cols-3`, and `lg` is a
				     VIEWPORT breakpoint — the control the Trailing and Steady grids were
				     already moved off, for the reason written above them: what decides
				     whether a card fits is the ROW's width, and the sidebar, the page
				     gutters and now the rail all mean one viewport yields several row
				     widths. With the rail beside it the main column is 857px at 1440, so
				     three fixed tracks came out at 277px each: measured, `hello-world-app`
				     rendered `hello-wo…` in 82px of a needed 126 and the stepper's
				     `Retry deploy` button overhung the card next door. These are the
				     LOUDEST cards on the page and they were the ones being clipped.
				     Same `auto-fill` floor as the other two grids, so all four groups on
				     this page now answer one question one way: 1440 → 2 cols at 424px
				     (was 3 at 277), 1280 → 2 at 516, 390 → 1 col, none truncated. -->
				<div
					class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]"
				>
					{#each needsYou as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						<!--
							⛔ THE CHECK BRANCH LEADS, AND WITHOUT IT THIS LINE READ
							`behind ` WITH NOTHING AFTER IT. (2026-08-31) The chain ended
							in a `c.stuck?.peerEnv` fallback, so the moment a rollout
							entered this group for a reason that is neither a failed deploy
							nor a stuck one, the card's only explanatory line rendered a
							dangling preposition. A card in "Needs you now" that cannot say
							why is the same defect one screen further in.
						-->
						{@const why =
							c.checkFailure
								? c.checkFailure.check
									? `health check ${c.checkFailure.check} failing`
									: 'health check failing'
								: c.statusKey === 'failed'
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
								<!-- 40px is deliberate, not a stray size — "Needs you now" is an
								     ACTION CARD, not a list row, and keeps its own larger token.
								     See `BakeStatusIcon.svelte`'s diameter-token note. These rows
								     are never `state`-marked (held/pinned/rolled-back only apply
								     to a settled deploy, and this section is failing/stuck ones),
								     so it never collides with the list-row disc's vocabulary. -->
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
										<!-- ⛔ THE MARK IS THE SHARED `alarm` CHIP, the same one
										     `StuckBadge` resolves to, in the same slot. A failing
										     check is not a new severity and does not get a new
										     geometry: measured at 204.2 presence it is already the
										     loudest mark in the system, and a second, weaker pill
										     for it is exactly the defect StuckBadge's own note
										     records. The word is `unhealthy` because that is the
										     HealthCheck's own status value, verbatim, and the
										     direct antonym of the word that sent the operator back
										     to bed. -->
										<!-- ⚠️ `wide` IS REQUIRED. Measured at 1440 light without it,
										     `Chip`'s 12ch cap rendered `UNHEALT…` — the word cut one
										     letter before the syllable that carries the meaning, on
										     the one mark whose whole job is to contradict the word
										     `healthy`. Same opt-out the rank chip already takes. -->
										{#if c.checkFailure}<Chip
												role="alarm"
												label="unhealthy"
												title={checkFailureTitle(c.checkFailure)}
												wide
												class="shrink-0"
											/>{/if}
									</div>
									<!-- ⛔ SVELTE TRIMS TRAILING WHITESPACE AT A `{#if}` BLOCK'S
									     OWN END, SO `{c.title} · {/if}` LOST ITS TRAILING SPACE.
									     (2026-09-02) The template read as `<title> · ` with the
									     space plainly on the line, and the compiler still collapsed
									     it — the same class of bug `motionMessages`' own template
									     already worked around with an explicit `{' '}` expression a
									     few lines below. Measured live: `hello-world-app` rendered
									     `Hello World app ·hello-world-dev` with the sha/ns jammed
									     against the dot. `{' '}` is a JS expression, not literal
									     template whitespace, so it survives. -->
									<span
										class="block truncate text-[11px] text-gray-500 dark:text-gray-400"
										>{#if c.title && c.title !== c.name}{c.title} ·{' '}{/if}<span class="font-mono">{c.ns}</span></span
									>
								</div>
								{#if c.envDisplay}
									<Chip role="env" theme={c.theme} label={c.envDisplay} wide class="shrink-0" />
								{/if}
							</a>
							<div class="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400">
								{#if c.statusKey === 'failed'}
									<CloseCircleSolid class="h-3.5 w-3.5 shrink-0" />
								{:else if c.checkFailure}
									<!-- ⛔ NOT THE CLOCK. The clock is the `stuck` glyph and it
									     means "this is taking too long"; a blown SLO is not slow,
									     it is wrong, and nothing about it clears by waiting. -->
									<ExclamationCircleSolid class="h-3.5 w-3.5 shrink-0" />
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
				<!-- ⛔ THE ROW PICKS ITS OWN COLUMN COUNT, LIKE THE TWO GROUPS BELOW IT.
				     (2026-09-02) This was `sm:grid-cols-2 lg:grid-cols-3`, and `lg` is a
				     VIEWPORT breakpoint — the control the Trailing and Steady grids were
				     already moved off, for the reason written above them: what decides
				     whether a card fits is the ROW's width, and the sidebar, the page
				     gutters and now the rail all mean one viewport yields several row
				     widths. With the rail beside it the main column is 857px at 1440, so
				     three fixed tracks came out at 277px each: measured, `hello-world-app`
				     rendered `hello-wo…` in 82px of a needed 126 and the stepper's
				     `Retry deploy` button overhung the card next door. These are the
				     LOUDEST cards on the page and they were the ones being clipped.
				     Same `auto-fill` floor as the other two grids, so all four groups on
				     this page now answer one question one way: 1440 → 2 cols at 424px
				     (was 3 at 277), 1280 → 2 at 516, 390 → 1 col, none truncated. -->
				<div
					class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]"
				>
					{#each inMotion as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						<!-- ⛔ A PINNED ROLLOUT PROMOTES NOWHERE, AND A ROLLBACK IS NOT
						     "NEXT". (2026-09-02) A rollback to an older build with the
						     pin ON was mid-deploy and this card read `deploying · step
						     1/3 · next: staging` — a promotion the pin makes impossible.
						     `next` is null outright when pinned, and the pin itself moves
						     onto the card as a mark (`PinBadge`, beside the name), not a
						     sentence — the same shape `/namespaces/[name]` already uses
						     for a pinned app row. -->
						{@const next = c.pinnedVersion ? null : nextEnvLabel(c)}
						<a
							href={href(c)}
							class="environment-theme-scope flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<div class="flex items-center gap-3">
								<!-- DISC DIAMETER: `h-7 w-7`, the list-row token — see
								     `BakeStatusIcon.svelte`. This section was 32px; "In motion"
								     is a list row like every other one, not an action card. -->
								<span
									class="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
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
										{#if c.pinnedVersion}<PinBadge version={c.pinnedVersion} size="xs" />{/if}
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
									<!-- ⛔ SAME TRAILING-WHITESPACE TRIM AS THE "NEEDS YOU" ROW
									     ABOVE — `{' '}` after the dot, not a literal space before
									     `{/if}`. Measured live: `Hello World app ·0afab6f` with no
									     gap before the sha, on the "In motion" card. -->
									<span
										class="block truncate text-[11px] text-gray-500 dark:text-gray-400"
										>{#if c.title && c.title !== c.name}{c.title} ·{' '}{/if}<span class="font-mono">{c.version ? shortenVersion(c.version) : '—'}</span></span
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
								{#if next && !next.alreadyHasIt}
									<span class="shrink-0 text-gray-500 dark:text-gray-400"
										>next: <span class="font-medium text-gray-600 dark:text-gray-300">{next.label}</span
										></span
									>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ⛔ HELD: A CARD THAT WILL NOT MOVE ON ITS OWN, SPLIT OUT OF TRAILING.
		     (2026-09-03, operator-walk finding 5) See the `held` derivation
		     above for the defect. This section carries every `trailing` card
		     `promotionBlock` marks blocked — a newer build exists and no gate
		     lets any candidate through — so an operator does not read `Trailing`
		     and file it as "promoting on its own, just slow".

		     ⛔ THE CARD IS TWO LINES, DELIBERATELY WIDER THAN TRAILING'S. A
		     single `sm:flex` row (Trailing's own shape) was measured and
		     REJECTED for a standalone `held` chip on 2026-09-02 — a third mark
		     beside the rank chip took `hello-frontend-app` (19 characters) from
		     130px needed to 86-113px available and clipped the one identifier
		     that answers "which app". Splitting the row is the same fix as
		     giving the name its OWN line: name gets the full card width on line
		     one, chips wrap freely on line two, so a third chip never competes
		     with the name for width — and it costs nothing on touch, where
		     Trailing's `sm:flex` collapse already goes single-column anyway. -->
		{#if held.length > 0}
			<section class="mb-8">
				<div class="mb-3 flex items-center gap-2">
					<span class="h-[5px] w-[5px] shrink-0 rounded bg-orange-500"></span>
					<h2 class="text-base font-semibold text-gray-900 dark:text-white">Held</h2>
					<span class="font-mono text-xs text-gray-500 dark:text-gray-400">{held.length}</span>
					<span class="text-xs text-gray-500 dark:text-gray-400"
						>blocked by a rule, will not move on their own</span
					>
				</div>
				<div
					class="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]"
				>
					{#each held as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						{@const verdict = cardVerdict(
							c,
							rankLabel(c.rank),
							rankTitle(c.rank, c.envDisplay || c.name)
						)}
						{@const mark = cardStateMark(c)}
						<a
							href={href(c)}
							class="environment-theme-scope flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<div class="flex items-center gap-1.5">
								<span
									class="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
										c.bakeStatus,
										mark?.kind ?? null
									)}"
									title={mark ? mark.title : undefined}
								>
									<BakeStatusIcon
										bakeStatus={c.bakeStatus}
										size="small"
										state={mark?.kind ?? null}
										stateWord={mark?.word ?? ''}
									/>
								</span>
								<span
									class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-gray-900 dark:text-white"
									>{c.name}</span
								>
							</div>
							<!-- ⛔ `pl-[34px]` LINES THE CHIPS UP UNDER THE NAME, NOT THE
							     DISC — 28px disc + 6px (`gap-1.5`) = 34. `flex-wrap` so a
							     phone-width card wraps the third chip onto its own row
							     rather than clipping anything: at 390 this card is 358px
							     and three wide chips do not fit one line. -->
							<div class="flex flex-wrap items-center gap-1.5 pl-[34px]">
								{#if c.envDisplay}
									<Chip role="env" theme={c.theme} label={c.envDisplay} wide class="shrink-0" />
								{/if}
								<Chip
									role={rankRole(c.rank)}
									label={verdict.label}
									title={verdict.title}
									wide
									value={c.version ? shortenVersion(c.version) : '—'}
									valueTitle={c.version ?? undefined}
									class="min-w-0 shrink-0"
								/>
								<!-- ⭐ THE WORD, VISIBLE, NOT GLYPH-ONLY. (2026-09-03) The
								     Trailing card's fallback — the disc's `sr-only` text and
								     `title` — is invisible on touch (no hover) and silent to a
								     sighted reader who is not hovering either. `role="held"`
								     is the alias `rollout detail` already shipped for this
								     exact word: TRAILING's deep orange, not `blocked`'s red —
								     a gate correctly refusing a candidate is not adverse. -->
								<Chip role="held" label="held" title={mark ? mark.title : undefined} class="shrink-0" />
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
				     the fixed 3-column grid did.

				     ⛔ THE FLOOR IS `min(24rem,100%)`, NOT `24rem` (2026-08-30). A grid track
				     minimum is a HARD minimum — it does not shrink to fit its container. At
				     390 the row is 358px (390 minus two 16px page gutters) and the track stayed
				     384px, so every card on `/` ran 10px past the viewport and had its right
				     border and the right edge of its BUILD chip sliced off. `docScrollWidth ===
				     clientWidth` did NOT catch it, because an ancestor clips overflow: the page
				     did not scroll, it just cut the cards. `min(24rem,100%)` resolves the 100%
				     against the ROW — the width this grid was rewritten to ask about in the
				     first place. Wherever the row is at least 24rem the floor IS 24rem and
				     nothing moves (1440 → 3 cols at 400px, 1280 → 2 at 528px, 1024 → 2, all
				     verified pixel-identical); where the row is narrower, the single column is
				     the row. Same shape as the `minmax(0,1fr)` this file already uses
				     everywhere else: a floor that cannot exceed its container. -->
				<div
				class="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]"
				>
					{#each trailing as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						<!-- `{@const}` has to be the immediate child of the `{#each}`, not of
						     the `<a>` — Svelte 5 refuses it anywhere else. -->
						{@const verdict = cardVerdict(
							c,
							rankLabel(c.rank),
							rankTitle(c.rank, c.envDisplay || c.name)
						)}
						{@const mark = cardStateMark(c)}
						<!-- ⛔ F7: `hello-frontend-app` ELLIPSISED FOR 3px, IN ONE OF
						     THREE IDENTICAL CARDS. (2026-09-03, re-check) At 1440 the
						     `min-[1440px]:grid-cols-[minmax(0,1fr)_320px]` rail (below)
						     narrows this section's own row to 857px, which the 2-column
						     `auto-fill` grid splits into 424.5px cards — 127px clear for
						     the name against a 130px need, on the one 19-character app
						     name in the fleet. The row's four items (disc, name, env
						     chip, joined rank chip) are ALL already at their content
						     floor; there is no redundant constant left to drop. Per
						     `COMPOSITION-GRAMMAR.md`'s own "worst spacing census" note,
						     this page already carries off-scale `gap-1.5`/`gap-2.5` and
						     is still called one of the two best pages — `gap-2` (8px) →
						     `gap-1.5` (6px) across the row's three seams gives the name
						     its 3px back with margin, at a value already in this file's
						     own histogram, not a new one. Applies to both this card
						     (`trailing`) and its `steadySectionPreview` twin below, same
						     markup. -->
						<a
							href={href(c)}
							class="environment-theme-scope grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 transition-colors hover:border-gray-300 sm:flex dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<!-- ⛔ THE DISC CARRIES `rolled back` / `pinned`, AND THAT IS HOW THE
							     ROW KEEPS ITS NUMBER. (2026-08-31) `cardVerdict`'s precedence used
							     to put the state word in the CHIP, which evicted the rank: prod
							     read `ROLLED BACK 51b976a` with no number while it was the
							     most-behind rollout in the fleet — under a header that says
							     "healthy, but behind a newer build". The chip cannot hold both
							     (measured: a second word takes the app name's width to zero) and a
							     third mark is banned, so the fact moves to the one element on this
							     row that was drawing the norm — a green tick on every card in a
							     section where every card is `Succeeded` by construction. Hue
							     unchanged; the deploy did succeed. See `rollout-cards.ts`. -->
							<span
								class="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
									c.bakeStatus,
									mark?.kind ?? null
								)}"
								title={mark ? mark.title : undefined}
							>
								<BakeStatusIcon
									bakeStatus={c.bakeStatus}
									size="small"
									state={mark?.kind ?? null}
									stateWord={mark?.word ?? ''}
								/>
							</span>
							<span class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-gray-900 dark:text-white"
								>{c.name}</span
							>
							<!-- ⛔ AT PHONE WIDTH THE VERDICT GETS ITS OWN LINE (2026-08-30). The row is
							     name + env chip + rank/build chip, and at 390 the card is 358px wide: the
							     name was left ~130px and four of ten ellipsised. `hello-world…` on this
							     cluster is BOTH `hello-world-app` and `hello-world-manifests` — truncating
							     the identifier that answers "which one" is a desktop row derived down, not
							     a phone design. Below `sm` the card is a 2-column grid: dot + name on line
							     1, the chips on line 2 aligned under the name. This wrapper carries them.
							     ⚠️ `sm:contents` IS LOAD-BEARING. At ≥640 the wrapper stops generating a
							     box and the chips are direct flex children of the `<a>` again, so 1440 /
							     1280 / 1024 are pixel-identical to before — verified, not assumed. -->
							<div class="col-start-2 flex min-w-0 items-center gap-2 sm:contents">
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
								<!-- ⛔ NO STANDALONE `held` CHIP HERE — MEASURED AND REJECTED.
								     (2026-09-02) A first attempt added `Chip role="blocked"
								     label="held"` beside the rank chip; it clipped
								     `hello-frontend-app` (130px needed, 86-113px available) on
								     the exact row it exists to explain. `held` rides the disc
								     instead — the same fallback tier `rolled back`/`pinned` use
								     for the identical reason — via `cardStateMark` above; see
								     `rollout-cards.ts`. Zero pixels added, same slot. -->
							</div>
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
				<!--
					⛔ THE NUMERAL IS THE SECTION'S OWN SIZE, AND IT WAS THE ONE
					COUNT ON THIS PAGE THAT COULD NOT BE ADDED UP. (2026-09-02)
					It printed `steadyAll.length`, but the grid under it is drawn
					from `steadySectionAll` — steady PLUS pending, because a
					rollout that has never deployed must not be invisible — and
					the `+N more` control counts against that same longer list.
					With three pending rollouts the header read `Steady 12`, the
					grid drew 11 cards and the control offered `+4 more`: 11 + 4
					= 15, and nothing on the page said 15. Every other group
					header here means "this many cards below"; this one silently
					meant something else.

					`steadySectionAll.length` restores the arithmetic — drawn plus
					more equals the numeral — and the `· N pending` qualifier
					still names the subset, in the same slot and the same ink it
					always had. Where nothing is pending the two counts are
					identical and this header is byte-for-byte what it was.
				-->
				<span class="font-mono text-xs text-gray-500 dark:text-gray-400"
					>{steadySectionAll.length}</span
				>
				{#if pendingCount > 0}
					<span class="text-xs text-gray-500 dark:text-gray-400">· {pendingCount} pending</span>
				{/if}
				<!--
					⛔ THIS WAS ONE OF THREE "SEE MORE" AFFORDANCES ON THIS PAGE, TWO OF
					WHICH POINTED AT `/rollouts` 216px APART. (2026-09-02) The section
					header carried `View all rollouts` and, when the cap trimmed the
					grid, a second link below it read `+N more in the full rollouts
					list` — same destination, different spelling, different weight, no
					chevron. `.nav-link` is the product's one grammar for "a control that
					only changes what you are looking at": 14px/500, the transparent
					underline at rest, the SVG chevron. This is now the ONLY control on
					the page that opens `/rollouts` — see below, where the second one is
					deleted rather than restyled.
				-->
				<a href="/rollouts" class="nav-link ml-auto">
					View all rollouts <ChevronRightOutline class="h-3.5 w-3.5" />
				</a>
			</div>
			{#if steadySectionAll.length === 0}
				<!-- ⛔ NOT `No healthy rollouts yet.` (2026-08-31)
				     This page's own Trailing header defines that word: *"healthy,
				     but behind a newer build"*. With six rollouts filed under
				     Trailing, one section said six are healthy and the section
				     below it said none are — one page, two answers, and the
				     empty state was the one that was false. `Steady` is not
				     `healthy`; it is `healthy AND at the head of its own release
				     list`, and that is the only thing this line may claim is
				     absent. -->
				<p class="text-sm text-gray-500 dark:text-gray-400">
					Nothing is at the head of its own release list yet.
				</p>
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
				     the fixed 3-column grid did.

				     ⛔ THE FLOOR IS `min(24rem,100%)`, NOT `24rem` (2026-08-30). A grid track
				     minimum is a HARD minimum — it does not shrink to fit its container. At
				     390 the row is 358px (390 minus two 16px page gutters) and the track stayed
				     384px, so every card on `/` ran 10px past the viewport and had its right
				     border and the right edge of its BUILD chip sliced off. `docScrollWidth ===
				     clientWidth` did NOT catch it, because an ancestor clips overflow: the page
				     did not scroll, it just cut the cards. `min(24rem,100%)` resolves the 100%
				     against the ROW — the width this grid was rewritten to ask about in the
				     first place. Wherever the row is at least 24rem the floor IS 24rem and
				     nothing moves (1440 → 3 cols at 400px, 1280 → 2 at 528px, 1024 → 2, all
				     verified pixel-identical); where the row is narrower, the single column is
				     the row. Same shape as the `minmax(0,1fr)` this file already uses
				     everywhere else: a floor that cannot exceed its container. -->
				<div
				class="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(24rem,100%),1fr))]"
				>
					{#each steadySectionPreview as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
						<!-- `{@const}` has to be the immediate child of the `{#each}`. -->
						{@const mark = cardStateMark(c)}
						<a
							href={href(c)}
							class="environment-theme-scope grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 transition-colors hover:border-gray-300 sm:flex dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
							style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
						>
							<!-- ⛔ THE DISC CARRIES `rolled back` / `pinned`, AND THAT IS HOW THE
							     ROW KEEPS ITS NUMBER. (2026-08-31) `cardVerdict`'s precedence used
							     to put the state word in the CHIP, which evicted the rank: prod
							     read `ROLLED BACK 51b976a` with no number while it was the
							     most-behind rollout in the fleet — under a header that says
							     "healthy, but behind a newer build". The chip cannot hold both
							     (measured: a second word takes the app name's width to zero) and a
							     third mark is banned, so the fact moves to the one element on this
							     row that was drawing the norm — a green tick on every card in a
							     section where every card is `Succeeded` by construction. Hue
							     unchanged; the deploy did succeed. See `rollout-cards.ts`. -->
							<span
								class="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
									c.bakeStatus,
									mark?.kind ?? null
								)}"
								title={mark ? mark.title : undefined}
							>
								<BakeStatusIcon
									bakeStatus={c.bakeStatus}
									size="small"
									state={mark?.kind ?? null}
									stateWord={mark?.word ?? ''}
								/>
							</span>
							<span
								class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-gray-900 dark:text-white"
								>{c.name}</span
							>
							<!-- ⛔ AT PHONE WIDTH THE VERDICT GETS ITS OWN LINE (2026-08-30). The row is
							     name + env chip + rank/build chip, and at 390 the card is 358px wide: the
							     name was left ~130px and four of ten ellipsised. `hello-world…` on this
							     cluster is BOTH `hello-world-app` and `hello-world-manifests` — truncating
							     the identifier that answers "which one" is a desktop row derived down, not
							     a phone design. Below `sm` the card is a 2-column grid: dot + name on line
							     1, the chips on line 2 aligned under the name. This wrapper carries them.
							     ⚠️ `sm:contents` IS LOAD-BEARING. At ≥640 the wrapper stops generating a
							     box and the chips are direct flex children of the `<a>` again, so 1440 /
							     1280 / 1024 are pixel-identical to before — verified, not assumed. -->
							<div class="col-start-2 flex min-w-0 items-center gap-2 sm:contents">
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
								<!-- `held` rides the disc, not a chip, here too — see the
								     Trailing section's note. In practice this branch is
								     `newest` by construction (Steady = at the head of its own
								     release list), so a candidate rarely exists to be held;
								     `cardStateMark` covers it anyway so the fact cannot
								     silently disagree with `/rollouts`' card for the identical
								     rollout. -->
							</div>
						</a>
					{/each}
				</div>
				<!-- ⛔ THE SECOND `/rollouts` LINK IS DELETED, NOT RESTYLED. (2026-09-02)
				     The section header 216px above already opens the same URL — a
				     second control pointing at the SAME destination is a redundant
				     tab stop, the exact reason `.nav-link`'s own note gives for deleting
				     a duplicate rather than restyling it. With `STEADY_CAP` raised to 24
				     this almost never fires on a real fleet; where it still does (a
				     fleet with more than 24 steady rollouts), the header link is the
				     one control and it is already on screen. -->
			{/if}
		</section>
		</div>

			<!-- ══ THE RAIL ═══════════════════════════════════════════════════
			     `mt-8` matches the `mb-8` every section above it carries, so
			     stacked under the groups below 1440 the rail sits on the page's
			     own rhythm rather than on a gap of its own invention. At 1440 and
			     up the grid's `gap-6` owns the space and the margin goes. -->
			<div class="mt-8 min-w-0 min-[1440px]:mt-0">
				<HomeRail {cards} {rollouts} {environments} {localClusterName} />
			</div>
		</div>
	{/if}
</div>
