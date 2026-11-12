<svelte:options runes={true} />

<script module lang="ts">
	import { newestFirst, isLater } from '$lib/instant';
	import { displayTimeZone, timeZonePreference } from '$lib/timezone.svelte';
	import { formatTimestamp } from '$lib/display-time';
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

	/**
	 * ⭐ THE TWO FILTER STAGES, SPLIT SO THE SEARCH BOX CAN REPORT ITS OWN
	 * SCOPE. (2026-09-12, L5 "the log viewer survives a 60fps capture")
	 * `filteredLogs` used to apply pods/containers/levels/search in one pass,
	 * so there was no number anywhere for "how many lines could the search
	 * term possibly match" — only "how many survived every filter combined".
	 * Splitting the AND into two pure, exported stages lets the instance
	 * script compute BOTH `nonSearchFilteredLogs` (the search's own scope —
	 * everything search is choosing among) and `filteredLogs`
	 * (`applySearchFilter` layered on top of that) without the pod/container/
	 * level predicates being written out twice and able to drift apart.
	 */
	export interface SearchableLogLine {
		pod: string;
		container: string;
		line: string;
	}

	export interface NonSearchLogFilters {
		pods: Set<string>;
		containers: Set<string>;
		levels: Set<'error' | 'warn' | 'info' | 'debug'>;
	}

	export function applyNonSearchFilters<T extends SearchableLogLine>(
		items: T[],
		filters: NonSearchLogFilters,
		getLevel: (line: string) => 'error' | 'warn' | 'info' | 'debug' | null
	): T[] {
		let result = items;
		if (filters.pods.size > 0) {
			result = result.filter((item) => filters.pods.has(item.pod));
		}
		if (filters.containers.size > 0) {
			result = result.filter((item) => filters.containers.has(item.container));
		}
		if (filters.levels.size > 0) {
			result = result.filter((item) => {
				const level = getLevel(item.line);
				return level !== null && filters.levels.has(level);
			});
		}
		return result;
	}

	export function applySearchFilter<T extends SearchableLogLine>(items: T[], query: string): T[] {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		return items.filter(
			(item) =>
				item.line.toLowerCase().includes(q) ||
				item.pod.toLowerCase().includes(q) ||
				item.container.toLowerCase().includes(q)
		);
	}

	/**
	 * ⭐ THE SEARCH COUNT'S OWN SENTENCE — "N of M lines". (2026-09-12, L5)
	 * Shared by the new inline count beside the search box AND the existing
	 * footer stat below it, so the two can never drift into two spellings of
	 * "how many lines match" the way this file's own vocabulary passes keep
	 * finding elsewhere in the product (see `CLAUDE.md`'s "vocabulary
	 * decision" section). Counts LINES — each qualifying row once — never
	 * OCCURRENCES within a line; that is exactly the predicate
	 * `applySearchFilter` already filters by, so the label is never a claim
	 * the render can contradict.
	 */
	export function lineCountLabel(matchCount: number, totalCount: number): string {
		return `${matchCount.toLocaleString()} of ${totalCount.toLocaleString()} line${totalCount === 1 ? '' : 's'}`;
	}

	/**
	 * ⭐ TOKEN-BOUNDARY TRUNCATION FOR THE UNWRAPPED MESSAGE COLUMN.
	 * (2026-09-12, L5) With `Wrap` off, a long line used to run past the
	 * pane's own right edge and rely on the pane's horizontal scrollbar to
	 * reach the rest — invisible unless a reader notices a scrollbar, and in
	 * a fixed-frame video capture the line just LOOKS clipped mid-word, with
	 * no sign anything follows. This cuts at the last whitespace boundary
	 * within budget and appends an ellipsis, so the visible edge is always a
	 * WORD edge, never a character sheared out of one. `maxChars` is measured
	 * live off the row's own rendered width (see the `$effect` below it in
	 * the instance script), not a hand-picked constant.
	 *
	 * Reachability is NOT a fourth mechanism bolted on: `Wrap` — already a
	 * toggle on this panel — shows the untruncated line by wrapping it, and
	 * the full line also rides the span's own `title`, the same idiom this
	 * file already uses for the pod name and the timestamp column, now
	 * extended to the message. No expand button, no popover, no copy icon
	 * added.
	 */
	export function truncateAtWordBoundary(text: string, maxChars: number): string {
		if (maxChars <= 1 || text.length <= maxChars) return text;
		const budget = maxChars - 1; // leave room for the ellipsis glyph
		const slice = text.slice(0, budget);
		const lastSpace = slice.lastIndexOf(' ');
		// No whitespace to break on (one long unbroken token) — a hard cut is
		// the only option left; it is still shorter than the uncapped line it
		// replaces, and the full line is still one hover or one Wrap-toggle
		// away.
		const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
		return `${cut.trimEnd()}…`;
	}

	/**
	 * ⭐ MIDDLE TRUNCATION FOR A TEST RUN'S OWN NAME (art director round 1,
	 * must-fix #7: "the name truncates to 'hello-world-test-f68d0…', which
	 * cuts the part that tells runs apart"). A `RolloutTest`'s name is
	 * `<rollout>-test-<build sha>[-<suffix>]` — the SHARED prefix is the
	 * long part, and the one thing that actually distinguishes two runs
	 * (the sha, a retry suffix) sits at the END, exactly where a trailing
	 * `truncate` cuts it off first. Keeping a fixed head and a fixed tail
	 * (never less than `tail` characters of each) is the general fix —
	 * right for a sha-suffixed identifier, not specific to this one mock
	 * name.
	 */
	/**
	 * ⭐ A POD VALUE IS ITS DISTINGUISHING SUFFIX (LOGOPEN r9, item 4,
	 * coordinator: "show only the distinguishing suffix ('…n9p1v'), as the
	 * sources pane does"). Every pod of a build shares the
	 * `<deployment>-<replicaset hash>-` head; the last segment is what tells
	 * two apart, and it is the same word the Pods pane and the Pod column
	 * already print. The full name stays in the element's `title`.
	 */
	export function podValueLabel(name: string): string {
		const idx = name.lastIndexOf('-');
		if (idx === -1 || idx === name.length - 1) return name;
		return `…${name.slice(idx + 1)}`;
	}

	export function truncateMiddle(text: string, maxChars: number, tail = 8): string {
		if (maxChars <= 1 || text.length <= maxChars) return text;
		const headLen = Math.max(1, maxChars - tail - 1); // 1 for the ellipsis glyph
		if (headLen + tail >= text.length) return text;
		return `${text.slice(0, headLen)}…${text.slice(text.length - tail)}`;
	}

	/**
	 * ⭐ STRUCTURED-LINE FIELDS (squad-rollout coordinator addendum,
	 * 2026-10-09: "a JSON or logfmt line shows its message, and expanding
	 * it reveals key: value pairs"). Two shapes, tried in order:
	 *
	 *   1. a `{ … }` JSON object embedded in the line (the mock's own
	 *      "Processing webhook payload: {...}" line is exactly this) —
	 *      parsed and flattened one level deep, nested values re-stringified
	 *      rather than recursed into a second expand level;
	 *   2. logfmt-ish `key=value` tokens (`request_id=req_a0119f |
	 *      cache=HIT`), already most of this mock's own request/response
	 *      lines — matched with a regex, not a real logfmt parser, which is
	 *      enough for the shapes real log lines in this product actually
	 *      produce (no nested quoting, no escapes).
	 *
	 * Returns `null` when neither shape matches — most lines (plain prose
	 * log messages) have nothing to expand, and the row's own expand
	 * affordance only renders when this is non-null.
	 */
	export interface StructuredField {
		key: string;
		value: string;
	}

	/**
	 * ⭐ THE ROW'S OWN HEADLINE, NOT THE WHOLE LINE (logs round 6, squad-
	 * rollout coordinator: "drop the pipe-joined `request_id=… | cache=HIT`
	 * tail into structured fields that only show on expand"). Strips a
	 * TRAILING run of ` | key=value` pairs — the exact shape
	 * `parseStructuredFields`'s own logfmt branch already parses from the
	 * SAME raw line for the expand block — so the collapsed row shows only
	 * the sentence a reader actually scans ("GET /checkout/session 200
	 * 14ms"), and the diagnostic fields it used to drag along inline live
	 * in exactly one place: the expand. Only strips a trailing run (never a
	 * `key=value` pair in the middle of a sentence, which is not this
	 * shape), and only when something is left afterward — a line that is
	 * NOTHING BUT pairs stays as-is rather than vanishing to an empty row.
	 */
	const TRAILING_LOGFMT_TAIL_RE = /(?:\s\|\s[a-zA-Z_][\w.]*=(?:"[^"]*"|\S+))+$/;
	export function messageHeadline(message: string): string {
		const stripped = message.replace(TRAILING_LOGFMT_TAIL_RE, '');
		return stripped.length > 0 ? stripped : message;
	}

	/**
	 * ⭐ AN ACCESS-LOG LINE IS STRUCTURED TOO (LOGOPEN, AD round 5, item 6:
	 * "status and latency parsed as fields on the calm request lines").
	 * `GET /checkout/session 200 14ms` carries four facts an operator
	 * filters by in their head (method, path, status, latency); the expand
	 * names them instead of leaving them inside a sentence. Matched only
	 * as `METHOD /path NNN <n>ms|s`, so prose that merely mentions a verb
	 * never qualifies.
	 */
	const HTTP_ACCESS_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)\s+([1-5]\d\d)\s+(\d+(?:\.\d+)?(?:ms|s))\b/;
	function parseAccessFields(line: string): StructuredField[] {
		const m = line.match(HTTP_ACCESS_RE);
		if (!m) return [];
		return [
			{ key: 'method', value: m[1] },
			{ key: 'path', value: m[2] },
			{ key: 'status', value: m[3] },
			{ key: 'latency', value: m[4] }
		];
	}

	export function parseStructuredFields(line: string): StructuredField[] | null {
		const access = parseAccessFields(line);
		// A value may be quoted, or carry a parenthesised note with spaces in
		// it (`disk=ok(74% free)`), or be a bare token.
		const pairs = [...line.matchAll(/([a-zA-Z_][\w.]*)=("[^"]*"|[^\s(]*\([^)]*\)|\S+)/g)];
		if (access.length > 0) {
			return [
				...access,
				...pairs.map((m) => ({ key: m[1], value: m[2].replace(/^"|"$/g, '') }))
			];
		}
		// Greedy to the LAST `}` on the line, not the first balanced-looking
		// pair — a non-nested match (`/\{[^{}]*\}/`) finds the INNERMOST
		// object in a nested payload (`{"event":…,"meta":{"source":"web"}}`
		// would match only `{"source":"web"}`), which is a real shape the
		// mock's own "Processing webhook payload" line produces.
		const jsonMatch = line.match(/\{.*\}/);
		if (jsonMatch) {
			try {
				const obj = JSON.parse(jsonMatch[0]);
				if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
					const fields = Object.entries(obj).map(([key, value]) => ({
						key,
						value: typeof value === 'string' ? value : JSON.stringify(value)
					}));
					if (fields.length > 0) return fields;
				}
			} catch {
				// Not valid JSON — fall through to the logfmt attempt below.
			}
		}
		if (pairs.length >= 2) {
			return pairs.map((m) => ({ key: m[1], value: m[2].replace(/^"|"$/g, '') }));
		}
		return null;
	}

	/** A structured field's VALUE ink — danger only for an HTTP-status-
	 *  shaped key whose number is ≥ 500, the one number in a log line that
	 *  needs a person; every other field is plain content ink. */
	export function structuredFieldTone(field: StructuredField): 'danger' | null {
		if (!/status|code/i.test(field.key)) return null;
		const n = Number(field.value);
		return Number.isFinite(n) && n >= 500 ? 'danger' : null;
	}

	/**
	 * ⭐ POD AND CONTAINER, IN THE EXPAND TOO (logs round 9, item 3: "Add pod
	 * and container to the fields"). The collapsed row's own Pod column is
	 * hidden entirely in `singlePodMode` (one pod in view: nothing to
	 * distinguish — see that column's own comment), and the container
	 * never gets a column at all, so the expand is the only place either
	 * one is guaranteed readable. Prepended, not appended — "where did this
	 * line come from" reads before "what did it say", same order Railway's
	 * own expand uses. Takes the line's structured fields (already parsed,
	 * never re-derived) rather than re-parsing — one parse, one place.
	 */
	export function withSourceFields(
		log: { pod: string; container: string },
		fields: StructuredField[]
	): StructuredField[] {
		return [{ key: 'pod', value: log.pod }, { key: 'container', value: log.container }, ...fields];
	}

	/**
	 * ⭐ THE LEVEL COLUMN (squad-rollout coordinator review, 2026-10-09:
	 * "the message repeats the timestamp and level… lift the level into
	 * its own column. The message column then starts with the words").
	 * This mock's own lines (and most real structured-logging output)
	 * already carry an ISO-8601 timestamp and a level word at the front of
	 * the raw text — this file already has a SEPARATE timestamp column
	 * reading `timestamp`/`formattedTimestamp` off the wire, so printing
	 * that same instant again, spelled out in full ISO inside the message
	 * too, repeated it at both ends of the same row. Strips a leading
	 * ISO timestamp, then a leading level word, and returns whatever is
	 * left as the message a reader actually came to read. `level` is
	 * `null` (and `message` the ORIGINAL, unstripped line) for anything
	 * that doesn't start this way — a prose line with no machine-written
	 * preamble is shown exactly as it arrived, not guessed at.
	 *
	 * Deliberately narrower than `getLogLevel` (which also scans for the
	 * word ANYWHERE in the line, for filtering purposes): this is a
	 * front-anchored parse because the display column it feeds only makes
	 * sense for a level that is genuinely the start of the line, not one
	 * mentioned in passing ("retrying after an ERROR" should not grow an
	 * ERROR badge and lose its own leading words). logfmt's `level=` /
	 * `ts=` spelling is a known gap — none of this product's own mock or
	 * live log lines use it today; the two regexes below are where it
	 * would be added.
	 */
	export interface ParsedLogLine {
		level: 'error' | 'warn' | 'info' | 'debug' | null;
		message: string;
	}

	const LEADING_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s+/;
	const LEADING_LEVEL_RE = /^(ERROR|FATAL|CRITICAL|WARNING|WARN|DEBUG|TRACE|INFO)\b[:\s]*/i;

	export function stripLogLinePrefix(line: string): ParsedLogLine {
		const afterTs = line.replace(LEADING_TIMESTAMP_RE, '');
		const levelMatch = afterTs.match(LEADING_LEVEL_RE);
		if (!levelMatch) return { level: null, message: line };
		const word = levelMatch[1].toUpperCase();
		const level: ParsedLogLine['level'] =
			word === 'ERROR' || word === 'FATAL' || word === 'CRITICAL'
				? 'error'
				: word === 'WARN' || word === 'WARNING'
					? 'warn'
					: word === 'DEBUG' || word === 'TRACE'
						? 'debug'
						: 'info';
		return { level, message: afterTs.slice(levelMatch[0].length) };
	}
</script>

<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import {
		CloseOutline,
		TerminalOutline,
		FlaskOutline,
		ChevronDoubleDownOutline,
		ArrowUpOutline,
		ChevronRightOutline,
		ColumnOutline,
		AlignJustifyOutline,
		RefreshOutline,
		SearchOutline
	} from 'flowbite-svelte-icons';
	import { createVirtualizer, notUndefined } from '@tanstack/svelte-virtual';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	// `PodInfo` comes from the module script above — shared module context,
	// re-importing it here collides as a duplicate identifier under svelte-check.
	import type { LogLine } from '$lib/api/logs';
	import { logsStreamQueryOptions } from '$lib/api/logs';
	import { rolloutTestsQueryOptions } from '$lib/api/rollouts';
	import {
		formatTimeAgo,
		formatTimeAgoCompact,
		hasFailedBakeStatus,
		hasUnblockFailedAnnotation
	} from '$lib/utils';
	import { now } from '$lib/stores/time';
	import Card from '$lib/components/Card.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import StatusSpinner from '$lib/components/StatusSpinner.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import FactList from '$lib/components/FactList.svelte';
	import LogHistogram, { type HistogramEntry } from '$lib/components/LogHistogram.svelte';
	import type { Rollout } from '../../types';
	import { releaseSourceImage } from '$lib/releases/registry.svelte';

	interface Props {
		namespace: string;
		name: string;
		filterType?: 'pod' | 'test' | '';
		cluster?: string;
		/**
		 * ⭐ THE Pods/Tests SWITCH IS DRAWN INSIDE THIS COMPONENT NOW
		 * (2026-10-08, TL review round 2: "make it part of the Card"). It
		 * used to float, unlabelled, above a Card it had no visual
		 * relationship to — one page, two objects. `+page.svelte` owns the
		 * state and hands down `onSelectView`; `filterType` is a plain
		 * reactive prop on a SINGLE persistent instance (round 3 — no
		 * remount on a switch, which is what used to drop keyboard focus to
		 * `<body>`; this file resets its own per-stream state on a genuine
		 * `filterType` change instead, see `resetStreamState`/
		 * `lastFilterType`). The control itself renders in the toolbar as a
		 * `btn-ghost btn-xs` `aria-pressed` pair (round 4 — a Card header is
		 * 47px everywhere else in the product, and even a shrunk control
		 * pushed this one to 53-77px; see the toolbar's own comment).
		 * "Current" is simply whichever `filterType` THIS instance currently
		 * holds — no second source of truth to keep in sync with the prop.
		 */
		onSelectView?: (view: 'pod' | 'test') => void;
		/**
		 * ⭐ THE HEADER META'S "N pods" FACT (SPEC.md §2: "1 pod · 4.42.0-42
		 * · since 3m ago"). `+page.svelte` owns the `RolloutTabHeader`'s
		 * `meta` snippet, but the pod count only exists in here — it is
		 * `effectivePodCount`, derived from the SAME filterType-scoped
		 * stream the Sources pane reads, so the page head and the pane
		 * itself can never disagree about how many pods are in view.
		 * Called from a plain `$effect`, not passed as a getter, because
		 * `+page.svelte` needs a plain number to interpolate into a
		 * sentence, not a reactive function to re-derive from.
		 */
		onPodCount?: (count: number) => void;
		/**
		 * ⭐ THE SOURCES PANE'S "This build" FACTS (art director round 1,
		 * must-fix #6, 2026-10-09 re-review: "under the pod list, add a
		 * 'This build' FactList"). `+page.svelte` already fetches this for
		 * `RolloutTabHeader`'s own build/state pill — threaded straight
		 * through rather than a second query for data this component's own
		 * page already holds. Optional, and the facts block renders nothing
		 * at all without it (a transitional state during the first paint,
		 * not a page this component owns the loading of).
		 */
		rollout?: Rollout | null;
	}

	let {
		namespace,
		name,
		filterType = '',
		cluster,
		onSelectView,
		onPodCount,
		rollout
	}: Props = $props();

	let selectedPod = $state<string | null>(null);
	let searchQuery = $state('');

	/**
	 * ⭐ THE COLUMNS POPOVER. (2026-10-08, TL review round 2; keyboard/focus
	 * fixed round 3) Visibility is a view SETTING, not a filter — it moved
	 * out of the pill row (see the toolbar's own comment). Closes on an
	 * outside click, on Escape (returning focus to the trigger — a reader
	 * who opened it by keyboard must land back where they started, not in
	 * the void), or on Tab carrying focus outside the panel (checked via
	 * `focusout` + a microtask, since the newly-focused element is not yet
	 * `document.activeElement` at the moment the event fires).
	 */
	let columnsMenuOpen = $state(false);
	let columnsMenuRoot = $state<HTMLElement | undefined>(undefined);

	/** ⭐ THE PHONE "Filters" SHEET BUTTON'S OWN STATE (art director round
	 *  1, must-fix #5: "one 44px control row (search plus a filter-sheet
	 *  button showing the active-level count)"). Reveals the SAME pill
	 *  row desktop already has below `sm` ("a single pill row with a
	 *  fade" — the coordinator's own call between the two options the AD
	 *  offered) rather than a second filter mechanism; closed by default
	 *  so the one control row the AD's spec asks for is genuinely one row
	 *  until a reader asks for more. */
	let mobileFiltersOpen = $state(false);
	let columnsMenuTriggerEl = $state<HTMLButtonElement | undefined>(undefined);

	function closeColumnsMenu(opts: { refocusTrigger?: boolean } = {}) {
		if (!columnsMenuOpen) return;
		columnsMenuOpen = false;
		if (opts.refocusTrigger) columnsMenuTriggerEl?.focus();
	}

	/**
	 * ⭐ THE STRUCTURED-LINE EXPAND, IN PLACE NOW (art director round 1,
	 * must-fix #3: "Railway's model: expand in place under the line…
	 * Nothing renders outside the card"). Was an anchored popover — this
	 * file's own `ROW_HEIGHT` used to be a flat, ungrown constant precisely
	 * to dodge giving the virtualizer a variable-height row. That
	 * constraint is gone now: `displayRows` (below) is the virtualizer's
	 * real item list, and a detail row is a genuine ENTRY in it with its
	 * own exact, computed height (`detailRowHeight`) — not a row that
	 * grows, a second row that gets inserted next to the first. One
	 * expanded line at a time (clicking a second trigger replaces the
	 * first); clicking the same trigger again collapses it.
	 *
	 * ⛔ DOES NOT CLOSE ON SCROLL ANY MORE (caught live, not by reading the
	 * code: `handleScroll` used to null this out on every real scroll —
	 * correct for the OLD popover, anchored to a screen position that a
	 * scroll would move it out from under, and actively wrong for a real
	 * row that now scrolls WITH the content it belongs to. Left in place,
	 * it closed the panel within one streamed line of opening it on any
	 * page with Follow on, which is the default — a click that visibly
	 * did nothing.
	 */
	// ⭐ `$state.raw`, NOT `$state` (caught live, not by reading the code:
	// `$state` deep-proxies an assigned object, and a re-read of
	// `expandedLineRef` then returns THAT PROXY — a different identity
	// than the plain `LogLine` objects `allLogLines`/`displayRows` hold,
	// so `log.raw === expandedLineRef` was false FOR EVERY ROW, always,
	// silently (Svelte's own dev-mode `state_proxy_equality_mismatch`
	// warning is what surfaced it). `$state.raw` skips that proxying —
	// reassigning the variable is still reactive, the VALUE itself is
	// held as-is, so identity comparison against the un-proxied objects
	// in the log buffer works the way this file's whole expand/collapse
	// model depends on.
	let expandedLineRef = $state.raw<LogLine | null>(null);

	function toggleLineExpand(logItem: { raw: LogLine }) {
		const opening = expandedLineRef !== logItem.raw;
		expandedLineRef = opening ? logItem.raw : null;
		if (isPhone) return;
		if (!opening) {
			void tick().then(() => requestAnimationFrame(updateDetailZone));
			return;
		}
		// LOGOPEN round 7, item 1: reading a line pauses Follow (the next
		// live line would otherwise move it from under the pointer), and if
		// its detail opens past the well's bottom edge (always, for the
		// NEWEST line) the well scrolls just enough to show all of it. The
		// ↓ that pausing brings stays hidden while the detail fills the
		// bottom zone (`detailInBottomZone`).
		autoScroll = false;
		void revealOpenDetail();
	}

	async function revealOpenDetail() {
		await tick();
		// Refresh the virtualizer's range first: until it hears a scroll,
		// its total size (the spacer under the rows) still excludes the new
		// detail, and a scrollTop set now would clamp at the OLD bottom.
		virtualListEl?.dispatchEvent(new Event('scroll'));
		await tick();
		requestAnimationFrame(() => {
			const well = virtualListEl;
			const i = displayRows.findIndex((r) => r.kind === 'detail');
			if (!well || i < 1) return;
			const detail = displayRows[i];
			if (detail.kind !== 'detail') return;
			// Arithmetic, not a DOM read: every log row is ROW_HEIGHT and the
			// detail's height is exact, and a detail opened past the bottom is
			// not rendered yet (the virtualizer only renders what is in range).
			const lineTop = (i - 1) * ROW_HEIGHT;
			const detailEnd = i * ROW_HEIGHT + detailRowHeight(detail.fields.length, detail.messageLines);
			const viewEnd = well.scrollTop + well.clientHeight;
			if (detailEnd > viewEnd) {
				isAutoScrolling = true;
				well.scrollTop = Math.min(detailEnd - well.clientHeight, lineTop);
				well.dispatchEvent(new Event('scroll'));
				requestAnimationFrame(() => requestAnimationFrame(() => (isAutoScrolling = false)));
			}
			requestAnimationFrame(updateDetailZone);
		});
	}

	/** ↓ stays clear of an open detail (round 7, item 1): hidden while the
	 *  detail occupies the well's bottom 56px, where the control floats. */
	let detailInBottomZone = $state(false);
	function updateDetailZone() {
		const well = virtualListEl;
		const detail = well?.querySelector('[data-detail-row]') as HTMLElement | null;
		if (!well || !detail) {
			detailInBottomZone = false;
			return;
		}
		const w = well.getBoundingClientRect();
		const d = detail.getBoundingClientRect();
		detailInBottomZone = d.top < w.bottom && d.bottom > w.bottom - 56;
	}

	/**
	 * ⭐ "Show in context" ON EVERY LINE (LOGOPEN, item 6: "the same
	 * actions on every line"). It used to exist only while a filter was
	 * on, so a calm line's expand had one action and an incident line's
	 * had two. It means the same thing everywhere now: this line, among
	 * its neighbours, Follow paused, the line kept open. With a filter on
	 * that first clears it; unfiltered it just centres the line. The
	 * filter-change re-anchor (`filterSignature`) checks `contextTarget`
	 * so it centres this line instead of jumping to the newest.
	 */
	let contextTarget: LogLine | null = null;
	function showInContext(logItem: { raw: LogLine }) {
		contextTarget = logItem.raw;
		expandedLineRef = logItem.raw;
		autoScroll = false;
		if (hasFilters) clearFilters();
		else void revealContextTarget();
	}
	async function revealContextTarget() {
		const target = contextTarget;
		contextTarget = null;
		if (!target) return;
		await tick();
		if (isPhone) {
			const i = phoneRows.findIndex((l) => l.raw === target);
			if (i >= phoneLimit) {
				phoneLimit = Math.ceil((i + 1) / PHONE_PAGE) * PHONE_PAGE;
				await tick();
			}
			const row = phoneListEl?.querySelectorAll('[data-phone-row]')[i];
			row?.scrollIntoView({ block: 'center' });
			return;
		}
		const i = displayRows.findIndex((r) => r.kind === 'log' && r.log.raw === target);
		if (i < 0) return;
		isAutoScrolling = true;
		$virtualizer.scrollToIndex(i, { align: 'center' });
		requestAnimationFrame(() => requestAnimationFrame(() => (isAutoScrolling = false)));
	}

	/* A reconnect delivers the backlog again as NEW objects; the open line is
	   matched by identity everywhere, so re-find it by content and keep it
	   open (LOGOPEN r8: a reconnect closed the line being read). */
	$effect(() => {
		const ref = expandedLineRef;
		const list = logs;
		if (!ref || list.length === 0 || list.includes(ref)) return;
		// A frozen phone list still holds the old objects, so it still matches.
		if (untrack(() => isPhone && phoneSnapshot !== null)) return;
		const same = list.find(
			(l) => l.pod === ref.pod && l.timestamp === ref.timestamp && l.line === ref.line
		);
		if (same) untrack(() => (expandedLineRef = same));
	});

	/** The whole row toggles (LOGOPEN, item 6), but a drag that selected
	 *  text is a copy, not a click. */
	function onRowClick(logItem: { raw: LogLine }) {
		const sel = typeof window !== 'undefined' ? window.getSelection()?.toString() : '';
		if (sel) return;
		toggleLineExpand(logItem);
	}

	/**
	 * ⭐ THE EXPAND'S INDENT, MEASURED — NOT A MAGIC NUMBER (logs round 9,
	 * item 3: "the expand body aligns to the message column's x, compute it
	 * from the row's grid column"). `ml-[4.25rem]`/`sm:ml-[5.25rem]` was a
	 * GUESS at "Timestamp + Level + Pod column widths", and a guess is
	 * wrong the moment any of those is not there: the Columns menu can hide
	 * Timestamp or Pod, `singlePodMode` drops the Pod cell to a bare dot or
	 * nothing at all, and the UTC/Local toggle changes the Timestamp text's
	 * own width — every one of those shifts the real message column left
	 * or right while this constant stayed put. The row itself already
	 * carries `relative` (its hover/level-rule positioning context), which
	 * makes `offsetLeft` on its own `[data-role="log-message"]` child
	 * exactly "how far from this row's own padding edge to where the
	 * message starts", with whatever combination of columns is actually
	 * rendered right now already baked in — no separate arithmetic to keep
	 * in sync with the row template ever again.
	 */
	let messageColumnOffsetPx = $state(68);
	function measureMessageColumnOffset() {
		if (!virtualListEl) return;
		const msgEl = virtualListEl.querySelector('[data-role="log-message"]') as HTMLElement | null;
		if (!msgEl) return;
		messageColumnOffsetPx = msgEl.offsetLeft;
	}
	$effect(() => {
		// Read, not used — re-measure whenever anything that can move the
		// message column changes, not only once at mount.
		void visibleColumns;
		void singlePodMode;
		void selectedPods;
		void isPhone;
		void allLogLines.length;
		tick().then(() => requestAnimationFrame(measureMessageColumnOffset));
	});

	/** The detail row's own "Copy line" footer action — a one-off write,
	 *  not `CopyButton` (which owns its own "Copied"/"Couldn't copy"
	 *  label swap this plain text link has no room for at 24px). Errors
	 *  are swallowed the same way `CopyButton` treats a denied clipboard:
	 *  quietly, since there is nothing actionable to tell the reader
	 *  beyond "nothing happened." */
	function copyTextToClipboard(text: string) {
		navigator.clipboard?.writeText(text).catch(() => {});
	}

	function onColumnsPanelFocusOut() {
		// The element Tab is MOVING TO is not committed as `activeElement`
		// until after this event finishes dispatching — deferring one
		// microtask is what lets this check the real post-Tab focus target
		// instead of the one Tab is leaving.
		//
		// ⛔ `document.body` IS NOT A REAL DESTINATION. A momentary
		// `activeElement === document.body` reading between two focus
		// targets inside the SAME panel (observed with synthetic click
		// sequences; two real clicks on sibling checkboxes closed the panel
		// after the first one, every time) is the browser between-focus
		// state, not a reader tabbing away — treating it as "left the
		// panel" closed the menu out from under a reader toggling a second
		// checkbox. A genuine Tab-out lands on a concrete element, not
		// nothing, so only a confirmed non-body target outside the panel
		// counts as "left".
		queueMicrotask(() => {
			const active = document.activeElement;
			if (!active || active === document.body) return;
			if (columnsMenuRoot && !columnsMenuRoot.contains(active)) {
				columnsMenuOpen = false;
			}
		});
	}

	$effect(() => {
		if (!columnsMenuOpen || typeof document === 'undefined') return;
		function onDocPointerDown(e: PointerEvent) {
			if (columnsMenuRoot && !columnsMenuRoot.contains(e.target as Node)) {
				columnsMenuOpen = false;
			}
		}
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') closeColumnsMenu({ refocusTrigger: true });
		}
		document.addEventListener('pointerdown', onDocPointerDown);
		document.addEventListener('keydown', onKeydown);
		return () => {
			document.removeEventListener('pointerdown', onDocPointerDown);
			document.removeEventListener('keydown', onKeydown);
		};
	});

	// ⭐ Escape collapses the expanded detail row — in-flow now (it is a
	// real row, not a floating panel), so there is no "outside click"
	// to detect any more; a click on any OTHER trigger already replaces
	// it (`toggleLineExpand`), and a click on empty space means nothing
	// special for a row that scrolls with the rest of the list.
	$effect(() => {
		if (!expandedLineRef || typeof document === 'undefined') return;
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') expandedLineRef = null;
		}
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});

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

	/**
	 * ⭐ THE HISTOGRAM'S OWN TIME-RANGE FILTER (art director round 2,
	 * must-fix #1: "Click or drag selects a time window: draw the
	 * selection band, filter the stream to it, and show a 'Clear' chip.
	 * Today a click pauses the stream with no visible effect; never do
	 * that"). A click used to call `jumpToHistogramBucket`, which only
	 * scrolled the well and turned Follow off — a reader who did not
	 * notice the scroll saw literally nothing happen. This is a REAL
	 * filter now, the same kind `selectedLogLevels` already is: it
	 * narrows `nonSearchFilteredLogs` (see that derived's own site below)
	 * rather than being read only by the histogram that produced it.
	 * `$state.raw` — it is a plain `{start,end}` record, never mutated in
	 * place, only ever replaced wholesale.
	 */
	let timeRangeFilter = $state.raw<{ start: number; end: number } | null>(null);

	/* The window-empty copy lives on `windowEmpty` (LOGOPEN, item 5). */

	// ⭐ CONTAINER COLUMN DROPPED (art director round 2, must-fix: "drop the
	// grey-dot CONTAINER column"). A column that only ever printed "app"
	// or "test-runner" next to the Pod column's own neutral dot read, at a
	// glance, as the dot belonging to Container rather than Pod — and
	// said little a reader could not already tell from which pod/source
	// they had selected. The toolbar's own container PILL filter was
	// already dropped for the same reason (logs round 3, must-fix #7);
	// this is the column half of that same call, and `selectedContainers`
	// stays as dead-but-harmless filter state (nothing sets it any more).
	type LogColumn = 'timestamp' | 'pod' | 'message';
	let visibleColumns = $state<Set<LogColumn>>(new Set(['timestamp', 'pod', 'message']));
	const allColumns: { value: LogColumn; label: string }[] = [
		{ value: 'timestamp', label: 'Timestamp' },
		{ value: 'pod', label: 'Pod' },
		{ value: 'message', label: 'Message' }
	];

	/** ⭐ `startedAt` IS STAMPED ON ARRIVAL (LOGOPEN, AD round 5, item 7:
	 *  "pod ages tick with the header"). The wire carries `ageSeconds`, a
	 *  snapshot; rendering `now - ageSeconds` against a ticking `$now`
	 *  froze the age at whatever the first event said. A start instant
	 *  (`arrival - ageSeconds`) ages with the same clock the header's
	 *  "since 4m ago" reads. */
	let discoveredPods = $state<(PodInfo & { startedAt?: number })[]>([]);
	const discoveredPodNames = new Set<string>();

	function addDiscoveredPod(pod: PodInfo) {
		if (!discoveredPodNames.has(pod.name)) {
			discoveredPodNames.add(pod.name);
			discoveredPods.push({
				...pod,
				startedAt: pod.ageSeconds != null ? Date.now() - pod.ageSeconds * 1000 : undefined
			});
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

	/**
	 * ⭐ THE "CLEAN SLATE" RESET, NOW SHARED BY MOUNT *AND* A VIEW SWITCH.
	 * (2026-10-08, TL review round 3) Pods↔Tests used to be a full
	 * component REMOUNT (`+page.svelte`'s own `{#if}`/`{:else}` swapping
	 * which `LogsViewer` instance was in the tree), which is what this
	 * reset originally rode in on. The remount is gone now — switching
	 * keeps the SAME instance and SAME DOM, so a reader's keyboard focus on
	 * the view switch never drops to `<body>` the way it did when the
	 * control itself was destroyed and recreated. The reset still has to
	 * happen on a genuine switch, just explicitly: this is every piece of
	 * per-STREAM state (not per-session preferences — `autoScroll` and
	 * `wrapLines` deliberately survive a switch, same as a reader's `Wrap`
	 * choice already survived a resize).
	 */
	/**
	 * ⭐ HIDDEN UNTIL SETTLED, NOT SCROLLED-THEN-CORRECTED (logs round 9,
	 * squad-rollout lead: "don't rewrite the virtualizer… keep the well at
	 * `visibility: hidden`… until the first scrollToBottom has settled,
	 * then reveal it… guard it with a timeout"). The underlying bug this
	 * works around — a real backlog streams in as several batches, each
	 * one re-triggering `scrollToBottom()`, and `scrollTop` only converges
	 * on the true bottom after several of those cycles (measured, a
	 * sibling comment on `pendingRescroll` below: "sat 40,781px short at
	 * 500ms, converged by ~2s") — is a years-deep, heavily-commented
	 * catch-up loop this round does not touch; hiding the RESULT until it
	 * is done is a presentation fix, not a correctness one. Reset on every
	 * `resetStreamState()` call (a fresh stream, a Pods<->Tests switch)
	 * since each one restarts its own catch-up race. `wellRevealTimeout`
	 * is the guard: if nothing ever settles (an empty view, a connection
	 * that never resolves), the well is shown anyway after 2s rather than
	 * staying hidden forever.
	 */
	let wellRevealed = $state(false);
	let wellRevealTimeout: ReturnType<typeof setTimeout> | null = null;
	function armWellReveal() {
		wellRevealed = false;
		if (wellRevealTimeout) clearTimeout(wellRevealTimeout);
		wellRevealTimeout = setTimeout(() => {
			wellRevealed = true;
		}, 2000);
	}

	function resetStreamState() {
		queryClient.setQueryData(logsQueryOptions.queryKey, []);
		discoveredPods = [];
		discoveredPodNames.clear();
		podsEventReceived = false;
		selectedPods = new Set();
		selectedContainers = new Set();
		selectedLogLevels = new Set();
		searchQuery = '';
		previousLogCount = 0;
		previousLastTimestamp = null;
		previousRawLogCount = 0;
		justArrivedRefs = new Set();
		savedScrollTop = 0;
		appliedFailedErrorDefault = false;
		// A fresh stream opens at its newest line, whatever Follow was
		// doing on the view before it (LOGOPEN, item 1).
		autoScroll = true;
		anchorRequested = true;
		armWellReveal();
	}

	// Reset logs state when component mounts (navigating to logs page)
	onMount(() => {
		resetStreamState();

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
	 * ⭐ THE RESET ON A GENUINE VIEW SWITCH (not the first render). Tracks
	 * `filterType` and fires `resetStreamState()` only when it actually
	 * CHANGES from a previously-seen value — `lastFilterType` starts
	 * `undefined`, so the effect's first run (mount) only records the
	 * initial value and does not double-reset on top of `onMount`'s own
	 * call above.
	 */
	let lastFilterType: string | undefined;
	$effect(() => {
		const ft = filterType;
		if (lastFilterType !== undefined && lastFilterType !== ft) {
			resetStreamState();
		}
		lastFilterType = ft;
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
	 * on the wire.
	 *
	 * ⭐ NO LONGER GATED ON `filterType === 'test'` (SPEC.md §2, Sources
	 * pane). It is a plain REST query, not the filterType-scoped SSE
	 * connection — unlike `discoveredPods`, it can stay populated on the
	 * Pods view too, which is what lets the sidebar's "Tests" section show
	 * real rows while a reader is looking at pod output.
	 */
	const rolloutTestsQuery = createQuery(() => rolloutTestsQueryOptions({ namespace, name, cluster }));

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
				if (!finishedAt || isLater(c.lastTransitionTime, finishedAt)) finishedAt = c.lastTransitionTime;
			}
			if (!finishedAt) continue;
			if (!best || finishedAt > best.finishedAt) {
				best = { name: item.status?.jobName || item.metadata?.name || 'test', finishedAt };
			}
		}
		return best;
	});

	/**
	 * ⭐ THE SOURCES PANE'S "Tests" SECTION (SPEC.md §2). One row per
	 * `RolloutTest`, newest first; `ageLabel` reads the same
	 * `formatTimeAgo`/`$now` idiom every other relative time in the product
	 * uses, off the run's own last transition (finished) or, for one still
	 * in flight, off nothing — "running" rather than a fabricated age.
	 */
	const testRuns = $derived.by(
		(): { key: string; name: string; phase: string; ageLabel: string }[] => {
			const items = rolloutTestsQuery.data?.rolloutTests?.items ?? [];
			return items
				.map((item) => {
					const phase = item.status?.phase ?? 'Unknown';
					const conditions = item.status?.conditions ?? [];
					let finishedAt: string | null = null;
					for (const c of conditions) {
						if (!finishedAt || isLater(c.lastTransitionTime, finishedAt)) finishedAt = c.lastTransitionTime;
					}
					return {
						key: item.metadata?.name || item.status?.jobName || 'test',
						name: item.status?.jobName || item.metadata?.name || 'test',
						phase,
						ageLabel: finishedAt ? formatTimeAgoCompact(finishedAt, $now) : 'now',
						sortKey: finishedAt ?? ''
					};
				})
				.sort((a, b) => newestFirst(a.sortKey, b.sortKey));
		}
	);

	/**
	 * ⭐ THE SOURCES PANE'S "Pods" SECTION (SPEC.md §2) — see the `<aside>`
	 * markup's own doc comment for why this can go quiet while the Tests
	 * view is the one actually streaming.
	 */
	const podSidebarRows = $derived(
		[...discoveredPods]
			.filter((p) => p.type === 'pod' || !p.type)
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	/**
	 * ⭐ "This build" — THE SOURCES PANE'S OWN FACTS BLOCK (art director
	 * round 1, must-fix #6, 2026-10-09 re-review). `image` is the registry
	 * path of the rollout's ReleaseSource (`spec.oci.image`) plus the
	 * running build's own tag — honest about what is
	 * actually on the wire rather than inventing a field. `started` reads
	 * the SAME `bakeStartTime`/`timestamp` fallback `+page.svelte`'s own
	 * header meta already uses, in the SAME `formatTimeAgoCompact` format
	 * (art director must-fix #10). `replicas ready N/M` is DELIBERATELY
	 * OMITTED — this component has no managed-resources query (that is
	 * the Overview tab's own fetch), and the coordinator's own brief says
	 * to omit the row rather than invent a number this page cannot back
	 * up.
	 */
	const buildFacts = $derived.by((): { label: string; value: string; handle?: boolean }[] => {
		if (!rollout) return [];
		const latest = rollout.status?.history?.[0];
		const facts: { label: string; value: string; handle?: boolean }[] = [];
		const image = releaseSourceImage(rollout);
		const tag = latest?.version?.tag;
		if (image) {
			facts.push({ label: 'Image', value: tag ? `${image}:${tag}` : image, handle: true });
		}
		const since = latest?.bakeStartTime || latest?.timestamp;
		if (since) {
			facts.push({ label: 'Started', value: `${formatTimeAgoCompact(since, $now)} ago` });
		}
		return facts;
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
	const queryError = $derived(
		logsQuery.isError ? (logsQuery.error as Error)?.message || 'Unknown error' : null
	);

	/**
	 * ⭐ "CONNECTING" IS A BOUNDED WAIT, NOT A PROMISE (U-14, 2026-10-08).
	 *
	 * A stream that never opens — no `pods` event, no `log` event, and no
	 * `logsQuery.isError` either, because nothing ever failed, it simply
	 * never arrived — used to leave `isConnecting` true forever: a spinner
	 * and a big "0" with no way out and no reason given. `rawConnecting`
	 * mirrors exactly what `connectionState` below used to call
	 * "connecting"; once it has been true, uninterrupted, for
	 * `CONNECT_TIMEOUT_MS`, that is itself the answer — the connection did
	 * not open — and folds into `error` so every reader of `connectionState`
	 * (header, summary, footer) gets the SAME resolved state the rest of
	 * this file already guarantees they agree on.
	 */
	const rawConnecting = $derived(isLoading && logs.length === 0 && !podsEventReceived);
	const CONNECT_TIMEOUT_MS = 15_000;
	let connectTimedOut = $state(false);
	$effect(() => {
		if (!rawConnecting) {
			connectTimedOut = false;
			return;
		}
		const timer = setTimeout(() => {
			connectTimedOut = true;
		}, CONNECT_TIMEOUT_MS);
		return () => clearTimeout(timer);
	});
	const error = $derived(
		queryError ??
			(connectTimedOut
				? 'No response from the pod log stream after 15s — it may be unavailable.'
				: null)
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

	/**
	 * ⭐ NEVER CLAIM "NOTHING" BEFORE THE FIRST BATCH (LOGOPEN, AD round
	 * 5, item 2: "'No log lines yet: 3 pods have written nothing' for
	 * ~250ms on every load"). The stream sends its `pods` snapshot first
	 * and the backlog after it, so "the stream is open and no line has
	 * arrived" is true for a moment on EVERY load, not only for pods that
	 * are genuinely quiet. Quiet is only a fact once the stream has been
	 * open for `QUIET_GRACE_MS` with no line; until then the console holds
	 * its loaded-shape placeholder (`awaitingFirstBatch`), the same one
	 * "connecting" shows, so the reader sees one waiting state, not a
	 * claim followed by a retraction.
	 */
	const QUIET_GRACE_MS = 1500;
	let quietConfirmed = $state(false);
	$effect(() => {
		if (!podsEventReceived || logs.length > 0) {
			quietConfirmed = false;
			return;
		}
		const timer = setTimeout(() => (quietConfirmed = true), QUIET_GRACE_MS);
		return () => clearTimeout(timer);
	});
	const awaitingFirstBatch = $derived(
		!error && logs.length === 0 && (isConnecting || (isStreaming && !quietConfirmed))
	);

	/** The Level column's own display word — a literal, not a CSS
	 *  `uppercase` transform (principle 6: uppercase is for `t-label`
	 *  chips/eyebrows/table heads only; a `text-code-sm` DATA cell earns
	 *  its case from its own content, same as a sha is never
	 *  `text-transform`ed into caps). */
	const LEVEL_WORD: Record<string, string> = {
		error: 'ERROR',
		warn: 'WARN',
		info: 'INFO',
		debug: 'DEBUG'
	};

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
	/**
	 * ⭐ THE LEVEL PILLS' OWN COUNTS (SPEC.md §2: "a trailing count; zero-
	 * count levels are disabled, not hidden"). Reads `logs`, the same
	 * unfiltered-for-this-view buffer `errorCount` below reads, for the
	 * same reason — the pill states what is IN the buffer, not what a
	 * sibling filter happens to be letting through right now.
	 */
	const levelCounts = $derived.by((): Record<'error' | 'warn' | 'info' | 'debug', number> => {
		const counts = { error: 0, warn: 0, info: 0, debug: 0 };
		for (const log of logs) {
			const level = getLogLevel(log.line);
			if (level) counts[level]++;
		}
		return counts;
	});

	const errorCount = $derived.by(() => {
		let count = 0;
		for (const log of logs) {
			if (getLogLevel(log.line) === 'error') count++;
		}
		return count;
	});

	/**
	 * ⭐ THE HISTOGRAM'S OWN FILTER STAGE (art director round 2, must-fix
	 * #1: "it follows the level filter — Error selected → only error
	 * bars"). Declared ahead of `histogramEntries`
	 * below, which reads it — pod/container/level filters apply
	 * before the histogram draws, but the TIME-RANGE filter the histogram
	 * itself produces applies one stage later, in `nonSearchFilteredLogs`
	 * (see that derived's own doc further down): reading from that here
	 * instead would be circular, the histogram narrowing its own source by
	 * the very range it exists to let a reader pick. It also ignores the
	 * search term for the same "the picture does not vanish out from
	 * under the click that produced it" reason the squad-rollout
	 * coordinator asked for when this derived was still just `logs`.
	 */
	const podLevelFilteredLogs = $derived(
		applyNonSearchFilters(
			logs,
			{ pods: selectedPods, containers: selectedContainers, levels: selectedLogLevels },
			getLogLevel
		)
	);

	/**
	 * ⭐ THE LOG-VOLUME HISTOGRAM'S INPUTS (designer, 2026-10-10). The
	 * picture itself, its window/bucket math, the drag and the tooltip live
	 * in `LogHistogram.svelte` (see its doc comment). This file only hands
	 * it the lines the pod/source/level filters let through, the oldest
	 * UNFILTERED timestamp (the window is chosen from what is loaded, so it
	 * does not jump when a filter changes), and what the level filter is
	 * counting.
	 */
	/* LOGOPEN r8, item 2.ii (binding): the Error filter changes the stream,
	   never the chart. The bars are total volume for the pods in view, so
	   the picture does not change shape when a level pill is pressed. */
	const podFilteredLogs = $derived(
		applyNonSearchFilters(
			logs,
			{ pods: selectedPods, containers: selectedContainers, levels: new Set() },
			getLogLevel
		)
	);
	/** The build's start, the histogram axis's left edge (r8, item 2.i). */
	const buildStartMs = $derived.by((): number | null => {
		const latest = rollout?.status?.history?.[0];
		const t = latest?.bakeStartTime || latest?.timestamp;
		const ms = t ? new Date(t).getTime() : NaN;
		return Number.isFinite(ms) ? ms : null;
	});
	const histogramEntries = $derived(
		podFilteredLogs.map(
			(l): HistogramEntry => ({ timestamp: l.timestamp ?? Date.now(), level: getLogLevel(l.line) })
		)
	);
	const histogramSpan = $derived.by((): { oldest: number | null; newest: number | null } => {
		let min = Infinity;
		let max = -Infinity;
		for (const l of logs) {
			if (!l.timestamp) continue;
			if (l.timestamp < min) min = l.timestamp;
			if (l.timestamp > max) max = l.timestamp;
		}
		return Number.isFinite(min) ? { oldest: min, newest: max } : { oldest: null, newest: null };
	});
	/** A committed window turns Follow off: a selection the live tail kept
	 *  auto-scrolling past would be the "no visible effect" the AD flagged. */
	/* LOGOPEN, item 10: a committed window opens at its NEWEST line. It
	   used to turn Follow off and leave the well wherever it was; the
	   window is a filter like any other now, so `filterSignature`
	   re-anchors it. Following a window is harmless: a line outside it
	   never enters the list. */
	function selectTimeRange(range: { start: number; end: number }) {
		timeRangeFilter = range;
	}

	function clearTimeRangeFilter() {
		timeRangeFilter = null;
	}

	const errorsFiltered = $derived(selectedLogLevels.size === 1 && selectedLogLevels.has('error'));
	function toggleErrorFilter() {
		selectedLogLevels = errorsFiltered ? new Set() : new Set(['error']);
	}

	/**
	 * ⭐ A FAILED ROLLOUT OPENS ON ITS ERRORS (logs round 9, item 2; SPEC.md
	 * §7's Logs row: "Is this build erroring right now, and where do I
	 * look?"). `hasFailedBakeStatus` minus the unblock annotation is the
	 * SAME predicate `RolloutTabHeader` already reads for its own "Roll
	 * back" action — one definition of "failed" across the tab, not a
	 * second guess at it here. Calm and healthy builds (including a
	 * failed-but-unblocked one) are untouched: they still open on all
	 * lines at the latest, same as before this round.
	 */
	const isFailedRollout = $derived(
		!!rollout && hasFailedBakeStatus(rollout) && !hasUnblockFailedAnnotation(rollout)
	);

	/**
	 * ⭐ APPLIED ONCE PER STREAM, NOT RE-ASSERTED FOREVER. Without a guard
	 * this would fight a reader who deliberately clicked "Show all lines"
	 * — every new batch landing on the SSE connection would flip the
	 * filter straight back on, since `isFailedRollout` never stops being
	 * true for a failed build. `resetStreamState` (a fresh stream, a
	 * Pods↔Tests switch) is the only thing allowed to re-arm it — a GENUINE
	 * new view, same reasoning as `wellRevealed`'s own re-arm. Gated on
	 * `errorCount > 0`: a failed rollout whose buffer has not produced an
	 * ERROR-level line yet (an early connect, or a failure that shows up as
	 * a crash loop rather than a log line) has nothing to anchor on, so it
	 * is left on "all lines" rather than silently applying an empty filter.
	 */
	/* LOGOPEN round 7, item 2: applied BEFORE the first batch, so the
	   Error pill is on from the first painted frame instead of toggling on
	   when lines land. `$effect.pre` runs ahead of the DOM update that
	   would otherwise paint "all lines" first. If the first batch then
	   holds no ERROR line at all (a crash loop, an early connect), the
	   provisional filter steps back to all lines once, rather than leaving
	   an empty filter nobody asked for. */
	let appliedFailedErrorDefault = $state(false);
	let failedDefaultChecked = false;
	$effect.pre(() => {
		if (appliedFailedErrorDefault || !isFailedRollout) return;
		appliedFailedErrorDefault = true;
		failedDefaultChecked = false;
		selectedLogLevels = new Set(['error']);
	});
	$effect.pre(() => {
		if (!appliedFailedErrorDefault || failedDefaultChecked || logs.length === 0) return;
		failedDefaultChecked = true;
		if (errorCount === 0 && errorsFiltered) untrack(() => (selectedLogLevels = new Set()));
	});

	/**
	 * ⭐ POD IDENTITY IS NEUTRAL NOW, NOT A HUE. (2026-10-08, design-language
	 * pass, TL review round 2) `iwanthue`'s palette put two pods a hue apart
	 * that happened to land ON reserved meanings — green (the product's one
	 * `success` ink) and a pink/fuchsia close enough to the prod environment
	 * identity colour to read as it. Principle 11: identity is never a
	 * status hue, full stop, and a pod is not even environment identity —
	 * it has no standing claim to a hue at all. `podNameParts` is the
	 * neutral differentiator the TL asked for in its place: the pod's own
	 * short suffix (the replica hash Kubernetes already appends) a step
	 * more present (`fg-muted`) than the rest of the name (`fg-subtle`),
	 * so two pods are still tellable apart by READING, not by colour.
	 */
	function podNameParts(name: string): { lead: string; suffix: string } {
		const idx = name.lastIndexOf('-');
		if (idx === -1) return { lead: '', suffix: name };
		return { lead: name.slice(0, idx + 1), suffix: name.slice(idx + 1) };
	}

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
			searchQuery.trim().length > 0 ||
			timeRangeFilter !== null
	);

	function clearFilters() {
		selectedPods = new Set();
		selectedContainers = new Set();
		selectedLogLevels = new Set();
		searchQuery = '';
		timeRangeFilter = null;
	}

	// The search box's own scope: every OTHER filter, but not search itself —
	// see `applyNonSearchFilters`'s doc comment in the module script above
	// for why the search result count is measured against this, not against
	// the raw unfiltered `logs`. `podLevelFilteredLogs` (declared up near
	// the histogram, which is its real reason for existing — see that
	// derived's own doc) already IS exactly this scope, so it is reused
	// here rather than recomputed.
	const nonSearchFilteredLogs = $derived.by(() => {
		// ⭐ THE HISTOGRAM'S TIME-RANGE FILTER (see `timeRangeFilter`'s own
		// doc comment) — stacked with the pod/container/level filters, same
		// as they already stack with EACH OTHER, not a special case the
		// rest of this file's filter pipeline does not know about.
		const range = timeRangeFilter;
		if (!range) return podLevelFilteredLogs;
		return podLevelFilteredLogs.filter(
			(l) => (l.timestamp ?? 0) >= range.start && (l.timestamp ?? 0) <= range.end
		);
	});

	// Filter logs by selected pods, containers, log levels, time range and search query
	const filteredLogs = $derived(applySearchFilter(nonSearchFilteredLogs, searchQuery));

	/**
	 * ⭐ THE SEARCH BOX'S OWN RESULT COUNT. (2026-09-12, L5 "the log viewer
	 * survives a 60fps capture") A typed search term used to change what
	 * rendered with no number anywhere confirming it — a reader had to count
	 * rows themselves. `null` (not "0 of 0 lines") while the box is empty: an
	 * untyped search has no result to report, the same convention
	 * `lineFreshnessLabel` above already uses ("no fact yet" is not the same
	 * as a zero fact).
	 */
	const searchResultLabel = $derived(
		searchQuery.trim() ? lineCountLabel(filteredLogs.length, nonSearchFilteredLogs.length) : null
	);

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

	/**
	 * ⭐ "COUNT FROM THE SAME LIST" (art director round 2, must-fix: "the
	 * header says '1 pod' while the pane lists 2"). On the Tests view,
	 * `effectivePodCount` is the TEST-type count (1, the test-runner) —
	 * correct for what the stream itself is scoped to, but a reader
	 * reading "1 pod" in the header while the Sources pane's own "Pods"
	 * section (unfiltered by view, see `podSidebarRows`'s own comment)
	 * lists 2 sees two different numbers for what looks like the same
	 * fact. `podSidebarRows.length` is the number ACTUALLY printed under
	 * "Pods" in the pane — using it for the header too means the two can
	 * never disagree again, on either view. Falls back to
	 * `effectivePodCount` only when no app pod has been discovered yet at
	 * all (a rollout whose own stream never reports one) rather than
	 * header-print "0 pods" over an otherwise normal view.
	 */
	const headerPodCount = $derived(
		podSidebarRows.length > 0 ? podSidebarRows.length : effectivePodCount
	);
	$effect(() => {
		onPodCount?.(headerPodCount);
	});
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
	 * ⭐ THE PERSISTENT FOOTER'S OWN LABEL (SPEC.md §2: "Showing 84 of 84
	 * lines", always on). Measured against `nonSearchFilteredLogs` — the
	 * pod/container/level-filtered count — NOT `filteredLogs` (which also
	 * has search applied): search already has its OWN "N of M lines" label
	 * right beside the box that produced it (`searchResultLabel`), in the
	 * SAME wording `lineCountLabel` produces. Measuring the footer against
	 * the identical scope would print that exact sentence a second time,
	 * the "one fact, once" defect this file's own `lineSummary` note above
	 * already explains at the card-header level — this is the same
	 * discipline one level down, confirmed by this file's own test (typing
	 * a search term with no other filter active must not duplicate the
	 * search box's own count in the footer).
	 */
	const footerLineLabel = $derived.by((): string => {
		const count = nonSearchFilteredLogs.length;
		const total = logs.length;
		// LOGOPEN round 7, item 3: in a time window the count follows the
		// window ("0 errors in this window"), in the filter's own noun.
		if (timeRangeFilter) {
			const noun = count === 1 ? levelNoun.replace(/s$/, '') : levelNoun;
			return `${count.toLocaleString()} ${noun} in this window`;
		}
		// A level filter states what it keeps, not a second error count
		// (the histogram's lead owns that number).
		if (selectedLogLevels.size > 0) {
			const names = { error: 'Errors', warn: 'Warnings', info: 'Info', debug: 'Debug' } as const;
			const picked = (['error', 'warn', 'info', 'debug'] as const).filter((l) => selectedLogLevels.has(l));
			const what =
				picked.length === 1
					? names[picked[0]]
					: `${names[picked[0]]} and ${picked.length - 1} more level${picked.length === 2 ? '' : 's'}`;
			return `${what} only · ${total.toLocaleString()} line${total === 1 ? '' : 's'}`;
		}
		return count === total
			? `${count.toLocaleString()} line${count === 1 ? '' : 's'}`
			: `Showing ${lineCountLabel(count, total)}`;
	});
	/** The count line offers "Show all lines" whenever a non-search filter
	 *  is hiding lines (search keeps its own count and its own ×). */
	const footerShowsAll = $derived(nonSearchFilteredLogs.length !== logs.length);

	/**
	 * ⛔ THE CARD HEADER'S ROLLUP USED TO RESTATE THE HEAD ROW. (F9,
	 * 2026-09-03) `378 lines · 4 pods · streaming` printed in the page head
	 * (one level up), THEN `4 pods · streaming` again here 180px below it,
	 * THEN `378 lines` a third time in the footer — one fact in three
	 * captions, `Streaming`/`streaming` differing only by an accident of
	 * case between two of them. The head sentence is gone now (see
	 * `lineSummary` above); this header owns the count AND the connection
	 * state, together, in the one rollup slot a Card has for exactly this.
	 *
	 * IT IS A DOT, NOT A SENTENCE, FOR THE CONNECTION STATE SPECIFICALLY.
	 * `COMPOSITION-GRAMMAR.md` §1's "single most transferable thing" is
	 * answering the card's own question WITHOUT reading a row of it — a
	 * live/closed/error indicator does that in one glance, at card scale,
	 * without repeating the head's words. The accessible name carries the
	 * same information the retired text did, so nothing is lost for a
	 * screen reader, only for a sighted reader who already read it 20px
	 * above the tab strip.
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
	/**
	 * ⭐ SEMANTIC TOKENS (2026-10-08, design-language pass). `connecting` is
	 * deliberately NEUTRAL (`fg-subtle`), not amber: amber means STUCK only
	 * (principle 10) and a socket still opening is not a product state that
	 * needs a person, only a moment to wait out.
	 */
	/**
	 * ⭐ NEUTRAL UNLESS SOMEONE IS NEEDED (TL review round 3). `streaming`
	 * was `success-solid` (green) — a healthy, working-as-expected
	 * connection, the steady state this tab spends almost its entire life
	 * in, is not a fact that needs a person, the same reasoning
	 * `RestGlyph`'s quiet dot already applies to "succeeded a while ago"
	 * everywhere else in the product (principle 12: colour only where
	 * someone is needed). Only `error` — the one state that genuinely does
	 * — still spends a hue. The native `title` + the `sr-only` span beside
	 * the dot in the template are the explanation a bare coloured dot would
	 * not otherwise carry.
	 */
	/**
	 * ⭐ THE VISIBLE LIVE MARK (squad-rollout coordinator review,
	 * 2026-10-09: "'● Live' in text-success… 'Paused'… 'Reconnecting…'
	 * with a spinner… today it is a hollow ring with no word"). `rollupDot`
	 * above stays — its richer tone/label (the stale-aware "Streaming — 2m
	 * ago" sentence) is still exactly right for a HOVER, where a reader
	 * who wants the detail can get it; this is the three-word read a
	 * glance gets without one. Tied to `autoScroll` (Follow) rather than
	 * `rollupDot`'s own five-way connection tone for the non-terminal
	 * cases — "Live"/"Paused" is a statement about whether THIS READER is
	 * watching new lines land, which is what Follow already means, not a
	 * second spelling of the socket's own state.
	 */
	const liveMark = $derived.by(
		(): { label: string; tone: 'success' | 'danger' | 'active' | 'subtle'; spinner?: boolean } => {
			if (connectionState === 'connecting') {
				return { label: 'Reconnecting…', tone: 'active', spinner: true };
			}
			if (connectionState === 'error') return { label: 'Disconnected', tone: 'danger' };
			if (!autoScroll) return { label: 'Paused', tone: 'subtle' };
			return { label: 'Live', tone: 'success' };
		}
	);


	// The empty state's icon, keyed off the same view split as the copy
	// beside it and the Card's own header icon. Capitalised: a lowercase
	// identifier in a component tag position renders as a literal `<x>`
	// element, not this reference.
	const EmptyIcon = $derived(filterType === 'test' ? FlaskOutline : TerminalOutline);

	// Highlight search matches in log lines
	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function highlightSearch(text: string, query: string): string {
		if (!query.trim()) return escapeHtml(text);
		const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		// ⭐ `bg-selected`, NOT a hue. (2026-10-08, design-language pass) A
		// search match is not a status — nothing here needs a person — so it
		// takes the same neutral "this is the thing in view" token a
		// selected row already uses, rather than inventing a highlight
		// colour the closed status palette has no slot for.
		// Odd indexes of a capturing split are the matches. Every piece is escaped
		// before it reaches `{@html}`: log text is untrusted.
		return text
			.split(regex)
			.map((part, i) =>
				i % 2 === 1
					? `<mark class="rounded-xs bg-selected text-fg">${escapeHtml(part)}</mark>`
					: escapeHtml(part)
			)
			.join('');
	}

	// The row clock is formatted here, not taken from the worker's
	// `formattedTimestamp`: the worker formats once on arrival, so a line already
	// on screen would keep its old zone after the navbar's Local/UTC toggle flips.
	// Only the visible rows render, so one cached formatter per zone is cheap.
	const logClock = $derived(
		new Intl.DateTimeFormat('en-US', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			fractionalSecondDigits: 3,
			timeZone: displayTimeZone()
		})
	);

	/**
	 * ⭐ NO MILLISECONDS AT PHONE (art director round 2, must-fix: "drop
	 * milliseconds from times (HH:MM:SS)"). The desktop table has a
	 * column's worth of horizontal room for `.341`; the phone's own
	 * stacked row (time + level on one line, message below) does not
	 * spend it on three digits nobody reads at a glance — the SAME idea
	 * `lib/display-time`'s zone-only vs instant-only split already
	 * applies elsewhere, just as a second cached formatter here rather
	 * than a new shared util for one caller.
	 */
	const logClockPhone = $derived(
		new Intl.DateTimeFormat('en-US', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZone: displayTimeZone()
		})
	);

	/**
	 * ⭐ THE EMPTY WINDOW NAMES ITS WINDOW (LOGOPEN, AD round 5, item 5:
	 * "names the wrong window and has two Clears and a third count").
	 * "No lines in the last 2m match" described a DRAGGED window as if it
	 * were a trailing one. The title now states the window the reader
	 * picked, in the level they are filtering ("No errors between
	 * 21:12:00 and 21:13:30"); it adds no count of its own (the histogram
	 * readout is the one for the window); and the histogram's own Clear
	 * chip, directly above, is the one Clear (this state draws none).
	 */
	const levelNoun = $derived.by((): string => {
		if (selectedLogLevels.size !== 1) return 'lines';
		const only = [...selectedLogLevels][0];
		return { error: 'errors', warn: 'warnings', info: 'info lines', debug: 'debug lines' }[only];
	});
	const windowEmpty = $derived.by((): { title: string; detail: string | null } | null => {
		if (!timeRangeFilter) return null;
		const title = `No ${levelNoun} between ${logClockPhone.format(timeRangeFilter.start)} and ${logClockPhone.format(timeRangeFilter.end)}`;
		// No count here: the pill, the rollup and the histogram readout
		// already carry three. The sentence says what to do instead.
		return {
			title,
			detail: `Drag another window on the chart above, or Clear it to see every ${levelNoun === 'lines' ? 'line' : levelNoun.replace(/s$/, '')}.`
		};
	});

	// Flatten for virtual list
	const allLogLines = $derived.by(() => {
		// Optimization: Avoid re-mapping if unnecessary, but standard map is usually fast enough for 2k-10k items
		return filteredLogs.map((log, index) => ({
			line: log.line,
			pod: log.pod,
			container: log.container,
			type: log.type,
			timestamp: log.timestamp || Date.now(),
			formattedTimestamp: log.formattedTimestamp || '', // Always provided by worker
			index,
			// The raw stream object, kept by reference so the entry-fade
			// effect below can key "just arrived" off IDENTITY rather than
			// this filtered position — see `justArrivedRefs`'s own comment.
			raw: log
		}));
	});
	/**
	 * ⭐ 20px, NOT 30 (art director round 1, must-fix #1: "Rows measure 25px
	 * /27px… jitters by 2px… Target: ≥25 rows in the 1440×900 fold,
	 * identical heights for every row"). `t-code-sm` is 12/16 — this is
	 * exactly that line-height plus 2px top and 2px bottom (`h-5 flex
	 * items-center`, not `py-*`, so the row's measured height can never
	 * drift with a child's own box model the way `border-b` + `py-1` did).
	 * No row divider any more either (the AD's own target: "the level rule
	 * and alternating hover do the separating") — see the row's own class
	 * list below.
	 */
	const ROW_HEIGHT = 20;

	/**
	 * ⭐ THE EXPAND DETAIL ROW'S HEIGHT, EXACT NOT ESTIMATED (art director
	 * round 1, must-fix #3: "expand in place under the line… nothing
	 * renders outside the card"). `tanstack-virtual` never calls
	 * `measureElement` in this file (every other row's `estimateSize` is
	 * already exact, not approximate, which is what keeps the virtualizer
	 * honest without that extra wiring) — so this has to be arithmetic,
	 * not a guess: 8px top + 8px bottom padding, one 16px `t-code-sm` row
	 * per field (the SAME line-height the plain log rows use, so the two
	 * row kinds share one rhythm), then an 8px gap (`mt-2`) + the action
	 * row's own height.
	 *
	 * ⭐ 28, NOT 24 (AD round 2, "also": "real btn-ghost btn-xs actions" —
	 * was a `.nav-link` row pinned to `h-4` (16px); `.btn-xs` is a REAL
	 * control at its own fixed 28px (app.css), so the row beneath it has
	 * to grow to match or the button's own bottom edge would print past
	 * this div's `style="height: …"` and straddle the row under it — the
	 * exact seam this arithmetic exists to prevent. The template below is
	 * built to match this number exactly — changing one without the other
	 * reintroduces that seam.
	 *
	 * ⭐ `messageLines` (AD round 3, item 4: "expand shows the FULL message
	 * first, then all fields") — the collapsed row only ever shows
	 * `messageHeadline`'s shortened form now (round 6); the expand is the
	 * one place the full, untrimmed line still has to be readable, so it
	 * gets its own paragraph ABOVE the fields `dl`, estimated at
	 * `maxMessageChars` per line — the SAME measured char budget the
	 * collapsed row's own `truncateAtWordBoundary` already uses (see that
	 * state's own doc), not a second guess at the well's width. An
	 * estimate, not a measurement (`tanstack-virtual` never calls
	 * `measureElement` here — see this function's own opening doc) — the
	 * message paragraph is `overflow-hidden` in the template specifically
	 * so an under-estimate CLIPS a line rather than straddles the row
	 * below it, the safe failure direction for an approximation.
	 */
	function detailRowHeight(fieldCount: number, messageLines: number = 1): number {
		return 16 + messageLines * 16 + 8 + fieldCount * 16 + 8 + 28;
	}

	type AllLogLine = (typeof allLogLines)[number];
	type DisplayRow =
		| { kind: 'log'; log: AllLogLine }
		| { kind: 'detail'; log: AllLogLine; fields: StructuredField[]; messageLines: number };

	/**
	 * ⭐ THE VIRTUALIZER'S REAL ITEM LIST (art director round 1, must-fix
	 * #3). `allLogLines` stays the plain log buffer everywhere else in this
	 * file (copy, search count, footer count) — this is the ONE place a
	 * detail row is spliced in as a genuine extra entry, right after the
	 * line it belongs to, exactly where `expandedLineRef` (above) says it
	 * is. The virtualizer below reads THIS array's length for its count
	 * and this array's own `kind` per index for its height — a detail row
	 * is not a taller log row, it is a second row.
	 */
	const displayRows = $derived.by((): DisplayRow[] => {
		if (!expandedLineRef) return allLogLines.map((log): DisplayRow => ({ kind: 'log', log }));
		const rows: DisplayRow[] = [];
		for (const log of allLogLines) {
			rows.push({ kind: 'log', log });
			if (log.raw === expandedLineRef) {
				const fields = parseStructuredFields(log.line);
				if (fields) {
					const fullMessage = stripLogLinePrefix(log.line).message;
					const messageLines = Math.max(
						1,
						Math.ceil(fullMessage.length / Math.max(1, maxMessageChars))
					);
					const fieldsWithSource = withSourceFields(log, fields);
					rows.push({ kind: 'detail', log, fields: fieldsWithSource, messageLines });
				}
			}
		}
		return rows;
	});

	/**
	 * ⭐ COPY, NEW (2026-10-08, design-language pass). Nothing in this pane
	 * previously let an operator get log TEXT out of it except an OS-level
	 * text selection across a virtualized list (unreliable: only the rows
	 * currently mounted are in the DOM). `CopyButton` (kept, reused) copies
	 * every line currently passing the pod/container/level/search filters —
	 * the same set `filteredLogs.length` already counts in the Card rollup
	 * — as plain text, one line per row, prefixed with the pod/container so
	 * a copied snippet is still attributable once it is pasted somewhere
	 * else.
	 */
	const copyValue = $derived(
		allLogLines.map((l) => `${formatTimestamp(l.timestamp)} ${l.pod}/${l.container}: ${l.line}`).join('\n')
	);

	// Track scroll position for restoration
	let savedScrollTop = $state(0);

	/** Whether the well's own content overflows its box — the floating
	 *  scroll buttons' real gate, set by the count effect below. */
	let listScrollable = $state(false);

	// Setup Virtualizer - only recreates when scroll element changes
	// NOT when count changes - this preserves cache and scroll position
	let virtualizer = $derived(
		createVirtualizer<HTMLElement, HTMLDivElement>({
			count: 0, // Initial count, updated via effect
			getScrollElement: virtualListEl ? () => virtualListEl : () => null,
			// ⭐ PER-INDEX, AGAINST `displayRows` (must-fix #3). A detail row's
			// height is computed EXACTLY (`detailRowHeight`), never guessed —
			// see that function's own doc comment for why an approximate
			// estimate here would reopen the "straddling row" class of bug.
			// `displayRows[index]` can be momentarily `undefined` the same
			// one render-tick the count effect below is still catching up
			// from (documented at length just below) — `ROW_HEIGHT` is a
			// safe fallback for that single frame, never rendered from.
			estimateSize: (index) => {
				const row = displayRows[index];
				return row?.kind === 'detail'
					? detailRowHeight(row.fields.length, row.messageLines)
					: ROW_HEIGHT;
			},
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
		const count = displayRows.length;
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

		// ⭐ THE FLOATING SCROLL BUTTONS' OWN CONDITION (art director round
		// 1, must-fix #4). `virtualListBefore > 0 || virtualListAfter > 0`
		// (the ORIGINAL gate) answers "is virtualization currently
		// trimming the DOM", which a 56-line buffer with a 40-row overscan
		// on EACH side never triggers — every row is already mounted,
		// `virtualListBefore`/`After` read 0 even scrolled halfway down a
		// genuinely taller-than-the-well list, and the buttons never
		// appeared (this is why the AD's build showed them "absent": not
		// a rendering bug, a wrong condition). The real question is
		// simpler — does the WELL'S OWN CONTENT overflow its box — so this
		// reads the DOM directly, in the one effect that already re-runs
		// whenever row count (hence content height) changes.
		if (scrollEl) {
			listScrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 1;
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
		$virtualizer.getVirtualItems().filter((item) => item.index < displayRows.length)
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

	/**
	 * ⭐ ONE ANCHOR, PINNED BEFORE PAINT (LOGOPEN, AD round 5, item 1:
	 * "scroll to the bottom when the first batch renders, before it is
	 * shown; count the footer and padding in 'at bottom'; re-anchor to the
	 * newest match on any filter change").
	 *
	 * The old `scrollToBottom()` was a settle loop: set `scrollTop`, wait a
	 * tick + a frame + 100ms, nudge the top row flush, then re-run if a
	 * batch landed meanwhile. Three defects came out of it, all measured
	 * frame by frame: (1) its first call ran while the well did not exist
	 * yet (the well mounts with the first batch, the effect saw `null`
	 * and marked the batch seen), so the console opened at `scrollTop` 0
	 * and only moved when the NEXT streamed line arrived, 3.7s/5.6s later;
	 * (2) the top-row nudge scrolled UP by a partial row, pushing the
	 * newest row 21-36px under the footer; (3) the 100ms settle revealed
	 * the well before anything had moved.
	 *
	 * Every row height here is exact (`ROW_HEIGHT`, `detailRowHeight`), so
	 * the bottom is plain arithmetic: `scrollTop = scrollHeight -
	 * clientHeight`, the newest row's bottom edge on the well's bottom edge
	 * (the footer is outside the well's box, so it can never cover it).
	 * The synthetic `scroll` event is what makes it land BEFORE paint:
	 * `virtual-core` reads `scrollTop` inside its own scroll listener, so
	 * dispatching one synchronously moves its range in the same microtask
	 * flush instead of on the browser's next scroll event, and the rows at
	 * the bottom are rendered by the time the frame is drawn.
	 *
	 * `anchorRequested` is the only way in: a fresh stream, a filter change
	 * (level, pod, search, time window, the rollup's "N errors"), Follow
	 * turning on, Jump to latest, and a new line while following all set
	 * it, and the effect below honours it once the well and its rows
	 * exist, which is exactly the case the old loop dropped.
	 */
	let anchorRequested = $state(true);

	function pinToBottom(el: HTMLElement) {
		const max = Math.max(0, el.scrollHeight - el.clientHeight);
		if (Math.abs(el.scrollTop - max) > 0.5) el.scrollTop = max;
		el.dispatchEvent(new Event('scroll'));
	}

	async function settleAtLatest() {
		await tick();
		const el = virtualListEl;
		if (!el) return;
		isAutoScrolling = true;
		pinToBottom(el);
		// The range moved; its rows render in this flush. Pin once more in
		// case the spacer arithmetic changed with them.
		await tick();
		if (virtualListEl) pinToBottom(virtualListEl);
		requestAnimationFrame(() => {
			// One frame later the ResizeObserver has reported the well's
			// real height (it can change once the histogram and state line
			// mount above it); pin a last time, then show the well.
			if (virtualListEl && autoScroll) pinToBottom(virtualListEl);
			if (!wellRevealed) {
				if (wellRevealTimeout) {
					clearTimeout(wellRevealTimeout);
					wellRevealTimeout = null;
				}
				wellRevealed = true;
			}
			requestAnimationFrame(() => {
				isAutoScrolling = false;
			});
		});
	}

	$effect(() => {
		if (isPhone) return;
		const el = virtualListEl;
		const count = displayRows.length;
		if (!anchorRequested || !el || count === 0) return;
		anchorRequested = false;
		void settleAtLatest();
	});


	// Auto-scroll when new logs arrive (if enabled)
	let previousLogCount = 0;
	let previousLastTimestamp: number | null = null;

	/* ⛔ `pendingRescroll` (design pass 6) queued growth that landed mid-
	   settle-loop. The loop is gone (see `anchorRequested`): a request that
	   arrives while one is in flight simply sets the flag again and the
	   effect honours it on its next run, so nothing is dropped. */

	/**
	 * ⭐ THE ENTRY FADE'S ARRIVAL SET — KEYED ON THE RAW LOG OBJECT, NOT ON A
	 * FILTERED INDEX. (2026-09-12, L5 "the log viewer survives a 60fps
	 * capture") `allLogLines`' own `index` is a position in the FILTERED
	 * view, which toggling a pod/container/level/search filter reshuffles
	 * instantly — keying "just arrived" on that index would make clearing a
	 * filter fade in dozens of OLD lines as if they had just streamed in.
	 * `logs` (the raw, unfiltered query data) only ever grows by
	 * `[...acc, ...new]` (`logsStreamQueryOptions`'s reducer in
	 * `lib/api/logs.ts`) — existing entries keep their own OBJECT REFERENCE,
	 * only genuinely new lines are new objects — so tracking by reference is
	 * immune to every filter and correct across a reconnect (replayed
	 * history arrives as the SAME objects only the first time they're seen
	 * here, if at all).
	 *
	 * Each arrived object gets its OWN timer, not one shared timer for the
	 * whole batch: a burst of lines (the initial backlog, or several SSE
	 * events landing in one flush) must not stagger — line 40 of a 40-line
	 * burst finishes its fade within `LOG_LINE_ENTER_MS` of ITS OWN arrival,
	 * not 40 lines behind line 1.
	 */
	const LOG_LINE_ENTER_MS = 180; // under the 300ms capture cap, with margin
	let justArrivedRefs = $state<Set<LogLine>>(new Set());
	let previousRawLogCount = 0;
	let logEnterTimers = new Set<ReturnType<typeof setTimeout>>();

	$effect(() => {
		const currentRawCount = logs.length;
		if (currentRawCount > previousRawLogCount) {
			const arrived = logs.slice(previousRawLogCount, currentRawCount);
			justArrivedRefs = new Set([...justArrivedRefs, ...arrived]);
			for (const item of arrived) {
				const timer = setTimeout(() => {
					logEnterTimers.delete(timer);
					if (justArrivedRefs.has(item)) {
						const next = new Set(justArrivedRefs);
						next.delete(item);
						justArrivedRefs = next;
					}
				}, LOG_LINE_ENTER_MS);
				logEnterTimers.add(timer);
			}
		}
		previousRawLogCount = currentRawCount;
	});

	// Follow: a new line (or a changed newest line) while following and
	// not mid-gesture asks for the anchor. Desktop only: the phone lists
	// newest first and has nothing to scroll for (see `phoneAway`).
	$effect(() => {
		const currentCount = allLogLines.length;
		const lastTimestamp = allLogLines[currentCount - 1]?.timestamp || null;
		const logsChanged = currentCount !== previousLogCount || lastTimestamp !== previousLastTimestamp;
		previousLogCount = currentCount;
		previousLastTimestamp = lastTimestamp;
		if (!logsChanged || isPhone) return;
		untrack(() => {
			if (autoScroll && !isUserScrolling) anchorRequested = true;
		});
	});

	// Follow turning ON (the toolbar toggle, scrolling back down to the
	// bottom, Jump to latest) lands exactly on the newest row.
	let lastAutoScroll = true;
	$effect(() => {
		const on = autoScroll;
		if (on && !lastAutoScroll && !isPhone) untrack(() => (anchorRequested = true));
		lastAutoScroll = on;
	});

	/**
	 * ⭐ RE-ANCHOR ON ANY FILTER CHANGE (LOGOPEN, AD round 5, items 1 and
	 * 10: "the FAILED view opens on the OLDEST error; tapping '49 errors'
	 * lands at the top"; "a dragged window opens at its NEWEST line"). A
	 * filter is a new question; its answer starts at the newest match, the
	 * same place the unfiltered stream opens. One signature over every
	 * filter input, so a new filter cannot forget to join in.
	 */
	const filterSignature = $derived(
		[
			[...selectedLogLevels].sort().join(','),
			[...selectedPods].sort().join(','),
			searchQuery.trim(),
			timeRangeFilter ? `${timeRangeFilter.start}-${timeRangeFilter.end}` : '',
			filterType
		].join('|')
	);
	let lastFilterSignature: string | null = null;
	$effect(() => {
		const sig = filterSignature;
		if (lastFilterSignature !== null && sig !== lastFilterSignature) {
			untrack(() => {
				// A new filter or view is a new list: back to the first page of it.
				phoneLimit = PHONE_PAGE;
				if (contextTarget) {
					// "Show in context" cleared the filters. The phone list is a
					// frozen snapshot (the open line pauses it), still holding
					// the FILTERED rows; refresh it to the cleared list so the
					// target is in it, and re-base the new-lines count. Then
					// reveal widens `phoneLimit` to include the target.
					if (isPhone) {
						phoneSnapshot = [...allLogLines].reverse();
						scrollAwayBaseCount = allLogLines.length;
					}
					void revealContextTarget();
					return;
				}
				if (isPhone) {
					// A filter is a new question: show its answer now, frozen
					// again at once if a line is still open.
					phoneSnapshot = phonePaused ? [...allLogLines].reverse() : null;
					scrollAwayBaseCount = phonePaused ? allLogLines.length : null;
					scrollPhoneToLatest();
					return;
				}
				autoScroll = true;
				anchorRequested = true;
			});
		}
		lastFilterSignature = sig;
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

	/** ⭐ THE FADE'S OTHER GATE (AD round 4, item 3: "no fade… at scrollTop
	 *  0") — `listScrollable` alone still drew it the instant the well
	 *  opened, before a reader had scrolled at all: true at rest, there is
	 *  nothing above the top row to hide. Starts `true` (every well opens
	 *  at `scrollTop` 0 on first paint) and is read UNCONDITIONALLY, ahead
	 *  of `handleScroll`'s own `isAutoScrolling` early return below — a
	 *  programmatic scroll-to-bottom still needs this to flip to `false`
	 *  the instant it lands away from the top, or Follow's own auto-scroll
	 *  would leave the fade permanently stuck on "at rest". */
	let isAtTop = $state(true);

	// Handle Scroll Events for Auto-scroll toggle
	function handleScroll(e: Event) {
		const target = e.target as HTMLElement;
		if (!target) return;
		isAtTop = target.scrollTop === 0;
		if (expandedLineRef) updateDetailZone();
		// A programmatic pin is ignored, unless a real gesture is in flight:
		// a wheel landing in the two frames a pin holds the guard must still
		// pause Follow, or the next line snaps the reader back down.
		if (isAutoScrolling && Date.now() - lastUserGestureAt > 300) return;

		const { scrollTop, scrollHeight, clientHeight } = target;
		// "At the latest" means the newest row is fully on screen: less than
		// one row of content left below the well's own bottom edge (LOGOPEN,
		// item 9: the ↓ shows only when away, so this has to be strict).
		const isNearBottom = scrollHeight - scrollTop - clientHeight < ROW_HEIGHT;
		const recentUserGesture = Date.now() - lastUserGestureAt < 1000;

		// If user scrolled away from bottom, disable auto-scroll — but only
		// off the back of a real gesture, not a phantom scroll event.
		if (!isNearBottom && autoScroll && recentUserGesture) {
			autoScroll = false;
		}

		// If user scrolls back to bottom, re-enable auto-scroll. Not while a
		// line is open in detail (round 7, item 1): a detail revealed at the
		// bottom is being read, and following would push it up and away.
		if (isNearBottom && !autoScroll && !expandedLineRef) {
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

	/**
	 * ⭐ "N NEW" FOR THE FOOTER'S "Jump to latest" BUTTON (SPEC.md §2).
	 * `scrollAwayBaseCount` snapshots the line count at the MOMENT Follow
	 * turns off — not a continuously-updated "lines below the fold" count,
	 * which would need to know the virtualizer's own scroll position down
	 * to the pixel. The button only needs "how much have you missed since
	 * you stopped following", and that is exactly `allLogLines.length` at
	 * that moment versus now. Resets to `null` the instant Follow is back
	 * on (by this button or by scrolling back to the bottom by hand), so a
	 * second scroll-away starts counting from zero again rather than from
	 * whatever the first one left behind.
	 */
	let scrollAwayBaseCount = $state<number | null>(null);
	$effect(() => {
		if (!autoScroll) {
			if (scrollAwayBaseCount == null) scrollAwayBaseCount = allLogLines.length;
		} else {
			scrollAwayBaseCount = null;
		}
	});
	const newSinceScrollAway = $derived(
		scrollAwayBaseCount != null ? Math.max(0, allLogLines.length - scrollAwayBaseCount) : 0
	);

	/** Desktop: ask for the anchor (`anchorRequested`). Phone: the newest
	 *  line is at the TOP of a newest-first list (see `phoneRows`), so
	 *  "latest" is a scroll back up to it. */
	function jumpToLatest() {
		if (isPhone) {
			showNewOnPhone();
			return;
		}
		autoScroll = true;
		anchorRequested = true;
	}

	// Cleanup on destroy
	onDestroy(() => {
		if (scrollTimeout) {
			clearTimeout(scrollTimeout);
		}
		logEnterTimers.forEach((timer) => clearTimeout(timer));
		logEnterTimers.clear();
	});

	/**
	 * ⭐ THIS PANE BOUNDS ITSELF NOW — IT NO LONGER TRUSTS AN ANCESTOR TO
	 * BE THE VIEWPORT'S HEIGHT. (2026-09-03, scroll model rewrite)
	 *
	 * `min-h-0 flex-1` (below) used to be enough because the page this
	 * component was handed a flex column whose OWN height came from
	 * `<main>` being pinned to exactly `h-screen` (see `app.css`'s "THE
	 * DOCUMENT SCROLLS"). `<main>` is a plain, unbounded block now — the
	 * DOCUMENT scrolls — so a `flex-1` chain rooted in it has nothing left
	 * to fill against and would happily grow to the height of every log
	 * line in the buffer, which is exactly the unbounded-pane defect this
	 * rewrite exists to avoid (see `lib/CLAUDE.md`'s "the Logs pane…must
	 * be bounded by the viewport (max-height in dvh)").
	 *
	 * `paneMaxHeight` measures the ONE thing that answers "how much room is
	 * actually left below this pane in the viewport": the element's own
	 * position in the DOCUMENT (`getBoundingClientRect().top +
	 * window.scrollY` — scroll-position-INDEPENDENT, so this cannot be
	 * bothered to also listen for `scroll` and cannot feed back into
	 * itself the way listening on `scroll` here would), subtracted from
	 * the viewport height, minus the fixed mobile tab bar's own measured
	 * height (`--tabbar-h`, published by `MobileTabBar.svelte` — 0 above
	 * `sm`, where that bar does not render) and a small breathing gutter.
	 * Measured once on mount (when a fresh navigation has already put
	 * `scrollY` at 0 — see the root layout's scroll-restoration note) and
	 * on resize; NOT on every `scroll` event, which would be circular
	 * (this pane's own height affects the document's scrollable extent).
	 *
	 * `min-h-0 flex-1` stays: it is what makes the header row (`shrink-0`)
	 * and the content area split correctly WITHIN whatever height this
	 * grants, on any ancestor that is bounded too (unchanged from before).
	 *
	 * ⚠️ `max-height` ALONE MEASURED AS A 173px SLIVER, NOT THE 712px IT
	 * WAS SET TO. A `max-height` only ever CAPS a box that something else
	 * is trying to grow — it is not itself a sizing force. With `<main>`
	 * unbounded, nothing downstream of this element was trying to grow it
	 * at all: this element's own `flex-1` had no ancestor height left to
	 * fill, so it settled to its CONTENT'S natural height (just the
	 * header row) and the `max-height` had nothing to clamp. The template
	 * below sets `height` from this value too — `height` is what actually
	 * establishes the box's size for the `flex-1` content area beneath it
	 * to fill; `max-height` stays alongside it purely as a floor against
	 * any child that refuses to shrink.
	 */
	let paneRootEl: HTMLDivElement | undefined = $state();
	let paneMaxHeight = $state<number | null>(null);

	/**
	 * ⭐ PHONE IS A SEPARATE RENDER PATH NOW, NOT A SQUEEZED DESKTOP (art
	 * director round 1, must-fix #5: "the phone is a control panel with a
	 * small scroller in it… no inner scroller… one 44px control row…
	 * every row stacks as time · level on line 1 and the message on line
	 * 2"). Tracked reactively (unlike the Wrap default above, which is
	 * read once) because the console's whole SHAPE forks on this, not one
	 * toggle's starting value. `window.innerWidth`, the same scanner-safe
	 * idiom the Wrap default already uses (see its own comment) — this
	 * fires from a `resize` listener instead of being read once at mount.
	 */
	let isPhone = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		function update() {
			isPhone = window.innerWidth < 640;
		}
		update();
		window.addEventListener('resize', update);
		return () => window.removeEventListener('resize', update);
	});

	/**
	 * ⭐ THE PHONE LISTS NEWEST FIRST (LOGOPEN, AD round 5, item 3: "the
	 * phone opens past its own header… the title, FAILED, Roll back, the
	 * histogram and the 'Showing N errors' line are never seen").
	 *
	 * The phone scrolls the DOCUMENT (the product's standard sub-`sm`
	 * model), so "open at the latest" on an oldest-first list meant
	 * scrolling the whole page ~2,300px past everything above the stream.
	 * Reversing the list puts the latest line directly under the
	 * histogram, so the first screen is header + histogram + newest lines
	 * at `scrollY` 0 and nothing ever scrolls on open. Live lines PREPEND.
	 *
	 * "Following" on the phone is therefore "the newest row is on
	 * screen": `phoneAway` is true once the top of the list has scrolled
	 * up under the sticky app bar. While away, a prepended line would
	 * push what the reader is reading down by a row; `$effect.pre` /
	 * `$effect` below hold their place instead (the list sets
	 * `overflow-anchor: none` so the browser's own scroll anchoring, where
	 * it exists, does not apply the same correction twice).
	 */
	let phoneTopSentinel: HTMLDivElement | undefined = $state();
	let phoneListEl: HTMLDivElement | undefined = $state();
	let phoneAway = $state(false);

	/** The bottom edge of whatever is pinned to the top of the viewport
	 *  (the app bar, the tab strip): content under it is not visible. */
	function phoneStickyBottom(): number {
		if (typeof document.elementFromPoint !== 'function') return 0;
		let y = 1;
		for (let n = 0; n < 4; n++) {
			let el = document.elementFromPoint(window.innerWidth / 2, y) as HTMLElement | null;
			let pinned: HTMLElement | null = null;
			while (el && el !== document.body) {
				const pos = getComputedStyle(el).position;
				if (pos === 'sticky' || pos === 'fixed') pinned = el;
				el = el.parentElement;
			}
			if (!pinned) break;
			const bottom = pinned.getBoundingClientRect().bottom;
			if (bottom <= y) break;
			y = bottom + 1;
		}
		return y - 1;
	}

	function scrollPhoneToLatest() {
		const el = phoneTopSentinel;
		if (!el || typeof window === 'undefined') return;
		const top = el.getBoundingClientRect().top;
		const stickyBottom = phoneStickyBottom();
		if (top >= stickyBottom) return; // already on screen: never scroll down to it
		// Back to the designed first screen: header (state, Roll back),
		// histogram, state line, newest rows. Not the row alone under the
		// app bar.
		window.scrollTo(0, 0);
	}

	$effect(() => {
		if (!isPhone || typeof window === 'undefined') return;
		let stickyBottom = phoneStickyBottom();
		function onWindowScroll() {
			const el = phoneTopSentinel;
			if (!el) return;
			const away = el.getBoundingClientRect().top < stickyBottom - 1;
			if (away !== phoneAway) phoneAway = away; // `phonePaused` drives Follow
		}
		function onResize() {
			stickyBottom = phoneStickyBottom();
			onWindowScroll();
		}
		window.addEventListener('scroll', onWindowScroll, { passive: true });
		window.addEventListener('resize', onResize);
		onWindowScroll();
		return () => {
			window.removeEventListener('scroll', onWindowScroll);
			window.removeEventListener('resize', onResize);
		};
	});

	/**
	 * ⭐ PAUSED MEANS FROZEN ON THE PHONE (LOGOPEN r8, item 1, binding:
	 * "expanding a line pauses Follow exactly as scrolling does… new lines
	 * collect behind a '↑ N new' pill; nothing moves the page while a line
	 * is open"). Round 7 held the reader's place by scrolling the document
	 * down by each prepended row, so the content stayed put but the PAGE
	 * drifted 53px a line and Roll back scrolled away. Now a paused phone
	 * list is a snapshot: new lines are counted (`newSinceScrollAway`), not
	 * inserted, and the "↑ N new" pill brings them in on purpose.
	 * Paused = scrolled away from the newest row, or a line open in detail.
	 */
	const phonePaused = $derived(isPhone && (phoneAway || expandedLineRef !== null));
	let phoneSnapshot = $state.raw<AllLogLine[] | null>(null);
	$effect(() => {
		if (!isPhone) return;
		const paused = phonePaused;
		untrack(() => {
			autoScroll = !paused;
			if (paused && !phoneSnapshot) phoneSnapshot = [...allLogLines].reverse();
			if (!paused) phoneSnapshot = null;
		});
	});
	/** Bring the collected lines in (the "↑ N new" pill). Stays paused if a
	 *  line is still open: a fresh snapshot, the count back to zero. */
	function showNewOnPhone() {
		phoneSnapshot = phonePaused ? [...allLogLines].reverse() : null;
		scrollAwayBaseCount = allLogLines.length;
		scrollPhoneToLatest();
	}

	/** Newest first, phone only (see `phoneTopSentinel`); frozen while
	 *  paused (see `phonePaused`). */
	const phoneRows = $derived(isPhone ? (phoneSnapshot ?? [...allLogLines].reverse()) : []);

	/**
	 * ⭐ THE PHONE LIST IS BOUNDED (rollout-tabs item 6, 2026-10-25). The
	 * signed phone model is plain flow with no inner scroller (above), which
	 * was written for "dozens to a few hundred lines"; a 672-line buffer drew
	 * 672 rows and a 30,229px document. The phone keeps that model but renders
	 * only the newest `PHONE_PAGE` rows, then a `.btn-secondary` fold ("Show
	 * 100 earlier lines", the product's fold) that reveals the next page. The
	 * list is newest first, so what is cut is always the oldest. Jumping to a
	 * line in context widens the window to include it first.
	 */
	const PHONE_PAGE = 100;
	let phoneLimit = $state(PHONE_PAGE);
	const phoneRowsShown = $derived(phoneRows.slice(0, phoneLimit));
	const phoneRowsHidden = $derived(Math.max(0, phoneRows.length - phoneLimit));

	$effect(() => {
		if (typeof window === 'undefined' || !paneRootEl) return;
		const el = paneRootEl;
		function recompute() {
			const BOTTOM_GUTTER = 16;
			// From `sm` up `<main>` is the scroller (root layout, 2026-09-04): the
			// room left is measured inside IT, not the viewport, and its own
			// scrollTop stands in for `window.scrollY`.
			const main = el.closest('#main-content') as HTMLElement | null;
			if (main && getComputedStyle(main).overflowY === 'auto') {
				const mainRect = main.getBoundingClientRect();
				const topInMain = el.getBoundingClientRect().top - mainRect.top + main.scrollTop;
				// 24, not 16: measured 8px of leftover scroll in <main> at 16 — the
				// rollout layout's own bottom rhythm below this pane.
				paneMaxHeight = Math.max(240, mainRect.height - topInMain - BOTTOM_GUTTER - 8);
				return;
			}
			const docTop = el.getBoundingClientRect().top + window.scrollY;
			const tabbarH =
				parseFloat(
					getComputedStyle(document.documentElement).getPropertyValue('--tabbar-h')
				) || 0;
			paneMaxHeight = Math.max(240, window.innerHeight - docTop - tabbarH - BOTTOM_GUTTER);
		}
		recompute();
		window.addEventListener('resize', recompute);
		/**
		 * ⭐ A SECOND MEASUREMENT, NOT ONLY ON `resize` (fixing a latent gap
		 * exposed by `MIN_PANE_HEIGHT` always filling the viewport — SPEC.md
		 * §2). A mount-time `getBoundingClientRect()` can land BEFORE the
		 * page's own layout has settled (web fonts swapping in, the
		 * breadcrumb/title row's own wrap decision, `<main>`'s own
		 * scrollbar appearing) — none of which fires a `resize` event, so
		 * `paneMaxHeight` could freeze on a stale, too-large number from
		 * that first paint. The gap was invisible while this pane shrunk
		 * to content most of the time (TL round 3/4's old rule); now that
		 * it always fills `paneMaxHeight`, a stale measurement runs the
		 * card's own bottom edge — footer included — past the real
		 * viewport. A `ResizeObserver` on `<main>` (falling back to one
		 * more `requestAnimationFrame` pass where there is no scrolling
		 * `<main>` to observe) catches exactly that class of change.
		 */
		const main = el.closest('#main-content') as HTMLElement | null;
		let ro: ResizeObserver | undefined;
		if (main && typeof ResizeObserver !== 'undefined') {
			// Catches `<main>`'s own size changing (a scrollbar appearing, a
			// viewport resize `resize` alone would also catch).
			ro = new ResizeObserver(() => recompute());
			ro.observe(main);
		}
		// Catches content ABOVE this pane settling after first paint (web
		// fonts swapping in, the breadcrumb/title row's own wrap decision)
		// — none of which changes `<main>`'s own size, only WHERE this pane
		// starts inside it.
		const raf = requestAnimationFrame(recompute);
		document.fonts?.ready?.then(recompute).catch(() => {});
		return () => {
			window.removeEventListener('resize', recompute);
			ro?.disconnect();
			cancelAnimationFrame(raf);
		};
	});

	/**
	 * ⭐ THE PANE IS SIZED TO ITS OWN CONTENT, CAPPED BY THE VIEWPORT — NOT
	 * ALWAYS THE FULL VIEWPORT. (2026-10-08, TL review round 3, QA-2)
	 * `paneMaxHeight` above is a CEILING (how much room the viewport can
	 * spare), not a target — forcing the pane to exactly that height
	 * unconditionally left a 3-line stream sitting in a well the height of
	 * the screen. `toolbarEl`'s own measured height (it wraps to more rows
	 * at narrow widths or once pod/container pill groups appear, so this
	 * cannot be a constant) plus the Card's fixed 47px header and (when
	 * present) the 44px "Pods/Tests" tabs strip is the CHROME this pane
	 * always pays for; what is left goes to the well, sized to its own
	 * content — `ROW_HEIGHT × row count` for a real stream, a fixed
	 * comfortable minimum for the connecting/error/empty states — and never
	 * beyond what `paneMaxHeight` leaves for it. A long stream still grows
	 * to the cap and scrolls internally exactly as before; a short one no
	 * longer does.
	 */
	let toolbarEl: HTMLDivElement | undefined = $state();
	/** The console's own floor (SPEC.md §2, logs redesign 2026-10-09:
	 *  "It fills the viewport … (min 480px)"). Superseding TL review round
	 *  3/4's "shrink to content" rule below `paneMaxHeight` — Railway and
	 *  Linear's log panes are always a full console, not a box that
	 *  collapses around a two-line buffer, and a console that shrinks on a
	 *  quiet rollout is exactly the "looks like a debug panel" defect the
	 *  squad lead's brief calls out. The well (`flex-1 min-h-0` below) now
	 *  simply fills whatever this leaves it, through ordinary flex layout —
	 *  no more hand-computed row-count arithmetic to keep in sync with it. */
	const MIN_PANE_HEIGHT = 480;

	const appliedPaneHeight = $derived.by((): number | null => {
		if (paneMaxHeight == null) return null;
		return Math.max(MIN_PANE_HEIGHT, paneMaxHeight);
	});

	/**
	 * ⭐ THE MESSAGE COLUMN'S OWN CHARACTER BUDGET — MEASURED, NOT GUESSED.
	 * (2026-09-12, L5) `maxMessageChars` bounds `truncateAtWordBoundary`
	 * above. It has to track the ACTUAL width available to the message span,
	 * which moves with the sidebar, the viewport, which columns are visible,
	 * and single-pod mode — so it is read off a real rendered row after
	 * paint, not derived from a breakpoint table. The font is monospace, so
	 * a canvas `measureText` on one repeated glyph is an EXACT character
	 * width for the row's own computed font, not an estimate.
	 *
	 * Skipped entirely while `wrapLines` is on: a wrapped line is never
	 * truncated, so there is nothing here to measure for.
	 */
	let maxMessageChars = $state(400);
	let measureCanvasCtx: CanvasRenderingContext2D | null = null;

	function charWidthForFont(font: string): number {
		if (typeof document === 'undefined') return 7.2;
		if (!measureCanvasCtx) {
			measureCanvasCtx = document.createElement('canvas').getContext('2d');
		}
		if (!measureCanvasCtx) return 7.2;
		measureCanvasCtx.font = font;
		const sample = '0'.repeat(40);
		return measureCanvasCtx.measureText(sample).width / 40;
	}

	$effect(() => {
		if (typeof window === 'undefined' || wrapLines) return;
		// Tracked on purpose — a column toggle, a pod-mode flip, or the
		// pane's own height/width settling all change how much room the
		// message span actually has, and each should re-measure.
		void visibleColumns;
		void singlePodMode;
		void paneMaxHeight;
		void virtualItems.length;
		const scrollEl = virtualListEl;
		if (!scrollEl) return;
		function recomputeCharBudget() {
			const row = scrollEl?.querySelector('[data-index]') as HTMLElement | null;
			const msg = row?.querySelector('[data-role="log-message"]') as HTMLElement | null;
			if (!row || !msg) return;
			const rowRect = row.getBoundingClientRect();
			const msgRect = msg.getBoundingClientRect();
			const available = rowRect.right - msgRect.left - 4; // small safety gutter
			const cs = getComputedStyle(msg);
			const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
			const cw = charWidthForFont(font);
			if (available > 0 && cw > 0) {
				maxMessageChars = Math.max(12, Math.floor(available / cw));
			}
		}
		recomputeCharBudget();
		window.addEventListener('resize', recomputeCharBudget);
		return () => window.removeEventListener('resize', recomputeCharBudget);
	});
</script>

<!-- `min-h-0 flex-1`, NOT `h-full`. The Logs tab hands this component a flex
     column whose height comes from `flex-1`, and a percentage height inside
     that resolved to the header's own 150px — the virtual list beneath it
     measured 0px tall and the tab printed "378 lines" over an empty pane.

     ⚠️ `flex: none` OVERRIDES `flex-1` THE INSTANT `paneMaxHeight` IS KNOWN.
     (2026-09-03, scroll model rewrite) `flex-1` is `flex: 1 1 0%` — that
     `0%` FLEX-BASIS, not the `height` property, is what a flex item uses as
     its hypothetical main size, and it wins over an inline `height` on the
     SAME element. With an unbounded ancestor (see the `$effect` above)
     there is no extra space for `flex-grow` to distribute, so the element
     rendered at its `shrink-0` header's own content height — 173px, not
     the 712px `paneMaxHeight` had just computed — and the `height` in the
     `style` attribute below sat there doing nothing. `flex: none` (`flex:
     0 0 auto`) makes `flex-basis` defer to the `height` property instead,
     so the explicit pixel height actually wins regardless of what the
     ancestor's own (now-unbounded) flex context does with it. -->
<!--
	⭐ ONE CARD IS THE CENTREPIECE NOW — TOOLBAR AND WELL TOGETHER.
	(2026-10-08, design-language pass) The toolbar used to sit ABOVE a
	bordered, headerless pane (`COMPOSITION-GRAMMAR.md` §1's "a panel with
	no header and no rollup is the shape that keeps getting rejected" —
	defect #3) as a second, separate box. It is one `Card` now: icon + title
	+ rollup (the figures + the connection dot) in the 47px header, the
	pill toolbar directly under it (still inside the card, its own
	`border-b`), then whichever state owns the rest of the body.
	`padded={false}` because both the toolbar and the well want to run to
	the card's own edges — the toolbar supplies its own `px-4 py-3`, the
	well supplies none (it is the one object that runs edge to edge), and
	the connecting/error/empty states supply their own centred padding.
-->
<!-- ⭐ `isPhone` SPLITS THE HEIGHT MODEL TOO (art director round 1,
     must-fix #5: "no inner scroller… the document scrolls"). Fixed
     `height`/`max-height`/`overflow-hidden` is what GIVES the well
     below something to scroll independently of the page — exactly the
     "nested 297px scroller" the AD measured as a scroll trap. At phone
     this is `min-height` only, with `overflow-hidden` dropped: the card
     can grow past `appliedPaneHeight` when its (now unvirtualized, see
     the well's own branch) content needs more room, and the DOCUMENT
     scrolls through that, the product's one standard scroll model below
     `sm`. -->
<!-- ⭐ THE ONE COUNT LINE (LOGOPEN round 7, items 3 and 4). Desktop: the
     32px footer under the well. Phone: the same line directly under the
     histogram, because a newest-first list ends at the top. "Show all
     lines" lives here, and is 44px tall on the phone. -->

{#snippet countLine(position: 'top' | 'bottom')}
	<div
		class="flex shrink-0 items-center gap-1 px-4 {position === 'bottom'
			? 'border-t border-line py-1'
			: 'border-b border-line-subtle py-0'}"
	>
		<p class="t-meta text-fg-subtle" data-count-line>{footerLineLabel}</p>
		{#if footerShowsAll}
			<span class="t-meta text-fg-subtle" aria-hidden="true">·</span>
			<button type="button" class="nav-link t-meta py-0 max-sm:py-3.5" onclick={clearFilters}
				>Show all lines</button
			>
		{/if}
	</div>
{/snippet}

<div
	bind:this={paneRootEl}
	class="flex min-h-0 flex-1 flex-col {isPhone ? '' : 'overflow-hidden'}"
	style={appliedPaneHeight != null
		? isPhone
			? `flex: none; min-height: ${appliedPaneHeight}px;`
			: `flex: none; height: ${appliedPaneHeight}px; max-height: ${appliedPaneHeight}px;`
		: ''}
>
	<Card
		icon={filterType === 'test' ? FlaskOutline : TerminalOutline}
		title={filterType === 'test' ? 'Test output' : 'Output'}
		padded={false}
		bodyClass="flex min-h-0 flex-1 flex-col lg:flex-row"
		class="min-h-0 flex-1"
	>
		{#snippet rollup()}
			<!-- LOGOPEN round 7, item 2: no "Live" and no counts before the
			     first batch. "Live · 0 lines" on a stream that is still
			     delivering its backlog is a claim the next frame retracts. -->
			{#if awaitingFirstBatch}
				<span class="skel-block inline-block w-28" style="height: 12px" aria-hidden="true"></span>
				<span class="sr-only">Loading log lines</span>
			{:else}
			<!-- ⭐ ONE DOT, SOLID (art director round 2, must-fix: "'Live' uses
			     a solid success dot"). Used to be TWO competing marks — a
			     separate hollow/filled "stale-aware" ring (`rollupDot`) ahead
			     of the word, plus the word's own tone with no dot of its own.
			     `rollupDot`'s richer, stale-aware sentence survives as this
			     ONE dot's `title` (a hover still gets "Streaming — last line
			     2m ago"); the glance-scale read is now unambiguous: solid,
			     one colour, one meaning. Not shown while `connecting` — the
			     spinner beside the word already carries that state, louder. -->
			<div class="dot-list">
				<div class="dot-list-row flex flex-wrap items-center">
			<span
				class="t-ui-sm inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap {liveMark.tone ===
				'success'
					? 'text-success'
					: liveMark.tone === 'danger'
						? 'text-danger'
						: liveMark.tone === 'active'
							? 'text-active'
							: 'text-fg-subtle'}"
			>
				{#if liveMark.spinner}
					<StatusSpinner size="3" color={liveMark.tone === 'active' ? 'blue' : 'gray'} />
				{:else}
					<span
						class="inline-flex h-2 w-2 shrink-0 rounded-full {liveMark.tone === 'success'
							? 'bg-success-solid'
							: liveMark.tone === 'danger'
								? 'bg-danger-solid'
								: liveMark.tone === 'active'
									? 'bg-active-solid'
									: 'bg-fg-disabled'}"
						title={rollupDot.label}
						aria-hidden="true"
					></span>
				{/if}
				{liveMark.label}
			</span>
			<!-- ⛔ GATED THE SAME AS THE DOT ITSELF. An earlier pass left this
			     unconditional, which rendered "Connecting to pods…" a SECOND
			     time (this `sr-only` span, text-identical to the pane's own
			     real connecting caption) and broke a test asserting there is
			     exactly one. -->
			{#if !liveMark.spinner}
				<span class="sr-only">{rollupDot.label}</span>
			{/if}
			<!-- ⭐ ONE `.dot-list` FOR THE FIGURES (must-fix #8: "mixes `·`
			     and bare spaces" — this is the one real dot-list separator
			     the design language already has a component for, not a
			     hand-rolled " · " string). -->

					<!-- LOGOPEN r8, item 5: each count once. The pod count lives in
					     the page header's meta and the line counts in the footer;
					     the rollup reads "● Live · 48 errors". -->
					<!-- ⭐ A `.nav-link`, NOT A 16px-TALL BUTTON STYLED AS TEXT
					     (must-fix #8). (2026-09-03, design pass 6, operator-walk
					     finding #3c) A traceback could sit in the buffer with no
					     count anywhere on screen; this toggles the SAME `Level`
					     filter the pill row below applies — one control, two
					     entry points, not a second filter mechanism. The one hue
					     this header spends: error is a mark that needs a person,
					     so it alone is `text-danger`. -->
					<!-- LOGOPEN r8 (coordinator): the error count is stated once, by
					     the histogram's lead number 60px below. The rollup is the
					     connection state alone. -->
				</div>
			</div>
			{/if}
		{/snippet}

		<!--
			⭐ THE SOURCES PANE (SPEC.md §2, logs redesign 2026-10-09): the
			card's own master/detail, Railway's left rail over its console.
			REPLACES the Pods/Tests toggle pair at ≥1024 — the source list IS
			the filter, so there is no second control elsewhere on the page
			doing the same job. `lg:flex`/`hidden`: below that width it folds
			back to the toggle + pill row inside the toolbar instead (kept,
			`lg:hidden` below) rather than a 240px column stealing a third of
			a 768px tablet's own width from the console it exists to narrow.

			⛔ WHY THE "Pods" SECTION CAN GO QUIET ON THE Tests VIEW, AND
			VICE VERSA. `discoveredPods` is populated by the ONE live SSE
			connection this component holds (`logsStreamQueryOptions`), and
			that connection is itself scoped to `filterType` on the wire
			(`createLogsStreamUrl`'s own `filterType` query param) — there is
			no second, always-open connection to ask "what pods exist" while
			looking at test output. Clicking "All pods" while on Tests still
			switches the view (`onSelectView`), the same as the old toggle
			button did; the pod ROWS beneath it repopulate the instant that
			new connection's own `pods` event arrives, same timing as today.
			`testRuns` is NOT under this constraint — it is a plain REST
			query (`rolloutTestsQuery`, now always enabled, not gated on
			`filterType`), so the Tests section stays populated from either
			view.
		-->
		<!-- ⭐ `lg:self-start`, NOT STRETCHED TO THE CARD'S FULL HEIGHT (art
		     director round 1, must-fix #6, 2026-10-09 re-review: "At 1440
		     the pane is 240×585 and holds 3 pod rows… the pane has no
		     reason to be 240px [tall]"). `flex-row`'s default
		     `align-items: stretch` is what matched this column to the
		     well's own height; `self-start` takes it out of that stretch
		     and back to its own content height instead — still capped by
		     `max-h-full` + its own scroll for the rare case Pods + Tests +
		     "This build" genuinely runs past the card. `overflow-y-scroll`,
		     NOT `overflow-y-auto` — the test file's own `nudge`/
		     `nudgeVirtualizer` helpers grab `.overflow-y-auto` to find the
		     LOG WELL's scroller (`container.querySelector('.overflow-y-
		     auto')`, first match wins); this element sitting earlier in
		     the DOM with that same class already broke every row-rendering
		     test once before (logs round 2) for exactly this reason. -->
		<aside
			class="hidden max-h-full w-60 shrink-0 flex-col overflow-y-scroll border-r border-line py-2 lg:flex lg:self-start"
		>
			<div class="px-3 pt-1 pb-1">
				<span class="t-label text-fg-subtle">Pods</span>
			</div>
			<!-- ⭐ THE SELECTED MARKER IS `border-l-2`, FLUSH WITH THE ROW'S
			     OWN LEFT EDGE (squad-rollout coordinator review, 2026-10-09:
			     "the 'All pods' selected marker should be the 2px square
			     marker at the row's left edge, flush, not an inset bar"). A
			     transparent 2px border at rest (not `border-l-0`) keeps every
			     row's text starting at the same x whether or not it is
			     selected — only the colour changes, never the layout. -->
			<button
				type="button"
				class="flex min-h-[32px] w-full items-center gap-2 border-l-2 py-1 pr-3 pl-2.5 text-left {filterType ===
					'pod' && selectedPods.size === 0
					? 'border-l-fg bg-selected'
					: 'border-l-transparent hover:bg-hover'}"
				onclick={() => {
					onSelectView?.('pod');
					selectedPods = new Set();
				}}
			>
				<span class="t-ui-sm truncate text-fg">All pods</span>
			</button>
			{#each podSidebarRows as pod}
				{@const selected = filterType === 'pod' && selectedPods.has(pod.name)}
				{@const podParts = podNameParts(pod.name)}
				<!-- ⭐ "12m · 0 restarts" WHEN THE PAYLOAD HAS IT (AD round 2,
				     "also" bullets) — `ageSeconds`/`restarts` are optional,
				     additive fields on `PodInfo` (see that type's own doc);
				     the live backend does not send them today, so this is
				     `null` on every real pod right now and the row falls
				     back to showing only the age it CAN know (none, in that
				     case — no age fabricated either). -->
				<!-- LOGOPEN, item 7: the age ticks (`startedAt` is stamped on
				     arrival, see `discoveredPods`) and every source row, pod
				     or test, is one format: dot · name (flex) · "age · fact". -->
				{@const podAge =
					pod.startedAt != null
						? formatTimeAgoCompact(new Date(pod.startedAt).toISOString(), $now)
						: null}
				{@const restarts = pod.restarts ?? 0}
				<button
					type="button"
					class="flex min-h-[32px] w-full items-center gap-2 border-l-2 py-1 pr-3 pl-2.5 text-left {selected
						? 'border-l-fg bg-selected'
						: 'border-l-transparent hover:bg-hover'}"
					title={pod.name}
					onclick={() => {
						onSelectView?.('pod');
						selectedPods = new Set([pod.name]);
					}}
				>
					<!-- ⭐ A REST DOT, NOT A GUESS — AND NOT A HUE (AD round 3,
					     item 3: "Pod source dots are neutral at rest"). This
					     used to be `bg-success-solid`, which is a CLAIM
					     ("healthy") this dot has no evidence for — there is
					     no readiness signal on the wire. `fg-disabled` (the
					     ramp's own "nothing to report" step, DESIGN-
					     LANGUAGE.md §2.4) marks presence without asserting a
					     status this view cannot actually see; it never
					     claims crash-looping or deploying either, in either
					     direction. -->
					<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-disabled" aria-hidden="true"
					></span>
					<!-- ⭐ SUFFIX ONLY (coordinator review: "the pod rows
					     truncate to 'checkout-worker-a02f1c4-5d…'. Show the
					     suffix as the row name"), same differentiator
					     `podNameParts` already gives the log rows; the full name
					     is still in `title`. -->
					<span class="t-ui-sm min-w-0 flex-1 truncate text-fg-subtle">{podParts.suffix}</span>
					{#if podAge}
						<span class="t-meta shrink-0 tabular-nums text-fg-subtle"
							>{podAge} · <span class={restarts > 0 ? 'text-danger' : ''}
								>{restarts} restart{restarts === 1 ? '' : 's'}</span
							></span
						>
					{/if}
				</button>
			{/each}
			{#if testRuns.length > 0}
				<div class="mt-2 border-t border-line-subtle px-3 pt-3 pb-1">
					<span class="t-label text-fg-subtle">Tests</span>
				</div>
				{#each testRuns as t (t.key)}
					<button
						type="button"
						class="flex min-h-[32px] w-full items-center gap-2 border-l-2 py-1 pr-3 pl-2.5 text-left {filterType ===
						'test'
							? 'border-l-fg bg-selected'
							: 'border-l-transparent hover:bg-hover'}"
						title={t.name}
						onclick={() => onSelectView?.('test')}
					>
						<span
							class="h-1.5 w-1.5 shrink-0 rounded-full {t.phase === 'Failed'
								? 'bg-danger-solid'
								: t.phase === 'Succeeded'
									? 'bg-success-solid'
									: 'bg-fg-subtle'}"
							aria-hidden="true"
						></span>
						<span class="t-ui-sm min-w-0 flex-1 truncate text-fg-subtle"
							>{truncateMiddle(t.name, 14)}</span
						>
						<span class="t-meta shrink-0 tabular-nums text-fg-subtle"
							>{t.ageLabel} · <span class={t.phase === 'Failed' ? 'text-danger' : ''}
								>{t.phase === 'Succeeded' ? 'passed' : t.phase === 'Failed' ? 'failed' : t.phase === 'Cancelled' ? 'cancelled' : 'running'}</span
							></span
						>
					</button>
				{/each}
			{/if}
			{#if buildFacts.length > 0}
				<!-- ⭐ "This build" (art director round 1, must-fix #6). The one
				     thing in this pane that is NOT a row to click — a record,
				     so `FactList` (the product's one component for exactly
				     this), not another button list. -->
				<div class="mt-2 border-t border-line-subtle px-3 pt-3 pb-1">
					<span class="t-label text-fg-subtle">This build</span>
				</div>
				<div class="px-3 pb-1">
					<FactList facts={buildFacts} />
				</div>
			{/if}
		</aside>

		<div class="flex min-h-0 flex-1 flex-col">
		<!--
			⭐ THE TOOLBAR, RECOMPOSED TO ONE ROW (2026-10-08, design-language
			pass, TL review round 2 — was four stacked rows before the first
			log line). `RolloutGrid.svelte`'s own filter-bar shape, copied
			exactly: an outer `flex flex-wrap` row holds the search box
			(`relative w-full sm:w-72 sm:flex-none` — fixed width once there
			is room), the pill groups (their OWN horizontally-scrolling wrap
			container, unchanged from round 1), and the view-action cluster
			(Follow/Wrap/Copy/Columns, `ml-auto` so it floats right whenever
			the line has room and starts its own line when it does not — the
			same single-flex-item rule `Card.svelte`'s own header rollup
			relies on for the identical "hard right when it fits, flush left
			when it wraps" behaviour). At ≥1024 everything shares the one
			line; below `sm` it still wraps/scrolls exactly `/rollouts`' own
			bar.

			Flowbite `Dropdown`/`Checkbox` menus for Source/Containers/Log
			Levels are still gone — `.pill` + `aria-pressed` (round 1). Pod
			and container groups now hide themselves when there is only ONE
			value to filter by (a filter with one possible answer filters
			nothing); Columns moved OUT of the pill row entirely — showing
			or hiding a column is a view SETTING, not a filter, and four
			solid "all pressed" pills for a fact nobody asked about was the
			loudest thing in the toolbar for no reason. It is a popover now
			(`.btn-ghost.btn-sm` trigger, `bg-overlay` panel — the no-dropdown
			rule is for rollout-list FILTERS, not a settings menu with a
			fixed, small, always-the-same item count).
		-->
		<!-- ⛔ NOT ACTUALLY STICKY AT PHONE YET (logs round 8, item 1
		     asked for "a compact sticky control row"). Tried `max-sm:sticky
		     max-sm:top-[52px]`: it did nothing, because `Card.svelte`'s own
		     root carries an unconditional `overflow-hidden` (for its
		     rounded corners) — an ancestor with `overflow` other than
		     `visible` breaks `position: sticky` for every descendant, full
		     stop, not just at phone. Fixing it means either the Card
		     dropping `overflow-hidden` at phone (Card.svelte, a shared
		     component this lane does not own — rounding radii apply to
		     every Card on every page) or lifting this toolbar out of the
		     Card entirely to a `position: fixed` bar (a materially
		     different layout, not attempted this round). `bg-surface`
		     stays — it was already correct for a sticky bar and is
		     harmless in plain flow. The "↓ Latest" button a few lines
		     down still WORKS (it is not sticky-dependent — it calls
		     `jumpToLatest`, which `scrollIntoView`s `phoneLogsEndEl`
		     regardless of where this row itself is on screen when
		     pressed); it simply is not always ON screen the way a sticky
		     row would keep it. -->
		<div
			bind:this={toolbarEl}
			class="flex flex-shrink-0 flex-col gap-2 border-b border-line bg-surface px-4 py-0.5 max-sm:py-[5.5px] sm:py-1"
		>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
				<!-- ⭐ Pods/Tests LIVES IN THE TOOLBAR, NOT THE CARD HEADER (TL
				     review round 4: a Card header is 47px everywhere in the
				     product, and this control — even shrunk — pushed it to
				     52-77px here, the one Card in the product that wasn't 47).
				     Moving it out fixes that AND the 390 icon-alignment defect
				     it caused in the same stroke: the header's own remaining
				     content (title + rollup facts) is short enough to hold one
				     line again, so the icon's vertical centring lines up with
				     the title's single line, not the midpoint of a two-line
				     block.

				     ⭐ `btn btn-ghost btn-xs` + `aria-pressed`, NOT `.pill` (TL
				     round 4: `.pill` is the FILTER grammar everywhere else in
				     this toolbar — drawing a VIEW SWITCH in it read as "filter
				     by Pods", which it is not). The shared
				     `.btn[aria-pressed='true']` selected wash (added to
				     `app.css` by the TL) is the same "this is the current
				     view" treatment Follow/Wrap already use. `role="group"`,
				     not `role="tablist"` — a tablist commits a keyboard
				     contract (arrow-key roving focus) this two-button toggle
				     does not implement; Tab already reaches both buttons and
				     Enter/Space already activates them. No remount lives
				     behind this any more (round 3), so moving its markup here
				     changes nothing about focus retention on a switch. -->
				{#if onSelectView}
					<!-- ⭐ `lg:hidden` (SPEC.md §2): the Sources pane (the new
					     `<aside>` above) is this exact control, redrawn as the
					     card's own master/detail, from 1024 up. Below that it
					     stays here — "below 1024 the pane becomes one
					     horizontally scrolling `.pill` row under the toolbar"
					     is this same toggle plus the pod pill group just below
					     it, both already inside the toolbar's own horizontal
					     scroller. -->
					<!-- ⭐ SHARES THE ONE 44px ROW NOW (art director round 2,
					     must-fix: "Pods/Tests and Filters on ONE 44px row").
					     Used to force itself onto its own full-width line
					     below 640 (`max-sm:w-full`, logs round 2) — that is
					     exactly the SECOND row the AD's own measurement
					     counted as part of the 186px of chrome eating the
					     fold. `max-sm:order-1` puts it first among the
					     row's three items (itself, search, Filters) without
					     reserving a whole line for it. -->
					<div
						class="flex shrink-0 items-center gap-1 max-sm:order-1 lg:hidden"
						role="group"
						aria-label="Log source"
					>
						<button
							type="button"
							class="btn btn-ghost btn-xs max-sm:h-11 max-sm:px-3"
							aria-pressed={filterType === 'pod'}
							onclick={() => onSelectView?.('pod')}
						>
							Pods
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-xs max-sm:h-11 max-sm:px-3"
							aria-pressed={filterType === 'test'}
							onclick={() => onSelectView?.('test')}
						>
							Tests
						</button>
					</div>
				{/if}
				<!-- ⭐ `max-sm:flex-1`, NOT `max-sm:w-full` (coordinator, logs
				     round 2: "Row 1 is search (flex-1) + Follow / Wrap / Copy
				     icon buttons"). Full width used to force search onto its
				     own line, which is exactly what pushed the view-action
				     icons three rows down. Sharing the line with them needs
				     search to take only what they do not — `flex-1`, the same
				     role it already has in this row from `sm` up (just
				     unconditional now, not gated to ≥640). -->
				<div class="relative max-sm:order-2 max-sm:flex-1 sm:w-72 sm:flex-none">
					<SearchOutline
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-fg-subtle"
					/>
					<!-- ⭐ `.input-sm` (32px) — ONE CONTROL HEIGHT ACROSS THE TOOLBAR
					     (TL round 3). Was the standalone 36px `.input`, the only
					     control in this row not already on the toolbar's own 32px
					     step (`.btn-sm`, `.btn-icon.btn-sm`). -->
					<!-- ⭐ "Search", NOT "Search logs…" (logs round 8, item 4:
					     "search placeholder 'Search'") — the field already
					     sits in a labelled search-icon slot inside an
					     "Output"/"Test output" card; "logs" in the
					     placeholder restated what the card already says,
					     and at phone width it was also the first thing
					     truncated. `aria-label` keeps the fuller "Search
					     logs" — a screen reader announces it with no
					     surrounding card context to supply "logs" the way a
					     sighted reader gets for free. -->
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Search"
						aria-label="Search logs"
						class="input input-sm pl-9 max-sm:h-11 {searchQuery ? 'pr-11 sm:pr-9' : ''}"
					/>
					{#if searchQuery}
						<button
							type="button"
							class="btn btn-ghost btn-icon btn-xs absolute top-1/2 right-1 -translate-y-1/2 max-sm:h-10 max-sm:w-10"
							onclick={() => (searchQuery = '')}
							aria-label="Clear search"
						>
							<CloseOutline />
						</button>
					{/if}
				</div>

				<!-- ⭐ THE FILTERS SHEET BUTTON (art director round 1, must-fix
				     #5: "search plus a filter-sheet button showing the
				     active-level count"). Phone only — ≥640 keeps the level
				     pills always visible in the shared row below, same as
				     today. Toggles `mobileFiltersOpen`, which is what reveals
				     the (otherwise identical) pill row immediately after this
				     one in document order. -->
				<button
					type="button"
					class="btn btn-secondary btn-sm relative hidden shrink-0 max-sm:order-3 max-sm:flex max-sm:h-11"
					aria-expanded={mobileFiltersOpen}
					aria-pressed={selectedLogLevels.size > 0}
					onclick={() => (mobileFiltersOpen = !mobileFiltersOpen)}
				>
					Filters
					{#if selectedLogLevels.size > 0}
						<!-- ⭐ A BADGE, NOT INLINE TEXT (AD round 3, item 2: "an
						     active-count badge on Filters") — was
						     `Filters (${n})` growing the button's own width
						     with the count; a badge sits on a FIXED-width
						     button instead. Same corner-badge geometry this
						     file's own "Scroll to latest" button already uses
						     below (`t-label` + `-top-1.5 -right-1.5` +
						     `bg-active-solid`/`text-white`), not a second
						     badge style. -->
						<span
							class="t-label absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-active-solid px-1 text-white"
							aria-hidden="true"
						>
							{selectedLogLevels.size}
						</span>
					{/if}
				</button>

				<!-- The phone "↓ Latest" control moved OUT of this row (logs
				     round 9, squad-rollout lead) — a fixed floating button
				     near the tab bar instead, see its own markup further
				     down, so it is reachable regardless of where this
				     toolbar is scrolled to (this row was never actually
				     sticky — see its own doc above). -->

				<!-- ROW 2, BEHIND THE Filters BUTTON AT PHONE (art director
				     round 1, must-fix #5). Was always-visible at phone (logs
				     round 2); now the SAME row only paints there once
				     `mobileFiltersOpen` is true, which is the whole point of
				     a filter-SHEET button — the control row stays one row
				     until a reader actually asks for the pills. `max-sm:order-3`
				     still places it right after search/Filters when it IS
				     open. Unchanged from `sm` up: always visible, its own
				     line as before. The scroll/no-wrap/no-visible-scrollbar
				     behaviour and the 16px edge fade (a `mask-image` on the
				     container, which has to follow scroll content wider than
				     the viewport) are both unchanged from logs round 2. -->
				<div
					class="no-scrollbar -mx-4 {mobileFiltersOpen
						? 'flex'
						: 'hidden'} w-[calc(100%+2rem)] min-w-0 items-center gap-1.5 overflow-x-auto px-4 max-sm:order-4 max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)] sm:mx-0 sm:flex sm:w-auto sm:flex-1 sm:flex-wrap sm:gap-x-4 sm:gap-y-2 sm:overflow-visible sm:px-0 sm:[mask-image:none]"
				>
					<div class="flex shrink-0 items-center gap-1.5 sm:flex-wrap" role="group" aria-label="Filter by level">
						<!-- ⭐ A DOT + A COUNT, AND A ZERO-COUNT LEVEL IS DISABLED, NOT
						     HIDDEN (SPEC.md §2). Hiding a level pill used to make the
						     row of filters shuffle as the buffer filled in (Debug
						     appearing a few seconds after Info, Warning sometimes
						     never) — a reader could not learn "there's no Warning
						     pill" from "I haven't looked yet". A disabled pill states
						     the same fact without moving anything else in the row. -->
						{#each [{ value: 'error', label: 'Error', dot: 'bg-danger-solid' }, { value: 'warn', label: 'Warning', dot: 'bg-line-strong' }, { value: 'info', label: 'Info', dot: 'bg-fg-subtle' }, { value: 'debug', label: 'Debug', dot: 'bg-fg-subtle' }] as level}
							{@const v = level.value as 'error' | 'warn' | 'info' | 'debug'}
							{@const selected = selectedLogLevels.has(v)}
							{@const count = levelCounts[v]}
							<button
								type="button"
								class="pill"
								aria-pressed={selected}
								disabled={count === 0 && !awaitingFirstBatch}
								onclick={() => {
									if (selectedLogLevels.has(v)) {
										selectedLogLevels.delete(v);
									} else {
										selectedLogLevels.add(v);
									}
									selectedLogLevels = new Set(selectedLogLevels);
								}}
							>
								<span class="status-dot {level.dot}" aria-hidden="true"></span>
								{level.label}
								{#if !awaitingFirstBatch}
									<span class="tabular-nums text-fg-subtle">{count}</span>
								{/if}
							</button>
						{/each}
					</div>
					<!-- ⭐ A FILTER WITH ONE POSSIBLE ANSWER FILTERS NOTHING. `> 1`,
					     not `> 0` (round 1) — a single-pod or single-container
					     rollout (most of them) showed a one-pill "filter" that
					     could only ever do nothing. -->
					{#if uniquePods.length > 1}
						<!-- `lg:hidden` — see the toggle group's own note just
						     above; the Sources pane is this same choice from
						     1024 up. Single-select now (SPEC.md §2: "the source
						     list IS the filter"), matching the sidebar's rows
						     one-for-one — a second click on the SAME pod clears
						     back to "All pods" rather than needing a tap on
						     each pill to undo a multi-select. -->
						<div
							class="flex shrink-0 items-center gap-1.5 sm:flex-wrap lg:hidden"
							role="group"
							aria-label="Filter by pod"
						>
							{#each uniquePods as pod}
								{@const selected = selectedPods.has(pod.name)}
								<button
									type="button"
									class="pill"
									aria-pressed={selected}
									onclick={() => {
										selectedPods = selected ? new Set() : new Set([pod.name]);
									}}
								>
									{pod.name}
								</button>
							{/each}
						</div>
					{/if}
					<!-- ⭐ THE CONTAINER PILL GROUP IS GONE (art director round 1,
					     must-fix #7: "the toolbar wraps into two rows (container
					     chips `app` / `test-runner`)… Container chips move into
					     the column header or the sources pane, and the toolbar
					     stays one 48px row"). The Container COLUMN (hidden only
					     when there is just one, `singleContainerMode`) already
					     names every row's container; a second control doing the
					     same job as a filter is what forced this bar to wrap on
					     the Tests view, the one place a rollout genuinely has
					     more than one. `selectedContainers` itself is unchanged
					     (`applyNonSearchFilters` still honours it) — only the
					     TOOLBAR affordance for setting it is removed, since
					     filtering by container was never the common case this
					     bar needed to spend a whole extra line on. -->
				</div>

				<!-- View actions — Follow / Wrap / Copy / Columns. `ml-auto`:
				     hard right on the shared line, flush left on its own
				     wrapped line, the same single-item `space-between` rule
				     `Card.svelte`'s header rollup already relies on.
				     `max-sm:hidden` (art director round 1, must-fix #5: "one
				     44px control row — search plus a filter-sheet button").
				     These used to share that row with search; the AD's own
				     target has NOTHING else on it. Follow keeps working
				     exactly as before with no visible toggle — the stream
				     still follows by default and the footer's own "Jump to
				     latest" is still the way back once a reader scrolls
				     away; Wrap/Copy/Columns are desktop-density conveniences
				     a phone reader does not need removed to read a line. -->
				<div class="ml-auto hidden shrink-0 items-center gap-1 sm:flex">
					<!-- ⭐ ONE 28px CONTROL HEIGHT IN THIS BAR (art director round
					     1, must-fix #9: "Level pills are 28px, icon buttons
					     32px… one 28px control height"). `btn-xs`/`btn-icon
					     btn-xs`, matching `.pill`'s own 28px, not `btn-sm`'s
					     32px — Follow/Wrap are still two-state toggles,
					     `aria-pressed` still draws the ON state via the shared
					     `.btn[aria-pressed='true']` rule. -->
					<button
						type="button"
						class="btn btn-ghost btn-icon btn-xs"
						aria-pressed={autoScroll}
						aria-label="Follow"
						title="Follow"
						onclick={() => (autoScroll = !autoScroll)}
					>
						<ChevronDoubleDownOutline class="h-3 w-3" />
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-icon btn-xs"
						aria-pressed={wrapLines}
						aria-label="Wrap"
						title="Wrap"
						onclick={() => (wrapLines = !wrapLines)}
					>
						<AlignJustifyOutline class="h-3 w-3" />
					</button>
					<CopyButton value={copyValue} label="visible log lines" color="ghost" size="xs" />
					<!-- ⭐ AN ICON BUTTON WITH A TOOLTIP, NOT TEXT AMONG ICONS
					     (must-fix #9: "a text 'Columns' button sits among icon
					     buttons"). Still a popover, not a pill row (round 2) —
					     a settings menu with a small, fixed item count, so the
					     no-dropdown rule (for rollout-list FILTERS) does not
					     apply. `bg-overlay` + `--k-shadow-overlay` is the
					     product's one overlay surface. Closes on an outside
					     click or Escape — see the `$effect` below.

					     `max-sm:hidden` (coordinator, logs round 2: "Drop
					     'Columns' below 640"). A phone's row already dropped
					     Pod/Container down to a fixed Time·Level·Message shape
					     (see the column header's own note), so there is
					     nothing left for this menu to toggle THERE — the
					     setting still applies the instant the reader is back
					     above 640. -->
					<div class="relative max-sm:hidden" bind:this={columnsMenuRoot}>
						<button
							type="button"
							bind:this={columnsMenuTriggerEl}
							class="btn btn-ghost btn-icon btn-xs {columnsMenuOpen ? 'bg-selected text-fg' : ''}"
							aria-haspopup="true"
							aria-expanded={columnsMenuOpen}
							aria-label="Columns"
							title="Columns"
							onclick={() => (columnsMenuOpen = !columnsMenuOpen)}
						>
							<ColumnOutline class="h-3 w-3" />
						</button>
						{#if columnsMenuOpen}
							<!-- ⭐ `role="group"`, NOT `role="menu"` (TL round 3: a menu
							     with plain checkboxes is an invalid ARIA pattern — a
							     real `menu` commits to `menuitem`/arrow-key navigation
							     neither this panel nor its items implement). A labelled
							     group of checkboxes is the correct, simpler pattern —
							     Tab moves through them normally, Space toggles, same as
							     any other checkbox list in the product. -->
							<div
								class="absolute top-full right-0 z-20 mt-1 w-44 rounded-lg border border-line bg-overlay p-1.5"
								style="box-shadow: var(--k-shadow-overlay)"
								role="group"
								aria-label="Visible columns"
								onfocusout={onColumnsPanelFocusOut}
							>
								{#each allColumns as col}
									{@const selected = visibleColumns.has(col.value)}
									{@const isLastChecked = selected && visibleColumns.size === 1}
									<label
										class="t-ui-sm flex items-center gap-2 rounded-sm px-2 py-1.5 text-fg hover:bg-hover {isLastChecked
											? 'cursor-not-allowed opacity-50'
											: 'cursor-pointer'}"
									>
										<!-- ⭐ `disabled`, NOT A SILENTLY-REFUSED CLICK (TL round
										     3). A plain `checked={selected}` with no `bind:`
										     left the NATIVE checkbox free to flip on click even
										     when the guard below refused the state change — the
										     DOM's own `.checked` and this component's `selected`
										     then disagreed, and nothing forced them back in sync
										     because `selected` itself never changed. Disabling the
										     one column that is the LAST visible one makes the
										     refusal a real, visible constraint instead of a click
										     that does nothing and leaves the box lying. -->
										<input
											type="checkbox"
											checked={selected}
											disabled={isLastChecked}
											onchange={() => {
												if (selected) {
													if (visibleColumns.size > 1) visibleColumns.delete(col.value);
												} else {
													visibleColumns.add(col.value);
												}
												visibleColumns = new Set(visibleColumns);
											}}
										/>
										{col.label}
									</label>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
			{#if searchResultLabel}
				<!-- ⭐ SAME TYPE ROLE AS THE PANEL'S OWN FOOTER META (below) — see
				     `lineCountLabel`'s doc comment in the module script. Right
				     beside the box that produced it, not only in the footer,
				     which can be a full scroll away from the input on a tall
				     pane. -->
				<p class="t-meta text-fg-subtle" aria-live="polite">
					{searchResultLabel}
				</p>
			{/if}
		</div>

		<!-- ⭐ THE LOG-VOLUME HISTOGRAM (LogHistogram.svelte, designer
		     2026-10-10): the console's picture, OUTSIDE the empty/loaded
		     branches below so it survives every filter (a filter that hides
		     every line leaves a baseline and "No errors in the last 15 min",
		     never a missing strip). Hidden only while connecting or on a
		     stream error, where there is no stream to picture. -->
		{#if awaitingFirstBatch}
			<!-- LOGOPEN, item 2: the histogram's own box (h-8 / sm:h-10 +
			     border), held empty until the first batch, so nothing below
			     it moves when the picture arrives. -->
			<div
				class="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:h-12 sm:gap-3 sm:px-4 min-[1800px]:h-16!"
				aria-hidden="true"
			>
				<span class="skel-block w-24 sm:w-32" style="height: 12px"></span>
				<span class="h-px flex-1 self-end mb-1 bg-line-strong"></span>
			</div>
		{:else if !error}
			<LogHistogram
				entries={histogramEntries}
				oldest={histogramSpan.oldest}
				newest={histogramSpan.newest}
				loaded={logs.length}
				now={$now.getTime()}
				selection={timeRangeFilter}
				since={buildStartMs !== null && histogramSpan.oldest !== null
					? Math.max(buildStartMs, histogramSpan.oldest)
					: buildStartMs}
				leadPressed={errorsFiltered}
				onlead={errorCount > 0 ? toggleErrorFilter : undefined}
				onselect={selectTimeRange}
				onclear={clearTimeRangeFilter}
			/>
		{/if}
		<!-- LOGOPEN round 7, item 3: one count. The "Showing 48 errors ·
		     Show all lines" line that sat here repeated the footer; the
		     footer now carries the count and the way out. The phone lists
		     newest first, so its "end of the list" is up here: the same
		     line renders above the rows there (44px tap target, item 4). -->
		<!-- LOGOPEN r8/r9: the phone has no count strip; the histogram's lead
		     number is the Error toggle there (and everywhere). -->
		{#if awaitingFirstBatch}
			<!-- ⭐ THE LOADED SHAPE, HELD UNTIL THE FIRST BATCH (LOGOPEN, item
			     2; SPEC §2 "connecting = skeleton lines in the loaded shape").
			     The column header, 20px rows in the time · level · message
			     columns, and the footer, at the same heights the loaded
			     console uses, inside the same fixed-height pane: when lines
			     arrive the frame does not move, it fills. The footer says
			     what is happening; nothing claims there are no lines. -->
			<div
				data-log-colhdr
				class="hidden h-[21px] shrink-0 items-center gap-1 border-b border-line bg-subtle px-4 sm:flex"
				aria-hidden="true"
			>
				<span class="skel-block w-20" style="height: 10px"></span>
			</div>
			<div class="relative min-h-0 flex-1 overflow-hidden bg-subtle py-1 sm:py-0" aria-hidden="true">
				{#each Array.from({ length: isPhone ? 8 : 24 }, (_, n) => n) as i (i)}
					<div class="flex h-5 items-center gap-3 border-l-2 border-l-transparent px-3 max-sm:h-[52px] max-sm:flex-col max-sm:items-start max-sm:justify-center max-sm:gap-1.5 sm:px-4">
						<span class="skel-block w-[84px] shrink-0" style="height: 10px"></span>
						<span class="skel-block hidden w-9 shrink-0 sm:block" style="height: 10px"></span>
						<span class="skel-block" style="height: 10px; width: {62 - ((i * 7) % 5) * 9}%"></span>
					</div>
				{/each}
			</div>
			<div class="flex shrink-0 items-center gap-2 border-t border-line px-4 py-1">
				<StatusSpinner size="3" color="gray" />
				<p class="t-meta text-fg-subtle" aria-live="polite">
					{isConnecting
						? filterType === 'test'
							? 'Connecting to test runs…'
							: 'Connecting to pods…'
						: 'Reading recent lines…'}
				</p>
			</div>
		{:else if error}
			<div class="flex flex-1 items-center justify-center p-6">
				<div class="w-full max-w-md">
					<AlertPanel severity="error" title="Failed to load logs" message={error} class="">
						{#snippet actions()}
							<button
								type="button"
								class="btn btn-primary btn-sm"
								onclick={() => logsQuery.refetch()}
							>
								<RefreshOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
								Retry
							</button>
						{/snippet}
					</AlertPanel>
				</div>
			</div>
		{:else if allLogLines.length === 0}
			<!--
				⛔ CENTRED GRAY PROSE, NO ICON, NO FRAME. (defect #3) An empty
				pane now leads with an icon and sits at the TOP, the same shape
				`/activity`'s empty state uses — a void is not the answer to
				"nothing has arrived yet", a stated fact is. §3.15: 20px outline
				icon `fg-disabled`, `t-ui` headline, `t-meta` next step.

				⭐ LEFT-ALIGNED, MATCHING THE OVERVIEW TAB'S OWN EMPTY STATE
				(TL review round 3) — `Deployment pipeline`'s own "No deploys
				yet" (`items-start`, no `text-center`), not a centred dialog.
				One empty-state shape across the rollout's own tabs, same as
				the Card/PageHeader grammar it already shares with them.

				⛔ AND THE TESTS VIEW WAS THE PODS VIEW WITH A DIFFERENT DATA
				SOURCE. (defect #5) "the pods have written nothing" printed on
				`filterType="test"` even when a real test had run and finished
				minutes earlier — `lastTestRun` (from `RolloutTest`'s own
				status, see its definition above) is what lets this branch say
				so when it is known, and an honest "no test has written
				anything" — never "pods" — when it is not.
			-->
			<div class="flex flex-1 flex-col items-start gap-1 px-4 py-6">
				<EmptyIcon class="mb-1 h-5 w-5 text-fg-disabled" />
				{#if windowEmpty}
					<p class="t-ui text-fg">{windowEmpty.title}</p>
					{#if windowEmpty.detail}
						<p class="t-meta max-w-sm text-fg-subtle">{windowEmpty.detail}</p>
					{/if}
				{:else if hasFilters}
					<p class="t-ui text-fg">No lines match the current filters</p>
					<!-- One count, in the count line (round 7, item 3). The body
					     only offers a way out when the count line has none: a
					     search-only miss, which the count line does not scope. -->
					{#if !footerShowsAll}
						<button type="button" class="btn btn-secondary btn-sm mt-3" onclick={clearFilters}>
							Clear filters
						</button>
					{/if}
				{:else if filterType === 'test'}
					<p class="t-ui text-fg">No test output yet</p>
					{#if lastTestRun}
						<p class="t-meta max-w-sm text-fg-subtle">
							The last run, <span class="text-fg-muted">{lastTestRun.name}</span>, finished {formatTimeAgo(
								lastTestRun.finishedAt
							)}. New lines appear here as the next run writes them.
						</p>
					{:else}
						<p class="t-meta max-w-sm text-fg-subtle">
							The stream is open and no test has written anything since this view opened. New
							lines appear here as a test run writes them.
						</p>
					{/if}
				{:else}
					<p class="t-ui text-fg">No log lines yet</p>
					<p class="t-meta max-w-sm text-fg-subtle">
						The stream is open and
						{discoveredPods.length > 0
							? `${discoveredPods.length} pod${discoveredPods.length === 1 ? ' has' : 's have'}`
							: 'the pods have'} written nothing since this view opened. New lines appear here
						as they are written.
					</p>
				{/if}
			</div>
			{#if !isPhone && hasFilters}
				{@render countLine('bottom')}
			{/if}
		{:else}
			<!-- ⭐ THE COLUMN HEADER (SPEC.md §2, logs redesign 2026-10-09): a
			     32px label row over the well, naming what each column holds —
			     Railway draws this over its own console the same way. The zone
			     in the Time label is the SAME `timeZonePreference` the navbar's
			     toggle writes (not a second reading of it), so it can never say
			     "UTC" while the rows beside it print browser time. Pod only
			     when the Pod column is both visible AND more than one pod is in
			     view — `singlePodMode` already collapses that column to a bare
			     dot on every row, so a text label over it would name a column
			     the rows do not actually spell out. -->
			<div
				data-log-colhdr
				class="hidden shrink-0 items-center gap-1 overflow-hidden border-b border-line bg-subtle px-2 py-0.5 sm:flex sm:px-4"
			>
				{#if visibleColumns.has('timestamp')}
					<span class="t-label shrink-0 text-fg-subtle">
						<span class="hidden sm:inline"
							>Time ({timeZonePreference.zone === 'utc' ? 'UTC' : 'Local'})</span
						>
						<span class="sm:hidden">Time</span>
					</span>
				{/if}
				<!-- ⭐ THE LEVEL COLUMN (squad-rollout coordinator review). Always
				     on, not a `visibleColumns` toggle — it is the one column
				     this file's own §3.15-style discipline ("one fact, once")
				     now depends on: the message column no longer repeats the
				     word at all, so hiding this would hide the level
				     everywhere. -->
				<span class="t-label mx-1 w-12 shrink-0 text-fg-subtle sm:mx-2">Level</span>
				{#if visibleColumns.has('pod') && !singlePodMode}
					<span class="t-label mx-1 hidden shrink-0 text-fg-subtle sm:mx-2 sm:inline">Pod</span>
				{/if}
				{#if visibleColumns.has('message')}
					<span class="t-label mx-1 shrink-0 text-fg-subtle sm:mx-2">Message</span>
				{/if}
			</div>
			<!-- ⭐ THE WELL. (2026-10-08, design-language pass) Was a FORCED
			     `bg-gray-900`/`950` terminal skin regardless of theme — the
			     one surface in the product with its own elevation model
			     (principle 9: "one elevation model in both themes"). `bg-subtle`
			     is the same "a well inside a card" token a meter track or an
			     `AlertPanel` field tint already uses — it follows the page's
			     theme like everything else, and is still the one place mono
			     dominates (machine output), just inside the product's own
			     material instead of a second one. -->
			<div class="relative min-h-0 flex-1 bg-subtle">
				{#if isPhone}
					<!-- ⭐ PHONE ROWS: PLAIN FLOW, NOT VIRTUALIZED (art director
					     round 1, must-fix #5). No `overflow-y-auto` anywhere in
					     this branch — the document scrolls through these rows
					     exactly like it scrolls through any other list in the
					     product below `sm` (the standard scroll model). Every
					     row stacks as "time · level" on its own line, THEN the
					     message on the next (the AD's own target), which also
					     sidesteps the column-width squeeze that made Pod/
					     Container/the chevron fight the message for space at
					     390 — there is no multi-column row to fit here at all.
					     Un-virtualized is a real trade: a phone session is a
					     glance at what just happened, not an hours-long
					     scrollback through tens of thousands of lines, and the
					     demo's own buffers (dozens to a few hundred lines) are
					     nowhere near where a plain DOM list would struggle. The
					     `messageHeadline` strips the same trailing ` | k=v`
					     tail the desktop row's own collapsed state strips
					     (logs round 6). The structured-line expand is NO
					     LONGER skipped here (AD round 3, item 2: "messages
					     capped at 2 lines with the expand chevron") — it
					     reuses the SAME `expandedLineRef`/`toggleLineExpand`
					     state the desktop virtualized well uses, but needs
					     none of that well's exact-height arithmetic: a plain
					     DOM row in normal document flow grows for free, so
					     the detail block is just a sibling `<div>` rendered
					     when this row is the expanded one, not a second
					     spliced virtualizer entry. -->
					<!-- Newest first (LOGOPEN, item 3; see `phoneTopSentinel`).
					     `overflow-anchor: none`: this list holds its own reading
					     place while lines prepend, so the browser must not. -->
					<div bind:this={phoneTopSentinel} aria-hidden="true"></div>
					<div bind:this={phoneListEl} style="overflow-anchor: none">
						{#each phoneRowsShown as logItem (logItem.raw)}
							{@const logLevel = getLogLevel(logItem.line)}
							{@const parsed = stripLogLinePrefix(logItem.line)}
							{@const isNewLine = justArrivedRefs.has(logItem.raw)}
							{@const structuredFields = parseStructuredFields(logItem.line)}
							{@const isExpanded = expandedLineRef === logItem.raw}
							<!-- 52px right gutter (LOGOPEN, item 9): the floating
							     "Latest" control sits there and never covers text. The
							     whole row toggles a structured line (item 6). -->
							<!-- The whole row is ONE button for a structured line (time line
							     and message): a click handler on the row div was invisible
							     to Chrome's touch adjustment, which snapped a tap on the
							     time line to the histogram's lead button 8px above and
							     turned the Error filter off (LOGOPEN r9, measured). -->
							<div
								data-phone-row
								class="{structuredFields ? 'cursor-pointer' : ''} border-b border-l-2 border-line-subtle py-0.5 pr-[52px] pl-3 {logLevel === 'error'
									? 'border-l-danger-solid'
									: logLevel === 'warn'
										? 'border-l-line-strong'
										: 'border-l-transparent'} {isNewLine ? 'log-line-enter' : ''}"
							>
								{#snippet phoneTimeLine()}
								<span class="t-code-sm flex items-center gap-2">
									<span class="tabular-nums text-fg-subtle"
										>{logClockPhone.format(logItem.timestamp)}</span
									>
									<span
										class="{parsed.level === 'error'
											? 'text-danger'
											: parsed.level === 'warn'
												? 'text-fg-muted'
												: 'text-fg-subtle'}"
									>
										{LEVEL_WORD[parsed.level ?? ''] ?? ''}
									</span>
								</span>
								{/snippet}
								{#if !structuredFields}{@render phoneTimeLine()}{/if}
								{#if structuredFields}
									<button
										type="button"
										class="block w-full text-left"
										aria-expanded={isExpanded}
										onclick={() => onRowClick(logItem)}
									>
										{@render phoneTimeLine()}
										<span class="flex w-full items-start gap-1">
										<p
											class="t-code-sm min-w-0 flex-1 text-fg break-words whitespace-pre-wrap {isExpanded
												? ''
												: 'line-clamp-2'}"
										>
											<!-- eslint-disable-next-line svelte/no-at-html-tags -- highlightSearch escapes every piece of the log text -->
											{@html highlightSearch(messageHeadline(parsed.message), searchQuery)}
										</p>
										<ChevronRightOutline
											class="mt-0.5 h-3 w-3 shrink-0 text-fg-disabled transition-transform {isExpanded
												? 'rotate-90'
												: ''}"
										/>
										</span>
									</button>
								{:else}
									<p class="t-code-sm min-w-0 text-fg break-words whitespace-pre-wrap line-clamp-2">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- highlightSearch escapes every piece of the log text -->
										{@html highlightSearch(messageHeadline(parsed.message), searchQuery)}
									</p>
								{/if}
								{#if isExpanded && structuredFields}
									<!-- ⭐ FULL MESSAGE FIRST, THEN FIELDS (AD round 3, item
									     4 — same order as the desktop expand, see that
									     block's own doc). No height arithmetic needed here:
									     this is a real sibling row in normal flow, not a
									     spliced virtualizer entry. -->
									<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
									<!-- (stops the row toggle; holds only its own buttons) -->
									<div
										class="mt-1 cursor-auto border-t border-line-subtle pt-1 pb-1"
										onclick={(e) => e.stopPropagation()}
									>
										<p class="t-code-sm text-fg break-words whitespace-pre-wrap">
											{stripLogLinePrefix(logItem.line).message}
										</p>
										<dl class="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
											{#each withSourceFields(logItem, structuredFields) as field (field.key)}
												{@const tone = structuredFieldTone(field)}
												<dt class="t-code-sm truncate text-fg-subtle">{field.key}</dt>
												<dd
													class="t-code-sm min-w-0 truncate {tone === 'danger'
														? 'text-danger'
														: 'text-fg'}"
													title={field.key === 'pod' ? field.value : undefined}
												>
													{field.key === 'pod' ? podValueLabel(field.value) : field.value}
												</dd>
											{/each}
										</dl>
										<div class="mt-1 -ml-2.5 flex items-center gap-1">
											<button
												type="button"
												class="btn btn-ghost btn-xs max-sm:h-11"
												onclick={() => copyTextToClipboard(logItem.line)}
											>
												Copy line
											</button>
											<button
												type="button"
												class="btn btn-ghost btn-xs max-sm:h-11"
												onclick={() => showInContext(logItem)}
											>
												Show in context
											</button>
										</div>
									</div>
								{/if}
							</div>
						{:else}
							<div class="flex flex-col items-start gap-1 px-3 py-6">
								<EmptyIcon class="mb-1 h-5 w-5 text-fg-disabled" aria-hidden="true" />
								<p class="t-ui text-fg">No log lines yet</p>
								<p class="t-meta max-w-sm text-fg-subtle">
									New lines appear here as they are written.
								</p>
							</div>
						{/each}
						{#if phoneRowsHidden > 0}
							<div class="flex justify-center border-b border-line-subtle px-3 py-3">
								<button
									type="button"
									class="btn btn-secondary max-sm:h-11"
									onclick={() => (phoneLimit += PHONE_PAGE)}
								>
									Show {Math.min(PHONE_PAGE, phoneRowsHidden)} earlier lines
									<span class="text-fg-subtle">(of {phoneRows.length} total)</span>
								</button>
							</div>
						{/if}
						<!-- ⭐ THE "OPEN AT THE LATEST" ANCHOR (logs round 8, item
						     1) — `scrollIntoView` targets THIS sentinel, not
						     the last row, so it works even on the FIRST paint
						     before any rows exist and stays correct as rows
						     splice in/out above it; see the phone follow
						     `$effect` below. -->
					</div>
				{:else}
				<!--
					⭐ THE FADE, NOT PADDING — A SECOND LINE OF DEFENCE, NOT THE
					ONLY ONE. (F9, 2026-09-03, narrowing the defect #6 fix) The
					fade is widened to one full row pitch (`ROW_HEIGHT`, 30px) so
					it still fully covers a straddling row for the one case row-
					alignment cannot reach: a reader scrolled to an arbitrary
					position by hand, where the top row is whatever the drag left
					it at. Same treatment at 1440 and 390, both themes; still
					costs the virtualizer nothing because it never enters its
					scrollable content.

					⭐ GATED ON `listScrollable` (AD round 3, item 1: "no top
					fade over a filtered result") AND `!isAtTop` (AD round 4,
					item 3: "no fade… at scrollTop 0"). The fade's own job is
					to hide a row straddling the TOP EDGE of a scroll — it
					has nothing to hide, and nothing true to claim, either
					over a result short enough that every row already fits
					(a narrow level/time-range/search filter, a source with
					few lines) OR over a well that is scrollable but simply
					has not been scrolled away from its own top yet (every
					well opens at `scrollTop` 0). `listScrollable` alone gets
					the first case; `isAtTop` gets the second, which
					`listScrollable` cannot see on its own (a well can be
					tall enough to scroll AND still be sitting at its own
					top). Same signal the floating scroll-to-bottom button
					already gates on below, so the two affordances can never
					disagree about whether this well is actually a scroller
					right now.
				-->
				<!-- LOGOPEN, item 8: the fade suggests "more stream above"; on
				     a filtered result there is no stream, only matches. -->
				{#if listScrollable && !isAtTop && !hasFilters}
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-x-0 top-0 z-10 h-[30px] bg-gradient-to-b from-subtle to-transparent"
					></div>
				{/if}
				<!-- ⭐ THE LOADED-SHAPE SKELETON (logs round 9) — covers the
				     well while `!wellRevealed` (see that state's own doc),
				     so a reader never sees the catch-up scroll happen; it
				     sees this instead, then the real, already-settled rows.
				     `ROW_HEIGHT` rows, same rhythm as the real thing. -->
				{#if !wellRevealed}
					<div
						aria-hidden="true"
						class="absolute inset-0 z-20 flex flex-col gap-0.5 overflow-hidden bg-subtle px-4 py-2"
					>
						{#each Array.from({ length: 20 }, (_, n) => n) as i (i)}
							<span class="skel-block" style="height: {ROW_HEIGHT - 4}px; width: {80 - (i % 5) * 8}%"
							></span>
						{/each}
					</div>
				{/if}
				<div
					bind:this={virtualListEl}
					data-log-well
					onscroll={handleScroll}
					onwheel={markUserGesture}
					ontouchstart={markUserGesture}
					onpointerdown={(e) => e.target === e.currentTarget && markUserGesture()}
					style={wellRevealed ? '' : 'visibility: hidden;'}
					class="absolute inset-0 overflow-y-auto overflow-x-hidden"
				>
					<!-- Round 7, item 5: a result shorter than the well sits on its
					     bottom edge, like the full stream, not at the top. -->
					<div class="flex min-h-full min-w-full flex-col justify-end">
						{#if virtualListBefore > 0}
							<div style="height: {virtualListBefore}px;"></div>
						{/if}

						{#each virtualItems as row, idx (row.index)}
							{@const displayRow = displayRows[row.index]}
							{#if displayRow?.kind === 'detail'}
								{@const logItem = displayRow.log}
								<!-- ⭐ THE EXPAND, IN PLACE (art director round 1, must-fix
								     #3). A real row in the virtualized list (`displayRows`), not
								     a floating panel — it scrolls with everything else and can
								     never render outside the card. Indented to the message
								     column's own x (the Level column's `w-12` + its margins,
								     matched below), keys in `fg-subtle`, values in `fg` —
								     Railway's own shape. Shows EVERY parsed field (the AD: "not
								     the two already visible" — `parseStructuredFields` already
								     returns the whole set, this just stopped being surprised by
								     it), height exactly `detailRowHeight(fields.length)` — see
								     that function's own comment for why this div's own CSS has
								     to keep matching that arithmetic. -->
								{@const detailLevel = getLogLevel(logItem.line)}
								<!-- ⭐ THE LEVEL RULE RUNS THROUGH THE EXPAND TOO (AD round
								     2, "also" bullets) — was always `border-transparent`
								     regardless of the row it expanded from, so an error row's
								     own red rail visibly stopped the instant it opened. Same
								     three-way `logLevel === …` the collapsed row below uses,
								     read off the SAME line. -->
								<!-- LOGOPEN, item 6: no left padding. `messageColumnOffsetPx`
								     is the message span's `offsetLeft`, which already counts
								     the log row's own `pl-4`; padding here as well put the
								     body 16px right of the column it belongs to. -->
								<div
									class="border-l-2 bg-subtle py-2 pr-2 pl-0 sm:pr-16 {detailLevel === 'error'
										? 'border-l-danger-solid'
										: detailLevel === 'warn'
											? 'border-l-line-strong'
											: 'border-l-transparent'}"
									style="height: {detailRowHeight(
										displayRow.fields.length,
										displayRow.messageLines
									)}px;"
									data-index={row.index}
									data-detail-row
								>
									<!-- ⭐ THE FULL MESSAGE, FIRST (AD round 3, item 4) — the
									     collapsed row only ever shows `messageHeadline`'s
									     shortened form (round 6); this is the one place the
									     complete, untrimmed line is readable. `overflow-hidden`
									     is a safety valve for `messageLines`'s own estimate (see
									     `detailRowHeight`'s doc) — clips rather than straddles
									     the row below on a rare under-estimate. -->
									<p
										class="t-code-sm overflow-hidden text-fg break-words whitespace-pre-wrap"
										style="margin-left: {messageColumnOffsetPx}px; max-height: {displayRow.messageLines *
											16}px;"
									>
										{stripLogLinePrefix(logItem.line).message}
									</p>
									<dl
										class="mt-2 grid grid-cols-[10ch_1fr] gap-x-3"
										style="margin-left: {messageColumnOffsetPx}px;"
									>
										{#each displayRow.fields as field (field.key)}
											{@const tone = structuredFieldTone(field)}
											<dt class="t-code-sm h-4 truncate leading-4 text-fg-subtle">{field.key}</dt>
											<dd
												class="t-code-sm h-4 min-w-0 truncate leading-4 {tone === 'danger'
													? 'text-danger'
													: 'text-fg'}"
											>
												{field.value}
											</dd>
										{/each}
									</dl>
									<!-- ⭐ REAL BUTTONS, NOT `.nav-link` (AD round 2, "also"
									     bullets: "real btn-ghost btn-xs actions") — these are
									     commands (copy to clipboard, jump the filter state), not
									     navigation, so they get the control family's own ghost
									     button instead of a link style borrowed for the look. -->
									<!-- The first label sits on the key column: offset by the
									     `.btn-xs` side padding (10px). Same two actions on
									     every line (item 6). -->
									<div
										class="mt-2 flex items-center gap-1"
										style="margin-left: {messageColumnOffsetPx - 10}px;"
									>
										<button
											type="button"
											class="btn btn-ghost btn-xs"
											onclick={() => copyTextToClipboard(logItem.line)}
										>
											Copy line
										</button>
										<button
											type="button"
											class="btn btn-ghost btn-xs"
											onclick={() => showInContext(logItem)}
										>
											Show in context
										</button>
									</div>
								</div>
							{:else if displayRow}
								{@const logItem = displayRow.log}
								{@const podParts = podNameParts(logItem.pod)}
								{@const logLevel = getLogLevel(logItem.line)}
								{@const parsed = stripLogLinePrefix(logItem.line)}
								{@const isNewLine = justArrivedRefs.has(logItem.raw)}
								<!-- ⭐ 20px, NO DIVIDER (art director round 1, must-fix #1):
								     `h-5 flex items-center`, not `py-*` + `border-b` — see
								     `ROW_HEIGHT`'s own doc comment. The level rule (this same
								     `border-l-2`) and `hover:bg-hover` are the only separators
								     left; a healthy row between two others reads as continuous
								     rail, the way Railway's own stream does. -->
								<!-- ⭐ A RESERVED RIGHT GUTTER (logs round 8, item 9: "the
								     ↑↓ buttons never cover text") — `sm:pr-16`, not
								     `sm:px-4` on both sides: the floating scroll
								     buttons (`right-4 bottom-4`, 32px square, see their
								     own markup below) sit OVER this well's own content,
								     not beside it, so a wrapped row's text could run
								     straight under them with a plain symmetric
								     padding. 64px clears the button's own 32px plus its
								     16px inset plus a few px of breathing room. -->
								{@const rowStructured = !!parseStructuredFields(logItem.line)}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<!-- (the chevron button is the keyboard path) -->
								<div
									onclick={rowStructured ? () => onRowClick(logItem) : undefined}
									class="t-code-sm relative flex h-5 items-center border-l-2 px-2 hover:bg-hover sm:pr-16 sm:pl-4 {rowStructured
										? 'cursor-pointer'
										: ''} {expandedLineRef === logItem.raw ? 'bg-hover' : ''} {logLevel === 'error'
										? 'border-l-danger-solid'
										: logLevel === 'warn'
											? 'border-l-line-strong'
											: 'border-l-transparent'} {isNewLine ? 'log-line-enter' : ''}"
									data-index={row.index}
								>
									{#if visibleColumns.has('timestamp')}
										<span
											class="tabular-nums shrink-0 text-fg-subtle"
											title={formatTimestamp(logItem.timestamp)}>{logClock.format(logItem.timestamp)}</span
										>
									{/if}
									<span
										class="mx-1 w-12 shrink-0 sm:mx-2 {parsed.level === 'error'
											? 'text-danger'
											: parsed.level === 'warn'
												? 'text-fg-muted'
												: 'text-fg-subtle'}"
									>
										{LEVEL_WORD[parsed.level ?? ''] ?? ''}
									</span>
									<!-- ⭐ A DOT MEANS "YOU NARROWED THIS", NOT "HERE IS A
									     COLUMN" (AD round 3, item 1: "no unlabelled dot
									     column"). Two different reasons `singlePodMode` can be
									     true, and only one of them still earns a mark: the
									     reader explicitly selected one pod from several
									     (`selectedPods.size > 0`) — the dot confirms which one,
									     same as before (design pass 6, finding #1). A source
									     that only ever HAD one pod (the Tests view's own single
									     test-runner, `selectedPods.size === 0`) has nothing to
									     confirm — every row's dot would be identical, a column
									     that carries no information rather than one that is
									     merely unlabelled — so it prints nothing at all. The
									     column header's "Pod" label stays hidden in BOTH cases
									     (`!singlePodMode`, unchanged above); this is only about
									     the row body. -->
									{#if visibleColumns.has('pod') && !singlePodMode}
										<span
											class="mx-1 hidden shrink-0 text-fg-muted sm:mx-2 sm:inline"
											data-pod={logItem.pod}
											title={logItem.pod}>{podParts.suffix}</span
										>
									{:else if visibleColumns.has('pod') && singlePodMode && selectedPods.size > 0}
										<span
											class="mx-1 hidden h-2 w-2 shrink-0 rounded-full bg-fg-subtle sm:mx-2 sm:inline-block"
											data-pod={logItem.pod}
											title={logItem.pod}
											aria-hidden="true"
										></span>
									{/if}
									{#if visibleColumns.has('message')}
										{@const headline = messageHeadline(parsed.message)}
										{@const displayLine = wrapLines
											? headline
											: truncateAtWordBoundary(headline, maxMessageChars)}
										<span
											class="text-fg {wrapLines
												? 'min-w-0 break-words whitespace-pre-wrap'
												: 'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap'}"
											data-role="log-message"
											title={displayLine !== parsed.message ? parsed.message : undefined}
										>
											<!-- eslint-disable-next-line svelte/no-at-html-tags -- highlightSearch escapes every piece of the log text -->
											{@html highlightSearch(displayLine, searchQuery)}
										</span>
										{@const structuredFields = parseStructuredFields(logItem.line)}
										{#if structuredFields}
											<!-- ⭐ THE STRUCTURED-LINE EXPAND TRIGGER. Only on a line
											     `parseStructuredFields` actually found JSON or logfmt
											     pairs in. Absolutely positioned (art director round 1,
												 must-fix #1: "the chevron is absolutely positioned and
												 adds no height") — it used to be an inline flex sibling
												 whose own intrinsic box (padding + icon) stood taller
												 than the 16px text line beside it, which is exactly what
												 jittered the row pitch by 2px on any row that had one. -->
											<button
												type="button"
												data-expand-trigger
												class="absolute top-1/2 right-2 -translate-y-1/2 rounded-xs p-0.5 text-fg-disabled hover:bg-hover hover:text-fg-subtle sm:right-4"
												aria-expanded={expandedLineRef === logItem.raw}
												aria-label="Show fields"
												title="Show fields"
												onclick={(e) => {
													e.stopPropagation();
													toggleLineExpand(logItem);
												}}
											>
												<ChevronRightOutline
													class="h-3 w-3 shrink-0 transition-transform {expandedLineRef ===
													logItem.raw
														? 'rotate-90'
														: ''}"
												/>
											</button>
										{/if}
									{/if}
								</div>
							{/if}
						{/each}

						{#if virtualListAfter > 0}
							<div style="height: {virtualListAfter}px;"></div>
						{/if}
					</div>
				</div>
				{/if}
				<!-- ⭐ ONE "LATEST" CONTROL, ONLY WHEN AWAY (LOGOPEN, AD round 5,
				     item 9: "Show ↓ only when away from the latest, with one
				     label (no duplicate footer 'Jump to latest')"). It used to be
				     a ⇈/⇊ pair drawn whenever the well could scroll, plus a
				     footer button saying the same thing: three controls, two of
				     them shown while already at the latest. One 32px square now,
				     in the 64px row gutter (`sm:pr-16`, 16px inset), so it never
				     covers text; the badge counts what arrived since Follow
				     paused. -->
				{#if !autoScroll && !isPhone && !detailInBottomZone}
					<div class="absolute right-4 bottom-4 z-10 hidden sm:flex">
						<button
							type="button"
							class="btn btn-secondary btn-icon btn-sm relative"
							style="box-shadow: var(--k-shadow-overlay)"
							aria-label="Jump to latest{newSinceScrollAway > 0
								? ` (${newSinceScrollAway} new)`
								: ''}"
							title="Jump to latest"
							onclick={jumpToLatest}
						>
							<ChevronDoubleDownOutline class="h-4 w-4" />
							{#if newSinceScrollAway > 0}
								<span
									class="t-label absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-active-solid px-1 text-white"
									aria-hidden="true"
								>
									{newSinceScrollAway > 9 ? '9+' : newSinceScrollAway}
								</span>
							{/if}
						</button>
					</div>
				{/if}
			</div>
			<!-- ⭐ THE FOOTER (SPEC.md §2, logs redesign 2026-10-09): 32px,
			     border-t, ALWAYS present once there are rows to count —
			     superseding the old "only when a filter narrows the view, and
			     only inside a short well" rule (TL rounds 3/4; see the
			     console-fills-the-viewport note on `MIN_PANE_HEIGHT` above for
			     why that constraint is gone). "Showing N of M lines" states
			     exactly what filteredLogs/logs already state elsewhere, once,
			     at the ONE place a reader's eye lands after reading the last
			     row. Jump to latest appears only once Follow has actually
			     been knocked off by a real scroll (`!autoScroll`, the same
			     flag `handleScroll` already flips) — it is the way back, not
			     a second Follow toggle, and never shows while the well is
			     still connecting/empty/erroring (this branch is the only one
			     with rows to jump through). -->
			{#if !isPhone}
				{@render countLine('bottom')}
			{/if}
		{/if}
		</div>
	</Card>
</div>

<!-- THE PHONE "DOWN LATEST" FLOATING BUTTON (logs round 9, squad-rollout
     lead: "skip sticky... a fixed floating button... always in reach
     without touching Card"). `position: fixed` is a SIBLING of the root
     pane div above, outside Card's own `overflow-hidden` entirely -
     unlike the toolbar's `position: sticky` attempt (see that row's own
     doc for why it failed), `fixed` is not clipped by an ancestor's
     `overflow`, only by one with its own `transform`/`will-change`/
     `filter`, none of which Card sets. `bottom` clears MobileTabBar's own
     57px bar plus its safe-area inset plus 12px breathing room - written
     out since Tailwind's arbitrary values cannot embed an `env()` call.
     Shown only once `isPhone` AND the newest line is actually off-screen
     (`!autoScroll`) - the same gate the old in-toolbar attempt used, just
     relocated somewhere it can stay visible while scrolled anywhere in
     the history. -->
{#if isPhone && phonePaused}
	<!-- ⭐ "↑ N new" (LOGOPEN r8, item 1): one control for a paused phone
	     list, whether it paused by scrolling away or by opening a line. Fixed
	     above the tab bar at the right, in the rows' 52px gutter, so it never
	     covers the line being read (round 8 tried it over the list top: it
	     sat on the open line). Taking the new lines in is the reader's call. -->
	<button
		type="button"
		class="btn btn-secondary fixed right-6 z-30 h-11 rounded-full px-4 sm:hidden"
		style="bottom: calc(57px + env(safe-area-inset-bottom, 0px) + 12px); box-shadow: var(--k-shadow-overlay)"
		aria-label={newSinceScrollAway > 0 ? `Show ${newSinceScrollAway} new line${newSinceScrollAway === 1 ? '' : 's'}` : 'Jump to latest'}
		onclick={jumpToLatest}
	>
		<ArrowUpOutline class="h-4 w-4" aria-hidden="true" />
		{newSinceScrollAway > 0 ? `${newSinceScrollAway > 99 ? '99+' : newSinceScrollAway} new` : 'Latest'}
	</button>
{/if}

<style>
	/* ⭐ THE NEW-LINE ENTRY FADE — CAPPED WELL INSIDE THE CAPTURE'S 300ms
	   BUDGET. (2026-09-12, L5 "the log viewer survives a 60fps capture") A
	   60fps recording landing on a frame mid-fade reads as a rendering
	   glitch, not motion. 180ms leaves margin under the 300ms cap, and
	   because `justArrivedRefs` (instance script) gives every arrived line
	   its OWN independent timer, a whole burst lands, each row completing on
	   its own clock rather than queueing behind the one before it — a
	   50-line burst finishes in ~180ms total, not 50 × 180ms. */
	@keyframes log-line-enter {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	:global(.log-line-enter) {
		animation: log-line-enter 180ms ease-out;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.log-line-enter) {
			animation: none;
		}
	}
</style>
