<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE TENURE STRIP (History's header `below` slot). Redesign, round 4,
	 * 2026-10-10.
	 *
	 * ROLE: the one visual answer to History's question (SPEC §7): "Which
	 * build can I safely go back to, and when did it go wrong?" It sits where
	 * the Overview puts its promotion lane, and it is operable: hover or focus
	 * a segment for its card (build, commit, outcome, ran for N, by whom,
	 * Roll back to this / View diff, failed checks); click to select its
	 * ledger row (`onSelect`).
	 *
	 * THE SHAPE: ONE track. Each build is ONE segment, from its deploy to the
	 * next deploy (the running one to Now), separated by 1px gaps of the page
	 * ground. That is the whole object: there is no marker row above it and
	 * so nothing to cluster, no stem to miss, nothing drawn under a count.
	 * - Healthy past build: quiet neutral (`line-strong`), sha inside when it
	 *   fits, and how long it ran when there is room ("b7e0d41  3d").
	 *   Neutral on purpose: these are the rollback candidates, the norm.
	 * - Failed build: `danger-solid` fill with the failed StatusMark ("!") at
	 *   its start and its sha. The one fill on the strip.
	 * - The running build ends exactly at Now with a 2px line in its state
	 *   colour along its foot (checking yellow, deploying blue; a healthy
	 *   running build draws the line neutral), its StatusMark at its start.
	 * - A rollback: the neutral UndoOutline at its segment's start (an act,
	 *   not a state).
	 *
	 * READABLE AT ANY DENSITY (why this is not a straight time scale): deploys
	 * bunch — four within an hour on Oct 6, a 29-minute live build beside a
	 * 3-day one. On a linear 7-day axis those are 2–4px slivers; the failure
	 * and the live build are exactly the ones that are short. So widths are
	 * proportional to time, with a MINIMUM per segment carved out of the long
	 * ones (the failed build first, then the running one, then rollbacks, then
	 * a few px for everything else). The axis is mapped through the same
	 * piecewise scale, so every tick still lands on its true instant relative
	 * to the segments around it; a busy day simply gets more room.
	 *
	 * Proportions borrow from the Overview's lane (the slot it fills) and
	 * PlanetScale's deploy markers (CRAFT-STUDY D4): labelled objects on the
	 * time series, labelled ticks on real day / hour boundaries, "Now" at the
	 * right edge.
	 *
	 * WHY NOT `DeploymentTimeline`: that is the multi-lane compare tool with
	 * zoom and fanning; it is still what "Compare namespace" opens.
	 */
	import { toneInk } from '$lib/view-models/state-tone';
	import { ArrowsRepeatOutline, UndoOutline, CodePullRequestSolid } from 'flowbite-svelte-icons';
	import { startOfDayMs, formatRelativeShort } from '$lib/display-time';
	import { displayTimeZone, timeZonePreference } from '$lib/timezone.svelte';
	import { actorFrom } from '$lib/actor';
	import Avatar from '$lib/components/Avatar.svelte';
	import SegmentedControl from '$lib/components/SegmentedControl.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import RestGlyph from '$lib/components/RestGlyph.svelte';
	import FailedCheckLine from '$lib/components/FailedCheckLine.svelte';

	type Entry = {
		timestamp: string;
		bakeStatus?: string;
		bakeStartTime?: string;
		bakeEndTime?: string;
		version: { tag: string; version?: string };
		/**
		 * ⭐ (2026-10-10, truth-bug fix) WAS `commitMessage`, a mock-only
		 * field the page hand-wrote per entry — it disagreed with the real
		 * commit title the row/panel below already show, because it was a
		 * second, independent guess at the same fact. The page now computes
		 * this from a real GitHub commit-range query (the exact one the
		 * row/panel use) and attaches it here under its own name, so the
		 * hover card can never show a different title than the row it hovers
		 * over.
		 */
		commitTitle?: string | null;
		triggeredBy?: { kind?: string | null; name?: string | null } | null;
		failedHealthChecks?: { name: string; message?: string }[];
		bakeStatusMessage?: string;
	};

	type PresetRange = '1d' | '7d' | '30d' | 'all';

	let {
		history,
		range = 'all',
		onRangeChange,
		onSelect,
		compareActive = false,
		onToggleCompare,
		/** Indices (into `history`) the page's `deployActs` calls a rollback. */
		rollbackIndices = new Set<number>(),
		now = Date.now(),
		diffHref,
		onRollback
	}: {
		/** Newest-first, the exact shape of `rollout.status.history`. */
		history: Entry[];
		range?: PresetRange;
		onRangeChange?: (r: PresetRange) => void;
		/** Click a segment (or its card's failed check): select + reveal its row. */
		onSelect?: (index: number) => void;
		compareActive?: boolean;
		onToggleCompare?: () => void;
		rollbackIndices?: Set<number>;
		now?: number;
		/** The card's "View diff": `undefined` when there is nothing to diff against. */
		diffHref?: (index: number) => string | undefined;
		/** The card's "Roll back to this": the page owns the confirm dialog. */
		onRollback?: (index: number) => void;
	} = $props();

	const HOUR_MS = 3_600_000;
	const DAY_MS = 86_400_000;
	const RANGE_MS: Record<Exclude<PresetRange, 'all'>, number> = {
		'1d': DAY_MS,
		'7d': 7 * DAY_MS,
		'30d': 30 * DAY_MS
	};

	// ── Measurement ────────────────────────────────────────────────────────
	let trackWidth = $state(0);
	let trackEl: HTMLElement | undefined = $state();
	/** Below `sm` the track is 20px and labels lose their duration suffix. */
	let narrow = $state(false);
	$effect(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return;
		const mq = window.matchMedia('(max-width: 639.98px)');
		narrow = mq.matches;
		const on = () => (narrow = mq.matches);
		mq.addEventListener?.('change', on);
		return () => mq.removeEventListener?.('change', on);
	});
	/** Layout width: the measured track, or a nominal one before first layout
	 *  (and in a DOM without layout) so the strip never renders collapsed. */
	const W = $derived(trackWidth > 0 ? trackWidth : 960);

	let ctx2d: CanvasRenderingContext2D | null | undefined;
	function textPx(text: string, mono: boolean): number {
		if (ctx2d === undefined) {
			try {
				// jsdom has no canvas (and logs loudly when asked): estimate there.
				ctx2d =
					typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)
						? document.createElement('canvas').getContext('2d')
						: null;
			} catch {
				ctx2d = null;
			}
		}
		const family =
			trackEl && typeof getComputedStyle === 'function'
				? getComputedStyle(trackEl)
						.getPropertyValue(mono ? '--font-mono' : '--font-sans')
						.trim()
				: '';
		if (ctx2d && family) {
			ctx2d.font = `${mono ? 400 : 400} 12px ${family}`;
			const w = ctx2d.measureText(text).width;
			if (w > 0) return Math.ceil(w);
		}
		return Math.ceil(text.length * (mono ? 7.3 : 6.6));
	}

	// ── The window and the builds in it ────────────────────────────────────
	const times = $derived(
		history
			.map((e, i) => ({ i, t: new Date(e.timestamp).getTime(), e }))
			.filter((x) => Number.isFinite(x.t))
			.sort((a, b) => b.t - a.t)
	);

	/**
	 * `all` starts at the first deploy (no empty pad to explain). A preset
	 * window ends at Now, but ALSO clamps its own start up to the first
	 * deploy when the data doesn't fill it — AD round 4: "start the
	 * incident's 1d axis at the first deploy, not 67% dashed 'No earlier
	 * deploys'." A hard `now - 24h` start on a rollout whose only two
	 * deploys sit inside the last 6h drew 18 of 24 empty hours before
	 * anything the reader came to see. `Math.max(nominalStart, …)` still
	 * honours the preset's own promise — a "1d" view never silently grows
	 * into a 7d one just because the nominal start clamps up; it only ever
	 * moves FORWARD, trimming empty lead-in, never hiding real data that
	 * already sat outside the window.
	 */
	const bounds = $derived.by(() => {
		if (range === 'all') {
			if (times.length === 0) return { start: now - DAY_MS, end: now };
			const earliest = times[times.length - 1].t;
			return { start: Math.min(earliest, now - 60_000), end: now };
		}
		const nominalStart = now - RANGE_MS[range];
		if (times.length === 0) return { start: nominalStart, end: now };
		const earliest = times[times.length - 1].t;
		const start = Math.max(nominalStart, Math.min(earliest, now - 60_000));
		return { start, end: now };
	});

	type Seg = {
		i: number;
		e: Entry;
		/** True deploy time / tenure end (unclipped, for the card). */
		t: number;
		endT: number;
		/** Clipped to the window (for layout). */
		t0: number;
		t1: number;
		failed: boolean;
		head: boolean;
		rollback: boolean;
		sha: string;
	};

	const segs = $derived.by((): Seg[] => {
		const out: Seg[] = [];
		times.forEach((x, idx) => {
			const endT = idx === 0 ? now : times[idx - 1].t;
			const t0 = Math.max(x.t, bounds.start);
			const t1 = Math.min(endT, bounds.end);
			if (t1 <= bounds.start || t0 >= bounds.end || t1 < t0) return;
			out.push({
				i: x.i,
				e: x.e,
				t: x.t,
				endT,
				t0,
				t1,
				failed: x.e.bakeStatus === 'Failed',
				head: x.i === 0 && idx === 0,
				rollback: rollbackIndices.has(x.i),
				sha: x.e.version?.version || x.e.version?.tag || ''
			});
		});
		return out.reverse(); // chronological, left to right
	});

	function liveState(s: Seg): 'checking' | 'deploying' | null {
		if (!s.head) return null;
		if (s.e.bakeStatus === 'InProgress') return 'checking';
		if (s.e.bakeStatus === 'Deploying' || !s.e.bakeStatus) return 'deploying';
		return null;
	}
	/** The mark at a segment's start: an outcome or an act, never the norm. */
	function markOf(s: Seg): 'failed' | 'checking' | 'deploying' | 'rollback' | null {
		if (s.failed) return 'failed';
		const live = liveState(s);
		if (live) return live;
		if (s.rollback) return 'rollback';
		return null;
	}

	// ── Layout: proportional widths with carved-out minimums ───────────────
	const GAP = 1;
	const PAD = 8;
	const MARK = 16;
	const MARK_GAP = 6;

	type Box = {
		seg: Seg | null;
		left: number;
		width: number;
		label: boolean;
		mark: boolean;
		dur: string | null;
		/** True when the water-fill pinned this segment to its minimum
		 *  readable width instead of its real, proportional-to-time share —
		 *  AD round 4: "show the axis stretch with a subtle break mark or a
		 *  tinted band where the minimum widths warp time." A reader scanning
		 *  the strip as a time axis should be able to tell where it stopped
		 *  being one. */
		warped: boolean;
		/** ⭐ A RUN OF ≥ 2 ADJACENT, UNMARKED SUB-8PX BUILDS, MERGED INTO ONE
		 *  BOX (AD round 6, item 3: "overlapping sub-8px hit areas… merge
		 *  runs of adjacent sub-8px builds into one 'N builds' cluster mark
		 *  whose hover card lists them"). `seg` stays `null` on a cluster box
		 *  (same contract as the empty-track box) — `cluster` is what makes
		 *  it a cluster rather than "before the first build". Oldest first,
		 *  same order `segs` is already in. */
		cluster?: Seg[];
		/** ⭐ A REPEAT OCCURRENCE OF A BUILD ALREADY LABELLED ELSEWHERE, WIDE
		 *  ENOUGH TO SAY SO (AD round 7, item 4): "label every segment wider
		 *  than its label — a repeat build reads 'same build' in muted
		 *  text, never blank." The sha itself still prints on only ONE
		 *  segment per build (its widest — `keepsSha`, below), but every
		 *  OTHER segment of that same build used to go blank the moment it
		 *  was wide enough to hold real text, which reads as a bug (an
		 *  unlabelled slot beside labelled ones at the same width) rather
		 *  than the deliberate "print once" rule it actually is. */
		repeat: boolean;
	};

	function labelPx(s: Seg): number {
		return PAD * 2 + (markOf(s) ? MARK + MARK_GAP : 0) + textPx(s.sha, true);
	}
	function durLabel(s: Seg): string {
		return formatRelativeShort(new Date(s.t).toISOString(), new Date(s.endT));
	}
	/** The "same build" fallback's own pixel ask — prose (`textPx(…, false)`),
	 *  not mono, since it is a WORD, not an identifier (AD round 7, item 4). */
	function repeatPx(s: Seg): number {
		return PAD * 2 + (markOf(s) ? MARK + MARK_GAP : 0) + textPx('same build', false);
	}

	/** The minimum readable/hoverable/tappable width — `CadenceStrip`'s own
	 *  floor everywhere else a width is checked against a readability bar
	 *  (`PAD * 2 + MARK - 4` for a mark-only segment is bigger still; this
	 *  is the UNMARKED floor). Below it a segment is a hit-testing sliver,
	 *  not a build a reader can aim at. */
	const MIN_HIT = 8;

	/** ⭐ MERGE RUNS OF ≥ 2 ADJACENT SUB-8PX, UNMARKED BOXES INTO ONE CLUSTER
	 *  (AD round 6, item 3). A marked box (failed/checking/deploying/
	 *  rollback) never merges — `layout`'s own priority sizing above already
	 *  guarantees it at least a mark-only width, well over this floor, so a
	 *  box that still qualifies here is always an ordinary healthy build
	 *  with nothing but a sha nobody can read at this width. A LONE sub-8px
	 *  box (no neighbour in the same state) is left alone: it reads as a
	 *  slim but singular build, not a run to explain away. */
	function mergeSubPxClusters(boxes: Box[]): Box[] {
		const out: Box[] = [];
		let i = 0;
		while (i < boxes.length) {
			const b = boxes[i];
			if (b.seg && !b.mark && b.width < MIN_HIT) {
				const run: Box[] = [];
				let j = i;
				while (j < boxes.length && boxes[j].seg && !boxes[j].mark && boxes[j].width < MIN_HIT) {
					run.push(boxes[j]);
					j++;
				}
				if (run.length >= 2) {
					const left = run[0].left;
					const right = run[run.length - 1].left + run[run.length - 1].width;
					out.push({
						seg: null,
						left,
						width: Math.max(right - left, MIN_HIT),
						label: false,
						mark: false,
						dur: null,
						warped: run.some((r) => r.warped),
						cluster: run.map((r) => r.seg as Seg),
						repeat: false
					});
					i = j;
					continue;
				}
			}
			out.push(b);
			i++;
		}
		return out;
	}

	const layout = $derived.by((): Box[] => {
		const width = W;
		type Item = { seg: Seg | null; d: number; min: number };
		const items: Item[] = [];
		// A window that starts before the first build: honest empty track.
		if (segs.length > 0 && segs[0].t0 > bounds.start) {
			items.push({ seg: null, d: segs[0].t0 - bounds.start, min: 0 });
		}
		const base = narrow ? 3 : 4;
		for (const s of segs) items.push({ seg: s, d: Math.max(0, s.t1 - s.t0), min: base });
		if (items.length === 0) return [];
		const avail = Math.max(0, width - GAP * (items.length - 1));

		// Priority minimums: the failed build(s) newest first, then the running
		// one, then rollbacks. Each asks for room for its mark + sha; if the
		// asks would eat more than 70% of the track, the lowest priority falls
		// back to mark-only, then to the base sliver.
		const prio = items
			.map((it, k) => ({ it, k }))
			.filter((x) => x.it.seg && markOf(x.it.seg))
			.sort((a, b) => {
				const rank = (s: Seg) => (s.failed ? 0 : liveState(s) ? 1 : 2);
				const ra = rank(a.it.seg!);
				const rb = rank(b.it.seg!);
				return ra !== rb ? ra - rb : b.it.seg!.t - a.it.seg!.t;
			});
		const level = prio.map(() => 2); // 2 = mark + sha, 1 = mark only, 0 = base
		const askOf = (x: (typeof prio)[number], lv: number) =>
			lv === 2 ? labelPx(x.it.seg!) : lv === 1 ? PAD * 2 + MARK - 4 : base;
		const budget = avail * 0.7;
		const total = () =>
			items.reduce((sum, it, k) => {
				const p = prio.findIndex((x) => x.k === k);
				return sum + (p >= 0 ? askOf(prio[p], level[p]) : it.min);
			}, 0);
		for (let p = prio.length - 1; p >= 0 && total() > budget; p--) {
			while (level[p] > 0 && total() > budget) level[p]--;
		}
		prio.forEach((x, p) => (x.it.min = askOf(x, level[p])));

		// Water-fill: anything whose proportional share is under its minimum
		// is pinned at the minimum; the rest share what is left by time.
		let mins = items.map((it) => it.min);
		const sumMin = mins.reduce((a, b) => a + b, 0);
		if (sumMin > avail && sumMin > 0) mins = mins.map((m) => (m * avail) / sumMin);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a per-call scratch set, built and read inside this one pass
		const pinned = new Set<number>();
		for (let guard = 0; guard < items.length + 1; guard++) {
			const freeD = items.reduce((a, it, k) => (pinned.has(k) ? a : a + it.d), 0);
			const freeA = avail - mins.reduce((a, m, k) => (pinned.has(k) ? a + m : a), 0);
			let changed = false;
			items.forEach((it, k) => {
				if (pinned.has(k)) return;
				const w = freeD > 0 ? (it.d / freeD) * freeA : freeA / (items.length - pinned.size);
				if (w < mins[k]) {
					pinned.add(k);
					changed = true;
				}
			});
			if (!changed) break;
		}
		const freeD = items.reduce((a, it, k) => (pinned.has(k) ? a : a + it.d), 0);
		const freeA = avail - mins.reduce((a, m, k) => (pinned.has(k) ? a + m : a), 0);
		const free = items.length - pinned.size;
		const widths = items.map((it, k) =>
			pinned.has(k) ? mins[k] : freeD > 0 ? (it.d / freeD) * freeA : free > 0 ? freeA / free : 0
		);

		// Positions, and what each segment can say. A sha prints once, on its
		// WIDEST segment (a build redeployed later keeps its label where it
		// ran longest); a marked segment (failed, running, rollback) always may.
		const boxes: Box[] = [];
		let x = 0;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a per-call scratch map, built and read inside this one pass
		const widest = new Map<string, number>();
		items.forEach((it, k) => {
			const s = it.seg;
			if (!s || markOf(s)) return;
			const best = widest.get(s.sha);
			if (best === undefined || widths[k] > widths[best]) widest.set(s.sha, k);
		});
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a per-call scratch set, built and read inside this one pass
		const keepsSha = new Set<number>();
		items.forEach((it, k) => {
			const s = it.seg;
			if (s && (markOf(s) || widest.get(s.sha) === k)) keepsSha.add(k);
		});
		items.forEach((it, k) => {
			const w = widths[k];
			const s = it.seg;
			let label = false;
			let mark = false;
			let dur: string | null = null;
			let repeat = false;
			if (s) {
				mark = !!markOf(s) && w >= PAD * 2 + MARK - 4;
				label = keepsSha.has(k) && w >= labelPx(s);
				if (label && !narrow) {
					const d = durLabel(s);
					if (w >= labelPx(s) + 8 + textPx(d, false)) dur = d;
				}
				// ⭐ "same build" FOR A REPEAT WIDE ENOUGH TO SAY SO (AD round 7,
				// item 4) — only the segments `keepsSha` passed over, and only
				// once they clear the text's own pixel ask; a repeat too
				// narrow for even "same build" stays a bare sliver, same as
				// any other sub-label segment.
				if (!label && !mark) repeat = w >= repeatPx(s);
			}
			boxes.push({
				seg: s,
				left: x,
				width: Math.max(0, w),
				label,
				mark,
				dur,
				warped: pinned.has(k),
				repeat
			});
			x += w + GAP;
		});
		return mergeSubPxClusters(boxes);
	});
	/** Whether any segment in the current layout was pinned to its minimum
	 *  readable width instead of its real, proportional-to-time share — the
	 *  legend only has something to explain when the hatch is actually on
	 *  screen (AD round 5, nits). */
	const hasWarped = $derived(layout.some((b) => b.warped));

	// ── The axis: real boundaries, mapped through the same scale ───────────
	function xOf(t: number): number {
		for (const b of layout) {
			const t0 = b.seg ? b.seg.t0 : bounds.start;
			const t1 = b.seg ? b.seg.t1 : (segs[0]?.t0 ?? bounds.end);
			if (t >= t0 && t <= t1) {
				return b.left + (t1 > t0 ? ((t - t0) / (t1 - t0)) * b.width : 0);
			}
		}
		return t <= bounds.start ? 0 : W;
	}

	function zoneParts(t: number) {
		const p = new Intl.DateTimeFormat('en-US', {
			hour: '2-digit',
			hour12: false,
			timeZone: displayTimeZone()
		}).formatToParts(new Date(t));
		return Number(p.find((x) => x.type === 'hour')?.value ?? '0') % 24;
	}
	function dayLabel(t: number): string {
		return new Date(t).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: displayTimeZone()
		});
	}
	function addDays(t: number, days: number): number {
		if (timeZonePreference.zone === 'utc') return t + days * DAY_MS;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local Date used for calendar arithmetic, never rendered reactively
		const d = new Date(t);
		d.setDate(d.getDate() + days);
		return d.getTime();
	}

	/** Candidate boundary instants for the span, at the finest step that
	 *  leaves ≥ ~72px per tick on a straight scale. Days over two days, hours
	 *  under; a midnight inside an hour axis is labelled with its date. */
	function candidates(start: number, end: number): { t: number; label: string }[] {
		const span = end - start;
		const maxTicks = Math.max(2, Math.floor(W / 72));
		const out: { t: number; label: string }[] = [];
		if (span > 2 * DAY_MS) {
			const days = span / DAY_MS;
			const step = [1, 2, 3, 7, 14, 30].find((s) => days / s <= maxTicks) ?? 30;
			let t = startOfDayMs(new Date(start));
			let n = 0;
			while (t <= end) {
				if (t > start && n % step === 0) out.push({ t, label: dayLabel(t) });
				t = addDays(t, 1);
				if (t > start) n++;
			}
			return out;
		}
		const hours = span / HOUR_MS;
		const step = [1, 2, 3, 6, 12].find((s) => hours / s <= maxTicks) ?? 12;
		let t = Math.ceil(start / HOUR_MS) * HOUR_MS;
		for (; t < end; t += HOUR_MS) {
			const h = zoneParts(t);
			if (h % step !== 0) continue;
			out.push({ t, label: h === 0 ? dayLabel(t) : `${String(h).padStart(2, '0')}:00` });
		}
		return out;
	}

	/** Kept ticks: "Now" anchored at the right edge, then boundary ticks centred
	 *  on their x, dropped if their real extent would touch a kept one, or the
	 *  track's edges. Extents are measured, so "OctNow" cannot happen. */
	const ticks = $derived.by(() => {
		const TICK_GAP = 12;
		const nowW = textPx('Now', false);
		const kept: { x: number; label: string; l: number; r: number; edge: boolean }[] = [
			{ x: W, label: 'Now', l: W - nowW, r: W, edge: true }
		];
		const cands = candidates(bounds.start, bounds.end)
			.map((c) => ({ ...c, x: xOf(c.t) }))
			// newest first: the recent end of the axis is where the reader looks
			.sort((a, b) => b.t - a.t);
		for (const c of cands) {
			const w = textPx(c.label, false);
			const l = c.x - w / 2;
			const r = c.x + w / 2;
			if (l < 0 || r > W) continue;
			if (kept.some((k) => l < k.r + TICK_GAP && r > k.l - TICK_GAP)) continue;
			kept.push({ x: c.x, label: c.label, l, r, edge: false });
		}
		return kept.sort((a, b) => a.x - b.x);
	});

	// ── Words ──────────────────────────────────────────────────────────────
	function outcomeWord(s: Seg): string {
		if (s.failed) return 'Failed';
		const live = liveState(s);
		if (live === 'checking') return 'Checking';
		if (live === 'deploying') return 'Deploying';
		return 'Healthy';
	}
	function outcomeInk(s: Seg): string {
		if (s.failed) return toneInk('failed');
		const live = liveState(s);
		if (live === 'checking' || live === 'deploying') return toneInk(live);
		return 'text-fg-muted';
	}
	function whenLabel(t: number): string {
		return new Date(t).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: displayTimeZone()
		});
	}
	function tenure(s: Seg): string {
		const d = durLabel(s);
		return s.head ? `Running for ${d}` : `Ran ${d}`;
	}
	function ariaOf(s: Seg): string {
		const act = s.rollback ? ', rolled back to' : '';
		return `${s.sha}: ${outcomeWord(s).toLowerCase()}${act}, deployed ${whenLabel(s.t)}, ${tenure(s).toLowerCase()}`;
	}
	/** "Previous healthy builds only" (SPEC §7) — the ledger row's own gate. */
	function canRollback(s: Seg): boolean {
		return s.i !== 0 && s.e.bakeStatus === 'Succeeded';
	}
	function footReason(s: Seg): string {
		if (s.i === 0 && s.failed) {
			// The live build is failing: point at the way out (that build's own
			// card carries the button, so there is exactly one "Roll back").
			const good = times.find((x) => x.i !== 0 && x.e.bakeStatus === 'Succeeded');
			const sha = good ? good.e.version?.version || good.e.version?.tag : '';
			return sha ? `Failing now · last healthy ${sha}` : 'Failing now';
		}
		if (s.i === 0) return 'Running now';
		if (s.failed) return 'Not offered as a rollback';
		return '';
	}

	const RANGES: PresetRange[] = ['1d', '7d', '30d', 'all'];
	const RANGE_LABEL: Record<PresetRange, string> = {
		'1d': '1d',
		'7d': '7d',
		'30d': '30d',
		all: 'All'
	};

	// ── The hover card (one template for every segment) ────────────────────
	let hoverIdx = $state<number | null>(null);
	let cardHoverIdx = $state<number | null>(null);
	let hoverCardEl: HTMLElement | undefined = $state();
	let hoverCardPos = $state<{ left: number; top: number } | null>(null);
	const visibleHoverIdx = $derived(cardHoverIdx ?? hoverIdx);
	let leaveTimer: ReturnType<typeof setTimeout> | undefined;

	/** ⭐ CLAMPED TO THE MAIN CONTENT BOX, NOT THE VIEWPORT (AD round 7, item
	 *  2): "the leftmost card covers 38px of the sidebar." The card is
	 *  `position: fixed`, so its `left` is a VIEWPORT coordinate — clamping
	 *  it to `8px from the viewport edge` let it sit on top of the 232px
	 *  sidebar at the viewport's own left, whenever the anchor (a segment
	 *  near the strip's own left edge) was close enough to that edge. The
	 *  bound is now `<main>`'s own `getBoundingClientRect()` — the exact box
	 *  the strip, the ledger and every other card on this page already live
	 *  inside — so the hover card can never sit further left than the
	 *  content itself does. Falls back to the viewport bound only if `<main>`
	 *  genuinely cannot be found (never true in this app's own shell, but
	 *  cheaper than a non-null assertion). */
	function contentBox(): { left: number; right: number } {
		const main = document.querySelector('main');
		if (main) {
			const r = main.getBoundingClientRect();
			return { left: r.left, right: r.right };
		}
		return { left: 0, right: document.documentElement.clientWidth };
	}
	function placeHoverCard(anchor: HTMLElement) {
		const r = anchor.getBoundingClientRect();
		const box = contentBox();
		const vh = document.documentElement.clientHeight;
		const w = hoverCardEl?.offsetWidth ?? 304;
		const h = hoverCardEl?.offsetHeight ?? 168;
		const minLeft = box.left + 8;
		const maxLeft = Math.max(minLeft, box.right - w - 8);
		const left = Math.min(Math.max(minLeft, r.left + r.width / 2 - w / 2), maxLeft);
		const below = r.bottom + 8;
		const top = below + h > vh - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : below;
		hoverCardPos = { left, top };
	}
	function onSegmentEnter(ev: { currentTarget: HTMLElement }, i: number) {
		clearTimeout(leaveTimer);
		hoverIdx = i;
		hoverClusterKey = null;
		cardHoverClusterKey = null;
		const el = ev.currentTarget;
		placeHoverCard(el);
		requestAnimationFrame(() => {
			if (hoverIdx === i) placeHoverCard(el);
		});
	}
	function onSegmentLeave(i: number) {
		// A short grace so the pointer can travel the 8px onto the card.
		clearTimeout(leaveTimer);
		leaveTimer = setTimeout(() => {
			if (hoverIdx === i) hoverIdx = null;
		}, 120);
	}

	/** ⭐ THE CLUSTER'S OWN HOVER CARD (AD round 6, item 3) — a second,
	 *  parallel pair to `hoverIdx`/`cardHoverIdx` rather than overloading
	 *  them with a union type, because a cluster has no single `Seg` to key
	 *  on. Keyed by the cluster's OLDEST member's own index (`cluster[0].i`,
	 *  stable across re-layout the same way a segment's own `s.i` is).
	 *  Entering a cluster closes any open SEGMENT card and vice versa — the
	 *  strip shows one hover card at a time. `hoverCardEl`/`placeHoverCard`
	 *  are shared with the segment card below: the two templates are
	 *  mutually exclusive (`visibleHoverIdx`/`visibleHoverClusterKey` can
	 *  never both be non-null), so one ref serves whichever is on screen. */
	let hoverClusterKey = $state<number | null>(null);
	let cardHoverClusterKey = $state<number | null>(null);
	const visibleHoverClusterKey = $derived(cardHoverClusterKey ?? hoverClusterKey);
	function onClusterEnter(ev: { currentTarget: HTMLElement }, key: number) {
		clearTimeout(leaveTimer);
		hoverIdx = null;
		cardHoverIdx = null;
		hoverClusterKey = key;
		const el = ev.currentTarget;
		placeHoverCard(el);
		requestAnimationFrame(() => {
			if (hoverClusterKey === key) placeHoverCard(el);
		});
	}
	function onClusterLeave(key: number) {
		clearTimeout(leaveTimer);
		leaveTimer = setTimeout(() => {
			if (hoverClusterKey === key) hoverClusterKey = null;
		}, 120);
	}
</script>

<div class="cadence flex w-full flex-wrap items-start gap-x-4 gap-y-2">
	<!-- ⭐ ITS OWN FULL-WIDTH ROW BELOW `xl` (History round 15, AD round 11,
	     item 2, binding): "the strip gets its own full-width row, as at
	     390, with the range pills and Compare wrapping underneath." Was
	     `sm:basis-0` — correct for ≥640px in isolation, but below `xl`
	     this page's own rail/sidebar chrome still eats real width, so the
	     track and the controls (1d/7d/30d/All, Compare) shared one row at
	     768 AND 1024 and squeezed the track down to ~180px, well under
	     the 24px floor every segment needs — measured, `lg` (1024px)
	     alone was not wide enough; the coordinator's own test checks
	     768 and 1024 both. -->
	<div class="cadence-graphic min-w-0 flex-1 basis-full xl:basis-0">
		<!-- ⭐ `.cadence-track-hit-wrap` (History round 14, AD round 10, D2,
		     binding): "the strip's overflow:hidden clips the hit layer, so
		     the cluster target is only 44×20… move the hit layer outside
		     the clipping element." `.cadence-track` itself still clips
		     (unchanged — it's what keeps every segment's fill inside the
		     track's own rounded corners); this wrapper carries NO
		     `overflow`, is exactly the track's own height (its only
		     in-flow child), and is what `.cadence-cluster-hit` below
		     anchors its `position: absolute` against instead — a 44px-tall
		     target can now extend past the 32px band without being cut. -->
		<div class="cadence-track-hit-wrap relative">
			<div
				class="cadence-track relative"
				bind:this={trackEl}
				bind:clientWidth={trackWidth}
				role="group"
				aria-label="Builds over time, oldest to newest"
			>
				{#each layout as b, k (b.seg ? b.seg.i : b.cluster ? `cluster-${b.cluster[0].i}` : `void-${k}`)}
					{#if b.seg}
						{@const s = b.seg}
						{@const mark = markOf(s)}
						{@const live = liveState(s)}
						<button
							type="button"
							class="cadence-segment"
							class:cadence-segment--failed={s.failed}
							class:cadence-segment--padded={b.label || b.mark || b.repeat}
							class:cadence-segment--active={visibleHoverIdx === s.i}
							class:cadence-segment--warped={b.warped}
							title={b.warped
								? `${ariaOf(s)} (shown wider than its real share of time)`
								: ariaOf(s)}
							data-state={s.failed ? 'failed' : (live ?? 'healthy')}
							style="left: {b.left}px; width: {b.width}px; background-color: {s.failed
								? 'var(--k-danger-solid)'
								: 'var(--k-line-strong)'}"
							aria-label={ariaOf(s)}
							onclick={() => onSelect?.(s.i)}
							onmouseenter={(ev) => onSegmentEnter(ev, s.i)}
							onmouseleave={() => onSegmentLeave(s.i)}
							onfocus={(ev) => onSegmentEnter(ev, s.i)}
							onblur={() => onSegmentLeave(s.i)}
						>
							{#if b.mark && mark}
								{#if mark === 'rollback'}
									<span class="cadence-marker-rollback text-fg-muted" aria-hidden="true">
										<UndoOutline class="h-3.5 w-3.5" />
									</span>
								{:else}
									<span class="cadence-mark" aria-hidden="true"><StatusMark state={mark} /></span>
								{/if}
							{/if}
							{#if b.label}
								<span class="cadence-segment-label t-code-sm">{s.sha}</span>
								{#if b.dur}
									<span class="cadence-segment-dur t-meta tabular-nums">{b.dur}</span>
								{/if}
							{:else if b.repeat}
								<!-- ⭐ "same build", NEVER BLANK (AD round 7, item 4): this
							     segment is wide enough for a label but is a REPEAT of
							     a build already labelled on its own widest segment
							     elsewhere on the strip — printing nothing here read as
							     a missed case, not a rule. Muted prose, not `t-code-sm`:
							     it names a RELATIONSHIP to another segment, not an
							     identifier of its own. -->
								<span class="cadence-segment-label t-meta text-fg-subtle">same build</span>
							{/if}
							{#if s.head && !s.failed}
								<!-- The running build's foot: its state colour, ending at Now. -->
								<span
									class="cadence-live-line"
									style="background-color: {live === 'checking'
										? 'var(--k-progress-solid)'
										: live === 'deploying'
											? 'var(--k-active-solid)'
											: 'var(--k-fg-muted)'}"
									aria-hidden="true"
								></span>
							{/if}
						</button>
					{:else if b.cluster}
						{@const key = b.cluster[0].i}
						<!-- ⭐ THE CLUSTER MARK (AD round 6, item 3): one box standing
					     in for a RUN of builds too thin to have their own
					     individually-hoverable, individually-tappable slivers.
					     Same neutral fill as an ordinary healthy segment — it is
					     still "the norm", just several of them at once — with the
					     count in place of a sha neither would fit. -->
						<button
							type="button"
							class="cadence-segment cadence-cluster"
							class:cadence-segment--active={visibleHoverClusterKey === key}
							class:cadence-segment--warped={b.warped}
							title="{b.cluster.length} builds, {whenLabel(b.cluster[0].t)} – {whenLabel(
								b.cluster[b.cluster.length - 1].endT
							)}"
							style="left: {b.left}px; width: {b.width}px; background-color: var(--k-line-strong)"
							aria-label="{b.cluster.length} builds between {whenLabel(
								b.cluster[0].t
							)} and {whenLabel(b.cluster[b.cluster.length - 1].endT)}"
							onmouseenter={(ev) => onClusterEnter(ev, key)}
							onmouseleave={() => onClusterLeave(key)}
							onfocus={(ev) => onClusterEnter(ev, key)}
							onblur={() => onClusterLeave(key)}
							onclick={(ev) => {
								// ⭐ A TAP OPENS THE LIST CARD (AD round 7, item 3) — touch
								// fires no hover at all, so without this the cluster mark
								// was dead on phone: visible, a real ≥44px target (see the
								// media query below), but nothing happened when pressed.
								// Toggles on `cardHoverClusterKey` (the PINNED state, same
								// one the card's own `onmouseenter` sets) specifically, NOT
								// `hoverClusterKey`/`visibleHoverClusterKey` — measured live
								// (a real device emulation, not a guess): a tap dispatches a
								// synthetic `mouseenter` BEFORE its own `click`, which
								// already sets the transient `hoverClusterKey`. Toggling
								// against `visibleHoverClusterKey` therefore saw this tap's
								// OWN mouseenter as "already open" and closed what it had
								// just opened, one event earlier in the same gesture.
								// `cardHoverClusterKey` stays untouched by that synthetic
								// mouseenter, so it alone tells a fresh tap from a second
								// one on an already-PINNED card.
								clearTimeout(leaveTimer);
								if (cardHoverClusterKey === key) {
									cardHoverClusterKey = null;
									hoverClusterKey = null;
								} else {
									onClusterEnter(ev, key);
									cardHoverClusterKey = key;
								}
							}}
						>
							<span class="cadence-cluster-count t-meta tabular-nums">{b.cluster.length}</span>
						</button>
					{:else}
						<!-- Before the first build in this window: nothing ran here. -->
						<span class="cadence-void" style="left: {b.left}px; width: {b.width}px">
							{#if b.width >= 160}
								<span class="cadence-void-label t-meta text-fg-subtle">No earlier deploys</span>
							{/if}
						</span>
					{/if}
				{/each}
			</div>
			<!-- ⭐ THE CLUSTER'S REAL 44×44 TARGET, UNCLIPPED (D2, continued). A
		     sibling of `.cadence-track`, not a child — so `.cadence-track`'s
		     own `overflow: hidden` never touches it. Positioned against
		     `.cadence-track-hit-wrap` (exactly the track's own height,
		     above), centred on the SAME `b.left`/`b.width` the visible
		     cluster segment inside the track uses, so the two always track
		     each other. Transparent and `aria-hidden` — the visible
		     `.cadence-cluster` button inside the track is still the one
		     accessible control (it keeps its own `aria-label`, and this
		     overlay sits ABOVE it in paint order so a tap anywhere in the
		     44×44 zone — including the halo past the track's own 32px band
		     — reaches this element first and forwards to the exact same
		     handlers; the inner button is never reachable by a pointer
		     inside this zone, only by keyboard, which this overlay does
		     not intercept (`tabindex="-1"`). -->
			{#each layout as hb, hk (hb.cluster ? `cluster-hit-${hb.cluster[0].i}` : `nohit-${hk}`)}
				{#if hb.cluster}
					{@const key = hb.cluster[0].i}
					<button
						type="button"
						tabindex="-1"
						aria-hidden="true"
						class="cadence-cluster-hit"
						style="left: {hb.left + hb.width / 2}px"
						onmouseenter={(ev) => onClusterEnter(ev, key)}
						onmouseleave={() => onClusterLeave(key)}
						onclick={(ev) => {
							clearTimeout(leaveTimer);
							if (cardHoverClusterKey === key) {
								cardHoverClusterKey = null;
								hoverClusterKey = null;
							} else {
								onClusterEnter(ev, key);
								cardHoverClusterKey = key;
							}
						}}
					></button>
				{/if}
			{/each}
		</div>
		<div class="cadence-ticks relative" aria-hidden="true">
			{#each ticks as t (t.label + t.x)}
				{#if !t.edge}
					<span class="cadence-tick-mark" style="left: {Math.round(t.x)}px"></span>
				{/if}
				<span
					class="cadence-tick-label t-meta tabular-nums {t.edge
						? 'text-fg-muted'
						: 'text-fg-subtle'}"
					style="left: {t.l}px">{t.label}</span
				>
			{/each}
		</div>
		<!-- ⭐ THE HATCH'S OWN LEGEND (AD round 5, nits): "a legend for the
		     hatching: one t-meta '▨ shown wider than its real time' in the
		     strip's corner, shown only when hatching is present." The
		     diagonal hatch (`.cadence-segment--warped::after`, above) reads
		     as a texture with no stated meaning until a reader hovers the
		     segment and reads its `title`; a reader scanning the strip
		     without hovering anything had nothing to tell them the pattern
		     means anything at all. Gated on `hasWarped` so a window with
		     room for every segment at its true width (nothing pinned to a
		     minimum) draws no legend for a mark that isn't on screen. -->
		{#if hasWarped}
			<div class="cadence-legend t-meta text-fg-subtle">▨ shown wider than its real time</div>
		{/if}
	</div>
	<div class="cadence-controls flex shrink-0 items-center gap-2">
		<SegmentedControl
			options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
			value={range}
			onChange={(r) => onRangeChange?.(r)}
			label="Time range"
		/>
		{#if onToggleCompare}
			<button
				type="button"
				class="nav-link ml-2 hidden items-center gap-1 sm:inline-flex"
				aria-pressed={compareActive}
				onclick={onToggleCompare}
			>
				<ArrowsRepeatOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
				{compareActive ? 'Hide namespace' : 'Compare namespace'}
			</button>
		{/if}
	</div>
</div>

{#if visibleHoverIdx !== null}
	{@const seg = segs.find((s) => s.i === visibleHoverIdx)}
	{#if seg}
		{@const e = seg.e}
		{@const actor = actorFrom(e.triggeredBy)}
		{@const diff = diffHref?.(seg.i)}
		{@const canRb = canRollback(seg)}
		{@const checks = seg.failed ? (e.failedHealthChecks ?? []) : []}
		{@const failMsg = seg.failed && checks.length === 0 ? (e.bakeStatusMessage ?? '') : ''}
		{@const reason = footReason(seg)}
		<!-- ONE TEMPLATE for every segment: mark · build · outcome; commit
		     title; tenure · who · when; the failed checks (failed only); a
		     footer that always exists — the actions this build allows, or why
		     there are none. A plain focusable group, not a tooltip: it holds
		     real buttons. -->
		<div
			bind:this={hoverCardEl}
			class="cadence-hover-card"
			style={hoverCardPos
				? `left:${hoverCardPos.left}px; top:${hoverCardPos.top}px`
				: 'visibility:hidden'}
			role="group"
			aria-label="Build {seg.sha}"
			onmouseenter={() => {
				clearTimeout(leaveTimer);
				cardHoverIdx = seg.i;
			}}
			onmouseleave={() => {
				cardHoverIdx = null;
				hoverIdx = null;
			}}
		>
			<div class="flex items-center gap-2">
				<RestGlyph bakeStatus={e.bakeStatus} timestamp={e.timestamp} {now} />
				<span class="t-code-sm text-fg">{seg.sha}</span>
				{#if seg.rollback}
					<span class="t-meta text-fg-subtle inline-flex items-center gap-1">
						<UndoOutline class="h-3 w-3" aria-hidden="true" />rollback
					</span>
				{/if}
				<span class="t-ui-sm ml-auto shrink-0 {outcomeInk(seg)}">{outcomeWord(seg)}</span>
			</div>
			{#if e.commitTitle}
				<p class="t-body text-fg mt-1.5 line-clamp-2">{e.commitTitle}</p>
			{/if}
			<!-- ⭐ `.dot-list`, NOT HAND-WRITTEN "·" SPANS (AD round 7, nits:
			     "one separator glyph"). This card drew its own separator —
			     a literal "·" character between each fact — while the row
			     below (and `PageHeader`'s own `metaSeparated`) draw theirs
			     as a CSS radial-gradient dot on each fact's own padding.
			     Two different marks for "and" on the same page; `.dot-list`
			     is the shared mechanism (`language.css`), so this card's
			     separator is now pixel-identical to every other one. -->
			<div class="dot-list text-fg-subtle mt-1.5">
				<div class="dot-list-row t-meta flex flex-wrap items-center gap-y-1">
					<span class="tabular-nums">{tenure(seg)}</span>
					<span class="inline-flex items-center gap-1">
						<Avatar name={actor.name} kind={actor.kind} src={actor.src} size={16} />
						<!-- The ledger's own word for the controller: "Automatic", never "System". -->
						{actor.kind === 'controller' ? 'Automatic' : actor.name}
					</span>
					<!-- ⭐ NIT (AD round 4): "the hover-card date wraps after a
				     '·'." `whenLabel` returns "Oct 6, 21:05" — two words with
				     a space the flex-wrap row was free to break between,
				     splitting the date across two lines. One unit now. -->
					<span class="whitespace-nowrap tabular-nums">{whenLabel(seg.t)}</span>
				</div>
			</div>
			{#if checks.length > 0 || failMsg}
				<button
					type="button"
					class="cadence-card-checks t-meta mt-2.5 flex w-full items-start text-left"
					onclick={() => onSelect?.(seg.i)}
				>
					<!-- ⭐ THE SHARED `FailedCheckLine` (History round 16, AD round 12,
					     item 1: "every failure reason on the page uses it, muted
					     when resolved"). This card used to draw its own glyph +
					     name + message; it now renders the same line the ledger's
					     panel does, at the card's own 12px (`compact`). Only the
					     live build (`i === 0`) is still an open alarm. -->
					<span class="block min-w-0 flex-1">
						<FailedCheckLine compact check={checks[0] ?? { name: failMsg }} danger={seg.i === 0} />
						<span class="text-fg-subtle block pl-[18px]"
							>{checks.length > 1 ? `${checks.length} failed checks` : 'Failed check'} · Show in the
							list</span
						>
					</span>
				</button>
			{/if}
			<!-- ⭐ `gap-2`, NOT `gap-x-3 gap-y-2` (AD round 5, item 7): "one
			     spacing (gap-2)… everywhere." The row's hover actions and
			     the panel's own footer both already space this pair at
			     `gap-2`; this card's wider `gap-x-3` was a third value for
			     the same pair of buttons. -->
			<div class="border-line mt-3 flex min-h-7 flex-wrap items-center gap-2 border-t pt-2.5">
				{#if canRb && onRollback}
					<button
						type="button"
						class="btn btn-secondary btn-xs"
						aria-label="Roll back to this build"
						title="Roll back to this build"
						onclick={() => onRollback?.(seg.i)}
					>
						<UndoOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
						Roll back
					</button>
				{:else if reason}
					<span class="t-meta text-fg-subtle">{reason}</span>
				{/if}
				{#if diff}
					<!-- ⭐ ONE BUTTON GRAMMAR (AD round 4, item 5): "'Roll back to
					     this' + 'View diff' both btn-xs secondary everywhere: row,
					     panel, card." This card's own pair was a `.btn` beside a
					     `nav-link` — fixed to match. -->
					<a href={diff} class="btn btn-secondary btn-xs ml-auto">
						<CodePullRequestSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
						View diff
					</a>
				{/if}
			</div>
		</div>
	{/if}
{/if}

{#if visibleHoverClusterKey !== null}
	{@const cluster = layout.find((b) => b.cluster?.[0]?.i === visibleHoverClusterKey)?.cluster}
	{#if cluster}
		<!-- ⭐ THE CLUSTER'S OWN HOVER CARD (AD round 6, item 3): "lists them
		     (each with sha, title, outcome and its own actions)." One row
		     per build, newest first (the order a reader actually scans a
		     list in, even though the strip itself draws oldest→newest) —
		     each row is its own compact echo of the single-segment card's
		     top line (glyph, sha, outcome) plus its title, with the SAME
		     two actions (Roll back to this / View diff) this strip gives
		     every other build, just icon-only here (the `aria-label` still
		     carries the exact same wording the button elsewhere shows as
		     text) because N rows of two full-width buttons each would not
		     fit a hover card. -->
		<div
			bind:this={hoverCardEl}
			class="cadence-hover-card cadence-cluster-card"
			style={hoverCardPos
				? `left:${hoverCardPos.left}px; top:${hoverCardPos.top}px`
				: 'visibility:hidden'}
			role="group"
			aria-label="{cluster.length} builds"
			onmouseenter={() => {
				clearTimeout(leaveTimer);
				cardHoverClusterKey = visibleHoverClusterKey;
			}}
			onmouseleave={() => {
				cardHoverClusterKey = null;
				hoverClusterKey = null;
			}}
		>
			<div class="t-meta text-fg-subtle mb-1">{cluster.length} builds</div>
			<ul class="divide-line-subtle flex flex-col divide-y">
				{#each [...cluster].reverse() as seg (seg.i)}
					{@const e = seg.e}
					{@const diff = diffHref?.(seg.i)}
					{@const canRb = canRollback(seg)}
					<li class="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
						<RestGlyph bakeStatus={e.bakeStatus} timestamp={e.timestamp} {now} />
						<button
							type="button"
							class="tap-link flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
							onclick={() => onSelect?.(seg.i)}
						>
							<span class="t-code-sm text-fg shrink-0">{seg.sha}</span>
							{#if e.commitTitle}
								<span class="t-meta text-fg-muted min-w-0 flex-1 truncate">{e.commitTitle}</span>
							{/if}
							<span class="t-meta shrink-0 {outcomeInk(seg)}">{outcomeWord(seg)}</span>
						</button>
						<div class="flex shrink-0 items-center gap-1">
							{#if canRb && onRollback}
								<button
									type="button"
									class="cadence-cluster-action btn btn-secondary btn-xs px-1.5"
									aria-label="Roll back to this"
									title="Roll back to this"
									onclick={() => onRollback?.(seg.i)}
								>
									<UndoOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
								</button>
							{/if}
							{#if diff}
								<a
									href={diff}
									class="cadence-cluster-action btn btn-secondary btn-xs px-1.5"
									aria-label="View diff"
									title="View diff"
								>
									<CodePullRequestSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
								</a>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
{/if}

<style>
	/* Desktop: 32px track + 16px axis = 48px; the range pills sit on the
	   track's line. Phone (< sm): 20px track + 16px axis + 8px + 28px pills
	   = 72px. */
	.cadence-track {
		height: 32px;
		border-radius: 4px;
		overflow: hidden;
	}
	/* The track's own height, nothing else — its only in-flow child IS
	   `.cadence-track`, so this never needs its own explicit height. No
	   `overflow` here (see the cluster hit target's own note, above the
	   markup) — that is the whole point of this wrapper existing. */
	.cadence-track-hit-wrap {
		position: relative;
	}
	/* `left` is set inline per-cluster (the segment's own centre); every
	   other dimension is fixed here. `z-index: 2`, above the segment
	   fills in `.cadence-track` below it (a separate stacking context,
	   painted first in DOM order) and above a neighbouring segment's own
	   `::before` hit area, so a tap anywhere in the 44×44 zone always
	   resolves to the cluster, never whichever sibling segment's sliver
	   it happens to overlap. */
	.cadence-cluster-hit {
		position: absolute;
		top: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
		z-index: 2;
		margin: 0;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}
	.cadence-controls {
		height: 32px;
	}
	.cadence-segment {
		position: absolute;
		top: 0;
		bottom: 0;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		/* ⭐ `visible`, NOT `hidden` (AD round 5, nits: "the 4px unclickable
		   slivers — give each segment a ≥8px hit area via a transparent
		   pseudo-element, keeping its visual width"). The fill colour below
		   is the box's own `background-color`, painted exactly to `width`
		   regardless of this property — only CHILD CONTENT that would run
		   past the edge is affected, and every label/mark this component
		   draws is already gated on `w >= labelPx(s)` (see `layout`,
		   above) before it renders, so nothing here was ever relying on
		   clipping to look right. `visible` is what lets `::before` below
		   extend this button's own hit-test box past a 3-4px sliver. */
		overflow: visible;
		color: var(--k-fg);
		white-space: nowrap;
		outline-offset: -2px;
	}
	/* The enlarged, invisible hit area itself: centred on the segment,
	   `min-width: 100%` so it never shrinks a segment that is already
	   wider, `width: 24px` (History round 14, AD round 10, D2, binding:
	   "every mark gets a target of at least 24px, at every width,
	   including 768" — was 8px) so a 3-4px sliver still gets a real tap
	   target. `top: 0; bottom: 0` is already the track's own full 32px
	   height, so this one is never clipped by `.cadence-track`'s
	   `overflow: hidden` the way the cluster's taller 44px target was —
	   only the CLUSTER needed to move outside it (see
	   `.cadence-cluster-hit`, and the markup's own note). Part of the
	   SAME element (a pseudo-element, not a sibling), so a click anywhere
	   in it fires the button's own `onclick`/hover — no separate handler
	   to keep in sync. */
	.cadence-segment::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 24px;
		min-width: 100%;
		transform: translateX(-50%);
	}
	/* ⛔ THE CLUSTER'S OWN 44×44 `::before` IS GONE (History round 14, AD
	   round 10, D2, binding). It lived here, inside `.cadence-cluster`,
	   which is inside `.cadence-track` — a 44px-tall pseudo-element whose
	   parent's `overflow: hidden` clipped it to the track's 32px band,
	   "a cluster target only 44×20" measured live. `.cadence-cluster-hit`
	   (markup above, styled above `.cadence-track-hit-wrap`) replaces it:
	   a REAL sibling element outside the clipping container rather than a
	   pseudo-element inside it, which is the only way to extend past an
	   ancestor's own `overflow: hidden`. */
	.cadence-segment--padded {
		padding: 0 8px;
	}
	.cadence-segment:hover,
	.cadence-segment--active {
		box-shadow: inset 0 0 0 1px var(--k-fg-subtle);
	}
	.cadence-segment--failed {
		color: oklch(1 0 0);
	}
	:global(.dark) .cadence-segment--failed {
		color: var(--k-fg-inverse);
	}
	.cadence-segment--failed:hover,
	.cadence-segment--failed.cadence-segment--active {
		box-shadow: inset 0 0 0 1px var(--k-fg);
	}
	/* ⭐ WHERE THE SCALE STOPS BEING ONE (AD round 4, item 6): a faint
	   diagonal hatch, not a hue — state colour (danger/the live foot) still
	   reads as the only colour on the strip. `background-size`/`-position`
	   keep the stripes a fixed 6px regardless of the segment's own width, so
	   a 4px sliver and a 40px warped segment both read as "compressed",
	   not as two different patterns. */
	.cadence-segment--warped::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image: repeating-linear-gradient(
			-45deg,
			oklch(1 0 0 / 0.16) 0,
			oklch(1 0 0 / 0.16) 1px,
			transparent 1px,
			transparent 6px
		);
	}
	:global(.dark) .cadence-segment--warped::after {
		background-image: repeating-linear-gradient(
			-45deg,
			oklch(0 0 0 / 0.22) 0,
			oklch(0 0 0 / 0.22) 1px,
			transparent 1px,
			transparent 6px
		);
	}
	.cadence-segment-dur {
		color: var(--k-fg-muted);
	}
	.cadence-mark,
	.cadence-marker-rollback {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		margin-left: -4px;
	}
	/* ⭐ THE FAILED MARK IS CIRCLED LIKE THE CHECKING MARK (History round 16,
	   AD round 12, item 3). `StatusMark`'s failed disc is danger-solid with a
	   danger-solid ring: on this segment's own danger-solid fill the disc
	   vanished and only a 10px "!" was left, a lighter weight than the
	   checking mark's visible circle. Here the ring takes the glyph's own
	   (white) ink, the same 1px the checking mark's ring is, so the disc
	   reads at the same size and weight. Scoped to the segment; `StatusMark`
	   is shared and unchanged. */
	.cadence-segment--failed .cadence-mark :global(.rounded-full) {
		box-shadow: inset 0 0 0 1px currentColor;
	}
	.cadence-cluster {
		justify-content: center;
	}
	.cadence-cluster-count {
		color: var(--k-fg-muted);
		pointer-events: none;
	}
	.cadence-live-line {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 2px;
	}
	.cadence-void {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		background-image: linear-gradient(to right, var(--k-line-strong) 50%, transparent 50%);
		background-size: 6px 1px;
		background-repeat: repeat-x;
		background-position: 0 50%;
	}
	.cadence-void-label {
		padding-right: 8px;
		background-color: var(--k-ground);
	}
	.cadence-ticks {
		height: 16px;
	}
	.cadence-legend {
		margin-top: 2px;
		text-align: right;
	}
	.cadence-tick-mark {
		position: absolute;
		top: 0;
		width: 1px;
		height: 3px;
		background-color: var(--k-line-strong);
	}
	.cadence-tick-label {
		position: absolute;
		bottom: 0;
		line-height: 12px;
		white-space: nowrap;
	}
	.cadence-hover-card {
		position: fixed;
		z-index: 50;
		width: 19rem;
		max-width: calc(100vw - 16px);
		border-radius: 8px;
		border: 1px solid var(--k-line);
		background-color: var(--k-overlay);
		padding: 12px;
		box-shadow: var(--k-shadow-overlay);
	}
	/* Each row needs room for a sha, a truncating title, an outcome word and
	   two icon buttons — the single-build card's 19rem reads cramped once a
	   cluster's own rows are stacked inside it. */
	.cadence-cluster-card {
		width: 22rem;
	}
	.cadence-card-checks:hover .line-clamp-2 {
		text-decoration: underline;
	}
	@media (max-width: 639.98px) {
		.cadence-track {
			height: 20px;
		}
		.cadence-controls {
			height: 28px;
		}
		.cadence-segment--padded {
			padding: 0 6px;
		}
		/* ⭐ THE CLUSTER CARD'S OWN ROW ACTIONS GET THE SAME FLOOR (AD round
		   8, item 5): "44px targets or labelled buttons, with the hit area
		   centred on the mark." These stay icon-only (a labelled pair would
		   not fit two per row beside a sha, a truncating title and an
		   outcome word in a ~22rem card) — `min-width`/`min-height` grow
		   the REAL button box to the platform minimum instead, centred on
		   the icon exactly like the cluster mark's own `::before` is
		   centred on its glyph, via the same `grid`/`place-items-center`
		   the `.btn` class already gives every button's content. */
		.cadence-cluster-action {
			min-width: 44px;
			min-height: 44px;
		}
	}
</style>
