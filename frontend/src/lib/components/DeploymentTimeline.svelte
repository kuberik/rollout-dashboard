<script lang="ts">
	// One vocabulary for the deploy states — see `bake-status.ts`. This dot
	// label used to say `still baking`, the product's own field name, inside
	// the accessible name of every in-flight dot on `/activity`.
	import { BAKE_WORD } from '$lib/bake-status';
	import { formatTimeAgoCompact } from '$lib/utils';
	import {
		brushRange,
		clusterActivation,
		clusterRuns as clusterRunsCalc,
		hitBoxes as hitBoxesCalc,
		spreadOverlaps as spreadOverlapsCalc,
		type MarkCluster
	} from '$lib/deployment-timeline-logic';

	type HistoryEntry = {
		timestamp: string;
		bakeStatus?: string;
		version: { tag: string; version?: string; revision?: string };
		message?: string;
		/**
		 * WHAT the dot is about, when the LANE does not say it. `/activity`
		 * groups lanes by ENVIRONMENT, so without this a reader hovering a dot
		 * learns the version and the place and not which rollout moved.
		 * Optional: the history page's lane IS the service, so it passes none
		 * and the tooltip renders exactly as before.
		 */
		subject?: string;
		triggeredBy?: { kind: 'User' | 'System'; name: string };
		/**
		 * A DEPLOY THAT WENT BACKWARDS IS A DIFFERENT EVENT FROM ONE THAT WENT
		 * FORWARDS, and this chart drew them as the same circle. Optional and
		 * caller-supplied, because the ordering that decides it lives in the
		 * rollout's own `availableReleases` (`history-marks.ts`) and a lane
		 * belonging to a DIFFERENT stream has no standing to rank it — see the
		 * note where the history page builds its lanes. Drawn as a ring in the
		 * mark's existing ink: zero new colour, and it survives greyscale.
		 */
		mark?: 'rollback';
	};

	type ServiceRow = {
		id: string;
		name: string;
		history: HistoryEntry[];
		isCurrent: boolean;
	};

	type PresetRange = '1h' | '6h' | '1d' | '7d' | '30d' | 'all';
	type TimeRange = PresetRange | { start: number; end: number };

	function isPreset(tr: TimeRange): tr is PresetRange {
		return typeof tr === 'string';
	}

	/**
	 * ⭐ A DOT'S NAME WAS THE VERSION AND NOTHING ELSE.
	 *
	 * Measured on `/activity` 2026-08-30: forty tab stops, each announcing
	 * `Deployment 0afab6f` — the SAME string eight times in a row, because a
	 * build lands in eight places. Position on the chart carried the lane, the
	 * time and the outcome, and position is the one channel a non-visual reader
	 * does not have. The name now carries all four.
	 */
	function dotLabel(svc: ServiceRow, e: HistoryEntry): string {
		const version = e.version.version || e.version.tag;
		const outcome =
			e.bakeStatus === 'Succeeded'
				? 'succeeded'
				: e.bakeStatus === 'Failed'
					? 'failed'
					: e.bakeStatus === 'Baking' || e.bakeStatus === 'InProgress'
						? `still ${BAKE_WORD.InProgress}`
						: (e.bakeStatus ?? 'unknown outcome').toLowerCase();
		const when = (() => {
			const t = new Date(e.timestamp);
			return isNaN(t.getTime()) ? '' : `, ${t.toLocaleString()}`;
		})();
		const subject = e.subject ? `${e.subject} in ` : '';
		const act = e.mark === 'rollback' ? ', rolled back' : '';
		return `${version} on ${subject}${svc.name} — ${outcome}${act}${when}`;
	}

	const TIME_RANGES: { value: PresetRange; label: string }[] = [
		{ value: '1h', label: '1h' },
		{ value: '6h', label: '6h' },
		{ value: '1d', label: '1d' },
		{ value: '7d', label: '7d' },
		{ value: '30d', label: '30d' },
		{ value: 'all', label: 'All' }
	];

	let {
		services,
		timeRange = $bindable<TimeRange>('7d'),
		selectedEntry = null as { serviceId: string; index: number } | null,
		onEntryClick = undefined as ((serviceId: string, index: number) => void) | undefined,
		onRangeChange = undefined as ((range: TimeRange) => void) | undefined,
		labelWidth = 130,
		labelEmptyLanes = false,
		fanOverlaps = false,
		rowHeight = 52
	}: {
		services: ServiceRow[];
		timeRange?: TimeRange;
		selectedEntry?: { serviceId: string; index: number } | null;
		onEntryClick?: (serviceId: string, index: number) => void;
		/**
		 * Fires whenever the READER moves the window — a preset button or a
		 * brush-zoom, never a programmatic change. `/activity` opens on a
		 * window computed to fit the data and must know when to stop doing
		 * that; `bind:` alone cannot tell the two apart. Optional, so the
		 * history page's plain `bind:timeRange` is untouched.
		 */
		onRangeChange?: (range: TimeRange) => void;
		/**
		 * The lane-name gutter. 130px was sized for `hello-world-manifests`;
		 * a lane named `prod` wants a third of that, and the difference is
		 * plot width — i.e. resolution — on the page that needs it most.
		 */
		labelWidth?: number;
		/**
		 * Draw `No deployments in this period` on EVERY empty lane, not just
		 * the current one. Opt-in: the history page has one lane and states
		 * this only for the service being viewed, and that must not change.
		 */
		labelEmptyLanes?: boolean;
		/**
		 * Fan colliding marks apart vertically inside their lane — see
		 * `spreadOverlaps`. OPT-IN, and deliberately so: it is right for a lane
		 * that is ONE service's history, where every mark is a distinct event the
		 * reader came to count, and it is wrong for `/activity`, whose lanes hold
		 * a whole environment and where eight builds landing in one minute is a
		 * normal Tuesday. Fanned, those eight become a vertical bead-chain that
		 * reads as if height meant something. The page the critic called clean
		 * stays as it was.
		 */
		fanOverlaps?: boolean;
		/**
		 * Lane height. 52px is right for one lane and wrong for twenty-two: a
		 * 22-environment fleet made this chart 1,144px tall, i.e. the whole
		 * viewport before the reader reached a single event. A 5px dot needs
		 * ~24px of lane, so the caller drops to ~26 when it has many.
		 */
		rowHeight?: number;
	} = $props();

	/** Set the window on the reader's behalf and tell the caller it was them. */
	function pickRange(next: TimeRange) {
		timeRange = next;
		onRangeChange?.(next);
	}

	// Responsive width
	let containerEl: HTMLDivElement | undefined = $state();
	let containerWidth = $state(600);

	$effect(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver((entries) => {
			containerWidth = Math.max(300, entries[0].contentRect.width);
		});
		ro.observe(containerEl);
		return () => ro.disconnect();
	});

	// Layout constants
	const PAD_R = 24;
	const PAD_T = 16;
	const PAD_B = 38;
	const R_NORMAL = 5;
	const R_ACTIVE = 8;

	const now = new Date();

	/**
	 * ⭐ A LONE POINT NO LONGER STRETCHES THE AXIS TO "NOW". (2026-09-03,
	 * design pass 7, finding #17.) `all` used to mean "earliest event to
	 * `now`, plus 5%" unconditionally — right for a rollout with a steady
	 * cadence, and wrong for one whose retained history is a single old
	 * entry: measured on the History tab, a 1,140×60 chart drew ONE dot at
	 * x=396 and left ~1,000px of empty grid between it and the "now" line,
	 * because the entry itself was hours old and `now` kept pulling the
	 * right edge away from it.
	 *
	 * Under 3 points the window fits the DATA'S OWN SPAN instead — earliest
	 * to latest, padded — which is the only window that is honest about
	 * what is actually being plotted. Anchoring on `now.getTime()` remains
	 * the behaviour once there are enough points that a window anchored on
	 * "now" is a legible chart rather than a single stranded mark, and it
	 * stays the *only* behaviour for every fixed preset (`1h`…`30d`): a
	 * reader who asked for "the last day" gets the last day, not a window
	 * stretched to whatever the data happens to cover.
	 */
	function computeBounds(tr: TimeRange): { startMs: number; endMs: number } {
		const nowMs = now.getTime();
		if (!isPreset(tr)) return { startMs: tr.start, endMs: tr.end };
		const msMap: Record<PresetRange, number | null> = {
			'1h': 3_600_000,
			'6h': 21_600_000,
			'1d': 86_400_000,
			'7d': 604_800_000,
			'30d': 2_592_000_000,
			all: null
		};
		const ms = msMap[tr];
		if (ms !== null) return { startMs: nowMs - ms, endMs: nowMs };
		let earliest = nowMs;
		let latest = -Infinity;
		let count = 0;
		for (const svc of services) {
			for (const e of svc.history) {
				const t = new Date(e.timestamp).getTime();
				if (t < earliest) earliest = t;
				if (t > latest) latest = t;
				count++;
			}
		}
		if (count === 0) return { startMs: nowMs - 86_400_000, endMs: nowMs };
		if (count < 3) {
			// A single point has no span to pad — floor it at an hour so the
			// axis still draws a legible tick scale either side of the mark.
			const span = Math.max(latest - earliest, 3_600_000);
			const pad = span * 0.15;
			return { startMs: earliest - pad, endMs: latest + pad };
		}
		return { startMs: earliest - (nowMs - earliest) * 0.05, endMs: nowMs };
	}

	/**
	 * ⭐ UNDER 3 POINTS, THE CHART ITSELF DOES NOT DRAW — A COMPACT ROW DOES.
	 * (2026-09-03, operator-walk finding 6) `computeBounds`'s own "under 3
	 * points" branch above already knew a single retained deploy has no span
	 * worth an axis — it padded the window instead of stretching to `now`.
	 * Measured on the History tab at 390: even padded, that window still
	 * drew ONE 5px dot in a full-width band, all axis and no shape — a chart
	 * with nothing to show a TREND of. Same threshold, same "count every
	 * point across every visible lane" definition as `computeBounds` reads
	 * (not scoped to the current `timeRange` window — a service with two
	 * deploys EVER has nothing to gain from a preset picker either), so the
	 * two can never disagree about whether this rollout has "enough" points
	 * to be worth a real timeline.
	 */
	const totalPoints = $derived(services.reduce((n, s) => n + s.history.length, 0));
	const latestPointMs = $derived.by(() => {
		let best = -Infinity;
		for (const svc of services) {
			for (const e of svc.history) {
				const t = new Date(e.timestamp).getTime();
				if (t > best) best = t;
			}
		}
		return Number.isFinite(best) ? best : null;
	});
	const isCompact = $derived(totalPoints > 0 && totalPoints < 3);

	const bounds = $derived(computeBounds(timeRange));
	const startMs = $derived(bounds.startMs);
	const endMs = $derived(bounds.endMs);
	/** The "now" marker is a claim about the right edge; only draw it when
	    the right edge actually IS now (within a second's rounding). A
	    data-fit window's right edge is the latest event plus padding, which
	    is very often NOT now, and labelling it so would be a lie the axis
	    tells about its own scale. */
	const showsNow = $derived(Math.abs(endMs - now.getTime()) < 1000);
	/**
	 * ⚠️ THE GUTTER IS A CEILING, NOT A CONSTANT. At 390 the whole chart is
	 * ~310px and a 130px lane-name gutter took 42% of it, so the plot — i.e.
	 * the resolution, i.e. the only reason the chart exists — got what was
	 * left. Capped at 30% of the container, the name truncates a little
	 * sooner on a phone and the axis gets a quarter more room. Desktop is
	 * unchanged: 30% of a 1,000px card is well above any caller's request.
	 */
	const LABEL_W = $derived(Math.max(40, Math.min(labelWidth, Math.round(containerWidth * 0.3))));
	const ROW_H = $derived(rowHeight);
	/** Characters that fit the gutter. `ui-monospace` at 11px measures ~6.6px
	    per glyph, and the label is right-anchored 10px in from `LABEL_W`. */
	const LABEL_CHARS = $derived(Math.max(6, Math.floor((LABEL_W - 14) / 6.7)));
	const plotW = $derived(Math.max(100, containerWidth - LABEL_W - PAD_R));
	const chartH = $derived(PAD_T + Math.max(1, services.length) * ROW_H + PAD_B);

	function tsToX(ts: string): number {
		const t = new Date(ts).getTime();
		const ratio = Math.max(0, Math.min(1, (t - startMs) / (endMs - startMs)));
		return LABEL_W + ratio * plotW;
	}

	function rowCY(i: number): number {
		return PAD_T + i * ROW_H + ROW_H / 2;
	}

	// STATUS → TOKEN CLASSES, NOT RAW HEXES (2026-08-27, colour audit §2b/§2d).
	//
	// This returned six literals — `#ef4444`, `#f59e0b`, `#3b82f6`, `#9ca3af`,
	// `#6b7280` — none of which is a product token. `#f59e0b` is the pre-OKLCH
	// hex for `amber-500`, i.e. a DUPLICATE of the `stuck` alarm's dot at
	// dEok 0.0165, spent on `InProgress`; the budget reserves amber for `stuck`
	// and nothing else, and yellow for baking. The other three were off-token
	// variants of `red-700`, `blue-700` and the two grays.
	//
	// Returning CLASSES rather than a hex also fixes a second defect the hexes
	// hid: one literal cannot be two themes, so every dot on this chart used to
	// render the light value on the dark card.
	//
	// SUCCEEDED IS NEUTRAL. A timeline's x-axis IS position, and DESIGN.md's own
	// corollary is that when position carries meaning, colour marks only the
	// deviation. Measured before this change, `/activity` drew 216 `green-700`
	// glyphs against 2 red and 2 amber — the norm at 108:1. `Cancelled` and the
	// unknown default join it: all three mean "nothing to do here", and the
	// tooltip prints the word.
	function statusFill(s?: string): string {
		switch (s) {
			case 'Failed':
				return 'fill-red-700 dark:fill-red-400';
			case 'InProgress':
				return 'fill-yellow-700 dark:fill-yellow-400';
			case 'Deploying':
				return 'fill-blue-700 dark:fill-blue-400';
			default:
				return 'fill-gray-500 dark:fill-gray-400';
		}
	}

	/** Same six states, as background/text utilities, for the HTML tooltip. */
	function statusInk(s?: string): string {
		switch (s) {
			case 'Failed':
				return 'bg-red-700 dark:bg-red-400';
			case 'InProgress':
				return 'bg-yellow-700 dark:bg-yellow-400';
			case 'Deploying':
				return 'bg-blue-700 dark:bg-blue-400';
			default:
				return 'bg-gray-500 dark:bg-gray-400';
		}
	}

	function statusText(s?: string): string {
		switch (s) {
			case 'Failed':
				return 'text-red-700 dark:text-red-400';
			case 'InProgress':
				return 'text-yellow-700 dark:text-yellow-400';
			case 'Deploying':
				return 'text-blue-700 dark:text-blue-400';
			default:
				return 'text-gray-500 dark:text-gray-400';
		}
	}

	function visibleEntries(history: HistoryEntry[]) {
		return history.map((e, i) => ({ e, i })).filter(({ e }) => new Date(e.timestamp).getTime() >= startMs);
	}

	/**
	 * ⭐ FORTY TAB STOPS OF THE SAME SHAPE. THE LANE IS THE TAB STOP NOW.
	 *
	 * Measured on `/activity` 2026-08-30: a keyboard reader crossed ~40 focus
	 * stops before the first row of the list, every one of them a 5px circle.
	 * That is NOT a focus-ORDER defect — the order was already visual, and the
	 * names were already good (`0afab6f on hello-multi-app in dev — succeeded,
	 * 8/29/2026, 11:22:39 AM`), so a semantics pass had nothing left to fix and
	 * correctly declined it. The defect is ARITY: `Tab` is the control for
	 * moving between WIDGETS, and this chart was handing it forty marks of one
	 * widget. The standard answer is the composite-widget roving tabindex, and
	 * the composite here is the LANE: `/activity` plots one lane per
	 * environment, the history page plots one per service.
	 *
	 * So: each lane is a `role="group"` holding its marks; exactly ONE mark per
	 * lane carries `tabindex=0` and the rest carry `-1`; `Tab` moves between
	 * lanes, `←`/`→` move along a lane in the direction the x-axis already
	 * means, `Home`/`End` jump to the oldest/newest visible mark, `Enter` and
	 * `Space` activate. On `/activity` that is 40 stops → one per environment.
	 *
	 * ⚠️ THE CURSOR IS A POSITION IN THE *VISIBLE* ENTRIES, NOT A HISTORY
	 * INDEX. Brush-zoom and the range presets change what is drawn; a cursor
	 * into `svc.history` would point at a mark that is no longer on screen.
	 * It is clamped on read for the same reason, and it DEFAULTS TO THE LAST
	 * (newest, right-most) mark — the deploy an operator opened this page for —
	 * so `←` walks backwards in time, which is the direction the axis says.
	 *
	 * ⚠️ FOCUS OPENS THE TOOLTIP. The tooltip was the only place the message,
	 * the actor and the previous version were readable, and it was mouse-only.
	 * `onfocus` drives the same `hov*` state a hover does, so arrowing along a
	 * lane reads the same card a mouse reader gets. Nothing about the drawing
	 * changes for a pointer user.
	 */
	let laneCursor = $state<Record<string, number>>({});

	/**
	 * ⚠️ `order` EXISTS BECAUSE DOM ORDER IS NOT SCREEN ORDER. A rollout's
	 * `history` arrives NEWEST FIRST, so the dots are painted right-to-left and
	 * `pos + 1` walks BACKWARDS along the axis. `→` has exactly one meaning on
	 * a chart with a time axis — later — so the keys move through `order`
	 * (positions sorted by timestamp ascending, i.e. left to right) and never
	 * through the array index. Caught by keyboard test, not by reading: `Home`
	 * landed on 11:22 and `End` on 10:29.
	 */
	/**
	 * ⭐ TWO DEPLOYS SIX MINUTES APART DREW AS ONE DOT.
	 *
	 * Fitting the window to the data removes the empty days, but it cannot
	 * separate events that are genuinely close: on the live hub,
	 * `hello-world-app` deployed at 23:09 and 23:15 inside a 38-hour span, and
	 * at 1,050px that is **3px apart** — one 5px mark on top of another. A
	 * chart that silently draws two events as one is worse than a chart that
	 * omits one, because the reader has no way to know.
	 *
	 * Marks that collide are fanned VERTICALLY inside their own lane. `x` is
	 * untouched, so nothing lies about WHEN — the y-axis inside a swimlane
	 * carries no meaning to spend, which is exactly why it is the channel that
	 * can absorb this. The fan is bounded by the lane, so a 26px lane (what
	 * `/activity` uses for a 22-environment fleet) barely moves and a 52px one
	 * separates cleanly. It never overflows into the lane above or below.
	 */
	const MIN_SEP = 2 * R_NORMAL + 2;

	// ⚙️ Math moved to `deployment-timeline-logic.ts` (2026-09-04) so it has a
	// unit test independent of a mounted chart — see that file's own header.
	// Behaviour unchanged: same run-detection, same step formula.
	function spreadOverlaps(xs: number[], order: number[]): number[] {
		const maxOffset = Math.max(0, ROW_H / 2 - R_ACTIVE - 3);
		return spreadOverlapsCalc(xs, order, MIN_SEP, maxOffset);
	}

	/**
	 * ⭐ THE 32px HIT CIRCLE'S OWN RADIUS IS A LIE WHEN TWO OF THEM OVERLAP.
	 * (2026-09-03, touch lane, F5 fifth re-check.) The invisible `r={16}`
	 * circle above assumes it owns 32px of clear space around its centre;
	 * on `/activity`'s 7-day scale that is false MOST of the time — several
	 * deploys minutes apart land within a fraction of a pixel of each other
	 * (`fanOverlaps` is correctly declined here, so nothing separates them
	 * on y either), and two full-size hit circles centred a few pixels
	 * apart overlap almost entirely. SVG paints later DOM siblings on top,
	 * so `elementFromPoint` anywhere in the overlap — INCLUDING A
	 * NEIGHBOUR'S OWN CENTRE — resolved to whichever mark happened to be
	 * last in `entries`' array order, not to "the mark under the cursor".
	 * Measured live: two adjacent marks on the `dev` lane reached only
	 * 20×33 and 17×33 of their 32×32 box, the shortfall entirely on the
	 * axis the neighbour sits on.
	 *
	 * The fix is the same idea `app.css`'s `.pill-btn` note already applies
	 * to a row of filter chips: when two targets must share less than 32px
	 * of gap, each gets HALF the gap instead of the fixed size that would
	 * overlap it — so any tap between two marks resolves to whichever is
	 * NEARER, which is what the merged-bubble comment above already claims
	 * happens ("a pointer moving across the bubble resolves it into the
	 * individual deploy under the cursor"). This is what makes that claim
	 * true instead of true-by-accident-of-DOM-order.
	 *
	 * ⚠️ ONLY WHEN `!fanOverlaps`. A fanned lane has already separated its
	 * collisions on y (`spreadOverlaps`, above), so two marks close in x sit
	 * far apart in y and a bare x-distance check would shrink a radius that
	 * has no real overlap to avoid — verified byte-identical on the History
	 * tab, which passes `fanOverlaps`.
	 *
	 * ⚠️ RESIDUE, STATED HONESTLY: two deploys at (functionally) the same x
	 * still partition to a near-zero radius — you cannot give two
	 * visually-coincident points both a comfortable, unambiguous pointer
	 * target, and no CSS or geometry trick changes that. Keyboard access
	 * (the roving tabindex, unaffected by any of this) is what reaches
	 * those; this fix is for the common case, not that degenerate one.
	 */
	type HitBox = { left: number; right: number };

	/**
	 * ⭐ INDEPENDENT LEFT/RIGHT, NOT ONE RADIUS. (2026-09-03, coordinator
	 * re-check after the first pass.) A `<circle>` is isotropic — ONE radius
	 * has to serve both sides, so a dot with a tight neighbour on its RIGHT
	 * and 40 clear px on its LEFT still had its whole hit area clamped down
	 * to the tight side's own half-gap, throwing away real, uncontested
	 * space the left side could have kept. Re-measured live: the original
	 * two flagged marks (20×33, 17×33 of a 32×32 box) each had a close
	 * neighbour on ONE side only — the symmetric circle this function used
	 * to return could not express that, and rounded every dot down to its
	 * WORST side. Returning `{left, right}` instead, and drawing a `<rect>`
	 * at the draw site instead of a `<circle>`, lets each side claim up to
	 * 16px independently — the uncontested side reaches its full 16, the
	 * contested side still yields no more than its own half-gap.
	 *
	 * The vertical axis is answered separately, at the draw site — nothing
	 * in a lane ever contests it at `fanOverlaps={false}` (`dys` is all
	 * zero), so it stays the full ±16 the floor asks for regardless of how
	 * tight the horizontal squeeze is. Coupling it to this radius (the
	 * previous `<circle>` shape) was throwing away 32px of clean vertical
	 * reach for no reason on every crowded mark — measured live, `reachV`
	 * dropped to match `reachH` even though nothing ever competed for the
	 * y-axis inside one lane.
	 */
	// ⚙️ Math moved to `deployment-timeline-logic.ts` (2026-09-04) — same
	// floor, same halving. See that file's header for why.
	function hitBoxes(xs: number[], fan: boolean): HitBox[] {
		return hitBoxesCalc(xs, fan, R_NORMAL);
	}

	/**
	 * ⭐ AND WHERE THE FAN IS REFUSED, THE CLUSTER IS DRAWN AS ONE MARK THAT
	 * SAYS HOW MANY. (2026-09-02.)
	 *
	 * `spreadOverlaps` is opt-in and `/activity` correctly declines it — see
	 * `fanOverlaps`. But declining it left the collision: on the live hub the
	 * `dev` lane drew `●◗` on Aug 29 and again on Aug 31, an amoeba that is
	 * neither one mark nor two, and at a 7-day scale two deploys minutes apart
	 * will ALWAYS collide, so this is the resting state of the page and not an
	 * edge case.
	 *
	 * THE THREE CANDIDATES, AND WHY THIS ONE:
	 *   · a STACK OFFSET is `spreadOverlaps`, already rejected here for a
	 *     reason that has not changed — a lane is a whole environment, and
	 *     eight builds landing in a minute become a bead-chain that reads as
	 *     if height meant something;
	 *   · spreading along X would lie about WHEN, which is the one axis on
	 *     this chart that carries meaning;
	 *   · a bare COUNT BADGE beside the amoeba leaves the amoeba.
	 * So: ONE disc, at the cluster's centre, carrying the count. It is bigger
	 * than a lone mark, which is the honest encoding — more happened here.
	 *
	 * ⛔ IT REPLACES NOTHING IN THE DOM. Every member keeps its own `<circle>`
	 * at its own x, its own `aria-label`, its place in the roving tabindex and
	 * its hover/focus handlers; members are only made INVISIBLE (and kept
	 * `pointer-events: all`, because a transparent fill is not a painted one).
	 * So a pointer moving across the bubble resolves it into the individual
	 * deploy under the cursor, `←`/`→` still walk every mark, and a screen
	 * reader's count of the lane is unchanged. The bubble itself is
	 * `aria-hidden` and inert — it is a picture of marks that are still there.
	 *
	 * The bubble hides while any of its members is hovered, focused or
	 * selected, so the reader never sees a count and a mark fighting for the
	 * same 15px.
	 */
	// 8, not 7.5: the numeral inside it is 10px now (was 9, below the
	// product's 10px floor — see the draw site). The bubble may grow to fit
	// its own label; it may not shrink the label to fit the bubble.
	const R_CLUSTER = 8;

	// ⚙️ Math moved to `deployment-timeline-logic.ts` (2026-09-04). `runs` is
	// new: the member POSITIONS behind each cluster, in list order — needed
	// so the bubble's own click/Enter handler can compute the run's time span
	// (`clusterActivation`, below) instead of only its pixel centroid.
	function clusterRuns(
		xs: number[],
		order: number[],
		statusAt: (pos: number) => string | undefined
	): { of: number[]; list: MarkCluster[]; runs: number[][] } {
		return clusterRunsCalc(xs, order, MIN_SEP, statusAt);
	}

	const lanes = $derived(
		services.map((svc, i) => {
			const entries = visibleEntries(svc.history);
			const order = entries
				.map((_, pos) => pos)
				.sort(
					(a, b) =>
						new Date(entries[a].e.timestamp).getTime() -
						new Date(entries[b].e.timestamp).getTime()
				);
			const xs = entries.map(({ e }) => tsToX(e.timestamp));
			// ⛔ THE TWO TREATMENTS ARE EXCLUSIVE. A fanned lane has already
			// separated its collisions on the y-axis, so merging them back into
			// one disc would undo the caller's own choice.
			const clusters = fanOverlaps
				? { of: xs.map(() => -1), list: [] as MarkCluster[], runs: [] as number[][] }
				: clusterRuns(xs, order, (pos) => entries[pos].e.bakeStatus);
			return {
				svc,
				i,
				entries,
				order,
				xs,
				dys: fanOverlaps ? spreadOverlaps(xs, order) : xs.map(() => 0),
				hitBoxes: hitBoxes(xs, fanOverlaps),
				clusterOf: clusters.of,
				clusters: clusters.list,
				clusterRuns: clusters.runs
			};
		})
	);

	/** The one mark in this lane that is in the tab order. Defaults to the
	    right-most (newest) — the deploy the operator came here for. */
	function cursorFor(id: string, order: number[]): number {
		if (order.length === 0) return -1;
		const c = laneCursor[id];
		return c === undefined || order.indexOf(c) === -1 ? order[order.length - 1] : c;
	}

	function laneLabel(name: string, count: number): string {
		if (count === 0) return `${name} — no deploys in this period`;
		return count === 1
			? `${name} — 1 deploy`
			: `${name} — ${count} deploys, left and right arrows to move between them`;
	}

	/**
	 * ⭐ THE BUBBLE ITSELF IS NOW A CONTROL, NOT JUST A PICTURE. (2026-09-04,
	 * fixing the report "clicking on parts where there's an indication of
	 * multiple deployments … doesn't do anything.") The bubble's drawn circle
	 * has always been `pointer-events: none` so a pointer aiming precisely at
	 * one member resolves to that member — correct, and unchanged below. But
	 * nothing gave a click/tap that DOESN'T land on any one member's own
	 * small hit target anywhere to go, so the common case — tapping the
	 * middle of the visible bubble, which several tightly-packed members'
	 * own hit rects usually don't fully cover — was a dead zone that fell
	 * through to the row background.
	 *
	 * `activateCluster` is what the new hit layer below calls: zoom to the
	 * cluster's own span (so its members separate and stay reachable
	 * individually, same as any two marks with room between them), or — for
	 * a cluster too tight in time for a window to help — select the newest
	 * member, exactly what clicking that single mark already does.
	 */
	function activateCluster(svcId: string, entries: { e: HistoryEntry; i: number }[], run: number[]) {
		const members = run.map((pos) => ({ e: entries[pos].e, i: entries[pos].i }));
		const action = clusterActivation(
			members.map((m) => ({ ms: new Date(m.e.timestamp).getTime(), origIdx: m.i }))
		);
		if (action.kind === 'zoom') pickRange({ start: action.start, end: action.end });
		else onEntryClick?.(svcId, action.origIdx);
	}

	function clusterLabel(svcName: string, count: number): string {
		return `${count} deploys close together on ${svcName} — activate to zoom in and see them separately`;
	}

	function onDotKey(
		ev: KeyboardEvent & { currentTarget: SVGRectElement },
		svcId: string,
		pos: number,
		order: number[],
		activate: () => void
	) {
		const rank = order.indexOf(pos);
		const last = order.length - 1;
		let next = pos;
		switch (ev.key) {
			case 'ArrowRight':
				next = order[Math.min(last, rank + 1)];
				break;
			case 'ArrowLeft':
				next = order[Math.max(0, rank - 1)];
				break;
			case 'Home':
				next = order[0];
				break;
			case 'End':
				next = order[last];
				break;
			case 'Enter':
			case ' ':
				ev.preventDefault();
				activate();
				return;
			default:
				return;
		}
		// Swallow the arrow even when it lands on the end of the lane, so a
		// held arrow key does not silently start scrolling the page instead.
		ev.preventDefault();
		if (next === pos) return;
		laneCursor[svcId] = next;
		const dots = ev.currentTarget
			.closest('g[data-lane]')
			?.querySelectorAll<SVGRectElement>('rect[data-dot]');
		dots?.[next]?.focus();
	}

	// Hover / tooltip state — anchored to the dot, not the cursor
	let hovId = $state<string | null>(null);
	let hovIdx = $state<number | null>(null);
	let hovDotX = $state(0);
	let hovDotY = $state(0);

	// Chart wrapper ref for computing tooltip vertical offset inside the outer container
	let chartWrapperEl: HTMLDivElement | undefined = $state();

	const tooltipEntry = $derived.by(() => {
		if (hovId === null || hovIdx === null) return null;
		const svc = services.find((s) => s.id === hovId);
		if (!svc) return null;
		return { entry: svc.history[hovIdx], svcName: svc.name };
	});

	const TOOLTIP_W = 220;
	const TOOLTIP_GAP = 12;
	const chartTopOffset = $derived(chartWrapperEl?.offsetTop ?? 0);
	const tipAboveDot = $derived(hovDotY > 80);
	const tipLeft = $derived(
		Math.max(4, Math.min(hovDotX - TOOLTIP_W / 2, containerWidth - TOOLTIP_W - 4))
	);
	const tipTop = $derived(
		tipAboveDot
			? chartTopOffset + hovDotY - TOOLTIP_GAP
			: chartTopOffset + hovDotY + TOOLTIP_GAP
	);

	// Brush-to-zoom state
	let brushStartX = $state<number | null>(null);
	let brushEndX = $state<number | null>(null);

	/**
	 * ⛔ THE DRAG NEVER STARTED. (2026-09-04, fixing the report "drag zooming
	 * … doesn't do anything".) `target.tagName === 'rect'` was meant to
	 * exempt exactly one thing — a mark's own `data-dot` hit target, a
	 * `<rect>` since the independent-left/right-reach pass above — but every
	 * ROW BACKGROUND is *also* a `<rect>` (see "Row backgrounds" at the draw
	 * site), painted under the marks and covering the entire lane. A
	 * pointerdown anywhere in a lane that isn't precisely on a mark's small
	 * hit target lands on that background rect, so this check bailed out of
	 * starting a brush on almost every press — the SVG never saw a brush
	 * begin. Scoped to the attribute the hit targets actually carry
	 * (`data-dot` on a mark, `data-cluster` on a merged bubble's own hit
	 * target — see below), a press anywhere else in the plot correctly
	 * starts the drag.
	 */
	function isInteractiveMark(target: Element): boolean {
		return target.closest('[data-dot], [data-cluster]') !== null;
	}

	function onPointerDown(ev: PointerEvent) {
		const target = ev.target as Element;
		if (isInteractiveMark(target)) return;
		if (!containerEl || !chartWrapperEl) return;
		const rect = chartWrapperEl.getBoundingClientRect();
		const x = ev.clientX - rect.left;
		if (x < LABEL_W || x > containerWidth - PAD_R) return;
		brushStartX = x;
		brushEndX = x;
		hovId = null;
		hovIdx = null;
		(ev.currentTarget as SVGElement).setPointerCapture(ev.pointerId);
		ev.preventDefault();
	}

	function onPointerMove(ev: PointerEvent) {
		if (brushStartX === null || !chartWrapperEl) return;
		const rect = chartWrapperEl.getBoundingClientRect();
		const cx = ev.clientX - rect.left;
		brushEndX = Math.max(LABEL_W, Math.min(containerWidth - PAD_R, cx));
	}

	function onPointerUp(ev: PointerEvent) {
		const svgEl = ev.currentTarget as SVGElement;
		if (svgEl.hasPointerCapture(ev.pointerId)) svgEl.releasePointerCapture(ev.pointerId);
		if (brushStartX === null || brushEndX === null) return;
		const a = brushStartX;
		const b = brushEndX;
		brushStartX = null;
		brushEndX = null;
		const range = brushRange(a, b, LABEL_W, plotW, startMs, endMs);
		if (range) pickRange(range);
	}

	// Axis ticks — auto-pick interval based on range size
	function axisTicks() {
		const rangeMs = endMs - startMs;
		const thresholds: [number, number][] = [
			[30 * 60_000, 5 * 60_000],
			[3 * 3_600_000, 10 * 60_000],
			[12 * 3_600_000, 3_600_000],
			[3 * 86_400_000, 4 * 3_600_000],
			[14 * 86_400_000, 86_400_000],
			[60 * 86_400_000, 5 * 86_400_000]
		];
		let iv = thresholds.find(([lim]) => rangeMs < lim)?.[1] ?? rangeMs / 6;
		const showTime = rangeMs < 3 * 86_400_000;

		// ⚠️ THE INTERVAL WAS CHOSEN FROM THE RANGE ALONE, AND A LABEL HAS A
		// WIDTH. At 390 the plot is ~270px and a 7-day range asked for seven
		// `Aug 24`-sized labels in it, which rendered as `Aug 24Aug 25Aug 26…`
		// — one continuous string of overlapping glyphs. Double the interval
		// until each label has room. `Aug 24` measures ~44px at 10px and
		// `14:00` ~30px; the floors below carry a gutter.
		const minPx = showTime ? 44 : 58;
		let guard = 0;
		while (plotW * (iv / rangeMs) < minPx && guard++ < 12) iv *= 2;

		const ticks: { x: number; label: string }[] = [];
		let t = Math.ceil(startMs / iv) * iv;
		while (t <= endMs) {
			const ratio = (t - startMs) / (endMs - startMs);
			const x = LABEL_W + ratio * plotW;
			const d = new Date(t);
			const label = showTime
				? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
				: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			ticks.push({ x, label });
			t += iv;
		}
		return ticks;
	}

	const ticks = $derived(axisTicks());

	function fmtTooltipDate(ts: string) {
		return new Date(ts).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function truncate(s: string, n: number) {
		return s.length > n ? s.slice(0, n - 1) + '…' : s;
	}
</script>

<div class="relative w-full select-none" bind:this={containerEl}>
	{#if isCompact}
		<!--
			⭐ THE COMPACT ROW. One line, no axis, no picker — see the
			`isCompact` derivation above for why fewer than 3 points earns this
			instead of a chart. `deploy`/`deploys` matches the vocabulary
			decision's noun for THIS rollout's own act (`lib/CLAUDE.md`, "(d)
			`deploy` is the act"); `ago` always carries its own number, never a
			bare one.
		-->
		<div
			class="flex min-h-[52px] items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400"
		>
			<span class="text-gray-700 dark:text-gray-200"
				>{totalPoints} deploy{totalPoints === 1 ? '' : 's'}</span
			>
			{#if latestPointMs !== null}
				<span>· {formatTimeAgoCompact(new Date(latestPointMs).toISOString(), now)} ago</span>
			{/if}
		</div>
	{:else}
	<!-- Time range selector -->
	<!-- ⛔ `gap-1` (4px) WAS TIGHTER THAN THE TOUCH FLOOR'S OWN MATH ASSUMES,
	     ON BOTH AXES. (2026-09-03, activity/touch lane, F5b) `app.css`'s
	     `.pill-btn::before` narrows to 4px of horizontal reach a side so two
	     neighbours' slop MEETS instead of overlapping — `4 + 4 = 8`, tuned
	     to `/activity`'s own filter rows (`gap-x-2`). At this row's bare
	     `gap-1` that arithmetic still summed to more than the visible 4px
	     column gap, so `1H`/`6H`/`1D` measured ZERO right-reach at 390.
	     `gap-x-2` alone was not enough either: at 390 this row WRAPS to two
	     lines, and the vertical reach (`+12px` formula: a 20px pill needs
	     6px a side) needs 6 + 6 = 12px between wrapped rows — a flat `gap-2`
	     row-gap (8px) reproduced the identical overlap one axis over,
	     measured live as a 2px downward reach on the wrapped row's own
	     pills. `gap-x-2 gap-y-3` is the EXACT recipe `/activity`'s own
	     control strip already uses one section down, for the identical
	     reason (see that file's comment above its `mb-4 flex flex-wrap …
	     gap-y-3`) — reused, not reinvented. -->
	<div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-3">
		<!-- THE LOUDEST OBJECT IN THE PRODUCT WAS THIS BUTTON (2026-08-27,
		     colour audit §2a). Selected, it was `bg-blue-600 #155dfc` at
		     presence 207.8 — louder than the `stuck` alarm chip anywhere
		     (204.1 light / 155.5 dark) and dEok 0.0591 from `Deploying`
		     `blue-700`, i.e. below the JND. The loudest mark on `/activity`
		     wore a STATUS hue and meant "you clicked this".
		     It broke three more rules at once: `rounded-md` (banned radius),
		     `px-2.5 py-1` (two off-scale spacing values) and a 12px type size
		     that is not one of the nine roles. All four are fixed here by
		     adopting the near-neutral selected state the `ALL / DEPLOYS /
		     IN PROGRESS / FAILURES` row 30px below already uses, so the two
		     filter rows are one control language instead of two.

		     ⛔ AND A FIFTH ONE SURVIVED THAT PASS: `text-[11px] font-semibold
		     uppercase tracking-wider` is a THIRD ad hoc uppercase size next to
		     `/activity`'s own `KIND_FILTERS` row 30px below (`t-label`,
		     10px/600) — one pixel apart, at the SAME radius, weight and
		     padding, which reads as an accident rather than a decision.
		     `app.css`'s own note above `.t-label` already closed this budget
		     ("the old 9/10/11px sprawl collapses to exactly `t-label` and
		     `t-micro`"); this row moves onto the documented role instead of
		     widening it. (2026-09-02)
		     ⛔ AND THE SELECTED PILL WAS 2PX SHORTER THAN ITS NEIGHBOURS. The
		     unselected state carries a 1px border and the selected one had
		     none, so on a border-box button the border-less one is 2px
		     smaller in both axes at identical padding.
		     `border-gray-900`/`border-gray-100` match the fill exactly, so
		     the border is invisible and the box is the same size either
		     way.
		     ⛔ AND `py-1` MADE IT 2PX TALLER THAN THE ENV CHIPS ON `/activity`'S
		     OWN CONTROL STRIP (F16, DESIGN PASS 5) — this row shares the exact
		     class string with `/activity`'s `KIND_FILTERS` row by design (see
		     that file's matching comment), so the fix travels with it: `py-1`
		     → `py-[3px]` puts the pill at the env chip's hard 20px (`.chip` in
		     app.css), instead of 22px. -->

		{#each TIME_RANGES as { value, label }}
			<button
				class="pill-btn t-label rounded border px-3 py-[3px] transition-colors {isPreset(timeRange) &&
				timeRange === value
					? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
					: 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
				onclick={() => pickRange(value)}
			>
				{label}
			</button>
		{/each}
		{#if !isPreset(timeRange)}
			<div
				class="ml-2 flex items-center gap-1 rounded border border-gray-200 bg-transparent px-3 py-1 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300"
			>
				<span class="font-mono">
					{fmtTooltipDate(new Date(timeRange.start).toISOString())} – {fmtTooltipDate(
						new Date(timeRange.end).toISOString()
					)}
				</span>
				<button
					class="pill-btn rounded px-1 hover:bg-gray-100 dark:hover:bg-gray-700"
					onclick={() => {
						timeRange = '7d';
					}}
					title="Reset zoom"
					aria-label="Reset zoom"
				>
					✕
				</button>
			</div>
		{:else}
			<span class="ml-2 hidden text-xs text-gray-500 sm:inline dark:text-gray-400">
				drag to zoom
			</span>
		{/if}
	</div>

	<!-- Chart container -->
	<div
		bind:this={chartWrapperEl}
		class="relative overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
	>
		{#if services.length === 0}
			<div class="flex h-24 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
				No data
			</div>
		{:else}
			<svg
				style="width: 100%; display: block; touch-action: none; cursor: {brushStartX !== null
					? 'ew-resize'
					: 'crosshair'};"
				height={chartH}
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
				onmouseleave={() => {
					hovId = null;
					hovIdx = null;
				}}
				role="group"
				aria-label="Deployment timeline — one mark per deploy, newest to the right. Every mark is also a row in the list below. Each lane is one tab stop; left and right arrows move between the marks in a lane."

			>
				<!-- Row backgrounds -->
				{#each services as svc, i}
					{@const y = PAD_T + i * ROW_H}
					<rect
						x={0}
						y={y}
						width={containerWidth}
						height={ROW_H}
						class={svc.isCurrent
							? 'fill-blue-50 dark:fill-blue-950/20'
							: i % 2 === 0
								? 'fill-transparent'
								: 'fill-gray-50 dark:fill-gray-800/30'}
					/>
				{/each}

				<!-- Vertical grid lines at ticks -->
				{#each ticks as tick}
					<line
						x1={tick.x}
						y1={PAD_T}
						x2={tick.x}
						y2={PAD_T + services.length * ROW_H}
						stroke-width={0.5}
						stroke-dasharray="3 3"
						class="stroke-gray-200 dark:stroke-gray-700"
					/>
				{/each}

				<!-- Per-service swimlanes -->
				{#each lanes as { svc, entries, order, xs, dys, hitBoxes: laneHitBoxes, clusterOf, clusters, clusterRuns: laneClusterRuns }, i}
					{@const cy = rowCY(i)}
					{@const cursor = cursorFor(svc.id, order)}

					<!-- Label.
					     ⛔ THE CURRENT LANE USED TO BE BLUE-700 MONO. (2026-09-03,
					     design pass 7, finding #17.) On the History tab this is
					     the rollout whose page you are ON, and blue is the
					     product's one reserved hue for `Deploying` — it has no
					     other legitimate meaning anywhere in the app (see
					     `src/lib/CLAUDE.md`'s colour rulings). Naming "this is the
					     subject" with a status hue reads as if the lane were mid-
					     deploy. `gray-900`/`white` is what every other rollout
					     name on this page prints; the lane stays visually
					     distinguished from its siblings by WEIGHT (darker than the
					     muted `gray-500` non-current rows), not by borrowing a
					     colour that already means something else. -->
					<text
						x={LABEL_W - 10}
						y={cy + 4}
						text-anchor="end"
						font-size="11"
						font-family="ui-monospace, 'Cascadia Code', Menlo, monospace"
						class={svc.isCurrent
							? 'fill-gray-900 dark:fill-white'
							: 'fill-gray-500 dark:fill-gray-400'}
					>
						{truncate(svc.name, LABEL_CHARS)}
					</text>

					<!-- Separator after label -->
					<line
						x1={LABEL_W - 4}
						y1={PAD_T + i * ROW_H}
						x2={LABEL_W - 4}
						y2={PAD_T + (i + 1) * ROW_H}
						stroke-width={1}
						class="stroke-gray-200 dark:stroke-gray-700"
					/>

					<!-- Horizontal swim-lane track -->
					<line
						x1={LABEL_W}
						y1={cy}
						x2={containerWidth - PAD_R}
						y2={cy}
						stroke-width={svc.isCurrent ? 1.5 : 1}
						class={svc.isCurrent
							? 'stroke-blue-300 dark:stroke-blue-700'
							: 'stroke-gray-200 dark:stroke-gray-700'}
					/>

					<!-- Deployment dots.
					     ⛔ ONE TAB STOP PER LANE, NOT ONE PER MARK — see `onDotKey`.
					     The `<g>` is the composite widget: it is named, it holds the
					     marks, and exactly one of them is in the tab order at a time.
					     `data-lane` / `data-dot` are how the key handler finds its
					     siblings without minting an id per dot (two timelines can be
					     on one page, and ids would collide). -->
					<g data-lane={svc.id} role="group" aria-label={laneLabel(svc.name, entries.length)}>
						{#each entries as { e, i: origIdx }, pos}
							{@const x = xs[pos]}
							<!-- `cy + dys[pos]`: the fan that keeps two colliding deploys
							     from drawing as one mark. `x` is never touched. -->
							{@const dy = cy + dys[pos]}
							{@const isHov = hovId === svc.id && hovIdx === origIdx}
							{@const isSel =
								selectedEntry?.serviceId === svc.id && selectedEntry?.index === origIdx}
							{@const active = isHov || isSel}
							{@const r = active ? R_ACTIVE : R_NORMAL}
							<!-- Merged into the lane's count bubble, and drawn only when
							     the reader is pointing at it. -->
							{@const merged = clusterOf[pos] !== -1 && !active}
							<!-- Halo for the active dot. It was four status-tinted rgba
							     literals (one of them `green-500`, a banned token); the dot
							     already grows on hover, so the halo only has to say WHICH
							     one and can be neutral. -->
							{#if active}
								<circle
									cx={x}
									cy={dy}
									r={r + 5}
									class="fill-gray-900/10 dark:fill-gray-100/15"
								/>
							{/if}

							<!-- THE ROLLBACK RING. A deploy that went backwards is the one
							     deviation on a lane of forward deploys, and it was drawn as
							     the identical circle. A concentric ring in the mark's OWN ink
							     spends no colour, reads in greyscale, and survives the fan
							     above because it moves with the dot. `pointer-events-none` so
							     it never steals the dot's hover or click. -->
							{#if e.mark === 'rollback' && !merged}
								<circle
									cx={x}
									cy={dy}
									r={r + 3}
									fill="none"
									stroke-width={1.5}
									pointer-events="none"
									class="stroke-gray-900 dark:stroke-gray-100"
								/>
							{/if}

							<!-- ⭐ A ≥32px TRANSPARENT HIT CIRCLE, SEPARATE FROM THE 10px
							     VISIBLE MARK. (2026-09-03, design pass 7, finding #6.)
							     Measured at 390: the drawn dot is 10px (5px radius) —
							     a third of the 32px floor every other small control on
							     this pass was widened to. All the interactive wiring
							     (the `data-dot` the keyboard handler queries, the
							     accessible name, the tab stop, every pointer/focus
							     handler) moves to this invisible circle; the visible
							     one below becomes purely cosmetic. Radius 16 (a 32px
							     circle) is not conditioned on `pointer: coarse` — a
							     bigger click target costs a mouse user nothing, and a
							     conditional radius on an SVG attribute has no clean
							     media-query hook the way a CSS `::before` does.

							     ⭐ A `<rect>`, NOT A `<circle>` — SEE `hitBoxes` ABOVE.
							     `laneHitBoxes[pos]` is `{left, right}`, each independently
							     up to 16px, because a `<circle>`'s one radius forced the
							     UNCONTESTED side down to match the tight one. The rect's
							     vertical half-height is a bare `16` — not `hitBoxes`'
							     own arithmetic — because nothing in a lane ever contests
							     y at `fanOverlaps={false}`; coupling it to the horizontal
							     squeeze (the old circle's radius) was giving up 32px of
							     clean vertical reach on every crowded mark for no reason. -->
							{@const hb = laneHitBoxes[pos]}
							<rect
								x={x - hb.left}
								y={dy - 16}
								width={hb.left + hb.right}
								height={32}
								fill="transparent"
								data-dot=""
								pointer-events="all"
								class="cursor-pointer"
								role="button"
								aria-label={dotLabel(svc, e)}
								tabindex={pos === cursor ? 0 : -1}
								onmouseenter={() => {
									if (brushStartX !== null) return;
									hovId = svc.id;
									hovIdx = origIdx;
									hovDotX = x;
									hovDotY = dy;
								}}
								onmouseleave={() => {
									hovId = null;
									hovIdx = null;
								}}
								onfocus={() => {
									laneCursor[svc.id] = pos;
									hovId = svc.id;
									hovIdx = origIdx;
									hovDotX = x;
									hovDotY = dy;
								}}
								onblur={() => {
									if (hovId === svc.id && hovIdx === origIdx) {
										hovId = null;
										hovIdx = null;
									}
								}}
								onclick={() => onEntryClick?.(svc.id, origIdx)}
								onkeydown={(ev) =>
									onDotKey(ev, svc.id, pos, order, () => onEntryClick?.(svc.id, origIdx))}
							/>
							<circle
								cx={x}
								cy={dy}
								{r}
								stroke-width={active ? 2 : 1}
								pointer-events="none"
								aria-hidden="true"
								class={merged
									? 'fill-transparent stroke-transparent'
									: `stroke-white dark:stroke-gray-800 ${statusFill(e.bakeStatus)}`}
							/>
						{/each}

						<!-- ⭐ THE COUNT BUBBLE — AND, AS OF 2026-09-04, A REAL CONTROL.
						     One per collided run, painted after the marks it stands for,
						     so it wins SVG's paint-order hit-testing across its own
						     visible footprint the same way the halo/rollback ring above
						     already do. The marks are still in the DOM, still named,
						     still in the tab order — this is their picture, not a
						     replacement for them.
						     ⛔ WHY THE HIT TARGET SITS ON TOP INSTEAD OF LETTING CLICKS
						     FALL THROUGH TO A MEMBER (the original design, and what the
						     `pointer-events: none` on the cosmetic circle+text below
						     still claims for MOUSE HOVER). Measured live on the real
						     7-day fixture: `hitBoxes`' half-gap floor (`R_NORMAL`, so a
						     member never partitions to a dead zero-width target) means a
						     run of 7-10 members packed inside `MIN_SEP`=12px produces
						     hit rects that mutually OVERLAP almost entirely — there is
						     no gap in the middle of the bubble for a "falls through"
						     layer to catch, and paint order (members iterate NEWEST
						     FIRST, so the OLDEST is drawn last) meant every pixel across
						     the whole bubble already resolved to that one oldest member
						     regardless of where you clicked. A "resolves to whichever
						     member is nearest" story was never true for a cluster this
						     dense; it only holds for two members with real room between
						     them. Landing the bubble's own hit target on top makes the
						     whole visible glyph reliably ONE control — the one thing the
						     drawing actually promises — and is a strict improvement over
						     a click that silently always hit the same hidden member.
						     Individual members stay reachable exactly as before: by
						     keyboard (`←`/`→` walk every position regardless of visual
						     merging, unaffected by any of this) and, once zoomed in via
						     this control, by mouse again — clustering is a function of
						     the CURRENT window, not a permanent fact about the data. -->
						{#each clusters as c, ci (ci)}
							{@const openHere = entries.some(
								(en, pos) =>
									clusterOf[pos] === ci &&
									((hovId === svc.id && hovIdx === en.i) ||
										(selectedEntry?.serviceId === svc.id && selectedEntry?.index === en.i))
							)}
							{#if !openHere}
								<!-- ⛔ THE NUMERAL WAS 9PX, BELOW THE PRODUCT'S 10PX FLOOR.
								     (2026-09-02) It is the smallest text in the whole
								     chart and the one number a merged mark exists to make
								     legible — shrinking it below the floor to fit the
								     bubble was solving the wrong side of the equation.
								     `R_CLUSTER` grew by 0.5 instead. -->
								{@const cr = c.count > 9 ? R_CLUSTER + 2 : R_CLUSTER}
								{@const run = laneClusterRuns[ci]}
								<circle
									cx={c.cx}
									cy={cy}
									r={cr}
									stroke-width={1}
									pointer-events="none"
									aria-hidden="true"
									class="stroke-white dark:stroke-gray-800 {statusFill(c.status)}"
								/>
								<text
									x={c.cx}
									y={cy + 3.5}
									text-anchor="middle"
									font-size="10"
									font-weight="600"
									pointer-events="none"
									aria-hidden="true"
									class="fill-white dark:fill-gray-900"
								>
									{c.count}
								</text>
								<!-- ⭐ THE BUBBLE'S OWN HIT TARGET. A `<circle>` bigger than
								     the drawn glyph — `cr` is 8-10px, this reaches `cr + 6`,
								     never past 16 (the same 32px-diameter floor every other
								     control on this chart earns) — but deliberately NOT
								     enlarged all the way to 16 regardless of `cr`: a full
								     16px reach centred on a tight cluster risks swallowing a
								     genuinely separate NEIGHBOURING mark's own small hit
								     rect (clusters are only guaranteed `MIN_SEP`=12px from
								     whatever sits next to them, not 32). `pointer-events:
								     all` on a `fill: transparent` shape — `visiblePainted`'s
								     default would otherwise skip an unpainted fill. -->
								<circle
									cx={c.cx}
									cy={cy}
									r={Math.min(16, cr + 6)}
									fill="transparent"
									data-cluster=""
									pointer-events="all"
									class="cursor-pointer"
									role="button"
									aria-label={clusterLabel(svc.name, c.count)}
									tabindex={0}
									onclick={() => activateCluster(svc.id, entries, run)}
									onkeydown={(ev) => {
										if (ev.key === 'Enter' || ev.key === ' ') {
											ev.preventDefault();
											activateCluster(svc.id, entries, run);
										}
									}}
								/>
							{/if}
						{/each}
					</g>

					<!-- Empty period label -->
					{#if entries.length === 0 && (svc.isCurrent || labelEmptyLanes)}
						<text
							x={LABEL_W + plotW / 2}
							y={cy + 4}
							text-anchor="middle"
							font-size="11"
							class="fill-gray-500 dark:fill-gray-400"
						>
							No deployments in this period
						</text>
					{/if}
				{/each}

				<!-- X-axis baseline -->
				<line
					x1={LABEL_W}
					y1={PAD_T + services.length * ROW_H}
					x2={containerWidth - PAD_R}
					y2={PAD_T + services.length * ROW_H}
					stroke-width={1}
					class="stroke-gray-500 dark:stroke-gray-400"
				/>

				<!-- X-axis ticks + labels -->
				{#each ticks as tick}
					<line
						x1={tick.x}
						y1={PAD_T + services.length * ROW_H}
						x2={tick.x}
						y2={PAD_T + services.length * ROW_H + 5}
						stroke-width={1}
						class="stroke-gray-500 dark:stroke-gray-400"
					/>
					<text
						x={tick.x}
						y={PAD_T + services.length * ROW_H + 18}
						text-anchor="middle"
						font-size="11"
						font-family="ui-sans-serif, system-ui, sans-serif"
						class="fill-gray-500 dark:fill-gray-400"
					>
						{tick.label}
					</text>
				{/each}

				<!-- "Now" marker.
				     ⭐ ONLY WHEN THE RIGHT EDGE ACTUALLY IS NOW. (2026-09-03,
				     design pass 7, finding #17.) The sparse-data branch of
				     `computeBounds` anchors the right edge on the LATEST EVENT
				     plus padding, not on the clock — a chart with one old dot
				     used to draw a dashed line at the plot's right edge
				     labelled `now` when the data stopped hours or days
				     earlier. `showsNow` is the same test in reverse: draw the
				     marker only when `endMs` is (within a second of) the
				     actual current time. -->
				{#if showsNow}
					<line
						x1={containerWidth - PAD_R}
						y1={PAD_T}
						x2={containerWidth - PAD_R}
						y2={PAD_T + services.length * ROW_H}
						stroke-width={1.5}
						stroke-dasharray="4 2"
						class="stroke-gray-500 dark:stroke-gray-400"
					/>
					<!-- Was 9px — under the product's 10px floor, and the only other
					     offender in this chart besides the cluster-bubble numeral
					     above. (2026-09-02) -->
					<text
						x={containerWidth - PAD_R - 4}
						y={PAD_T + 10}
						text-anchor="end"
						font-size="11"
						class="fill-gray-500 dark:fill-gray-400"
					>
						now
					</text>
				{/if}

				<!-- Brush overlay (drag-to-zoom) -->
				{#if brushStartX !== null && brushEndX !== null}
					<rect
						x={Math.min(brushStartX, brushEndX)}
						y={PAD_T}
						width={Math.abs(brushEndX - brushStartX)}
						height={services.length * ROW_H}
						class="fill-blue-500/15 stroke-blue-500"
						stroke-width="1"
						stroke-dasharray="3 3"
						pointer-events="none"
					/>
				{/if}
			</svg>
		{/if}
	</div>

	<!-- Tooltip (outside chart wrapper to avoid overflow clipping) -->
	{#if tooltipEntry}
		{@const { entry, svcName } = tooltipEntry}
		<div
			class="pointer-events-none absolute z-50 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-xl backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/95"
			style="left: {tipLeft}px; top: {tipTop}px; width: {TOOLTIP_W}px; transform: {tipAboveDot
				? 'translateY(-100%)'
				: 'translateY(0)'};"
		>
			<div class="mb-1.5 flex items-center gap-2">
				<span
					class="h-2.5 w-2.5 flex-shrink-0 rounded-full {statusInk(entry.bakeStatus)}"
				></span>
				<span class="font-mono text-xs font-semibold text-gray-900 dark:text-white">
					{entry.version.version || entry.version.revision?.slice(0, 12) || entry.version.tag}
				</span>
			</div>
			{#if entry.subject}
				<div class="text-xs font-medium text-gray-700 dark:text-gray-200">{entry.subject}</div>
			{/if}
			<div class="text-xs text-gray-500 dark:text-gray-400">{fmtTooltipDate(entry.timestamp)}</div>
			{#if svcName}
				<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{svcName}</div>
			{/if}
			<div class="mt-1 text-xs font-medium {statusText(entry.bakeStatus)}">
				{entry.bakeStatus || 'Unknown'}
			</div>
			{#if entry.mark === 'rollback'}
				<div class="mt-1 text-xs font-semibold text-gray-900 dark:text-white">
					Rolled back to an older release
				</div>
			{/if}
			{#if entry.triggeredBy}
				<div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
					{entry.triggeredBy.kind === 'User' ? entry.triggeredBy.name : 'System'}
				</div>
			{/if}
		</div>
	{/if}

	<!-- THE LEGEND IS DELETED (2026-08-27, colour audit §2c). It listed five
	     dummy swatches — `● Succeeded ● Failed ● InProgress ● Deploying ● Other` —
	     under a chart whose dots the tooltip already names. DESIGN.md: *"A page
	     that needs a legend to explain a missing element is a page whose
	     encoding is not carrying"*, and the human had the `/apps` footer legend
	     and its dummy ruler deleted on 2026-08-26 for exactly this. It was also
	     the only place three of the off-token hexes above were still spelled
	     out. With `Succeeded` now neutral, the encoding is "coloured = a
	     deploy that is not finished or not fine", which needs no key. -->
	{/if}
</div>
