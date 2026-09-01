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
	 * CONTROL wore a STATE's hue. Fixed in the 2026-08-27 colour pass and
	 * VERIFIED HERE: both filter rows now share one near-neutral selected
	 * state (`gray-900` / `gray-100`). Nothing on this page is allowed to be
	 * louder than a failed deploy.
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
	import { pollWhenHealthy } from '$lib/api/errors';
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
		ExclamationCircleSolid
	} from 'flowbite-svelte-icons';
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
			options: { staleTime: 15000, refetchInterval: pollWhenHealthy(15000) }
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
					revision: h.version?.revision ?? null,
					previousRevision,
					source: rollout.status?.source ?? null,
					cluster: sourceClusterName(rollout) || localClusterName,
					isLive,
					rollout
				});
			}
		}
		return entries.sort(
			(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
		);
	});

	// ── FILTERS ────────────────────────────────────────────────────────────
	// Synced with ?env=&app=&ns= so a filtered feed is deeplinkable.
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
		kindFilter = 'all';
		goto('?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	const activeFilterCount = $derived(
		(envFilter ? 1 : 0) + (appFilter ? 1 : 0) + (nsFilter ? 1 : 0)
	);

	// THREE STATES, NOT FOUR. The old row was `All / Deploys / In progress /
	// Failures`, where `Deploys` meant Succeeded+Deploying — i.e. "everything
	// except failures", which is what `All` already is on a healthy cluster,
	// and it overlapped `In progress` on one of its two values. A filter whose
	// result a reader cannot predict is a filter they will not press.
	type KindFilter = 'all' | 'in_flight' | 'failed';
	let kindFilter = $state<KindFilter>('all');
	const KIND_FILTERS: { key: KindFilter; label: string; title: string }[] = [
		{ key: 'all', label: 'All', title: 'Every deploy in this window' },
		{
			key: 'in_flight',
			label: 'In flight',
			title: 'Deploys still going out or still being checked'
		},
		{ key: 'failed', label: 'Failed', title: 'Deploys that did not finish cleanly' }
	];
	function matchesKind(bakeStatus: string): boolean {
		if (kindFilter === 'all') return true;
		if (kindFilter === 'failed') return bakeStatus === 'Failed';
		return bakeStatus === 'InProgress' || bakeStatus === 'Deploying';
	}

	/** Everything the reader has scoped to, WITHOUT the time window. */
	const scoped = $derived(
		allEntries
			.filter((e) => !envFilter || e.envKey === envFilter)
			.filter((e) => !appFilter || e.rolloutName === appFilter)
			.filter((e) => !nsFilter || e.rolloutNamespace === nsFilter)
			.filter((e) => matchesKind(e.bakeStatus))
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

	const feed = $derived(scoped.filter((e) => inRange(e.timestamp)).slice(0, 60));

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
				triggeredBy: { kind: e.actorKind, name: e.actor }
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

	/**
	 * THE CARD'S ANSWER, TAKEN WITHOUT READING A ROW. `12 deploys · all fine`,
	 * `9 deploys · 1 failed`. Green ONLY when every deploy in the group
	 * finished cleanly — the same rule `/apps` applies to its tick.
	 */
	function groupRollup(entries: ActivityEntry[]) {
		const failed = entries.filter(isFailed).length;
		const flying = entries.filter(isInFlight).length;
		const n = entries.length;
		const noun = `${n} deploy${n === 1 ? '' : 's'}`;
		if (failed > 0) return { text: `${noun} · ${failed} failed`, tone: 'adverse' as const };
		if (flying > 0) return { text: `${noun} · ${flying} still going`, tone: 'active' as const };
		if (entries.every((e) => e.bakeStatus === 'Succeeded'))
			return { text: `${noun} · all fine`, tone: 'good' as const };
		return { text: noun, tone: 'neutral' as const };
	}

	const failedCount = $derived(feed.filter(isFailed).length);
	const flyingCount = $derived(feed.filter(isInFlight).length);
	const appCount = $derived(
		new Set(feed.map((e) => `${e.rolloutNamespace}/${e.rolloutName}`)).size
	);

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
<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
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
					deploy{feed.length === 1 ? '' : 's'} in {rangeLabel}
					{#if appCount > 0}
						· {appCount} rollout{appCount === 1 ? '' : 's'}
					{/if}
					{#if failedCount > 0}
						· <span class="font-medium text-gray-700 dark:text-gray-200">{failedCount} failed</span>
					{/if}
					{#if flyingCount > 0}
						· {flyingCount} still going
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
	     A TITLED CARD, not a bordered box. The rollup states the window the
	     whole page is scoped to, because the buttons inside this card also
	     govern the feed below it — a control with reach past its own container
	     has to say so somewhere the reader will look. -->
	{#if chartServices.length > 0}
		<Card
			icon={ChartLineUpOutline}
			title="When deploys happened"
			verdict={rangeLabel}
			verdictTitle="The window these buttons set. It also scopes the feed below."
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
	<div class="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2">
		{#each KIND_FILTERS as f (f.key)}
			<button
				type="button"
				aria-pressed={kindFilter === f.key}
				title={f.title}
				onclick={() => (kindFilter = f.key)}
				class="t-label rounded px-3 py-1 transition-colors
					{kindFilter === f.key
					? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
					: 'border border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
				>{f.label}</button
			>
		{/each}
		{#if knownEnvs.length > 0}
			<span class="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true"></span>
			{#each knownEnvs as e (e.key)}
				<button
					type="button"
					aria-pressed={envFilter === e.key}
					title={envFilter === e.key ? `Stop showing only ${e.label}` : `Show only ${e.label}`}
					onclick={() => setParam('env', envFilter === e.key ? null : e.key)}
					class="environment-theme-scope inline-flex items-center rounded transition-opacity
						{envFilter === e.key
						? 'ring-2 ring-gray-900/40 dark:ring-gray-100/40'
						: envFilter === null
							? ''
							: 'opacity-45 hover:opacity-100'}"
					style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
					><Chip role="env" theme={e.theme} label={e.label} wide /></button
				>
			{/each}
		{/if}
	</div>

	{#if appFilter || nsFilter}
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<span class="t-micro text-gray-500 dark:text-gray-400">Showing only:</span>
			{#if appFilter}
				<button
					type="button"
					onclick={() => setParam('app', null)}
					class="t-label inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-200 dark:hover:bg-gray-700"
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
					class="t-label inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-200 dark:hover:bg-gray-700"
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
					class="t-micro ml-1 text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
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
				<p class="t-dense mt-1 text-gray-500 dark:text-gray-400">
					Widen the window above, or clear the filters.
				</p>
				<button type="button" onclick={clearAllFilters} class="btn btn-secondary mt-4"
					>Clear the filters</button
				>
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
					verdictTitle="How many deploys landed in this window, and how many of them failed"
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
								<div
									class="tap-zone grid grid-cols-[28px_2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-gray-50 sm:grid-cols-[28px_2.75rem_minmax(0,1fr)_auto] dark:hover:bg-gray-700/30"
								>
									<span
										class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
											entry.bakeStatus
										)}"
									>
										<BakeStatusIcon bakeStatus={entry.bakeStatus} size="small" />
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
										{#if entry.actorKind === 'User'}
											<span class="t-micro text-gray-500 dark:text-gray-400">by {entry.actor}</span>
										{/if}
									</span>

									<!-- ── WHAT IT CHANGED ─────────────────────────────
									     `prev → new`, the same pair `ActivityRail`
									     prints. It used to be `was <s>f368353</s>`,
									     right-aligned off in a fifth column and hidden
									     entirely below `sm` — so on a phone two deploys
									     of the same app differed by nothing at all. -->
									<span
										class="col-start-3 flex min-w-0 shrink-0 items-center gap-1 sm:col-start-4 sm:row-start-1 sm:justify-self-end"
									>
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
												class="min-w-0"
											/>
										{:else if entry.version}
											<a
												href={buildPath(
													repoKeyFromSource(entry.source, entry.rolloutName),
													entry.revision,
													entry.version
												)}
												class="t-code-sm text-gray-700 hover:underline dark:text-gray-200"
												>{entry.version}</a
											>
										{/if}
									</span>
								</div>

								<!-- ── THE QUESTION THE OPERATOR ACTUALLY ASKS ─────────
								     Indented under the subject column. Renders nothing
								     at all when there is no prior revision to compare —
								     an affordance for a question with no answer is the
								     defect this whole component exists to close. -->
								{#if entry.source && entry.revision && entry.previousRevision}
									<div class="px-4 pb-2.5 pl-[5.25rem]">
										<ChangeList
											namespace={entry.rolloutNamespace}
											name={entry.rolloutName}
											cluster={entry.cluster}
											base={entry.previousRevision}
											head={entry.revision}
											source={entry.source}
										/>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</Card>
			{/each}
		</div>
	{/if}
</div>
