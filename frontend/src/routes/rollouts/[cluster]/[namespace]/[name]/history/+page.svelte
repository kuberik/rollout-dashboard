<script lang="ts">
	import NotFound from '$lib/components/NotFound.svelte';
	import { currentRowChip } from '$lib/view-models/history-current-chip';
	import { behindWhenSettled, fleetSettled } from '$lib/view-models/behind';
	import RolloutTabHeader from '$lib/components/RolloutTabHeader.svelte';
	import FailedCheckLine from '$lib/components/FailedCheckLine.svelte';
	import { displayTimeZone } from '$lib/timezone.svelte';
	import type {
		Rollout,
		Kustomization,
		ManagedResourceStatus,
		RolloutTest
	} from '../../../../../../types';
	import { Spinner } from 'flowbite-svelte';
	import Chip from '$lib/components/Chip.svelte';
	import {
		UndoOutline,
		ChevronDownOutline,
		ChevronUpOutline,
		LayersSolid,
		RefreshOutline,
		ChevronRightOutline,
		ChartLineUpOutline,
		ListOutline,
		LockSolid
	} from 'flowbite-svelte-icons';
	import {
		formatTimeAgo,
		formatTimeAgoCompact,
		formatDate,
		getDisplayVersion,
		extractDatadogInfoFromContainers,
		buildDatadogTestRunsUrl,
		buildDatadogLogsUrl
	} from '$lib/utils';
	import {
		changePathForRollout,
		displayVersionForTag,
		githubOwnerRepo,
		repoKeyFor
	} from '$lib/version-utils';
	import { rolloutEnvironmentName, rollbackTarget } from '$lib/view-models/deploy-risk';
	import { stripEmphasisMarkers } from '$lib/view-models/plain-text-note';
	import { isHistoryCurrentlyFailed } from '$lib/view-models/deploy-history';
	import { apiPath } from '$lib/api/urls';
	import { href } from '$lib/paths';
	/**
	 * ⛔ THE DEPLOY-STATE WORDS AND THEIR COLOUR ARE NOT THIS PAGE'S TO SPELL.
	 * (2026-09-01) The badge printed `entry.bakeStatus` RAW — `InProgress`,
	 * `Deploying`, `Cancelled`, and `Unknown` for the absent case — while every
	 * other surface in the product prints `bakeWord()`'s `checking`,
	 * `deploying`, `stopped`, `no deploy yet`. That is the fifth instance of
	 * the class `bake-status.ts` was written to close, and the last one in a
	 * page: a CRD field name is not English, and a reader cannot tell from
	 * `InProgress` whether anything is wrong. `statusBadgeColor` went with it —
	 * it was a byte-identical local copy of `getBakeStatusColor`.
	 */
	import { bakeWord, bakeTitle, getBakeStatusColor } from '$lib/bake-status';
	import {
		deployActs,
		historyAtLimit,
		isSystemDefaultNote,
		systemNoteDescription
	} from '$lib/history-marks';
	import {
		DEPLOY_PARAM,
		deployAnnouncement,
		findDeployIndex,
		autoExpandFailedLiveIndex
	} from '$lib/history-deeplink';
	import { announce } from '$lib/stores/announce.svelte';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import DiffLink from '$lib/components/DiffLink.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import ChangeVersionFlow from '$lib/components/ChangeVersionFlow.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import DatadogLogo from '$lib/components/DatadogLogo.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import RestGlyph from '$lib/components/RestGlyph.svelte';
	import DeploymentTimeline from '$lib/components/DeploymentTimeline.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList from '$lib/components/FactList.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import EventsCard from '$lib/components/EventsCard.svelte';
	import Card from '$lib/components/Card.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import CadenceStrip from '$lib/components/CadenceStrip.svelte';
	import { ledgerSpine } from '$lib/ledger-spine';
	import { wrapCompact } from '$lib/wrap-compact';
	import HistorySummaryCard from '$lib/components/HistorySummaryCard.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { actorFrom } from '$lib/actor';

	import { page } from '$app/stores';
	import { goto, afterNavigate, replaceState } from '$app/navigation';
	import { outageEscalation } from '$lib/view-models/outage-escalation.svelte';
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import { createQuery, createQueries } from '@tanstack/svelte-query';
	import { rolloutQueryOptions, rolloutsInNamespaceQueryOptions, rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey } from '$lib/api/github';
	import { commitQueryOptions } from '$lib/api/commit';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { pageTitle } from '$lib/page-title';
	import { buildTitle } from '$lib/view-models/build-title';

	const cluster = $derived(get(page).params.cluster as string);
	const namespace = $derived(get(page).params.namespace as string);
	const name = $derived(get(page).params.name as string);

	// ⭐ CLUSTER-AWARE — this rollout's own cluster, not the app-wide default's
	// fleet-wide "every cluster up" gate (this used to inherit that default
	// silently). See rollout detail Overview's identical comment.
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster,
			options: {
				refetchInterval: pollWhenHealthy(5000, 60000, cluster),
				staleTime: staleTimeWhenHealthy(1000, 30000, cluster)
			}
		})
	);

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	/** QA2 #9: the current row's position chip says CURRENCY when healthy, else its state (`currentRowChip`), never the retired state word "Live". */
	/** the fleet's Environments and rollouts: a build that failed upstream in this place's wave chain is not "behind" (batch4 #3b) */
	const fleetQuery = createQuery(() => rolloutsListQueryOptions({ options: { staleTime: 30000 } }));
	const currencyBehind = $derived(behindWhenSettled(rollout, { environments: fleetQuery.data?.environments?.items, rollouts: fleetQuery.data?.rollouts?.items }, fleetSettled(fleetQuery)));

	/**
	 * ⭐ "Changes" IS AN ORPHAN LABEL WHEN GITHUB ISN'T CONNECTED (AD round
	 * 1, item 8). `CommitSummary` fetches its own commit range and renders
	 * nothing useful without a connection — this cluster's own demo never
	 * has one (see the expanded panel's existing note) — so the row used
	 * to print its label with nothing credible after it. Same query key
	 * `YourChangesCard`/`ChangeList` already use (cached, not a second
	 * network round trip on a page that already shares the client).
	 */
	const githubStatusQuery = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000,
		refetchInterval: false as const
	}));
	const githubConnected = $derived(githubStatusQuery.data?.connected ?? false);
	const kustomizations = $derived(
		(rolloutQuery.data?.kustomizations?.items as Kustomization[]) || []
	);
	// PALROW r8 (AD palette r7 item 3): a full outage escalates to ErrorState
	// after two failed answers instead of retrying on the skeleton forever
	// (`view-models/outage-escalation.svelte.ts`). ErrorState gets the error
	// OBJECT, not its message, which is what lets it name the failure.
	const outage = outageEscalation(
		() => rolloutQuery,
		() => `${cluster}/${namespace}/${name}`
	);
	const loading = $derived(outage.loading);
	const error = $derived(outage.error);

	/**
	 * ⭐ D-22 — THE RAIL, REUSING THE OVERVIEW TAB'S OWN REGION. (2026-10-08,
	 * design reviewer.) This tab was a single full-width column at 1440 and
	 * 1920 — the one shape `lib/CLAUDE.md`'s consistency rule singles out
	 * ("a page ≥1024 is main plus rail"). The Overview tab, one click away,
	 * already pairs its own main content with a rail carrying `Resources`
	 * and `Recent events` (same object: this rollout, same `/events`
	 * endpoint) — so rather than inventing a new rail object for History,
	 * this reuses THAT one, verbatim, same component and same query shape.
	 * `Resources` is not duplicated here — it is current runtime state,
	 * which a deploy-HISTORY tab has no reason to restate — but the event
	 * log is exactly as relevant to "what happened on this rollout" here as
	 * it is on Overview.
	 */
	const eventsQuery = createQuery(() => ({
		queryKey: ['events', namespace, name, cluster],
		queryFn: async () => {
			const res = await fetch(apiPath(cluster, `/rollouts/${namespace}/${name}/events`));
			if (!res.ok) return { events: [] };
			return res.json();
		},
		refetchInterval: pollWhenHealthy(5000, 300_000, cluster)
	}));
	const events = $derived(eventsQuery.data?.events ?? []);
	/** Same anchor Overview's own `EventsCard` uses for its honest empty row
	 *  — the CURRENT deploy's own start, not this page's filtered window. */
	const eventsDeployedAt = $derived<Date | null>(
		rollout?.status?.history?.[0]?.timestamp ? new Date(rollout.status.history[0].timestamp) : null
	);

	// Environment data (shipped with rollout query response)
	const environment = $derived(rolloutQuery.data?.environment);
	const envInfos = $derived(environment?.status?.environmentInfos ?? []);
	/**
	 * ⭐ U-11 — THE SAME FALLBACK THE OVERVIEW TAB'S OWN HEADER CHIP USES.
	 * (2026-10-08, TL review.) `environment?.spec?.environment` alone left
	 * this tab's header chip blank on `checkout-worker-staging`: its
	 * `Environment` object carries `spec.label` but no `spec.environment`.
	 * `deploy-risk.ts`'s `rolloutEnvironmentName` walks the same fallback
	 * chain (`metadata.labels.environment`, the theme annotations, the
	 * namespace) the Overview tab's own `currentEnv` already resolves
	 * through — reused here rather than inventing a second one, so the two
	 * tabs show the same identity for the same rollout.
	 */
	const currentEnvName = $derived(
		rolloutEnvironmentName(rollout, environment?.spec?.environment) || null
	);
	const hasOtherEnvs = $derived(
		envInfos.filter((e) => e.environment !== currentEnvName).length > 0
	);

	/**
	 * ⛔ THE HEADER ENVIRONMENT CHIP IS GONE. (2026-10-08, TL review round 3
	 * — reverses the 2026-09-13 note this replaces.) The breadcrumb above
	 * the tab strip already carries identity — see `+layout.svelte`'s own
	 * chip, now resolved through the same `rolloutEnvironmentName` fallback
	 * this file uses for `currentEnvName` (U-11, fixed at the source in
	 * `environment-theme.ts`) — and the signed Overview tab's own header
	 * carries none either. Repeating it here was two heads for one object,
	 * the same defect the 2026-09-13 note was itself trying to close one
	 * level down (the per-row chip). `currentEnvName` survives: it still
	 * names the sibling-lane filter (`hasOtherEnvs`) and the comparison
	 * chart's own lane label below.
	 */

	/**
	 * ⭐ THE VIEW STATE IS DEEPLINKABLE, LIKE `/activity`'s OWN FILTERS.
	 * (2026-09-03, operator-walk finding 6) Neither the time-range preset nor
	 * these two toggles survived a reload or a paste — a reader who scoped
	 * this page to `7d` with siblings showing, then sent the link, sent a
	 * link back to the default `all` view instead. `?kind=env+ns` names
	 * which comparison lanes are on (`env` = `Show environments`, `ns` =
	 * `Compare namespace`); absent means neither, matching every other
	 * filter's "the default state writes nothing" rule.
	 */
	function parseKindParam(raw: string | null): { env: boolean; ns: boolean } {
		if (!raw) return { env: false, ns: false };
		return { env: raw.includes('env'), ns: raw.includes('ns') };
	}
	const initialKind = parseKindParam(get(page).url.searchParams.get('kind'));

	// Toggles: show sibling environments / compare rollouts across namespace
	let showEnvironments = $state(initialKind.env);
	let showComparison = $state(initialKind.ns);

	/** One place that writes a query param, shared by both URL-synced states below. */
	function setQueryParam(key: string, next: string | null) {
		const url = new URL(get(page).url);
		if (url.searchParams.get(key) === next) return;
		if (next) url.searchParams.set(key, next);
		else url.searchParams.delete(key);
		// `replaceState: true` — a brush drag on the chart or a fast double-toggle
		// must not spend a browser-history entry per intermediate value, unlike
		// `/activity`'s discrete filter chips.
		goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	$effect(() => {
		const parts = [showEnvironments ? 'env' : null, showComparison ? 'ns' : null].filter(
			(p): p is string => p !== null
		);
		setQueryParam('kind', parts.length > 0 ? parts.join('+') : null);
	});

	const nsRolloutsQuery = createQuery(() => ({
		...rolloutsInNamespaceQueryOptions({ namespace }),
		enabled: showComparison
	}));

	const nsRollouts = $derived(
		showComparison ? ((nsRolloutsQuery.data?.rollouts?.items as Rollout[]) ?? []) : []
	);

	// Managed resources for Datadog info
	let managedResources = $state<ManagedResourceStatus[]>([]);

	$effect(() => {
		const currentKustomizations = kustomizations;
		if (!currentKustomizations || currentKustomizations.length === 0) {
			managedResources = [];
			return;
		}
		Promise.all(
			currentKustomizations
				.filter((ks) => Boolean(ks.metadata?.name))
				.map(async (ks) => {
					const ksName = ks.metadata!.name as string;
					const ksNamespace = ks.metadata?.namespace || namespace;
					try {
						const res = await fetch(
							apiPath(cluster, `/kustomizations/${ksNamespace}/${ksName}/managed-resources`)
						);
						if (res.ok) {
							const data = await res.json();
							return (data.managedResources || []) as ManagedResourceStatus[];
						}
					} catch (e) {
						console.error(`Failed to fetch managed resources for ${ksName}:`, e);
					}
					return [] as ManagedResourceStatus[];
				})
		).then((results) => {
			if (kustomizations === currentKustomizations) {
				managedResources = results.flat();
			}
		});
	});

	const datadogTestInfo = $derived.by(() => {
		const rolloutTests = managedResources
			.filter((r) => r.groupVersionKind === 'rollout.kuberik.com/v1alpha1/RolloutTest')
			.map((r) => r.object as RolloutTest);
		if (rolloutTests.length === 0) return null;
		for (const test of rolloutTests) {
			const containers = test.spec?.jobTemplate?.template?.spec?.containers || [];
			const info = extractDatadogInfoFromContainers(containers);
			if (info) return info;
		}
		return null;
	});

	// Timeline state
	type PresetRange = '1h' | '6h' | '1d' | '7d' | '30d' | 'all';
	type TimeRange = PresetRange | { start: number; end: number };

	/**
	 * ⛔ THE WINDOW OPENED ON SIX EMPTY DAYS.
	 *
	 * A hard-coded `7d` on a page whose whole job is this rollout's history:
	 * measured on the live hub, five deploys spanning 38 hours drew as two
	 * smudges in the right-hand eighth of a 1,050px plot, under an axis whose
	 * first six ticks had nothing beneath them. A time axis that puts every
	 * event in one column is not showing time.
	 *
	 * `all` is not "everything ever" here — `DeploymentTimeline.computeBounds`
	 * reads it as FIT: earliest event to now, plus 5%. It is the only window
	 * that is right without knowing the data, and the presets are one click
	 * away when the reader wants a fixed one. No "stop auto-fitting once the
	 * reader touches it" latch is needed, unlike `/activity`: `all` is not a
	 * computed value that would fight the reader for the control, it is a
	 * window the chart re-derives from whatever data it has.
	 *
	 * ⭐ AND IT IS THE ONE STATE ON THIS PAGE `?deploy=` CANNOT DEEPLINK
	 * THROUGH. (2026-09-03, operator-walk finding 6) A reader who scoped the
	 * chart to `7d` to find a deploy, then copied the URL, sent a link back
	 * to `all` — the range was never written to the query string, unlike the
	 * `?deploy=` this page already deeplinks. `?range=7d` mirrors the preset
	 * name exactly; a brush-selected custom window (`{ start, end }`, not a
	 * preset) encodes as `?range=<start>-<end>` epoch ms so a reader who drew
	 * a precise window gets it back too, not just the nearest preset.
	 */
	function parseRangeParam(raw: string | null): TimeRange {
		if (!raw) return 'all';
		if (raw === '1h' || raw === '6h' || raw === '1d' || raw === '7d' || raw === '30d') return raw;
		const m = /^(\d+)-(\d+)$/.exec(raw);
		if (m) {
			const start = Number(m[1]);
			const end = Number(m[2]);
			if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { start, end };
		}
		return 'all';
	}
	let timeRange = $state<TimeRange>(parseRangeParam(get(page).url.searchParams.get('range')));

	$effect(() => {
		const encoded =
			typeof timeRange === 'object' ? `${timeRange.start}-${timeRange.end}` : timeRange;
		setQueryParam('range', encoded === 'all' ? null : encoded);
	});

	/**
	 * ⭐ THE STRIP'S DEFAULT RANGE — THE SMALLEST PRESET THAT ACTUALLY FITS
	 * THE DATA (round 5, squad lead's own decision, 2026-10-09, AD round 2
	 * item 1): "pick the range from the data span: incident = 1d (today
	 * 760 of 793px of the incident strip is empty)." Round 4's own rule
	 * ("7d when ≥2 deploys fall in it, otherwise All") was still wrong for
	 * a QUIET rollout: `checkout-worker-staging` has exactly 2 deploys
	 * total, both inside the last 7 hours, so "≥2 fall within 7d" was
	 * trivially true and opened on 7 days of near-empty track for 7 hours
	 * of real data. This tries each preset NARROWEST-first and takes the
	 * first one that already holds ≥2 deploys — `1d` for incident (both
	 * deploys are inside it), `7d` for a rollout like checkout-edge-prod
	 * whose own last 24h has only the one live deploy but whose last week
	 * has eight, `all` only when even 30 days can't find a second deploy
	 * to compare against the first.
	 */
	let pendingSmartDefault = $state(!get(page).url.searchParams.get('range'));
	$effect(() => {
		if (!pendingSmartDefault || !rollout) return;
		const history = rollout.status?.history ?? [];
		const times = history.map((e) => new Date(e.timestamp).getTime()).filter(Number.isFinite);
		const countWithin = (ms: number) => times.filter((t) => t >= Date.now() - ms).length;
		const DAY = 24 * 60 * 60_000;
		timeRange =
			countWithin(DAY) >= 2
				? '1d'
				: countWithin(7 * DAY) >= 2
					? '7d'
					: countWithin(30 * DAY) >= 2
						? '30d'
						: 'all';
		pendingSmartDefault = false;
	});
	let selectedEntry = $state<{ serviceId: string; index: number } | null>(null);

	/**
	 * WHAT EACH DEPLOY DID, not just how it ended. See `history-marks.ts`:
	 * index-aligned with `status.history`, `null` where the ordering cannot
	 * answer. This is what makes a rollback readable AT REST on the page whose
	 * job is history — `/` and `/rollouts` have flagged it at rest for weeks.
	 */
	const acts = $derived(deployActs(rollout));
	const rollbacks = $derived(acts.filter((a) => a?.kind === 'rollback').length);
	/** For `CadenceStrip`'s own marker (round 2, item 1): a rollback draws
	 *  as the neutral `UndoOutline`, not a dot — the strip reads `acts`
	 *  through this Set rather than re-deriving release ordering itself. */
	const rollbackIndices = $derived(
		new Set(acts.flatMap((a, i) => (a?.kind === 'rollback' ? [i] : [])))
	);

	// Build service rows for the chart
	const chartServices = $derived.by(() => {
		if (!rollout) return [];
		const current = {
			id: `${namespace}/${name}`,
			name: currentEnvName ? `${name} (${currentEnvName})` : name,
			// The chart carries the same fact the rows do: a mark that went
			// BACKWARDS is drawn with a ring and says so in its accessible name.
			// Sibling lanes get no mark — their `availableReleases` is a
			// different stream and this rollout's ordering cannot rank it.
			history: (rollout.status?.history ?? []).map((e, i) =>
				acts[i]?.kind === 'rollback' ? { ...e, mark: 'rollback' as const } : e
			),
			isCurrent: true
		};
		const rows: (typeof current)[] = [current];

		if (showEnvironments) {
			const envRows = envInfos
				.filter((env) => env.environment && env.environment !== currentEnvName)
				.map((env) => ({
					id: `env:${env.environment}`,
					name: env.environment,
					history: (env.history ?? []) as typeof current.history,
					isCurrent: false
				}));
			rows.push(...envRows);
		}

		if (showComparison) {
			const others = nsRollouts
				.filter((r) => r.metadata?.name !== name)
				.map((r) => ({
					id: `${r.metadata?.namespace}/${r.metadata?.name}`,
					name: r.metadata?.name ?? 'unknown',
					history: r.status?.history ?? [],
					isCurrent: false
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
			rows.push(...others);
		}

		return rows;
	});

	/**
	 * ⭐ THE LANE LABEL TRACK SIZES TO ITS OWN LONGEST NAME, UP TO ~220px.
	 * (2026-09-03, design pass 7, finding #17.) `DeploymentTimeline`'s
	 * default gutter (130px) truncated `hello-frontend-app (dev)` to
	 * `hello-frontend-a…` while the chart's own plot sat mostly empty beside
	 * it — an ellipsis drawn next to whitespace it could have used. Same
	 * `16 + chars * 6.7` estimate `/activity` derives its own
	 * `chartLabelWidth` from (that file's own note has the per-glyph
	 * measurement), ceilinged higher here (220 vs 168) because this page's
	 * lane names carry a parenthesised environment suffix `/activity`'s
	 * bare environment names never do.
	 */
	const chartLabelWidth = $derived(
		Math.min(
			220,
			Math.max(72, 16 + chartServices.reduce((m, s) => Math.max(m, s.name.length), 0) * 6.7)
		)
	);

	/**
	 * ⭐ TALLER LANES FOR A BUSIER ROLLOUT. (2026-10-08, TL review round 3.)
	 * Measured on `checkout-edge` (many deploys clustered near `now`): the
	 * default 52px lane gives `spreadOverlaps` a ±15px fan budget, which a
	 * run of 7+ same-week deploys cannot fit into at its 12px floor step —
	 * the marks piled into an unreadable stack instead of fanning clear.
	 * `DeploymentTimeline`'s own fan math (`maxOffset = ROW_H/2 - R_ACTIVE -
	 * 3`) scales directly with the row height it is given, so a busier
	 * current lane gets a taller row rather than a fixed one — scaled off
	 * the deploy COUNT (the chart has no cheaper signal for "how many will
	 * land in one cluster" before it has already laid the lane out), capped
	 * so a quiet rollout's chart stays its usual height.
	 */
	const chartRowHeight = $derived(
		Math.min(160, Math.max(52, 32 + (rollout?.status?.history?.length ?? 0) * 6))
	);

	// Filter history list by selected time range
	const filteredHistory = $derived.by(() => {
		const history = rollout?.status?.history ?? [];
		if (timeRange === 'all') return history.map((e, i) => ({ e, i }));
		if (typeof timeRange === 'object') {
			const { start, end } = timeRange;
			return history
				.map((e, i) => ({ e, i }))
				.filter(({ e }) => {
					const t = new Date(e.timestamp).getTime();
					return t >= start && t <= end;
				});
		}
		const msMap: Record<string, number> = {
			'1h': 3_600_000,
			'6h': 21_600_000,
			'1d': 86_400_000,
			'7d': 604_800_000,
			'30d': 2_592_000_000
		};
		const cutoff = Date.now() - msMap[timeRange];
		return history
			.map((e, i) => ({ e, i }))
			.filter(({ e }) => new Date(e.timestamp).getTime() >= cutoff);
	});

	/**
	 * ⭐ THE FOLD. (2026-10-08, TL review round 3.) `.btn-secondary btn-sm`,
	 * the product's one "show more" grammar — see any other dense list's own
	 * fold control. Five rows is the `/rollouts` list-row convention read
	 * onto this card: enough to see the rollout's recent shape without
	 * scrolling a long-lived rollout's whole retained window onto the page
	 * by default. `showAllDeploys` persists once set (the reader asked to
	 * see the rest; collapsing again on an unrelated re-render would be a
	 * surprise), and a deep link or chart click that targets a folded row
	 * unfolds it first — see `revealEntry`.
	 */
	const DEPLOY_FOLD_COUNT = 5;
	let showAllDeploys = $state(false);
	const visibleHistory = $derived(
		showAllDeploys ? filteredHistory : filteredHistory.slice(0, DEPLOY_FOLD_COUNT)
	);
	const foldedDeployCount = $derived(Math.max(0, filteredHistory.length - DEPLOY_FOLD_COUNT));
	const visibleDeployIdx = $derived(new Set(visibleHistory.map(({ i }) => i)));

	/**
	 * ⭐ GROUPED BY DAY (spec §1): "Today", "Yesterday", "Mon, Oct 6" — the
	 * `/rollouts` namespace subheader's own reference, read onto a list of
	 * one rollout's deploys instead of a list of rollouts. History is
	 * already sorted newest-first, so a day boundary only ever needs
	 * comparing against the PREVIOUS row's own day key — no separate sort.
	 * Keyed in `displayTimeZone()`, the same clock `clockTime` already
	 * renders every row in, so "Today" never disagrees with the row times
	 * printed under it.
	 */
	function dayKeyOf(ts: string): string {
		return new Date(ts).toLocaleDateString('en-CA', { timeZone: displayTimeZone() });
	}
	/** ⭐ EVERY DEPLOY THAT DAY, NOT JUST THE RENDERED ONES (AD round 7, nits:
	 *  "a day header counts the day's deploys, not the visible rows"). The
	 *  fold (`visibleHistory`, below) can cut a day's own row list in half —
	 *  `groupedVisible` used to count `group.items.length`, which is exactly
	 *  how many rows survived the fold, not how many deploys actually
	 *  happened that day. Built from `filteredHistory` (the full, unfolded,
	 *  range-scoped set the header meta and the Summary rail already use),
	 *  so a day subheader's own count can never shrink just because its
	 *  later rows are still behind "Show N earlier deploys". */
	const dayTotals = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read inside this one derived
		const m = new Map<string, number>();
		for (const item of filteredHistory) {
			const key = dayKeyOf(item.e.timestamp);
			m.set(key, (m.get(key) ?? 0) + 1);
		}
		return m;
	});
	const groupedVisible = $derived.by(() => {
		const todayKey = dayKeyOf(new Date($now.getTime()).toISOString());
		const yesterdayKey = dayKeyOf(new Date($now.getTime() - 86_400_000).toISOString());
		const groups: { key: string; label: string; total: number; items: typeof visibleHistory }[] =
			[];
		for (const item of visibleHistory) {
			const key = dayKeyOf(item.e.timestamp);
			const last = groups[groups.length - 1];
			if (last && last.key === key) {
				last.items.push(item);
				continue;
			}
			const label =
				key === todayKey
					? 'Today'
					: key === yesterdayKey
						? 'Yesterday'
						: new Date(`${key}T00:00:00`).toLocaleDateString('en-US', {
								weekday: 'short',
								month: 'short',
								day: 'numeric'
							});
			groups.push({ key, label, total: dayTotals.get(key) ?? 1, items: [item] });
		}
		return groups;
	});

	// Stats (over all history, not filtered)
	const allHistory = $derived(rollout?.status?.history ?? []);
	const totalDeploys = $derived(allHistory.length);

	/**
	 * ⭐ (2026-10-10, truth-bug fix; revised 2026-10-10, AD round 6 item 1)
	 * THE ROW'S COMMIT TITLE, FROM A REAL COMMIT — NOT A MOCK-ONLY
	 * `commitMessage` FIELD, AND NOT A COMPARE RANGE'S "LAST ITEM" EITHER.
	 *
	 * Two art directors independently found the same build titled
	 * differently in two places (`a02f1c4`'s row said "Add retry budget to
	 * payment webhook"; its own panel/diff/dialog said "Add dead-letter
	 * queue for failed checkout events") because the row read a hand-written
	 * mock field that `github-data.ts` — the thing every OTHER surface
	 * actually asks — had no way to agree with. The first fix asked a
	 * `base`/`head` COMPARE for the pair (`CommitSummary`'s own shape:
	 * `base` = the entry before this one in TIME, `head` = this entry) and
	 * read `headCommitTitle` — the range's LAST commit — assuming the range
	 * always walks forward. It doesn't: a ROLLBACK redeploys an OLDER
	 * release, so its own `head` (the rollback's sha) is chronologically
	 * BEHIND its `base` (the entry it replaced) — a range walked in that
	 * direction lists the commits being REVERTED, and the range's own last
	 * item is `base`'s commit, not the row's. Measured live: checkout-edge's
	 * `55f1a2c` (a rollback) read "Add retry budget to payment webhook" —
	 * `62d1c05`'s own title, the last item of the revert list between them —
	 * while the strip's hover card (a genuine single-sha lookup) correctly
	 * read `55f1a2c`'s own "Bump dependency lockfile".
	 *
	 * The fix: EVERY row's title is a single-sha LOOKUP of its own
	 * `version.revision` (`$lib/api/commit`'s `commitQueryOptions`, the same
	 * one-sha ask `github-data.ts` answers for the strip and for a ladder
	 * root) — never a two-sha compare, and never a rollback/redeploy special
	 * case to get it right. One query per history entry, batched under one
	 * `createQueries` call. The Change column's own `CommitSummary` keeps
	 * its SEPARATE `base`/`head` compare (it genuinely needs the whole
	 * commit RANGE between two deploys, not just one sha's title) —
	 * unaffected by this.
	 */
	const sourceOwnerRepo = $derived.by(() => {
		if (!rollout?.status?.source) return null;
		return githubOwnerRepo(repoKeyFor(rollout, name));
	});
	const rowCommitQueries = createQueries(() => ({
		queries: allHistory.map((entry) => ({
			...commitQueryOptions({
				owner: sourceOwnerRepo?.owner ?? '',
				repo: sourceOwnerRepo?.repo ?? '',
				sha: (entry.version?.revision as string | undefined) ?? '',
				cluster,
				enabled: githubConnected && !!sourceOwnerRepo && !!entry.version?.revision
			})
		})),
		// See ChangeVersionModal `pickerTitleQueries`: svelte-query 6.0.12 throws when a top-level result array shrinks by 2+.
		combine: (results) => ({ items: results.map((r) => ({ data: r.data })) })
	}));
	const rowTitleByIndex = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read inside this one derived
		const map = new Map<number, string | null>();
		allHistory.forEach((_, i) => {
			map.set(i, buildTitle(rowCommitQueries.items[i]?.data));
		});
		return map;
	});
	/** `allHistory`, with each entry's real commit title attached — the one
	 *  shape `CadenceStrip`'s hover card and this page's own rows both read,
	 *  so the two can never disagree about the same build's title again. */
	const historyWithTitles = $derived(
		allHistory.map((entry, i) => ({ ...entry, commitTitle: rowTitleByIndex.get(i) ?? null }))
	);
	/**
	 * ⛔ U-15 — AN IN-FLIGHT DEPLOY IS NOT A FAILURE A RATE WOULD HAVE SEEN
	 * YET. (2026-10-08.) `terminalHistory` scopes `succeeded`/`failed` to
	 * deploys that have REACHED a verdict — the deploy still checking right
	 * now is neither `Succeeded` nor `Failed`, and counting it either way
	 * would have misstated the header (measured live on
	 * `checkout-api/prod-us-east-2`, an in-flight deploy would have read as
	 * a 33% failure rate with zero actual failures).
	 *
	 * ⛔ AND THE HEADER NO LONGER PRINTS A RATE AT ALL. (2026-10-08, TL
	 * review.) `successRate` used to stand beside `N healthy`/`N failed` as
	 * a FOURTH clause that restated the same fact in a second ink — "4
	 * healthy" and "100% healthy" are one count, twice, both green; "1
	 * failed" and "50% healthy" are the same pair in red. `PageHeader`'s own
	 * three-fact budget (§3.2) is met by `succeeded`/`failed` alone now; see
	 * the `meta` snippet below.
	 */
	const terminalHistory = $derived(
		allHistory.filter((e) => e.bakeStatus === 'Succeeded' || e.bakeStatus === 'Failed')
	);
	const succeeded = $derived(terminalHistory.filter((e) => e.bakeStatus === 'Succeeded').length);
	const failed = $derived(terminalHistory.filter((e) => e.bakeStatus === 'Failed').length);
	/**
	 * ⭐ RED ONLY WHILE A FAILURE IS THE ROLLOUT'S CURRENT STATE (coordinator
	 * ruling 2026-10-10, the same predicate `ActivityRail`'s own day-header
	 * `open` tally, `fleet-pulse`'s `isCurrentFailure` and `DeployBars`'
	 * `resolved` all use). `allHistory`'s first entry WITH a timestamp is the
	 * rollout's newest deploy — not `allHistory[0]` blindly, since the
	 * controller can write an entry with no timestamp yet. `failed > 0` alone
	 * used to drive both the ink and the count below, which kept "1 failed"
	 * in danger ink forever after a later deploy fixed it.
	 */
	const openFailed = $derived(failed > 0 && isHistoryCurrentlyFailed(allHistory));

	/**
	 * ⛔ `spec.versionHistoryLimit` BOUNDS `status.history`, AND EVERY STAT
	 * ABOVE READS THAT ARRAY AS IF IT WERE THE WHOLE STORY. (2026-09-03,
	 * operator-walk finding 13.) `hello-world-dev/hello-world-app`'s own
	 * `versionHistoryLimit: 5` evicts its oldest entry every time a new deploy
	 * lands, so `totalDeploys`, `succeeded` and `failed` are all a measurement
	 * of the RETAINED WINDOW, not of the rollout's lifetime — and printing them bare
	 * states them as if they were. `historyAtLimit` is the same predicate
	 * `history-marks.ts` uses to decide whether the oldest surviving entry's
	 * "from" is unknown; here it gates whether the header has to say so.
	 */
	const atLimit = $derived(historyAtLimit(rollout));

	/**
	 * ⭐ THE CURRENT PIN STATE, IN THE HISTORY HEAD. (2026-09-03,
	 * operator-walk finding.) Pinning and clearing a pin do NOT append a
	 * `status.history` entry by themselves — verified live: clearing
	 * `hello-world-dev/hello-world-app`'s pin changed only
	 * `metadata.annotations['rollout.kuberik.com/deploy-message']` (which the
	 * next actual deploy overwrites) and `spec.wantedVersion`; `status.history`
	 * stayed at the same `id`. So a colleague reading History has no way to
	 * see "dev was pinned for 10 minutes" — there is no record to draw, and
	 * `deployActs` correctly draws nothing for an act that left no entry.
	 *
	 * The honest fallback: state the CURRENT pin, not a past that cannot be
	 * reconstructed. `wantedVersion` is the plain tag string (not a version
	 * object), same shape `rollout-cards.ts::cardStateMark` and `/apps` both
	 * already resolve through `displayVersionForTag`.
	 */
	const pinnedDisplay = $derived(
		rollout?.spec?.wantedVersion
			? displayVersionForTag(rollout, rollout.spec.wantedVersion) || rollout.spec.wantedVersion
			: null
	);

	/**
	 * ⭐ THE CADENCE STRIP'S OWN RANGE, READ FROM AND WRITTEN TO THE SAME
	 * `timeRange` THE LEDGER AND THE (now rare) comparison chart share.
	 * (2026-10-09, Lane H.) `CadenceStrip` only ever proposes a PRESET — it
	 * has no brush — so a custom `{start,end}` window (still reachable via
	 * the comparison chart's own drag-to-zoom) reads back to the strip as
	 * `all` rather than crashing the type, and writing a preset from the
	 * strip clears any custom window the chart had set.
	 */
	const cadenceRange = $derived(
		typeof timeRange === 'object' || timeRange === '1h' || timeRange === '6h' ? 'all' : timeRange
	);
	function setCadenceRange(r: '1d' | '7d' | '30d' | 'all') {
		timeRange = r;
	}

	/**
	 * ⭐ THE RAIL SUMMARY'S OWN THREE DERIVED FACTS — scoped to the SAME
	 * `filteredHistory` window the ledger and the strip show, not the
	 * rollout's whole retained history, so "last 30 days" actually
	 * describes the numbers beside it.
	 */
	/** The ledger Card's own range-scoped failed/rolled-back counts — see
	 *  the "ONE COUNT, STATED ONCE" note at its call site (AD round 2). A
	 *  script-level `$derived`, not a markup `{@const}`: this value is
	 *  read from the Card's `rollup` snippet, which is not itself the
	 *  immediate child of an `{#if}`/`{:else}`/`{#each}` the way `{@const}`
	 *  requires. */
	const rangeFailed = $derived(filteredHistory.filter(({ e }) => e.bakeStatus === 'Failed').length);
	const rangeRolledBack = $derived(
		filteredHistory.filter(({ i }) => acts[i]?.kind === 'rollback').length
	);
	/** The header meta's own range-scoped healthy count — AD round 3, item
	 *  1: "one range-scoped deploy count in the header meta." Mirrors
	 *  `succeeded` (terminal-only: Succeeded or Failed, never a mid-bake
	 *  entry) but over `filteredHistory` instead of the lifetime array. */
	const rangeSucceeded = $derived(
		filteredHistory.filter(({ e }) => e.bakeStatus === 'Succeeded').length
	);
	/** Whether the header meta's count clause is actually scoped (the range
	 *  narrows the set) — both the count and the failed/healthy clause
	 *  switch on this together so they never disagree about which window
	 *  they're describing. */
	const headerScoped = $derived(filteredHistory.length !== totalDeploys);
	const headerTotal = $derived(headerScoped ? filteredHistory.length : totalDeploys);
	const headerFailed = $derived(headerScoped ? rangeFailed : failed);
	const headerRolledBack = $derived(headerScoped ? rangeRolledBack : rollbacks);
	const headerSucceeded = $derived(headerScoped ? rangeSucceeded : succeeded);
	/**
	 * ⭐ THE PRIMARY "Roll back to X" IS `RolloutTabHeader`'S OWN NOW (AD
	 * round 4, "one rule for every tab" — it draws the button itself from
	 * the same `rollbackTarget` predicate, on every tab, at PRIMARY weight
	 * matching the Overview's banner). This tab only still needs
	 * `rollbackNow` to pre-select the right build when its own
	 * `?action=rollback` handler (below) opens the modal — never to draw a
	 * second button.
	 */
	const rollbackNow = $derived(rollbackTarget(rollout));
	const rangeWord = $derived({ '1d': '1d', '7d': '7d', '30d': '30d', all: 'all' }[cadenceRange]);
	const medianHealthyMs = $derived.by(() => {
		const durations = filteredHistory
			.map(({ e }) => {
				if (e.bakeStatus !== 'Succeeded' || !e.bakeEndTime) return null;
				const start = new Date(e.timestamp).getTime();
				const end = new Date(e.bakeEndTime).getTime();
				return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
			})
			.filter((n): n is number => n !== null)
			.sort((a, b) => a - b);
		if (durations.length === 0) return null;
		const mid = Math.floor(durations.length / 2);
		return durations.length % 2 === 0 ? (durations[mid - 1] + durations[mid]) / 2 : durations[mid];
	});
	const lastFailureAgo = $derived.by(() => {
		const f = filteredHistory.find(({ e }) => e.bakeStatus === 'Failed');
		return f ? `${formatTimeAgoCompact(f.e.timestamp, $now)} ago` : null;
	});
	/**
	 * ⭐ "Keeps up to N", ONLY WHEN AT THE LIMIT (round 3, item 5, squad
	 * lead, 2026-10-09). "last 40 deploys" while only 11 exist read as a
	 * contradiction — this is the RETENTION CEILING, not a count of what is
	 * actually on screen (`Deploys`, two tiles over, already states that).
	 * `atLimit` (`historyAtLimit`) is the same predicate the header's own
	 * "(retention limit)" aside already gates on, so the two never disagree
	 * about whether the ceiling is relevant right now.
	 */
	const keptLabel = $derived.by(() => {
		const limit = rollout?.spec?.versionHistoryLimit;
		return limit && atLimit ? `Keeps up to ${limit}` : null;
	});

	/**
	 * The card header's right-aligned rollup — the composition grammar's one
	 * most transferable move: a reader takes the card's answer without reading
	 * a row of it. Here the answer is the SPAN, because the span is what the
	 * old fixed `7d` window was lying about.
	 */
	const timelineRollup = $derived.by(() => {
		const ts = allHistory
			.map((e) => new Date(e.timestamp).getTime())
			.filter((n) => Number.isFinite(n))
			.sort((a, b) => a - b);
		if (ts.length === 0) return 'no deploys';
		const n = `${ts.length} deploy${ts.length === 1 ? '' : 's'}`;
		if (ts.length === 1) return n;
		return `${n} over ${spanLabel(ts[ts.length - 1] - ts[0])}`;
	});

	/**
	 * ⚠️ NOT `formatDurationMs`. Its coarsest bucket is a whole day, so a
	 * 37-hour span comes back as `1 day` — the SAME rounding this page is
	 * being fixed for. A rollup that states the span must not round the span
	 * away, so this keeps one unit of remainder. The shared formatter is
	 * correct for every one of its other callers and is not touched.
	 */
	/**
	 * ⭐ THE ROW IS A RECORD NOW, AND THIS IS THE FACT IT WAS MISSING.
	 * (2026-09-13, demo capture, lane 4.)
	 *
	 * MEASURED at 1920 on `/rollouts/dev/default/hello-world/history`: each
	 * `Deployments` row printed a 7-character sha on the left and a date on
	 * the right with **~1,300px of nothing between them** — the two ends of a
	 * 1,660px row and no record in the middle. Everything a reader would use
	 * to tell one deploy from another (who started it, how long it took to go
	 * healthy, what the person said they were doing) was already in the
	 * payload and was already rendered — 400px lower, inside a collapsed
	 * disclosure nobody opens on five rows.
	 *
	 * ONE FIGURE, NOT TWO. `lib/CLAUDE.md`'s own rule for the rail `dl` ("a
	 * `dd` HOLDS ONE FIGURE") applies to a list row for the same reason: a
	 * row that prints `10m deploying · 1m checking` makes the reader add up.
	 * The row states the total from the deploy's own timestamp to the moment
	 * the checks finished — the span an operator actually waited — and the
	 * split rides on the `title` for whoever wants it.
	 *
	 * ⛔ AND THE WORD IS THE PAGE HEADER'S OWN. The head band 500px up counts
	 * `4 healthy · 1 failed`, so the row says `healthy in 11m` and `failed
	 * after 10m` rather than introducing `succeeded`/`baked`/`green` as a
	 * second vocabulary for one fact. A deploy still in flight gets NOTHING:
	 * `bakeEndTime` is the end of the span and a span with no end is not a
	 * duration — `BakeStatusIcon` and the status badge already say it is
	 * running.
	 */
	/**
	 * ⭐ `outcome`/`rest`, NOT ONE `text` STRING (AD round 1, item 6): "the
	 * failed row prints 'deploy failed' red on line 1 AND 'failed after
	 * 1m' on line 2 — failure stated once, on line 2, 'Failed after 1m'
	 * with only 'Failed' in danger ink." Splitting the word from the
	 * duration lets the row colour exactly the word that needs it and
	 * nothing else — `rest` ("after 1m"/"in 1m") stays the row's own
	 * quiet ink. The row's line-1 state word is suppressed for a Failed
	 * entry entirely now (see the template), so this is the ONLY place
	 * "Failed" appears on a failed row.
	 */
	function deployWait(entry: {
		timestamp: string;
		bakeStartTime?: string;
		bakeEndTime?: string;
		bakeStatus?: string;
	}): { outcome: 'Failed' | 'Healthy'; rest: string; title: string } | null {
		const outcome: 'Failed' | 'Healthy' | null =
			entry.bakeStatus === 'Failed'
				? 'Failed'
				: entry.bakeStatus === 'Succeeded'
					? 'Healthy'
					: null;
		if (!outcome || !entry.bakeEndTime) return null;
		const t0 = new Date(entry.timestamp).getTime();
		const end = new Date(entry.bakeEndTime).getTime();
		if (!Number.isFinite(t0) || !Number.isFinite(end) || end <= t0) return null;
		const start = entry.bakeStartTime ? new Date(entry.bakeStartTime).getTime() : NaN;
		const title =
			Number.isFinite(start) && start > t0 && end > start
				? `${spanLabel(start - t0)} deploying, then ${spanLabel(end - start)} of checks.`
				: `Started ${clockTime(entry.timestamp)}, checks finished ${clockTime(entry.bakeEndTime)}.`;
		// ⭐ "Healthy at <time>", NOT "Healthy in <duration>" (AD round 9,
		// item 8) — a failed row still reads its DURATION ("Failed after
		// 1m": how long the reader waited before it gave up, the fact that
		// actually matters for a failure), but a healthy row now states
		// WHEN it went healthy (the absolute clock, `clockTime` — the same
		// one `Started`/`Checks finished` already use in the panel) rather
		// than how long it took, which `title` already carried for anyone
		// who wants it.
		const rest =
			outcome === 'Failed' ? `after ${spanLabel(end - t0)}` : `at ${clockTime(entry.bakeEndTime)}`;
		return { outcome, rest, title };
	}

	/**
	 * THE NOTE A PERSON LEFT, AND ONLY THAT — TWO GUARDS, BOTH NEEDED.
	 *
	 * ⛔ `isSystemDefaultNote` ALONE IS NOT ENOUGH HERE. It is the product's
	 * one JOIN on the DASHBOARD's own boilerplate (`Pinned version`, `Force
	 * deploy` — see `history-marks.ts`), which is written on actions a PERSON
	 * started, so `triggeredBy.kind === 'User'` and the message is still not
	 * theirs. But a deploy the CONTROLLER started carries the controller's
	 * sentence in the same field — measured live in mock mode, every
	 * `System` row printed `*Automatic deployment*` verbatim, three rows of
	 * identical boilerplate reading exactly like something a colleague typed.
	 * A note on a system deploy is by definition not a person's reason, so
	 * the row does not print one; `⚙ System` two facts to its left already
	 * says who did it and why there is nothing to read.
	 *
	 * ⚠️ NOTHING IS HIDDEN. The expanded panel below still prints the raw
	 * field under `Recorded note` / `System` for every entry, which is the
	 * tier that exists for exactly this (`AlertPanel`'s own footnote rule:
	 * the mechanism is AVAILABLE, not PRINTED).
	 */
	/**
	 * ⭐ (2026-10-10, truth-bug fix) WAS a `commitMessage` field read off the
	 * entry — a mock-only guess at the title that disagreed with the one
	 * `github-data.ts` actually answers (see `rowTitleByIndex`'s own doc
	 * comment, above `allHistory`). Now just that map, by this row's index.
	 */
	function commitTitleOf(i: number): string | null {
		return rowTitleByIndex.get(i) ?? null;
	}

	/**
	 * ⭐ (2026-10-11, AD round 7 item 1) THE BARE-SHA LOOKUP'S OWN AUTHOR —
	 * the one fact the old "Commit: {title}" fallback could never show,
	 * because it read nothing but `buildTitle`'s (title-only) return value.
	 * `rowCommitQueries[i]` is the exact same single-sha query
	 * `commitTitleOf` already reads for its title; `Commit.author` (`$lib/
	 * api/commit`) comes free on the same response — no second request.
	 */
	function commitAuthorOf(i: number): string | null {
		return rowCommitQueries.items[i]?.data?.author ?? null;
	}

	function deployNote(
		message: string | undefined | null,
		by: { kind?: string } | undefined | null
	): string | null {
		if (!message || by?.kind !== 'User' || isSystemDefaultNote(message)) return null;
		return message;
	}

	function spanLabel(ms: number): string {
		const m = Math.floor(ms / 60_000);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
		const d = Math.floor(h / 24);
		return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
	}

	/**
	 * ⭐ THE RUNNING ROW'S OWN LIVE DURATION (round 2, squad lead, 2026-10-09,
	 * item 5). `deployWait` only ever answers for a deploy that has REACHED a
	 * verdict (it reads `bakeEndTime`); the row still in flight has none yet,
	 * so this is a second, narrower clock: "Checking for 33m" / "Deploying
	 * for 2m", ticking off `now` rather than a recorded end. It replaces the
	 * row's own `checking`/`deploying` STATE WORD (now suppressed on the
	 * current row — the header pill already states it) with something that
	 * earns its place: not the state again, but how long it has held it.
	 */
	function liveStatusWait(
		entry: { timestamp: string; bakeStatus?: string },
		nowMs: number
	): { text: string; title: string } | null {
		const word =
			entry.bakeStatus === 'InProgress'
				? 'Checking for'
				: entry.bakeStatus === 'Deploying'
					? 'Deploying for'
					: null;
		if (!word) return null;
		const t0 = new Date(entry.timestamp).getTime();
		if (!Number.isFinite(t0)) return null;
		const elapsed = Math.max(0, nowMs - t0);
		return {
			text: `${word} ${spanLabel(elapsed)}`,
			title: `${word.toLowerCase()} ${spanLabel(elapsed)} so far.`
		};
	}

	// Expanded entry state
	let expandedIdx = $state<Set<number>>(new Set());
	function toggleExpand(i: number) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy that is assigned back to the $state, not mutated in place
		const next = new Set(expandedIdx);
		next.has(i) ? next.delete(i) : next.add(i);
		expandedIdx = next;
	}

	// Element refs for scroll-to-entry
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- DOM ref registry, never rendered, so it needs no reactivity
	const listEntryEls = new Map<number, HTMLElement>();
	function registerEntry(node: HTMLElement, idx: number) {
		listEntryEls.set(idx, node);
		return {
			update(newIdx: number) {
				listEntryEls.set(newIdx, node);
			},
			destroy() {
				listEntryEls.delete(idx);
			}
		};
	}

	/**
	 * ⭐ THE FOLD KEEPS FOCUS. (2026-10-09, TL review round 4, QA-4.)
	 * Measured: Enter on "Show N earlier deploys" removed the button from
	 * the DOM mid-keypress with nothing to catch focus, so it fell to
	 * `<body>` — a keyboard reader who just asked to see more rows landed
	 * nowhere, on a page that had in fact changed under them. The button's
	 * own replacement is the first row it revealed (`DEPLOY_FOLD_COUNT`,
	 * i.e. position 5 of `filteredHistory`), computed BEFORE `showAllDeploys`
	 * flips so it names the right entry regardless of what unfolds. Same
	 * `tick()` + `requestAnimationFrame` handoff `revealEntry` already uses
	 * for the identical "the target isn't in the DOM yet" problem.
	 */
	function expandFold() {
		const firstNewIdx = filteredHistory[DEPLOY_FOLD_COUNT]?.i;
		showAllDeploys = true;
		tick().then(() => {
			requestAnimationFrame(() => {
				if (firstNewIdx === undefined) return;
				listEntryEls.get(firstNewIdx)?.querySelector<HTMLElement>('.tap-link')?.focus();
			});
		});
	}

	// Rollback modal
	let showChangeVersionModal = $state(false);
	let selectedVersionTag = $state<string | null>(null);
	let deployExplanation = $state('');
	/**
	 * ⭐ PALROW r9 (squad-rollout, 2026-10-11; History lane's round-6 handler,
	 * only this hunk): the palette's generic "Change version…" lands HERE when
	 * the reader is on History (`?action=change-version`), and the header's
	 * "Roll back" uses `?action=rollback`. Every row-triggered open on this
	 * page pins a specific build, so pin mode defaults `true`; only the
	 * generic request sets it `false`, and closing the dialog restores it so
	 * a later row's "Roll back to this" is a pin again.
	 */
	let isPinVersionMode = $state(true);
	$effect(() => {
		if (!showChangeVersionModal) isPinVersionMode = true;
	});

	/**
	 * The exact clock, at the resolution the rows are actually spaced at.
	 * `Aug 30, 23:09` / `Aug 30, 23:15` — the two deploys that both read `1d`.
	 * 24-hour and no seconds: this is a list to scan, not a log to correlate,
	 * and `formatDate` (full, with seconds) is still on the row's `title` and
	 * in the expanded panel for when someone needs to correlate.
	 */
	function clockTime(ts: string): string {
		const d = new Date(ts);
		if (isNaN(d.getTime())) return '—';
		return d.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: displayTimeZone()
		});
	}

	/**
	 * ⛔ TWELVE CHARACTERS ON THIS TAB, SEVEN ON EVERY OTHER SURFACE.
	 * (2026-09-01) The overview tab one click away — the page the human calls
	 * beautiful — has the same function returning `substring(0, 7)`, and
	 * `/versions`, `/apps` and the revision pages all print `9f10e49`. One
	 * fact, two spellings, on two tabs of one page: the reader had to check
	 * character counts to see that `9f10e49ab12c` and `9f10e49` were the same
	 * commit. Seven, like everywhere else. The `@sha1:` strip is kept — it is
	 * the OCI form and the shared `shortRevision` does not handle it.
	 */
	function formatRevision(revision: string) {
		const r = revision.includes('@sha1:') ? revision.split('@sha1:')[1] : revision;
		return r.length > 7 ? r.substring(0, 7) : r;
	}

	/**
	 * ⭐ ONE WAY TO REVEAL AN ENTRY, AND TWO THINGS THAT CALL IT.
	 *
	 * The chart has scrolled-and-expanded a row since this page was built. The
	 * deep link from rollout detail's commits rollup needs exactly the same
	 * three effects, so it uses the same function rather than a second copy
	 * that drifts — `registerEntry`'s map is the one element registry and
	 * `selectedEntry` is the one "you are looking at this" state.
	 *
	 * `focus` is the only difference between the two callers, and it is
	 * deliberate:
	 *
	 *  · ARRIVING FROM A LINK, the reader asked for this row and nothing else
	 *    on the page has their attention, so focus moves ONTO it. It lands on
	 *    the row's `.tap-link` — the disclosure button — which is the control
	 *    that undoes what just happened, and whose `:focus-visible::after`
	 *    draws `app.css`'s ring around the WHOLE row. No new highlight idiom:
	 *    the blue border is the chart's existing selected treatment and the
	 *    ring is the product's existing focus treatment.
	 *  · CLICKING A CHART MARK, focus is already on the chart and the reader is
	 *    still working in it. Yanking it into the list would break arrow-key
	 *    traversal of the very control they are using. It scrolls and expands,
	 *    as it always has.
	 *
	 * Both announce, because in both cases the thing that changed is 500px
	 * below and a screen-reader user is otherwise told nothing at all.
	 */
	function revealEntry(index: number, opts: { focus?: boolean } = {}) {
		const history = rollout?.status?.history ?? [];
		const entry = history[index];
		if (!entry) return;
		// ⭐ THE FOLD OPENS FOR A DEEP LINK OR A CHART CLICK. A row past the
		// fold is not rendered at all until it does — see `visibleDeployIdx`.
		if (!visibleDeployIdx.has(index)) showAllDeploys = true;
		selectedEntry = { serviceId: `${namespace}/${name}`, index };
		const wasOpen = expandedIdx.has(index);
		expandedIdx = new Set([...expandedIdx, index]);
		// Polite, not assertive — this is the reader's own action landing, not an
		// alarm. The sentence itself lives in `history-deeplink.ts` so the words
		// have a test rather than only a render.
		announce(
			deployAnnouncement({
				version: getDisplayVersion(entry.version),
				when: clockTime(entry.timestamp),
				index,
				total: history.length,
				wasOpen
			})
		);
		// The row may not exist yet on a direct load: the list renders from the
		// same query this is reacting to. `tick()` flushes the render, and the
		// frame after it is when the expanded panel has its height, so the
		// scroll lands where the row will actually be.
		tick().then(() => {
			const el = listEntryEls.get(index);
			if (!el) return;
			requestAnimationFrame(() => {
				// ⛔ `nearest` IS WRONG FOR AN ARRIVAL AND RIGHT FOR A CLICK.
				// Measured at 390: the deep-linked row was already just inside the
				// viewport, so `nearest` moved nothing and the fold sliced the
				// expanded panel — the reader landed on the row's header and none
				// of the changes they had followed the link to read. `start` puts
				// the row's top edge under the sticky chrome (`scroll-mt-28` on the
				// row) with the body below it, and does nothing at all on a page
				// that already fits. The chart keeps `nearest`: there the row is a
				// destination the reader can see the whole page around, and hauling
				// the list under a mark they just clicked is disorienting.
				//
				// ⛔ AND THE ARRIVAL IS NOT ANIMATED. `behavior: 'smooth'` measured
				// as NO SCROLL AT ALL here: the list's scroll container is four
				// ancestors up (`min-w-0 flex-1 overflow-y-auto pb-16`), and a
				// smooth scroll queued on it during hydration loses to the
				// framework's own scroll handling — `scrollTop` stayed 0 through
				// eight frames while the same call with `auto` landed it at 389.
				// It is also the right behaviour on its own terms: the reader never
				// saw the position we would be animating away from, so an animation
				// is a delay with nothing to show. The chart keeps `smooth`, where
				// the reader IS watching and the travel is the point.
				el.scrollIntoView({
					behavior: opts.focus ? 'auto' : 'smooth',
					block: opts.focus ? 'start' : 'nearest'
				});
				if (opts.focus) {
					el.querySelector<HTMLElement>('.tap-link')?.focus();
				}
			});
		});
	}

	/**
	 * SPEC §7's strip hover card asks the same two questions each ledger row
	 * already answers inline — these two helpers give the strip the exact
	 * same gating, rather than re-deriving it a second way.
	 */
	function diffHrefForIndex(index: number): string | undefined {
		const history = rollout?.status?.history ?? [];
		const entry = history[index];
		if (!entry || index >= history.length - 1) return undefined;
		return href(
			`/rollouts/${cluster}/${rollout?.metadata?.namespace}/${rollout?.metadata?.name}/diff/${entry.version.tag}`
		);
	}
	function openRollbackModalFor(index: number) {
		const history = rollout?.status?.history ?? [];
		const entry = history[index];
		if (!entry) return;
		selectedVersionTag = entry.version.tag;
		deployExplanation = '';
		showChangeVersionModal = true;
	}

	function handleChartEntryClick(serviceId: string, index: number) {
		const currentSvcId = `${namespace}/${name}`;
		if (serviceId !== currentSvcId) return;
		revealEntry(index);
	}

	/**
	 * ⭐ THE DEEP LINK, AND IT HAS TO SURVIVE A DIRECT LOAD.
	 *
	 * Same shape as `/apps/<name>`'s `?release=<env>`: read the param, resolve
	 * it against data that arrives asynchronously, act once. The `handled` latch
	 * is keyed on the URL rather than on a boolean so that following a second
	 * link — or the same one with a different deploy — fires again, while the
	 * five-second rollout poll re-running this effect does not re-steal focus
	 * from a reader who has since clicked elsewhere.
	 *
	 * On a DIRECT load (pasted URL, opened in a new tab) `rollout` is null on
	 * the first run and the effect simply does nothing; it re-runs when the
	 * query resolves, by which point `filteredHistory` — `all` by default, so
	 * no row is filtered out — has rendered the rows and `registerEntry` has
	 * put them in the map.
	 */
	let deepLinkHandled = $state<string | null>(null);
	$effect(() => {
		const url = $page.url;
		const want = url.searchParams.get(DEPLOY_PARAM);
		if (!want) return;
		const history = rollout?.status?.history;
		if (!history || history.length === 0) return;
		// ⚠️ THE ACTION IS PART OF THE KEY (fixed round 7). A plain
		// `${pathname}?${want}` key could not tell `?deploy=X` (reveal) from
		// a LATER `?deploy=X&action=rollback` (open the modal, the diff
		// page's "Roll back to {from}") apart once `X` had already been
		// revealed once — the second visit's own rollback intent was
		// silently swallowed because the first visit's key already matched.
		const key = `${url.pathname}?${want}:${url.searchParams.get('action') ?? ''}`;
		if (deepLinkHandled === key) return;
		const idx = findDeployIndex(history, want);
		// ⛔ NOT `deepLinkHandled = key` BEFORE THIS. A key that names no entry
		// in the history we have RIGHT NOW may name one in the next poll —
		// latching here would silently swallow a link to a deploy that had not
		// been written to `status.history` yet.
		if (idx < 0) return;
		deepLinkHandled = key;
		revealEntry(idx, { focus: true });
		// ⭐ `?deploy=<tag>&action=rollback` (AD round 3, diff page item 2):
		// "Roll back to {from}" on the diff page — the ChangeVersionModal
		// rollback flow lives here, not on the diff page itself, so that
		// button is a plain link to this URL shape rather than a second
		// copy of the modal. Reuses the exact entry this same param already
		// resolved, so it can never target a different build than the row
		// that just got revealed.
		// `action` stays in the URL on purpose: stripping it here races the
		// range param's async `goto` (setQueryParam), which rewrites the URL from
		// the pre-strip copy and re-fires this effect in a loop (2026-10-25). The
		// URL is a link to "open this rollback"; a reload re-follows it.
		if (url.searchParams.get('action') === 'rollback') openRollbackModalFor(idx);
	});

	/**
	 * ⭐ INCIDENT PRESENCE (AD round 9, item 7): "when the live entry has
	 * failed, it opens expanded by default, so its failed checks and
	 * actions fill the first screen." A reader who lands on History mid-
	 * incident used to see exactly what a calm reader sees — a one-line
	 * row, collapsed — and had to know to click it to find out WHAT failed
	 * and what to do about it. Latched (`autoExpandedFailure`) so this
	 * fires once per mount, not every 5s rollout poll once the reader has
	 * since collapsed it back by hand.
	 *
	 * ⛔ DEFERS TO AN EXPLICIT `?deploy=` LINK ENTIRELY (the item's own
	 * "respect an explicit ?deploy= deep link") — checked first and, if
	 * present, this effect does nothing at all, even if that link points
	 * at a DIFFERENT entry than the failed live one: a reader who followed
	 * a specific link asked for that row, not whichever one this page
	 * would have opened on its own.
	 *
	 * ⛔ EXPANDED IN PLACE, NEVER SCROLLED TO (Logs AD round 9, item D1,
	 * binding, 2026-10-12): "History must open at scroll 0… remove any
	 * scrollIntoView or focus-scroll the auto-expand triggers." This used
	 * to call `revealEntry(0)` — the SAME function a `?deploy=` link or a
	 * chart click uses, which also scrolls the row into view and announces
	 * it. The live entry is already the FIRST row on the page, a few
	 * pixels under the header; scrolling to it on a cold load moved the
	 * reader's own scroll position for no reason (the row was already on
	 * screen) and stole the announcer's one utterance from an action the
	 * reader didn't take. Mutates `expandedIdx` directly instead — the
	 * exact same state `toggleExpand`'s own click handler sets, with
	 * neither the scroll nor the announce `revealEntry` adds on top. A
	 * `?deploy=` link keeps calling `revealEntry` above, unchanged — that
	 * scroll is the reader's own requested arrival, not an unrequested one.
	 */
	let autoExpandedFailure = $state(false);
	$effect(() => {
		if (autoExpandedFailure) return;
		const idx = autoExpandFailedLiveIndex(
			rollout?.status?.history,
			!!$page.url.searchParams.get(DEPLOY_PARAM)
		);
		if (idx === null) return;
		autoExpandedFailure = true;
		expandedIdx = new Set([...expandedIdx, idx]);
	});

	/**
	 * ⭐ PALROW r9: `?action=change-version` and `?action=rollback`, the same
	 * pending-flag pattern the Overview's own handler uses. `afterNavigate`
	 * fires on a same-route, query-only `goto()` (a plain `$effect` reading
	 * the URL would miss a SECOND identical request from an already-mounted
	 * tab); the initial value covers a cold load that already carries the
	 * param, which `afterNavigate` never reports. Each effect waits for
	 * `rollout`, opens the flow once, and strips the param.
	 */
	let changeVersionPending = $state(get(page).url.searchParams.get('action') === 'change-version');
	let rollbackPending = $state(get(page).url.searchParams.get('action') === 'rollback');
	afterNavigate(() => {
		const action = get(page).url.searchParams.get('action');
		if (action === 'change-version') changeVersionPending = true;
		if (action === 'rollback') rollbackPending = true;
	});
	function clearActionParam() {
		const url = new URL(get(page).url);
		url.searchParams.delete('action');
		replaceState(url, {});
	}
	$effect(() => {
		if (changeVersionPending && rollout) {
			changeVersionPending = false;
			selectedVersionTag = null;
			deployExplanation = '';
			isPinVersionMode = false;
			showChangeVersionModal = true;
			clearActionParam();
		}
	});
	$effect(() => {
		// ⛔ `?deploy=X&action=rollback` belongs to the deep-link handler
		// above, which opens the modal on X. Letting this effect run too
		// overwrote the selection with `rollbackNow` (a production rollback
		// on the wrong build). Only a bare `?action=rollback` lands here.
		if (rollbackPending && $page.url.searchParams.get(DEPLOY_PARAM)) {
			rollbackPending = false;
			return;
		}
		if (rollbackPending && rollout && rollbackNow) {
			rollbackPending = false;
			selectedVersionTag = rollbackNow.tag;
			deployExplanation = '';
			isPinVersionMode = false;
			showChangeVersionModal = true;
			clearActionParam();
		}
	});
</script>

<svelte:head>
	<title>
		{pageTitle(
			rollout?.metadata
				? `${rollout.metadata.name} (${rollout.metadata.namespace}) History`
				: 'Rollout History'
		)}
	</title>
</svelte:head>

<div class="bg-ground h-full w-full">
	{#if loading}
		<!--
			⭐ THE SAME SKELETON VOCABULARY AS THE SIBLING OVERVIEW TAB, NOT A
			LONE CENTRED SPINNER. (2026-09-04, load-state audit finding 11)
			This tab and Overview share one object (the rollout) one tab
			apart, and a reader who switches tabs mid-load saw two different
			loading languages for it — a full composition on one, a bare
			`<Spinner>` on the other. This reserves the header row, then
			`Deployment Timeline` (measured 1201×253) and `Deployments`
			(1201×373, divided rows at the real ~65px row height) in the
			product's own `CardSkeleton` vocabulary.
		-->
		<div class="mx-auto w-full px-4 py-6 sm:px-6">
			<div class="mb-5 flex flex-wrap items-start justify-between gap-4" aria-hidden="true">
				<div class="flex flex-col gap-2">
					<span class="skel-block h-6 w-48"></span>
					<span class="skel-block h-3.5 w-64"></span>
				</div>
			</div>
			<CardSkeleton titleWidth="w-40" rollupWidth="w-24" bodyHeight={174} class="mb-5" />
			<CardSkeleton titleWidth="w-28" rollupWidth="w-32" rows={5} rowHeight={58} padded={false} />
		</div>
	{:else if error}
		<!-- ⭐ ITEM 3: THE SAME RAIL AS EVERY OTHER TAB. No `backHref`/`backLabel`
		     here used to mean the DEFAULT ('/', "Back to all rollouts") — a
		     label that does not match its own href, and `ErrorState`'s own
		     `backHref !== href('/')` guard then hid the "Home" row too.
		     No wrapper: `ErrorState` supplies its own rollout-page inset. -->
		<ErrorState
			{error}
			subject="this rollout's history"
			backHref={href('/rollouts')}
			backLabel="Back to all rollouts"
			onRetry={() => outage.retry()}
			isRetrying={outage.isRetrying}
		/>
	{:else if !rollout}
		<!-- The calm not-found composition the Overview tab uses (NotFound.svelte):
		     same object, same words, same way out — no banner, no hue. -->
		<NotFound
			eyebrow="Rollout"
			title={name}
			headline="This rollout does not exist"
			nextStep="It may have been deleted, or the address may be wrong."
			facts={[
				{ label: 'Rollout', value: `${namespace}/${name}`, handle: true },
				...(cluster ? [{ label: 'Cluster', value: cluster, handle: true }] : []),
				{ label: 'Server answered', value: 'not found' }
			]}
			backHref={href('/rollouts')}
			backLabel="Back to all rollouts"
		/>
	{:else}
		<!-- The product's one content container — see the rollout Overview tab.
		     ⛔ IT USED TO CARRY `flex-1 overflow-y-auto` AND THAT MADE IT THE ONE
		     CONTAINER IN THE PRODUCT THAT COULD EAT ITS OWN RIGHT PADDING. A
		     scroll container's scrollbar is taken out of its CONTENT box, so on
		     any platform with classic (non-overlay) scrollbars this page's inset
		     would have been 24px on the left and 24 + a scrollbar on the right —
		     asymmetric padding, which reads as a margin exactly the way a wrong
		     `max-w-*` does. It was also dead: this element is not a flex item,
		     and the comment on `scrollToEntry` above already records that the
		     list's real scroll container is four ancestors up. Removed rather
		     than styled around. -->
		<div class="mx-auto w-full px-4 py-6 sm:px-6">
			<!--
				REFERENCE REGION: `PageHeader` object form, the exact component
				and slot shape the Overview tab opens with one click away
				(`title`/`titleAfter`/`identity`/`meta`) — this tab is the same
				object, so it gets the same head rather than a second dialect.

				⛔ THE OLD TITLE SAID WHAT THE TAB BAR 40px ABOVE IT ALREADY SAID.
				(2026-09-01) From the human, about `/versions`: *"i think i don't
				like that we have a title on the page when it's already in the
				navbar."* `PageHeader`'s own `h1` is the rollout's NAME, which the
				tab strip does not say — "Deployment history" is nowhere on the
				page now, voiced or not, because the tab strip already carries it.
			-->
			<RolloutTabHeader
				{name}
				{rollout}
				quietRollback
				rollbackHref={href(`/rollouts/${cluster}/${namespace}/${name}/history?action=rollback`)}
			>
				<!-- ⭐ ONE ACTION SET ON EVERY TAB (LOGOPEN r11, item 4): History,
				     Gates and Logs carry the same header move, Roll back, rightmost
				     (failed: the primary; calm: the secondary "Roll back to <sha>",
				     `quietRollback`). View on GitHub and Change version live on the
				     Overview, one tab away; a second copy here made History's header
				     a different object from its siblings'. `rollbackHref` keeps the
				     modal in this page (`?action=rollback` handler below). -->
				{#snippet meta()}
					<!--
						⭐ `metaSeparated` NOW, NOT HAND-WRITTEN "·" SPANS. (2026-10-09,
						TL review round 4, design-review-5.) Four `<span
						aria-hidden="true">·</span>` nodes between facts is exactly
						the orphan-separator risk `PageHeader`'s own `metaSeparated`
						prop (now in the shared component) exists to close — each
						fact below is a single direct child and the "·" is drawn by
						CSS on the child itself, so a wrapped line can never start or
						end with a bare dot.

						⛔ TWO FACTS, THEN A THIRD THAT PRINTED THE SAME FACT TWICE.
						(2026-10-08, TL review.) `PageHeader`'s own rule (§3.2) is at
						most three facts, the ADVERSE one in its ink, nothing else
						coloured — this used to print FOUR clauses (`N healthy`,
						`rolled back`, `N failed`, `X% healthy`), with green on a
						calm rollout's "4 healthy" AND its "100% healthy" (one fact,
						twice) and red on an incident's "1 failed" AND its
						"50% healthy" (same fact, twice again). The rate is dropped —
						`succeeded`/`failed` already state it in whole numbers, which
						is the form `lib/CLAUDE.md`'s rate guidance prefers when a
						count says the same thing — and the healthy/failed/rollback
						facts collapse into ONE clause: `all healthy` (neutral, plus
						a quiet rollback parenthetical) when nothing failed, or
						`N failed` (danger ink, stated once) when something did. A
						healthy page spends no hue at all now, matching a healthy
						row's own glyph-only rule one card down.
					-->
					{#if totalDeploys === 1}
						<!-- ⭐ "First deploy · 2h ago" (AD round 1, item 9, squad
						     lead's own decision): a rollout with exactly one
						     deploy has nothing to count yet — "1 deploy" states
						     a tally that is not really a tally. "First deploy"
						     names what is actually true (there is exactly one,
						     and it was the first), and the age is the one fact
						     an operator would otherwise have to open the row
						     to get. -->
						<span title={formatDate(allHistory[0].timestamp)}>
							First deploy
							<span class="text-fg-subtle"
								>· {formatTimeAgoCompact(allHistory[0].timestamp, $now)} ago</span
							>
						</span>
					{:else if filteredHistory.length !== totalDeploys}
						<!-- ⭐ ONE RANGE-SCOPED COUNT, STATED ONCE (AD round 3, item 1):
						     "8 deploys in 7d · 1 failed." The lifetime total ("of 11")
						     no longer prints here at all — it lives on the fold button
						     below, the one place a reader is actually asking "how many
						     more are there." -->
						<span>
							<span class="text-fg tabular-nums">{filteredHistory.length}</span>
							<!-- Phone: "8 in 7d" (r11, item 5), the line has one row. -->
							<span class="max-lg:hidden">deploy{filteredHistory.length === 1 ? '' : 's'}</span> in {rangeWord}
						</span>
					{:else}
						<span
							title={atLimit
								? `Showing the last ${totalDeploys} deploys — the retention limit (spec.versionHistoryLimit). Earlier deploys have already been evicted.`
								: undefined}
						>
							{#if atLimit}
								showing the last
							{/if}
							<span class="text-fg tabular-nums">{totalDeploys}</span>
							{totalDeploys === 1 ? 'deploy' : 'deploys'}
							{#if atLimit}
								<span class="text-fg-subtle">(retention limit)</span>
							{/if}
						</span>
					{/if}
					{#if pinnedDisplay}
						<!-- ⭐ THE CURRENT PIN STATE — see `pinnedDisplay`'s own note.
						     No record of past pin/clear-pin events exists to draw, so
						     this states the fact that IS knowable: whether this rollout
						     is pinned RIGHT NOW, and to what. -->
						<span
							class="inline-flex items-center gap-1"
							title="Automatic deploys are paused until this pin is cleared."
						>
							<LockSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
							pinned to
							<span class="t-code-sm text-fg">{pinnedDisplay}</span>
						</span>
					{/if}
					{#if totalDeploys > 0}
						<!-- LOGOPEN r9/r10 (D5): a failure count prints only while a
						     failure is open, and only when there is more than the one
						     the FAILED chip already states. A calm page spends no hue. -->
						{#if openFailed && headerFailed > 1}
							<!-- The one adverse fact, in its ink, stated once — not
							     alongside a now-deleted rate that said the same thing
							     a second time in a second colour. Range-scoped to
							     match the count clause above it (AD round 3, item 1). Red only
							     while the newest deploy is itself the failure (`openFailed`, qa9
							     B1); a superseded failure is neutral ink here.
							     ⭐ "· resolved" DROPPED HERE (AD round 7, nits: "drop the
							     duplicated '1 failed · resolved' from the calm subtitle").
							     The Deploys Card's own rollup a few pixels down already
							     spells out the full "N failed · resolved" — this header
							     clause's job is the COUNT (ink alone already tells a
							     reader open vs. resolved at a glance, the same way the
							     Card rollup's ink does); the word was a second copy of
							     a fact the Card states in full. -->
							<span title="{headerFailed} of {headerTotal} deploys failed">
								<span class="tabular-nums {openFailed ? 'text-danger' : 'text-fg'}"
									>{headerFailed}</span
								>
								failed
							</span>
						{:else if headerRolledBack > 0}
							<!-- ⛔ "all healthy" DROPPED HERE (AD round 6, nits): "drop
							     the duplicate 'All healthy' from the header meta." The
							     Deploys Card's own rollup (below) already says "All
							     healthy" whenever nothing in range failed — this clause
							     printed the identical word a few pixels down. A rollback
							     IS a successful deploy (operator-walk finding,
							     2026-09-03), so it still earns its own quiet mention
							     here when there is one; when there is neither a failure
							     nor a rollback to report, this clause now prints
							     nothing at all rather than restating the Card's "All
							     healthy" a second time. -->
							<span
								title="{headerSucceeded} of {headerTotal} deploys finished healthy, {headerRolledBack} of them by rolling back to an older release"
							>
								<span class="text-fg tabular-nums">{headerRolledBack}</span>
								rolled back
							</span>
						{/if}
					{/if}
					<!-- D5: chip · fact · age. The newest deploy's age, last; sm+ only
					     (r11, item 5: no age on a phone meta line that has another
					     fact). -->
					{#if allHistory[0]?.timestamp && totalDeploys !== 1}
						<span class="tabular-nums max-lg:hidden" title={formatDate(allHistory[0].timestamp)}
							>{formatTimeAgoCompact(allHistory[0].timestamp, $now)} ago</span
						>
					{/if}
				{/snippet}
				{#snippet below()}
					<!--
						THE CADENCE STRIP â Â§1's own centrepiece slot. (2026-10-09,
						Lane H.) The Overview puts its promotion lane in
						`RolloutTabHeader`'s `below` slot; History puts this: the
						same "the header carries the answer, at a glance" job, for
						"when did this rollout deploy and how did each go" instead of
						"where does it run". It REPLACES the always-visible
						`Deployment timeline` card below, now shown only in Compare
						mode.
					-->
					{#if totalDeploys > 0}
						<CadenceStrip
							history={historyWithTitles}
							range={cadenceRange}
							onRangeChange={setCadenceRange}
							onSelect={(i) => revealEntry(i)}
							compareActive={showComparison}
							onToggleCompare={() => (showComparison = !showComparison)}
							{rollbackIndices}
							now={$now.getTime()}
							diffHref={diffHrefForIndex}
							onRollback={openRollbackModalFor}
						/>
					{/if}
				{/snippet}
			</RolloutTabHeader>

			<!-- ⭐ D-22, REVISED (2026-10-08, TL review round 3). THIS TAB'S
			     RAIL NOW MATCHES THE OVERVIEW TAB'S OWN — NOT HOME'S. The
			     first pass reused `.rail-wrap`/`.rail-grid` (Home's and
			     `/changes`' shared 320px-rail shell), which measured a
			     different rail width and gap (320px / 32px) than the
			     Overview tab one click away (452px / 16px at 1440, its own
			     `.ov-split`/`.ov-split-cq`) — two roles ("the rollout's own
			     rail") drawn two ways on two tabs of the SAME object. This
			     page is a rollout-object page first and a list-shell
			     consumer second, so it borrows Overview's own math (scoped
			     below, not the shared class, since `.rail-wrap` is still
			     correct for Home/`/changes` and is not this page's to
			     redefine) rather than the fleet-index shell. -->
			<div class="hist-split-cq">
				<div class="hist-split flex flex-col gap-4">
					<div class="min-w-0">
						<!-- ⭐ COMPARE MODE ONLY NOW. (2026-10-09, Lane H, spec §1.) The
			     cadence strip in the header's `below` slot is this rollout's
			     OWN cadence at a glance; `DeploymentTimeline`'s multi-lane
			     chart is "rare" per the spec and stays reachable through
			     "Compare namespace" / "Show environments" exactly as before —
			     same component, same data shaping, same zoom — just not
			     rendered by default, so it no longer competes with the
			     cadence strip for the same fact. -->
						{#if showComparison || showEnvironments}
							<Card
								icon={ChartLineUpOutline}
								title="Deployment timeline"
								class="mb-5 {totalDeploys < 2 ? 'max-sm:hidden' : ''}"
							>
								{#snippet rollup()}
									<span class="t-ui-sm text-fg-subtle tabular-nums">{timelineRollup}</span>
								{/snippet}
								<DeploymentTimeline
									services={chartServices}
									bind:timeRange
									{selectedEntry}
									fanOverlaps
									labelWidth={chartLabelWidth}
									labelWidthCapFraction={0.6}
									rowHeight={chartRowHeight}
									onEntryClick={handleChartEntryClick}
								>
									{#snippet extraControls()}
										<!-- ⭐ ONE PILL ROW, NOT TWO. (2026-10-08, TL review round 3.)
						     These used to sit on their own row above the chart's
						     range pills — two filter rows, same `.pill` grammar,
						     stacked for no reason. `DeploymentTimeline`'s own
						     `extraControls` slot joins them onto the row its range
						     pills already draw. -->
										{#if hasOtherEnvs}
											<button
												type="button"
												class="pill"
												aria-pressed={showEnvironments}
												onclick={() => {
													showEnvironments = !showEnvironments;
												}}
												title="Show sibling environments on the timeline"
											>
												<LayersSolid class="h-3 w-3" aria-hidden="true" />
												{showEnvironments ? 'Hide environments' : 'Show environments'}
											</button>
										{/if}
										<button
											type="button"
											class="pill"
											aria-pressed={showComparison}
											onclick={() => {
												showComparison = !showComparison;
											}}
											title="Show all other rollouts in this namespace"
										>
											<LayersSolid class="h-3 w-3" aria-hidden="true" />
											{showComparison ? 'Hide namespace' : 'Compare namespace'}
											{#if showComparison && nsRolloutsQuery.isLoading}
												<Spinner size="4" />
											{/if}
										</button>
									{/snippet}
								</DeploymentTimeline>
							</Card>
						{/if}

						<!-- THE CENTREPIECE, RENAMED "Deploys" (spec §1). REFERENCE REGION:
			     `Card` (the same 47px header every region on this page and the
			     Overview use) wrapping ONE DENSE LIST (§3.11), now grouped by
			     day with a continuous spine through the leading status column
			     (`.deploy-spine`, below) — Linear's activity-feed spine, the
			     in-product reference being the Overview pipeline's own step
			     connector. -->
						<!-- ⭐ ONE COUNT, STATED ONCE (AD round 2: "'11 deploys', '8 of
			     11', 8 and the day counts disagree"). The title USED to
			     print the range-scoped count ("Deploys (8 of 11)") while
			     the rollup beside it printed the LIFETIME total ("11
			     deploys") — two different numbers on one card header, and
			     neither matched the Summary rail's own range-scoped "8".
			     The title is plain "Deploys" now; the rollup alone carries
			     the count, range-scoped, matching the header meta above
			     this card exactly.
			     ⛔ "of {totalDeploys}" DROPPED (AD round 3, item 1): "'of
			     11' appears only on the 'Show N earlier' fold" — this card
			     and the page header both used to carry their own copy of
			     the lifetime total, a second place that number could drift
			     from the fold's own count. The fold button below is now
			     the one place a reader sees "…of 11".
			     ⛔ THE COUNT ITSELF DROPPED TOO (AD round 5, nits: "the
			     deploy count appears 3× — keep it in the header meta, and
			     drop it from the card rollup and the Summary title"). The
			     rollup above used to restate `filteredHistory.length` as
			     "N deploys [in Xd]" — the EXACT number the page header's
			     own meta line already states a few pixels up, and a third
			     copy of in the Summary rail beside this card. The rollup's
			     job here is the verdict a reader cannot get from the
			     header's plain count: failed / rolled back, or that the
			     range was clean. -->
						<Card icon={ListOutline} title="Deploys" padded={false}>
							{#snippet rollup()}
								{#if rangeFailed > 0}
									<span class="t-ui-sm tabular-nums {openFailed ? 'text-danger' : 'text-fg'}"
										>{rangeFailed} failed{#if !openFailed}{' · resolved'}{/if}</span
									>
								{:else if rangeRolledBack > 0}
									<span class="t-ui-sm text-fg-subtle tabular-nums"
										>{rangeRolledBack} rolled back</span
									>
								{:else if filteredHistory.length > 0}
									<span class="t-ui-sm text-fg-subtle">All healthy</span>
								{/if}
							{/snippet}

							{#if filteredHistory.length === 0}
								<!-- Empty, per §3.15: inside the card that would hold the
					     content, the outline icon in the disabled ink, a one-line
					     headline, and the next step. -->
								<div class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
									<ListOutline class="text-fg-disabled h-5 w-5" aria-hidden="true" />
									<p class="t-ui text-fg">No deploys in this time range</p>
									<p class="t-meta text-fg-subtle max-w-[280px]">
										Choose "All" on the cadence strip above to see every deploy.
									</p>
								</div>
							{:else}
								<div class="deploy-ledger divide-line-subtle divide-y" use:ledgerSpine>
									<!-- ⭐ GROUPED BY DAY (spec §1) — a 32px `bg-subtle` subheader
						     per day, the `/rollouts` namespace subheader's own
						     reference, each group's own count on the right. -->
									{#each groupedVisible as group (group.key)}
										<div
											class="deploy-day-header bg-subtle relative flex items-center justify-between py-1.5 pr-4 pl-11"
										>
											<span class="t-label text-fg-subtle">{group.label}</span>
											<span class="t-meta text-fg-subtle tabular-nums"
												>{group.total} deploy{group.total === 1 ? '' : 's'}</span
											>
										</div>
										<div class="deploy-day-rows divide-line-subtle divide-y">
											{#each group.items as { e: entry, i } (i)}
												{@const isCurrent = i === 0}
												{@const isExpanded = expandedIdx.has(i)}
												{@const act = acts[i]}
												{@const isSelected =
													selectedEntry?.serviceId === `${namespace}/${name}` &&
													selectedEntry?.index === i}
												<!-- ⭐ `actPrints` (History round 14, AD round 10, D6 nit:
							     "no orphan 'Automatic' on its own line in the 390 row
							     meta"). `act` is truthy for a one-release `forward` step
							     too, which (by design, round 2 item 2) prints NOTHING —
							     a raw `act` check let that case through the record
							     line's own gate below and still produced a line with
							     only the actor on it. This mirrors the exact four `act`
							     branches that emit text. -->
												{@const actPrints =
													!!act &&
													(act.kind === 'rollback' ||
														(act.kind === 'forward' && act.by > 1) ||
														act.kind === 'redeploy' ||
														act.kind === 'unknown')}
												<!-- The row record's three per-entry facts — see the record
							     line's own note below. `{@const}` must be an immediate child
							     of a block, so they are declared here with `act` and
							     `isSelected` rather than beside the markup that uses them. -->
												{@const wait = deployWait(entry)}
												{@const liveWait = isCurrent ? liveStatusWait(entry, $now.getTime()) : null}
												{@const note = deployNote(entry.message, entry.triggeredBy)}
												{@const who = entry.triggeredBy}
												{@const actor = who ? actorFrom(who) : null}
												{@const commitTitle = commitTitleOf(i)}
												{@const commitAuthor = commitAuthorOf(i)}
												<!-- ⛔ THE AT-REST ROW BUTTON THAT USED TO LIVE HERE IS GONE
							     (AD round 5, item 8): "on incident, remove the at-rest
							     'Roll back to 3f1ed09' row button — RolloutTabHeader's
							     primary header button already says it." Round 3 added a
							     row-level always-visible "Roll back to {name}" on the
							     last healthy entry specifically so an incident reader
							     never needed hover to find it — correct instinct, wrong
							     place: `RolloutTabHeader` now carries that exact button
							     as the page's ONE primary action (`rollbackHref` wired at
							     this page's own header call, pointing at History's own
							     `?action=rollback`), so the row repeated a decision the
							     header already states louder. The row's hover-reveal
							     rollback button (below, desktop-only) and the expanded
							     panel's own button are what remain — same two actions,
							     no second always-on copy. -->

												<div
													use:registerEntry={i}
													class="deploy-row scroll-mt-28 transition-colors {isSelected
														? 'bg-selected'
														: ''}"
												>
													<!--
									⭐ THE ROW IS A `.tap-zone` AND THE CONTROL THAT OWNS IT IS THE
									EXPAND BUTTON AT THE ROW'S EDGE. (2026-09-01)

									It was a `<div role="button" tabindex="0">` wrapping the whole
									row, WITH A REAL `<a>` INSIDE IT. Three defects, all measured
									on this page:

									  1. ⛔ ENTER ON THE VERSION LINK DID NOT NAVIGATE. The keydown
									     bubbled from the anchor to the wrapper's handler, which
									     called `preventDefault()` — cancelling the browser's own
									     default action for Enter on a focused link. A keyboard user
									     pressing Enter on `991829b` expanded the row instead of
									     opening the build.
									  2. A nested interactive element: an anchor inside a
									     `role="button"` region is two controls occupying one box,
									     which is what `src/lib/CLAUDE.md` forbids by name.
									  3. The anchor needed `stopPropagation` on click to survive it —
									     a workaround for the nesting rather than a fix.

									`.tap-zone` / `.tap-link` from `app.css` is the product's answer
									and it does not require the primary control to be an anchor: the
									selector is class-based. So the CHEVRON — which already exists,
									already has an accessible name, and is the affordance a reader
									reads as "this opens" — becomes a real `<button class="tap-link">`
									whose `::after` covers the whole row. The row keeps its exact
									behaviour (click anywhere = expand), the anchor is raised above
									the overlay and is independently clickable AND Enter-able, the
									focus ring is drawn around the whole region the button activates,
									and the tab-stop count per row is unchanged at two.
								-->
													<div
														class="tap-zone group hover:bg-hover flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
													>
														<!-- ⭐ §3.11 — HEALTHY AT REST IS A DOT. `RestGlyph` draws the
									     6px success dot once a deploy has sat healthy a while and
									     the full `BakeStatusIcon` otherwise (just succeeded, failed,
									     in flight) — the exact fix the design review measured: a
									     column of identical filled green checks was the loudest
									     repeated mark on Home, louder than the one row that needed
									     a person. A history list is mostly settled deploys, so it
									     is the same defect here if left as a full icon every row. -->
														<!-- ⭐ THE SPINE RING (round 2 item 4, squad lead, 2026-10-09):
									     "the spine runs THROUGH the 6px rest dots… give the glyph
									     slot a ring of the row's surface." `.deploy-glyph-ring` is
									     `:global()` (defined below) because it has to match the DOM
									     node `RestGlyph`'s OWN template renders, which Svelte's
									     scoped-CSS hash does not reach through a child component. -->
														<!-- ⭐ CENTRED ON LINE 1, NOT GUESSED (AD round 2: "glyphs
								     are centred on line 1, RestGlyph sits 7px low"). `pt-0.5`
								     was a guessed offset against the row's TOP; line 1's own
								     height varies with its content (a 20px Chip some rows,
								     plain text others), so a fixed top padding could only
								     ever be right for one of them. `h-5 flex items-center`
								     makes the glyph's own box the height of a typical line-1
								     row (20px, the Chip's own height, line1's tallest
								     possible child) and centres the glyph inside THAT,
								     which tracks line 1's real height instead of guessing
								     a padding number relative to the row's top edge. -->
														<div
															class="deploy-spine-col flex h-5 shrink-0 items-center justify-center"
															data-spine-mark
														>
															<RestGlyph
																bakeStatus={entry.bakeStatus}
																timestamp={entry.timestamp}
																now={$now.getTime()}
																class="deploy-glyph-ring"
															/>
														</div>

														<!-- Version -->
														<div class="min-w-0 flex-1">
															<div class="flex items-center justify-between gap-2">
																<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
																	<!-- No `stopPropagation` any more: the tap zone raises this
											     anchor above the expand button's overlay, so a click on
											     it is a click on IT and never on the row. The build is
											     this list's SUBJECT — `t-code` (14px, not the meta-line
											     `t-code-sm`'s 12px) in the full `text-fg` ink rather
											     than the quiet subtle ink a build takes on a row whose
											     subject is a name.
											     ⭐ `.build-id` (AD round 8, item 4): "the build id is
											     14px mono, weight 500, in fg." `t-code`'s own weight is
											     400 (the role for an identifier INLINE with body text,
											     language.css's own table) — correct everywhere else it's
											     used, but this row's build id is less "inline" than it
											     is the row's own headline, and reads thin beside the
											     weight the row's other marks (Chip, t-ui-sm state word)
											     carry. Tried `font-medium` first — measured live, it lost
											     to `.t-code`'s own `font-weight: 400` (`.t-code` lives in
											     language.css's `@layer base`, and this app's Tailwind
											     build still resolves that layer AFTER utilities for this
											     page's own bundle, so a same-specificity utility class
											     could not win the cascade here). A scoped local class
											     (below) carries the Svelte scoping attribute, which beats
											     a plain `.t-code` class selector outright regardless of
											     layer order. -->
																	<a
																		href={changePathForRollout(
																			rollout,
																			name,
																			getDisplayVersion(entry.version)
																		)}
																		class="build-id t-code text-fg shrink-0 hover:underline"
																	>
																		{getDisplayVersion(entry.version)}
																	</a>
																	<!--
												⭐ REVERSED (2026-10-09, squad-rollout SPEC §1). The prior
												note here argued for quiet text over a chip, on the
												ground that a healthy row's glyph already says it and a
												chip would be a second mark. The spec reverses this for
												exactly ONE reason this file's own comment did not have
												to weigh: it is not a STATE mark at all — "the header
												pill already states its state, so this is a POSITION
												mark" (which build is running right now, as distinct
												from which one is healthy). `role="count"` is the
												product's neutral/no-hue chip tone, so a failed current
												row still carries only two marks at full emphasis (the
												glyph + the red verb below), not three — the thing the
												prior note was protecting stays protected. -->
																	{#if isCurrent && currentRowChip(entry.bakeStatus, currencyBehind)}
																		<Chip role="count" wide label={currentRowChip(entry.bakeStatus, currencyBehind) ?? ''} />
																	{/if}
																	<!--
												⭐ §3.11 — THE VERB IN ITS STATUS INK, NOT A CHIP — AND NOT
												ON THE RUNNING ROW (round 2, item 5, squad lead). The
												header pill already states the current row's state, so
												printing "checking"/"deploying" here a second time is the
												state spoken twice; `liveWait` below replaces it with
												something that is NOT the state again — how long it has
												held it.

												⛔ AND NOT ON A FAILED ROW EITHER (AD round 1, item 6):
												"the failed row prints 'deploy failed' red on line 1 AND
												'failed after 1m' on line 2 — failure once." Line 2's
												`wait` now leads with "Failed" in danger ink for exactly
												this entry, so line 1 only needs the word for a state
												`wait` does NOT cover (checking/deploying with no
												`bakeEndTime` yet).
											-->
																	{#if entry.bakeStatus !== 'Succeeded' && entry.bakeStatus !== 'Failed' && !isCurrent}
																		<span
																			class="t-ui-sm shrink-0 {entry.bakeStatus === 'Failed'
																				? 'text-danger'
																				: entry.bakeStatus === 'InProgress'
																					? 'text-progress'
																					: entry.bakeStatus === 'Deploying'
																						? 'text-active'
																						: 'text-fg-subtle'}"
																			title={bakeTitle(entry.bakeStatus)}
																		>
																			{bakeWord(entry.bakeStatus)}
																		</span>
																	{/if}
																	<!--
												⭐ THE REVISION, WHEN IT DIFFERS FROM THE NAME BESIDE IT —
												`/versions`'s own rule, and the reason the seven-character
												fix in `formatRevision` needed it. It is an identifier, not
												a state, so it is quiet `t-code-sm` text, never a chip.
											-->
																	{#if entry.version.revision && formatRevision(entry.version.revision) !== getDisplayVersion(entry.version)}
																		<span
																			class="t-code-sm text-fg-subtle shrink-0"
																			title="Commit {formatRevision(entry.version.revision)}"
																		>
																			{formatRevision(entry.version.revision)}
																		</span>
																	{/if}
																	<!--
												⭐ THE COMMIT TITLE (round 2, item 3): "the content that
												gives the ledger presence." `entry.commitMessage` is the
												commit's own title — distinct from `entry.message` (the
												deploy's note, see `deployNote` below) — present on every
												entry regardless of who triggered it. `truncate` on a
												shrinkable flex item, not `flex-wrap`: the sha/chip/state
												group above never wraps away from the glyph, and the
												title gives up space to it instead of pushing the row to
												a second line.
											-->
																	{#if commitTitle}
																		<span class="t-body text-fg-muted min-w-0 flex-1 truncate">
																			{commitTitle}
																		</span>
																	{/if}
																</div>
																<!-- ⭐ TIME, ON LINE 1, RIGHT-ALIGNED (round 2, item 6): phone
										     rows were 4 lines; the desktop time column (below, `sm:
										     block`) already states this, so this is the 390-only
										     twin of it — no icon, short relative form, the exact
										     clock on `title`. -->
																<span
																	class="t-meta text-fg-subtle shrink-0 tabular-nums sm:hidden"
																	title={formatDate(entry.timestamp)}
																>
																	{formatTimeAgoCompact(entry.timestamp, $now)}
																</span>
															</div>
															<!--
											⭐ THE RELATIVE HALF, WHICH THIS ROW WAS MISSING.
											(2026-09-01) `DESIGN-INTENT.md`: *"Relative version beats
											absolute — `−2 vs newest`, `matches STG` are the signal; the
											sha is usually noise."* This row leads with the absolute
											build, which is CORRECT here — a deploy log's subject is the
											build that went out — but the relative fact was rendered
											only for the two kinds of move that are deviations, so an
											ordinary deploy said nothing about how far it moved. A
											one-release step and a fourteen-release jump drew
											identically.

											It is not furniture: the WORD repeats and the NUMBER does
											not, which is the test `DESIGN.md` sets for a repeated mark.
											`deployActs` is the product's one derivation for it and
											returns `null` rather than guessing when the release
											ordering cannot place a pair, so a row with no answer still
											prints nothing.

											⛔ AND THIS IS THE ONLY PLACE "WENT BACKWARDS" IS STATED
											PER ROW NOW. (2026-10-08.) The hand-rolled chip that used to
											sit on the version line duplicated exactly this sentence —
											one fact, twice, on the same row. Dropped there; kept here,
											where the direction sits beside who did it and how long it
											took, which is where a reader actually wants it.
										-->
															<!-- ⭐ NO LINE FOR "Automatic" ALONE (History round 14, AD
										     round 10, D6 nit): "no orphan 'Automatic' on its own
										     line in the 390 row meta." `who`/`actor` used to gate
										     this whole record line by themselves, so a row whose
										     `wait`/`act`/`note` all come back falsy (a transient
										     state, or a bake interval this fixture never finished
										     computing) rendered a full-width second line carrying
										     nothing but one word and an avatar — the exact
										     "orphan" the nit names. `actPrints` (declared with
										     `act` itself, above) gates the line on there being an
										     actual FACT to pair the actor with; who triggered it
										     is still one click away in the expanded panel's own
										     "Triggered by" line, so nothing is lost, only an
										     empty-looking line. -->
															{#if liveWait || wait || actPrints || note}
																<div class="dot-list mt-1 min-w-0">
																	<div
																		class="dot-list-row t-meta text-fg-subtle flex min-w-0 flex-wrap items-center gap-y-0.5"
																		use:wrapCompact
																	>
																		{#if liveWait}
																			<!-- ⭐ THE RUNNING ROW'S OWN LIVE CLOCK (round 2, item 5),
												     LEADING the line — the header pill already states
												     the state, so this states how long it has held it,
												     not the state again. -->
																			<span class="tabular-nums" title={liveWait.title}
																				>{liveWait.text}</span
																			>
																		{:else if wait}
																			<!-- ⭐ OUTCOME FIRST (AD round 1, item 6: "outcome comes
												     last; spec puts it first… failure once, on line 2,
												     'Failed after 1m' with only 'Failed' in danger ink").
												     Moved from the END of the line to the START — it is
												     the row's own headline fact, read before who did it
												     or how far it moved — and split so only the ONE word
												     that needs colour gets it. -->
																			<span class="tabular-nums" title={wait.title}>
																				<span class={wait.outcome === 'Failed' ? 'text-danger' : ''}
																					>{wait.outcome}</span
																				>
																				{wait.rest}
																			</span>
																		{/if}
																		{#if act && act.kind === 'rollback'}
																			<!-- ⭐ "Rolled back from X" (round 2, item 7) — the row's
												     OWN sha is already the target (line 1), so the act
												     only has to name where it came FROM. A rollback is a
												     person's act, not a state: the glyph above stays the
												     OUTCOME, and this gets a neutral 12px icon rather than
												     a second status mark. -->
																			<span
																				class="text-fg-muted inline-flex items-center gap-1"
																				title={act.sentence}
																			>
																				<UndoOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
																				Rolled back from
																				<span class="t-code-sm text-fg-muted">{act.from}</span>
																			</span>
																		{:else if act && act.kind === 'forward' && act.by > 1}
																			<!-- ⭐ A ONE-RELEASE FORWARD STEP IS THE NORM AND PRINTS
												     NOTHING (round 2, item 2): "'1 release ahead' prints on
												     almost every row… a forward deploy by exactly one
												     release is the norm." Only a SKIP — more than one
												     release at once — is a fact worth a reader's attention.
												     ⭐ `act.by - 1`, NOT `act.by` (AD round 7, nits:
												     "'Skipped 2 releases' counted correctly"). `act.by` is
												     the ladder DISTANCE moved (previous position → this
												     one) — going from position 2 to position 5 is a
												     3-step move, but only releases 3 and 4 were never
												     deployed; the release AT the new position (5) was
												     arrived at, not skipped over. The count of skipped
												     releases is always one less than the distance moved. -->
																			<span title={act.sentence}>
																				Skipped {act.by - 1} release{act.by - 1 === 1 ? '' : 's'}
																			</span>
																		{:else if act && act.kind === 'redeploy'}
																			<!-- ⭐ "Redeployed", NO REPEATED SHA (AD round 7, nits):
												     `act.sentence` is "Redeployed the same release,
												     {to}." where `to` is THIS row's own build — already
												     line 1's own sha, a few pixels to the left. Printing
												     the full sentence here said the same sha twice on one
												     row. The word alone names the act; the row's own sha
												     is what "the same release" refers to. -->
																			<span class="text-fg-muted" title={act.sentence}
																				>Redeployed</span
																			>
																		{:else if act && act.kind === 'unknown'}
																			<!-- ⭐ `.replace(/\.$/, '')` (AD round 6, nits: "remove the
												     stray full stop inside the dot-list"). `act.sentence`
												     is written as a standalone SENTENCE (full stop and
												     all) for its OTHER callers — a `title` tooltip, the
												     expanded panel's own prose line — but inline here it
												     sits between two `.dot-list` separators, where the
												     trailing "." read as an orphaned mark with nothing
												     after it. -->
																			<span class="text-fg-muted" title={act.sentence}>
																				{act.sentence.replace(/\.$/, '')}
																			</span>
																		{/if}
																		{#if who && actor}
																			<!-- ⭐ AVATAR ONLY WHENEVER THE ROW'S DETAILS WRAP (History
												     round 15 item 5, widened in round 16, AD round 12
												     item 2): round 15 keyed this on `note` alone, which
												     missed every other way line 2 wraps (a rollback's
												     "Rolled back from X", a skip). `use:wrapCompact`
												     (lib/wrap-compact.ts) measures the row and sets
												     `.wrap-compact`, which hides `.trigger-name` (rule in
												     this file's <style>); `Avatar` carries the full name
												     as `title` and `aria-label`, so nothing accessible is
												     lost. -->
																			<span class="inline-flex min-w-0 items-center gap-1">
																				<!-- ⭐ `actorFrom` (shared adapter, `lib/actor.ts`) + `Avatar`:
													     identity before reading — a person's monogram or
													     photo, the kuberik mark for the controller, never the
													     word "System". -->
																				<Avatar
																					name={actor.kind === 'controller'
																						? 'Automatic'
																						: actor.name}
																					kind={actor.kind === 'controller'
																						? 'controller'
																						: 'person'}
																					src={actor.src}
																					size={16}
																				/>
																				{#if actor.kind === 'controller'}
																					<span class="trigger-name">Automatic</span>
																				{:else}
																					<span class="trigger-name max-w-40 truncate"
																						>{actor.name}</span
																					>
																				{/if}
																			</span>
																		{/if}
																		{#if note}
																			<!-- `basis-40` WITH `flex-1`: at 390 the note wraps onto its
												     own line and then expands to the whole row width, instead
												     of sharing a line with the duration and truncating at
												     ~110px (measured live, `*Automatic depl…`). -->
																			<span
																				class="text-fg-muted min-w-0 flex-1 basis-40 truncate"
																				title={note}>{note}</span
																			>
																		{/if}
																	</div>
																</div>
															{/if}
															<!-- ⛔ THE MOBILE-ONLY TIME LINE IS GONE (round 2, item 6).
										     It used to be a THIRD line at 390 (sha/chip/state, the
										     record line, then clock+ago) — the time moved onto line 1
										     itself (the `sm:hidden` span above, right-aligned), and the
										     actor already lives on the record line below at every
										     width, so nothing here was left to say. -->
														</div>

														<!--
										Time + actor, right-aligned, `t-meta tabular-nums` on the
										figure — the dense-list row's own "who/when" column.
										⛔ THREE ROWS SIX MINUTES APART ALL READ `1d`. Relative time is the
										right answer on a LIST OF DIFFERENT THINGS, where "how stale is
										this" is the question. On a list of one thing ORDERED BY TIME, the
										question is "when, and how far apart", and a formatter whose
										coarsest bucket is a day cannot answer it — the resolution was
										lying about itself. The exact clock leads; `formatTimeAgoCompact`
										is unchanged and demoted to the second line, because seventeen
										other callers depend on exactly what it does today.
									-->
														<!-- ⭐ THE TIME COLUMN, THE HOVER-ACTIONS' OWN ANCHOR (AD
									     round 6, item 2): "hidden hover actions reserve width at
									     rest." The actions `<div>` used to be a THIRD flex sibling
									     here — `opacity-0` hides it, but opacity never removes an
									     element from layout, so its ~230px of buttons were reserved
									     on every row, every width, all the time. Measured live: rows
									     68/87/105px tall for one kind of row, and 55f1a2c's own
									     meta line wrapped to 3 lines because the invisible buttons
									     were still eating the width its text needed. `position:
									     relative` here, `position: absolute` on the actions overlay
									     below, makes the actions reserve exactly 0px at rest.
									     ⭐ NO PATCH (AD round 9, item 1): round 6 painted the
									     overlay with its own `bg-surface` fill so the clock/ago
									     text underneath would never show through — which drew a
									     visibly different-toned rectangle over part of the row,
									     "a hover patch," floating on top of the row's own
									     `hover:bg-hover` tint instead of sitting IN it. Removed:
									     the clock/ago text now fades out on its own (`opacity-0`
									     on group-hover, right below) so there is nothing left for
									     a patch to cover, and the buttons sit directly on the
									     row's own hover colour like every other control on it. -->
														<div class="relative hidden shrink-0 text-right sm:block">
															<div
																class="t-meta text-fg-muted tabular-nums transition-opacity lg:group-focus-within:opacity-0 lg:group-hover:opacity-0"
																title={formatDate(entry.timestamp)}
															>
																{clockTime(entry.timestamp)}
															</div>
															<!-- ⛔ THE ACTOR MOVED TO THE RECORD LINE, so this column is
										     purely temporal now: the exact clock, then how long ago.
										     Who did it is a fact ABOUT the deploy and belongs with
										     the other facts about it, not stacked under a timestamp. -->
															<div
																class="t-meta text-fg-subtle mt-0.5 flex items-center justify-end gap-1 transition-opacity lg:group-focus-within:opacity-0 lg:group-hover:opacity-0"
															>
																<span>{formatTimeAgoCompact(entry.timestamp, $now)} ago</span>
															</div>
															<!-- ⭐ HOVER/FOCUS-WITHIN ACTIONS (spec §1), DESKTOP ONLY, NEVER
										     ON THE RUNNING ROW. `opacity-0 pointer-events-none` at rest
										     so a resting row carries no more ink than before and the
										     overlay never steals a click meant for the clock/date under
										     it; `lg:group-hover:opacity-100` (+ `pointer-events-auto`)
										     avoids the ghost-affordance mistake the design rules call
										     out by name (something hover-only on desktop rendering at
										     REST on a touch screen, where hover never fires) — below
										     `lg` these controls simply never render, and the same two
										     actions stay reachable inside the expanded panel at every
										     width. The last healthy row during an incident used to get
										     a THIRD, always-visible copy of this button here (round 3)
										     — removed in round 5, item 8: `RolloutTabHeader`'s own
										     primary button already says "Roll back to {name}" for
										     exactly that row, so a reader never needed this row to
										     repeat it.
										     ⭐ HIDDEN WHILE EXPANDED (AD round 4, item 3) — the exact
										     same two actions already sit at the panel's own bottom
										     once a row is open; hovering an expanded row floated a
										     second "Roll back to this"/"View diff" pair above the
										     first, both clickable, both doing the same thing. -->
															{#if !isCurrent && !isExpanded}
																<div
																	class="pointer-events-none absolute inset-y-0 right-0 z-10 hidden items-center justify-end gap-2 opacity-0 transition-opacity lg:flex lg:group-hover:pointer-events-auto lg:group-hover:opacity-100 lg:focus-within:pointer-events-auto lg:focus-within:opacity-100"
																>
																	{#if entry.bakeStatus === 'Succeeded'}
																		<button
																			type="button"
																			class="btn btn-secondary btn-xs"
																			onclick={(ev) => {
																				ev.stopPropagation();
																				selectedVersionTag = entry.version.tag;
																				deployExplanation = '';
																				showChangeVersionModal = true;
																			}}
																		>
																			<UndoOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
																			Roll back to this
																		</button>
																	{/if}
																	<DiffLink
																		{cluster}
																		namespace={rollout?.metadata?.namespace ?? ''}
																		name={rollout?.metadata?.name ?? ''}
																		history={rollout?.status?.history ?? []}
																		index={i}
																		{atLimit}
																	/>
																</div>
															{/if}
														</div>

														<!-- Expand affordance, and now the row's `.tap-link`. A bare 16px
									     chevron in the row's own gray did not read as a control at
									     rest; it gets a box that resolves on hover and focus-within,
									     and a name. Its `::after` is what makes the whole row take
									     the click. -->
														<button
															type="button"
															aria-expanded={isExpanded}
															onclick={() => toggleExpand(i)}
															class="tap-link text-fg-subtle group-hover:border-line group-hover:bg-surface shrink-0 rounded-sm border border-transparent p-1 transition-colors"
														>
															{#if isExpanded}
																<ChevronUpOutline class="h-4 w-4" aria-hidden="true" />
															{:else}
																<ChevronDownOutline class="h-4 w-4" aria-hidden="true" />
															{/if}
															<span class="sr-only"
																>{isExpanded ? 'Hide' : 'Show'} deploy details</span
															>
														</button>
													</div>

													<!-- Expanded details — drawn like the Overview's own rail cards
								     (a `dl`-shaped fact grid), not a second typographic system. -->
													{#if isExpanded}
														<!-- ⭐ A bg-subtle WELL, NOT THE ROW'S OWN SURFACE (AD round
								     1, item 8: "same surface as the row"; the original spec
								     already called for this — "bg-subtle well inside the
								     row" — and it was never actually applied). -->
														<!-- ⭐ TWO NAMED COLUMNS, "Change" | "Deploy" (AD round 3, item
								     3): the panel used to be an unlabelled "Left"/"Right" split
								     — a code comment's own words, never drawn — so a reader
								     opening it saw two stacks of facts with nothing saying what
								     either one was for. `t-label text-fg-subtle` is the same
								     caption the day subheaders ("TODAY", "TUE, OCT 6") already
								     use. `{@const}` has to sit here, the immediate child of
								     `{#if isExpanded}`, not one `<div>` further in — the
								     compile rule every earlier round's `{@const}` fight was
								     about. Each header only prints when its own column has
								     something under it, so a column with nothing to say draws
								     no label over empty space (the "orphan 'Changes' label"
								     this item also names). -->
														<!-- ⭐ ALWAYS TWO FILLED COLUMNS (AD round 4, item 3): "no
								     empty CHANGE header" was round 3's own fix for a label
								     drawn over nothing — correct as far as it went, but the
								     right fix is a column that is never EMPTY to begin with,
								     not one that hides its own name when it has nothing to
								     say. `hasCommitInfo` gates the lazy `CommitSummary`
								     fetch/note block specifically; `commitTitle` (already
								     resolved for the row) is the guaranteed fallback when
								     neither of those has anything — every entry has a commit
								     title. Deploy's own guarantee is `wait`/`liveWait`: every
								     entry is either mid-bake or has an outcome, so one of the
								     two always exists. -->
														<!-- ⭐ `hasCommitInfo` MATCHES THE NOTE'S OWN GATE NOW (AD
								     round 7, item 1: "3f1ed09's panel is empty today"). The
								     message branch used to count ANY `entry.message` as
								     "this column has something to show" — true back when
								     the note rendered unconditionally, but round 6 gated the
								     actual Recorded-note block on `who?.kind === 'User'`
								     without updating this guarantee. The result: a root
								     entry (no older sibling) triggered by `Automatic`, whose
								     own message is non-empty (e.g. "Automatic deployment"),
								     reported `hasCommitInfo = true` — which suppressed the
								     `commitTitle` fallback below — while the note it was
								     "guaranteeing" never rendered anywhere, because THAT
								     block now requires a person. Both halves empty, column
								     blank. Matching the two gates exactly is the fix. -->
														<!-- ⭐ ONE CHANGE-BLOCK SHAPE, THREE WAYS TO FILL IT (AD
								     round 8, item 1): "a summary line, then commit rows
								     with the author right-aligned… three layouts exist
								     today; make them one." Three cases, same canonical
								     COMMIT ROW markup (sha as a blue link, title taking
								     the room, author shrink-0 on the right — exactly
								     `CommitSummary`'s own `showMessages` list item, so a
								     reader never sees a fourth shape):
								       1. A real range resolves (an older sibling exists
								          AND actually differs) — `CommitSummary` draws its
								          own summary line + every commit row in the range.
								       2. A "redeploy" — an older sibling exists but is the
								          SAME release (nothing to range against:
								          `commitsQueryOptions`' own `base !== head` contract
								          — this used to leave the whole column blank for
								          `b7e0d41`'s own redeploy row). Summary line reads
								          "Same build as {sha}"; one commit row, this row's
								          own bare-commit lookup.
								       3. No older sibling at all (the oldest surviving
								          entry — `3f1ed09`, `hello-world`'s single deploy).
								          No summary line (nothing to summarize); the same
								          one commit row. -->
														{@const baseRevision =
															rollout?.status?.history?.[i + 1]?.version?.revision}
														{@const headRevision = entry.version?.revision}
														{@const hasOlderSibling =
															githubConnected &&
															!!rollout?.status?.source &&
															!!rollout.status.history &&
															i + 1 < rollout.status.history.length}
														{@const hasRangeDelta =
															hasOlderSibling &&
															!!baseRevision &&
															!!headRevision &&
															baseRevision !== headRevision}
														{@const isSameBuildRedeploy =
															hasOlderSibling &&
															!!baseRevision &&
															!!headRevision &&
															baseRevision === headRevision}
														{@const rowCommit = rowCommitQueries.items[i]?.data}
														<div
															class="border-line-subtle bg-subtle relative border-t pt-1 pr-4 pb-1.5 pl-11 lg:py-4"
														>
															<!-- ⭐ TIGHTENED, 390 ONLY (History round 14, AD round 10,
										     D1, binding): "tighten the 390 History body so the
										     failed entry's failure message sits above the fold…
										     find the space in your own content." Below `lg` this
										     grid is one column — `CHANGE` then `DEPLOY` stack
										     full-height, so every px of panel/column rhythm here
										     counts twice over against the fold. `lg:gap-4`/`lg:py-4`
										     restore the original rhythm at desktop, where the two
										     columns run side by side and the fold is not in play. -->
															<!-- ⭐ `hist-panel-lg-weight` (History round 15, AD round
										     11, item 7, binding): "at lg+, panel facts are 13px
										     and the failed-check line is 14px, matching the
										     Overview's failure line." Scoped to THIS panel only
										     (see the `<style>` rule below) so `.t-meta`'s own 12px
										     stays the shared value everywhere else this class is
										     used — including `CommitSummary`'s other call sites,
										     which never asked to move. -->
															<div
																class="hist-panel-lg-weight grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4"
															>
																<!-- Left/second: what changed. `order-2` at EVERY
											     width now (History round 16, AD round 12, item 1,
											     binding): "at sm+, let DEPLOY lead so the dead space
											     under CHANGE fills." Was `order-2 lg:order-none` —
											     correct for the phone fold (History round 14) but
											     the AD's own round-12 evidence (`panels.png`) measured
											     the SAME asymmetry at 1440: `Change` is typically
											     1-2 lines (a commit summary) while `Deploy` runs
											     5-6 (Started/Failed at/Triggered by/Promoted/the
											     failed check), so `Change`-left left a visibly empty
											     lower two-thirds of its own column beside a full
											     `Deploy` one. No `lg:order-none` reset any more — the
											     richer column leads at every width, stacked or
											     side-by-side. DOM order is UNCHANGED (Change's own
											     commit link stays the first tab stop in the panel,
											     same as every other row) — only the visual position
											     moves. -->
																<div class="order-2 flex flex-col gap-2">
																	<span class="t-label text-fg-subtle">Change</span>
																	{#if hasRangeDelta}
																		<!-- ⛔ `min-w-0` OR THE COMMIT MESSAGE IS NOT TRUNCATED, IT IS
													     CLIPPED. (2026-09-02, measured at 390 with the commits
													     endpoint populated.) `CommitSummary` with `showMessages`
													     renders TWO siblings — the summary line and the `<ul>` of
													     messages — so both became flex items of this row, and a
													     flex item's `min-width` is `auto`. The `truncate` inside
													     the list could not shrink, the subject ran past the card
													     and `overflow-hidden` on the row cut it mid-word with no
													     ellipsis to say so. Wrapping them in one shrinkable
													     column is the fix; `Changes` keeps `flex-shrink-0` so the
													     label is never the thing that gives way.

													     Only visible with GitHub connected, which this cluster is
													     not — found by mocking the endpoint at the network layer.
													     What this deploy changed vs. the previous one; lazy, so
													     it is only fetched once the entry is expanded. -->
																		<div class="t-meta flex items-baseline gap-1.5">
																			<div class="min-w-0 flex-1">
																				<!-- ⭐ `showStats={!skippedReleases}` (AD round 9, item
															     5): "the facts read '1 commit of its own · 2
															     releases skipped', so the commit and skip facts
															     agree. Don't invent commits." `CommitSummary`'s
															     own diffstat (`+N −M · Z files`) totals EVERY
															     ladder step in the range (`buildRange`'s own
															     comment: "ahead/behind and the diffstat total the
															     FULL uncapped range"), including the ones round
															     12's fix stopped showing as their own commit rows
															     (62d1c05's own range used to list b7e0d41/d09e6f4
															     as commits; now it correctly shows only 62d1c05's
															     own) — so the diffstat still claimed changes from
															     commits the list no longer named, which read as
															     invented. Suppressed for a skip; the skip count
															     (the row's own `act.by - 1`, already computed, no
															     new query) states the honest second fact instead. -->
																				<!-- ⭐ `dotTone="neutral"` ON A FAILED ROW (History
															     round 14, AD round 10, D6 nit): "no green dot on
															     '1 commit deployed' inside a failed deploy." A
															     commit range is still "forward" (nothing was
															     reverted) on a build whose own health check
															     failed — `CommitSummary`'s dot would otherwise
															     stay this product's one green, sitting one line
															     below the red failed-check glyph it belongs to. -->
																				<CommitSummary
																					{namespace}
																					{name}
																					{cluster}
																					base={baseRevision}
																					head={headRevision}
																					showAvatars
																					showStats={!(act?.kind === 'forward' && act.by > 1)}
																					showMessages
																					dotTone={entry.bakeStatus === 'Failed'
																						? 'neutral'
																						: 'auto'}
																				/>
																				{#if act?.kind === 'forward' && act.by > 1}
																					<div class="t-meta text-fg-subtle mt-1">
																						{act.by - 1} release{act.by - 1 === 1 ? '' : 's'} skipped
																					</div>
																				{/if}
																			</div>
																		</div>
																	{:else}
																		{#if isSameBuildRedeploy}
																			<div class="flex items-center gap-1.5">
																				<span
																					class="bg-line-strong h-1.5 w-1.5 shrink-0 rounded-full"
																				></span>
																				<span class="t-ui-sm text-fg-muted">
																					Same build as {formatRevision(headRevision ?? '') ||
																						getDisplayVersion(entry.version)}
																				</span>
																			</div>
																		{/if}
																		{#if rowCommit}
																			<ul>
																				<li class="t-meta flex items-baseline gap-2">
																					<!-- ⭐ THE ROOT ENTRY'S SHA IS A LINK-BLUE LINK TOO
																     (AD round 7, item 1) — same `t-code-sm
																     text-accent-text hover:underline` anchor
																     `CommitSummary`'s own range rows use, not the
																     plain `text-fg` span this fallback used to
																     draw; one commit row, drawn once, whichever
																     case fills it. -->
																					<a
																						href={rowCommit.htmlUrl}
																						target="_blank"
																						rel="noopener noreferrer"
																						class="t-code-sm text-accent-text shrink-0 hover:underline"
																						>{rowCommit.sha.slice(0, 7)}</a
																					>
																					<span class="text-fg-muted min-w-0 flex-1 truncate"
																						>{commitTitle ?? rowCommit.subject}</span
																					>
																					{#if commitAuthor}
																						<span class="text-fg-subtle shrink-0"
																							>{commitAuthor}</span
																						>
																					{/if}
																				</li>
																			</ul>
																		{/if}
																	{/if}
																</div>

																<!-- Left/first: how it deployed. `order-1` at every
											     width now — see `Change`'s own note, just above. -->
																<div class="order-1 flex flex-col gap-1 lg:gap-2">
																	<!-- `order-first` pairs with the failed-check block's
											     own below: both get the same explicit order at every
											     width, so flexbox's tie-break keeps DOM order between
											     them (label, then the check it's introducing), while
											     every other fact (order: 0, unset) still sorts after
											     both — AD round 12, item 1: "the failed check is the
											     first line of the DEPLOY column at EVERY width, not
											     only on the phone." -->
																	<span class="t-label text-fg-subtle order-first">Deploy</span>
																	<!-- ⭐ THE NOTE MOVED HERE (AD round 7, item 1: "notes go
												     in the Deploy column"). A person's note is a fact
												     about WHY this deploy happened, not about what
												     changed in the manifest — it belongs beside Started/
												     Triggered by/Promoted, not in the Change column it
												     used to share with the commit range. -->
																	{#if who?.kind === 'User' && entry.message}
																		<!--
														`Reason` CLAIMED MORE THAN THE FIELD HOLDS, AND RENAMING
														IT TO `Recorded note` WAS ONLY HALF THE FIX. (2026-09-03,
														operator-walk finding P11) This string is whatever the API
														recorded — and when a person leaves the reason field BLANK,
														the API does not record silence, it records ITS OWN
														boilerplate: `Pinned version` after a rollback, `Force
														deploy` after a manual deploy — see `isSystemDefaultNote`'s
														own note in `history-marks.ts` for the closed set, joined on
														`rollout-dashboard/main.go`'s own literal strings. Printed
														under `Recorded note` unconditionally, that boilerplate
														reads exactly like a colleague typed it — the defect this
														branch exists to close. A default is presented as what it
														is (the note slot says nobody left one, a SEPARATE labelled
														field says what the system did), and a genuine note is
														printed exactly as before.

														⭐ `who?.kind === 'User'` GATES THE WHOLE BLOCK NOW (AD
														round 6, nits: "show a note ONLY when a person wrote
														one"). An `Automatic`/controller deploy's own `message`
														is never a person's note — it is the controller's OWN
														sentence ("Automatic deployment"), a string
														`isSystemDefaultNote`'s closed set does not even
														recognise (that set is deliberately scoped to boilerplate
														written on actions a PERSON started, per its own doc
														comment), so it used to fall to the plain `{:else}`
														branch and print under `Recorded note` as if a colleague
														had typed it. The DEPLOY column's own `Triggered by`
														fact already says "Automatic" — nothing is lost by
														saying nothing here instead of repeating the controller's
														own boilerplate as if it were a reason.
													-->
																		{#if isSystemDefaultNote(entry.message)}
																			<div class="t-meta flex items-baseline gap-1.5">
																				<span class="text-fg-subtle shrink-0">Recorded note</span>
																				<span class="text-fg-disabled italic">no note recorded</span
																				>
																			</div>
																			<div class="t-meta flex items-baseline gap-1.5">
																				<span class="text-fg-subtle shrink-0">System</span>
																				<span class="text-fg-muted"
																					>{systemNoteDescription(entry.message)}</span
																				>
																			</div>
																		{:else}
																			<div class="t-meta flex items-baseline gap-1.5">
																				<span class="text-fg-subtle shrink-0">Recorded note</span>
																				<span class="text-fg-muted"
																					>{stripEmphasisMarkers(entry.message)}</span
																				>
																			</div>
																		{/if}
																	{/if}
																	<!-- ⭐ FACTS THE ROW LACKS, NOT THE ROW'S OWN LINE AGAIN
												     (AD round 5, item 6): "the DEPLOY column carries facts
												     the row LACKS: started at, checks finished at, which
												     checks ran, the trigger, and how it was promoted. Don't
												     repeat the row's outcome line." The row already says
												     "Healthy in 1m" / "Failed after 1m" / "Checking for
												     26m" (line 2, `wait`/`liveWait`) — this used to print
												     that exact sentence a second time, which is the "Failed
												     after 1m" twice defect the round-5 composite shows.
												     Absolute clock times are a genuinely different fact
												     (when, not how long), and the trigger/promotion facts
												     were not on the row at all. -->
																	<div class="t-meta flex items-baseline gap-1.5">
																		<span class="text-fg-subtle shrink-0">Started</span>
																		<span class="text-fg-muted" title={formatDate(entry.timestamp)}
																			>{clockTime(entry.timestamp)}</span
																		>
																	</div>
																	{#if wait}
																		<div class="t-meta flex items-baseline gap-1.5">
																			<span class="text-fg-subtle shrink-0"
																				>{wait.outcome === 'Failed'
																					? 'Failed at'
																					: 'Checks finished'}</span
																			>
																			<span
																				class="text-fg-muted"
																				title={formatDate(entry.bakeEndTime ?? '')}
																				>{clockTime(entry.bakeEndTime ?? '')}</span
																			>
																		</div>
																	{/if}
																	{#if who && actor}
																		<!-- ⭐ DROPPED ON THE PHONE WHEN IT'S THE CONTROLLER
													     (History round 15, AD round 11, item 3, binding):
													     "drop 'Triggered by Automatic' on the phone." Kept
													     at `sm` and up, and for a PERSON-triggered deploy
													     at every width — "who" still matters there the way
													     it doesn't for the overwhelming majority-case
													     "Automatic". -->
																		<div
																			class="t-meta items-center gap-1.5 {actor.kind ===
																			'controller'
																				? 'hidden sm:flex'
																				: 'flex'}"
																		>
																			<span class="text-fg-subtle shrink-0">Triggered by</span>
																			<Avatar
																				name={actor.kind === 'controller'
																					? 'Automatic'
																					: actor.name}
																				kind={actor.kind === 'controller' ? 'controller' : 'person'}
																				src={actor.src}
																				size={16}
																			/>
																			<span class="text-fg-muted">
																				{actor.kind === 'controller' ? 'Automatic' : actor.name}
																			</span>
																		</div>
																	{/if}
																	{#if act && act.kind === 'redeploy'}
																		<!-- ⛔ THE BARE "Redeployed" FACT IS GONE (AD round 9,
													     nits: "'Redeployed' gets its value, or the row is
													     removed"). Round 8's own fix dropped the sha here
													     (the Change column above already names the build,
													     "Same build as {sha}") but kept a label/value-shaped
													     row with no value in it — a fact with nothing to
													     pair the word with reads as unfinished in a column
													     that is otherwise all label-then-value. The ROW's
													     own dot-list already says "Redeployed" too, so
													     nothing is lost by not repeating the bare word a
													     third time here. -->
																	{:else if act}
																		<!-- ⭐ "Rolled back", NEVER "Promoted", FOR A ROLLBACK
													     (AD round 6, nits): the label used to be the fixed
													     word "Promoted" for every `act` — correct for a
													     forward step, but for a rollback it sat next to a
													     VALUE that itself led with "Rolled back…", two
													     different verbs for one fact on one line. The label
													     now matches the act's own verb.
													     ⭐ THE SHA TRANSITION STAYS ON ONE LINE (AD round 6,
													     nits) — composed from `act.from`/`act.to` directly
													     (not `act.sentence`'s raw string, which has no seam
													     to hang `whitespace-nowrap` on) so the "X → Y" pair
													     can be wrapped in its own `nowrap` span while the
													     surrounding prose still wraps normally. -->
																		<!-- ⭐ DROPPED BELOW `sm` ON THE FAILED LIVE ROW ONLY
													     (History round 14, coordinator call on D1): the
													     cadence strip directly above this panel already
													     draws the exact same transition as two chips
													     (`3f1ed09 → a02f1c4`) — restating it here as a
													     third DEPLOY fact is what was still pushing the
													     failed check below the fixed bottom nav at 390.
													     Kept at `sm` and up, and for every row that is NOT
													     the open failure (a resolved past row has no
													     cadence-strip chip pointing at it the way the live
													     row does). -->
																		<div
																			class="t-meta flex-wrap items-baseline gap-x-1.5 {isCurrent &&
																			entry.bakeStatus === 'Failed'
																				? 'hidden sm:flex'
																				: 'flex'}"
																			title={act.sentence}
																		>
																			<span class="text-fg-subtle shrink-0"
																				>{act.kind === 'rollback'
																					? 'Rolled back'
																					: 'Promoted'}</span
																			>
																			<span class="text-fg-muted">
																				{#if act.kind === 'rollback' || act.kind === 'forward'}
																					{act.by}
																					release{act.by === 1 ? '' : 's'}:
																					<span class="t-code-sm text-fg-muted whitespace-nowrap"
																						>{act.from} → {act.to}</span
																					>
																				{:else}
																					{act.sentence.replace(/\.$/, '')}
																				{/if}
																			</span>
																		</div>
																	{/if}
																	{#if entry.bakeStatusMessage && !(entry.failedHealthChecks && entry.failedHealthChecks.length > 0)}
																		<!-- ⭐ ONLY WHEN THERE IS NO STRUCTURED CHECK LIST (AD
													     round 9, item 3: "remove the duplicate 'HighErrorRate
													     firing' line"). This status message and
													     `failedHealthChecks[0]`'s own name were THE SAME
													     fact, printed twice — this plain line restated what
													     the structured list two lines down already says, in
													     its own ink. The structured list is authoritative
													     whenever it exists; this is the fallback for a bake
													     that failed (or is still in flight) with nothing more
													     specific recorded.
													     ⭐ PLAIN fg-muted, NO GLYPH, NO DANGER INK (AD round 9,
													     item 3: "the step note is plain fg-muted") — reversing
													     round 1's own "failure reason gets the danger glyph"
													     now that it never coexists with the real signal
													     (`failedHealthChecks`, which keeps its own glyph and
													     danger ink): this is a quiet note about the bake's
													     own state, not a second alarm. -->
																		{#if entry.bakeStatus === 'Failed'}
																			<!-- ⭐ A FAILURE REASON IS ALWAYS `FailedCheckLine` (round
														     16, AD round 12, item 1): a failed bake with no
														     structured check list still has a reason, and it
														     prints in the one shared line — first in the
														     column, muted once resolved — not as a bespoke
														     plain note. -->
																			<div class="order-first flex flex-col gap-1.5">
																				<FailedCheckLine
																					check={{ name: entry.bakeStatusMessage }}
																					danger={isCurrent}
																				/>
																			</div>
																		{:else}
																			<div class="t-meta text-fg-muted flex items-start gap-1.5">
																				<span>{entry.bakeStatusMessage}</span>
																			</div>
																		{/if}
																	{/if}
																	<!-- ⭐ DROPPED: "Checked for Xm" (AD round 2, same "drop
												     whatever the row already says" rule). A second,
												     DIFFERENT duration number (the check phase alone, vs
												     line 2's own deploy-to-healthy span) read as a
												     correction of the row's own figure rather than a new
												     fact — one deploy, two timers. -->
																	{#if entry.failedHealthChecks && entry.failedHealthChecks.length > 0}
																		<!-- ⛔ A FAILING ROW IS NEVER A BAND. (§2.5, principle 12;
													     2026-10-08, TL review round 3.) This used to fill
													     `bg-danger-tint` — a solid tinted block the size of
													     the check, the "1600×124 brown slab" defect §2.5
													     names by its measured dimensions. A neutral row
													     with the glyph and the message in danger ink carries
													     the same fact at chip scale, not area scale. -->
																		<!-- ⭐ `FailedCheckLine` (History round 14, AD round
													     10, D4, binding; extracted on the coordinator's
													     follow-up for its own synthetic-data test — see
													     the component's own doc comment). `danger={isCurrent}`
													     is this row's own equivalent of the page header's
													     `openFailed`: a PAST row's failed check is, by
													     definition, no longer the open alarm (a later
													     deploy is `history[0]` now), so it reads as
													     history, muted, not as something still ringing.
													     ⭐ `order-first` (History round 15,
													     AD round 11, item 3, binding; widened to EVERY width in
													     round 16, AD round 12, item 1): "the failed-check
													     line is the FIRST line of the DEPLOY panel" — was
													     phone only. The reason the check exists is the
													     reason the row is here; `Started`/`Triggered
													     by`/`Promoted` are context, not the headline, and at
													     390 the headline is what has to clear the fold.
													     The rest keeps its chronological order
													     (Started → outcome → who → why) beneath it. -->
																		<div class="order-first flex flex-col gap-1.5">
																			{#each entry.failedHealthChecks as check}
																				<FailedCheckLine {check} danger={isCurrent} />
																			{/each}
																		</div>
																	{/if}
																</div>
															</div>

															<!-- Action buttons -->
															<!-- ⭐ A FIXED 2-UP GRID ON THE PHONE (History round 15, AD
									     round 11, item 6, binding): "a fixed two-column grid of
									     equal-width buttons, keeping one height." Was `flex
									     flex-wrap` — natural-width buttons wrapping wherever
									     they happened to fit, which is what let "Copy tag" (or
									     whichever button was narrowest) land alone on an
									     uneven trailing row. A 2-column grid makes every cell
									     the same width regardless of label length, and every
									     row the same height (`.btn`'s own fixed 36px, grid's
									     default `align-items: stretch` keeps a lone trailing
									     button in a half-full row from stretching taller than
									     its neighbours). `sm:flex` returns to the natural-width
									     wrap at `sm` and up, where the row has room to spare. -->
															<!-- ⭐ `hist-row-actions`, 44px BELOW `sm` (History round
									     15, coordinator follow-up on item 6): "the phone row
									     action buttons are 28px tall, below the 44px touch
									     rule every other phone action now follows." `.btn-xs`'s
									     own 28px (`app.css`'s "ONE HEIGHT… per size step") is
									     the shared value for every OTHER `.btn-xs` on the
									     product and stays there at `sm`+ and on every other
									     page — scoped here, like `.hist-panel-lg-weight`'s own
									     rule, via `:global()` so it reaches each button's own
									     `.btn` class without stripping its scope; the grid's
									     own `grid-cols-2` already makes every cell (and so
									     every button, which fills its cell) equal width. -->
															<div
																class="hist-row-actions border-line-subtle mt-4 grid grid-cols-2 gap-2 border-t pt-3 sm:flex sm:flex-wrap sm:items-center"
															>
																{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
																	<SourceViewer
																		namespace={rollout.metadata?.namespace || ''}
																		name={rollout.metadata?.name || ''}
																		version={entry.version.tag}
																		{cluster}
																	/>
																{/if}
																<!-- ⭐ ROLL BACK FIRST, THEN VIEW DIFF — EVERYWHERE (AD
											     round 5, item 7): "one action-pair order everywhere (row
											     hover, panel, strip card)." The row's own hover actions
											     and the strip's hover card both already put "Roll back
											     to this" before "View diff"; this footer had the pair
											     backwards (round 1/3's own ordering, never revisited once
											     the other two surfaces settled on Roll-back-first) — two
											     different orders for the same pair on the same page.
											     ⭐ ROLL BACK ONLY TO A PREVIOUS HEALTHY ENTRY (squad
											     lead's own decision, round 4, AD round 1 item 8): "offers
											     Roll back on the FAILED build." Rolling back TO the
											     build that just failed is not a remedy — the ledger's
											     own failed row needs "View diff" to explain what broke,
											     not a button that would redeploy the same break. -->
																{#if entry.version.tag !== rollout?.status?.history?.[0]?.version?.tag && entry.bakeStatus === 'Succeeded'}
																	<button
																		type="button"
																		class="btn btn-secondary btn-xs"
																		onclick={() => {
																			selectedVersionTag = entry.version.tag;
																			if (
																				rollout?.status?.history &&
																				rollout.status.history.length > 0
																			) {
																				const cur = rollout.status.history[0].version;
																				deployExplanation = ''; // the operator writes the reason; nothing is pre-asserted
																			}
																			showChangeVersionModal = true;
																		}}
																	>
																		<UndoOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
																		Roll back to this
																	</button>
																{/if}
																<!-- "View diff" only when both manifests resolve (`DiffLink`, qa11 B3);
											     never gated on `artifactType`. -->
																<DiffLink
																	{cluster}
																	namespace={rollout?.metadata?.namespace ?? ''}
																	name={rollout?.metadata?.name ?? ''}
																	history={rollout?.status?.history ?? []}
																	index={i}
																	{atLimit}
																/>
																{#if datadogTestInfo}
																	<a
																		href={buildDatadogLogsUrl(
																			datadogTestInfo.service,
																			datadogTestInfo.env
																		)}
																		target="_blank"
																		rel="noreferrer"
																		class="btn btn-secondary btn-xs"
																	>
																		<DatadogLogo class="h-3 w-3 shrink-0" />
																		Logs
																	</a>
																	<a
																		href={buildDatadogTestRunsUrl(
																			datadogTestInfo.service,
																			isCurrent && datadogTestInfo.version
																				? datadogTestInfo.version
																				: '*' + entry.version.tag + '*'
																		)}
																		target="_blank"
																		rel="noreferrer"
																		class="btn btn-secondary btn-xs"
																	>
																		<DatadogLogo class="h-3 w-3 shrink-0" />
																		CI
																	</a>
																{/if}
																<!-- CopyButton BEFORE GitHubViewButton (History round
											     14, AD round 10, D6 nit): "the failed entry's actions
											     don't leave 'Copy tag' stranded on its own row." At
											     390 this row never fits all three — "View diff",
											     "View on GitHub" (the widest, 128px) and "Copy tag"
											     total 327px against a 281px row — one item always
											     wraps regardless of order. What changes with order is
											     WHICH one: trailing it last (as before) put the
											     smallest, plainest button alone on an otherwise-empty
											     row. Moving it ahead of GitHubViewButton pairs it
											     with "View diff" instead (191px, well inside the
											     row), leaving the external link — a button that reads
											     as complete alone, the way every other lone
											     external-link button on this page does — as the one
											     that wraps. -->
																<CopyButton
																	value={entry.version.tag}
																	label={`version ${getDisplayVersion(entry.version)}`}
																	text="Copy tag"
																/>
																{#if rollout?.status?.source}
																	<GitHubViewButton
																		sourceUrl={rollout.status.source}
																		version={getDisplayVersion(entry.version)}
																		revision={entry.version.revision}
																		size="xs"
																		color="light"
																	/>
																{/if}
															</div>
														</div>
													{/if}
												</div>
											{/each}
										</div>
									{/each}
								</div>
								{#if foldedDeployCount > 0 && !showAllDeploys}
									<!-- REFERENCE REGION: `.btn-secondary.btn-sm`, the fold
						     grammar every other dense list in the product uses
						     for "show more". -->
									<div class="border-line-subtle flex justify-center border-t p-3">
										<button type="button" class="btn btn-secondary btn-sm" onclick={expandFold}>
											Show {foldedDeployCount} earlier deploy{foldedDeployCount === 1 ? '' : 's'}
											<!-- ⭐ THE ONE PLACE "of N" PRINTS NOW (AD round 3, item
								     1) — the header meta and this card's own rollup
								     above dropped their copy of the lifetime total; a
								     reader asking "how many more are there, in total"
								     is asking exactly here.
								     ⭐ `filteredHistory.length`, NOT `totalDeploys` (AD
								     round 7, nits: "'Show 3 earlier' matches the 7d
								     header count"). `foldedDeployCount` itself is already
								     computed from `filteredHistory.length` (the RANGE's
								     own total, matching the header meta's "8 deploys in
								     7d") — this parenthetical used to cite the LIFETIME
								     total instead (11, say), so "Show 3 earlier" sat next
								     to a number that described a different window than
								     the one being folded. `filteredHistory.length` equals
								     `totalDeploys` exactly when the range is `all`, so
								     this is never a regression for that case. -->
											<span class="text-fg-subtle">(of {filteredHistory.length} total)</span>
										</button>
									</div>
								{/if}
							{/if}
						</Card>
					</div>

					<div class="flex min-w-0 flex-col gap-4">
						<!-- ⭐ THE RAIL'S OWN "Summary" (spec §1) — new component,
				     `HistorySummaryCard`; see its own doc comment for why it
				     is new and what it borrows. Scoped to the SAME range the
				     ledger and the cadence strip show, so its rollup names
				     that range rather than the rollout's whole lifetime. -->
						<HistorySummaryCard
							rangeLabel={{
								'1d': 'last 24 hours',
								'7d': 'last 7 days',
								'30d': 'last 30 days',
								all: 'all time'
							}[cadenceRange]}
							failed={filteredHistory.filter(({ e }) => e.bakeStatus === 'Failed').length}
							failedOpen={openFailed}
							rolledBack={filteredHistory.filter(({ i }) => acts[i]?.kind === 'rollback').length}
							{medianHealthyMs}
							{lastFailureAgo}
							kept={keptLabel}
							compact={totalDeploys < 2}
							scoped={cadenceRange !== 'all'}
						/>
						<EventsCard {events} deployedAt={eventsDeployedAt} />
					</div>
				</div>
			</div>
		</div>

		<!-- PALROW r8: the SAME flow the Overview mounts: the recovery warning
		     first when the next deploy would run in recovery mode, then the
		     picker (lib/components/ChangeVersionFlow.svelte). -->
		<ChangeVersionFlow
			bind:open={showChangeVersionModal}
			{rollout}
			{isPinVersionMode}
			initialSelectedVersion={selectedVersionTag}
			initialExplanation={deployExplanation}
			{cluster}
			environmentName={environment?.spec?.environment ?? null}
		/>
	{/if}
</div>

<style>
	/*
	 * ⭐ THE SAME MATH AS THE OVERVIEW TAB'S OWN `.ov-split`/`.ov-split-cq`
	 * (2026-10-08, TL review round 3) — copied, not re-derived, so the two
	 * tabs' rails measure identically (452px rail, 16px gap at 1440). Scoped
	 * to this component: it does not touch `.ov-split` itself (not this
	 * page's file to edit) or the shared `.rail-wrap`/`.rail-grid` Home and
	 * `/changes` still use correctly for their own fleet-index shell.
	 */
	.hist-split-cq {
		container-type: inline-size;
	}

	/* ⭐ THE ROW'S OWN BUILD ID (AD round 8, item 4): 14px mono (`.t-code`'s
	   own size), weight 500 — see the call site's own note on why this is a
	   scoped class instead of a Tailwind utility. */
	.build-id {
		font-weight: 500;
	}

	/* ⭐ (History round 15, AD round 11, item 7, binding): "at lg+, panel
	   facts are 13px… measure the Overview's own computed size to match."
	   13px/18px is this panel's own step, not a new rung on `language.css`'s
	   ladder — scoped here, under `lg`, so `.t-meta`'s shared 12px/16px is
	   unchanged everywhere else that class is used, on this page and
	   every other. `:global()` reaches the facts' own `.t-meta` elements
	   (this panel's own DEPLOY facts, and `CommitSummary`'s CHANGE-column
	   rows, which share the same visual tier one panel over) without
	   stripping either side's Svelte scope.
	   ⛔ `:not(.check-line)` IS LOAD-BEARING — measured live: without it
	   this rule's 3-class specificity (`.hist-panel-lg-weight.svelte-x
	   .t-meta`) beat `FailedCheckLine`'s own 2-class `.check-line.svelte-y`
	   rule regardless of source order, so the failed-check line was
	   silently clamped back to 13px instead of the 14px item 7 asks for.
	   `:not()` does not raise specificity beyond its own argument, so this
	   rule simply stops matching `.check-line` at all rather than racing
	   it. */
	@media (min-width: 1024px) {
		.hist-panel-lg-weight :global(.t-meta):not(.check-line) {
			font-size: 13px;
			line-height: 18px;
		}
	}

	/* ⭐ (History round 15, coordinator follow-up on item 6): "make them
	   44px below sm… equal width in the 2-column grid, with desktop
	   unchanged." `max-width: 639.98px` matches the breakpoint every other
	   phone-only rule on this page already uses (`.tap-zone`'s own 390
	   padding override, just above). Equal width is already the grid's own
	   doing (`grid-cols-2`, each button fills its cell) — this only grows
	   the height. */
	/* Round 16 (AD round 12, item 2): the trigger's name hides whenever the
	   row's details wrap; `wrapCompact` (lib/wrap-compact.ts) sets the class. */
	:global(.wrap-compact) .trigger-name {
		display: none;
	}

	@media (max-width: 639.98px) {
		.hist-row-actions :global(.btn) {
			height: 44px;
		}
		/* Round 16 (AD round 12, item 3): a lone trailing button in the
		   2-up grid (three buttons: Diff · Copy tag · View on GitHub) spans
		   both columns instead of sitting in half a row. */
		.hist-row-actions > :global(:last-child:nth-child(odd)) {
			grid-column: 1 / -1;
		}
	}

	@container (min-width: 1080px) {
		.hist-split {
			display: grid;
			grid-template-columns: 3fr minmax(22rem, 2fr);
			align-items: start;
		}
	}

	/*
	 * ⭐ THE SPINE, ONE LINE ON THE LIST (round 4, 2026-10-10; AD rounds 1-3:
	 * "one continuous 1px line drawn on the LIST, not per row, from the first
	 * row's mark to the last, passing through the day subheaders and the
	 * expanded panels"). Three rounds drew it as a `::before` per row and per
	 * subheader, each guessing its neighbour's padding, and it broke into
	 * stubs wherever a row's height differed. Now the ledger draws it ONCE as
	 * its own `::before`; `use:ledgerSpine` (lib/ledger-spine.ts) measures the
	 * first and last `[data-spine-mark]` and sets where it starts, ends and
	 * its x, re-measuring as rows expand. It paints above the row, subheader
	 * and expanded-panel grounds (so it visibly passes through all three) and
	 * below the marks. `line-strong`, not `line`: in dark `line` is 0.013 L
	 * from the subheaders' `bg-subtle` and the line vanished through them.
	 */
	.deploy-ledger {
		position: relative;
		isolation: isolate;
	}
	.deploy-ledger::before {
		content: '';
		position: absolute;
		left: var(--spine-x, 24px);
		top: var(--spine-top, 0);
		height: var(--spine-h, 0);
		width: 1px;
		background-color: var(--k-line-strong);
		z-index: 1;
		pointer-events: none;
	}

	/*
	 * ⭐ THE MARK SITS ON THE LINE WITH A 3px RING OF THE ROW'S GROUND. The
	 * ring goes on the visible mark itself (the 6px rest dot, or the 16px
	 * glyph), never on the 16px slot around a 6px dot, which cut a 22px hole
	 * in the line. `:global()` because the nodes are rendered by `RestGlyph`
	 * / `BakeStatusIcon`. The ring is the surface plus whatever veil the row
	 * wears (hover, selected), so it never shows as a disc of another shade.
	 */
	:global(.deploy-glyph-ring) {
		position: relative;
		z-index: 2;
		border-radius: 9999px;
		box-shadow:
			0 0 0 3px var(--spine-veil, transparent),
			0 0 0 3px var(--k-surface);
	}
	:global(span.deploy-glyph-ring:has(> span[aria-hidden='true'])) {
		box-shadow: none;
	}
	:global(span.deploy-glyph-ring > span[aria-hidden='true']) {
		border-radius: 9999px;
		box-shadow:
			0 0 0 3px var(--spine-veil, transparent),
			0 0 0 3px var(--k-surface);
	}
	.deploy-ledger .tap-zone:hover {
		--spine-veil: var(--k-hover);
	}
	/* ⭐ ROW PADDING, 390 ONLY (History round 14, coordinator call on D1):
	   `.tap-zone`'s own `py-3` is the shared row convention (`/changes`,
	   `ChangeHistoryCard`, …) and stays everywhere else — scoped here to
	   `.deploy-ledger` alone, and only below `sm`, where every px between
	   the row and the failed check's own message still counts against the
	   fixed bottom nav. Desktop/tablet rows are untouched. */
	@media (max-width: 639px) {
		.deploy-ledger .tap-zone {
			padding-top: 0.5rem;
			padding-bottom: 0.5rem;
		}
	}
	.deploy-ledger :global(.deploy-row.bg-selected) {
		--spine-veil: var(--k-selected);
	}
</style>
