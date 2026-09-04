<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ══ `/activity` — THE COMPOSITION PASS AND THE NOVICE PASS, TOGETHER ═════
	 *
	 * This page had received NEITHER. Six pages got titled cards, icons, a
	 * filled banner and real buttons; six pages then had their vocabulary
	 * rewritten. `/activity` got a colour fix and nothing else, and a live UX
	 * critique named it **the page with the worst attention ordering in the
	 * product**. Five findings, all reproducible on the live cluster, and what
	 * each one became:
	 *
	 * ── 1. THE LOUDEST OBJECT WAS A FILTER BUTTON ───────────────────────────
	 * The `7d` pill measured 207.8 presence — louder than the `stuck` alarm
	 * anywhere in the product — and sat 0.059 dEok from `Deploying` blue, so a
	 * CONTROL wore a STATE's hue. Fixed in the 2026-08-27 colour pass for the
	 * state-pill rows; the env chip row was left on record here as "VERIFIED"
	 * while its own selected state was still a 40%-alpha `ring`, not a fill —
	 * a fourth re-check (F1, 2026-09-03) caught the gap between what this
	 * comment claimed and what shipped. `.env-filter-selected` (app.css) now
	 * gives the pressed env chip the same solid `gray-900`/`gray-100` fill,
	 * so this sentence is finally true: every filter row on this page shares
	 * one near-neutral selected state, and nothing is allowed to be louder
	 * than a failed deploy.
	 *
	 * ── 2. `Show changes` EXPANDED TO NOTHING ───────────────────────────────
	 * See `ChangeList.svelte`. The control is `What changed` now and every
	 * branch of it renders an answer, including the branch where kuberik has
	 * no GitHub token — which on this cluster is every branch.
	 *
	 * ── 3. ROWS FOR DIFFERENT ENVIRONMENTS WERE BYTE-IDENTICAL ──────────────
	 * THIS WAS A GUARD, NOT A DATA GAP, AND THE PAGE ALREADY HAD THE ANSWER.
	 * The env chip was rendered `{#if entry.envName}`, and `envName` comes only
	 * from a matching `Environment` OBJECT. Three `hello-world-manifests`
	 * rollouts have no `Environment`; they carry
	 * `dashboard.rollout.kuberik.com/theme: prod|dev|staging` instead, which
	 * the page was ALREADY using to tint the row's `environment-theme-scope`.
	 * So the product knew the environment, coloured the row with it, and
	 * refused to print it — three rows reading
	 * `rollout-controller deployed hello-world-manifests 56d1725 was f368353`,
	 * for three different places. The guard is `entry.theme || entry.envName`
	 * now, and the label falls back through `shortEnvLabel(theme)`.
	 * A SECOND disambiguator backs it up: when two events in view share an app
	 * name AND an environment, the row prints its NAMESPACE. On this cluster
	 * that fires zero times, which is the point — it appears only when the
	 * chip is not enough.
	 *
	 * ── 4. THE CHART WAS EMPTY BY DEFAULT ───────────────────────────────────
	 * A fixed `7d` default against a cluster whose whole history is one day:
	 * 39 deploys as one dot at `now` across ~1100px of empty grid. The window
	 * is COMPUTED to fit the data now (smallest preset that contains the
	 * oldest event) and stops being computed the moment the reader touches a
	 * button. And the chart earned its space by changing what it plots: it was
	 * ONE lane called `All deploys` — a strip plot of a list that is already
	 * below it — and it is now ONE LANE PER ENVIRONMENT, which is a question
	 * the feed cannot answer at a glance: did prod get these deploys too, and
	 * how long after dev?
	 *
	 * ── 5. THERE WAS A LEGEND ON THIS PAGE ──────────────────────────────────
	 * `DeploymentTimeline`'s five-swatch key was deleted on 2026-08-27 and did
	 * not come back — verified in the DOM. The only remaining LEGEND-SHAPED
	 * object was the row of env chips floating at the right of the filter bar,
	 * which are controls that looked like a key. They sit in ONE control strip
	 * with the state filters now, they carry `aria-pressed`, and each says
	 * what it does on hover. Its job is done instead by: the day card's
	 * right-aligned rollup (`12 deploys · all fine` / `9 deploys · 1 failed`),
	 * the state word printed in plain English on every row that is not the
	 * norm, and the banner.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, sourceClusterName, rolloutPath } from '$lib/source-dashboard';
	import { buildPath, repoKeyFromSource } from '$lib/version-utils';
	import {
		formatTimeAgoCompact,
		formatTimeAgo,
		formatDate,
		getDisplayVersion,
		shortenVersion
	} from '$lib/utils';
	import { rankVerdictsByRollout, rankLabel, rankRole, rankTitle } from '$lib/view-models/env-rank';
	import { getStatusCircleClass, BAKE_WORD, bakeTitle } from '$lib/bake-status';
	import {
		getRolloutEnvironmentTheme,
		getEnvironmentThemeStyle,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import {
		ClockSolid,
		CalendarMonthSolid,
		ChartLineUpOutline,
		ExclamationCircleSolid,
		UndoOutline
	} from 'flowbite-svelte-icons';
	import { deployActs, type DeployAct } from '$lib/history-marks';

	/** The one member of `DeployAct` this page ever attaches to a row. */
	type RollbackAct = Extract<DeployAct, { kind: 'rollback' }>;
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeploymentTimeline from '$lib/components/DeploymentTimeline.svelte';
	import ChangeList from '$lib/components/ChangeList.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import Card from '$lib/components/Card.svelte';
	import NextStep from '$lib/components/NextStep.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Environment } from '../../types';

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
	type TimeRange = PresetRange | { start: number; end: number };

	const RANGE_MS: Record<string, number> = {
		'1h': 3_600_000,
		'6h': 21_600_000,
		'1d': 86_400_000,
		'7d': 604_800_000,
		'30d': 2_592_000_000
	};
	/** Smallest first — the auto window picks the first one that fits. */
	const RANGE_ORDER: PresetRange[] = ['1h', '6h', '1d', '7d', '30d'];

	type ActivityEntry = {
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
		 * The only row a rank may be attached to; see `ranks`.
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
	 * ⭐ THE FEED LED WITH THE SHA AND CARRIED NO RELATIVE SIGNAL. (2026-09-01)
	 *
	 * `DESIGN-INTENT.md`'s standing rule is that the RELATIVE version is the
	 * signal and the sha is usually noise, and this page printed sixty shas and
	 * nothing else. The joined `[verdict][sha]` chip `/` and `/rollouts` draw is
	 * the reference form and `env-rank.ts` is the one derivation.
	 *
	 * ⛔ IT GOES ON THE LIVE ROW AND NOWHERE ELSE. A rank is a fact about an
	 * environment's upgrade path AS IT IS NOW; a deploy from Tuesday has no
	 * distance from today's head, and printing one would attach a number that
	 * moves when some OTHER rollout deploys to a row that has not changed. The
	 * newest history entry of each rollout IS the present tense, so it takes the
	 * verdict unchanged; every older row keeps the plain `prev → new` pair. The
	 * chip's presence is therefore also what says "this is still what is
	 * running" — one mark, two jobs, no legend. Same ruling as `ActivityRail`.
	 */
	const ranks = $derived(rankVerdictsByRollout(rollouts, environments));

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
					timestamp: h.timestamp,
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

	function setParam(key: string, next: string | null) {
		const params = new URLSearchParams(page.url.searchParams);
		if (next) params.set(key, next);
		else params.delete(key);
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: false, noScroll: true, keepFocus: true });
	}
	function clearAllFilters() {
		goto('?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	const activeFilterCount = $derived(
		(envFilter ? 1 : 0) + (appFilter ? 1 : 0) + (nsFilter ? 1 : 0)
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
	function setKindFilter(next: KindFilter) {
		setParam('kind', next === 'all' ? null : next);
	}
	const KIND_FILTERS: { key: KindFilter; label: string; title: string }[] = [
		{ key: 'all', label: 'All', title: 'Every deploy in this window' },
		{
			key: 'in_flight',
			label: 'In flight',
			title: 'Deploys still going out or still being checked'
		},
		{ key: 'failed', label: 'Failed', title: 'Deploys that did not finish cleanly' },
		{
			key: 'rolled_back',
			label: 'Rolled back',
			title: 'Deploys that moved a rollout to an OLDER build than it was already running'
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
		return e.bakeStatus === 'InProgress' || e.bakeStatus === 'Deploying';
	}

	/** Everything the reader has scoped to, WITHOUT the time window. */
	const scoped = $derived(
		allEntries
			.filter((e) => !envFilter || e.envKey === envFilter)
			.filter((e) => !appFilter || e.rolloutName === appFilter)
			.filter((e) => !nsFilter || e.rolloutNamespace === nsFilter)
			.filter((e) => matchesKind(e))
	);

	// ── THE WINDOW, COMPUTED TO FIT THE DATA ───────────────────────────────
	// `Date.now()` and not `$now`: this must recompute when the DATA changes,
	// not once a second. A ticking clock here would fight the reader for the
	// control every time the second hand moved.
	const autoRange = $derived.by<PresetRange>(() => {
		let oldest = Number.POSITIVE_INFINITY;
		for (const e of allEntries) {
			const t = new Date(e.timestamp).getTime();
			if (t < oldest) oldest = t;
		}
		if (!Number.isFinite(oldest)) return '1d';
		const age = Date.now() - oldest;
		return RANGE_ORDER.find((k) => RANGE_MS[k] >= age) ?? 'all';
	});

	let rangeTouched = $state(false);
	let timelineRange = $state<TimeRange>('1d');
	$effect(() => {
		const auto = autoRange;
		if (rangeTouched) return;
		if (timelineRange !== auto) timelineRange = auto;
	});

	function inRange(ts: string): boolean {
		const t = new Date(ts).getTime();
		if (timelineRange === 'all') return true;
		if (typeof timelineRange === 'object')
			return t >= timelineRange.start && t <= timelineRange.end;
		return t >= $now.getTime() - (RANGE_MS[timelineRange] ?? Number.POSITIVE_INFINITY);
	}
	const rangeLabel = $derived(
		timelineRange === 'all'
			? 'all time'
			: typeof timelineRange === 'object'
				? 'the selected window'
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
	// the list's own cap, unchanged.
	const windowed = $derived(scoped.filter((e) => inRange(e.timestamp)));
	const feed = $derived(windowed.slice(0, 60));

	// ── ONE LANE PER ENVIRONMENT ───────────────────────────────────────────
	// The chart used to be a single lane labelled `All deploys`, which is a
	// strip plot of the list directly beneath it. Split by environment it
	// answers something the list cannot: whether prod got the same deploys,
	// and how far behind. Ordered dev → staging → prod by the product's one
	// rank (`env-order.ts`), so the lanes read as the promotion direction.
	const chartServices = $derived.by(() => {
		const lanes = new Map<
			string,
			{
				id: string;
				name: string;
				history: {
					timestamp: string;
					bakeStatus?: string;
					version: { tag: string; version?: string; revision?: string };
					subject?: string;
					triggeredBy?: { kind: 'User' | 'System'; name: string };
					mark?: 'rollback';
				}[];
				isCurrent: boolean;
			}
		>();
		for (const e of scoped) {
			const key = e.envLabel || e.rolloutNamespace || 'no environment';
			let lane = lanes.get(key);
			if (!lane) {
				lane = { id: key, name: key, history: [], isCurrent: false };
				lanes.set(key, lane);
			}
			lane.history.push({
				timestamp: e.timestamp,
				bakeStatus: e.bakeStatus,
				version: e.versionInfo,
				subject: e.displayName,
				triggeredBy: { kind: e.actorKind, name: e.actor },
				// ⭐ WIRES UP `DeploymentTimeline`'s OWN ROLLBACK RING — it has
				// drawn one (a neutral-ink circle round the dot) since
				// 2026-09-02, but nothing on this page ever passed `mark`, so
				// it never fired here. One fact, one ink, in the chart AND the
				// list now — see the colour note on `statusFill` for why the
				// list's green disc stays (a dated, quoted human ruling), and
				// `BakeStatusIcon`'s own rollback glyph swap below.
				mark: e.rollbackAct ? ('rollback' as const) : undefined
			});
		}
		return [...lanes.values()].sort((a, b) => compareEnvironmentNames(a.name, b.name));
	});

	// THE CHART SIZES ITSELF TO ITS OWN LANES, and both numbers were found by
	// running the page against the 22-environment fixture:
	//   · the gutter was 92px against `prod-ap-northeast-1`, so the label ran
	//     off the left edge of the SVG;
	//   · 22 lanes at 52px is a 1,144px chart — the whole viewport before the
	//     reader reaches one event.
	const chartLabelWidth = $derived(
		Math.min(
			168,
			Math.max(72, 16 + chartServices.reduce((m, s) => Math.max(m, s.name.length), 0) * 6.7)
		)
	);
	const chartRowHeight = $derived(chartServices.length > 6 ? 26 : 52);

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

	// ── DISAMBIGUATION, ONLY WHERE IT IS NEEDED ────────────────────────────
	// The env chip carries identity for almost every row. It cannot when two
	// events in view share BOTH an app name and an environment and differ only
	// by namespace — then, and only then, the namespace prints. Marking the
	// norm here would put a namespace on all sixty rows.
	const ambiguous = $derived.by(() => {
		const seen = new Map<string, Set<string>>();
		for (const e of feed) {
			const k = `${e.displayName}::${e.envLabel}`;
			if (!seen.has(k)) seen.set(k, new Set());
			seen.get(k)!.add(e.rolloutNamespace);
		}
		const out = new Set<string>();
		for (const [k, namespaces] of seen) if (namespaces.size > 1) out.add(k);
		return out;
	});
	function needsNamespace(e: ActivityEntry): boolean {
		return ambiguous.has(`${e.displayName}::${e.envLabel}`);
	}

	// ── TIME CLUSTERS ──────────────────────────────────────────────────────
	type DayGroup = {
		label: string;
		entries: ActivityEntry[];
	};
	function clusterLabel(ts: string, refNow: Date): string {
		const d = new Date(ts);
		const ageMs = refNow.getTime() - d.getTime();
		if (ageMs < 60 * 60 * 1000) return 'In the last hour';
		const today = new Date(refNow.getFullYear(), refNow.getMonth(), refNow.getDate());
		const yesterday = new Date(today.getTime() - 86_400_000);
		const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		if (dayStart.getTime() === today.getTime()) return 'Today';
		if (dayStart.getTime() === yesterday.getTime()) return 'Yesterday';
		const daysAgo = Math.floor((today.getTime() - dayStart.getTime()) / 86_400_000);
		if (daysAgo < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
		return 'Earlier';
	}

	const groupedByDay = $derived.by<DayGroup[]>(() => {
		const refNow = $now;
		const groups: DayGroup[] = [];
		let currentLabel = '';
		for (const entry of feed) {
			const label = clusterLabel(entry.timestamp, refNow);
			if (label !== currentLabel) {
				groups.push({ label, entries: [] });
				currentLabel = label;
			}
			groups[groups.length - 1].entries.push(entry);
		}
		return groups;
	});

	function isFailed(e: ActivityEntry) {
		return e.bakeStatus === 'Failed';
	}
	function isInFlight(e: ActivityEntry) {
		return e.bakeStatus === 'InProgress' || e.bakeStatus === 'Deploying';
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
		const failed = entries.filter(isFailed).length;
		const flying = entries.filter(isInFlight).length;
		const rolledBack = entries.filter(isRolledBack).length;
		const mayBeIncomplete = entries.some((e) => e.retentionCut);
		const n = entries.length;
		const noun = mayBeIncomplete
			? `at least ${n} deploy${n === 1 ? '' : 's'}`
			: `${n} deploy${n === 1 ? '' : 's'}`;
		let out: { text: string; tone: 'adverse' | 'active' | 'neutral' | 'good' };
		if (failed > 0) out = { text: `${noun} · ${failed} failed`, tone: 'adverse' };
		else if (flying > 0) out = { text: `${noun} · ${flying} still going`, tone: 'active' };
		else if (rolledBack > 0) out = { text: `${noun} · ${rolledBack} rolled back`, tone: 'neutral' };
		// ⛔ `n > 0 &&`, NOT A BARE `.every()`. (2026-09-03, operator-walk P7)
		// `[].every(...)` is vacuously TRUE — an empty window read `0 deploys ·
		// all fine`, a verdict about zero evidence dressed as good news. This
		// surfaces the moment the chart card renders for an empty filtered
		// set (see the note above `chartServices.length > 0` below), which a
		// widened window control makes reachable for the first time.
		else if (n > 0 && entries.every((e) => e.bakeStatus === 'Succeeded'))
			out = { text: `${noun} · all fine`, tone: 'good' };
		else out = { text: noun, tone: 'neutral' };
		return { ...out, mayBeIncomplete };
	}

	const failedCount = $derived(feed.filter(isFailed).length);
	const flyingCount = $derived(feed.filter(isInFlight).length);
	const rolledBackCount = $derived(feed.filter(isRolledBack).length);
	const appCount = $derived(
		new Set(feed.map((e) => `${e.rolloutNamespace}/${e.rolloutName}`)).size
	);

	/**
	 * ⭐ THE CHART CARD'S VERDICT — the answer, not the window. (2026-09-02)
	 * It used to print `rangeLabel` (`the last 7 days`), which is the SAME
	 * fact the `7D` pill 50px below already states, and it is the one card
	 * rollup on this page that is not a verdict — every other card on the
	 * product answers "how did it go", not "what am I looking at". Over
	 * `windowed`, UNCAPPED, because the chart's own window can hold more than
	 * the sixty rows the list renders. `rangeLabel` still rides in the
	 * title — it is a real fact, just not the headline one.
	 */
	const windowRollup = $derived(groupRollup(windowed));

	// ── THE PAGE'S ONE BLOCKING FACT ───────────────────────────────────────
	// A deploy that failed will not clear itself. Nothing else on this page
	// qualifies: a deploy in flight resolves on its own, and a succeeded one
	// is the norm.
	const blocker = $derived.by(() => {
		const worst = feed.find(isFailed);
		if (!worst) return null;
		const where = worst.envLabel ? ` in ${worst.envLabel}` : '';
		return {
			title: failedCount === 1 ? 'A deploy failed' : `${failedCount} deploys failed`,
			message: `${worst.displayName}${where} failed ${formatTimeAgo(worst.timestamp, $now)}, on ${worst.version}.`,
			footnote: failedCount > 1 ? `Press Failed below to see all ${failedCount}.` : undefined,
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

	/**
	 * ── THE VOCABULARY ─────────────────────────────────────────────────────
	 * `deployed X was Y` states the MECHANISM. So does `bake`. Every word here
	 * states the CONSEQUENCE instead, and `Succeeded` states NOTHING — it is
	 * the norm, it was printed 39 times on one screen, and the disc beside it
	 * already says so. The row's own version pair (`f368353 → 56d1725`) is
	 * what a succeeded deploy actually changed.
	 */
	/**
	 * ⚠️ `InProgress` LOST ITS PHRASE, AND THAT IS THE POINT (2026-08-30).
	 * This page shipped `live, being checked` while five other surfaces still
	 * said `baking` — one state, two spellings, which is the split the
	 * `N behind` pass cost a day to close. The word is `bake-status.ts`'s now
	 * and the phrase survives as the row's `title`, where a sentence belongs.
	 *
	 * ⛔ AND `Deploying` FOLLOWED IT THE SAME DAY. `going live` was the last
	 * private spelling on this page: every other surface — `/`, `/rollouts`,
	 * rollout detail, `ActivityRail`, `/apps`, `/envs` — says `deploying`.
	 * It is a smaller class of defect than `baking` was, because `going live`
	 * is ordinary English and a novice can act on it, so it was logged and
	 * scoped out once. But the defect it leaves is the same shape and it is
	 * not smaller for the reader: a product that calls ONE state two names on
	 * two adjacent pages is teaching the operator that there are two states.
	 * The ruling is the `checking` ruling, applied again — the WORD is
	 * `bake-status.ts`'s and the SENTENCE rides in the `title`, where
	 * `BAKE_TITLE.Deploying` already spells the consequence `going live` was
	 * carrying (*"The new version is still going out"*). The blue/yellow hue
	 * split between `deploying` and `checking` is untouched; both verbs stay
	 * distinct, which is the whole reason this table has two rows for them.
	 */
	const STATE_WORD: Record<string, string | null> = {
		Succeeded: null,
		Deploying: BAKE_WORD.Deploying,
		InProgress: BAKE_WORD.InProgress,
		Failed: BAKE_WORD.Failed,
		Cancelled: BAKE_WORD.Cancelled,
		None: 'no result yet'
	};
	const STATE_INK: Record<string, string> = {
		Deploying: 'text-blue-700 dark:text-blue-400',
		InProgress: 'text-yellow-700 dark:text-yellow-400',
		Failed: 'text-red-700 dark:text-red-400',
		Cancelled: 'text-gray-500 dark:text-gray-400',
		None: 'text-gray-500 dark:text-gray-400'
	};
</script>

<svelte:head>
	<title>kuberik | Activity</title>
</svelte:head>

<!-- ⭐ THE ROLLBACK MARK'S ICON, SHARED BY EVERY ROW. (DESIGN PASS 2)
     `Chip`'s `icon` prop takes a snippet, not a component reference, so one
     definition here replaces the private `<UndoOutline>` literal that used to
     sit inside the now-deleted filled pill below. Same glyph, same product's
     word for "went backwards" — nothing about the icon changed, only the box
     around it. -->
{#snippet rollbackIcon()}
	<UndoOutline class="mr-[3px] h-[11px] w-[11px] shrink-0" aria-hidden="true" />
{/snippet}

<!-- ⭐ ONE CONTAINER FOR THE PRODUCT: `mx-auto max-w-7xl px-4 py-6 sm:px-6`.
     ⛔ THIS PAGE WAS `max-w-5xl`. Measured at 1440 it made the content column
     976px wide against every other page's 1216 — a **128px jump on each side**
     every time an operator entered or left `/activity`, which is what the human
     meant by *"pages have slightly different content margins so navigating
     between pages feels jittery"*. The narrow measure was never justified by
     line length: nothing on this page is prose. The widest object is the
     `When deploys happened` chart, which is a time axis and wants MORE room,
     and the event rows are three-column grids (mark · what · when) whose right
     column was being crushed, not protected. A reading measure is a legitimate
     exception; this was not one, so it is gone rather than documented. -->
<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!-- ══ HEADER ═══════════════════════════════════════════════════════════
	     THE 24H SPARKLINE IS CUT. It sat 40px above a chart of the same array
	     at higher resolution, and on this cluster it drew nothing at all while
	     printing `LAST 24H 0 deploys` — a dead object stating a number that
	     contradicted the 39 events below it. This is the `DeployHistoryStrip`
	     rule: an object that reads the same array as the object beside it is
	     cut, not shrunk. -->
	<!-- ⭐ THE `h1` IS `sr-only` AND THE ROLLUP TOOK ITS SLOT. (2026-09-01)
	     From the human: *"i think i don't like that we have a title on the page
	     when it's already in the navbar."* The navbar's own `Activity` item and
	     this page's `h1` were the same word, 40px apart, and the 24px slot — the
	     top of a type range this page otherwise does not have — was spent
	     restating it.

	     ⛔ DELETING THE HEADING WAS NOT AN OPTION AND IS NOT WHAT HAPPENED. The
	     skip link lands on `main` and a11y asserts a level-1 heading exists, so
	     it is `sr-only` — the mechanism `/` already uses, a 1px clip, zero
	     pixels — and the WORD is still announced first to a screen reader.

	     WHAT FILLS THE SLOT IS THE ROLLUP, NOT MORE WORDS. Same sentence as
	     before, character for character; only the count is promoted to the
	     display role so the page leads with its own answer instead of with its
	     own name. `/namespaces/<name>` deliberately keeps its visible `h1`: the
	     navbar there says the SECTION and the page names the NAMESPACE, so
	     that one is not a duplicate. -->
	<h1 class="sr-only">Activity</h1>
	<div class="mb-5 min-w-0">
		{#if !rolloutsQuery.isLoading && !rolloutsQuery.isError}
			<div class="flex min-w-0 flex-wrap items-baseline gap-x-2">
				<span class="t-display text-gray-900 tabular-nums dark:text-white">{feed.length}</span>
				<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
					<!--
						⛔ THE ROLLUP NUMBER DID NOT CARRY THE ACTIVE FILTER. (2026-09-03,
						operator-walk finding 19.) With the FAILED chip pressed this said
						`0 deploys in all time` — true of the count, silent about WHY it
						is zero, indistinguishable from "nothing has deployed" when the
						real answer is "nothing has FAILED". `kindFilter` already scopes
						`feed`; the noun now names what it was scoped TO.

						Branches, not a ternary collapsed into one text node: the census
						scanner cannot see a literal that shares its text node with an
						adjacent interpolation and no separating prose, and this exact
						wording is what the operator-walk finding is about.

						⚠️ THE SEPARATING SPACE IS ITS OWN HOLE, NOT TRAILING TEMPLATE
						WHITESPACE. Svelte trims literal whitespace sitting at a block's
						edge, so `{#if …}failed {:else …}` silently rendered
						`faileddeploys` — verified on the live page. A JS-expression space
						survives because the compiler only trims TEMPLATE whitespace, not
						a string an expression returns.
					-->
					{#if kindFilter === 'failed'}failed{:else if kindFilter === 'in_flight'}in-flight{:else if kindFilter === 'rolled_back'}rolled-back{/if}{kindFilter !==
					'all'
						? ' '
						: ''}deploy{feed.length === 1 ? '' : 's'} in {rangeLabel}
					{#if appCount > 0}
						· {appCount} rollout{appCount === 1 ? '' : 's'}
					{/if}
					{#if failedCount > 0 && kindFilter !== 'failed'}
						· <span class="font-medium text-gray-700 dark:text-gray-200">{failedCount} failed</span>
					{/if}
					{#if flyingCount > 0 && kindFilter !== 'in_flight'}
						· {flyingCount} still going
					{/if}
					{#if rolledBackCount > 0 && kindFilter !== 'rolled_back'}
						· {rolledBackCount} rolled back
					{/if}
				</p>
			</div>
		{/if}
	</div>

	{#if blocker}
		<AlertPanel
			severity="error"
			icon={ExclamationCircleSolid}
			title={blocker.title}
			message={blocker.message}
			footnote={blocker.footnote}
			class="mb-5"
		>
			{#snippet extra()}
				{#if blocker.entry?.version}
					{@const rank = ranks.get(blocker.entry.rollout) ?? { kind: 'unknown' as const }}
					<Chip
						role={rankRole(rank)}
						label={rankLabel(rank)}
						title={rankTitle(rank, blocker.entry.displayName)}
						value={shortenVersion(blocker.entry.version)}
						valueTitle={blocker.entry.version}
						class="min-w-0"
					/>
				{/if}
			{/snippet}
			{#snippet actions()}
				<NextStep step="open" href={blocker.href} label="Open {blocker.app}" />
			{/snippet}
		</AlertPanel>
	{/if}

	<!-- ══ WHEN THEY HAPPENED ═══════════════════════════════════════════════
	     A TITLED CARD, not a bordered box. The rollup is the ANSWER now
	     (`49 deploys · 1 rolled back`, `all fine`) — never the window, which
	     the `7D` pill 50px below already states and which used to be this
	     card's whole rollup. The window still rides in the title: it is a
	     real fact, and the buttons inside this card govern the feed below
	     it too, so a reader hovering the verdict still finds it. -->
	<!-- ⛔ THE GATE WAS `chartServices.length > 0`, WHICH HID THE ONLY COPY OF
	     THE WINDOW CONTROL. (2026-09-03, operator-walk P7) `chartServices` is
	     built from `scoped` (env/app/ns/kind, no time window) — so a filter
	     combination with zero matches EVER (`?kind=failed&env=prod` on a
	     cluster with no failed prod deploys) hid this whole card, and the
	     empty state 300px below still said "Widen the window above" —
	     pointing at a control that no longer existed on the page.
	     `DeploymentTimeline` already draws its range-pill row unconditionally
	     and only swaps its OWN chart body for a `No data` placeholder when
	     `services.length === 0` (see that file), so the card only needs to
	     stop hiding itself: `allEntries.length > 0` — this fleet has SOME
	     history at all — is the only real precondition for a window control
	     to mean anything. A cluster with zero deploys ever is the one case
	     that still hides it, because there is no window to set. -->
	{#if allEntries.length > 0}
		<Card
			icon={ChartLineUpOutline}
			title="When deploys happened"
			verdict={windowRollup.text}
			verdictTone={windowRollup.tone}
			verdictTitle="{windowRollup.text}, in {rangeLabel} — the window these buttons set. It also scopes the feed below."
			class="mb-5"
		>
			<DeploymentTimeline
				services={chartServices}
				bind:timeRange={timelineRange}
				onRangeChange={() => (rangeTouched = true)}
				labelWidth={chartLabelWidth}
				rowHeight={chartRowHeight}
				labelEmptyLanes
			/>
		</Card>
	{/if}

	<!-- ══ ONE CONTROL STRIP ════════════════════════════════════════════════
	     THE ENV CHIPS USED TO FLOAT AT THE FAR RIGHT OF THIS ROW, which is
	     exactly where a colour key goes, and the human has had two legends
	     deleted. They are controls, so they sit in the control strip, after a
	     divider, in the same pressed/unpressed language as the state filters,
	     and each one says what it does. -->
	<!-- `gap-y-3`, not `gap-y-2`: the status-pill and env-chip groups wrap onto
	     two lines at 390 (each is `flex-nowrap`, so only the OUTER wrap can
	     break between them). Design pass 6's touch-target fix gives every
	     pill an invisible 32px hit box on coarse pointers (`.pill-btn` in
	     `app.css`) — at the old 8px gap that box overlaps the next line's by
	     4px (6px of slop each side, 8 - 6 - 6 < 0). 12px leaves the two
	     expanded boxes exactly touching, never overlapping. -->
	<div class="mb-4 flex flex-wrap items-center gap-x-2 gap-y-3">
		<!-- ⛔ THIS ROW AND THE CHART'S `1H 6H 1D 7D 30D ALL` ROW WERE TWO
		     ALMOST-IDENTICAL PILLS ONE TYPE SIZE APART. (2026-09-02) This one
		     is `t-label` (10px/600); `DeploymentTimeline`'s presets are an ad
		     hoc `text-[11px] font-semibold uppercase tracking-wider` — a
		     THIRD uppercase size, against app.css's own note above `t-label`
		     that the product's old 9/10/11px sprawl was deliberately closed
		     to exactly `t-label` (10px) and `t-micro` (11px, not uppercase).
		     Moving THIS row up to 11px would reopen that budget; `Deployment
		     Timeline` moves down to `t-label` instead — see the matching
		     comment there.
		     ⛔ AND THE SELECTED PILL WAS 2PX SHORTER. Its unselected sibling
		     carries a 1px border; the selected state had none, so on a
		     border-box element a border-less button IS 2px smaller in both
		     axes at identical padding. `border-gray-900`/`border-gray-100`
		     match the fill exactly, so the border is invisible and the box is
		     the same size as its neighbours either way.
		     ⛔ AND THIS ROW WAS TALLER THAN THE ENV CHIPS BESIDE IT (F16,
		     DESIGN PASS 5). Measured at 1440: this pill's `t-label` line box
		     (12px) + `py-1` (8px) + its 1px border each side (2px) = 22px,
		     against the env chip's `.chip` (app.css), which is a HARD 20px —
		     tops landed 1px apart on the shared `items-center` baseline. `py-1`
		     → `py-[3px]` closes exactly that 2px, so both groups share one
		     height and one baseline; nothing shrank below the chip's own
		     20px floor, which is already the product's control size for this
		     row (see `RolloutGrid`'s identical env-chip filter buttons). -->
		<!-- ⭐ TWO GROUPS, EACH `nowrap`, NOT ONE FLAT ROW OF BUTTONS. (DESIGN
		     PASS 2, defect #4) At 390 the bare divider between the status
		     filters and the env filters used to wrap to the END of row 1 —
		     the flex-wrap parent breaks between individual BUTTONS, with no
		     concept that the four status pills are one group and the env
		     chips are another. Measured: `DEV` landed on row 1 (right after
		     the divider) while `STAGING PROD` wrapped to row 2, splitting one
		     group of chips across two lines.

		     Each group is its own `flex flex-nowrap` unit now, so the OUTER
		     `flex-wrap` can only break BETWEEN groups, never inside one — the
		     env chips move together or not at all. The divider is `hidden
		     sm:inline-block`: below `sm` the two groups routinely do not fit
		     one line together (this row's own reason for existing), so a
		     divider that sometimes strands itself between the last status pill
		     and a WRAPPED env group is worse than no divider; above `sm` the
		     measured case, both groups fit and it draws as before. -->
		<div class="flex flex-nowrap items-center gap-x-2">
			{#each KIND_FILTERS as f (f.key)}
				<button
					type="button"
					aria-pressed={kindFilter === f.key}
					title={f.title}
					onclick={() => setKindFilter(f.key)}
					class="pill-btn t-label rounded border px-3 py-[3px] transition-colors
						{kindFilter === f.key
						? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
						: 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
					>{f.label}</button
				>
			{/each}
		</div>
		{#if knownEnvs.length > 0}
			<span
				class="mx-1 hidden h-4 w-px bg-gray-200 sm:inline-block dark:bg-gray-700"
				aria-hidden="true"
			></span>
			<div class="flex flex-nowrap items-center gap-x-2">
				{#each knownEnvs as e (e.key)}
					<!-- ⛔ THE RING WAS THE ONLY "SELECTED" ON THIS ROW THAT CHANGED
					     NOTHING SOLID (2026-09-03, activity/touch lane, F1). A 40%-
					     alpha 2px ring on a 20px chip against the state-pill group
					     four columns left, which fills gray-900/gray-100 SOLID for
					     its own selected member — two different "selected" grammars
					     on one strip. `.env-filter-selected` (app.css, declared right
					     after `.chip-env`) gives the pressed env chip the SAME solid
					     fill; the identity hue is deliberately lost while pressed,
					     which is documented there rather than guessed at here. -->
					<button
						type="button"
						aria-pressed={envFilter === e.key}
						title={envFilter === e.key ? `Stop showing only ${e.label}` : `Show only ${e.label}`}
						onclick={() => setParam('env', envFilter === e.key ? null : e.key)}
						class="pill-btn environment-theme-scope inline-flex items-center rounded transition-opacity
							{envFilter === e.key
							? 'env-filter-selected'
							: envFilter === null
								? ''
								: 'opacity-45 hover:opacity-100'}"
						style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
						><Chip role="env" theme={e.theme} label={e.label} wide /></button
					>
				{/each}
			</div>
		{/if}
	</div>

	{#if appFilter || nsFilter}
		<div class="mb-4 flex flex-wrap items-center gap-x-2 gap-y-3">
			<span class="t-micro text-gray-500 dark:text-gray-400">Showing only:</span>
			{#if appFilter}
				<button
					type="button"
					onclick={() => setParam('app', null)}
					class="pill-btn t-label inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-200 dark:hover:bg-gray-700"
					title="Stop showing only {appFilter}"
				>
					rollout
					<span class="t-code-sm normal-case">{appFilter}</span>
					<span aria-hidden="true">×</span>
				</button>
			{/if}
			{#if nsFilter}
				<button
					type="button"
					onclick={() => setParam('ns', null)}
					class="pill-btn t-label inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-200 dark:hover:bg-gray-700"
					title="Stop showing only {nsFilter}"
				>
					namespace
					<span class="t-code-sm normal-case">{nsFilter}</span>
					<span aria-hidden="true">×</span>
				</button>
			{/if}
			{#if activeFilterCount >= 2}
				<button
					type="button"
					onclick={clearAllFilters}
					class="pill-btn t-micro ml-1 text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
					>Clear all</button
				>
			{/if}
		</div>
	{/if}

	<!--
		⭐ THE HUB FAILS SOFT. `/api/rollouts` answers 200 with the spokes that
		replied and names the ones that did not in `clusterErrors`, so this page
		can be PARTLY true — and until now only `/` and `/rollouts` said so.
		A rollout on an unreachable spoke is absent from every count here, and
		absent is not healthy. Renders nothing when every cluster answered.
	-->
	<PartialDataNotice
		errors={rolloutsQuery.data?.clusterErrors ?? []}
		subject="this feed"
		onRetry={() => rolloutsQuery.refetch()}
		isRetrying={rolloutsQuery.isFetching}
	/>

	{#if rolloutsQuery.isLoading}
		<StillTryingNotice failureCount={rolloutsQuery.failureCount} />
		<div class="space-y-3">
			{#each Array(8) as _, i (i)}
				<div class="h-[3.25rem] w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			{/each}
		</div>
	{:else if rolloutsQuery.isError}
		<!--
			⛔ AN EMPTY ACTIVITY FEED IS THE MOST DANGEROUS BLANK IN THE PRODUCT:
			"nothing has happened" is a perfectly ordinary state here, so a failed
			request wearing the same blankness reads as calm. It must say, in
			words, that this is a failure and not a quiet night.
		-->
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
			<ClockSolid class="mb-3 h-10 w-10 text-gray-500 dark:text-gray-400" />
			{#if activeFilterCount > 0 || kindFilter !== 'all'}
				<p class="t-body font-semibold text-gray-900 dark:text-white">
					Nothing matches these filters
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
				<p class="t-dense mt-1 text-gray-500 dark:text-gray-400">
					Try widening the window, or clearing one filter at a time.
				</p>
				<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
					{#if timelineRange !== '30d' && timelineRange !== 'all'}
						<button
							type="button"
							onclick={() => {
								timelineRange = '30d';
								rangeTouched = true;
							}}
							class="btn btn-secondary">Widen to 30 days</button
						>
					{/if}
					{#if kindFilter !== 'all'}
						<button type="button" onclick={() => setKindFilter('all')} class="btn btn-secondary"
							>Clear “{KIND_FILTERS.find((f) => f.key === kindFilter)?.label}”</button
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
					{#if activeFilterCount + (kindFilter !== 'all' ? 1 : 0) > 1}
						<button type="button" onclick={clearAllFilters} class="btn btn-secondary"
							>Clear all filters</button
						>
					{/if}
				</div>
			{:else}
				<p class="t-body font-semibold text-gray-900 dark:text-white">Nothing has deployed yet</p>
				<p class="t-dense mt-1 max-w-sm text-gray-500 dark:text-gray-400">
					Every version a rollout puts live shows up here, newest first.
				</p>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			{#each groupedByDay as dayGroup (dayGroup.label)}
				{@const rollup = groupRollup(dayGroup.entries)}
				<!-- THE HEADER ICON TAKES INK ONLY FOR THE DEVIATION. The reference
				     page tints its card icons with the card's own state, and that is
				     right there because it has four cards with four different answers.
				     A 7-day feed is SEVEN cards, so a green clock on each would be the
				     norm drawn at header scale — the defect this file's own
				     `Succeeded` column already records. Red only, and only when the
				     group holds a failure. -->
				<!-- ══ ONE TIME CLUSTER, ONE TITLED CARD ═══════════════════════
				     MEMBERSHIP OF THE CARD IS THE ONLY GROUPING MARK. Rows inside
				     a card with a failure are byte-identical to rows in any other
				     card; the moment one row can be styled differently from its
				     neighbour, the gray attention band comes back under a new
				     name. -->
				<Card
					icon={dayGroup.label === 'In the last hour' ? ClockSolid : CalendarMonthSolid}
					iconClass={rollup.tone === 'adverse'
						? 'text-red-700 dark:text-red-400'
						: 'text-gray-500 dark:text-gray-400'}
					title={dayGroup.label}
					verdict={rollup.text}
					verdictTone={rollup.tone}
					verdictTitle={rollup.mayBeIncomplete
						? 'How many deploys landed in this window, and how many of them failed. At least one rollout here has hit its retention limit (spec.versionHistoryLimit), so earlier deploys that day may have already been evicted — this count is a floor, not a total.'
						: 'How many deploys landed in this window, and how many of them failed'}
					padded={false}
				>
					<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each dayGroup.entries as entry (`${entry.rolloutNamespace}/${entry.rolloutName}/${entry.timestamp}`)}
							<!-- ⚠️ `?? STATE_WORD.None` WOULD BE WRONG HERE. `Succeeded` maps
							     to `null` ON PURPOSE — the norm says nothing — and `??`
							     only falls through on null, so every succeeded row printed
							     `no result yet`. The table is looked up by KEY. -->
							{@const word =
								entry.bakeStatus in STATE_WORD ? STATE_WORD[entry.bakeStatus] : STATE_WORD.None}
							<li
								class="environment-theme-scope"
								style={entry.theme ? getEnvironmentThemeStyle(entry.theme) : undefined}
							>
								<!-- ⭐ `.tap-zone` ON THE ROW, NOT ON THE `<li>`. (2026-09-01)
								     This row already had the RIGHT IDEA — a stretched
								     `::after` on the name link rather than a wrapping `<a>`,
								     which would nest a button inside an anchor — but it was
								     HAND-ROLLED: the overlay was an `after:absolute
								     after:inset-0` utility pair, so the focus ring drew on the
								     link itself, inside a `truncate` box, which is
								     `overflow: hidden` and clips it on all four sides. Every
								     sibling that had to stay clickable carried its own
								     `relative` / `z-[1]`. `.tap-zone` / `.tap-link` is the
								     same geometry with the ring on the `::after` and the
								     raising done by rule — see the block in `app.css`.

								     ⛔ AND THE ZONE STOPS AT THE ROW. The `What changed`
								     disclosure below is deliberately OUTSIDE it: a tap zone
								     makes its own text unselectable, and that panel is a list
								     of commit subjects an operator copies. -->
								<!-- ⛔ SUPERSEDED (F5, DESIGN PASS 5). This grid used to carry a
								     FOURTH column (`sm:grid-cols-[…_auto]`) that pinned the
								     version pair flush right, independent of how much the
								     sentence in column 3 actually used. Measured: first-line
								     gaps up to 817px (68% of a 1199px row) between the sentence's
								     own end and the pinned pair. There is no fourth column now —
								     the pair joins the sentence itself (below), so the row packs
								     left and wraps like any other sentence instead of holding a
								     reserved lane for an object that is not always as wide as the
								     lane. -->
								<div
									class="tap-zone grid grid-cols-[28px_2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
								>
									<span
										class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
											entry.bakeStatus
										)}"
									>
										<!-- ⭐ THE DISC CARRIES THE ROLLBACK, SAME AS `/`'s.
										     (2026-09-02) `rollout-cards.ts`'s `cardStateMark`
										     swaps this glyph for `UndoOutline` on `/` and
										     `/rollouts`; this row used to always draw the plain
										     tick, even on the entry where production went
										     backwards — a green disc reading `deploy succeeded`
										     on a rollback nobody could see. Same component, same
										     `state`/`stateWord` contract, same hue: the deploy
										     DID succeed, only the shape changes. -->
										<BakeStatusIcon
											bakeStatus={entry.bakeStatus}
											size="small"
											state={entry.rollbackAct ? 'rolled-back' : null}
											stateWord="rolled back"
										/>
									</span>

									<span
										class="t-code-sm text-gray-500 tabular-nums dark:text-gray-400"
										title={formatDate(entry.timestamp)}
										>{formatTimeAgoCompact(entry.timestamp, $now)}</span
									>

									<!-- ── THE SUBJECT ─────────────────────────────────
									     `[ENV] name · state · prev → new`. The actor is
									     printed ONLY when a PERSON triggered it:
									     `rollout-controller` was the first word of all
									     39 rows, i.e. the norm, restated 39 times. -->
									<span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
										{#if entry.theme || entry.envLabel}
											<Chip
												role="env"
												theme={entry.theme}
												label={entry.envLabel || entry.envKey}
												wide
												class="shrink-0"
											/>
										{/if}
										<a
											href={entry.href}
											class="tap-link t-dense min-w-0 truncate font-semibold text-gray-900 dark:text-white"
											>{entry.displayName}</a
										>
										{#if needsNamespace(entry)}
											<span class="t-micro truncate text-gray-500 dark:text-gray-400"
												>in {entry.rolloutNamespace}</span
											>
										{/if}
										{#if word}
											<!-- The one-word state, with its sentence in the
											     `title` — this is the second half of the
											     `bake-status.ts` ruling. The word has to decline
											     into a four-item baseline row, so it cannot be a
											     phrase; the consequence that distinguishes
											     `checking` from `deploying` (already serving vs
											     still going out) is what `bakeTitle` carries. -->
											<span
												class="t-micro {STATE_INK[entry.bakeStatus] ?? ''}"
												title={bakeTitle(entry.bakeStatus)}>{word}</span
											>
										{/if}
										{#if entry.rollbackAct}
											<!-- THE WORD, AT REST — the same `Chip` every other domain
										     status on this row already uses, from the SAME
										     `history-marks.ts` object (`entry.rollbackAct.word` /
										     `.sentence`), so a rollback cannot be spelled two ways
										     between the two surfaces that both read `deployActs`.
										     This is the row `defect #2` names: it used to read
										     `064b655 → 1 BEHIND 0afab6f` with a green dot and no
										     mark at all, above a day rollup that called the whole
										     day `all fine`.

										     ⛔ SUPERSEDED (DESIGN PASS 2). This used to be a
										     hand-rolled `bg-gray-900` filled pill — the SAME fill
										     as the `7d` window pill and the `All` status filter
										     30 and 90px above it, so the loudest object on the
										     page meant "you clicked this" twice and "this deploy
										     went backwards" once. A domain STATUS may not share a
										     fill with a SELECTION state. `role="count"` is the
										     neutral, text-only tone `HELD`/`PINNED`/`1 BEHIND`
										     already use product-wide — going backwards is still a
										     fact about the deploy, not an alarm about it; only the
										     geometry moved onto the shared `.chip` (20px, 4px
										     radius — the SAME height every other chip on this row
										     draws, closing the 19px-vs-20px mismatch) instead of a
										     private `rounded-full` box. -->
											<Chip
												role="count"
												label={entry.rollbackAct.word}
												icon={rollbackIcon}
												title={entry.rollbackAct.sentence}
											/>
										{/if}
										<!-- ── WHAT IT CHANGED ─────────────────────────────
										     `prev → new`, the same pair `ActivityRail` prints.
										     ⛔ SUPERSEDED (F5, DESIGN PASS 5). This used to be its
										     own grid column, pinned flush right by a reserved
										     `auto` track independent of the sentence beside it —
										     measured up to 817px of empty row between the two.
										     It joins the sentence now, right where a reader
										     reading left to right expects "what changed": after
										     the name and the rollback mark, before who did it.

										     ⛔ AND (F7) THIS GROUP GETS `flex-wrap`, NOT
										     `shrink-0`. A first attempt gave the group `shrink-0`
										     to stop the CHIP inside it (`.chip-value` is
										     `min-width:0` and clips under shrink pressure) from
										     being individually squeezed — which fixed the
										     mid-token clip but, on a row carrying BOTH a struck
										     `prev` sha and a joined `[N BEHIND][sha]` badge (the
										     widest case: ~220px of content in a ~213px column at
										     390), traded it for the group overflowing the CARD's
										     own edge instead — same visual symptom, uncaught by a
										     `shrink-0` sanity check because nothing shrank. The
										     group is a nested flex-wrap box now: when the parent
										     sentence gives it less room than it wants, ITS OWN
										     children wrap onto a second sub-line (`prev →` above,
										     the chip below) instead of either the group
										     overflowing or the chip's value half compressing.
										     `min-w-0` stays so the group CAN be handed less than
										     its own content width; `shrink-0` on the CHIP itself
										     (`class="min-w-0 shrink-0"` below) is what stops the
										     shrink pressure from reaching inside the chip once
										     it, in turn, is alone on its own sub-line. -->
										{#if entry.previousVersion || entry.version}
											<span class="flex min-w-0 flex-wrap items-center gap-1">
												{#if entry.previousVersion}
													<span class="t-code-sm text-gray-500 line-through dark:text-gray-400"
														>{entry.previousVersion}</span
													>
													<span class="t-micro text-gray-500 dark:text-gray-400">→</span>
												{/if}
												{#if entry.version && entry.isLive}
													<!-- ⭐ THE VERDICT FIRST — the joined `[verdict][sha]`
													     unit `/` and `/rollouts` draw, from `env-rank.ts`.
													     ONLY on the row that is still live; see `ranks`. -->
													{@const rank = ranks.get(entry.rollout) ?? { kind: 'unknown' as const }}
													<Chip
														role={rankRole(rank)}
														label={rankLabel(rank)}
														title={rankTitle(rank, entry.displayName)}
														value={shortenVersion(entry.version)}
														valueHref={buildPath(
															repoKeyFromSource(entry.source, entry.rolloutName),
															entry.revision,
															entry.version
														)}
														valueTitle={entry.version}
														class="min-w-0 shrink-0"
													/>
												{:else if entry.version}
													<a
														href={buildPath(
															repoKeyFromSource(entry.source, entry.rolloutName),
															entry.revision,
															entry.version
														)}
														class="ident rev-sha t-code-sm text-gray-700 hover:underline dark:text-gray-200"
														>{entry.version}</a
													>
												{/if}
											</span>
										{/if}
										{#if entry.actorKind === 'User'}
											<span class="t-micro text-gray-500 dark:text-gray-400">by {entry.actor}</span>
										{/if}
										<!-- ── THE QUESTION THE OPERATOR ACTUALLY ASKS ─────────
										     ⛔ SUPERSEDED (DESIGN PASS 2, defect #2). This used to
										     be its own block BELOW the whole row, indented
										     `pl-[5.25rem]` — a second line on every entry that had
										     one, whatever room line 1 had to spare. Measured: the
										     largest gap between a row's first and last ink ran up
										     to 49% of a 1199px row, and the second line alone made
										     these rows 83px tall. It renders INLINE now, the row's
										     last first-line fact — `ChangeList`'s own `contents`
										     wrapper lets its trigger sit here while its panel (once
										     opened) still forces a full-width line via
										     `basis-full`. Renders nothing at all when there is no
										     prior revision to compare — an affordance for a
										     question with no answer is the defect this control
										     exists to close. -->
										{#if entry.source && entry.revision && entry.previousRevision}
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
										{/if}
									</span>
								</div>
							</li>
						{/each}
					</ul>
				</Card>
			{/each}
		</div>
	{/if}
</div>
