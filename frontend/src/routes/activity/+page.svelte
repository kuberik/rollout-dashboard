<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ══ `/activity` — squad-changes, lane D ═════════════════════════════════
	 * The fleet's deploy feed: `DeployBars` (design-rollout's shared chart
	 * primitive, `lib/components/charts/DeployBars.svelte`) over a feed of
	 * `ActivitySentence` rows. Replaced the 25-lane environment dot strip
	 * and the one-pill-per-region filter row.
	 */
	import FilterChip from '$lib/components/FilterChip.svelte';
	import { displayTimeZone } from '$lib/timezone.svelte';
	import { formatClockTime } from '$lib/display-time';
	import { startOfDayMs } from '$lib/display-time';
	import { createQuery } from '@tanstack/svelte-query';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, sourceClusterName, rolloutPath } from '$lib/source-dashboard';
	import {
		formatTimeAgoCompact,
		formatTimeAgo,
		getDisplayVersion,
		shortenVersion
	} from '$lib/utils';
	import { actorFrom, type Actor } from '$lib/actor';
	import { activityVerb, type ActivityKind } from '$lib/view-models/activity-verb';
	import {
		getRolloutEnvironmentTheme,
		getEnvironmentThemeStyle,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { compareEnvironmentNames, getEnvironmentRank } from '$lib/env-order';
	import { activityKindOf } from '$lib/view-models/activity-kind';
	import { now } from '$lib/stores/time';
	import {
		ClockOutline,
		CalendarMonthOutline,
		ChartOutline,
		ExclamationCircleSolid,
		ListOutline,
		RocketSolid,
		UndoOutline,
		ArrowsRepeatOutline
	} from 'flowbite-svelte-icons';
	import { deployActs, type DeployAct } from '$lib/history-marks';
	import { historyEntrySince } from '$lib/view-models/event-age';
	import { entryKey } from '$lib/activity-deeplink';
	import { tierOf, TIER_ORDER, type Tier } from '$lib/view-models/promotion-lanes';
	import { canonicalTier } from '$lib/view-models/sites-waves';
	import {
		groupActivityEntries,
		type GroupableEntry,
		type ActivityGroup
	} from '$lib/view-models/activity-groups';
	import { bucketize, type DeployBucket, type DeployMarker } from '$lib/view-models/deploy-bars';
	import { pickDefaultRange } from '$lib/view-models/activity-range';
	import { deployReason, deployMark } from '$lib/view-models/activity-note';
	import { inFlightRollouts, deployRateSub, isInFlightEntry } from '$lib/view-models/activity-figures';
	import { medianTimeToProdMs as medianTimeToProdMsOf } from '$lib/view-models/activity-time-to-prod';
	import { reachedProdTimestamps } from '$lib/view-models/reached-prod';

	/** The one member of `DeployAct` this page ever attaches to a row. */
	type RollbackAct = Extract<DeployAct, { kind: 'rollback' }>;
	import DeployBars from '$lib/components/charts/DeployBars.svelte';
	import DeployLegend from '$lib/components/charts/DeployLegend.svelte';
	import FeedRow from '$lib/components/activity/FeedRow.svelte';
	import ListCard from '$lib/components/new/ListCard.svelte';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	import ChangeList from '$lib/components/ChangeList.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import Card from '$lib/components/Card.svelte';
	import KpiTile, { type KpiDelta } from '$lib/components/KpiTile.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Environment } from '../../types';
	import { rememberShape, recallShape } from '$lib/skeleton-hints';
	import { pageTitle } from '$lib/page-title';

	const rolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({
			// ⭐ PERF-2026-09-04 §C.7 SLICE 4 — STREAM-AWARE (see RolloutGrid.svelte).
			options: {
				staleTime: staleTimeWhenHealthy(15000, 30000),
				refetchInterval: pollWhenHealthy(15000, 60000)
			}
		})
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived(rolloutsQuery.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(rolloutsQuery.data?.environments?.items || []);

	type PresetRange = '1h' | '6h' | '1d' | '7d' | '30d' | 'all';

	const RANGE_MS: Record<string, number> = {
		'1h': 3_600_000,
		'6h': 21_600_000,
		'1d': 86_400_000,
		'7d': 604_800_000,
		'30d': 2_592_000_000
	};

	type ActivityEntry = {
		/** `entryKey`'s own string — also `GroupableEntry`'s `key`, so this
		 *  type can feed `groupActivityEntries` without a second id. */
		key: string;
		rolloutName: string;
		rolloutNamespace: string;
		displayName: string;
		/** What the env FILTER matches on. Survives a missing `Environment`. */
		envKey: string;
		/** What the chip PRINTS. `prod`, `staging`, `prod-ap-northeast-1`. */
		envLabel: string;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		version: string;
		versionInfo: { tag: string; version?: string; revision?: string };
		previousVersion: string | null;
		bakeStatus: string;
		/** The controller's own failure message — `categorizeFailure`'s
		 *  input, the same field `rollout-cards.ts`'s `failureCategory`
		 *  reads, so a grouped row's "failed to deploy" vs "failed its
		 *  health check" never drifts from the Needs-you row's. */
		bakeStatusMessage: string | null;
		timestamp: string;
		href: string;
		actor: string;
		actorKind: 'User' | 'System';
		/**
		 * ⭐ THE OPERATOR'S OWN RECORDED NOTE. (2026-09-03, operator walk, P5)
		 * `h.message` — the controller's `Message *string`, "human-readable
		 * information about the deployment context" — was read for `deployActs`'
		 * system-default classification but dropped from the row itself, so
		 * `/activity`'s "What changed" disclosure expanded to a GitHub commit
		 * list and nothing else, while the History tab's identical entry showed
		 * a `Recorded note`. Passed straight through to `ChangeList`, which
		 * applies the SAME `isSystemDefaultNote` classification History does —
		 * one helper, not a second copy that can drift from it.
		 */
		note: string | null;
		// Commit range this deploy introduced (previous → this), for the lazy
		// on-click changelist. null when there's no prior revision to compare.
		revision: string | null;
		previousRevision: string | null;
		source: string | null;
		cluster: string | undefined;
		/**
		 * This row is the rollout's CURRENT deploy — its newest history entry.
		 * Weights the name (`t-card-title` vs `t-body`) the way `ActivityRail`
		 * does; carries no rank any more (see the course-correction note
		 * where `allEntries` used to read `rankVerdictsByRollout`, below).
		 */
		isLive: boolean;
		rollout: (typeof rollouts)[number];
		/**
		 * ⭐ WHETHER *THIS* HISTORY ENTRY WENT BACKWARDS — `history-marks.ts`'s
		 * per-index verdict, index-aligned with `history`, not
		 * `rollout-cards.ts`'s `detectRollback` (current deploy only). A
		 * rollback that has since been auto-corrected forward again is
		 * invisible to `detectRollback` the moment the correction lands, on
		 * the very row where it happened — an audit feed cannot afford that.
		 * See the same note in `ActivityRail.svelte`.
		 */
		rollbackAct: RollbackAct | null;
		/**
		 * ⛔ TRUE ONLY FOR THE OLDEST ENTRY OF A ROLLOUT WHOSE HISTORY IS AT ITS
		 * RETENTION LIMIT. (2026-09-03, operator-walk finding 13.) Every deploy
		 * this rollout made before this one is gone — evicted by
		 * `spec.versionHistoryLimit`, not "there weren't any" — so any day
		 * group holding this row may be missing deploys the API no longer has
		 * a record of. `groupRollup` uses it to say "at least N" instead of a
		 * bare count it cannot actually vouch for.
		 */
		retentionCut: boolean;
	};

	/**
	 * ⭐ THE FEED LED WITH THE SHA AND CARRIED NO RELATIVE SIGNAL, AND THEN
	 * THE FIX GREW A THIRD EMPHASIS. (2026-09-01, course-corrected round 2
	 * review 2026-10-08.)
	 *
	 * `DESIGN-INTENT.md`'s standing rule is that the RELATIVE version is the
	 * signal and the sha is usually noise, and this page used to print sixty
	 * shas and nothing else — the first fix was a joined `[verdict][sha]`
	 * chip on the live row, `env-rank.ts`'s one derivation.
	 *
	 * ⛔ BUT A RANK CHIP, EVEN ON ONLY ONE ROW, IS A THIRD EMPHASIS — the row
	 * already spends its two on the NAME and ONE state word. `ActivityRail`
	 * reached the same page and reversed it on 2026-10-08 (see that file's
	 * own note above `versionSnippet`): no rank chip anywhere, live row
	 * included. The relative signal survives as the plain `prev → new` pair
	 * every row already carries — the live row's own POSITION (sorted
	 * newest first, one row per entry) is what says "this is current", not
	 * a second encoding on top of it.
	 */

	// ── EVERY EVENT, UNFILTERED ────────────────────────────────────────────
	const allEntries = $derived.by<ActivityEntry[]>(() => {
		const entries: ActivityEntry[] = [];
		for (const rollout of rollouts) {
			const history = rollout.status?.history || [];
			const env = environments.find((e) => rolloutMatchesEnvironment(rollout, e));
			const envName = env?.spec?.environment || '';
			const theme = env
				? getRolloutEnvironmentTheme(rollout, env)
				: getRolloutEnvironmentTheme(rollout);
			// ⛔ NOT `envName` ALONE. A rollout with only a `theme` annotation has
			// an identity the page already paints with and used to refuse to name.
			const envKey = envName || theme?.environmentName || theme?.name || '';
			const envLabel = shortEnvLabel(theme) || envName || '';
			const limited = history.slice(0, 30);
			// Index-aligned with `history` (and therefore with `limited`, which
			// is a prefix of it) — see `RollbackAct` above.
			const acts = deployActs(rollout);
			// The FIRST entry that carries a timestamp is the current deploy —
			// not `i === 0`, because the controller can write an entry with no
			// timestamp and one of those at the head would move `live` onto the
			// second-newest row.
			let seenNewest = false;
			for (let i = 0; i < limited.length; i++) {
				const h = limited[i];
				if (!h.timestamp) continue;
				const isLive = !seenNewest;
				seenNewest = true;
				const act = acts[i];
				const rollbackAct = act?.kind === 'rollback' ? act : null;
				// `deployActs` already resolves this exact question for the History
				// tab: `kind === 'unknown'` IS "the oldest surviving entry, and
				// retention may have evicted one before it" — see `history-marks.ts`.
				const retentionCut = act?.kind === 'unknown';
				const currentV = getDisplayVersion(h.version);
				// Find the previous *different* version in this rollout's history,
				// capturing its revision for the lazy commit changelist.
				let previousVersion: string | null = null;
				let previousRevision: string | null = null;
				for (let j = i + 1; j < history.length; j++) {
					const v = getDisplayVersion(history[j].version);
					if (v && v !== currentV) {
						previousVersion = v;
						previousRevision = history[j].version?.revision ?? null;
						break;
					}
				}
				entries.push({
					key: entryKey({
						rolloutNamespace: rollout.metadata?.namespace || '',
						rolloutName: rollout.metadata?.name || '',
						timestamp: h.timestamp
					}),
					rolloutName: rollout.metadata?.name || '',
					rolloutNamespace: rollout.metadata?.namespace || '',
					displayName: rollout.metadata?.name || '',
					envKey,
					envLabel,
					theme,
					version: currentV,
					versionInfo: h.version,
					previousVersion,
					bakeStatus: h.bakeStatus || 'None',
					bakeStatusMessage: h.bakeStatusMessage ?? null,
					// ⭐ shared/age-lag-total: ONE AGE PER EVENT. A Failed row used to
					// show the deploy's own START (`h.timestamp`) here — this page has
					// its own entry list (never `ActivityRail.svelte`, which Home's
					// rail uses), so it needed the identical fix separately or it
					// would keep disagreeing with every other surface for the exact
					// row the banner above names. `entryKey` above is left reading
					// the raw `h.timestamp` on purpose — deep links into this page are
					// keyed by the real history entry, not by the display instant.
					timestamp: h.bakeStatus === 'Failed' ? (historyEntrySince(h) ?? h.timestamp) : h.timestamp,
					href: rolloutPath(
						sourceClusterName(rollout) || localClusterName,
						rollout.metadata?.namespace || '',
						rollout.metadata?.name || ''
					),
					actor: h.triggeredBy?.name || 'system',
					actorKind: h.triggeredBy?.kind ?? 'System',
					note: h.message ?? null,
					revision: h.version?.revision ?? null,
					previousRevision,
					source: rollout.status?.source ?? null,
					cluster: sourceClusterName(rollout) || localClusterName,
					isLive,
					rollout,
					rollbackAct,
					retentionCut
				});
			}
		}
		return entries.sort(
			(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
		);
	});

	/** `activityKindOf`'s own `firstEnvRank` — the lowest environment rank
	 *  this APP (by display name) is seen deploying to anywhere in the
	 *  fleet, so "promoted" can tell a build carried forward PAST the app's
	 *  own starting tier from a build that is simply arriving at it. */
	const firstEnvRankByApp = $derived.by(() => {
		const out = new Map<string, number>();
		for (const e of allEntries) {
			const rank = getEnvironmentRank(e.envKey || e.envLabel);
			const cur = out.get(e.displayName);
			if (cur === undefined || rank < cur) out.set(e.displayName, rank);
		}
		return out;
	});

	// ── FILTERS ────────────────────────────────────────────────────────────
	// Synced with ?env=&app=&ns=&kind= so a filtered feed is deeplinkable —
	// paste "the four that need attention", refresh, and Back all have to
	// undo a chip. (2026-09-03, operator-walk finding 20.) `kind` used to be
	// a bare `$state`: every other chip on this page changed the URL, and
	// `Failed`/`In flight` were the one row that silently didn't — the
	// exact defect this fixes.
	const envFilter = $derived(page.url.searchParams.get('env'));
	const appFilter = $derived(page.url.searchParams.get('app'));
	const nsFilter = $derived(page.url.searchParams.get('ns'));

	/**
	 * ⭐ TIER PILLS, NOT ONE PILL PER REGION (squad-changes, lane D). The old
	 * env-chip row floated one `.pill` per `Environment` object — up to 25 on
	 * a real fleet, scrolling off the right edge of the strip. `tierOf`
	 * (`promotion-lanes.ts`, the same classifier Home's fleet track uses)
	 * folds every region into dev/test/staging/prod, so `prod-us-east-2` and
	 * `prod-ap-northeast-1` are one pill: `prod`. `envFilter` (`?env=`) stays
	 * — `/envs/[name]` deep-links here with a specific region — but nothing
	 * on this page draws a pill for it any more; it shows as a "Showing
	 * only" chip instead, same as `app`/`ns`.
	 */
	const tierFilter = $derived<Tier | null>(
		(() => {
			const raw = page.url.searchParams.get('tier');
			// Aliases ("production", "development", "stage") name the same tier.
			return canonicalTier(raw);
		})()
	);
	const TIER_FILTERS: { key: Tier; label: string }[] = [
		{ key: 'dev', label: 'dev' },
		{ key: 'test', label: 'test' },
		{ key: 'staging', label: 'staging' },
		{ key: 'prod', label: 'prod' }
	];
	function setTierFilter(next: Tier) {
		setParam('tier', next === tierFilter ? null : next);
	}

	/** `DeployBars`' range pills — the chart renders no toggles of its own. */
	const CHART_RANGES: { value: PresetRange; label: string }[] = [
		{ value: '1h', label: '1h' },
		{ value: '6h', label: '6h' },
		{ value: '1d', label: '1d' },
		{ value: '7d', label: '7d' },
		{ value: '30d', label: '30d' },
		{ value: 'all', label: 'All' }
	];

	function setParam(key: string, next: string | null) {
		const params = new URLSearchParams(page.url.searchParams);
		if (next) params.set(key, next);
		else params.delete(key);
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: false, noScroll: true, keepFocus: true });
	}
	function clearAllFilters() {
		selectedBucket = null;
		goto('?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	const activeFilterCount = $derived(
		(envFilter ? 1 : 0) + (appFilter ? 1 : 0) + (nsFilter ? 1 : 0) + (tierFilter ? 1 : 0)
	);

	// FOUR STATES, NOT THREE. The old row was `All / Deploys / In progress /
	// Failures`, where `Deploys` meant Succeeded+Deploying — i.e. "everything
	// except failures", which is what `All` already is on a healthy cluster,
	// and it overlapped `In progress` on one of its two values. A filter whose
	// result a reader cannot predict is a filter they will not press.
	//
	// ⛔ `rolled_back` ADDED — UX SWEEP FINDING 6. Four rollups on this page
	// already count rollbacks (`groupRollup`'s `rolledBack` branch, the day
	// cards, the chart card's own verdict) and none of them was a FILTER: a
	// reader who saw "3 rolled back" in a day card's rollup had no press that
	// scoped the feed to just those three, unlike `Failed`/`In flight`, which
	// both already had one. `isRolledBack` (below) is the existing predicate
	// every rollup already reads — this is its first use as a `kindFilter`.
	type KindFilter = 'all' | 'in_flight' | 'failed' | 'rolled_back';
	// `?kind=` — absent (or any other value) reads as `all`, and `all` is
	// never itself written to the URL, so the default URL for this page stays
	// clean, matching every other filter here.
	const kindFilter = $derived<KindFilter>(
		(() => {
			const raw = page.url.searchParams.get('kind');
			return raw === 'in_flight' || raw === 'failed' || raw === 'rolled_back' ? raw : 'all';
		})()
	);
	/**
	 * ⭐ NO `all` PILL (round 4 review, 2026-10-09) — the owner's standing
	 * rule for every filter row in the product (`/rollouts`, the env row
	 * right here): no selection IS all, so there is nothing for an `All`
	 * pill to do that clicking the pressed pill again does not already do.
	 * `setKindFilter` toggles now — pressing the ACTIVE pill clears back to
	 * `all` — which is the only way back to "everything" with the pill gone.
	 */
	function setKindFilter(next: KindFilter) {
		setParam('kind', next === kindFilter ? null : next === 'all' ? null : next);
	}
	const KIND_FILTERS: {
		key: Exclude<KindFilter, 'all'>;
		label: string;
		title: string;
		dot: string;
	}[] = [
		{
			key: 'failed',
			label: 'Failed',
			title: 'Deploys that did not finish cleanly',
			dot: 'bg-danger-solid'
		},
		{
			key: 'in_flight',
			label: 'In flight',
			title: 'Deploys still going out or still being checked',
			dot: 'bg-active-solid'
		},
		{
			key: 'rolled_back',
			label: 'Rolled back',
			title: 'Deploys that moved a rollout to an OLDER build than it was already running',
			dot: 'bg-fg-subtle'
		}
	];
	// ⛔ TAKES THE ENTRY, NOT JUST `bakeStatus`, NOW. A rollback IS a
	// `Succeeded` deploy (see `groupRollup`'s own note on why it ranks above
	// "all fine" anyway) — there is no `bakeStatus` value for it, so scoping
	// to it needs the same `rollbackAct` field `isRolledBack` already reads.
	function matchesKind(e: ActivityEntry): boolean {
		if (kindFilter === 'all') return true;
		if (kindFilter === 'failed') return e.bakeStatus === 'Failed';
		if (kindFilter === 'rolled_back') return isRolledBack(e);
		return isInFlightEntry(e);
	}

	/** Every filter but the one axis a pill count needs to ignore — so
	 *  pressing `Failed` doesn't also erase `Failed`'s own count from the
	 *  pill row. `/apps`' `statusPills` is the reference for this shape. */
	function applyFilters(
		entries: ActivityEntry[],
		opts: { skipKind?: boolean; skipTier?: boolean } = {}
	): ActivityEntry[] {
		return entries
			.filter((e) => !envFilter || e.envKey === envFilter)
			.filter((e) => !appFilter || e.rolloutName === appFilter)
			.filter((e) => !nsFilter || e.rolloutNamespace === nsFilter)
			.filter((e) => opts.skipTier || !tierFilter || tierOf(e.envKey || e.envLabel) === tierFilter)
			.filter((e) => opts.skipKind || matchesKind(e));
	}

	/** Everything the reader has scoped to, WITHOUT the time window. */
	const scoped = $derived(applyFilters(allEntries));
	const scopedNoKind = $derived(applyFilters(allEntries, { skipKind: true }));
	const scopedNoTier = $derived(applyFilters(allEntries, { skipTier: true }));

	// ── THE WINDOW ──────────────────────────────────────────────────────────
	/**
	 * ⭐ THE DEFAULT RANGE COMES FROM THE DATA (round 4 review, 2026-10-09,
	 * AD finding 1(a)): "choose the default range from the data: the
	 * narrowest of 1d/7d/30d that holds at least 80% of the window's
	 * deploys, so the plot is never two-thirds empty." A fixed `7d` default
	 * — tried in round 2 to stop `All` from opening on a mostly-empty
	 * 30-day plot — traded one empty-plot shape for another: a burst of
	 * activity inside the last day still opened on a `7d` window that was
	 * 6/7 baseline. Picking the NARROWEST range that already contains most
	 * of the window's own deploys means the plot opens dense, whatever the
	 * fleet's actual rhythm is.
	 */
	let rangeTouched = $state(false);
	let timelineRange = $state<PresetRange>('7d');
	/**
	 * Recomputes on every `allEntries` change while untouched — a poll that
	 * brings in a burst of new deploys can legitimately change which preset
	 * is narrowest-and-dense. Stops recomputing, permanently, the instant
	 * the reader presses a pill (`rangeTouched`) — their choice is never
	 * overridden, even by fresh data. `pickDefaultRange` itself is pure,
	 * tested in isolation (`$lib/view-models/activity-range.test.ts`).
	 */
	$effect(() => {
		if (rangeTouched) return;
		const next = pickDefaultRange(
			allEntries.map((e) => new Date(e.timestamp).getTime()),
			Date.now()
		);
		if (timelineRange !== next) timelineRange = next;
	});

	/**
	 * ⛔ `Date.now()`, NOT `$now` — FOUND DURING ROUND 2 REVIEW, 2026-10-08.
	 * `$now` (`$lib/stores/time`) is a `readable` whose INITIAL value is
	 * whatever `new Date()` returned the moment that module was first
	 * imported (module-eval time, which in a test is before `vi.useFakeTimers`
	 * ever runs) — it only becomes accurate once its own 100ms `setInterval`
	 * has ticked at least once. Reading it here meant `windowed` could go
	 * empty against a STALE clock for that first ~100ms of a render, which a
	 * message test (`rollback-mark.svelte.test.ts`) surfaced the moment this
	 * page gained a second always-rendered match for its assertion's text
	 * query and stopped incidentally retrying long enough for `$now` to
	 * self-correct. The one behaviour this gives
	 * up: a "last 1h" window no longer silently drops a row the SECOND it
	 * ages out while the tab sits open — it still ages out on the next poll
	 * (15-60s, `pollWhenHealthy`), which recomputes `allEntries` and this
	 * derivation with it.
	 */
	function inRange(ts: string): boolean {
		const t = new Date(ts).getTime();
		if (timelineRange === 'all') return true;
		return t >= Date.now() - (RANGE_MS[timelineRange] ?? Number.POSITIVE_INFINITY);
	}
	const rangeLabel = $derived(
		timelineRange === 'all'
			? 'all time'
			: ({
					'1h': 'the last hour',
					'6h': 'the last 6 hours',
					'1d': 'the last day',
					'7d': 'the last 7 days',
					'30d': 'the last 30 days'
				}[timelineRange] ?? '')
	);

	// UNCAPPED — the chart card's own rollup (below) has to answer for the
	// whole window, not just the sixty rows the list renders. `feed` stays
	// the list's own cap, unchanged. A clicked bar (`selectedBucket`, below)
	// narrows `feed` further, never the window's own totals — those answer
	// for the window the chart's pills set, not for one bucket of it.
	const windowed = $derived(scoped.filter((e) => inRange(e.timestamp)));

	/** Pill counts (round 2 review, 2026-10-09: "put the zero/non-zero
	 *  counts in each pill, as on /rollouts"). Each counts the WINDOW with
	 *  every filter applied except its own axis, same reason `scopedNoKind`/
	 *  `scopedNoTier` exist. */
	const windowedNoKind = $derived(scopedNoKind.filter((e) => inRange(e.timestamp)));
	const windowedNoTier = $derived(scopedNoTier.filter((e) => inRange(e.timestamp)));
	const kindCounts = $derived({
		failed: windowedNoKind.filter(isFailed).length,
		in_flight: windowedNoKind.filter(isInFlight).length,
		rolled_back: windowedNoKind.filter(isRolledBack).length
	});
	const tierCounts = $derived.by<Record<Tier, number>>(() => {
		const counts: Record<Tier, number> = { dev: 0, test: 0, staging: 0, other: 0, prod: 0 };
		for (const e of windowedNoTier) counts[tierOf(e.envKey || e.envLabel)]++;
		return counts;
	});
	const feed = $derived(
		windowed.filter((e) => inSelectedBucket(e.timestamp)).slice(0, 60)
	);

	/** The row's own time. Rows sit under a DAY header, so "1d" restated the
	 *  header and made two rollbacks an hour apart byte-identical; the clock
	 *  is the one thing the header does not say. `title` keeps the full date.
	 *
	 *  ⛔ D-10 (2026-10-08, polish pass) — this used to be a bare
	 *  `toLocaleTimeString` with no `hour12: false`, so a locale-default
	 *  AM/PM reader ("06:49 AM") wrapped onto two lines in the 390 time
	 *  column. `formatClockTime` is the one 24h clock-time formatter
	 *  (`lib/display-time.ts`, the "system" lane's D-10/D-17 ruling). */
	function clockOf(iso: string): string {
		return formatClockTime(iso);
	}

	// ── DEPLOY VOLUME BUCKETS — `DeployBars`' own `bucketize` (design-rollout's
	// shared chart primitive, `$lib/view-models/deploy-bars`). This page
	// keeps only the ONE thing that view-model doesn't decide for it: how
	// many buckets a given preset range gets (its own bucketing algorithm is
	// used as-is, never a second copy of it). `scoped` (filter-scoped, not
	// time-windowed) is the chart's own input — its range buttons set the
	// window, so it has to see further back than `windowed` to size `all`
	// correctly.
	const BUCKET_WIDTH_MS: Record<Exclude<PresetRange, 'all'>, number> = {
		'1h': 5 * 60_000,
		'6h': 15 * 60_000,
		'1d': 3_600_000,
		'7d': 6 * 3_600_000,
		'30d': 86_400_000
	};
	/** Smallest-first — `all`'s own width steps up until the bucket count is sane. */
	const ALL_BUCKET_WIDTHS = [
		5 * 60_000,
		15 * 60_000,
		3_600_000,
		6 * 3_600_000,
		86_400_000,
		7 * 86_400_000
	];
	const MAX_ALL_BUCKETS = 60;
	function bucketWidthFor(range: PresetRange, spanMs: number): number {
		if (range !== 'all') return BUCKET_WIDTH_MS[range];
		for (const w of ALL_BUCKET_WIDTHS) if (spanMs / w <= MAX_ALL_BUCKETS) return w;
		return ALL_BUCKET_WIDTHS[ALL_BUCKET_WIDTHS.length - 1];
	}
	const oldestScopedMs = $derived.by(() => {
		let oldest = Number.POSITIVE_INFINITY;
		for (const e of scoped) {
			const t = new Date(e.timestamp).getTime();
			if (t < oldest) oldest = t;
		}
		return Number.isFinite(oldest) ? oldest : null;
	});
	/** The window `DeployBars` plots — its own `startMs`/`endMs`/bucket count. */
	const chartWindow = $derived.by(() => {
		const end = Date.now();
		const span =
			timelineRange === 'all'
				? Math.max(oldestScopedMs !== null ? end - oldestScopedMs : 0, BUCKET_WIDTH_MS['1h'])
				: RANGE_MS[timelineRange];
		let start = end - span;
		let boundedEnd = end;
		if (timelineRange === '30d') {
			// ⭐ CALENDAR-ALIGNED DAY BUCKETS (round 6 review, 2026-10-09: "the
			// bucket pill and the feed disagree"). At 30d the bucket width is
			// a day; without this a bucket spans e.g. 14:32→14:32, which never
			// matches the feed's own midnight-to-midnight day groups. Snap
			// both edges to local midnight so bucket `i` IS calendar day `i`.
			start = startOfDayMs(new Date(start));
			boundedEnd = startOfDayMs(new Date(end)) + 86_400_000;
		}
		const count = Math.max(1, Math.ceil((boundedEnd - start) / bucketWidthFor(timelineRange, span)));
		return { start, end: boundedEnd, count };
	});
	/**
	 * ⭐ REACHED-PROD DEPTH (round 7 review, 2026-10-10): Home's own bucket
	 * grid marks the bar a build first reached a prod-tier environment in,
	 * drawn darker by the shared `DeployBars` — this chart draws it too now.
	 * Pure logic lives in `$lib/view-models/reached-prod`, tested in
	 * isolation; this just finds which bucket each timestamp falls in and
	 * flips `emphasis`, the same grid `volumeBuckets` itself is built on.
	 */
	const volumeBuckets = $derived.by<DeployBucket[]>(() => {
		const buckets = bucketize(
			scoped.map((e) => new Date(e.timestamp).getTime()),
			chartWindow.start,
			chartWindow.end,
			chartWindow.count
		);
		if (buckets.length === 0) return buckets;
		const reached = reachedProdTimestamps(
			scoped.map((e) => ({
				releaseKey: `${e.displayName}::${e.version}`,
				timestampMs: new Date(e.timestamp).getTime(),
				isProd: tierOf(e.envKey || e.envLabel) === 'prod',
				isRollback: isRolledBack(e)
			}))
		);
		const width = (chartWindow.end - chartWindow.start) / buckets.length;
		for (const ts of reached) {
			if (ts < chartWindow.start || ts >= chartWindow.end) continue;
			const idx = Math.min(buckets.length - 1, Math.floor((ts - chartWindow.start) / width));
			buckets[idx].emphasis = true;
		}
		return buckets;
	});

	/**
	 * ⭐ GHOST BARS — the previous window, bucketed on the SAME grid (round 2
	 * addendum, craft study D3: "previous period grey, this period
	 * coloured"). Passing `chartWindow.count` again gives bucket `i` of one
	 * array the same width and relative position as bucket `i` of the
	 * other. `null` for `all`: there is no equivalent "previous all time"
	 * to draw.
	 */
	const previousVolumeBuckets = $derived.by<DeployBucket[] | null>(() => {
		const span = chartWindow.end - chartWindow.start;
		if (timelineRange === 'all') return null;
		const end = chartWindow.start;
		const start = end - span;
		const timestamps = scoped
			.filter((e) => {
				const t = new Date(e.timestamp).getTime();
				return t >= start && t < end;
			})
			.map((e) => new Date(e.timestamp).getTime());
		return bucketize(timestamps, start, end, chartWindow.count);
	});

	/**
	 * ⭐ FAILURE/ROLLBACK MARKERS — labelled dotted lines on the time axis
	 * (round 2 addendum, craft study D4: PlanetScale's `#1369` deploy
	 * marker). `DeployBars`' own `placeMarkerLabels` handles crowding (drops
	 * a colliding label, keeps its dotted line), so this just supplies every
	 * marker in the window rather than pre-capping them.
	 */
	const chartMarkers = $derived.by<DeployMarker[]>(() => {
		const out: DeployMarker[] = [];
		for (const e of windowed) {
			const where = e.envLabel ? ` in ${e.envLabel}` : '';
			const clock = formatClockTime(e.timestamp);
			if (isFailed(e)) {
				out.push({
					key: entryKey(e),
					tsMs: new Date(e.timestamp).getTime(),
					// ⭐ THE APP NAMES ITSELF ON THE AXIS (round 6 review,
					// 2026-10-09): a sha means nothing at a glance — the app
					// is what a reader needs to spot a marker's story. The
					// sha stays, in the hover title, for whoever needs it.
					label: e.displayName,
					tone: 'failed',
					// ⭐ ENV + TIME IN THE PILL ITSELF (round 7 review,
					// 2026-10-10, AD finding 5: "markers lack env + time" —
					// matching Home's "checkout-worker failed in staging ·
					// 12:05"). `DeployBars`' own `markerText()` already
					// builds this exact sentence from `where`/`when`; just
					// supplying them, not reinventing the format. `font:
					// 'sans'` matches Home too (round 7 lead message,
					// 2026-10-10) — the label is a NAME here, not a sha.
					where: e.envLabel || undefined,
					when: clock,
					resolved: !e.isLive,
					font: 'sans',
					href: e.href,
					title: `${e.displayName}${where} failed on ${e.version}`
				});
			} else if (isRolledBack(e)) {
				out.push({
					key: entryKey(e),
					tsMs: new Date(e.timestamp).getTime(),
					label: e.displayName,
					tone: 'rolledBack',
					where: e.envLabel || undefined,
					when: clock,
					resolved: !e.isLive,
					font: 'sans',
					href: e.href,
					title: `${e.displayName}${where} rolled back to ${e.version}`
				});
			}
		}
		return out;
	});

	/** A clicked bar narrows the FEED to its bucket — a removable pill above
	 *  the list, not a second time-range control. Cleared whenever the
	 *  reader changes the range/filters out from under it. */
	let selectedBucket = $state<{ startMs: number; endMs: number } | null>(null);
	function handleBucketClick(bucket: { startMs: number; endMs: number }) {
		selectedBucket =
			selectedBucket?.startMs === bucket.startMs && selectedBucket?.endMs === bucket.endMs
				? null
				: { startMs: bucket.startMs, endMs: bucket.endMs };
	}
	function clearBucketSelection() {
		selectedBucket = null;
	}
	function inSelectedBucket(ts: string): boolean {
		if (!selectedBucket) return true;
		const t = new Date(ts).getTime();
		return t >= selectedBucket.startMs && t < selectedBucket.endMs;
	}
	const selectedBucketLabel = $derived.by(() => {
		if (!selectedBucket) return '';
		const span = selectedBucket.endMs - selectedBucket.startMs;
		if (span >= 20 * 60 * 60 * 1000) {
			return new Date(selectedBucket.startMs).toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				timeZone: displayTimeZone()
			});
		}
		return `${formatClockTime(new Date(selectedBucket.startMs).toISOString())}–${formatClockTime(
			new Date(selectedBucket.endMs).toISOString()
		)}`;
	});

	// ── THE ENV CONTROL STRIP ──────────────────────────────────────────────
	// Built from the EVENTS, not from the `Environment` list — same reason the
	// chip guard changed. An environment that appears in the feed but owns no
	// `Environment` object still gets a button.
	const knownEnvs = $derived.by(() => {
		const map = new Map<string, { key: string; label: string; theme: ActivityEntry['theme'] }>();
		for (const e of allEntries) {
			if (!e.envKey || map.has(e.envKey)) continue;
			map.set(e.envKey, { key: e.envKey, label: e.envLabel || e.envKey, theme: e.theme });
		}
		return [...map.values()].sort((a, b) => compareEnvironmentNames(a.label, b.label));
	});

	/** The env filter's own display word, for a clear-ONE-filter button — see
	 *  the empty state below. Falls back to the raw key so a filter that
	 *  matched nothing still names itself (its label never made it into
	 *  `knownEnvs`, which is built from the feed the filter just emptied). */
	const envFilterLabel = $derived(knownEnvs.find((e) => e.key === envFilter)?.label ?? envFilter);


	// ── TIME CLUSTERS ──────────────────────────────────────────────────────
	type DayGroup = {
		label: string;
		entries: ActivityEntry[];
	};
	/**
	 * `exact`: names the actual day instead of collapsing everything past a
	 * week into one "Earlier" catch-all (round 7 review, 2026-10-10, AD
	 * finding 6: "the filtered group reads 'Earlier', not the day"). The
	 * collapse exists so an unfiltered 30-day feed isn't 23 separate day
	 * cards — but a reader who clicked ONE bar on the chart is already
	 * looking at exactly one day's worth of rows; "Earlier" tells them
	 * nothing a date wouldn't, and the chart's own bucket pill already
	 * proved which day it is.
	 */
	function clusterLabel(ts: string, refNow: Date, exact = false): string {
		const d = new Date(ts);
		const ageMs = refNow.getTime() - d.getTime();
		if (ageMs < 60 * 60 * 1000) return 'In the last hour';
		const today = startOfDayMs(refNow);
		const dayStart = startOfDayMs(d);
		if (dayStart === today) return 'Today';
		if (dayStart === today - 86_400_000) return 'Yesterday';
		const daysAgo = Math.floor((today - dayStart) / 86_400_000);
		if (daysAgo < 7)
			return d.toLocaleDateString(undefined, { weekday: 'long', timeZone: displayTimeZone() });
		if (exact)
			return d.toLocaleDateString(undefined, {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				timeZone: displayTimeZone()
			});
		return 'Earlier';
	}

	const groupedByDay = $derived.by<DayGroup[]>(() => {
		// `new Date()`, not `$now` — the same fix and the same reason as
		// `inRange`'s own note above: `$now`'s INITIAL value is stale until
		// its first 100ms tick, which merged two adjacent fixture days into
		// one "Earlier" bucket for exactly as long as that staleness lasted
		// (round 2 review, 2026-10-08). `groupedByDay` still recomputes
		// every time `feed` changes (new poll data), so "Today"/"Yesterday"
		// still roll over within a poll cycle; it only stops re-labelling
		// on its own every 100ms while nothing else changes.
		const refNow = new Date();
		const groups: DayGroup[] = [];
		let currentLabel = '';
		for (const entry of feed) {
			const label = clusterLabel(entry.timestamp, refNow, !!selectedBucket);
			if (label !== currentLabel) {
				groups.push({ label, entries: [] });
				currentLabel = label;
			}
			groups[groups.length - 1].entries.push(entry);
		}
		return groups;
	});

	/**
	 * ⭐ ONE ROW PER RELEASE (round 4 review, 2026-10-09 — the owner's own
	 * complaint: "6 consecutive checkout-api rows at 21:36 for one
	 * release"). `groupActivityEntries` (`$lib/view-models/activity-groups`)
	 * collapses same app + same release + same minute into one group; this
	 * page feeds `ActivitySentence` the joined env text, unchanged
	 * component. `toGroupable` is the one-line adapter from this page's own
	 * `ActivityEntry` to the view-model's narrower shape.
	 */
	function toGroupable(entry: ActivityEntry): GroupableEntry {
		return {
			key: entryKey(entry),
			rolloutName: entry.rolloutName,
			rolloutNamespace: entry.rolloutNamespace,
			displayName: entry.displayName,
			envLabel: entry.envLabel,
			envKey: entry.envKey,
			version: entry.version,
			previousVersion: entry.previousVersion,
			timestamp: entry.timestamp,
			href: entry.href,
			bakeStatus: entry.bakeStatus,
			bakeStatusMessage: entry.bakeStatusMessage,
			isRollback: !!entry.rollbackAct
		};
	}
	function releaseGroupsFor(dayGroup: DayGroup): ActivityGroup<ActivityEntry>[] {
		return groupActivityEntries(dayGroup.entries.map(toGroupable)).map((g) => ({
			...g,
			members: g.members.map((m) => dayGroup.entries.find((e) => entryKey(e) === m.key)!)
		}));
	}

	/**
	 * ⭐ GROUPS CAP AT 20 ROWS, NEVER A ONE-ROW FOLD (round 4 review,
	 * 2026-10-09: "a fold for one row costs more than the row"). Capping
	 * AFTER grouping — not before — is what makes "`Today` shows 41 rows"
	 * become "`Today` shows 9 releases" in the first place.
	 */
	const GROUP_ROW_CAP = 20;
	let expandedGroups = $state<Set<string>>(new Set());
	function groupRows(dayGroup: DayGroup): ActivityGroup<ActivityEntry>[] {
		const groups = releaseGroupsFor(dayGroup);
		if (expandedGroups.has(dayGroup.label)) return groups;
		const hidden = groups.length - GROUP_ROW_CAP;
		const cap = hidden === 1 ? GROUP_ROW_CAP + 1 : GROUP_ROW_CAP;
		return groups.slice(0, cap);
	}
	function expandGroup(label: string) {
		expandedGroups = new Set(expandedGroups).add(label);
	}

	/**
	 * ⭐ "DETAILS" ON EVERY ROW OR NONE (round 4 review, 2026-10-09): row
	 * heights alternated 45/69px because some rows carried an always-open
	 * second line (the `ChangeList` trigger) and others didn't. A group's
	 * own member list AND any member's `ChangeList` both now live behind
	 * ONE row-level "Details" toggle, collapsed by default — every row's
	 * collapsed height is the single-line `ActivitySentence` height, full
	 * stop. A group earns the toggle when it has more than one member (the
	 * environments it reached) or when its one member has a changelist to
	 * show; a row with neither renders no toggle and nothing to expand.
	 */
	let detailsOpen = $state<Set<string>>(new Set());
	function toggleDetails(key: string) {
		const next = new Set(detailsOpen);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		detailsOpen = next;
	}
	function hasChangeList(e: ActivityEntry): boolean {
		return !!(e.source && e.revision && e.previousRevision);
	}
	function groupHasDetails(group: ActivityGroup<ActivityEntry>): boolean {
		return group.members.length > 1 || group.members.some(hasChangeList) || group.members.some((m) => !!deployReason(m.note));
	}

	/**
	 * ⭐ THE REMEMBERED SHAPE. (2026-09-04, load-state audit finding 3 +
	 * "Deliver" section: "activity: day-group count and rows per group".)
	 * `groupedByDay`'s own count and average entries-per-day are unknowable
	 * before the feed answers even once — `SHAPE_KEY` remembers this
	 * fleet's own last-known shape so a later visit's skeleton draws N day
	 * cards at their real average row count instead of the fixed `[3, 5]`
	 * guess a first-ever visit still uses.
	 *
	 * `controlStripHMobile`/`controlStripHDesktop` covers a SEPARATE part
	 * of the same finding: the "ONE CONTROL STRIP" row below (`Today`'s own
	 * +96px drop) is unconditionally rendered — not gated on
	 * `rolloutsQuery.isLoading` — but its OWN height still grows once
	 * `knownEnvs` populates and the env-chip group inserts, so reserving it
	 * at its last-measured height (via the same CSS-custom-property
	 * pattern `BannerSkeleton` uses, never a class override) keeps that
	 * insertion from moving the day groups under it.
	 */
	const SHAPE_KEY = 'activity';
	type ActivityShape = {
		dayGroups: number;
		/**
		 * ⭐ PER-DAY ROW COUNTS, NOT ONE AVERAGE. (2026-09-04, re-check via
		 * `pairtwice.mjs`'s own second-visit measurement) `In the last
		 * hour`/`Today` hold a handful of deploys and `Saturday` can hold
		 * dozens — a single averaged `rowsPerGroup` applied to EVERY day
		 * over-reserves the light days and under-reserves the heavy ones,
		 * and because the days stack top to bottom the error COMPOUNDS:
		 * measured, the first real day (152px) against an averaged 9-row
		 * skeleton (545px) alone pushed every day below it hundreds of
		 * pixels out of place. `ShapeValue` only allows number/boolean/
		 * string — no arrays — so per-day counts are serialised as a
		 * comma-joined string, in the SAME newest-first day order
		 * `groupedByDay` itself produces, and parsed back on read.
		 */
		groupRowCounts: string;
		controlStripHMobile: number;
		controlStripHDesktop: number;
	};
	const shapeHint = recallShape<ActivityShape>(SHAPE_KEY);
	// Capped generously — only bounds a next-visit SKELETON's size, never the real page.
	const skelDayRowCounts: number[] = (shapeHint?.groupRowCounts ?? '')
		.split(',')
		.map((s) => Math.max(1, Math.min(20, parseInt(s, 10) || 1)))
		.filter((n) => Number.isFinite(n))
		.slice(0, 10);
	const skelDayGroups: Array<{ key: number; rows: number }> =
		skelDayRowCounts.length > 0
			? skelDayRowCounts.map((rows, gi) => ({ key: gi, rows }))
			: [
					{ key: 0, rows: 3 },
					{ key: 1, rows: 5 }
				];

	/**
	 * ⭐ THE ROW HEIGHT IS RESPONSIVE TOO. (re-check via `pairtwice.mjs`'s
	 * second-visit measurement) `48` was measured live at desktop width —
	 * at 390 a real row wraps to a second line (env chip + relative time
	 * below the version, not beside it), measured 63–128px per row on the
	 * live feed. A day with many rows compounds a 48px-vs-~100px gap by
	 * its own row count, which is what still pushed `Saturday` (26 rows)
	 * hundreds of pixels out of place even with the per-day COUNT fixed.
	 * `$state`, not a media query, because `rowHeight` is a `CardSkeleton`
	 * NUMBER prop, not a class Tailwind's `sm:` breakpoint can toggle.
	 */
	let skelRowHeight = $state(48);
	$effect(() => {
		const update = () => {
			skelRowHeight = window.innerWidth < 640 ? 100 : 48;
		};
		update();
		window.addEventListener('resize', update);
		return () => window.removeEventListener('resize', update);
	});

	let controlStripEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (rolloutsQuery.isLoading || rolloutsQuery.isError) return;
		const prior = recallShape<ActivityShape>(SHAPE_KEY);
		rememberShape(SHAPE_KEY, {
			dayGroups: groupedByDay.length,
			groupRowCounts: groupedByDay.map((g) => g.entries.length).join(','),
			controlStripHMobile: prior?.controlStripHMobile ?? 0,
			controlStripHDesktop: prior?.controlStripHDesktop ?? 0
		});
	});

	// The control strip's OWN rendered height, measured live — see
	// `SHAPE_KEY`'s note. Runs in the browser only (`$effect` never runs
	// during SSR), independent of `rolloutsQuery.isLoading` since the strip
	// itself always renders.
	$effect(() => {
		if (!controlStripEl) return;
		const el = controlStripEl;
		const measure = () => {
			const h = Math.round(el.getBoundingClientRect().height);
			if (h <= 0) return;
			const mobile = window.innerWidth < 640;
			const prior = recallShape<ActivityShape>(SHAPE_KEY);
			rememberShape(SHAPE_KEY, {
				dayGroups: prior?.dayGroups ?? 2,
				groupRowCounts: prior?.groupRowCounts ?? '3,5',
				controlStripHMobile: mobile ? h : (prior?.controlStripHMobile ?? 0),
				controlStripHDesktop: mobile ? (prior?.controlStripHDesktop ?? 0) : h
			});
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	function isFailed(e: ActivityEntry) {
		return e.bakeStatus === 'Failed';
	}
	function isInFlight(e: ActivityEntry) {
		return isInFlightEntry(e);
	}
	function isRolledBack(e: ActivityEntry) {
		return !!e.rollbackAct;
	}

	/**
	 * THE ANSWER, TAKEN WITHOUT READING A ROW. `12 deploys · all fine`,
	 * `9 deploys · 1 failed`. Green ONLY when every deploy in the set
	 * finished cleanly — the same rule `/apps` applies to its tick.
	 *
	 * ⛔ A ROLLBACK USED TO BE INVISIBLE HERE, THE SAME WAY IT WAS INVISIBLE
	 * ON THE ROW. (2026-09-02) `hello-world-dev/hello-world-app` rolled back
	 * by hand and the group carrying that entry still read `all fine` — a
	 * rollback IS a successful deploy, so it passed every existing test, and
	 * `all fine` is exactly the sentence a reader would act on by NOT
	 * looking closer. It ranks below `failed`/`still going` (both need a
	 * person right now; a rollback that already happened does not) and above
	 * `all fine` (the norm this whole function exists to stop overstating).
	 *
	 * ONE FUNCTION, TWO CALLERS: a day card's rollup and the chart card's
	 * verdict (`windowRollup` below) are the same sentence over two
	 * different sets, so they can never disagree about what "fine" means.
	 *
	 * ⛔ AND NEITHER CALLER MAY STATE `n` AS IF IT WERE THE WHOLE DAY.
	 * (2026-09-03, operator-walk finding 13.) A day group can hold a
	 * `retentionCut` row — the oldest surviving entry of a rollout whose
	 * `versionHistoryLimit` has evicted everything before it. Deploys that
	 * rollout made earlier THAT SAME DAY are gone from the API entirely, not
	 * merely filtered out, so `n` is a FLOOR on that day's real total, not the
	 * total. `at least n` says exactly that; a bare `n` was the sentence that
	 * turned `Monday 5 deploys` into `Monday 4 deploys` overnight with nothing
	 * on the page explaining why the count moved.
	 */
	function groupRollup(entries: ActivityEntry[]) {
		const failedEntries = entries.filter(isFailed);
		const failed = failedEntries.length;
		// ⭐ RESOLVED READS NEUTRAL, NOT ADVERSE (round 8 review, 2026-10-10,
		// same ruling §3.something already applied to the headline KPI tile
		// and the banner — this per-day rollup line was the one place left
		// still painting a calm scenario's resolved-since failure in alarm
		// ink: "colour only where something needs a person").
		const unresolvedFailed = failedEntries.filter((e) => e.isLive).length;
		const flying = entries.filter(isInFlight).length;
		const rolledBack = entries.filter(isRolledBack).length;
		const mayBeIncomplete = entries.some((e) => e.retentionCut);
		const n = entries.length;
		const noun = mayBeIncomplete
			? `at least ${n} deploy${n === 1 ? '' : 's'}`
			: `${n} deploy${n === 1 ? '' : 's'}`;
		// ⭐ NO `good` TONE. (round 2 review, 2026-10-08) `Card`'s rollup CAN
		// spend success green — the rollout Overview's "3/3 healthy" is the
		// reference — but that is ONE card stating ONE verdict. This rollup
		// repeats down every day card AND the chart card above them; a
		// cluster having a calm week would paint five or six green "all
		// fine" headers in one glance, the exact "norm repeated as colour"
		// defect `RestGlyph` exists to stop one level up. A calm fact is
		// `neutral` ink; only a fact that needs a person spends a hue.
		let out: { text: string; tone: 'adverse' | 'active' | 'neutral' };
		if (unresolvedFailed > 0)
			out = { text: `${noun} · ${unresolvedFailed} failed`, tone: 'adverse' };
		else if (failed > 0) out = { text: `${noun} · ${failed} failed, resolved`, tone: 'neutral' };
		else if (flying > 0) out = { text: `${noun} · ${flying} still going`, tone: 'active' };
		else if (rolledBack > 0) out = { text: `${noun} · ${rolledBack} rolled back`, tone: 'neutral' };
		// ⛔ `n > 0 &&`, NOT A BARE `.every()`. (2026-09-03, operator-walk P7)
		// `[].every(...)` is vacuously TRUE — an empty window read `0 deploys ·
		// all fine`, a verdict about zero evidence dressed as good news. This
		// surfaces the moment the chart card renders for an empty filtered
		// set (see the note above `chartServices.length > 0` below), which a
		// widened window control makes reachable for the first time.
		else if (n > 0 && entries.every((e) => e.bakeStatus === 'Succeeded'))
			out = { text: `${noun} · all fine`, tone: 'neutral' };
		else out = { text: noun, tone: 'neutral' };
		// the SectionHeader's rollup parts: the count, then the one adverse fact in its ink (only a live failure is red)
		const rest = out.text.slice(noun.length).replace(/^ · /, '');
		const parts: (string | { text: string; ink?: 'danger' })[] = [noun];
		if (rest) parts.push(out.tone === 'adverse' ? { text: rest, ink: 'danger' } : rest);
		return { ...out, parts, mayBeIncomplete };
	}

	/**
	 * ⛔ THESE THREE COUNTED THE 60-ROW CAP UNDER A BAND THAT COUNTS THE
	 * WINDOW. (2026-09-13) `appCount` below was moved onto `windowed` in the
	 * 2026-09-07 operator walk for exactly this reason and these three were
	 * left behind, so the head band read `149 deploys in the last 30 days ·
	 * 47 rollouts · latest 60 shown · 3 failed` where `3` was the failures
	 * among the SIXTY NEWEST rows and `149` was the window — two subjects in
	 * one sentence, and the chart card's own rollup 200px below (`groupRollup(
	 * windowed)`, uncapped) is the window's. The numbers agreed only while
	 * every failure happened to be recent; a 30-day window over a fixture with
	 * three failures spread across it is exactly the case that breaks it, and
	 * the two objects would then have printed different counts of the same
	 * thing on one screen. Same subject as the band, the chart and the banner
	 * now: the window.
	 *
	 * `Press Failed below to see all N` stays true — pressing `Failed`
	 * re-scopes `windowed` to the failures, and 3 of them fit the 60-row cap.
	 */
	const failures = $derived(windowed.filter(isFailed));
	const failedCount = $derived(failures.length);
	/**
	 * ⭐ "UNRESOLVED" MEANS the failed rollout's CURRENT state is still
	 * failed (round 4 review, 2026-10-09, AD finding: a red banner in the
	 * CALM scenario, naming a failure the fixture had since redeployed
	 * past). `failures` is every failed HISTORY entry in the window — a
	 * permanent record, right for the count/pill/figure, which all answer
	 * "how many failed deploys happened" (a historical fact that does not
	 * un-happen). The BANNER answers a different question — "is something
	 * broken right now" — so it reads only the subset whose failure is also
	 * `isLive` (the rollout's newest entry): a failure three deploys ago
	 * that has since gone green is resolved, and the page says nothing
	 * about it at banner scale.
	 */
	const unresolvedFailures = $derived(failures.filter((e) => e.isLive));
	const unresolvedFailedCount = $derived(unresolvedFailures.length);
	/** The 4th KPI tile (round 7 review, 2026-10-10, AD finding 2: CFR folds
	 *  into the Failed tile's subline, freeing this slot — matching Home's
	 *  own four-tile set, where the fourth tile is a fact the first three
	 *  don't already carry). */
	const rolledBackCount = $derived(windowed.filter(isRolledBack).length);
	/**
	 * ⭐ THE 4TH TILE'S FALLBACK FACT (round 8 review, 2026-10-10): AD asked
	 * for "Held for" (median wait at gates) OR "Rolled back only when > 0,
	 * [something] otherwise". Home's own held-duration computation isn't in
	 * this worktree yet — grepped for a held-since timestamp anywhere in the
	 * rollout/history model this page reads and found none, so a "Held for"
	 * figure here would be invented, not measured. Flagging this to the
	 * lead; in the meantime this tile shows Rolled back when it's non-zero
	 * (the more actionable fact), and falls back to In flight — a count
	 * this page already computes correctly — rather than a fabricated
	 * duration.
	 */
	/** QA #21: in flight is counted in ROLLOUTS (what Home and /rollouts count), not in history rows. */
	const inFlight = $derived(
		inFlightRollouts(
			windowed.filter(isInFlight).map((e) => ({ rolloutKey: `${e.rolloutNamespace}/${e.rolloutName}`, bakeStatus: e.bakeStatus ?? '' }))
		)
	);
	const flyingCount = $derived(inFlight.total);
	/** The In flight tile's own subline — the SAME split the feed's own rows
	 *  already name ("is checking" / "is deploying"), round 9 review,
	 *  2026-10-10: "give In flight a subline". */
	const inFlightSub = $derived.by(() => {
		if (flyingCount === 0) return undefined;
		const checking = inFlight.checking;
		const deploying = inFlight.deploying;
		const parts: string[] = [];
		if (checking > 0) parts.push(`${checking} checking`);
		if (deploying > 0) parts.push(`${deploying} deploying`);
		return parts.length ? parts.join(' · ') : undefined;
	});
	// ⛔ COUNTS THE WINDOW, NOT THE 60-ROW CAP. (operator walk, 2026-09-07) The
	// band said "60 deploys · 16 rollouts" over a chart saying 69 and a home
	// rail saying 69: `feed` is `windowed.slice(0, 60)`.
	const appCount = $derived(
		new Set(windowed.map((e) => `${e.rolloutNamespace}/${e.rolloutName}`)).size
	);

	/**
	 * ⭐ THE PAGE HEADER'S SUMMARY, CAPPED AT THREE FACTS. (round 2 review,
	 * 2026-10-08) `§3.2`: a `PageHeader` list summary carries at most three
	 * facts, the adverse one in its ink — this used to print up to five
	 * ("… in all time · 50 rollouts with activity · latest 60 shown · 3
	 * still going · 1 rolled back"), wrapping to two lines at 390.
	 * `appCount` ("N rollouts with activity") moved to the rail's own
	 * `Deploys` row (it is already a window-scoped count, the rail's whole
	 * subject); `latest N shown` moved to a quiet fold line at the end of
	 * the list, where a reader who has scrolled that far is the one who
	 * needs it. What is left is the base fact (deploys in the window) plus
	 * up to two STATE facts, worst first — failed, then still going, then
	 * rolled back — so a calm week prints one fact and a bad one prints
	 * three, never five.
	 */
	/**
	 * ⭐ ADVERSE FIRST, AND `failed` IS BACK (round 4 review, 2026-10-09):
	 * "The header summary is adverse first: '1 failed · 4 in flight · 1
	 * rolled back'." Round 5's old reasoning — the banner already states it
	 * — no longer holds now that the headline figure (below) is ALSO the
	 * outcome, not the volume; the header summary is the one place a reader
	 * gets the full adverse picture in one line without reading the figure,
	 * the banner AND the pills. The banner's own sentence still carries the
	 * NAMED detail (which app, which env); this is the count.
	 */
	/**
	 * ⭐ SCOPE, NOT COUNTS (round 6 review, 2026-10-09: "drop counts, keep
	 * scope"). Failed/Deploys/flying/rolled-back counts all now live in the
	 * KPI head or the filter pills — restating them here was the "169
	 * appears three times" problem again, one level up. The header states
	 * only WHERE the page is looking ("last 30 days · 58 rollouts") plus,
	 * when something actually needs a person, ONE adverse sentence in
	 * danger ink — never a list of three counts.
	 */
	const summaryScope = $derived(
		`${rangeLabel}${appCount > 0 ? ` · ${appCount} rollout${appCount === 1 ? '' : 's'}` : ''}`
	);

	/**
	 * ⭐ THE CHART CARD'S HEADLINE FIGURE (round 2 review, 2026-10-09): the
	 * window's own deploy count, failures in danger ink, against the SAME
	 * duration immediately before it — `windowDeltaPct` null for `all`
	 * (nothing to compare an unbounded window to) and when the previous
	 * window is empty (a `+∞%` claim is not a fact).
	 */
	const windowSpanMs = $derived(timelineRange === 'all' ? null : RANGE_MS[timelineRange]);
	const previousWindowCount = $derived.by<number | null>(() => {
		const span = windowSpanMs;
		if (!span) return null;
		const end = Date.now() - span;
		const start = end - span;
		return scoped.filter((e) => {
			const t = new Date(e.timestamp).getTime();
			return t >= start && t < end;
		}).length;
	});
	const windowDeltaPct = $derived.by<number | null>(() => {
		if (previousWindowCount === null || previousWindowCount === 0) return null;
		return Math.round(((windowed.length - previousWindowCount) / previousWindowCount) * 100);
	});
	/** The Deploys tile's own delta, Home's form ("↑ 7.7×" / "↑ 12%"), always
	 *  neutral ink — more or fewer deploys is not itself good or bad. */
	/** "vs 3" names what it's against (round 7 review, 2026-10-10, AD
	 *  nitpick: "'vs 3' at 30d has no noun") — the SAME span the chart's own
	 *  ghost bars are drawn against, in Home's "the 7 days before" words. */
	const previousSpanNoun: Record<PresetRange, string> = {
		'1h': 'the hour before',
		'6h': 'the 6 hours before',
		'1d': 'the day before',
		'7d': 'the 7 days before',
		'30d': 'the 30 days before',
		all: ''
	};
	const deploysDelta = $derived.by<KpiDelta | null>(() => {
		if (windowDeltaPct === null || previousWindowCount === null) return null;
		const dir: 'up' | 'down' = windowDeltaPct >= 0 ? 'up' : 'down';
		const noun = previousSpanNoun[timelineRange];
		if (previousWindowCount < 5) {
			const text = noun ? `vs ${previousWindowCount} ${noun}` : `vs ${previousWindowCount}`;
			return { text, tone: 'neutral', dir };
		}
		if (Math.abs(windowDeltaPct) > 300) {
			const mult = Math.round((windowed.length / previousWindowCount) * 10) / 10;
			return { text: `${mult}×`, tone: 'neutral', dir };
		}
		return { text: `${Math.abs(windowDeltaPct)}%`, tone: 'neutral', dir };
	});
	/**
	 * ⭐ WHAT THE CHART DOESN'T SHOW (round 4 review, 2026-10-09, "one fact,
	 * once"): the rail used to repeat the filter pills' own Failed/In
	 * flight/Rolled back counts — deleted, since the pills already state
	 * them. In their place, figures nothing else on the page answers:
	 *
	 * - MEDIAN TIME TO PROD: for each (app, release) pair that reached a
	 *   prod-tier environment inside the window, the gap between its
	 *   EARLIEST deploy anywhere and its earliest prod deploy; the median
	 *   across those releases. `null` when nothing in the window reached
	 *   prod — the dt/dd pair is omitted rather than claiming "0s".
	 * - CHANGE FAILURE RATE: failed deploys as a share of all deploys in
	 *   the window (the DORA metric by the same name) — folded into the
	 *   Failed tile's own subline now (round 7, below), not a standalone
	 *   tile — see `failedSub`'s doc comment.
	 */
	/** Pure logic + the "never print 0 seconds" rule both live in
	 *  `$lib/view-models/activity-time-to-prod` now, tested in isolation. */
	const medianTimeToProdMs = $derived(
		medianTimeToProdMsOf(
			windowed.map((e) => ({
				releaseKey: `${e.displayName}::${e.version}`,
				timestampMs: new Date(e.timestamp).getTime(),
				isProd: tierOf(e.envKey || e.envLabel) === 'prod'
			}))
		)
	);
	/** `KpiTile`'s own `parts` shape ("4h 15m", Home's unit typography) —
	 *  `formatDurationMs`'s single spelled-out unit ("8 hours") was a
	 *  different grammar for the same fact (round 7 review, 2026-10-10, AD
	 *  finding 3: "'8 hours' vs Home's '4h 15m'"). Minutes only below an
	 *  hour, hours+minutes below a day, days+hours beyond. */
	function durationParts(ms: number): { v: string; u: string }[] {
		const totalMin = Math.round(ms / 60_000);
		if (totalMin < 60) return [{ v: `${totalMin}`, u: 'm' }];
		const totalHr = Math.floor(totalMin / 60);
		const min = totalMin % 60;
		if (totalHr < 24) return min > 0 ? [{ v: `${totalHr}`, u: 'h' }, { v: `${min}`, u: 'm' }] : [{ v: `${totalHr}`, u: 'h' }];
		const days = Math.floor(totalHr / 24);
		const hr = totalHr % 24;
		return hr > 0 ? [{ v: `${days}`, u: 'd' }, { v: `${hr}`, u: 'h' }] : [{ v: `${days}`, u: 'd' }];
	}
	const medianTimeToProdParts = $derived(
		medianTimeToProdMs !== null ? durationParts(medianTimeToProdMs) : null
	);
	/** Apps counted in `medianTimeToProdMs` — the same release set, just
	 *  counted by app instead of reduced to a median, for the tile's own
	 *  "median trip · N apps" subline (Home's exact grammar). */
	const appsToProdCount = $derived(
		new Set(
			windowed
				.filter((e) => tierOf(e.envKey || e.envLabel) === 'prod')
				.map((e) => e.displayName)
		).size
	);
	/** One decimal, like Home's own CFR tile ("1.2%"), not a rounded integer. */
	const changeFailureRatePct = $derived.by<number | null>(() => {
		if (windowed.length === 0) return null;
		return Math.round((failedCount / windowed.length) * 1000) / 10;
	});
	/**
	 * ⭐ CFR FOLDS INTO THE FAILED TILE'S SUBLINE, HOME'S OWN GRAMMAR (round 7
	 * review, 2026-10-10, AD finding 2: "two red 32px figures for one fact" —
	 * CFR painted danger even in the calm scenario's 0.8%, alarming over a
	 * healthy rate. Home never gives CFR its own tile; it is the Failed
	 * tile's caption, "1.2% of deploys · last 7 days", always neutral ink
	 * (the figure already carries the alarm). `resolved` detail folds in
	 * alongside it rather than replacing it — the figure's own `resolved`
	 * prop (below) handles the "resolved" word and the ink; this only adds
	 * the unresolved COUNT when it's a partial one. */
	/** ⭐ ONE FACT, NEVER THE WINDOW (round 8 review, 2026-10-10): the header
	 *  already states the range ("the last 30 days") — repeating it on every
	 *  tile's own subline was the SAME fact four times, just smaller. Partial
	 *  unresolved is the more urgent fact when it's true (someone needs to
	 *  look at exactly those N); CFR otherwise, the tile's steady-state
	 *  caption. */
	const failedSub = $derived.by(() => {
		if (unresolvedFailedCount > 0 && unresolvedFailedCount !== failedCount) {
			return `${unresolvedFailedCount} of ${failedCount} unresolved`;
		}
		return changeFailureRatePct !== null ? `${changeFailureRatePct}% of deploys` : undefined;
	});
	/** The Deploys section's rollup: the window's count, then the one adverse fact in its ink (only an unresolved failure is red). */
	const deploysRollup = $derived<(string | { text: string; ink?: 'danger' })[]>([
		`${windowed.length} deploy${windowed.length === 1 ? '' : 's'}`,
		...(unresolvedFailedCount > 0 ? [{ text: `${unresolvedFailedCount} failing`, ink: 'danger' as const }] : [])
	]);
	/** Deploys tile subline — a rate, not the range (round 8). */
	/** ⭐ NOT A TAUTOLOGY AT 1D (round 9 review, 2026-10-10): "103 a day" at
	 *  the 1d range IS the figure above it restated, since the window and
	 *  the rate denominator are the same day. Below a day of span this
	 *  switches to an HOURLY rate instead — a genuinely different number
	 *  from the headline count at every range short enough for the daily
	 *  one to degenerate into it. */
	const deploysPerDaySub = $derived.by(() => {
		return deployRateSub(windowed.length, windowSpanMs, oldestScopedMs, Date.now());
	});

	/**
	 * ⭐ THE RAIL'S "MOST ACTIVE" LIST — top APPS by event count in the SAME
	 * scoped-and-windowed set `windowRollup` answers for (round 6 review,
	 * 2026-10-09: "repeats the app once per environment" — `checkout-worker`
	 * showed up to three times, once per env, burying the actual ranking).
	 * Grouped by app now; the envs it fired in join inline on the same row
	 * ("staging, prod"), newest/most-active env first. Over the window, not
	 * the 60-row `feed` cap, for the same reason `failedCount`/`flyingCount`/
	 * `appCount` read `windowed`. Capped at 5 — a rail card, not a second feed.
	 */
	const mostActive = $derived.by(() => {
		const apps = new Map<
			string,
			{ name: string; href: string; count: number; envs: Set<string> }
		>();
		for (const e of windowed) {
			// ⭐ APP, NOT ROLLOUT CR (round 6 fix, 2026-10-10): this product
			// names one Rollout CR per environment ("checkout-edge" in the
			// dev/staging/prod namespaces are THREE objects sharing one
			// `displayName`) — grouping by `${namespace}/${rolloutName}` was
			// still one row per env, the exact bug this round set out to
			// fix. `displayName` alone is the app's shared identity.
			const key = e.displayName;
			let cur = apps.get(key);
			if (!cur) {
				cur = { name: e.displayName, href: e.href, count: 0, envs: new Set() };
				apps.set(key, cur);
			}
			cur.count++;
			if (e.envLabel) cur.envs.add(e.envLabel);
		}
		return [...apps.values()]
			.sort((a, b) => b.count - a.count)
			.slice(0, 5)
			.map((a) => ({
				name: a.name,
				href: a.href,
				count: a.count,
				// ⭐ TIER-COLLAPSED, SAME GRAMMAR AS THE FEED'S OWN GROUP ROWS
				// (`groupActivityEntries`'s `envText`, round 6 fix: the
				// `wide` scenario's 13-region app overflowed this row and
				// overlapped the count when every label was joined raw).
				// 3+ envs in a tier collapse to "N prod regions"; fewer list
				// by name.
				envLabel: tierCountText(a.envs)
			}));
	});
	/** ⭐ A TIER COUNT, NOT A LIST AT ALL (round 8 review, 2026-10-10): round
	 *  7's tier-collapsed join ("dev · staging · 5 prod") still truncated at
	 *  the rail's own 280px width once a few tiers were in play — any list
	 *  long enough to be interesting is also long enough to ellipsize in a
	 *  sidebar. "N tiers" never wraps or truncates at any width and still
	 *  answers the only question this row needs to: how WIDE did this app's
	 *  activity spread, not which exact regions. */
	function tierCountText(envs: Set<string>): string {
		const tiers = new Set<Tier>();
		for (const label of envs) tiers.add(tierOf(label));
		return `${tiers.size} tier${tiers.size === 1 ? '' : 's'}`;
	}

	// ── THE PAGE'S ONE BLOCKING FACT ───────────────────────────────────────
	// A deploy that failed will not clear itself. Nothing else on this page
	// qualifies: a deploy in flight resolves on its own, and a succeeded one
	// is the norm.
	/**
	 * ⭐ THE HEADLINE SAID THREE AND THE BODY NAMED ONE. (2026-09-13)
	 *
	 * `3 deploys failed` over `checkout-worker in staging failed 10 minutes
	 * ago, on a02f1c4.` is the loudest object on the page disagreeing with
	 * itself: a reader who trusts the count then has to go and find the other
	 * two, and the only pointer they got was a footnote telling them to press
	 * a filter — *"showing a problem without offering the action is an
	 * unfinished design"*, answered with an instruction. All of them are named
	 * and linked now, newest first, each one its own destination.
	 *
	 * THREE IS THE CAP, and it is not arbitrary: a banner is the page's ONE
	 * blocking fact, not its list, and three short items still fit one line at
	 * 1440. Past three the count is the fact and the footnote's `Press Failed`
	 * is the right answer again — so that sentence survives, scoped to the
	 * case it is actually true of.
	 */
	const NAMED_FAILURES = 3;
	const blocker = $derived.by(() => {
		const worst = unresolvedFailures[0];
		if (!worst) return null;
		const where = worst.envLabel ? ` in ${worst.envLabel}` : '';
		/**
		 * ⭐ ONE SENTENCE, EVEN FOR MANY FAILURES (round 4 review, 2026-10-09,
		 * §3.12). This used to leave `message` empty past one failure and
		 * print the set as an always-visible `messageBody` list instead — a
		 * banner with three styled rows, links and all, which is a LIST at
		 * banner scale, not a sentence. §3.12 is explicit: one sentence
		 * printed, the rest under `Details`. The subjects (up to
		 * `NAMED_FAILURES`, "and N more" past that) now join into the ONE
		 * message sentence; the per-item list with its links/sha/time moves
		 * into `footnoteBody`, disclosed — same split `FailurePanel` already
		 * uses for its own per-check list.
		 */
		const multiSubjects = unresolvedFailures.slice(0, NAMED_FAILURES).map((e) => {
			const place = e.envLabel ? ` in ${e.envLabel}` : '';
			return `${e.displayName}${place}`;
		});
		const multiMore =
			unresolvedFailedCount > NAMED_FAILURES
				? `, and ${unresolvedFailedCount - NAMED_FAILURES} more`
				: '';
		return {
			title:
				unresolvedFailedCount === 1 ? 'A deploy failed' : `${unresolvedFailedCount} deploys failed`,
			/**
			 * ONE failure keeps the printed sentence, unchanged — a banner with
			 * a single subject reads as prose, not as a list of one.
			 */
			// ⭐ THE BODY DOESN'T RESTATE THE HEADLINE (round 7 review,
			// 2026-10-10, AD nitpick: the wide scenario's body read "2
			// deploys failed: checkout-worker in staging, ..." directly
			// under a title that already says "2 deploys failed" — the
			// same four words twice in two lines. The title states the
			// COUNT; the body just names WHO, without re-counting.
			message:
				unresolvedFailedCount === 1
					? `${worst.displayName}${where} failed ${formatTimeAgo(worst.timestamp, $now)}, on ${worst.version}.`
					: `${multiSubjects.join(', ')}${multiMore}.`,
			/** The disclosed set: `footnoteBody`'s own list, below — never
			    printed at banner scale past one failure. */
			list:
				unresolvedFailedCount === 1
					? []
					: unresolvedFailures.slice(0, NAMED_FAILURES).map((e) => {
							/**
							 * ⚠️ THE PLACE AND THE CLOCK ARE ONE STRING, BUILT HERE, IN
							 * TWO STEPS.
							 *
							 * ONE string because Svelte trims literal whitespace at a
							 * block's edge: `{#if f.env}<span> in {f.env}</span>{/if}`
							 * rendered `checkout-workerin staging` on the live page —
							 * the identical trap this file's head band already carries
							 * a note about. A string an expression returns is not
							 * template whitespace and survives.
							 *
							 * TWO steps because `lib/messages/scan.ts` cannot read a
							 * NESTED template literal: spelled inline, the census came
							 * back holding `${e.envLabel ?` and `: ''} · … ago` — two
							 * entries nobody can read, for a message that does not
							 * exist. `lib/CLAUDE.md` states the rule ("Build the parts
							 * first"); this is it being followed.
							 */
							const place = e.envLabel ? ` in ${e.envLabel}` : '';
							const ago = formatTimeAgoCompact(e.timestamp, $now);
							return {
								key: entryKey(e),
								app: e.displayName,
								meta: `${place} · ${ago} ago`,
								sha: shortenVersion(e.version),
								shaTitle: e.version,
								href: e.href
							};
						}),
			footnote:
				unresolvedFailedCount > NAMED_FAILURES
					? `Press Failed below to see all ${unresolvedFailedCount}.`
					: undefined,
			href: worst.href,
			app: worst.displayName,
			/**
			 * ⭐ THE BANNER CARRIES THE RELATIVE VERSION TOO, and only when it
			 * can. The message names the sha the deploy failed ON; what it did
			 * not say is where that leaves the place — `newest` (the failure is
			 * the head, nothing newer to try) reads completely differently from
			 * `12 behind` (the environment has been stuck behind this for a
			 * while). `null` on a superseded row, because the failed deploy is
			 * then not what is running and a rank on it would be a claim about
			 * a build. Same fence as the feed.
			 */
			entry: worst.isLive ? worst : null
		};
	});

	/** `ActivitySentence`'s `kind` for a GROUPED row — `$lib/view-models/
	 *  activity-kind`'s `activityKindOf`, the one classifier shared with
	 *  Home/ActivityRail and the fleet pages (squad-fleet), so "promoted"
	 *  vs "deployed" is decided once, not re-derived per page. No local
	 *  bakeStatus→kind mapping here any more. Its own worst member's state
	 *  (bakeStatus) and "did any member roll back" (a group can have a
	 *  rollback in one environment and plain successes in the rest; the
	 *  group still says so), keyed on the lead member's environment. */
	function activityKindForGroup(group: ActivityGroup<ActivityEntry>, actor: Actor): ActivityKind {
		const lead = group.members[0];
		const envRank = getEnvironmentRank(lead.envKey || lead.envLabel);
		return activityKindOf({
			bakeStatus: group.worstBakeStatus,
			bakeStatusMessage: group.worstBakeStatusMessage,
			isRollback: group.members.some((m) => m.rollbackAct),
			actorKind: actor.kind,
			envRank,
			firstEnvRank: firstEnvRankByApp.get(group.displayName) ?? envRank
		});
	}
</script>

<svelte:head>
	<title>{pageTitle('Activity')}</title>
</svelte:head>

<!-- THE BANNER'S FAILURE LIST, DISCLOSED NOT PRINTED (kept from round 4): only reachable under `Details`; the AlertPanel's own ink, no colour spelled here. -->
{#snippet failureFootnote()}
	<ul class="list-disc space-y-0.5 pl-4">
		{#each blocker?.list ?? [] as f (f.key)}
			<li class="break-words">
				<!-- `text-fg-muted`, not `opacity-80` (round 5 review,
				     2026-10-09): measured 4.44:1 in light, under 4.5:1. A
				     token ink clears the floor in both themes; a flat alpha
				     over whatever's behind it does not. -->
				<a href={f.href} class="hit-32 text-fg underline-offset-2 hover:underline">{f.app}</a
				><span class="text-fg-muted">{f.meta}</span><span
					class="t-code-sm ml-1.5 text-fg-muted"
					title={f.shaTitle}>{f.sha}</span
				>
			</li>
		{/each}
	</ul>
	{#if blocker?.footnote}
		<p class="mt-1">{blocker.footnote}</p>
	{/if}
{/snippet}

{#snippet rangeControl(cls: string)}
	<!-- ONE window control, single-select, in the first section header's action slot (controls sit on a section header's right).
	     It governs the chart, the KPIs, the rail and the feed. `.btn.btn-ghost.btn-xs` + `aria-pressed`, as before. -->
	<div class="items-center gap-0.5 {cls}" role="group" aria-label="Time range">
		{#each CHART_RANGES as r (r.value)}
			<button
				type="button"
				class="btn btn-ghost btn-xs {cls.includes('grid') ? 'justify-center' : ''}"
				disabled={allEntries.length === 0}
				aria-pressed={timelineRange === r.value}
				onclick={() => {
					rangeTouched = true;
					timelineRange = r.value;
				}}>{r.label}</button
			>
		{/each}
	</div>
{/snippet}

{#snippet dayRowDetails(group: ActivityGroup<ActivityEntry>)}
	<ul class="space-y-2">
		{#each group.members as entry (entry.key)}
			<li>
				<a href={entry.href} class="t-ui-sm nav-link">{entry.envLabel || entry.envKey}</a>
				<span class="t-meta ml-2 text-fg-subtle">{clockOf(entry.timestamp)}</span>
				{#if deployReason(entry.note)}
					<p class="t-meta mt-1 text-fg-muted" data-deploy-reason><span class="text-fg-subtle">Reason</span> {deployReason(entry.note)}</p>
				{/if}
				{#if entry.source && entry.revision && entry.previousRevision}
					<div class="mt-1">
						<ChangeList
							namespace={entry.rolloutNamespace}
							name={entry.rolloutName}
							cluster={entry.cluster}
							base={entry.previousRevision}
							head={entry.revision}
							source={entry.source}
							note={entry.note}
							actor={entry.actor}
							actorKind={entry.actorKind}
						/>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<!-- /activity, detail pass (2026-11-08): the page template the list pages use. No page title and no headline count (LANGUAGE §1): alert band
     (the failed deploys in the window, AlertPanel as on /changes) → Deploys (section header + the KPI/chart card; the window control sits on the
     header's right) → the feed, one section per day (SectionHeader + ONE list card of FeedRows) with the filter chips above it → on ≥1024 the
     tab's 3fr / minmax(22rem, 2fr) split with "This window" in the side column. Full width, no max-w. -->
<div class="w-full px-4 py-6 sm:px-6" data-page="activity">
	<h1 class="sr-only">Activity</h1>
	<div class="flex min-w-0 flex-col gap-8">
		{#if blocker}
			<AlertPanel
				severity="error"
				title={blocker.title}
				message={blocker.message}
				footnoteLabel="Details"
				footnoteBody={blocker.list.length > 0 ? failureFootnote : undefined}
				dataTour="deploys-failed"
				class=""
			>
				{#snippet actions()}
					<a href={blocker.href} class="btn btn-secondary" data-action="open">Open rollout ›</a>
				{/snippet}
			</AlertPanel>
		{/if}

		<div class="flex min-w-0 flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)] lg:items-start lg:gap-x-6">
			<div class="flex min-w-0 flex-col gap-8">
				<!-- ══ DEPLOYS ═════════════════════════════════════════════════════ -->
				{#if rolloutsQuery.isLoading}
					<section aria-hidden="true">
						<div class="flex h-8 items-center gap-2"><SkeletonBar width="w-4" height="h-4" /><SkeletonBar width="w-20" height="h-4" /></div>
						<div class="skel-card mt-3 hidden h-[330px] rounded-md border border-line bg-surface sm:block"></div>
						<div class="skel-card mt-3 h-[470px] rounded-md border border-line bg-surface sm:hidden"></div>
					</section>
				{:else if allEntries.length > 0}
					<section id="deploys" data-section="deploys" data-tour="activity-chart">
						<SectionHeader title="Deploys" icon={ChartOutline} rollup={deploysRollup}>
							{#snippet action()}{@render rangeControl('hidden sm:flex')}{/snippet}
						</SectionHeader>
						<div class="act-chart rounded-md border border-line bg-surface p-4 lg:px-3.5">
							<!-- KPI head: Home's KpiTile, flat inside the card. Phone: a 2×2 grid (every figure at full size, none clipped);
							     ≥640: one row of four with hairline dividers. -->
							<!-- phone: the window control leaves the header (it would squeeze the rollup out) and sits as six equal buttons at the top of the card -->
							{@render rangeControl('mb-4 grid grid-cols-6 sm:hidden')}
							<div class="act-kpis mb-4" role="group" aria-label="Deploy stats">
								<div class="min-w-0 pr-4">
									<KpiTile
										icon={ExclamationCircleSolid}
										iconClass={unresolvedFailedCount > 0 ? 'text-danger' : 'text-fg-subtle'}
										label="Failed"
										value={failedCount}
										valueClass={unresolvedFailedCount > 0 ? 'text-danger' : 'text-fg'}
										resolved={failedCount > 0 && unresolvedFailedCount === 0}
										sub={failedSub}
										href={failedCount > 0 ? '?kind=failed' : undefined}
									/>
								</div>
								<div class="min-w-0 border-l border-line-subtle pl-4 sm:px-4">
									<KpiTile icon={RocketSolid} label="Deploys" value={windowed.length} delta={deploysDelta} sub={deploysPerDaySub} />
								</div>
								<div class="min-w-0 pr-4 sm:border-l sm:border-line-subtle sm:px-4">
									<KpiTile
										icon={ClockOutline}
										label="Median to prod"
										parts={medianTimeToProdParts ?? undefined}
										value={medianTimeToProdParts ? undefined : '—'}
										sub={medianTimeToProdParts ? `${appsToProdCount} app${appsToProdCount === 1 ? '' : 's'}` : undefined}
									/>
								</div>
								<div class="min-w-0 border-l border-line-subtle pl-4">
									{#if rolledBackCount > 0}
										<KpiTile icon={UndoOutline} label="Rolled back" value={rolledBackCount} valueClass="text-fg" />
									{:else}
										<KpiTile icon={ArrowsRepeatOutline} label="In flight" value={flyingCount} sub={inFlightSub} />
									{/if}
								</div>
							</div>
							<DeployBars
								buckets={volumeBuckets}
								previous={previousVolumeBuckets}
								previousLabel={previousSpanNoun[timelineRange] || 'the period before'}
								emphasisLabel="Reached prod"
								observedFromMs={oldestScopedMs}
								markers={chartMarkers}
								startMs={chartWindow.start}
								endMs={chartWindow.end}
								selected={selectedBucket}
								onBucketClick={handleBucketClick}
								ariaLabel="Deploy volume — one bar per time bucket, newest to the right"
							/>
							<div class="mt-3 flex justify-end">
								<DeployLegend
									buckets={volumeBuckets}
									previous={previousVolumeBuckets}
									previousLabel={previousSpanNoun[timelineRange] || 'the period before'}
								/>
							</div>
						</div>
					</section>
				{/if}

				<!-- ══ FEED ════════════════════════════════════════════════════════ -->
				<div class="min-w-0">
					<div
						bind:this={controlStripEl}
						class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2"
						style="--activity-strip-min-h: {shapeHint?.controlStripHMobile ?? 0}px; --activity-strip-min-h-sm: {shapeHint?.controlStripHDesktop ?? 0}px"
						data-activity-strip
					>
						<div class="flex min-w-0 flex-wrap items-center gap-1.5">
							<div class="flex shrink-0 items-center gap-1.5">
								{#each KIND_FILTERS.filter((f) => kindCounts[f.key] > 0 || kindFilter === f.key) as f (f.key)}
									<!-- the failed dot is danger only while a failure is unresolved: colour only where something needs a person -->
									<FilterChip selected={kindFilter === f.key} title={f.title} onclick={() => setKindFilter(f.key)} dot={f.key === 'failed' && unresolvedFailedCount === 0 ? 'bg-fg-subtle' : f.dot} label={f.label} count={kindCounts[f.key]} />
								{/each}
							</div>
							<div class="flex shrink-0 items-center gap-1.5">
								{#each TIER_FILTERS.filter((t) => tierCounts[t.key] > 0 || tierFilter === t.key) as t (t.key)}
									<FilterChip selected={tierFilter === t.key} title={tierFilter === t.key ? `Stop showing only ${t.label}` : `Show only ${t.label}`} onclick={() => setTierFilter(t.key)} label={t.label} count={tierCounts[t.key]} />
								{/each}
							</div>
							{#if selectedBucket}
								<div class="flex shrink-0 items-center">
									<FilterChip removable title="Stop showing only {selectedBucketLabel}" onclick={clearBucketSelection} label={selectedBucketLabel} />
								</div>
							{/if}
						</div>
					</div>

					{#if envFilter || appFilter || nsFilter}
						<div class="mb-4 flex flex-wrap items-center gap-x-2 gap-y-3">
							<span class="t-meta text-fg-subtle">Showing only:</span>
							{#if envFilter}
								<FilterChip removable title="Stop showing only {envFilterLabel}" onclick={() => setParam('env', null)}>env <span class="t-code-sm">{envFilterLabel}</span></FilterChip>
							{/if}
							{#if appFilter}
								<FilterChip removable title="Stop showing only {appFilter}" onclick={() => setParam('app', null)}>rollout <span class="t-code-sm">{appFilter}</span></FilterChip>
							{/if}
							{#if nsFilter}
								<FilterChip removable title="Stop showing only {nsFilter}" onclick={() => setParam('ns', null)}>namespace <span class="t-code-sm">{nsFilter}</span></FilterChip>
							{/if}
							{#if activeFilterCount >= 2}
								<button type="button" onclick={clearAllFilters} class="pill-btn t-meta ml-1 text-fg-subtle underline-offset-2 hover:text-fg hover:underline">Clear all</button>
							{/if}
						</div>
					{/if}

					<!-- The hub fails soft: a spoke that did not answer is absent from every count here, and absent is not healthy. -->
					<PartialDataNotice
						errors={rolloutsQuery.data?.clusterErrors ?? []}
						subject="this feed"
						onRetry={() => rolloutsQuery.refetch()}
						isRetrying={rolloutsQuery.isFetching}
					/>

					{#if rolloutsQuery.isLoading}
						<StillTryingNotice failureCount={rolloutsQuery.failureCount} />
						<!-- reserved at the loaded geometry: a 32px section header over a list card of 48px rows (per-day counts remembered from the last visit) -->
						<div class="flex flex-col gap-8" aria-hidden="true">
							{#each skelDayGroups as g (g.key)}
								<section>
									<div class="flex h-8 items-center gap-2"><SkeletonBar width="w-4" height="h-4" /><SkeletonBar width="w-24" height="h-4" /></div>
									<div class="skel-card mt-3 rounded-md border border-line bg-surface" style="height: {g.rows * skelRowHeight}px"></div>
								</section>
							{/each}
						</div>
					{:else if rolloutsQuery.isError}
						<!-- an empty feed is the most dangerous blank in the product: a failed request must say so in words, not read as a quiet night -->
						<ErrorState
							error={rolloutsQuery.error}
							subject="the activity feed"
							backHref="/"
							backLabel="Go to Home"
							onRetry={() => rolloutsQuery.refetch()}
							isRetrying={rolloutsQuery.isFetching}
							class="py-2"
						/>
					{:else if feed.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<!-- `ClockOutline`, not `ClockSolid` (round 6 review): §3.15's
			     empty state is a structural glyph, not a status disc. -->
			<ClockOutline class="mb-3 h-10 w-10 text-fg-disabled" />
			{#if activeFilterCount > 0 || kindFilter !== 'all' || selectedBucket || allEntries.length > 0}
				<!-- ⛔ `allEntries.length > 0` ADDED TO THE GATE (round 2 review,
				     2026-10-09). The range default is now a FIXED `7d`
				     (previously fit-to-data — see `timelineRange`'s own note),
				     so a fleet whose newest deploy is 8+ days old shows an
				     empty window with NO filter active — this branch used to
				     require one, so that case fell to "Nothing has deployed
				     yet" below, which is false: the fleet has history, just
				     not inside this window. -->
				<p class="t-ui text-fg">
					{allEntries.length > 0 && activeFilterCount === 0 && kindFilter === 'all' && !selectedBucket
						? 'Nothing in this window'
						: 'Nothing matches these filters'}
				</p>
				<!-- ⛔ "WIDEN THE WINDOW ABOVE" NAMED A CONTROL THAT COULD BE
				     ENTIRELY OFF SCREEN. (2026-09-03, operator-walk P7) With
				     `?kind=failed&env=prod` on a cluster with no failed prod
				     deploys, `chartServices` (env/app/ns/kind scoped, no time
				     window) was empty too, so the whole chart card — the ONLY
				     copy of the window buttons — did not render. The card's own
				     gate is fixed (`allEntries.length > 0`, above), but a bare
				     "clear the filters" button was still the wrong ACTION: it
				     also drops `env=prod`, which the reader never asked to
				     remove — they asked about prod, specifically, and got told
				     there is nothing to see under that scope at all. Each active
				     dimension gets its own button now, so clearing one preserves
				     the rest; `Widen to 30 days` is offered beside them because a
				     narrow window is the OTHER thing that can cause this, and
				     there is no way to tell which from here without just
				     trying it. -->
				<p class="t-meta mt-1 text-fg-subtle">
					Try widening the window, or clearing one filter at a time.
				</p>
				<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
					{#if timelineRange !== '30d' && timelineRange !== 'all'}
						<button
							type="button"
							onclick={() => {
								rangeTouched = true;
								timelineRange = '30d';
							}}
							class="btn btn-secondary">Widen to 30 days</button
						>
					{/if}
					{#if timelineRange !== 'all'}
						<button
							type="button"
							onclick={() => {
								rangeTouched = true;
								timelineRange = 'all';
							}}
							class="btn btn-secondary">Widen to all time</button
						>
					{/if}
					{#if kindFilter !== 'all'}
						<button type="button" onclick={() => setKindFilter('all')} class="btn btn-secondary"
							>Clear “{KIND_FILTERS.find((f) => f.key === kindFilter)?.label}”</button
						>
					{/if}
					{#if selectedBucket}
						<button type="button" onclick={clearBucketSelection} class="btn btn-secondary"
							>Clear “{selectedBucketLabel}”</button
						>
					{/if}
					{#if tierFilter}
						<button
							type="button"
							onclick={() => setParam('tier', null)}
							class="btn btn-secondary">Clear “{tierFilter}”</button
						>
					{/if}
					{#if envFilter}
						<button
							type="button"
							onclick={() => setParam('env', null)}
							class="btn btn-secondary">Clear “{envFilterLabel}”</button
						>
					{/if}
					{#if appFilter}
						<button
							type="button"
							onclick={() => setParam('app', null)}
							class="btn btn-secondary">Clear “{appFilter}”</button
						>
					{/if}
					{#if nsFilter}
						<button type="button" onclick={() => setParam('ns', null)} class="btn btn-secondary"
							>Clear “{nsFilter}”</button
						>
					{/if}
					{#if activeFilterCount + (kindFilter !== 'all' ? 1 : 0) + (selectedBucket ? 1 : 0) > 1}
						<button type="button" onclick={clearAllFilters} class="btn btn-secondary"
							>Clear all filters</button
						>
					{/if}
				</div>
			{:else}
				<p class="t-ui text-fg">Nothing has deployed yet</p>
				<p class="t-meta mt-1 max-w-sm text-fg-subtle">
					Every version a rollout puts live shows up here, newest first.
				</p>
			{/if}
		</div>
					{:else}
						<div class="flex flex-col gap-8">
							{#each groupedByDay as dayGroup (dayGroup.label)}
								{@const rollup = groupRollup(dayGroup.entries)}
								{@const allGroups = releaseGroupsFor(dayGroup)}
								{@const rows = groupRows(dayGroup)}
								<section data-section="day" data-day={dayGroup.label}>
									<SectionHeader
										title={dayGroup.label}
										icon={dayGroup.label === 'In the last hour' ? ClockOutline : CalendarMonthOutline}
										rollup={rollup.parts}
									/>
									<ListCard>
										<ul class="lc-rows">
											{#each rows as group (group.key)}
												{@const lead = group.members[0]}
												{@const actor = actorFrom({ kind: lead.actorKind, name: lead.actor })}
												{@const kind = activityKindForGroup(group, actor)}
												{@const vb = activityVerb(kind)}
												{@const single = group.members.length === 1}
												<FeedRow
													app={group.displayName}
													href={group.href}
													verb={vb.appVerb}
													tone={vb.tone}
													live={group.members.some((m) => m.isLive)}
													chip={single ? group.envText || null : null}
													theme={single ? lead.theme : null}
													envText={single ? null : group.envText || null}
													from={group.previousVersion}
													to={group.version ? shortenVersion(group.version) : null}
													actor={actor.kind === 'person' ? actor : null}
													age={clockOf(group.timestamp)}
													expandable={groupHasDetails(group)}
													open={detailsOpen.has(group.key)}
													ontoggle={() => toggleDetails(group.key)}
													toggleLabel={group.members.length > 1 ? `Show ${group.members.length} environments` : 'Show details'}
													outcome={kind === 'deployed' ? 'deploy succeeded' : null}
													mark={deployMark({ actorKind: actor.kind })}
												>
													{@render dayRowDetails(group)}
												</FeedRow>
											{/each}
										</ul>
										<!-- never a one-row fold: `groupRows` folds the hidden count up by one when exactly one group would hide -->
										{#if allGroups.length > rows.length}
											<div class="border-t border-line-subtle px-4 py-3">
												<button type="button" class="btn btn-secondary btn-sm" onclick={() => expandGroup(dayGroup.label)}>Show {allGroups.length - rows.length} more</button>
											</div>
										{/if}
									</ListCard>
								</section>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- NEW BY DESIGN: "This window". ROLE: the side column's one summary card, who is busiest in the SAME scoped-and-windowed set the main column
			     shows. Why not HowItsGoing: three of its five rows need per-step timing this page never parses and `Furthest behind` is a rank this page
			     dropped. Borrows the Card's 47px header and the Home Fleet card's row (glyph · name · meta ... count). Sticky under the 52px top bar. -->
			<div class="min-w-0 lg:sticky lg:top-[68px]">
				{#if rolloutsQuery.isLoading}
					<CardSkeleton titleWidth="w-28" rollupWidth="w-20" rows={4} rowHeight={32} />
				{:else}
					<Card icon={ListOutline} title="This window" verdict={rangeLabel}>
						{#if mostActive.length > 0}
							<p class="t-label mb-2 text-fg-subtle">Most active</p>
							<ul class="flex flex-col">
								{#each mostActive as m (m.href)}
									<li class="flex min-h-8 items-center gap-2 py-1">
										<AppGlyph name={m.name} size={20} />
										<a href={m.href} class="tap-link t-card-title min-w-0 shrink truncate text-fg">{m.name}</a>
										{#if m.envLabel}<span class="t-meta min-w-0 flex-1 truncate text-fg-subtle">{m.envLabel}</span>{:else}<span class="flex-1"></span>{/if}
										<span class="t-meta shrink-0 tabular-nums text-fg-subtle">{m.count} deploy{m.count === 1 ? '' : 's'}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</Card>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	/* The KPI head's columns follow the CARD's width, not the viewport: 2x2 until the card holds four figures side by side (>= 32rem), then one row of four.
	   Scoped CSS + a container query, so the layout cannot depend on a utility (`sm:grid-cols-4`) being present where the page is embedded, and a half-width card at 1024 gets the right count too. */
	.act-chart { container-type: inline-size; }
	.act-kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 1rem; }
	@container (min-width: 32rem) {
		.act-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
	}
	/* The KPI tiles are flat inside the chart card: `KpiTile` is shared and keeps its own internals; this page only disowns the .tile shell. */
	.act-kpis :global(.tile.kpi) {
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 0;
	}

	/* Chart annotations: colour = state on the line and the words only. The shared kit draws each failed marker as a red-outlined box
	   (chart-marks.css, also used by Home); on this page the pill keeps its neutral outline and the red stays on the dotted line and text. */
	:global(.act-chart .db-m-failed .db-pill) {
		stroke: var(--k-line);
	}

	/* the control strip's remembered min-height (per breakpoint) so a chip row never moves after first paint */
	[data-activity-strip] {
		min-height: var(--activity-strip-min-h);
	}
	@media (min-width: 640px) {
		[data-activity-strip] {
			min-height: var(--activity-strip-min-h-sm);
		}
	}
</style>
