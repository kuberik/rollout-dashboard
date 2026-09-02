<svelte:options runes={true} />

<script module lang="ts">
	import type { PodInfo } from '$lib/api/logs';

	/**
	 * ⛔ THE POD PAYLOAD CAN BE `null`, AND THAT IS NOT A BACKEND BUG. Go's
	 * `json.Marshal` on a nil slice (`var pods []PodInfo`, never appended to)
	 * writes the JSON literal `null`, not `[]` — the wire form of "zero pods
	 * matched this filter". `broadcastPodsLoop` (pkg/logs/streamer.go) sends
	 * that snapshot every 2s for as long as it stays true, which is exactly
	 * why `filterType="test"` on a rollout with no test pods crashed on a
	 * ~2s cadence: `null.forEach` is not a contract violation to survive,
	 * it is an honest empty set to render as one. Exported so the null case
	 * is a unit test against this pure function, not a live-cluster fishing
	 * trip against the component.
	 */
	export function normalizePodsPayload(pods: PodInfo[] | null | undefined): PodInfo[] {
		return pods ?? [];
	}
</script>

<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import {
		Button,
		Spinner,
		Badge,
		Toggle,
		Dropdown,
		DropdownItem,
		Checkbox
	} from 'flowbite-svelte';
	import { CloseOutline, ChevronDownOutline, TerminalOutline, FlaskOutline } from 'flowbite-svelte-icons';
	import { createVirtualizer, notUndefined } from '@tanstack/svelte-virtual';
	import iwanthue from 'iwanthue';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	// `PodInfo` comes from the module script above — shared module context,
	// re-importing it here collides as a duplicate identifier under svelte-check.
	import type { LogLine } from '$lib/api/logs';
	import { logsStreamQueryOptions } from '$lib/api/logs';
	import { rolloutTestsQueryOptions } from '$lib/api/rollouts';
	import { formatTimeAgo } from '$lib/utils';
	import Card from '$lib/components/Card.svelte';

	/**
	 * The rollup sentence ("2,031 lines · 2 pods · Streaming") SPLIT AT ITS
	 * OWN JOINT — `count` is the leading figure, `rest` is everything after
	 * it. Bound out so the page head can print `count` at `t-display` and
	 * `rest` at `t-dense` on its baseline, the same shape `/activity` and
	 * `/history` use for their own rollups. A single joined string forced
	 * the whole sentence into one type role (`t-headline`, 17/600), which is
	 * the wrong role for either half of it — see `COMPOSITION-GRAMMAR.md`
	 * §6 and the `/activity` head comment for the pattern this mirrors.
	 */
	interface LogsSummary {
		count: number;
		rest: string;
	}

	interface Props {
		namespace: string;
		name: string;
		filterType?: 'pod' | 'test' | '';
		cluster?: string;
		summary?: LogsSummary;
	}

	let {
		namespace,
		name,
		filterType = '',
		cluster,
		summary = $bindable({ count: 0, rest: '' })
	}: Props = $props();

	let selectedPod = $state<string | null>(null);
	let searchQuery = $state('');

	// Auto-scroll state
	let autoScroll = $state(true);
	let wrapLines = $state(false);
	let virtualListEl = $state<HTMLElement | null>(null);
	let isUserScrolling = $state(false);
	let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
	let isAutoScrolling = $state(false);

	// Filter state - using Sets for multi-select
	let selectedPods = $state<Set<string>>(new Set());
	let selectedContainers = $state<Set<string>>(new Set());
	let selectedLogLevels = $state<Set<'error' | 'warn' | 'info' | 'debug'>>(new Set());

	// Column visibility state
	type LogColumn = 'timestamp' | 'pod' | 'container' | 'message';
	let visibleColumns = $state<Set<LogColumn>>(
		new Set(['timestamp', 'pod', 'container', 'message'])
	);
	const allColumns: { value: LogColumn; label: string }[] = [
		{ value: 'timestamp', label: 'Timestamp' },
		{ value: 'pod', label: 'Pod' },
		{ value: 'container', label: 'Container' },
		{ value: 'message', label: 'Message' }
	];
	const hiddenColumnCount = $derived(allColumns.length - visibleColumns.size);

	// Dropdown trigger IDs
	const podsDropdownId = 'pods-filter-dropdown';
	const containersDropdownId = 'containers-filter-dropdown';
	const logLevelsDropdownId = 'log-levels-filter-dropdown';
	const columnsDropdownId = 'columns-dropdown';

	let discoveredPods = $state<PodInfo[]>([]);
	const discoveredPodNames = new Set<string>();

	function addDiscoveredPod(pod: PodInfo) {
		if (!discoveredPodNames.has(pod.name)) {
			discoveredPodNames.add(pod.name);
			discoveredPods.push(pod);
		}
	}

	/**
	 * WHETHER THE DISCOVERY MECHANISM HAS EVER REPORTED IN. A `pods` event
	 * carrying zero pods is still a report — it is what tells `connectionState`
	 * below that the stream is open and listening rather than still connecting,
	 * for a filter (e.g. `test`) that may never see a `log` event at all.
	 */
	let podsEventReceived = $state(false);

	// Handle pods updates from the stream. The payload is `PodInfo[] | null` on
	// the wire — see `normalizePodsPayload` above for why `null` is honest.
	function handlePodsUpdate(newPods: PodInfo[] | null | undefined) {
		podsEventReceived = true;
		normalizePodsPayload(newPods).forEach(addDiscoveredPod);
	}

	// Dynamic discovery from logs
	$effect(() => {
		logs.forEach((log) => {
			if (!discoveredPodNames.has(log.pod)) {
				addDiscoveredPod({
					name: log.pod,
					namespace,
					type: log.type || (log.pod.includes('test') ? 'test' : 'pod')
				});
			}
		});
	});

	// Get query client for resetting query state
	const queryClient = useQueryClient();

	// Create streaming query
	const logsQueryOptions = $derived(
		logsStreamQueryOptions({
			namespace,
			name,
			filterType,
			onPodsUpdate: handlePodsUpdate,
			cluster
		})
	);
	const logsQuery = createQuery(() => logsQueryOptions);

	// Reset logs state when component mounts (navigating to logs page)
	onMount(() => {
		// Simply reset the query data to empty array for a clean slate
		queryClient.setQueryData(logsQueryOptions.queryKey, []);
	});

	/**
	 * ⛔ THE TESTS VIEW WAS THE PODS VIEW WITH A DIFFERENT DATA SOURCE. Its
	 * empty state said *"the pods have written nothing since this view
	 * opened"* on a rollout whose last test run (`hello-python-test`)
	 * finished minutes earlier — a true fact the pane had no way to know,
	 * because nothing here ever asked for it. `RolloutTest` is the CRD a
	 * test run is; `rolloutTestsQueryOptions` already existed (used
	 * nowhere) and gives us `status.phase` + `status.conditions[]`, whose
	 * `lastTransitionTime` is the closest thing to "when this run finished"
	 * on the wire. `enabled` is gated on `filterType === 'test'` so the
	 * Pods view never fires this request.
	 */
	const rolloutTestsQuery = createQuery(() => ({
		...rolloutTestsQueryOptions({ namespace, name }),
		enabled: filterType === 'test'
	}));

	const lastTestRun = $derived.by((): { name: string; finishedAt: string } | null => {
		const items = rolloutTestsQuery.data?.rolloutTests?.items ?? [];
		let best: { name: string; finishedAt: string } | null = null;
		for (const item of items) {
			const phase = item.status?.phase;
			// Only a TERMINAL phase has a "finished" moment to report.
			if (phase !== 'Succeeded' && phase !== 'Failed' && phase !== 'Cancelled') continue;
			const conditions = item.status?.conditions ?? [];
			let finishedAt: string | null = null;
			for (const c of conditions) {
				if (!finishedAt || c.lastTransitionTime > finishedAt) finishedAt = c.lastTransitionTime;
			}
			if (!finishedAt) continue;
			if (!best || finishedAt > best.finishedAt) {
				best = { name: item.status?.jobName || item.metadata?.name || 'test', finishedAt };
			}
		}
		return best;
	});

	// Derived state from query
	const logs = $derived(logsQuery.data || []);
	/**
	 * ⛔ `Loading...` STAYED UP WHILE THE LOGS WERE ALREADY SCROLLING PAST.
	 *
	 * This is a STREAM, not a request. TanStack holds `isFetching` true for the
	 * whole life of the stream — that is what "fetching" means for a query that
	 * never resolves — so `isPending || isFetching` was true forever, and the
	 * header sat there with a spinner and the word `Loading...` above hundreds
	 * of delivered lines. A person reading that has to decide whether the log
	 * they are looking at is complete, and the label tells them it is not.
	 *
	 * The two states are genuinely different and now say different things:
	 *
	 *   connecting  nothing has arrived yet — a spinner is honest
	 *   streaming   the pipe is open and lines are landing — say THAT
	 *
	 * `isLoading` is kept, spelled correctly, because the full-panel skeleton
	 * below is the one place where "we are waiting and have nothing" is exactly
	 * the question being asked.
	 */
	const isLoading = $derived(logsQuery.isPending || logsQuery.isFetching);
	const error = $derived(
		logsQuery.isError ? (logsQuery.error as Error)?.message || 'Unknown error' : null
	);

	/**
	 * ⛔ "0 lines · Stream closed", "Connecting to pods…" AND A SPINNER, ALL AT
	 * ONCE. The header's `isConnecting`, the summary line's `isStreaming` check,
	 * and the footer's `!error` fallback were three SEPARATE derivations of
	 * "what is the connection doing right now" — agreeing in the common case,
	 * but not a real partition. The summary line never had a "connecting"
	 * branch at all: anything that wasn't `isStreaming` and wasn't `error` fell
	 * straight through to "Stream closed", including the moment the pane was
	 * still genuinely connecting. Switching to `filterType="test"` on a rollout
	 * with no test pods made the gap permanent — no `log` event ever arrives,
	 * so `logs.length` stays 0 forever and the header's spinner+"Connecting…"
	 * never resolved, while the summary line sat on "Stream closed" the entire
	 * time. Two contradictory captions for one connection, both true forever.
	 *
	 * `connectionState` is the ONE fact now. Every render — header, main panel,
	 * summary line, footer — reads this and nothing else, so they cannot
	 * disagree with each other again.
	 *
	 * `podsEventReceived` is what keeps "connecting" from being permanent for a
	 * filter with zero matching pods: a `pods` snapshot, even an honestly empty
	 * one (see `normalizePodsPayload`), is proof the stream is open and
	 * reporting — that reclassifies as "streaming, quietly" rather than
	 * "still connecting", which is what lets the empty-state copy below
	 * ("No log lines yet…") actually get a turn instead of spinning forever.
	 */
	type ConnectionState = 'connecting' | 'streaming' | 'closed' | 'error';
	const connectionState = $derived.by((): ConnectionState => {
		if (error) return 'error';
		if (isLoading) {
			return logs.length > 0 || podsEventReceived ? 'streaming' : 'connecting';
		}
		return 'closed';
	});
	const isConnecting = $derived(connectionState === 'connecting');
	const isStreaming = $derived(connectionState === 'streaming');

	// Detect log level from log line
	function getLogLevel(line: string): 'error' | 'warn' | 'info' | 'debug' | null {
		const upperLine = line.toUpperCase();
		if (
			upperLine.includes('ERROR') ||
			upperLine.includes('FATAL') ||
			upperLine.includes('CRITICAL')
		) {
			return 'error';
		}
		if (upperLine.includes('WARN') || upperLine.includes('WARNING')) {
			return 'warn';
		}
		if (upperLine.includes('DEBUG') || upperLine.includes('TRACE')) {
			return 'debug';
		}
		if (upperLine.includes('INFO')) {
			return 'info';
		}
		return null;
	}

	function getLogLevelColor(level: 'error' | 'warn' | 'info' | 'debug' | null): string {
		switch (level) {
			case 'error':
				return 'text-red-400';
			case 'warn':
				return 'text-yellow-400';
			case 'info':
				return 'text-blue-400';
			case 'debug':
				return 'text-gray-400';
			default:
				return 'text-gray-300';
		}
	}

	// Track podcast and their assigned colors
	const podColors = new Map<string, string>();

	// Generate a large stable palette once
	const palette = iwanthue(50, {
		seed: 'kuberik-rollout-dashboard-v1',
		colorSpace: 'sensible'
	});

	function getPodColor(podName: string): string {
		if (!podColors.has(podName)) {
			// Use the index in discoveredPods to assign a color
			const index = discoveredPods.findIndex((p) => p.name === podName);
			if (index !== -1) {
				podColors.set(podName, palette[index % palette.length]);
			} else {
				// Fallback if not yet discovered (rare)
				return 'var(--gray-500)';
			}
		}
		return podColors.get(podName)!;
	}

	// Get unique containers for filtering
	const uniqueContainers = $derived.by(() => {
		const containerSet = new Set<string>();
		logs.forEach((log) => {
			containerSet.add(log.container);
		});
		return Array.from(containerSet).sort();
	});

	/**
	 * WHETHER THE READER IS LOOKING THROUGH A FILTER. The empty state used to
	 * print `No logs available (Total: 0, Filtered: 0)` — two internal counters
	 * and no answer — which is the same string whether the pods are silent or
	 * a filter three controls away is hiding everything. The two are different
	 * problems and only one of them has an action.
	 */
	const hasFilters = $derived(
		selectedPods.size > 0 ||
			selectedContainers.size > 0 ||
			selectedLogLevels.size > 0 ||
			searchQuery.trim().length > 0
	);

	function clearFilters() {
		selectedPods = new Set();
		selectedContainers = new Set();
		selectedLogLevels = new Set();
		searchQuery = '';
	}

	// Filter logs by selected pods, containers, log levels, and search query
	const filteredLogs = $derived.by(() => {
		let result = logs;

		// Filter by pods (multi-select)
		if (selectedPods.size > 0) {
			result = result.filter((log) => selectedPods.has(log.pod));
		}

		// Filter by containers (multi-select)
		if (selectedContainers.size > 0) {
			result = result.filter((log) => selectedContainers.has(log.container));
		}

		// Filter by log levels (multi-select)
		if (selectedLogLevels.size > 0) {
			result = result.filter((log) => {
				const level = getLogLevel(log.line);
				return level !== null && selectedLogLevels.has(level);
			});
		}

		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(log) =>
					log.line.toLowerCase().includes(query) ||
					log.pod.toLowerCase().includes(query) ||
					log.container.toLowerCase().includes(query)
			);
		}

		return result;
	});

	// Group pods by name for filtering
	const uniquePods = $derived.by(() => {
		let result = discoveredPods;

		// Filter based on the requested tab type
		if (filterType) {
			result = result.filter((p) => {
				if (p.type === filterType) return true;
				// Fallback heuristics
				if (filterType === 'pod' && !p.type) return true;
				if (filterType === 'test' && (p.name.includes('test') || p.type === 'test')) return true;
				return false;
			});
		}

		return [...result].sort((a, b) => a.name.localeCompare(b.name));
	});

	/**
	 * THE PAGE'S OWN `h1` SAID "Logs" DIRECTLY UNDER A TAB STRIP WHOSE ACTIVE
	 * TAB ALREADY SAYS "Logs" — the duplicate-heading rule in the components
	 * CLAUDE.md. The heading goes `sr-only`; this is what fills the slot,
	 * the same shape the footer already prints, minus the `/` breakdown a
	 * head-row sentence doesn't need. Bound out via `summary` because the
	 * counts live here and the head row lives one level up in `+page.svelte`.
	 *
	 * SPLIT AT ITS OWN JOINT (see `LogsSummary` above): `count` is the bare
	 * figure, `rest` is the sentence that follows it, so the page head can
	 * print them at two different type roles instead of one `t-headline`
	 * line — the defect measured against `/activity`'s head, which does the
	 * same split for the same reason.
	 */
	const summaryParts = $derived.by((): LogsSummary => {
		const lineCount = filteredLogs.length;
		const podCount = selectedPods.size > 0 ? selectedPods.size : uniquePods.length;
		const podsLabel = podCount > 0 ? `${podCount} pod${podCount === 1 ? '' : 's'}` : null;
		// Reads `connectionState` exclusively — see its definition for why this
		// used to fall through to "Stream closed" while still connecting.
		const streamLabel =
			connectionState === 'streaming'
				? 'Streaming'
				: connectionState === 'connecting'
					? 'Connecting…'
					: connectionState === 'error'
						? null
						: 'Stream closed';
		const rest = [`line${lineCount === 1 ? '' : 's'}`, podsLabel, streamLabel]
			.filter(Boolean)
			.join(' · ');
		return { count: lineCount, rest };
	});

	$effect(() => {
		summary = summaryParts;
	});

	/**
	 * THE CARD HEADER'S RIGHT-ALIGNED ROLLUP — `4 pods · streaming` /
	 * `connection lost`, `COMPOSITION-GRAMMAR.md` §1's "single most
	 * transferable thing", now spent on the log pane instead of a card with
	 * a header and no answer. Lowercase throughout: it sits beside a 14/600
	 * title, not as a second headline. `filterType`-aware so the Tests view
	 * says "runs", not "pods" — the same defect as the empty-state copy
	 * below, one level up.
	 */
	const paneRollup = $derived.by((): string => {
		if (connectionState === 'error') return 'connection lost';
		if (connectionState === 'connecting') {
			return filterType === 'test' ? 'connecting to test runs…' : 'connecting to pods…';
		}
		const podCount = selectedPods.size > 0 ? selectedPods.size : uniquePods.length;
		const noun = filterType === 'test' ? (podCount === 1 ? 'run' : 'runs') : podCount === 1 ? 'pod' : 'pods';
		const stateLabel = connectionState === 'streaming' ? 'streaming' : 'stream closed';
		return podCount > 0 ? `${podCount} ${noun} · ${stateLabel}` : stateLabel;
	});

	// The empty state's icon, keyed off the same view split as the copy
	// beside it and the Card's own header icon. Capitalised: a lowercase
	// identifier in a component tag position renders as a literal `<x>`
	// element, not this reference.
	const EmptyIcon = $derived(filterType === 'test' ? FlaskOutline : TerminalOutline);

	// Highlight search matches in log lines
	function highlightSearch(text: string, query: string): string {
		if (!query.trim()) return text;
		const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		return text.replace(regex, '<mark class="bg-yellow-300 dark:bg-yellow-600">$1</mark>');
	}

	// Flatten for virtual list - formatted timestamp comes from web worker
	const allLogLines = $derived.by(() => {
		// Optimization: Avoid re-mapping if unnecessary, but standard map is usually fast enough for 2k-10k items
		return filteredLogs.map((log, index) => ({
			line: log.line,
			pod: log.pod,
			container: log.container,
			type: log.type,
			timestamp: log.timestamp || Date.now(),
			formattedTimestamp: log.formattedTimestamp || '', // Always provided by worker
			index
		}));
	});

	// Fixed row height: with no text wrapping, every row is the same height
	// py-1 (8px) + line-height ~20px + border 1px = ~29px. Use 30 as a safe constant.
	const ROW_HEIGHT = 30;

	// Track scroll position for restoration
	let savedScrollTop = $state(0);

	// Setup Virtualizer - only recreates when scroll element changes
	// NOT when count changes - this preserves cache and scroll position
	let virtualizer = $derived(
		createVirtualizer<HTMLElement, HTMLDivElement>({
			count: 0, // Initial count, updated via effect
			getScrollElement: virtualListEl ? () => virtualListEl : () => null,
			estimateSize: () => ROW_HEIGHT,
			overscan: 40
		})
	);

	// Update count separately to avoid recreating virtualizer
	$effect(() => {
		const count = allLogLines.length;
		const currentScrollTop = virtualListEl?.scrollTop ?? 0;

		// Save scroll position before update
		if (!autoScroll && currentScrollTop > 0) {
			savedScrollTop = currentScrollTop;
		}

		// Update virtualizer count
		$virtualizer.setOptions({ count });

		// Restore scroll position after update (only when not auto-scrolling)
		if (!autoScroll && savedScrollTop > 0 && virtualListEl) {
			tick().then(() => {
				if (virtualListEl && !autoScroll) {
					virtualListEl.scrollTop = savedScrollTop;
				}
			});
		}
	});

	// Use $state + $effect for virtualItems to properly track store value changes
	import type { VirtualItem } from '@tanstack/svelte-virtual';
	let virtualItems = $state<VirtualItem[]>([]);

	$effect(() => {
		// 1. Sync Data: Track count explicitly
		const count = allLogLines.length;
		const _ = virtualListEl; // Track element

		// Guarded update to options to prevent loops, but ensure sync
		if (
			untrack(() => $virtualizer.options.count) !== count ||
			untrack(() => $virtualizer.options.getScrollElement)() !== virtualListEl
		) {
			untrack(() => $virtualizer).setOptions({
				count,
				getScrollElement: () => virtualListEl
			});
		}

		// 2. Sync View: Subscribe to virtualizer updates (scroll/resize)
		// This runs when $virtualizer emits OR when above dependencies change
		virtualItems = $virtualizer.getVirtualItems();
	});

	// Calculate before/after padding for natural document flow scrolling
	let virtualListBefore = $derived(
		virtualItems.length > 0
			? notUndefined(virtualItems[0]).start - ($virtualizer.options.scrollMargin ?? 0)
			: 0
	);
	let virtualListAfter = $derived(
		virtualItems.length > 0
			? $virtualizer.getTotalSize() - notUndefined(virtualItems[virtualItems.length - 1]).end
			: 0
	);

	// Scroll to bottom
	function scrollToBottom() {
		if (!virtualListEl || allLogLines.length === 0) return;

		isAutoScrolling = true;
		// Use virtualizer's scroll method
		$virtualizer.scrollToIndex(allLogLines.length - 1, { align: 'end' });

		setTimeout(() => {
			isAutoScrolling = false;
		}, 100);
	}

	// Auto-scroll when new logs arrive (if enabled)
	let previousLogCount = $state(0);
	let previousLastTimestamp = $state<number | null>(null);

	// Handle auto-scroll
	$effect(() => {
		const currentCount = allLogLines.length;
		const lastLog = allLogLines[currentCount - 1];
		const lastTimestamp = lastLog?.timestamp || null;

		const logsChanged = currentCount > previousLogCount || lastTimestamp !== previousLastTimestamp;

		if (autoScroll && logsChanged && !isUserScrolling && !isAutoScrolling) {
			// Use tick to ensure DOM updates first
			tick().then(() => {
				scrollToBottom();
			});
		}

		previousLogCount = currentCount;
		previousLastTimestamp = lastTimestamp;
	});

	/**
	 * A STREAM WITH FOLLOW ON CAN TURN ITSELF OFF WITH NOBODY TOUCHING
	 * ANYTHING. Growing the log list moves `scrollHeight` before the
	 * effect-scheduled `scrollToBottom()` catches up to it — there is a
	 * real gap between "content got taller" and "we corrected scrollTop"
	 * — and a `scroll` event landing in that gap (a `pointerdown` inside
	 * the pane before the browser's own scroll anchoring kicks in, a
	 * layout-driven nudge, anything that is not a deliberate drag) reads
	 * as "the reader scrolled away" and silently drops `Follow`. Measured:
	 * 1 in 5 fresh loads on a narrow viewport with a live stream. `Follow`
	 * is now only ALLOWED to turn itself off within a short window after a
	 * real wheel/touch/drag gesture on this pane — re-enabling (scrolling
	 * back to the bottom) stays ungated, because arriving at the bottom is
	 * always the safe direction.
	 */
	let lastUserGestureAt = 0;
	function markUserGesture() {
		lastUserGestureAt = Date.now();
	}

	// Handle Scroll Events for Auto-scroll toggle
	function handleScroll(e: Event) {
		const target = e.target as HTMLElement;
		if (!target || isAutoScrolling) return;

		const { scrollTop, scrollHeight, clientHeight } = target;
		const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
		const recentUserGesture = Date.now() - lastUserGestureAt < 1000;

		// If user scrolled away from bottom, disable auto-scroll — but only
		// off the back of a real gesture, not a phantom scroll event.
		if (!isNearBottom && autoScroll && recentUserGesture) {
			autoScroll = false;
		}

		// If user scrolls back to bottom, re-enable auto-scroll
		if (isNearBottom && !autoScroll) {
			autoScroll = true;
		}

		// Mark that user is scrolling
		isUserScrolling = true;
		if (scrollTimeout) {
			clearTimeout(scrollTimeout);
		}
		scrollTimeout = setTimeout(() => {
			isUserScrolling = false;
		}, 150);
	}

	// Cleanup on destroy
	onDestroy(() => {
		if (scrollTimeout) {
			clearTimeout(scrollTimeout);
		}
	});
</script>

<!-- `min-h-0 flex-1`, NOT `h-full`. The Logs tab hands this component a flex
     column whose height comes from `flex-1`, and a percentage height inside
     that resolved to the header's own 150px — the virtual list beneath it
     measured 0px tall and the tab printed "378 lines" over an empty pane. -->
<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<!-- Header with controls -->
	<div class="mb-3 flex flex-shrink-0 flex-col gap-2 border-b border-gray-200 pb-3 dark:border-gray-700 sm:mb-4 sm:gap-3">
		<!-- Status indicators -->
		<div class="flex items-center gap-2">
			<!-- ONE PLACE SAYS THE STREAM IS LIVE, AND IT IS THE FOOTER. This row
			     now draws only while there is genuinely nothing yet, so the header
			     no longer contradicts the lines below it, and it does not repeat the
			     `Streaming ●` mark the footer has always carried. -->
			{#if isConnecting}
				<Spinner size="4" color="gray" />
				<span class="text-xs text-gray-500 dark:text-gray-400"
					>{filterType === 'test' ? 'Connecting to test runs…' : 'Connecting to pods…'}</span
				>
			{/if}
			{#if error}
				<Badge color="red" class="text-xs">Error loading logs</Badge>
			{/if}
		</div>
		<!-- Controls row -->
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<!-- Auto-scroll and wrap toggles -->
			<div class="flex items-center gap-3 sm:gap-4">
				<!-- The two `Toggle`s render an `sr-only` checkbox whose label sat
				     BESIDE them as a plain `span`, so both announced as an unnamed
				     checkbox. Two of the twenty-seven tab stops on the Logs tab. -->
				<div class="flex items-center gap-2">
					<!--
						⛔ THE MOST SATURATED OBJECT IN THE PRODUCT WAS A CHECKBOX THAT
						TOGGLES AUTO-SCROLL. (2026-09-02) `color="blue"` here was a
						720px² `blue-600` fill, chroma 1.30× the alarm — on a control
						that does not deploy anything. Blue is `Deploying`'s ink; a
						toggle that follows the tail of a log is not an action, it is a
						view preference. `a27d7f0` moved the History tab's own toggles
						(the identical selected-state idiom, `Compare`/`Show
						environments`) to gray-900/gray-100 that same day — "like every
						other toggle" — and these two are the only ones that had not
						followed. `color="gray"` only gets the focus ring to neutral
						(flowbite's `gray` variant is `peer-checked:bg-gray-500`, not
						`gray-900`); the checked fill is overridden to match the History
						toggles exactly, `!` because it has to win over the color
						variant's own `peer-checked:bg-gray-500` in the same slot.
					-->
					<Toggle
						bind:checked={autoScroll}
						size="small"
						color="gray"
						classes={{ span: 'peer-checked:!bg-gray-900 dark:peer-checked:!bg-gray-100' }}
						aria-labelledby="logs-follow-label"
					/>
					<span id="logs-follow-label" class="text-xs text-gray-700 dark:text-gray-300 sm:text-sm"
						>Follow</span
					>
				</div>
				<div class="flex items-center gap-2">
					<Toggle
						bind:checked={wrapLines}
						size="small"
						color="gray"
						classes={{ span: 'peer-checked:!bg-gray-900 dark:peer-checked:!bg-gray-100' }}
						aria-labelledby="logs-wrap-label"
					/>
					<span id="logs-wrap-label" class="text-xs text-gray-700 dark:text-gray-300 sm:text-sm"
						>Wrap</span
					>
				</div>
			</div>
			<!-- Filter dropdowns -->
			<div class="flex flex-wrap items-center gap-2">
				<!-- Pod/source filter dropdown. ⛔ THIS SAID "Pods" 60px UNDER A
				     "Pods | Tests" SEGMENTED CONTROL THAT ALSO SAYS "Pods" — one word
				     naming two different things on screen at once: which STREAM you
				     are on, and which SOURCE within it you are filtering to. It filters
				     the log's origin (a pod name on the Pods view, a test run's pod on
				     the Tests view), so it is named for what it filters, not for the
				     view it happens to be inside. -->
				<div class="relative">
					<Button size="xs" color="light" id={podsDropdownId} class="text-xs">
						Source
						{#if selectedPods.size > 0}
							<Badge color="blue" class="ml-1 text-xs">{selectedPods.size}</Badge>
						{/if}
						<ChevronDownOutline class="ml-1 h-3 w-3" />
					</Button>
					<Dropdown
						simple
						placement="bottom-start"
						triggeredBy={`#${podsDropdownId}`}
						class="max-h-96 w-64 overflow-y-auto"
					>
						<DropdownItem
							onclick={(e) => {
								e.preventDefault();
								if (selectedPods.size === uniquePods.length) {
									selectedPods.clear();
								} else {
									uniquePods.forEach((pod) => selectedPods.add(pod.name));
								}
								selectedPods = new Set(selectedPods);
							}}
						>
							<label class="flex cursor-pointer items-center gap-2">
								<Checkbox
									checked={selectedPods.size === uniquePods.length && uniquePods.length > 0}
								/>
								<span>Select All</span>
							</label>
						</DropdownItem>
						{#each uniquePods as pod}
							<DropdownItem
								onclick={(e) => {
									e.preventDefault();
									if (selectedPods.has(pod.name)) {
										selectedPods.delete(pod.name);
									} else {
										selectedPods.add(pod.name);
									}
									selectedPods = new Set(selectedPods);
								}}
							>
								<label class="flex cursor-pointer items-center gap-2">
									<Checkbox checked={selectedPods.has(pod.name)} />
									<span>{pod.name}</span>
								</label>
							</DropdownItem>
						{/each}
					</Dropdown>
				</div>
				<!-- Container filter dropdown -->
				{#if uniqueContainers.length > 0}
					<div class="relative">
						<Button size="xs" color="light" id={containersDropdownId} class="text-xs">
							<span class="hidden sm:inline">Containers</span>
							<span class="sm:hidden">Cont.</span>
							{#if selectedContainers.size > 0}
								<Badge color="blue" class="ml-1 text-xs">{selectedContainers.size}</Badge>
							{/if}
							<ChevronDownOutline class="ml-1 h-3 w-3" />
						</Button>
						<Dropdown
							simple
							placement="bottom-start"
							triggeredBy={`#${containersDropdownId}`}
							class="max-h-96 w-48 overflow-y-auto"
						>
							<DropdownItem
								onclick={(e) => {
									e.preventDefault();
									if (selectedContainers.size === uniqueContainers.length) {
										selectedContainers.clear();
									} else {
										uniqueContainers.forEach((container) => selectedContainers.add(container));
									}
									selectedContainers = new Set(selectedContainers);
								}}
							>
								<label class="flex cursor-pointer items-center gap-2">
									<Checkbox
										checked={selectedContainers.size === uniqueContainers.length &&
											uniqueContainers.length > 0}
									/>
									<span>Select All</span>
								</label>
							</DropdownItem>
							{#each uniqueContainers as container}
								<DropdownItem
									onclick={(e) => {
										e.preventDefault();
										if (selectedContainers.has(container)) {
											selectedContainers.delete(container);
										} else {
											selectedContainers.add(container);
										}
										selectedContainers = new Set(selectedContainers);
									}}
								>
									<label class="flex cursor-pointer items-center gap-2">
										<Checkbox checked={selectedContainers.has(container)} />
										<span>{container}</span>
									</label>
								</DropdownItem>
							{/each}
						</Dropdown>
					</div>
				{/if}
				<!-- Log level filter dropdown -->
				<div class="relative">
					<Button size="xs" color="light" id={logLevelsDropdownId} class="text-xs">
						<span class="hidden sm:inline">Log Levels</span>
						<span class="sm:hidden">Level</span>
						{#if selectedLogLevels.size > 0}
							<Badge color="blue" class="ml-1 text-xs">{selectedLogLevels.size}</Badge>
						{/if}
						<ChevronDownOutline class="ml-1 h-3 w-3" />
					</Button>
					<Dropdown
						simple
						placement="bottom-start"
						triggeredBy={`#${logLevelsDropdownId}`}
						class="w-48"
					>
						{@const logLevels: Array<{ value: 'error' | 'warn' | 'info' | 'debug'; label: string }> = [
							{ value: 'error', label: 'Error' },
							{ value: 'warn', label: 'Warning' },
							{ value: 'info', label: 'Info' },
							{ value: 'debug', label: 'Debug' }
						]}
						<DropdownItem
							onclick={(e) => {
								e.preventDefault();
								if (selectedLogLevels.size === logLevels.length) {
									selectedLogLevels.clear();
								} else {
									logLevels.forEach((level) => selectedLogLevels.add(level.value));
								}
								selectedLogLevels = new Set(selectedLogLevels);
							}}
						>
							<label class="flex cursor-pointer items-center gap-2">
								<Checkbox
									checked={selectedLogLevels.size === logLevels.length && logLevels.length > 0}
								/>
								<span>Select All</span>
							</label>
						</DropdownItem>
						{#each logLevels as level}
							<DropdownItem
								onclick={(e) => {
									e.preventDefault();
									if (selectedLogLevels.has(level.value)) {
										selectedLogLevels.delete(level.value);
									} else {
										selectedLogLevels.add(level.value);
									}
									selectedLogLevels = new Set(selectedLogLevels);
								}}
							>
								<label class="flex cursor-pointer items-center gap-2">
									<Checkbox checked={selectedLogLevels.has(level.value)} />
									<span>{level.label}</span>
								</label>
							</DropdownItem>
						{/each}
					</Dropdown>
				</div>
				<!-- Columns visibility dropdown. ⛔ "Cols" ABBREVIATED A WORD THAT
				     FIT. Measured on the running row: 132px free next to the other
				     three filter buttons at the width the abbreviation existed for —
				     there was nothing to save. Spelled out at every width now; it
				     wraps onto its own line at 390 like every other filter button
				     already does, rather than clip a word that had room. -->
				<div class="relative">
					<Button size="xs" color="light" id={columnsDropdownId} class="text-xs">
						Columns
						{#if hiddenColumnCount > 0}
							<Badge color="blue" class="ml-1 text-xs">{hiddenColumnCount}</Badge>
						{/if}
						<ChevronDownOutline class="ml-1 h-3 w-3" />
					</Button>
					<Dropdown
						simple
						placement="bottom-start"
						triggeredBy={`#${columnsDropdownId}`}
						class="w-48"
					>
						<DropdownItem
							onclick={(e) => {
								e.preventDefault();
								if (visibleColumns.size === allColumns.length) {
									// Keep at least message visible
									visibleColumns = new Set(['message']);
								} else {
									visibleColumns = new Set(allColumns.map((c) => c.value));
								}
							}}
						>
							<label class="flex cursor-pointer items-center gap-2">
								<Checkbox
									checked={visibleColumns.size === allColumns.length}
								/>
								<span>Show All</span>
							</label>
						</DropdownItem>
						{#each allColumns as col}
							<DropdownItem
								onclick={(e) => {
									e.preventDefault();
									if (visibleColumns.has(col.value)) {
										// Don't allow hiding all columns
										if (visibleColumns.size > 1) {
											visibleColumns.delete(col.value);
										}
									} else {
										visibleColumns.add(col.value);
									}
									visibleColumns = new Set(visibleColumns);
								}}
							>
								<label class="flex cursor-pointer items-center gap-2">
									<Checkbox checked={visibleColumns.has(col.value)} />
									<span>{col.label}</span>
								</label>
							</DropdownItem>
						{/each}
					</Dropdown>
				</div>
			</div>
		</div>
		<!-- Search bar -->
		<div class="flex items-center gap-2">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search logs..."
				class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
			/>
			{#if searchQuery}
				<Button size="xs" color="light" onclick={() => (searchQuery = '')}>
					<CloseOutline class="h-3 w-3" />
				</Button>
			{/if}
		</div>
	</div>

	<!--
		⛔ THE PANE WAS A BORDERED BOX WITH NO HEADER AND AN EMPTY STATE
		FLOATING IN A 620px VOID. (defect #3, `COMPOSITION-GRAMMAR.md` §1: "a
		panel with no header and no rollup is the shape that keeps getting
		rejected.") It is a titled `Card` now — icon, 14/600 title, and the
		right-aligned rollup (`paneRollup`) that answers the pane's own
		question ("4 pods · streaming" / "connection lost") without reading a
		row of it. `padded={false}` because the terminal-black log stream
		wants to run to the card's own edges, not sit in a 16px frame; the
		three OTHER states (connecting/error/empty) supply their own padding
		instead.
	-->
	<Card
		icon={filterType === 'test' ? FlaskOutline : TerminalOutline}
		title={filterType === 'test' ? 'Test output' : 'Pod output'}
		padded={false}
		bodyClass="flex min-h-0 flex-1 flex-col"
		class="min-h-0 flex-1"
	>
		{#snippet rollup()}
			<span
				class="text-xs font-medium whitespace-nowrap {connectionState === 'error'
					? 'text-red-600 dark:text-red-400'
					: 'text-gray-500 dark:text-gray-400'}"
			>
				{paneRollup}
			</span>
		{/snippet}
		{#if isConnecting}
			<div class="flex flex-1 items-center justify-center">
				<Spinner size="6" color="gray" />
			</div>
		{:else if error}
			<div class="flex flex-1 items-center justify-center p-6">
				<div class="text-center">
					<p class="text-red-600 dark:text-red-400">Failed to load logs</p>
					<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">{error}</p>
					<Button class="mt-4" onclick={() => logsQuery.refetch()}>Retry</Button>
				</div>
			</div>
		{:else if allLogLines.length === 0}
			<!--
				⛔ CENTRED GRAY PROSE, NO ICON, NO FRAME. (defect #3) An empty
				pane now leads with an icon and sits at the TOP, the same shape
				`/activity`'s empty state uses — a void is not the answer to
				"nothing has arrived yet", a stated fact is.

				⛔ AND THE TESTS VIEW WAS THE PODS VIEW WITH A DIFFERENT DATA
				SOURCE. (defect #5) "the pods have written nothing" printed on
				`filterType="test"` even when a real test had run and finished
				minutes earlier — `lastTestRun` (from `RolloutTest`'s own
				status, see its definition above) is what lets this branch say
				so when it is known, and an honest "no test has written
				anything" — never "pods" — when it is not.
			-->
			<div class="flex flex-1 flex-col items-center gap-1 p-6 pt-10 text-center">
				<EmptyIcon class="mb-2 h-10 w-10 text-gray-400 dark:text-gray-500" />
				{#if hasFilters}
					<p class="text-sm font-medium text-gray-900 dark:text-white">
						No lines match the current filters
					</p>
					<p class="max-w-sm text-sm text-gray-500 dark:text-gray-400">
						{logs.length.toLocaleString()} line{logs.length === 1 ? '' : 's'} have arrived; every
						one of them is hidden by a pod, container, level or search filter.
					</p>
					<Button class="mt-3" size="sm" color="light" onclick={clearFilters}>
						Clear filters
					</Button>
				{:else if filterType === 'test'}
					<p class="text-sm font-medium text-gray-900 dark:text-white">No test output yet</p>
					{#if lastTestRun}
						<p class="max-w-sm text-sm text-gray-500 dark:text-gray-400">
							The last run, <span class="font-medium text-gray-700 dark:text-gray-300"
								>{lastTestRun.name}</span
							>, finished {formatTimeAgo(lastTestRun.finishedAt)}. New lines appear here as the
							next run writes them.
						</p>
					{:else}
						<p class="max-w-sm text-sm text-gray-500 dark:text-gray-400">
							The stream is open and no test has written anything since this view opened. New
							lines appear here as a test run writes them.
						</p>
					{/if}
				{:else}
					<p class="text-sm font-medium text-gray-900 dark:text-white">No log lines yet</p>
					<p class="max-w-sm text-sm text-gray-500 dark:text-gray-400">
						The stream is open and
						{discoveredPods.length > 0
							? `${discoveredPods.length} pod${discoveredPods.length === 1 ? ' has' : 's have'}`
							: 'the pods have'} written nothing since this view opened. New lines appear here
						as they are written.
					</p>
				{/if}
			</div>
		{:else}
			<div class="relative min-h-0 flex-1 bg-gray-900 dark:bg-gray-950">
				<div
					bind:this={virtualListEl}
					onscroll={handleScroll}
					onwheel={markUserGesture}
					ontouchstart={markUserGesture}
					onpointerdown={markUserGesture}
					class="absolute inset-0 overflow-auto"
				>
					<div class="min-w-full" style={wrapLines ? '' : 'width: max-content;'}>
						{#if virtualListBefore > 0}
							<div style="height: {virtualListBefore}px;"></div>
						{/if}

						{#each virtualItems as row, idx (row.index)}
							{@const logItem = allLogLines[row.index]}
							{@const podColor = getPodColor(logItem.pod)}
							{@const logLevel = getLogLevel(logItem.line)}
							{@const levelColor = getLogLevelColor(logLevel)}
							<div
								class="flex items-baseline border-b border-gray-800 px-2 py-1 font-mono text-xs hover:bg-gray-800/50 sm:px-4 sm:text-sm {wrapLines ? 'flex-wrap' : 'whitespace-nowrap'}"
								data-index={row.index}
							>
							{#if visibleColumns.has('timestamp')}
								<span class="shrink-0 text-gray-500">{logItem.formattedTimestamp}</span>
							{/if}
							{#if visibleColumns.has('pod')}
								<span class="mx-1 shrink-0 font-semibold sm:mx-2" style="color: {podColor}"
									>{logItem.pod}</span
								>
							{/if}
							{#if visibleColumns.has('container')}
								<span class="mx-1 shrink-0 text-green-400 sm:mx-2">{logItem.container}</span>
							{/if}
							{#if visibleColumns.has('message')}
								<span class="{levelColor} {wrapLines ? 'min-w-0 break-all whitespace-pre-wrap' : ''}">
									{@html highlightSearch(logItem.line, searchQuery)}
								</span>
							{/if}
							</div>
						{/each}

						{#if virtualListAfter > 0}
							<div style="height: {virtualListAfter}px;"></div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</Card>

	<!-- Footer with stats -->
	{#if filteredLogs.length > 0 || logs.length > 0}
		<div
			class="mt-2 flex flex-shrink-0 items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs"
		>
			<div class="flex flex-wrap items-center gap-x-1 gap-y-0.5">
				<span>
					{#if searchQuery || selectedPods.size > 0 || selectedContainers.size > 0 || selectedLogLevels.size > 0}
						{filteredLogs.length}/{logs.length}
					{:else}
						{filteredLogs.length} lines
					{/if}
				</span>
				{#if selectedPods.size > 0}
					<span class="hidden sm:inline">• {selectedPods.size} {selectedPods.size === 1 ? 'pod' : 'pods'}</span>
				{:else if uniquePods.length > 0}
					<span class="hidden sm:inline">• {uniquePods.length} {uniquePods.length === 1 ? 'pod' : 'pods'}</span>
				{/if}
				{#if searchQuery}
					<span class="text-blue-600 dark:text-blue-400">"{searchQuery}"</span>
				{/if}
			</div>
			<!-- ⚠️ THIS SAID `Streaming ●` WHENEVER A LINE HAD EVER ARRIVED — after
			     the stream closed, and after it errored. A live mark that cannot go
			     out is decoration, not a status. It is gated on the query now, and
			     the closed case says so instead of going quiet.
			     ⛔ `{:else if !error}` used to mean "not streaming and not
			     errored" — which is ALSO true while still connecting, so this row
			     could print "Stream closed" during the same instant the header
			     printed "Connecting to pods…". Reads `connectionState`
			     exclusively now; `connecting` has no branch here because the
			     outer `{#if filteredLogs.length > 0 || logs.length > 0}` guard
			     already keeps this footer hidden until there is something to
			     report, by which point the connection is never still "connecting". -->
			{#if connectionState === 'streaming'}
				<div class="flex items-center gap-1">
					<span class="hidden text-green-700 sm:inline dark:text-green-400">Streaming</span>
					<span class="h-2 w-2 animate-pulse rounded-full bg-green-700 dark:bg-green-400"></span>
				</div>
			{:else if connectionState === 'closed'}
				<div class="flex items-center gap-1 text-gray-500 dark:text-gray-400">
					<span class="hidden sm:inline">Stream closed</span>
					<span class="h-2 w-2 rounded-full bg-gray-500 dark:bg-gray-400"></span>
				</div>
			{/if}
		</div>
	{/if}
</div>
