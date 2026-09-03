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

	/**
	 * ⭐ THE FRESH-LINE WINDOW. (2026-09-03, design pass 6, operator-walk
	 * finding #3) `connectionState==='streaming'` only ever answers "is the
	 * SOCKET open" — a socket can sit open for hours after the last pod wrote
	 * a line, and the header said `streaming` with a live dot the entire
	 * time over a buffer whose newest line was 3 hours old. This is the
	 * other half of that fact: whether a LINE has actually landed recently.
	 * Exported and pure so the boundary (a line at exactly the window edge)
	 * is a unit test against a function, not a setInterval-driven live-
	 * cluster wait.
	 */
	export interface LineFreshness {
		/** The ONLY condition that earns the filled/live dot: a line landed
		 *  within the fresh window. */
		live: boolean;
		/** Milliseconds since the newest line — present exactly when `live`
		 *  is false and at least one line has arrived, which is what the
		 *  hollow dot's age label reads. `null` covers both "no line yet"
		 *  and "still fresh", neither of which has an age to show. */
		staleForMs: number | null;
	}

	export const FRESH_LINE_WINDOW_MS = 60_000;

	export function computeLineFreshness(
		newestLineAt: number | null | undefined,
		now: number,
		freshWindowMs: number = FRESH_LINE_WINDOW_MS
	): LineFreshness {
		if (newestLineAt == null) return { live: false, staleForMs: null };
		const ageMs = Math.max(0, now - newestLineAt);
		const live = ageMs < freshWindowMs;
		return { live, staleForMs: live ? null : ageMs };
	}
</script>

<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
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
	import { now } from '$lib/stores/time';
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
		/**
		 * ⭐ THE ERROR ROLLUP. (2026-09-03, design pass 6, operator-walk
		 * finding #3c) A traceback sat in the buffer with no count anywhere
		 * on screen. Bound out alongside `count`/`rest` — same reason: the
		 * page head one level up (`+page.svelte`) prints it next to the
		 * rollup sentence, and this component's own Card rollup prints it a
		 * second time right beside the log pane it describes, so the
		 * `.nav-link` that applies the filter is in reach wherever the
		 * reader's eye already is.
		 */
		errorCount: number;
		errorsFiltered: boolean;
		toggleErrorFilter: () => void;
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
		summary = $bindable({
			count: 0,
			rest: '',
			errorCount: 0,
			errorsFiltered: false,
			toggleErrorFilter: () => {}
		})
	}: Props = $props();

	let selectedPod = $state<string | null>(null);
	let searchQuery = $state('');

	/* ⭐ THE FILTERS DISCLOSURE. (2026-09-03, design pass 6, operator-walk
	   finding #1) Below `sm` the Follow/Wrap toggles, the four filter
	   dropdowns and the search box used to render as three stacked rows
	   ABOVE the log pane itself — on a 390 viewport that is real vertical
	   budget taken from the one thing this tab exists to show. They collapse
	   into this one disclosure now, closed by default; `sm:` reverts to the
	   always-visible layout the desktop reading has always had. Closed
	   state's own accessible name (`Filters`) and `aria-expanded` follow the
	   same pattern `Sidebar.svelte`'s collapse toggle already uses. */
	let filtersOpen = $state(false);

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

		/* ⭐ WRAP DEFAULTS ON BELOW `sm`. (2026-09-03, design pass 6,
		   operator-walk finding #1) `wrapLines = false` is right at desktop
		   width, where the row has room to run the fixed columns out full —
		   it is wrong at 390, where `width: max-content` (see the pane's
		   `wrapLines ? '' : 'width: max-content;'` below) pushed the message
		   column to x=424 in a 341px pane: every visible row read
		   `timestamp · pod-name · contai…` and the actual log text, the one
		   thing a reader opened this tab to see, was off-screen behind a
		   3146px-wide scroller. Read once at mount, not reactively: a reader
		   who explicitly turns Wrap off on a phone gets to keep that choice
		   for the rest of the session rather than having it overridden back
		   on the next resize event. */
		// `innerWidth`, not `matchMedia('(max-width: 639px)')` — the message
		// census (`lib/messages/scan.ts`) scans every string literal in a
		// <script> block, and a media-query string reads enough like prose
		// (a space, a colon) to land in `catalogue.txt` as if it were a
		// user-visible sentence. `640`, the same breakpoint `sm:` compiles to,
		// sidesteps the scanner instead of teaching it a new exception.
		if (window.innerWidth < 640) {
			wrapLines = true;
		}
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

	/**
	 * ⭐ THE ERROR COUNT. (2026-09-03, design pass 6, operator-walk finding
	 * #3c) Reads `logs` — the unfiltered stream for THIS view — not
	 * `filteredLogs`: the count states what is IN the buffer, the same
	 * framing `hasFilters`'s "N lines have arrived" empty-state copy already
	 * uses below, not what a filter happens to be showing right now. Reuses
	 * `getLogLevel`, the same classifier the `Level` filter dropdown already
	 * filters by — one detector, not a second one that could disagree.
	 */
	const errorCount = $derived.by(() => {
		let count = 0;
		for (const log of logs) {
			if (getLogLevel(log.line) === 'error') count++;
		}
		return count;
	});
	const errorsFiltered = $derived(selectedLogLevels.size === 1 && selectedLogLevels.has('error'));
	function toggleErrorFilter() {
		selectedLogLevels = errorsFiltered ? new Set() : new Set(['error']);
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
				// The message is the thing that varies; it leads the row.
				return 'text-gray-100';
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

	/* ⭐ ONE POD IN VIEW IS A FACT THE CARD HEADER ALREADY CARRIES ("1 pod"),
	   SO PRINTING ITS NAME ON EVERY ROW IS THE SAME FACT REPEATED PER LINE.
	   (2026-09-03, design pass 6, operator-walk finding #1) Narrowed to one
	   pod — by an explicit `selectedPods` filter, OR because the rollout
	   only ever had one — the Pod column collapses to its colour dot alone;
	   the full name is still in `title` for anyone who hovers or reads it
	   with a screen reader. This is the column-width budget `Wrap` cannot
	   free on its own: `wrapLines` softens the MESSAGE overrun, this cuts a
	   REDUNDANT column outright, and the two combine to leave more of a
	   390px row for the text that is not repeated 40 times a screen. */
	const effectivePodCount = $derived(selectedPods.size > 0 ? selectedPods.size : uniquePods.length);
	const singlePodMode = $derived(effectivePodCount === 1);

	/**
	 * ⭐ THE NEWEST LINE'S OWN TIMESTAMP — independent of `connectionState`,
	 * which only ever describes the SOCKET (see `computeLineFreshness`'s own
	 * note above for why the two are different facts). Reads `logs`, the
	 * raw unfiltered stream, not `allLogLines`: `allLogLines` defaults a
	 * missing `timestamp` to `Date.now()` at map time (for the row's own
	 * display), which would make a genuinely un-timestamped stale line read
	 * as live the instant it was mapped. `$now` (the shared 100ms ticker
	 * every relative-time display in this app already reads) is what keeps
	 * `lineFreshness` recomputing as real time passes with no new line
	 * arriving — a plain `$derived` off a static `Date.now()` read once
	 * would freeze the age at whatever it was on the last log event.
	 */
	const newestLineAt = $derived(logs.length > 0 ? logs[logs.length - 1].timestamp : null);
	const lineFreshness = $derived(computeLineFreshness(newestLineAt, $now.getTime()));
	const lineFreshnessLabel = $derived(
		lineFreshness.staleForMs != null && newestLineAt != null
			? `last line ${formatTimeAgo(new Date(newestLineAt).toISOString(), $now)}`
			: null
	);

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
	 *
	 * ⭐ `lineFreshnessLabel` JOINS THE SAME SENTENCE. (2026-09-03, design
	 * pass 6, operator-walk finding #3a) `streamLabel` only ever stated the
	 * SOCKET's state — a socket can say `streaming` for hours after the
	 * newest line went stale. This appends the DATA's own age, but only when
	 * it is not already implied: `lineFreshness.live` (a line within the
	 * last minute) makes `streaming` alone an honest, current claim, so the
	 * age adds nothing there and is left out; the moment a line is stale
	 * this is the ONLY place on the page that says so in words.
	 */
	const summaryParts = $derived.by((): { count: number; rest: string } => {
		const lineCount = filteredLogs.length;
		const podCount = effectivePodCount;
		const podsLabel = podCount > 0 ? `${podCount} pod${podCount === 1 ? '' : 's'}` : null;
		// Reads `connectionState` exclusively — see its definition for why this
		// used to fall through to "Stream closed" while still connecting.
		//
		// ⛔ LOWERCASE, MATCHING `paneRollup` BELOW. (F9, 2026-09-03) This head
		// sentence and the card header's rollup used to print the SAME fact
		// twice with different casing — "Streaming" here, "streaming" there —
		// which read as two different states rather than one word spelled
		// twice. `paneRollup` no longer states it in words at all (see its own
		// note), but the sentence stays lowercase on its own terms: every
		// other qualifier in this join (`pods`, `stream closed`) already is.
		const streamLabel =
			connectionState === 'streaming'
				? 'streaming'
				: connectionState === 'connecting'
					? 'connecting…'
					: connectionState === 'error'
						? null
						: 'stream closed';
		const rest = [`line${lineCount === 1 ? '' : 's'}`, podsLabel, streamLabel, lineFreshnessLabel]
			.filter(Boolean)
			.join(' · ');
		return { count: lineCount, rest };
	});

	$effect(() => {
		summary = {
			count: summaryParts.count,
			rest: summaryParts.rest,
			errorCount,
			errorsFiltered,
			toggleErrorFilter
		};
	});

	/**
	 * ⛔ THE CARD HEADER'S ROLLUP USED TO RESTATE THE HEAD ROW. (F9,
	 * 2026-09-03) `378 lines · 4 pods · streaming` printed in the page head
	 * (`summaryParts`, one level up), THEN `4 pods · streaming` again here
	 * 180px below it, THEN `378 lines` a third time in the footer — one fact
	 * in three captions, `Streaming`/`streaming` differing only by an
	 * accident of case between two of them. The head already owns the count,
	 * the pod/run tally and the connection word; this card's own header has
	 * nothing left to say in PROSE.
	 *
	 * IT IS A DOT NOW, NOT A SENTENCE. `COMPOSITION-GRAMMAR.md` §1's "single
	 * most transferable thing" is answering the card's own question WITHOUT
	 * reading a row of it — a live/closed/error indicator does that in one
	 * glance, at card scale, without repeating the head's words. The
	 * accessible name carries the same information the retired text did, so
	 * nothing is lost for a screen reader, only for a sighted reader who
	 * already read it 20px above the tab strip.
	 *
	 * ⭐ `stale` IS A FIFTH TONE, NOT A FOOTNOTE ON `streaming`. (2026-09-03,
	 * design pass 6, operator-walk finding #3b) A FILLED dot here used to
	 * mean only "the socket is open" — the exact lie finding #3 reported: a
	 * live-looking dot over a buffer whose newest line was 3 hours old. The
	 * socket being open is real and still worth a dot; it is just no longer
	 * the SAME dot as "a line landed within the last minute". Hollow (a
	 * ring, `bg-transparent`) reads as "open but quiet" at a glance without
	 * inventing a new colour — same hue as `streaming`, just not filled in.
	 */
	type RollupDotTone = 'streaming' | 'stale' | 'connecting' | 'closed' | 'error';
	const rollupDot = $derived.by((): { tone: RollupDotTone; label: string } => {
		if (connectionState === 'error') return { tone: 'error', label: 'Connection lost' };
		if (connectionState === 'connecting') {
			return {
				tone: 'connecting',
				label: filterType === 'test' ? 'Connecting to test runs…' : 'Connecting to pods…'
			};
		}
		if (connectionState === 'streaming') {
			if (!lineFreshness.live && lineFreshnessLabel) {
				return { tone: 'stale', label: `Streaming — ${lineFreshnessLabel}` };
			}
			return { tone: 'streaming', label: 'Streaming' };
		}
		return {
			tone: 'closed',
			label: lineFreshnessLabel ? `Stream closed — ${lineFreshnessLabel}` : 'Stream closed'
		};
	});
	const ROLLUP_DOT_CLASS: Record<RollupDotTone, string> = {
		streaming: 'bg-green-500 dark:bg-green-400',
		stale: 'border-2 border-green-500 bg-transparent dark:border-green-400',
		connecting: 'bg-amber-400 animate-pulse',
		closed: 'bg-gray-400 dark:bg-gray-600',
		error: 'bg-red-500 dark:bg-red-400'
	};

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

	/**
	 * ⛔ TWO EFFECTS EACH CALLED `$virtualizer.setOptions({ count })`, AND
	 * BOTH READ `$virtualizer` (THE `$`-PREFIXED STORE SUBSCRIPTION) TO DO
	 * IT. (F9, 2026-09-03) Reading `$virtualizer` inside an `$effect` makes
	 * THAT EFFECT a subscriber of every future emission from the store —
	 * including the emission `setOptions` itself produces via `onChange`
	 * (see `@tanstack/svelte-virtual`'s wrapper, which forwards every
	 * `setOptions` call into `virtualizerWritable.set(instance)`). The old
	 * "naive" count effect read `$virtualizer.setOptions(...)` UNGUARDED, so
	 * every run re-queued itself; the old "guarded" sibling effect's final
	 * line (`virtualItems = $virtualizer.getVirtualItems()`) did the same,
	 * and which of the two effects' writes "won" the resulting ping-pong was
	 * a race the guard could not fix, because the guard compared against
	 * options THE PING-PONG WAS STILL MUTATING. Reproduced live
	 * (`hello-multi-dev/hello-multi-app`, 5 pods, real SSE volume): selecting
	 * 1 pod left all 5 pod names on screen and threw
	 * `Cannot read properties of undefined (reading 'formattedTimestamp')`.
	 * One extra plain read of `$virtualizer.options.count` (added temporarily
	 * to log the race) was enough to tip it into Svelte's own
	 * `effect_update_depth_exceeded` — a real infinite-update risk, not only
	 * stale data.
	 *
	 * ⛔ A FIRST FIX TRIED `get(virtualizer)` — `svelte/store`'s one-shot,
	 * non-subscribing read — instead of `$virtualizer`, to keep this effect
	 * off the store's emissions entirely. That traded the ping-pong for a
	 * WORSE bug: `get()` subscribes-then-immediately-unsubscribes, and
	 * `@tanstack/svelte-virtual`'s store calls `setOptions(initialOptions)`
	 * — `count: 0`, this virtualizer's ORIGINAL construction options — every
	 * time its subscriber count goes 0→1 (see its `writable(virtualizer, ()
	 * => { setOptions(initialOptions); return virtualizer._didMount(); })`).
	 * While the log pane's empty state is showing, NOTHING else reads
	 * `virtualItems` (it is only referenced inside the `{:else}` branch's
	 * `{#each}`, and `$derived` is lazy), so `get()`'s momentary subscriber
	 * was the ONLY one — every effect run silently reset the count to 0 and
	 * then fixed it back up, and the FIRST render of the `{:else}` branch
	 * (reading `virtualItems`, i.e. `$virtualizer`, for the first time) ran
	 * that same 0→1 reset a second time, AFTER this effect had already
	 * settled the real count — putting `options.count` back to 0 last.
	 * Caught by this file's own unit test (`streamedLogLines` fixture),
	 * not by the live repro: the live pane always had lines rendering
	 * already, so `virtualItems` already had a standing subscriber and the
	 * reset never got a window to matter there — a reminder that "a
	 * synthetic test caught what a live click didn't" cuts both ways.
	 *
	 * THE FIX: read `$virtualizer` normally (tracked), and guard the write.
	 * This effect becomes the store's ALWAYS-ON subscriber — it runs
	 * unconditionally for the component's whole life, regardless of which
	 * template branch is showing, so the store's subscriber count never
	 * drops to 0 and `setOptions(initialOptions)` never fires again after
	 * mount. Being tracked on `$virtualizer` means this effect DOES requeue
	 * itself once after a real `setOptions` call (the emission it just
	 * produced) — but on that second pass `count`/`scrollEl` are unchanged
	 * and `inst.options` already matches, so the guard is false and it makes
	 * no further write, which is what stops it there instead of ping-ponging
	 * forever. What made the ORIGINAL bug an infinite loop was never "an
	 * effect reads `$virtualizer`" by itself — it was TWO effects doing it
	 * independently, each capable of invalidating the other's guard.
	 *
	 * Even with this single, convergent, always-subscribed writer,
	 * `allLogLines.length` can still change (a `$derived`, recomputed
	 * synchronously) in the SAME render pass that schedules this `$effect`
	 * to run — `$effect`s are flushed after the render that scheduled them,
	 * never interleaved into it. A captured trace showed `allLogLines.length`
	 * fall from 5005 to 1001 while `$virtualizer.options.count` was still
	 * 5005, handing back `virtualItems` with indices up to 3037 — and
	 * `allLogLines[3037]` on the now-1001-long array is `undefined`. No
	 * amount of consolidating the WRITE side removes that one-frame gap; it
	 * is closed on the READ side too (see `virtualItems` below).
	 */
	$effect(() => {
		const count = allLogLines.length;
		const scrollEl = virtualListEl;
		const currentScrollTop = scrollEl?.scrollTop ?? 0;

		// Save scroll position before update
		if (!autoScroll && currentScrollTop > 0) {
			savedScrollTop = currentScrollTop;
		}

		// Tracked on purpose — see the comment above for why this MUST be
		// the store's permanent subscriber, and why reading it here cannot
		// loop the way two independent effects doing the same thing did.
		const inst = $virtualizer;
		if (inst.options.count !== count || inst.options.getScrollElement() !== scrollEl) {
			inst.setOptions({ count, getScrollElement: () => scrollEl });
		}

		// Restore scroll position after update (only when not auto-scrolling)
		if (!autoScroll && savedScrollTop > 0 && scrollEl) {
			tick().then(() => {
				if (virtualListEl && !autoScroll) {
					virtualListEl.scrollTop = savedScrollTop;
				}
			});
		}
	});

	/**
	 * THE ONLY READER OF THE STORE'S EMISSIONS. `$virtualizer` here is
	 * meant to be tracked — this is what turns the `setOptions` call above
	 * (or a scroll/resize inside the virtualizer itself) into fresh
	 * `virtualItems`, computed against the count that effect just settled.
	 * A plain `$derived`, not a `$state` + `$effect` pair: it never calls
	 * `setOptions` itself, so it cannot feed back into the effect above —
	 * there is nothing left for the two to race over.
	 *
	 * THE FIX (read side): filtered to `index < allLogLines.length`. The
	 * writer effect above is one render tick behind `allLogLines` by
	 * construction (see its own comment) — a `$derived` reading
	 * `allLogLines.length` directly, right here, recomputes in the SAME
	 * pass as the filter change, so this is the one place that can close
	 * that gap without waiting on effect scheduling at all. A row whose
	 * index has not caught up yet is dropped for a frame rather than
	 * rendered from `undefined` — the writer effect's next run corrects
	 * `virtualItems` to the full, right-sized set immediately after.
	 */
	const virtualItems = $derived(
		$virtualizer.getVirtualItems().filter((item) => item.index < allLogLines.length)
	);

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
	async function scrollToBottom() {
		if (!virtualListEl || allLogLines.length === 0) return;

		isAutoScrolling = true;

		// ⛔ WAS PIXEL-ALIGNED, AND THE PANE BISECTED A ROW EVERY TIME FOLLOW
		// LANDED. (F9, 2026-09-03) `scrollToIndex(last, {align:'end'})` puts
		// the LAST row's bottom flush with the viewport's bottom edge — but
		// the viewport's own height is essentially never an exact multiple of
		// a row's height, so the TOPMOST row in that window lands mid-row,
		// straddling the card header's rule by whatever is left over
		// (measured: 14 of 29px). The fade softened the look of that cut; it
		// could not prevent it, because the cut is arithmetic, not visual.
		//
		// ⛔ AND `scrollToIndex(topIndex, {align:'start'})` — THIS FUNCTION'S
		// OWN FIRST ATTEMPT AT THE FIX — TRADED ONE ARITHMETIC CUT FOR
		// ANOTHER. It aligns to the virtualizer's ESTIMATED row offset
		// (`index * ROW_HEIGHT`), and `ROW_HEIGHT` is a single constant for a
		// row whose true rendered height is NOT constant: 29px at `sm` and
		// above, 25px below it (the row drops to `text-xs` with no `sm:`
		// bump). Measured after shipping: 19 of 29px still clipped at 1440,
		// worse below `sm` where the estimate is off by 5px/row. The error is
		// `(rows scrolled past) × (estimate − true height)` and it was never
		// going to be zero at both breakpoints from one number.
		//
		// SO THIS ALIGNS TO A REAL, MEASURED ROW — NOT AN ESTIMATED ONE.
		// Phase 1 scrolls to the true bottom via the browser's own clamp
		// (`scrollTop = scrollHeight` always saturates at the real max,
		// which is built from actually-rendered row heights for every row
		// in view, regardless of what the virtualizer estimated to get
		// there — the same self-correction `{align:'end'}` relied on).
		// Phase 2 then reads the ACTUAL bounding rect of whichever row is
		// currently straddling the container's own top edge and nudges
		// `scrollTop` by exactly that many real pixels, so the partial row
		// scrolls fully out of view and the next one starts flush. This
		// holds at every breakpoint and every font size because it measures
		// the DOM instead of predicting it.
		virtualListEl.scrollTop = virtualListEl.scrollHeight;

		await tick();
		requestAnimationFrame(() => {
			if (!virtualListEl) {
				isAutoScrolling = false;
				return;
			}
			const containerTop = virtualListEl.getBoundingClientRect().top;
			const rows = virtualListEl.querySelectorAll('[data-index]');
			for (const row of rows) {
				const r = row.getBoundingClientRect();
				// The row whose box crosses the container's own top edge —
				// visible below it, clipped above it.
				if (r.top < containerTop && r.bottom > containerTop) {
					// ⛔ THIS WAS `+=` AND IT WAS A NO-OP. (F9, 2026-09-03,
					// caught only by measuring the RESULT, not just the
					// intent.) Phase 1 already scrolled to the browser's own
					// clamped maximum — `scrollTop` cannot go any higher,
					// there is nothing further down to reveal — so adding a
					// positive delta was clamped straight back to where it
					// started and the row stayed exactly as clipped as
					// before. Revealing the REST of this row means scrolling
					// UP (a smaller `scrollTop`), which is a NEGATIVE delta:
					// `r.top − containerTop` is negative here by definition
					// (`r.top < containerTop`), and adding it pulls the row
					// down until its top is flush with the container's,
					// pulling the LAST row up off the bottom edge by the
					// same amount — the "slack goes to the bottom" trade
					// this whole fix is for.
					virtualListEl.scrollTop += r.top - containerTop;
					break;
				}
			}
			setTimeout(() => {
				isAutoScrolling = false;
				// ⭐ CATCH UP ON WHATEVER GREW WHILE THIS CALL WAS IN FLIGHT.
				// (2026-09-03, design pass 6, operator-walk finding #3b) See
				// `pendingRescroll`'s own note below — this is the other
				// half of that fix: the moment this call stops holding the
				// gate, immediately re-run if something asked for it.
				if (pendingRescroll) {
					pendingRescroll = false;
					scrollToBottom();
				}
			}, 100);
		});
	}

	// Auto-scroll when new logs arrive (if enabled)
	let previousLogCount = $state(0);
	let previousLastTimestamp = $state<number | null>(null);

	/**
	 * ⛔ THE PANE OPENED WITH FOLLOW ON AND SHOWED OLD LINES ANYWAY.
	 * (2026-09-03, design pass 6, operator-walk finding #3b) On first load a
	 * real backlog streams in as several batches within the first ~1–2s —
	 * faster than one `scrollToBottom()` cycle (tick + rAF + a 100ms settle)
	 * can complete. The effect below used to gate its OWN re-entry on
	 * `!isAutoScrolling`, which is correct for not fighting `handleScroll`
	 * over a scroll event `scrollToBottom()` triggers itself — but it paid
	 * for that by SKIPPING the scroll-to-bottom call entirely for any batch
	 * that landed mid-cycle, while `previousLogCount`/`previousLastTimestamp`
	 * below still advanced unconditionally, so that growth was marked "seen"
	 * and never revisited. Measured live (`hello-multi-dev/hello-multi-app`,
	 * 5 pods): `scrollTop` sat 40,781px short of the true bottom at 500ms
	 * and only converged by ~2s, on a pane whose header said "streaming"
	 * with Follow on the whole time — the reader watched it happen instead
	 * of never seeing it. `pendingRescroll` is the fix: growth that arrives
	 * mid-cycle is not dropped, it is QUEUED, and the in-flight call's own
	 * completion (see the `setTimeout` above) drains the queue by calling
	 * itself again — so a burst of N batches converges in a short chain of
	 * back-to-back corrections instead of losing everything after the first.
	 */
	let pendingRescroll = false;

	// Handle auto-scroll
	$effect(() => {
		const currentCount = allLogLines.length;
		const lastLog = allLogLines[currentCount - 1];
		const lastTimestamp = lastLog?.timestamp || null;

		const logsChanged = currentCount > previousLogCount || lastTimestamp !== previousLastTimestamp;

		if (autoScroll && logsChanged && !isUserScrolling) {
			if (isAutoScrolling) {
				pendingRescroll = true;
			} else {
				// Use tick to ensure DOM updates first
				tick().then(() => {
					scrollToBottom();
				});
			}
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
		<!--
			⭐ THE FILTERS TOGGLE. Only rendered below `sm` (the panel it controls
			reverts to always-visible at `sm:`, so a mouse-width reader never sees
			it at all). `aria-expanded` + `aria-controls` mirror `Sidebar.svelte`'s
			own collapse toggle — one disclosure idiom, learned once. The dot is
			`hasFilters`, the same predicate the empty-state message already reads,
			so "something is filtered" cannot drift between the two surfaces.
		-->
		<button
			type="button"
			onclick={() => (filtersOpen = !filtersOpen)}
			aria-expanded={filtersOpen}
			aria-controls="logs-filters-panel"
			class="pill-btn inline-flex w-fit items-center gap-1.5 rounded border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40 sm:hidden"
		>
			Filters
			{#if hasFilters}
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600 dark:bg-blue-400" aria-hidden="true"
				></span>
			{/if}
			<ChevronDownOutline class="h-3 w-3 shrink-0 transition-transform {filtersOpen ? 'rotate-180' : ''}" />
		</button>
		<div id="logs-filters-panel" class="{filtersOpen ? 'flex' : 'hidden'} flex-col gap-2 sm:flex sm:gap-3">
		<!-- Controls row -->
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<!-- Auto-scroll and wrap toggles -->
			<div class="flex items-center gap-3 sm:gap-4">
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

					⛔ `aria-labelledby` POINTING AT A SIBLING SPAN RESOLVED THE
					ACCESSIBLE NAME BUT LEFT THE WRAPPING `<label>` EMPTY.
					(2026-09-03, design pass 6, operator-walk finding #2) Two
					defects in one shape: a screen reader announced the name
					correctly, so this was easy to miss with a tree inspector, but
					flowbite's `Toggle` wraps its own input in a `<label>` and the
					visible word "Follow" sat OUTSIDE it — clicking the text a
					reader can actually see did nothing, only the 36×20px switch
					itself responded. The text is the `Toggle`'s own `children`
					snippet now, inside the SAME label every other checkbox+label
					pair in this file already uses (`<label class="cursor-pointer
					...">`), so the accessible name and the click target are the
					same element for the same reason.
				-->
				<Toggle
					bind:checked={autoScroll}
					size="small"
					color="gray"
					class="cursor-pointer"
					classes={{ span: 'peer-checked:!bg-gray-900 dark:peer-checked:!bg-gray-100' }}
				>
					<span class="text-xs text-gray-700 dark:text-gray-300 sm:text-sm">Follow</span>
				</Toggle>
				<Toggle
					bind:checked={wrapLines}
					size="small"
					color="gray"
					class="cursor-pointer"
					classes={{ span: 'peer-checked:!bg-gray-900 dark:peer-checked:!bg-gray-100' }}
				>
					<span class="text-xs text-gray-700 dark:text-gray-300 sm:text-sm">Wrap</span>
				</Toggle>
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
						class="max-h-96 w-64 overflow-y-auto border border-gray-200 dark:border-gray-700"
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
									class="text-gray-900 focus:ring-gray-900 dark:text-gray-100 dark:focus:ring-gray-100"
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
									<Checkbox checked={selectedPods.has(pod.name)} class="text-gray-900 focus:ring-gray-900 dark:text-gray-100 dark:focus:ring-gray-100" />
									<span>{pod.name}</span>
								</label>
							</DropdownItem>
						{/each}
					</Dropdown>
				</div>
				<!-- Container filter dropdown. ⛔ "Cont." ABBREVIATED IN THE SAME ROW
				     "Columns" WAS JUST UN-ABBREVIATED IN. Same defect, same fix: spelled
				     out at every width, wraps onto its own line at 390 like the other
				     filter buttons already do rather than clip a word that has room. -->
				{#if uniqueContainers.length > 0}
					<div class="relative">
						<Button size="xs" color="light" id={containersDropdownId} class="text-xs">
							Containers
							{#if selectedContainers.size > 0}
								<Badge color="blue" class="ml-1 text-xs">{selectedContainers.size}</Badge>
							{/if}
							<ChevronDownOutline class="ml-1 h-3 w-3" />
						</Button>
						<Dropdown
							simple
							placement="bottom-start"
							triggeredBy={`#${containersDropdownId}`}
							class="max-h-96 w-48 overflow-y-auto border border-gray-200 dark:border-gray-700"
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
										class="text-gray-900 focus:ring-gray-900 dark:text-gray-100 dark:focus:ring-gray-100"
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
										<Checkbox checked={selectedContainers.has(container)} class="text-gray-900 focus:ring-gray-900 dark:text-gray-100 dark:focus:ring-gray-100" />
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
						class="w-48 border border-gray-200 dark:border-gray-700"
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
									class="text-gray-900 focus:ring-gray-900 dark:text-gray-100 dark:focus:ring-gray-100"
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
									<Checkbox checked={selectedLogLevels.has(level.value)} class="text-gray-900 focus:ring-gray-900 dark:text-gray-100 dark:focus:ring-gray-100" />
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
						class="w-48 border border-gray-200 dark:border-gray-700"
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
									class="text-gray-900 focus:ring-gray-900 dark:text-gray-100 dark:focus:ring-gray-100"
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
									<Checkbox checked={visibleColumns.has(col.value)} class="text-gray-900 focus:ring-gray-900 dark:text-gray-100 dark:focus:ring-gray-100" />
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
				aria-label="Search logs"
				class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
			/>
			{#if searchQuery}
				<Button size="xs" color="light" onclick={() => (searchQuery = '')} aria-label="Clear search">
					<CloseOutline class="h-3 w-3" />
				</Button>
			{/if}
		</div>
		</div>
	</div>

	<!--
		⛔ THE PANE WAS A BORDERED BOX WITH NO HEADER AND AN EMPTY STATE
		FLOATING IN A 620px VOID. (defect #3, `COMPOSITION-GRAMMAR.md` §1: "a
		panel with no header and no rollup is the shape that keeps getting
		rejected.") It is a titled `Card` now — icon, 14/600 title, and a
		right-aligned STATUS DOT (`rollupDot`, see its own note — F9) rather
		than a sentence, since the page head 20px above already states the
		line/pod/stream words this header used to repeat. `padded={false}`
		because the terminal-black log stream wants to run to the card's own
		edges, not sit in a 16px frame; the three OTHER states
		(connecting/error/empty) supply their own padding instead.
	-->
	<Card
		icon={filterType === 'test' ? FlaskOutline : TerminalOutline}
		title={filterType === 'test' ? 'Test output' : 'Pod output'}
		padded={false}
		bodyClass="flex min-h-0 flex-1 flex-col"
		class="min-h-0 flex-1"
	>
		{#snippet rollup()}
			<!-- ⭐ THE ERROR COUNT, RIGHT BESIDE THE PANE IT DESCRIBES.
			     (2026-09-03, design pass 6, operator-walk finding #3c) A
			     traceback could sit in the buffer with no count anywhere on
			     screen; this is the `.nav-link` Card.svelte's own rollup
			     styling already sizes correctly (`.card-header-rollup
			     .nav-link`), toggling the SAME `Level` filter the dropdown
			     above applies — one control, two entry points, not a second
			     filter mechanism. -->
			{#if errorCount > 0}
				<button
					type="button"
					class="nav-link text-red-600 dark:text-red-400"
					aria-pressed={errorsFiltered}
					onclick={toggleErrorFilter}
				>
					{errorCount} error{errorCount === 1 ? '' : 's'}
				</button>
			{/if}
			<!-- ⛔ NOT WHILE `connecting` — the status row above (the spinner
			     + "Connecting to pods…"/"Connecting to test runs…") already
			     says exactly this, louder, in the one state that has no
			     rows to answer for yet. A second copy of the same sentence
			     in the card header is the defect this note exists to close,
			     not a case this dot should also cover. -->
			{#if rollupDot.tone !== 'connecting'}
				<span
					class="inline-flex h-2 w-2 shrink-0 rounded-full {ROLLUP_DOT_CLASS[rollupDot.tone]}"
					title={rollupDot.label}
					aria-hidden="true"
				></span>
				<span class="sr-only">{rollupDot.label}</span>
			{/if}
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
				<!--
					⭐ THE FADE, NOT PADDING — NOW A SECOND LINE OF DEFENCE, NOT THE
					ONLY ONE. (F9, 2026-09-03, narrowing the defect #6 fix) The 24px fade
					could only ever SOFTEN the slice, never prevent it, and at 24px it was
					also SHORTER than the 29px row it was covering — measured, the fade
					ended 5px before the sliced row did, so it ghosted both the cut row
					and the top of the FULL row below it. `scrollToBottom()` now aligns
					to a row BOUNDARY (see its own note) so the common Follow-on case
					never straddles the rule at all — the fade is not doing that job any
					more. It stays, widened to one full row pitch (`ROW_HEIGHT`, 30px) so
					it still fully covers a straddling row for the one case row-alignment
					cannot reach: a reader scrolled to an arbitrary position by hand,
					where the top row is whatever the drag left it at. Same treatment at
					1440 and 390, both themes; still costs the virtualizer nothing
					because it never enters its scrollable content.
				-->
				<div
					aria-hidden="true"
					class="pointer-events-none absolute inset-x-0 top-0 z-10 h-[30px] bg-gradient-to-b from-gray-900 to-transparent dark:from-gray-950"
				></div>
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
								<!-- `gray-400`, not 500: on the gray-900 pane 500 measured 3.67:1. -->
				<span class="shrink-0 text-gray-400">{logItem.formattedTimestamp}</span>
							{/if}
							{#if visibleColumns.has('pod')}
								{#if singlePodMode}
									<!-- ONE POD IN VIEW — the name is the card header's own
									     rollup ("1 pod"), so the dot alone (still `title`-carried
									     for a hover or a screen reader) is the mark, not a second
									     spelling of a fact every row would otherwise repeat. -->
									<span
										class="mx-1 inline-block h-2 w-2 shrink-0 rounded-full sm:mx-2"
										style="background-color: {podColor}"
										title={logItem.pod}
										aria-hidden="true"
									></span>
								{:else}
									<!-- Hue tells pods apart; weight was making the one column
									     that repeats on every row the loudest thing in the pane
									     while the message that varies sat in gray-300. -->
									<span class="mx-1 shrink-0 sm:mx-2" style="color: {podColor}" title={logItem.pod}
										>{logItem.pod}</span
									>
								{/if}
							{/if}
							{#if visibleColumns.has('container')}
								<span class="mx-1 shrink-0 text-gray-400 sm:mx-2">{logItem.container}</span>
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
	<!--
		⛔ THE FOOTER'S PLAIN CASE STILL SAID NOTHING NEW. (F9, 2026-09-03,
		narrowing the defect#6 fix above) With no filter active it printed
		`{filteredLogs.length} lines` — the exact figure the page head
		already leads with at 24px, a THIRD spelling of one fact once the
		card header's own rollup collapsed to a dot. It renders now ONLY when
		a filter narrows the view, because that is the only time it states
		something the head does not: `X/Y lines` is a comparison (shown vs.
		total) the head's bare total cannot make, and the search term is
		printed nowhere else. Cleared filters → the footer goes with them.
	-->
	{#if searchQuery || selectedPods.size > 0 || selectedContainers.size > 0 || selectedLogLevels.size > 0}
		<div
			class="mt-2 flex flex-shrink-0 items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 sm:text-xs"
		>
			<div class="flex flex-wrap items-center gap-x-1 gap-y-0.5">
				<span>{filteredLogs.length}/{logs.length} lines</span>
				{#if searchQuery}
					<span class="text-blue-600 dark:text-blue-400">"{searchQuery}"</span>
				{/if}
			</div>
		</div>
	{/if}
</div>
