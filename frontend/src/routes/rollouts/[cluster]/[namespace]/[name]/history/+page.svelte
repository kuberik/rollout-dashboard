<script lang="ts">
	import type {
		Rollout,
		Kustomization,
		ManagedResourceStatus,
		RolloutTest
	} from '../../../../../../types';
	import { Badge, Button, Spinner, Alert } from 'flowbite-svelte';
	import Chip from '$lib/components/Chip.svelte';
	import {
		ClockSolid,
		CodePullRequestSolid,
		UndoOutline,
		UserSolid,
		CogSolid,
		ChevronDownOutline,
		ChevronUpOutline,
		LayersSolid,
		RefreshOutline,
		ChevronRightOutline,
		ChartLineUpOutline,
		ListOutline
	} from 'flowbite-svelte-icons';
	import {
		formatTimeAgo,
		formatTimeAgoCompact,
		formatDuration,
		formatDate,
		getDisplayVersion,
		extractDatadogInfoFromContainers,
		buildDatadogTestRunsUrl,
		buildDatadogLogsUrl
	} from '$lib/utils';
	import { versionPathForRollout } from '$lib/version-utils';
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
	import { deployActs, historyAtLimit } from '$lib/history-marks';
	import { DEPLOY_PARAM, deployAnnouncement, findDeployIndex } from '$lib/history-deeplink';
	import { announce } from '$lib/stores/announce.svelte';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import DatadogLogo from '$lib/components/DatadogLogo.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeploymentTimeline from '$lib/components/DeploymentTimeline.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList from '$lib/components/FactList.svelte';

	import { page } from '$app/stores';
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutQueryOptions, rolloutsInNamespaceQueryOptions } from '$lib/api/rollouts';

	const cluster = $derived(get(page).params.cluster as string);
	const namespace = $derived(get(page).params.namespace as string);
	const name = $derived(get(page).params.name as string);

	const rolloutQuery = createQuery(() => rolloutQueryOptions({ namespace, name, cluster }));

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const kustomizations = $derived(
		(rolloutQuery.data?.kustomizations?.items as Kustomization[]) || []
	);
	const loading = $derived(rolloutQuery.isLoading);
	const error = $derived(rolloutQuery.isError ? (rolloutQuery.error as Error).message : null);

	// Environment data (shipped with rollout query response)
	const environment = $derived(rolloutQuery.data?.environment);
	const envInfos = $derived(environment?.status?.environmentInfos ?? []);
	const currentEnvName = $derived(environment?.spec?.environment);
	const hasOtherEnvs = $derived(
		envInfos.filter((e) => e.environment !== currentEnvName).length > 0
	);

	// Toggles: show sibling environments / compare rollouts across namespace
	let showEnvironments = $state(false);
	let showComparison = $state(false);

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
						const clusterParam = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
						const res = await fetch(
							`/api/kustomizations/${ksNamespace}/${ksName}/managed-resources${clusterParam}`
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
	 */
	let timeRange = $state<TimeRange>('all');
	let selectedEntry = $state<{ serviceId: string; index: number } | null>(null);

	/**
	 * WHAT EACH DEPLOY DID, not just how it ended. See `history-marks.ts`:
	 * index-aligned with `status.history`, `null` where the ordering cannot
	 * answer. This is what makes a rollback readable AT REST on the page whose
	 * job is history — `/` and `/rollouts` have flagged it at rest for weeks.
	 */
	const acts = $derived(deployActs(rollout));
	const rollbacks = $derived(acts.filter((a) => a?.kind === 'rollback').length);

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
		Math.min(220, Math.max(72, 16 + chartServices.reduce((m, s) => Math.max(m, s.name.length), 0) * 6.7))
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

	// Stats (over all history, not filtered)
	const allHistory = $derived(rollout?.status?.history ?? []);
	const totalDeploys = $derived(allHistory.length);
	const succeeded = $derived(allHistory.filter((e) => e.bakeStatus === 'Succeeded').length);
	const failed = $derived(allHistory.filter((e) => e.bakeStatus === 'Failed').length);
	const successRate = $derived(totalDeploys > 0 ? Math.round((succeeded / totalDeploys) * 100) : 0);

	/**
	 * ⛔ `spec.versionHistoryLimit` BOUNDS `status.history`, AND EVERY STAT
	 * ABOVE READS THAT ARRAY AS IF IT WERE THE WHOLE STORY. (2026-09-03,
	 * operator-walk finding 13.) `hello-world-dev/hello-world-app`'s own
	 * `versionHistoryLimit: 5` evicts its oldest entry every time a new deploy
	 * lands, so `totalDeploys` and `successRate` are both a measurement of the
	 * RETAINED WINDOW, not of the rollout's lifetime — and printing them bare
	 * states them as if they were. `historyAtLimit` is the same predicate
	 * `history-marks.ts` uses to decide whether the oldest surviving entry's
	 * "from" is unknown; here it gates whether the header has to say so.
	 */
	const atLimit = $derived(historyAtLimit(rollout));

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
	function spanLabel(ms: number): string {
		const m = Math.floor(ms / 60_000);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
		const d = Math.floor(h / 24);
		return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
	}

	// Expanded entry state
	let expandedIdx = $state<Set<number>>(new Set());
	function toggleExpand(i: number) {
		const next = new Set(expandedIdx);
		next.has(i) ? next.delete(i) : next.add(i);
		expandedIdx = next;
	}

	// Element refs for scroll-to-entry
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

	// Rollback modal
	let showChangeVersionModal = $state(false);
	let selectedVersionTag = $state<string | null>(null);
	let deployExplanation = $state('');

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
			hour12: false
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
		const key = `${url.pathname}?${want}`;
		if (deepLinkHandled === key) return;
		const idx = findDeployIndex(history, want);
		// ⛔ NOT `deepLinkHandled = key` BEFORE THIS. A key that names no entry
		// in the history we have RIGHT NOW may name one in the next poll —
		// latching here would silently swallow a link to a deploy that had not
		// been written to `status.history` yet.
		if (idx < 0) return;
		deepLinkHandled = key;
		revealEntry(idx, { focus: true });
	});
</script>

<svelte:head>
	<title>
		kuberik | {rollout?.metadata
			? `${rollout.metadata.name} (${rollout.metadata.namespace}) - History`
			: 'Rollout History'}
	</title>
</svelte:head>

<div class="h-full w-full dark:bg-gray-900">
	{#if loading}
		<div class="flex h-full items-center justify-center">
			<Spinner size="8" />
		</div>
	{:else if error}
		<div class="p-4">
			<Alert color="red">{error}</Alert>
		</div>
	{:else if !rollout}
		<!--
			Same object, same words, same actions as the overview tab's missing
			state — see the note there. The Flowbite `Alert color="yellow"` this
			replaces measured **1.78:1 light / 2.53:1 dark at 14px**
			(`bg-yellow-100 text-yellow-500`), the worst-read text in the product,
			and it said four words with no way out of the page.
		-->
		<div class="p-4">
			<!-- Same object, same fields, as the Overview tab's missing state — see
			     the note there. Fields, not a sentence: the namespace/name pair is
			     what an engineer pastes after `kubectl get rollout -n`. -->
			{#snippet missing()}
				<FactList
					tone="banner"
					facts={[
						{ label: 'Rollout', value: `${namespace}/${name}`, handle: true },
						{ label: 'Server answered', value: 'no release' }
					]}
				/>
			{/snippet}
			<AlertPanel
				severity="warning"
				class=""
				title="This rollout does not exist"
				message="It may have been deleted, or the address may be wrong."
				footnoteBody={missing}
			>
				{#snippet actions()}
					<button type="button" class="btn btn-secondary" onclick={() => rolloutQuery.refetch()}>
						<RefreshOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
						Try again
					</button>
					<!-- A LINK, NOT A BUTTON. (2026-09-02) `Try again` re-issues the
					     request; this only goes somewhere. Same contract as
					     `ErrorState`, which is the other half of this state. -->
					<a href="/rollouts" class="nav-link">
						Back to all rollouts
						<ChevronRightOutline aria-hidden="true" />
					</a>
				{/snippet}
			</AlertPanel>
		</div>
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
		<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
			<!-- Page header + stats bar -->
			<div class="mb-5 flex flex-wrap items-start justify-between gap-4">
				<div>
					<!--
						⛔ THE TITLE SAID WHAT THE TAB BAR 40px ABOVE IT ALREADY SAID.
						(2026-09-01) From the human, about `/versions`: *"i think i don't
						like that we have a title on the page when it's already in the
						navbar."* The same thing is true here — the rollout layout's tab
						strip renders `History` as the SELECTED tab, and this printed
						`Deployment History` directly under it. Same fact, two objects, no
						second reading.

						THE HEADING IS NOT DELETED, IT IS UNVOICED. `h1`, not `h2`: this
						tab is a page and its outline has to start at level 1, so the
						heading stays and goes `sr-only` — the reason it was added in the
						first place ("jump to the heading" landing nowhere) is untouched.
						What takes the visible slot is the line that was already under it:
						the page's SCOPE, which names the rollout the deploys belong to
						and is the one thing the tab strip does not say. It moves up a
						type role to lead, and the stat chips to its right are unchanged.
					-->
					<h1 class="sr-only">Deployment History</h1>
					<!-- The same display pair the Overview and Dependencies tabs open
					     with: one object, three tabs, one head. "All deployments for …"
					     was the only tab-head written as a sentence. -->
					<p class="flex min-w-0 flex-wrap items-baseline gap-2">
						<span class="t-display-id min-w-0 truncate text-gray-900 dark:text-white">{name}</span>
						{#if rollout?.status?.title && rollout.status.title !== name}
							<span class="t-display min-w-0 truncate text-gray-500 dark:text-gray-400">{rollout.status.title}</span>
						{/if}
					</p>
				</div>
				<!--
					⛔ `100% SUCCESS` WAS TRUE AND IT WAS THE WRONG HEADLINE.
					A rollback IS a successful deploy — it bakes, it goes green, it
					counts toward the rate. So a success rate can never contain the
					fact that production went backwards, and the header stated the
					rate and nothing else while `hello-world-app` had gone backwards
					TWICE in the five deploys listed below it.
					The rate stays; the rollback count stands beside it. The FAILED
					pill only draws when there is a failure to draw — an always-on
					red `0` is the norm wearing the alarm's colour, and it was the
					only red on a page with nothing wrong.
				-->
				<!-- The tally is a CAPTION, the same t-dense line every page header carries
				     ("15 rollouts in 9 namespaces · 2 clusters"), not four filled pills.
				     Ink keeps its meaning — green for healthy, red for failed, the rate in
				     its own band — and nothing is boxed. -->
				<p class="t-dense flex flex-wrap items-center gap-x-2 text-gray-500 dark:text-gray-400">
					<span
						title={atLimit
							? `Showing the last ${totalDeploys} deploys — the retention limit (spec.versionHistoryLimit). Earlier deploys have already been evicted.`
							: undefined}
					>
						{#if atLimit}
							showing the last
						{/if}
						<span class="font-semibold tabular-nums text-gray-900 dark:text-white">{totalDeploys}</span>
						{totalDeploys === 1 ? 'deploy' : 'deploys'}
						{#if atLimit}
							<span class="text-gray-400 dark:text-gray-500">(retention limit)</span>
						{/if}
					</span>
					<span aria-hidden="true">·</span>
					<span title="{succeeded} of {totalDeploys} deploys finished healthy">
						<span class="font-semibold tabular-nums text-green-700 dark:text-green-400">{succeeded}</span>
						healthy
					</span>
					{#if failed > 0}
						<span aria-hidden="true">·</span>
						<span title="{failed} of {totalDeploys} deploys failed">
							<span class="font-semibold tabular-nums text-red-700 dark:text-red-400">{failed}</span>
							failed
						</span>
					{/if}
					{#if rollbacks > 0}
						<span aria-hidden="true">·</span>
						<span
							title="{rollbacks} of these {totalDeploys} deploys moved this rollout to an OLDER release. A rollback still bakes and still counts as a success."
						>
							<span class="font-semibold tabular-nums text-gray-900 dark:text-white">{rollbacks}</span>
							rolled back
						</span>
					{/if}
					<!-- A rate needs a sample. "100% success" over one deploy is the
					     same number restated in bold green, and it reads as a track
					     record the page does not have. Same rule as `newerReleaseCount`
					     returning null instead of 0: say nothing rather than a confident
					     nothing.

					     ⛔ AND ONCE THE HISTORY IS AT ITS RETENTION LIMIT, THE RATE IS
					     OVER THE RETAINED WINDOW, NOT THE ROLLOUT'S LIFETIME. (2026-09-03,
					     operator-walk finding 13.) `80% success` over five kept entries
					     reads as a whole track record; `80% of the last 5` says exactly
					     what was measured. -->
					{#if totalDeploys > 1}
					<span aria-hidden="true">·</span>
					<span
						class="font-semibold tabular-nums {successRate >= 90
							? 'text-green-700 dark:text-green-400'
							: successRate >= 70
								? 'text-yellow-700 dark:text-yellow-400'
								: 'text-red-700 dark:text-red-400'}"
						title={atLimit
							? `${successRate}% over the last ${totalDeploys} deploys — the retained window, not the rollout's lifetime.`
							: undefined}
						>{successRate}%
						<!-- Two branches, not a ternary collapsed into one text node — the
						     census scanner cannot see a literal split across two
						     interpolations with nothing but whitespace between them ("…% …"
						     falls under its own documented prose-threshold gap), and this
						     wording is exactly the fact operator-walk finding 13 is about. -->
						{#if atLimit}of last {totalDeploys}{:else}success{/if}</span
					>
					{/if}
				</p>
			</div>

			<!-- Timeline chart card.
			     A TITLED CARD, not a bordered box: 16px icon + 14px/600 title on
			     the left, the rolled-up answer hard-right, body below the rule.
			     Both other regions on this page follow the same header. -->
			<div
				class="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/50"
			>
				<div
					class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
				>
					<h3
						class="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"
					>
						<ChartLineUpOutline
							class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
							aria-hidden="true"
						/>
						Deployment Timeline
					</h3>
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs text-gray-500 tabular-nums dark:text-gray-400">
							{timelineRollup}
						</span>
						{#if hasOtherEnvs}
							<button
								class="hit-32 flex items-center gap-1.5 rounded border px-3 py-[1px] text-xs font-medium transition-colors {showEnvironments
									? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
									: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
								onclick={() => {
									showEnvironments = !showEnvironments;
								}}
								title="Show sibling environments on the timeline"
							>
								<LayersSolid class="h-3.5 w-3.5" />
								{showEnvironments ? 'Hide environments' : 'Show environments'}
							</button>
						{/if}
						<button
							class="hit-32 flex items-center gap-1.5 rounded border px-3 py-[1px] text-xs font-medium transition-colors {showComparison
								? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
								: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
							onclick={() => {
								showComparison = !showComparison;
							}}
							title="Show all other rollouts in this namespace"
						>
							<LayersSolid class="h-3.5 w-3.5" />
							{showComparison ? 'Hide namespace' : 'Compare namespace'}
							{#if showComparison && nsRolloutsQuery.isLoading}
								<Spinner size="4" />
							{/if}
						</button>
					</div>
				</div>
				<div class="p-4">
					<DeploymentTimeline
						services={chartServices}
						bind:timeRange
						{selectedEntry}
						fanOverlaps
						labelWidth={chartLabelWidth}
						onEntryClick={handleChartEntryClick}
					/>
				</div>
			</div>

			<!-- Deployment list -->
			<div class="space-y-1">
				<div
					class="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-200 pb-2 dark:border-gray-700"
				>
					<h3
						class="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"
					>
						<ListOutline
							class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400"
							aria-hidden="true"
						/>
						Deployments
						{#if filteredHistory.length !== totalDeploys}
							<span class="font-normal text-gray-500 dark:text-gray-400">
								({filteredHistory.length} of {totalDeploys})
							</span>
						{/if}
					</h3>
					<!-- The rollup answers the card without reading a row of it, and
					     the fact it carries is the one the page used to hide. -->
					<span class="text-xs text-gray-500 dark:text-gray-400">
						{#if rollbacks > 0}
							<span
								class="inline-flex items-center gap-1 font-semibold text-gray-900 dark:text-white"
							>
								<UndoOutline class="h-3.5 w-3.5" aria-hidden="true" />
								{rollbacks} of {totalDeploys} went backwards
							</span>
						{:else if totalDeploys > 0}
							<!-- Not "all N moved forward": an entry whose release has aged
							     out of `availableReleases` has no position and therefore no
							     direction, and this rollup must not turn that silence into
							     a claim. "No rollbacks" is what the ordering supports. -->
							no rollbacks in {totalDeploys} deploy{totalDeploys === 1 ? '' : 's'}
						{/if}
					</span>
				</div>

				{#if filteredHistory.length === 0}
					<div
						class="flex h-24 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
					>
						No deployments in this time range
					</div>
				{:else}
					{#each filteredHistory as { e: entry, i } (i)}
						{@const isCurrent = i === 0}
						{@const isExpanded = expandedIdx.has(i)}
						{@const act = acts[i]}
						{@const isSelected =
							selectedEntry?.serviceId === `${namespace}/${name}` && selectedEntry?.index === i}

						<div
							use:registerEntry={i}
							class="scroll-mt-28 overflow-hidden rounded-xl border transition-all duration-200 {isSelected
								? 'border-blue-400 shadow-md shadow-blue-100 dark:border-blue-600 dark:shadow-blue-950/50'
								: 'border-gray-200 dark:border-gray-700'} bg-white dark:bg-gray-800/50"
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
								class="tap-zone group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
							>
								<!-- Status icon -->
								<div class="flex-shrink-0 pt-0.5">
									<BakeStatusIcon bakeStatus={entry.bakeStatus} size="medium" />
								</div>

								<!-- Version -->
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<!-- No `stopPropagation` any more: the tap zone raises this
										     anchor above the expand button's overlay, so a click on
										     it is a click on IT and never on the row. -->
										<a
											href={versionPathForRollout(rollout, name, getDisplayVersion(entry.version))}
											class="font-mono text-sm font-semibold text-gray-900 hover:underline dark:text-white"
										>
											{getDisplayVersion(entry.version)}
										</a>
										{#if isCurrent}
											<Chip role="count" label="current" />
										{/if}
										<!--
											THE `Succeeded` BADGE IS THE NORM AND ONLY THE NORM.
											Five rows, five green ticks, five green `Succeeded` pills:
											the pill repeated what the tick beside it already said and
											spent the row's whole colour budget doing it, which is why
											the one deploy that went BACKWARDS could not get a word in.
											Anything that is not `Succeeded` still gets its badge.
										-->
										{#if entry.bakeStatus !== 'Succeeded'}
											<Badge
												color={getBakeStatusColor(entry.bakeStatus)}
												class="text-xs"
												title={bakeTitle(entry.bakeStatus)}
											>
												{bakeWord(entry.bakeStatus)}
											</Badge>
										{/if}
										{#if act?.kind === 'rollback'}
											<!-- The word, AT REST. Neutral-strong rather than a status
											     hue: going backwards is a FACT about the deploy, not an
											     alarm about its health, and it is the same ink as the
											     header's rollup so the two read as one fact. -->
											<span
												class="inline-flex items-center gap-1 rounded-full bg-gray-900 px-2 py-0.5 text-xs font-semibold text-white dark:bg-gray-100 dark:text-gray-900"
												title={act.sentence}
											>
												<UndoOutline class="h-3 w-3" aria-hidden="true" />
												<!-- ⛔ THE WORD IS `act.word`, NOT A LITERAL. (2026-09-01)
												     `history-marks.ts` publishes it as *"the product's
												     word, for a chip at rest"* and this pill spelled its
												     own copy of it, one identifier away from the sentence
												     that uses the published one. Identical today; that is
												     precisely how the other four splits started. -->
												{act.word}
											</span>
										{/if}
										<!--
											⭐ THE REVISION BADGE PRINTS ONLY WHEN IT DIFFERS FROM THE
											NAME BESIDE IT — `/versions`'s own rule, and the reason the
											seven-character fix above needed it. At twelve characters
											`064b655ab12c` and `064b655` looked like two facts; at
											seven they are visibly ONE, and the row was printing the
											same sha twice, 40px apart. A service that ships under a
											semver (`1.66.0-66`) still gets the badge, because there
											the commit is a second fact the label does not carry.
										-->
										{#if entry.version.revision && formatRevision(entry.version.revision) !== getDisplayVersion(entry.version)}
											<Badge
												color="gray"
												class="font-mono text-xs"
												title="Commit {formatRevision(entry.version.revision)}"
											>
												{formatRevision(entry.version.revision)}
											</Badge>
										{/if}
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

										The two deviations keep the full sentence and the stronger
										ink; the norm gets the quiet meta ink and the short form,
										with the whole sentence on the `title`.
									-->
									{#if act}
										<p
											class="mt-1 text-xs {act.kind === 'forward'
												? 'text-gray-500 dark:text-gray-400'
												: 'text-gray-600 dark:text-gray-300'}"
											title={act.sentence}
										>
											{#if act.kind === 'forward'}
												{act.by} release{act.by === 1 ? '' : 's'} forward
											{:else}
												{act.sentence}
											{/if}
										</p>
									{/if}
									<!--
										THE TIME COLUMN IS `hidden sm:block`, SO AT 390 THIS ROW SAID
										NOTHING ABOUT WHEN. Below `sm` the clock rides the main column.
									-->
									<div
										class="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500 sm:hidden dark:text-gray-400"
									>
										<ClockSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
										<span class="tabular-nums">{clockTime(entry.timestamp)}</span>
										<span aria-hidden="true">·</span>
										<span>{formatTimeAgoCompact(entry.timestamp, $now)} ago</span>
										{#if entry.triggeredBy}
											<span aria-hidden="true">·</span>
											<span class="truncate"
												>{entry.triggeredBy.kind === 'User'
													? entry.triggeredBy.name
													: 'System'}</span
											>
										{/if}
									</div>
								</div>

								<!--
									Time + actor.
									⛔ THREE ROWS SIX MINUTES APART ALL READ `1d`. Relative time is the
									right answer on a LIST OF DIFFERENT THINGS, where "how stale is
									this" is the question. On a list of one thing ORDERED BY TIME, the
									question is "when, and how far apart", and a formatter whose
									coarsest bucket is a day cannot answer it — the resolution was
									lying about itself. The exact clock leads; `formatTimeAgoCompact`
									is unchanged and demoted to the second line, because seventeen
									other callers depend on exactly what it does today.
								-->
								<div class="hidden flex-shrink-0 text-right sm:block">
									<div
										class="text-xs font-medium text-gray-700 tabular-nums dark:text-gray-300"
										title={formatDate(entry.timestamp)}
									>
										{clockTime(entry.timestamp)}
									</div>
									<div
										class="mt-0.5 flex items-center justify-end gap-1 text-xs text-gray-500 dark:text-gray-400"
									>
										<span>{formatTimeAgoCompact(entry.timestamp, $now)} ago</span>
										{#if entry.triggeredBy}
											<span aria-hidden="true">·</span>
											{#if entry.triggeredBy.kind === 'User'}
												<UserSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
												<span class="max-w-40 truncate">{entry.triggeredBy.name}</span>
											{:else}
												<CogSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
												System
											{/if}
										{/if}
									</div>
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
									class="tap-link flex-shrink-0 rounded-lg border border-transparent p-1 text-gray-500 transition-colors group-hover:border-gray-200 group-hover:bg-white dark:text-gray-400 dark:group-hover:border-gray-600 dark:group-hover:bg-gray-700"
								>
									{#if isExpanded}
										<ChevronUpOutline class="h-4 w-4" aria-hidden="true" />
									{:else}
										<ChevronDownOutline class="h-4 w-4" aria-hidden="true" />
									{/if}
									<span class="sr-only">{isExpanded ? 'Hide' : 'Show'} deploy details</span>
								</button>
							</div>

							<!-- Expanded details -->
							{#if isExpanded}
								<div class="border-t border-gray-100 px-4 py-4 dark:border-gray-700">
									<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
										<!-- Left: metadata -->
										<div class="space-y-2.5">
											<div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
												<ClockSolid class="h-3.5 w-3.5 flex-shrink-0" />
												<span>{formatDate(entry.timestamp)}</span>
											</div>
											{#if entry.triggeredBy}
												<div class="flex items-center gap-1.5 text-xs">
													<span class="text-gray-500 dark:text-gray-400">Deployed by</span>
													{#if entry.triggeredBy.kind === 'User'}
														<UserSolid class="h-3 w-3 text-gray-500 dark:text-gray-400" />
														<span class="font-medium text-gray-700 dark:text-gray-300">
															{entry.triggeredBy.name}
														</span>
													{:else}
														<CogSolid class="h-3 w-3 text-gray-500 dark:text-gray-400" />
														<span class="font-medium text-gray-700 dark:text-gray-300">System</span>
													{/if}
												</div>
											{/if}
											{#if rollout?.status?.source && rollout.status.history && i + 1 < rollout.status.history.length}
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
												<div class="flex items-baseline gap-1.5 text-xs">
													<span class="flex-shrink-0 text-gray-500 dark:text-gray-400">Changes</span
													>
													<div class="min-w-0 flex-1">
														<CommitSummary
															{namespace}
															{name}
															{cluster}
															base={rollout.status.history[i + 1]?.version?.revision}
															head={entry.version?.revision}
															showAvatars
															showMessages
														/>
													</div>
												</div>
											{/if}
											{#if entry.message}
												<!--
													`Reason` CLAIMED MORE THAN THE FIELD HOLDS. This string is
													whatever the API recorded, and on the live cluster it says
													`Force deploy` for a deploy no UI ever called forced, and
													`Pinned version` for a rollback — losing the rollback. It is
													an audit RECORD, not the page's account of what happened;
													the account is the act sentence on the row above, which is
													derived from the release ordering and cannot disagree with
													`/` or `/rollouts`. Naming it for what it is stops the two
													from being read as one claim.
												-->
												<div class="flex items-baseline gap-1.5 text-xs">
													<span class="flex-shrink-0 text-gray-500 dark:text-gray-400">
														Recorded note
													</span>
													<span class="text-gray-600 dark:text-gray-400">{entry.message}</span>
												</div>
											{/if}
										</div>

										<!-- Right: bake info -->
										<div class="space-y-2.5">
											{#if entry.bakeStatusMessage}
												<p class="text-xs text-gray-600 dark:text-gray-400">
													{entry.bakeStatusMessage}
												</p>
											{/if}
											{#if entry.bakeStartTime && entry.bakeEndTime}
												<div
													class="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-2.5 py-1.5 dark:bg-gray-800"
												>
													<ClockSolid class="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
													<span class="text-xs font-medium text-gray-700 dark:text-gray-300">
														Checked for {formatDuration(
															entry.bakeStartTime,
															new Date(entry.bakeEndTime)
														)}
													</span>
												</div>
											{/if}
											{#if entry.failedHealthChecks && entry.failedHealthChecks.length > 0}
												<div class="space-y-1">
													{#each entry.failedHealthChecks as check}
														<div
															class="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400"
														>
															<span class="font-medium">{check.name}:</span>
															{check.message}
														</div>
													{/each}
												</div>
											{/if}
										</div>
									</div>

									<!-- Action buttons -->
									<div
										class="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700"
									>
										{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
											<SourceViewer
												namespace={rollout.metadata?.namespace || ''}
												name={rollout.metadata?.name || ''}
												version={entry.version.tag}
												{cluster}
											/>
										{/if}
										{#if i < (rollout?.status?.history?.length ?? 0) - 1 && rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
											<Button
												color="light"
												size="xs"
												href={`/rollouts/${cluster}/${rollout.metadata?.namespace}/${rollout.metadata?.name}/diff/${entry.version.tag}`}
											>
												<CodePullRequestSolid class="mr-1 h-3 w-3" />
												Show diff
											</Button>
										{/if}
										{#if entry.version.tag !== rollout?.status?.history?.[0]?.version?.tag}
											<Button
												color="light"
												size="xs"
												onclick={() => {
													selectedVersionTag = entry.version.tag;
													if (rollout?.status?.history && rollout.status.history.length > 0) {
														const cur = rollout.status.history[0].version;
														deployExplanation = `Rollback from ${getDisplayVersion(cur)} to ${getDisplayVersion(entry.version)} due to issues with the current deployment.`;
													}
													showChangeVersionModal = true;
												}}
											>
												<UndoOutline class="mr-1 h-3 w-3" />
												Rollback
											</Button>
										{/if}
										{#if datadogTestInfo}
											<Button
												color="light"
												size="xs"
												href={buildDatadogLogsUrl(datadogTestInfo.service, datadogTestInfo.env)}
												target="_blank"
											>
												<DatadogLogo class="mr-1 h-3 w-3" />
												Logs
											</Button>
											<Button
												color="light"
												size="xs"
												href={buildDatadogTestRunsUrl(
													datadogTestInfo.service,
													isCurrent && datadogTestInfo.version
														? datadogTestInfo.version
														: '*' + entry.version.tag + '*'
												)}
												target="_blank"
											>
												<DatadogLogo class="mr-1 h-3 w-3" />
												CI
											</Button>
										{/if}
										{#if rollout?.status?.source}
											<GitHubViewButton
												sourceUrl={rollout.status.source}
												version={getDisplayVersion(entry.version)}
												size="xs"
												color="light"
											/>
										{/if}
										<CopyButton
											value={entry.version.tag}
											label={`version ${getDisplayVersion(entry.version)}`}
											text="Copy Tag"
										/>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<ChangeVersionModal
			bind:open={showChangeVersionModal}
			{rollout}
			isPinVersionMode={true}
			initialSelectedVersion={selectedVersionTag}
			initialExplanation={deployExplanation}
			{cluster}
		/>
	{/if}
</div>
