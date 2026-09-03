<svelte:options runes={true} />

<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import type { ClusterInfo, ClusterError } from '$lib/api/rollouts';
	import { getEnvironmentThemeStyle, getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { formatTimeAgoCompact, formatDate, shortenVersion } from '$lib/utils';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { buildRolloutCards, cardVerdict, cardStateMark } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { rankLabel, rankRole, rankTitle } from '$lib/view-models/env-rank';
	import {
		isNeedsYou,
		isInMotion,
		isTrailing,
		isHeld,
		isSteady,
		isPending
	} from '$lib/view-models/fleet-groups';
	import { checkFailureTitle } from '$lib/view-models/health-witness';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { now } from '$lib/stores/time';
	import { SearchOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import ClusterMark from '$lib/components/ClusterMark.svelte';
	import { getStatusCircleClass } from '$lib/bake-status';
	import type { Rollout, Environment } from '../types';
	import { rolloutPath } from '$lib/source-dashboard';
	import { versionPathForRollout } from '$lib/version-utils';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import ClearPinModal from '$lib/components/ClearPinModal.svelte';
	import { CLEAR_PIN_LABEL } from '$lib/components/pin-copy';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	/**
	 * ⛔ B2, OPERATOR-WALK FINDING (2026-09-03): A PIN RENDERED AS `HELD`, AND
	 * THE STRING "pin" APPEARED ZERO TIMES ON THIS PAGE.
	 *
	 * `cardStateMark`'s disc precedence puts `held` ahead of `pinned` — right
	 * for the single-glyph disc (see that file's own note), wrong as the
	 * ONLY place a pin was ever said: with both true, the disc drew the
	 * pause glyph and the row's only WORD-level mark was the `held` chip.
	 * Home (`ControlCenter`) and `/apps` both say PINNED in that state — this
	 * page was the one surface calling an operator's own choice a rule.
	 *
	 * A held rollout and a pinned rollout are different facts that can
	 * co-occur (a pin does not know or care what the gates are doing), so
	 * they get two independent chips now rather than one overriding the
	 * other — see the badge row below. And since a pin's remedy is a
	 * control, not a wait, the row also gets the SAME `Clear pin` action
	 * `/apps` and rollout detail already have, via the shared
	 * `ClearPinModal` — one instance for the whole grid, targeting whichever
	 * card's trigger was pressed.
	 */
	let clearPinCard = $state<RolloutCard | null>(null);
	let clearPinOpen = $state(false);

	function openClearPin(c: RolloutCard) {
		clearPinCard = c;
		clearPinOpen = true;
	}

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) } })
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);
	const spokeClusters = $derived<ClusterInfo[]>(query.data?.clusters || []);
	const clusterErrors = $derived<ClusterError[]>(query.data?.clusterErrors || []);
	const localClusterURL = $derived<string>(clusterQuery.data?.url || '');

	// True when more than one cluster is represented in the current result set.
	const isMultiCluster = $derived(spokeClusters.length > 0);

	const localClusterName = $derived<string>(clusterQuery.data?.name || clusterLabelFromURL(localClusterURL));

	// All clusters for the filter pills: local + discovered spokes.
	const allClusters = $derived<ClusterInfo[]>([
		{ url: localClusterURL, name: localClusterName },
		...spokeClusters
	].filter((cl) => cl.url));

	function clusterLabelFromURL(rawURL: string): string {
		try {
			const host = new URL(rawURL).hostname;
			if (host.startsWith('kuberik.')) {
				const rest = host.slice('kuberik.'.length);
				const seg = rest.split('.')[0];
				// Skip numeric segments — IP-based dev URLs (nip.io etc.) have no
				// meaningful short form, so use the full hostname instead.
				if (seg && !/^\d+$/.test(seg)) return seg;
			}
			return host || rawURL;
		} catch {
			return rawURL;
		}
	}

	// Derive the label for a rollout's cluster.
	//
	// ⛔ THE NAME FIRST, THE URL ONLY AS A FALLBACK. (2026-08-31)
	// `source-dashboard.ts` says it in its own header: the hub stamps the
	// cluster NAME "used for name-based routing" and the dashboard URL is
	// "legacy; kept for compatibility". This function read only the legacy one,
	// so a rollout carrying `source-cluster` and no `source-dashboard` produced
	// an EMPTY label — and `<ClusterMark>` then rendered the word `cluster`
	// with nothing after it, with a `title` reading `Cluster  — the Kubernetes
	// cluster these rollouts run on`. A label that names nothing is worse than
	// no label: it tells the reader the answer is on screen.
	//
	// `rolloutPath()` already routes on `c.sourceCluster`, so reading it here
	// also means the name in the header is the name in the URL.
	function clusterLabelForCard(c: RolloutCard): string {
		if (c.sourceCluster) return c.sourceCluster;
		const url = c.sourceURL || localClusterURL;
		const found = allClusters.find((cl) => cl.url === url);
		return found?.name || clusterLabelFromURL(url);
	}

	const cards = $derived<RolloutCard[]>(buildRolloutCards(rollouts, environments, $now));

	// ⛔ THE BUCKETS ARE `/`'S, AND `Healthy` IS SPLIT. (2026-08-31)
	//
	// From a live critique: *"`/rollouts` says the fleet is fine while four
	// other surfaces say it isn't."* The header read
	// `Attention 0 · In motion 1 · Pending 0 · Healthy 14` while
	// `hello-world-app` was behind and gate-blocked in all three environments
	// — and at the same second `/` filed those three under **Trailing**,
	// `/apps` drew an amber banner and `/environments` said "furthest behind:
	// 20 versions". **This is the page an operator opens to scan everything,
	// and it was the one page that could not show a lag.**
	//
	// The cause was one missing distinction, not a different opinion: `/`
	// splits `succeeded && !stuck` into **Trailing** (newer builds it could
	// take) and **Steady** (at the head of its own list); this page folded
	// both into `Healthy`, so the lag had nowhere to be counted. Every
	// predicate now comes from `view-models/fleet-groups.ts`, which is
	// `ControlCenter`'s own code, so the two pages cannot drift.
	//
	// `healthy` survives as a QuickFilter key for `trailing ∪ steady`; nothing
	// selects it, and it is kept only so a saved/deep-linked state that used
	// it still resolves rather than throwing away the filter.
	//
	// ⛔ `held` ADDED, 2026-09-03 (F4 third re-check, finding 5: "`Held 4` on
	// `/` vs `Trailing 4` on `/rollouts` for the same four"). `/`'s Trailing
	// section has always excluded rollouts `isHeld` splits out into its own
	// `Held` section — this page's `Trailing` pill did not, so four rollouts
	// blocked by a gate were counted as `Trailing 4` here and `Held 4` there.
	// One taxonomy now: the five VISIBLE pills below are `/`'s five section
	// names in `/`'s own order (`Needs you`, `In motion`, `Held`, `Trailing`,
	// `Steady`). `pending` has no dedicated pill — `/` has never had a
	// standalone Pending section; it folds pending rollouts into Steady's own
	// count with a qualifier (see `statusPills` below) — but the KEY survives
	// for the same reason `healthy` does: an old deep link must still filter
	// to something instead of silently resetting to `all`.
	type QuickFilter =
		| 'all'
		| 'attention'
		| 'active'
		| 'held'
		| 'pending'
		| 'healthy'
		| 'trailing'
		| 'steady';
	const QUICK_FILTER_KEYS: QuickFilter[] = [
		'all',
		'attention',
		'active',
		'held',
		'pending',
		'healthy',
		'trailing',
		'steady'
	];

	/**
	 * ⛔ FILTER STATE WAS INVISIBLE TO THE URL. (2026-09-03, operator-walk
	 * finding 20.) Every chip here worked — the grid filtered correctly — but
	 * `page.url()` never moved, so pasting "the four that need attention" gave
	 * the recipient the unfiltered grid, a refresh dropped every selection,
	 * and Back could not undo a chip because nothing had been pushed to undo.
	 * `?status=` / `?env=` / `?cluster=` are the URL now, `goto` with
	 * `replaceState: false` is what makes Back work, and the default URL
	 * (nothing selected) stays exactly `/rollouts` — `all`/empty are never
	 * themselves written as params.
	 */
	function setParam(key: string, next: string | null) {
		const params = new URLSearchParams(page.url.searchParams);
		if (next) params.set(key, next);
		else params.delete(key);
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: false, noScroll: true, keepFocus: true });
	}
	// Repeated keys (`?env=dev&env=staging`), not a comma join — a cluster URL
	// can itself contain characters a naive split/join would mangle, and
	// `URLSearchParams` already percent-encodes each occurrence correctly.
	function setMultiParam(key: string, values: string[]) {
		const params = new URLSearchParams(page.url.searchParams);
		params.delete(key);
		for (const v of values) params.append(key, v);
		const qs = params.toString();
		goto(qs ? `?${qs}` : '?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	const quickFilter = $derived<QuickFilter>(
		(() => {
			const raw = page.url.searchParams.get('status');
			return (QUICK_FILTER_KEYS as string[]).includes(raw ?? '') ? (raw as QuickFilter) : 'all';
		})()
	);
	function setQuickFilter(next: QuickFilter) {
		setParam('status', next === 'all' ? null : next);
	}

	// Filters
	let searchQuery = $state('');
	const envFilters = $derived(page.url.searchParams.getAll('env'));
	// ⛔ WAS THE CLUSTER's URL, RAW, IN THE ADDRESS BAR. (2026-09-03,
	// operator-walk, cosmetic) `?cluster=https%3A%2F%2Fkuberik.192.168.1.102
	// .nip.io` while `?env=` and `?status=` both spell their filter in short,
	// human words — the one param on this page that leaked an implementation
	// detail (a dashboard URL) into a link a reader might paste into chat.
	// The set is now the cluster's DISPLAY NAME (`prod`, `dev` —
	// `clusterLabelForCard`'s own vocabulary, the same word the filter pill
	// and every row's `ClusterMark` already print), resolved back to a URL
	// only where the filtering itself needs one.
	const clusterFilters = $derived(page.url.searchParams.getAll('cluster')); // set of cluster display NAMES

	function toggleEnv(name: string) {
		setMultiParam(
			'env',
			envFilters.includes(name) ? envFilters.filter((x) => x !== name) : [...envFilters, name]
		);
	}
	function toggleCluster(name: string) {
		setMultiParam(
			'cluster',
			clusterFilters.includes(name)
				? clusterFilters.filter((x) => x !== name)
				: [...clusterFilters, name]
		);
	}
	function clearFilters() {
		searchQuery = '';
		goto('?', { replaceState: false, noScroll: true, keepFocus: true });
	}

	const knownEnvs = $derived.by(() => {
		const map = new Map<string, { display: string; theme: ReturnType<typeof getRolloutEnvironmentTheme> }>();
		for (const c of cards) {
			if (!c.envKey) continue;
			if (!map.has(c.envKey)) map.set(c.envKey, { display: c.envDisplay, theme: c.theme });
		}
		return [...map.entries()]
			.map(([key, v]) => ({ key, display: v.display, theme: v.theme }))
			.sort((a, b) => compareEnvironmentNames(a.display, b.display));
	});

	const filtered = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return cards.filter((c) => {
			if (quickFilter === 'attention' && !isNeedsYou(c)) return false;
			if (quickFilter === 'active' && !isInMotion(c)) return false;
			if (quickFilter === 'held' && !isHeld(c)) return false;
			// ⛔ `trailing` NOW EXCLUDES `held` — see the note on `QuickFilter`.
			if (quickFilter === 'trailing' && !(isTrailing(c) && !c.held)) return false;
			// ⛔ `steady` INCLUDES PENDING, MATCHING `/`'s `steadySectionAll`. A
			// rollout that has never deployed has no rank to be Trailing OR
			// Steady about, and `/` has always drawn it inside the Steady grid
			// (with a `· N pending` qualifier on the header) rather than giving
			// it a section — never-deployed and gate-blocked are different
			// facts. `pending` survives only as a deep-link key (see above).
			if (quickFilter === 'steady' && !(isSteady(c) || isPending(c))) return false;
			if (quickFilter === 'pending' && !isPending(c)) return false;
			if (quickFilter === 'healthy' && !(isTrailing(c) || isSteady(c))) return false;
			if (envFilters.length > 0 && !envFilters.includes(c.envKey)) return false;
			// ⛔ MATCHED AGAINST THE URL UNTIL 2026-09-03 — see the note on
			// `clusterFilters`' own declaration. The card's cluster identity is
			// still the URL underneath (`sourceURL`/`localClusterURL`); only the
			// PARAM changed to a name, so the comparison resolves through the
			// same `clusterLabelForCard` the filter pill and every row already
			// render, never a second lookup of its own.
			if (clusterFilters.length > 0 && !clusterFilters.includes(clusterLabelForCard(c))) return false;
			if (q) {
				const hay = `${c.ns} ${c.name} ${c.title} ${c.envKey} ${c.envDisplay} ${c.version ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	// Group filtered cards by cluster+namespace, sort groups by namespace name
	// (mockup: "grouped by namespace, sorted by ns name"), rows within a group
	// by severity (fail/stuck first) then title.
	type NsGroup = {
		ns: string;
		clusterURL: string; // source dashboard URL (empty = local)
		clusterLabel: string; // short cluster name for display
		cards: RolloutCard[];
		attentionCount: number; // failed + stuck, for the group header meta line
	};

	const grouped = $derived.by<NsGroup[]>(() => {
		const map = new Map<string, NsGroup>();
		for (const c of filtered) {
			// Key by cluster+ns so same namespace on different clusters is separate.
			//
			// ⛔ THE KEY IS THE CLUSTER'S IDENTITY, NOT ONE OF ITS TWO NAMES.
			// (2026-08-31) It was `sourceURL` alone — the LEGACY annotation — so
			// two rollouts with the same name in the same namespace on two
			// clusters, stamped with `source-cluster` and no `source-dashboard`,
			// collapsed into one group. The `{#each ... (key)}` below then threw
			// `each_key_duplicate` and `/rollouts` rendered nothing at all. The
			// hub/spoke topology is exactly where that pair of rollouts exists.
			const groupKey = (c.sourceCluster || c.sourceURL || '') + '|' + c.ns;
			let g = map.get(groupKey);
			if (!g) {
				const cURL = c.sourceURL || localClusterURL;
				const cLabel = clusterLabelForCard(c);
				g = { ns: c.ns, clusterURL: cURL, clusterLabel: cLabel, cards: [], attentionCount: 0 };
				map.set(groupKey, g);
			}
			g.cards.push(c);
			// ⛔ `isNeedsYou`, NOT A THIRD COPY OF IT. (2026-08-31) This counter and
			// the sort below each open-coded `failed || stuck`, so when the shared
			// predicate learned about failing health checks these two did not: the
			// `Attention` pill above would have said 1 while the group header
			// directly over the row still said `4 rollouts` with no `need
			// attention` clause, and the row would have sorted to the bottom of its
			// own namespace. One page, two answers — the exact shape
			// `fleet-groups.ts` was extracted to end.
			if (isNeedsYou(c)) g.attentionCount++;
		}
		for (const g of map.values()) {
			g.cards.sort((a, b) => {
				const as = isNeedsYou(a) ? 0 : 1;
				const bs = isNeedsYou(b) ? 0 : 1;
				if (as !== bs) return as - bs;
				return a.name.localeCompare(b.name);
			});
		}
		return [...map.values()].sort(
			(a, b) => a.ns.localeCompare(b.ns) || a.clusterLabel.localeCompare(b.clusterLabel)
		);
	});

	/**
	 * ⭐ THE GRID MUST FILL ITS ROW — SUPERSEDES THE 2026-09-02 460px CAP
	 * BELOW, THE SAME DAY. (design re-check, 1440 light + 390 dark)
	 *
	 * ── WHAT THE 460px CAP ACTUALLY SHIPPED ──────────────────────────────
	 * The note this replaces fixed a real defect (44.8% empty, per-group
	 * grids all sharing one page-wide `maxGroupCards`) by CAPPING track
	 * width at 460px instead of letting it fill. That traded a hole INSIDE
	 * the row for a margin AFTER it: `460px 460px` in a 1201px container is
	 * **76.6%** used, and a one-rollout namespace's single `460px` track is
	 * **38.3%**. `/`'s comparable two-up section fills 100% at the same
	 * width. A container using three-quarters of itself, or barely a third,
	 * is not a fix, it is the same defect with better PR.
	 *
	 * ── THE CARD-INFLATION ARGUMENT THE CAP WAS PROTECTING, AND WHY IT DOES
	 *    NOT WIN HERE ─────────────────────────────────────────────────────
	 * Equal columns push a two-card group's cards to ~596px, ~330px past the
	 * card's 264px max-content, so the badge row's `[NEWEST|1.66.0-66]` and
	 * `4d ago updated` separate by ~460px. That is real, and it is also a
	 * SECOND-ORDER cosmetic complaint against a FIRST-ORDER usability one —
	 * a page reading as 62–77% empty. Between the two, the container filling
	 * itself wins; nothing about the card's own layout is touched by this
	 * change; if the gap between the two badge halves reads as loose at
	 * 460–600px CARD width, the card's internal layout is the next lever,
	 * not this one.
	 *
	 * ── THE FIX: PER-GROUP `auto-fit`, NOT A PAGE-WIDE JS CAP ────────────
	 * Each namespace already draws its own `<div class="grid …">` — the bug
	 * was computing `maxGroupCards` ACROSS every group and applying ONE
	 * column count to ALL of them, so a lone-rollout namespace inherited the
	 * two-column template a busier namespace elsewhere on the page needed.
	 * `repeat(auto-fit, minmax(360px, 1fr))` needs no JS at all: it is
	 * evaluated PER GRID, so a group's own card count decides its own track
	 * count. `auto-fit` (not `auto-fill`) is deliberate — `auto-fill` keeps
	 * empty trailing tracks at their `minmax` floor even with nothing in
	 * them, which is the 44.8%-hole defect the ORIGINAL grid-cols-3 shipped
	 * with; `auto-fit` COLLAPSES a track with no item in it to 0 and lets the
	 * occupied tracks' `1fr` absorb the freed space, which is what "fills
	 * its container" requires. `/environments`'s `.env-stack` already uses
	 * `auto-fit` for exactly this reason — see `CLAUDE.md`'s "ragged right"
	 * note.
	 *
	 * 360px is comfortably above the card's 264px max-content, so a track
	 * never pinches the card; the product's global container cap
	 * (`max-w-7xl`, 1280px) keeps `auto-fit` from ever offering a fourth
	 * track at any viewport this product ships, so the "xl track count is
	 * capped at 3" intent survives with no JS to maintain it. Below `xl` the
	 * grid stays `grid-cols-1 sm:grid-cols-2` — unmeasured, untouched.
	 *
	 * ⛔ SUPERSEDED 2026-09-03 — `1fr` PASSED ITS OWN CENSUS BY INFLATING THE
	 * CARD, NOT BY FILLING THE ROW. `minmax(360px, 1fr)` let a lone card's
	 * track absorb the WHOLE freed row: measured at 1440, a one-rollout
	 * group's single track is **1201px** with the card's own content at
	 * **190px, 15.8% ink** (53.7% at 390) — a 965px internal gap. A
	 * two-rollout group's cards inflate to **596.5px** each. "≥95%
	 * used-width" was true and worthless: it cannot distinguish a full row
	 * from a card stretched thin around unchanged content. Capping the track
	 * at `minmax(360px, 460px)` (with `xl:justify-start` so the freed space
	 * lands as a ragged-right margin, not inside the tracks) keeps
	 * `auto-fit`'s empty-track collapse — the 44.8%-hole fix stays — while
	 * putting a ceiling back on card width, so a lone rollout reads as ONE
	 * rollout-sized card, not a namespace-wide banner. See `CLAUDE.md`'s
	 * "ragged right" note, third correction.
	 */

	// Quick-filter tile counts, from the full (unfiltered) set of cards. Every
	// predicate is `/`'s — see the note on QuickFilter.
	const attentionCards = $derived.by(() => cards.filter(isNeedsYou));
	const inMotionCards = $derived.by(() => cards.filter(isInMotion));
	const heldCards = $derived.by(() => cards.filter(isHeld));
	const pendingCardsAll = $derived.by(() => cards.filter(isPending));
	// ⛔ `trailing` EXCLUDES `held` NOW — see the note on `QuickFilter` and on
	// `filtered` above. Before this fix these four rollouts were counted
	// under BOTH the `Trailing` pill here and (nowhere — this page had no
	// `Held` pill at all) on `/`'s `Held` section.
	const trailingCards = $derived.by(() => cards.filter((c) => isTrailing(c) && !c.held));
	const steadyCards = $derived.by(() => cards.filter(isSteady));

	// Compact status filter pills (single-select) shown in the filter bar.
	//
	// ⭐ FIVE PILLS, `/`'S FIVE SECTIONS, `/`'S OWN ORDER AND WORDS.
	// (2026-09-03, F4 third re-check, finding 5) This used to be
	// `Attention · In motion · Pending · Trailing · Steady` — four of those
	// five words do not appear anywhere on `/`, which spells the identical
	// buckets `Needs you now` (the section header's full form; the pill
	// keeps the shorter `Needs you` — see below), `In motion`, `Held`,
	// `Trailing`, `Steady`. `Attention` and `Needs you` are the same set
	// counted correctly the whole time; the defect was the WORD, which an
	// operator moving between the two pages has to re-learn maps to the same
	// thing. `Held` is new here (see `heldCards` above); `Pending` is gone as
	// a pill because `/` has never had a standalone Pending section — it
	// folds into Steady's own count with a qualifier, which this pill does
	// too now (see the `qualifier` field and its render site).
	//
	// ⚠️ `Trailing` SITS BETWEEN `Held` AND `Steady`, IN SEVERITY ORDER, and
	// takes the same amber the product spends on drift everywhere else — NOT
	// red, which belongs to `Needs you`. Drift is the normal state of a
	// promotion pipeline; the adverse state is stuck. `Held` sits between
	// `In motion` and `Trailing`, exactly where `/` draws its own Held
	// section.
	//
	// ⚠️ `Healthy` IS RENAMED `Steady`, NOT REDEFINED IN PLACE. Leaving the
	// word `Healthy` on a count that no longer includes trailing rollouts
	// would be the same defect with a smaller number: an operator who learned
	// that `Healthy 14` means "everything is fine" would read `Healthy 11` the
	// same way. `/` has called this bucket Steady since it was built.
	const statusPills = $derived([
		{ key: 'attention' as QuickFilter, label: 'Needs you', count: attentionCards.length, dot: 'bg-red-500', qualifier: null as string | null },
		{ key: 'active' as QuickFilter, label: 'In motion', count: inMotionCards.length, dot: 'bg-blue-500', qualifier: null as string | null },
		{ key: 'held' as QuickFilter, label: 'Held', count: heldCards.length, dot: 'bg-orange-500', qualifier: null as string | null },
		{ key: 'trailing' as QuickFilter, label: 'Trailing', count: trailingCards.length, dot: 'bg-amber-500', qualifier: null as string | null },
		{
			key: 'steady' as QuickFilter,
			label: 'Steady',
			count: steadyCards.length,
			dot: 'bg-green-700 dark:bg-green-400',
			// `/`'s Steady grid also holds pending rollouts, with a
			// `· N pending` qualifier on the header rollup rather than a
			// section of their own — see the `steadySectionAll` note in
			// `ControlCenter.svelte`. Selecting this pill filters the same
			// union (`isSteady(c) || isPending(c)`, see `filtered` above).
			qualifier: pendingCardsAll.length > 0 ? `+${pendingCardsAll.length} pending` : null
		}
	]);

	// The head band's rollup — SCALE AND SPREAD, over the unfiltered set. It is
	// deliberately NOT the severity partition: `Attention 0 · In motion 0 ·
	// Pending 0 · Trailing 3 · Steady 12` is already drawn 20px below as the
	// filter pills, and a second object reading the same array is the thing
	// this page's own rules cut. The total and the number of namespaces and
	// clusters it spans appear nowhere else on the page.
	const nsSpread = $derived(
		new Set(cards.map((c) => (c.sourceCluster || c.sourceURL || '') + '|' + c.ns)).size
	);
	const clusterSpread = $derived(new Set(cards.map((c) => clusterLabelForCard(c))).size);


</script>

<!--
	⛔ THE LEADING WORD IN THIS HEADER USED TO BE THE CLUSTER, AND IT
	WAS READ AS THE ENVIRONMENT. (2026-08-31)

	It rendered `<cluster> / <namespace>` — on the live hub that is
	`dev / hello-world-staging`, with every row inside it correctly
	marked **STAGING**. From the critique: *"An operator scanning at
	3am reads the header."* The two words genuinely differ here (the
	spoke cluster is named `dev` and hosts the staging namespaces),
	so this is not a naming bug to be fixed upstream; the DISPLAY has
	to say which is which.

	THREE CHANGES, and the first one is the fix:

	1. THE NAMESPACE LEADS. Groups are grouped and sorted by
	   namespace, so the namespace is this section's title and the
	   cluster is a qualifier on it. There is no longer a cluster
	   name in first position to be misread — and the sort key now
	   starts at the same x on every group, which it could not do
	   behind a variable-width prefix.
	2. The cluster is a `<ClusterMark>`: the word `cluster`, a server
	   glyph, lowercase — the SAME token the filter row uses, so the
	   two teach each other.
	3. The count moves to a RIGHT-ALIGNED ROLLUP beside the chevron,
	   which is `COMPOSITION-GRAMMAR.md` §1's shape for a titled
	   region and lets a reader take the group's answer without
	   reading a row of it.

	⭐ EXTRACTED TO A SNIPPET, 2026-09-03 (F4, third re-check). A solo
	group now wraps this header in the SAME shrink-wrapped box as its
	one card (see the note beside `grouped`'s `<section>` below), so
	the header markup has to render identically from two call sites
	instead of one. -->
{#snippet groupHeader(g: NsGroup)}
	<a
		href={`/namespaces/${g.ns}`}
		class="group mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-2 dark:border-gray-700/60"
	>
		<div class="flex min-w-0 items-center gap-2">
			<h2 class="truncate font-mono text-sm font-medium text-gray-700 dark:text-gray-300">{g.ns}</h2>
			{#if isMultiCluster}
				<ClusterMark name={g.clusterLabel} class="shrink-0 text-gray-500 dark:text-gray-400" />
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<span class="text-[11px] text-gray-500 dark:text-gray-400">
				{g.cards.length} rollout{g.cards.length === 1 ? '' : 's'}{#if g.attentionCount > 0}
					· <span class="font-medium text-red-600 dark:text-red-400">{g.attentionCount} need attention</span>
				{/if}
			</span>
			<ChevronRightOutline class="h-3.5 w-3.5 shrink-0 text-gray-500 transition-colors group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200" />
		</div>
	</a>
{/snippet}

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!-- ══ THE HEAD BAND ════════════════════════════════════════════════════
	     ⛔ THE DRAWN `Rollouts` TITLE IS GONE. (2026-09-01, from the human:
	     *"environments and rollouts still have a heading"*, against the rule
	     already recorded for `/apps`, `/versions` and rollout detail's History
	     tab: **a page title that repeats the navbar is a duplicate, not a
	     heading.**) `Navbar.svelte` prints `Rollouts` at 17px twenty-five pixels
	     above this line, and the `h1` printed the same word again at 24px — the
	     largest type on the page spent on the thing the reader just clicked.

	     IT IS STILL AN `h1`, JUST NOT A DRAWN ONE. `sr-only` is a 1px clip, so
	     the skip link still lands on a level-1 heading and
	     `a11y.svelte.test.ts`'s heading-structure assertions still pass.

	     WHAT FILLS THE SLOT IS THE ROLLUP, AT THE 24px ROLE THE WORD HELD —
	     the shape `/activity` uses (`47` beside its sentence). Removing a title
	     without replacing its type role is what left `/apps` running 16 → 10
	     where the grammar asks for 24 → 10; this page keeps 24 → 9.

	     ⚠️ THE FILTER/COUNTER ROW BELOW IS UNTOUCHED AND STAYS AT y=72. It is
	     a control, not a heading: a search input and eleven chips at the top of
	     the page would not read as one, and it is the one row here that must be
	     free to wrap. Everything below y=72 on this page is byte-identical. -->
	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
		<h1 class="sr-only">Rollouts</h1>
		{#if cards.length > 0}
			<!--
				⛔ THE HEAD BAND SAID `15 rollouts in 9 namespaces` OVER A GRID
				THAT HAD JUST FILTERED ITSELF TO ZERO. (2026-09-03, operator-walk,
				cosmetic) The rollup was always the UNFILTERED total, deliberately
				— see the note on `nsSpread`/`clusterSpread` below, "SCALE AND
				SPREAD ... deliberately NOT the severity partition" — and that
				argument still holds for the ordinary, unfiltered case: the
				number here is not supposed to re-derive the status pills'
				breakdown. But a SEARCH/env/cluster filter narrowing the set to
				zero is a different fact than "the fleet has 15 rollouts", and
				printing only the latter over an empty grid reads as the page
				disagreeing with itself. While any filter is active, the leading
				figure is the FILTERED count against the total instead.
			-->
			{@const filtersActive =
				envFilters.length > 0 || quickFilter !== 'all' || clusterFilters.length > 0 || !!searchQuery}
			<span class="t-display text-gray-900 tabular-nums dark:text-white"
				>{filtersActive ? filtered.length : cards.length}</span
			>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				{#if filtersActive}
					of {cards.length} rollout{cards.length === 1 ? '' : 's'} match the filters
				{:else}
					rollout{cards.length === 1 ? '' : 's'} in {nsSpread}
					namespace{nsSpread === 1 ? '' : 's'}{clusterSpread > 1
						? ` · ${clusterSpread} clusters`
						: ''}
				{/if}
			</p>
		{/if}
	</div>

	<!--
		⛔ THIS WAS A 12px AMBER ASIDE READING `<name> unreachable — <error>`, AND
		IT WAS THE ONLY THING ON THE PAGE SAYING THE COUNTS ABOVE COVER A SUBSET.
		The hub fails soft, so `/rollouts` can be partly true; a whisper next to a
		header that says `Attention 0` is not a correction, it is a footnote to a
		wrong number. `PartialDataNotice` is the same `AlertPanel` every other
		blocking fact in the product uses.
	-->
	<PartialDataNotice
		errors={clusterErrors}
		subject="this list"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	<!-- Filter bar: search + compact env filter pills + cluster filter pills (per design). -->
	{#if cards.length > 0}
		<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
			<div class="relative min-w-0 flex-1 sm:max-w-xs">
				<SearchOutline
					class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400"
				/>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search rollouts…"
					class="block w-full rounded border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400"
				/>
			</div>
			<!--
				⛔ FIVE CHIPS WHOSE ACCESSIBLE NAMES WERE `prod`, `dev`, `dev`,
				`staging`, `prod`. (2026-08-31)

				Two families — clusters and environments — rendered adjacent with
				nothing but a 1px divider between them, so the SAME WORD appeared
				twice meaning two different things, and at 390 they wrapped into
				three mixed rows with an orphaned `PROD` on the last and the
				divider dangling at the end of a line.

				THE ROW IS THREE WRAP GROUPS NOW, not one run of eleven items.
				Each family is its own `flex-wrap` container separated by
				`gap-x-4`, so a family wraps INSIDE itself and can never leave one
				member stranded on a line belonging to another family. The two
				divider rules are gone with it: they were doing the separating,
				badly, and `<ClusterMark>` now says `cluster` in words.

				NO LABEL COLUMN, NO DROPDOWN, NO `All` PILL — the standing rules
				for this page hold. The label lives INSIDE the chip, which is the
				chip's own content, not a second column.
			-->
			<div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
			<div class="flex flex-wrap items-center gap-1.5">
				<!-- Status filter pills (compact, single-select) — replaces the old
				     tile banner while keeping the filtering it provided.

				     ⛔ A ZERO-COUNT PILL WAS FULL-INK AT 1440 AND GONE AT 390 —
				     THE TAXONOMY DIFFERED BY WIDTH. (2026-09-03, fourth re-check,
				     NIT) The 2026-09-02 fix above hid an empty bucket below `sm`
				     so it would not cost a 44px band before the first rollout on
				     a phone; measured against 1440, where the same pill drew at
				     FULL contrast, an operator moving between the two widths saw
				     a different SET of buckets — five at 1440, as few as two at
				     390. A filter that can select nothing is still one of the
				     product's five named buckets and belongs in the same place
				     at every width; what it must not do is compete for ink with
				     one that can. It renders everywhere now, MUTED — `gray-400`
				     / `gray-500` ink, a lighter `gray-100` / `gray-800` hairline,
				     no fill (unselected pills never had one) — never hidden, and
				     still a real control: `onclick` and `aria-pressed` are
				     unchanged, so selecting an empty bucket is honest (the grid
				     falls through to `No matches` below, the same empty state
				     every other filter combination reaches). -->
				{#each statusPills as sp (sp.key)}
					<!--
						⭐ F2: ONE HEIGHT, ONE RADIUS, ACROSS ALL THREE FILTER-CHIP ROWS.
						(2026-09-03, breakpoints pass) Measured on the live page:
						status pills 18px/pill, cluster pills 26px/pill, env chips
						20px/4px — three different controls in one filter bar reading
						as three different KINDS of thing when they are all the same
						kind (a toggle). `rounded` (4px, matching the `Chip` the env
						row already renders) and `min-h-[26px]` (the tallest of the
						three, so raising the shorter two never clips their own
						content) now apply to all three rows below.
					-->
					<button
						type="button"
						onclick={() => setQuickFilter(quickFilter === sp.key ? 'all' : sp.key)}
						aria-pressed={quickFilter === sp.key}
						class="t-label inline-flex min-h-[26px] items-center gap-1.5 rounded border px-2.5 py-1 transition-colors
							{quickFilter === sp.key
								? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
								: sp.count === 0
									? 'border-gray-100 text-gray-400 hover:border-gray-300 hover:text-gray-600 dark:border-gray-800 dark:text-gray-500 dark:hover:border-gray-600 dark:hover:text-gray-300'
									: 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
					>
						<span class="h-[5px] w-[5px] shrink-0 rounded {sp.dot}"></span>
						{sp.label}
						<!-- No `opacity-60` here. It composited to 2.32:1 in light /
						     3.27:1 in dark at 11px, and dimming instead of explaining is
						     the pattern `DESIGN.md` has now rejected twice (it is why
						     `valueDim` came out of `/envs/[name]`). The count inherits
						     the pill's own ink, which is the muted token in the resting
						     state and the knockout in the selected one - both measured. -->
						<span class="font-mono tabular-nums">{sp.count}</span>
						<!-- `Steady`'s pending qualifier — `/`'s own `· N pending` on
						     the section header, folded into the pill since a filter
						     chip has no header of its own. See `statusPills`' note. -->
						{#if sp.qualifier}
							<span class="font-mono text-[10px] tabular-nums">{sp.qualifier}</span>
						{/if}
					</button>
				{/each}
			</div>
			{#if isMultiCluster && allClusters.length > 0}
				<div class="flex flex-wrap items-center gap-1.5">
					{#each allClusters as cl}
						{@const sel = clusterFilters.includes(cl.name)}
						<button
							type="button"
							onclick={() => toggleCluster(cl.name)}
							aria-pressed={sel}
							class="inline-flex min-h-[26px] items-center rounded border px-2.5 py-1 transition-colors
								{sel
									? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
									: 'border-gray-200 bg-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'}"
						>
							<ClusterMark name={cl.name} />
						</button>
					{/each}
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-1.5">
				{#each knownEnvs as e}
					{@const sel = envFilters.includes(e.key)}
					<button
						type="button"
						onclick={() => toggleEnv(e.key)}
						aria-pressed={sel}
						aria-label={`Environment ${e.display}`}
						class="environment-theme-scope inline-flex min-h-[26px] items-center rounded transition-opacity
							{sel
								? 'ring-1 ring-gray-900/30 dark:ring-gray-100/30'
								: envFilters.length === 0
									? ''
									: 'opacity-40 hover:opacity-100'}"
						style={e.theme ? getEnvironmentThemeStyle(e.theme) : undefined}
					><Chip role="env" theme={e.theme} label={e.display} wide /></button>
				{/each}
			</div>
			</div>
			{#if envFilters.length > 0 || quickFilter !== 'all' || clusterFilters.length > 0 || searchQuery}
				<button
					type="button"
					onclick={clearFilters}
					class="text-[11px] text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
				>clear</button>
			{/if}
		</div>
	{/if}

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<div class="space-y-6">
			{#each Array(2) as _}
				<div>
					<div class="mb-3 flex items-center justify-between border-b border-gray-100 pb-2 dark:border-gray-700/60">
						<div class="h-3 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-3 w-4 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
					</div>
					<div class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each Array(3) as _}
								<li class="flex items-center gap-4 px-5 py-4">
									<div class="h-7 w-7 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
									<div class="flex flex-1 flex-col gap-1.5">
										<div class="h-3.5 w-44 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
										<div class="h-2.5 w-24 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
									</div>
									<div class="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
									<div class="h-4 w-12 animate-pulse rounded-full bg-gray-200/70 dark:bg-gray-700/60"></div>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			{/each}
		</div>
	{:else if query.isError}
		<!--
			⛔ THIS WAS `Failed to load rollouts: Request failed (503)` IN A 14px RED
			BOX AND THAT IS WHAT THE CRITIC SAW AS "a title and nothing else".
			A status code is not what happened; there was no retry, no way out, and
			nothing separating it from the page's own empty state. At 3am a bare
			`/rollouts` reads as *"the cluster has no rollouts"* — the product
			inventing an all-clear out of a failure. `ErrorState` is the product's
			one failed-request object and it guarantees all four parts.
		-->
		<ErrorState
			error={query.error}
			subject="the rollout list"
			backHref="/"
			backLabel="Go to Home"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-2"
		/>
	{:else if cards.length === 0}
		<div class="mx-auto max-w-2xl py-12">
			<!-- Faded sample card preview showing what a rollout looks like -->
			<div class="pointer-events-none relative mx-auto w-full max-w-sm select-none opacity-60 grayscale" aria-hidden="true">
				<div class="overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-center gap-3">
							<span class="inline-flex h-7 w-7 items-center justify-center rounded-full {getStatusCircleClass('Succeeded')}">
								<BakeStatusIcon bakeStatus="Succeeded" size="medium" />
							</span>
							<div class="flex flex-col">
								<span class="text-base font-bold text-gray-900 dark:text-white">My App</span>
								<span class="font-mono text-[11px] text-gray-500 dark:text-gray-400">my-app</span>
							</div>
						</div>
						<span class="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:bg-gray-700 dark:text-gray-300">PROD</span>
					</div>
					<div class="mt-2 flex items-baseline justify-between gap-3 pl-12">
						<span class="font-mono text-sm font-medium text-gray-700 dark:text-gray-300">v1.2.3</span>
						<span class="font-mono text-[10px] text-gray-500 dark:text-gray-400">2h</span>
					</div>
				</div>
			</div>
			<!-- Empty state message + CTA -->
			<div class="mt-8 text-center">
				<p class="text-base font-semibold text-gray-900 dark:text-white">No rollouts yet</p>
				<p class="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400 mx-auto">Cards like the one above will appear here once you create a <code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">Rollout</code> resource in your cluster.</p>
				<!-- ⛔ NOT A FILLED BUTTON. (2026-09-02) This was the darkest,
				     highest-contrast mark on the empty state and all it did was
				     open a README. A fill is reserved for a control that changes
				     what is running; nothing on a page with no rollouts does. -->
				<a
					href="https://github.com/kuberik/rollout-controller"
					target="_blank"
					rel="noopener noreferrer"
					class="nav-link mt-2"
				>
					Read the docs
					<span aria-hidden="true">↗</span>
				</a>
			</div>
		</div>
	{:else if grouped.length === 0}
		<!--
			⛔ WAS `No matches` / a single `Clear filters` LINK, UNDER A HEADER
			THAT STILL SAID THE FULL FLEET SIZE. (2026-09-03, operator-walk,
			cosmetic) `/activity` reaches the identical shape — a filtered set
			with nothing in it — and answers with a named state
			(`Nothing matches these filters`) and ONE BUTTON PER ACTIVE
			DIMENSION, so clearing the search does not also throw away an
			env/cluster/status pick the reader never asked to remove. Same
			wording, same `btn btn-secondary` control `/activity`'s own empty
			state uses.
		-->
		{@const activeDims = [
			!!searchQuery,
			quickFilter !== 'all',
			envFilters.length > 0,
			clusterFilters.length > 0
		].filter(Boolean).length}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<p class="text-sm font-medium text-gray-700 dark:text-gray-300">Nothing matches these filters</p>
			<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
				Try clearing one filter at a time, or clear them all.
			</p>
			<div class="mt-3 flex flex-wrap items-center justify-center gap-2">
				{#if searchQuery}
					<button type="button" onclick={() => (searchQuery = '')} class="btn btn-secondary"
						>Clear “{searchQuery}”</button
					>
				{/if}
				{#if quickFilter !== 'all'}
					{@const label = statusPills.find((sp) => sp.key === quickFilter)?.label ?? quickFilter}
					<button type="button" onclick={() => setQuickFilter('all')} class="btn btn-secondary"
						>Clear “{label}”</button
					>
				{/if}
				{#if envFilters.length > 0}
					<button type="button" onclick={() => setMultiParam('env', [])} class="btn btn-secondary"
						>Clear environments</button
					>
				{/if}
				{#if clusterFilters.length > 0}
					<button
						type="button"
						onclick={() => setMultiParam('cluster', [])}
						class="btn btn-secondary">Clear clusters</button
					>
				{/if}
				{#if activeDims > 1}
					<button type="button" onclick={clearFilters} class="btn btn-secondary"
						>Clear all filters</button
					>
				{/if}
			</div>
		</div>
	{:else}
		<div class="space-y-6">
			{#each grouped as g (g.clusterLabel + '|' + g.clusterURL + '|' + g.ns)}
				<!--
					⭐ F4 (fourth correction, 2026-09-03 third re-check): CARDS AND
					THE GROUP'S HEADER RULE SHARE A RIGHT EDGE AT EVERY WIDTH. The
					previous `minmax(360px, 460px)` cap fixed the card-inflation
					defect but left the header's hairline and rollup running the
					section's FULL width while the card(s) stopped 273–741px short
					of it — nine groups, nine identical margins-that-read-as-holes.

					A group with ≥2 rollouts genuinely wants to fill the row (two
					real cards side by side reads as content, not as a stretched
					single card), so those grids go back to `minmax(360px, 1fr)`
					and the header stays a full-width block — both edges are the
					container's edge, byte-identical, nothing to reconcile.

					A group with EXACTLY ONE rollout cannot make that same claim: a
					single 1fr track inflates to the whole row (measured 1201px,
					15.8% ink — the defect the 460px cap existed to fix in the first
					place). So a solo group's header AND grid are wrapped in one
					`width: fit-content; max-width: 460px` container instead: the
					card still tops out at 460px, and now the header rule and
					rollup are IN that same shrink-wrapped box, so they end at the
					card's own right edge rather than the row's. Below the 730px
					container threshold (mobile) the wrapper is untouched — both
					header and card are already full-width blocks there.
				-->
				{@const solo = g.cards.length === 1}
				<section class="rg-cq">
					<div class={solo ? 'rg-solo' : ''}>
						{@render groupHeader(g)}
						<!-- Responsive grid of compact rollout cards. State column dropped
						     (redundant with the status circle); cards flow into columns so wide
						     screens are not one stretched row each. -->
						<div class="rg-grid grid gap-2 {solo ? 'rg-grid-solo' : 'rg-grid-multi'}">
							{#each g.cards as c (c.sourceURL + '|' + c.ns + '/' + c.name)}
							{@const rolloutHref = rolloutPath(c.sourceCluster || localClusterName, c.ns, c.name)}
							<!-- THE JOINED BUILD BADGE, AND IT IS NOW THE SAME COMPONENT AS
							     EVERY OTHER PAGE'S. This card used to hand-roll it: a
							     `rounded-md` box (a sixth radius against the legal two), a
							     10px bold uppercase label half with a FILL (`bg-gray-100`
							     / `bg-amber-100`), and an 11px mono value half. `/apps`,
							     `/apps/[name]`, `/` and `/versions` all draw the same two
							     facts with `Chip`, at `rounded` 4px, text-only, 11px.
							     Same object, sixth geometry — the exact defect the census
							     exists to catch.
							     The amber fill went with it. With production restored to
							     `#d97706`, an amber `−N` half sat in the same card as an
							     amber-inked `PROD` env chip; `rank` is red now (see
							     `Chip.svelte`) and this card no longer overrides it. -->
							<!-- ⛔ THE VALUE IN THIS BADGE WAS WRONG, AND ON ONE PAGE IT
							     CONTRADICTED ITSELF. (2026-08-30) It read `c.behind`, which
							     counted against the ROLLOUT'S OWN `availableReleases` and
							     returned `null` whenever it could not answer — and `null`
							     fell through to the word `newest` on the line above. On the
							     live hub `hello-world-app` runs the same build `991829b` in
							     dev and staging and this printed `dev −15 991829b` beside
							     `staging newest 991829b`. Same build, adjacent rows, one
							     page, two verdicts.

							     It reads `c.rank` now — `view-models/env-rank.ts`, the ONE
							     denominator, the same object `/apps` and `/environments`
							     print. `unknown` renders the `unranked` role and the WORD
							     `unknown`: DESIGN.md's rule is that an unresolvable
							     comparison never gets rendered as a definite claim, and
							     `newest` was the most definite claim available.

							     GEOMETRY UNCHANGED: same `Chip`, same joined badge, same
							     four roles. Only the number and, for `behind`, the spelling
							     (`−19` → `19 behind`, matching every other page). -->
							{@const verdict = cardVerdict(
								c,
								rankLabel(c.rank),
								rankTitle(c.rank, c.envDisplay || c.name)
							)}
							{@const stateMark = cardStateMark(c)}
							{@const rel =
								c.statusKey === 'pending'
									? { role: 'unranked' as const, txt: 'pending', tip: 'No deploy yet' }
									: {
											role: rankRole(c.rank),
											txt: verdict.label,
											tip: verdict.title
										}}
							<!--
								⭐ F2: THE HOVER IS A FILL NOW, NOT JUST A BORDER STEP.
								(2026-09-03, breakpoints pass) `hover:border-gray-300` on a
								1px border is a ΔL of 0.056 — measured invisible in a
								screenshot diff. `.tap-zone` rows elsewhere (`Card`'s own
								header, `/`'s rows) signal hover with
								`hover:bg-gray-50 dark:hover:bg-gray-700/30`, the same
								background step this card now uses too — one hover
								language for every clickable row/card in the product,
								not a border nobody can see change.
							-->
							<!-- ⛔ WAS ONE `<a href={rolloutHref}>` WRAPPING THE WHOLE CARD.
							     (2026-09-03, B2) That made the region a destination but left
							     no legal way to add a second control inside it — a `<button>`
							     nested in an `<a>` is invalid HTML and doubles the tab stop.
							     `.tap-zone`/`.tap-link` (see `app.css`) is the product's one
							     pattern for "the region navigates, AND it holds a control":
							     the name below is the ONE `.tap-link` (its `::after` covers
							     the region), `Clear pin` is a raised `<button>` alongside it. -->
							<div
								class="tap-zone environment-theme-scope flex flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700/30"
								style={c.theme ? getEnvironmentThemeStyle(c.theme) : undefined}
							>
								<!-- Identity: status circle + metadata.name (+ title) + env badge -->
								<div class="flex items-center gap-2.5">
									<!-- ⛔ THE DISC CARRIES `rolled back` / `pinned` — see
									     `rollout-cards.ts`. It used to be the chip's label, which
									     evicted the rank number from the row entirely. The word may
									     not live in a badge on one list and inside a chip on the
									     other, so `/` does exactly this too. -->
									<span
										class="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(c.bakeStatus, stateMark?.kind ?? null)}"
										title={stateMark ? stateMark.title : undefined}
									>
										<BakeStatusIcon
											bakeStatus={c.bakeStatus}
											size="medium"
											state={stateMark?.kind ?? null}
											stateWord={stateMark?.word ?? ''}
										/>
									</span>
									<div class="min-w-0 flex-1">
										<div class="flex min-w-0 items-baseline gap-1.5">
											<a
												href={rolloutHref}
												class="tap-link truncate font-mono text-sm font-semibold text-gray-900 dark:text-white"
												>{c.name}</a
											>
											{#if c.stuck}<StuckBadge reason={c.stuck} />{/if}
											<!-- ⛔ THE ROW THAT SAID `deploy succeeded` WHILE THE SLO
											     WAS BLOWN. (2026-08-31) `statusKey` is the DEPLOY's
											     verdict and the deploy did succeed; the check failed
											     after it, and nothing on this card read it. Same slot
											     and same `alarm` Chip as `StuckBadge` — a failing
											     check is not a new severity and must not get a
											     second, weaker geometry. -->
											{#if c.checkFailure}<Chip
													role="alarm"
													label="unhealthy"
													title={checkFailureTitle(c.checkFailure)}
													wide
													class="shrink-0"
												/>{/if}
										</div>
										{#if c.title && c.title !== c.name}<span class="truncate text-[11px] text-gray-500 dark:text-gray-400">{c.title}</span>{/if}
									</div>
									{#if c.envDisplay}
										<Chip role="env" theme={c.theme} label={c.envDisplay} wide class="shrink-0" />
									{/if}
								</div>
								<!-- Version tag + last change -->
								<div class="flex items-center justify-between gap-2">
									<span class="flex min-w-0 flex-wrap items-center gap-1.5">
										<!-- ⛔ A ROLLBACK USED TO BE INDISTINGUISHABLE FROM A DEPLOY
										     ON EVERY LIST SURFACE. A live UX critique rolled production
										     back to a one-hour-old build and this card drew it exactly
										     like a forward one.

										     THE WORD GOES IN THE CHIP, NOT BESIDE IT. `/`'s row is the
										     tight one — loose `ROLLED BACK` and `PINNED` marks there took
										     the app name's width to ZERO — and a fact spelled two ways on
										     two list surfaces is a fact nobody learns, so both pages state
										     it the same way through `cardVerdict`. That is also why
										     `PinBadge` is gone from HERE: this card had the room, but the
										     word `pinned` may not live in a badge on one list and inside
										     the chip on the other. -->
										<!-- `wide` LIFTS THE 12ch CAP, and it is REQUIRED by the
										     new label. `−19` fit; `19 BEHIND` at the chip's uppercase
										     tracking renders `19 BEHI…`, which is not a word. Same
										     opt-out `/environments` and `/envs/*` already use for
										     this exact string. -->
										<Chip
											role={rel.role}
											label={rel.txt}
											title={rel.tip}
											wide
											value={c.version ? shortenVersion(c.version) : '—'}
											valueTitle={c.version ?? 'no build'}
											valueDim={!c.version}
											class="min-w-0"
										/>
									<!-- ⛔ REVERSED, 2026-09-03 (F4 third re-check, finding 2:
									     "HELD IS SPELLED FIVE WAYS"). A prior pass deleted this
									     chip on the theory that the disc's pause glyph already
									     says it — true for a mouse hovering the disc's `title`,
									     false for everyone else: the glyph has no visible word,
									     `sr-only` text is silent to a sighted reader, and touch
									     has no hover at all. Measured across the product, "held"
									     was spelled FIVE different ways on five list surfaces (a
									     chip here once, then nothing on `/rollouts` or
									     `/namespaces`, a lock glyph + sentence on `/envs/<name>`,
									     a nested rule block on `/environments`, prose on `/apps`)
									     — only the orange disc was constant. One atom now: the
									     SAME `Chip role="held" label="held"` `/` already ships in
									     its own Held section, wrapping onto its own line beside
									     the rank chip (the span above is `flex-wrap` now) rather
									     than competing with the app name for width. See the same
									     chip on `/namespaces/[name]` and `/environments` for the
									     other two surfaces this pass fixed. -->
									{#if c.held}
										<Chip
											role="held"
											label="held"
											title="Held: a newer build exists, but no rule lets it through yet."
											class="shrink-0"
										/>
									{/if}
									<!-- ⭐ B2, operator-walk finding (2026-09-03): AN OPERATOR'S
									     PIN RENDERED AS `held` HERE, AND NEVER AS ITSELF. The disc
									     above still resolves to ONE glyph (`held` outranks `pinned`
									     there by design — see `cardStateMark`'s own note), but a
									     WORD-level chip has no such budget limit: `held` and
									     `pinned` are independent facts and both render when both
									     are true, matching Home's `PINNED` chip and `/apps`'
									     pin panel. Deliberately NOT `role="held"` (that hue is
									     "a rule is blocking this"; a pin is a choice, not a rule —
									     see `lib/CLAUDE.md`'s banner-hue rule) and Chip's role
									     vocabulary (`type` lane's file) has no dedicated `pinned`
									     hue yet, so this reads in the neutral `unranked` gray
									     rather than inventing a colour outside this lane. -->
									{#if c.pinnedVersion}
										<Chip
											role="unranked"
											label="pinned"
											title="Pinned to {c.pinnedVersion} — automatic deploys are paused until the pin is cleared."
											class="shrink-0"
										/>
										<!-- ⭐ THE SAME CONTROL `/apps` HAS, NOT A NAVIGATION LINK TO
										     IT. `/apps` links to `/apps/<name>?release=<env>` because
										     ITS row is not the object being unpinned — this row IS,
										     so the control can act in place. Raised above the card's
										     `.tap-link` overlay automatically (`app.css`'s `.tap-zone`
										     rule), so pressing it does not also navigate. -->
										<button
											type="button"
											class="btn btn-secondary shrink-0 px-2 py-1 text-xs"
											aria-label="{CLEAR_PIN_LABEL} on {c.name} in {c.envDisplay || c.envName}"
											onclick={(e) => {
												e.preventDefault();
												openClearPin(c);
											}}
										>
											{CLEAR_PIN_LABEL}
										</button>
									{/if}
									</span>
									<!-- ⛔ F8: THE NOUN LINE SURVIVED AT `sm`+ AND ORPHANED ITSELF.
									     (2026-09-03, re-check) The 2026-09-02 fix above stopped `4d
									     ago` splitting and dropped the `updated`/`started` noun
									     below `sm` — which quieted the wrap at 390 but left it
									     drawn at 1440, where the meta column measured **h=31, two
									     lines**, on all fifteen cards, beside a card that is
									     otherwise one line everywhere else on the row. A fact worth
									     a whole second line at 1440 and worth NOTHING at 390 is not
									     a fact the layout has an opinion about, it's a fact the
									     layout hasn't decided about. The noun was never load-bearing
									     — the disc's own glyph and the chip already say whether the
									     row is mid-deploy — so it drops into the `title` at every
									     width now, same as the tail-8 pattern; the age is one line
									     everywhere. -->
									<span class="flex shrink-0 items-center">
										{#if c.timestamp}
											<span
												class="t-micro font-mono whitespace-nowrap text-gray-500 dark:text-gray-400"
												title="{formatDate(c.timestamp)} — {c.isRunning ? 'started' : 'updated'}"
												>{formatTimeAgoCompact(c.timestamp, $now)} ago</span
											>
										{:else}
											<span class="t-micro whitespace-nowrap text-gray-500 dark:text-gray-400">no deploy</span>
										{/if}
									</span>
								</div>
							</div>
						{/each}
					</div>
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>

<!-- ONE MODAL FOR THE WHOLE GRID, targeting whichever card's `Clear pin`
     button was pressed — the same shared-instance shape rollout detail uses
     for its own single trigger. `rollout`/`cluster`/`environmentName` come
     from `clearPinCard`, so the dialog always names the one row it was
     opened for even though every card on the page shares this instance. -->
<ClearPinModal
	bind:open={clearPinOpen}
	rollout={clearPinCard?.rollout ?? null}
	cluster={clearPinCard?.sourceCluster || undefined}
	environmentName={clearPinCard?.envName ?? null}
	onSuccess={() => query.refetch()}
/>

<style>
	/*
	 * ⭐ F2: THE GRID WAS TWO-COLUMN AT EVERY VIEWPORT ≥640, AND THE SIDEBAR
	 * MAKES 640px OF VIEWPORT MEAN AS LITTLE AS 449px OF CONTENT. (2026-09-03,
	 * breakpoints pass)
	 *
	 * `grid-cols-1 sm:grid-cols-2` decides column count from the VIEWPORT,
	 * but this page's content column is not monotonic in viewport width —
	 * the sidebar is 175px from `sm` (640px) on, so a 639px viewport gives
	 * ~624px of content and a 640px viewport gives ~449px. `sm:grid-cols-2`
	 * fired at exactly the width where the content SHRANK, not grew.
	 * Measured on the live fleet at 640: two 196.5px cards, 30 truncated
	 * fields (`hello-world-manifests` needs 177px and got 61,
	 * `2.66.0-66` clipped to `2.…`), not recovering until 1024 viewport
	 * happened to give the container enough room again.
	 *
	 * Each namespace's own `<section>` is the query subject now (`.rg-cq`),
	 * not the viewport. Below ~730px of the GROUP'S OWN width — not enough
	 * for two 360px tracks plus the 8px gap (2×360+8=728) — the grid is one
	 * column, full width, at every viewport including 640–1023 where it
	 * used to force two. At 730px+ the SAME `auto-fit` rule this grid
	 * already used above `xl` (see the "THE GRID MUST FILL ITS ROW" note
	 * near `grouped`'s definition, and its supersessions below) now governs
	 * every width that can afford it, not only the widest one.
	 *
	 * ⭐ F4 (fourth correction, third re-check, same day): SPLIT BY GROUP
	 * SIZE INSTEAD OF ONE TEMPLATE FOR BOTH. `minmax(360px, 460px)` capped
	 * card width, which stopped a lone card from inflating to the full
	 * row — but the header rule and rollup are DRAWN BY THE SECTION, not
	 * the grid, so they kept the section's full width regardless of the
	 * cap: measured at 1440, a lone card's row was 460px wide inside a
	 * 1201px section, a 741px gap between the card's edge and the header
	 * rule's. A two-card group had the same defect at 273px. "The grid
	 * fills its row" and "the header matches the grid" are different
	 * claims, and the 460px cap only ever tried to satisfy the first one.
	 *
	 * `.rg-grid-multi` (≥2 cards): unchanged claim, `1fr` tracks so real
	 * multi-card rows fill the container — and the header is a full-width
	 * block in the same container, so the two edges are the SAME edge,
	 * nothing to reconcile.
	 *
	 * `.rg-grid-solo` (exactly 1 card): the track keeps its fixed
	 * `minmax(360px, 460px)` range — NOT `1fr` — because a flexible track's
	 * intrinsic (max-content) contribution is not a fixed number the
	 * ancestor `fit-content` box below can shrink-wrap to; a fixed range
	 * gives the grid box a deterministic max-content width (360–460px)
	 * to report upward. It lives inside `.rg-solo` — a sibling wrapper
	 * around BOTH the header and the grid — capped at `max-width: 460px`
	 * and shrink-wrapped (`width: fit-content`) to that. A block child
	 * with `width: auto` (the header `<a>`, the grid) fills its parent's
	 * resolved width, so once `.rg-solo` resolves to ≤460px both children
	 * resolve to that same width — the header rule and the card's right
	 * edge become one edge by construction, not by measurement. Below
	 * 730px `.rg-solo` is inert (no `fit-content` override), so mobile is
	 * untouched: both header and card are already full-width blocks
	 * there.
	 */
	.rg-cq {
		container-type: inline-size;
	}

	.rg-grid {
		grid-template-columns: minmax(0, 1fr);
	}

	@container (min-width: 730px) {
		.rg-grid-multi {
			grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
		}

		.rg-grid-solo {
			grid-template-columns: minmax(360px, 460px);
		}

		.rg-solo {
			width: fit-content;
			max-width: 460px;
		}
	}
</style>
