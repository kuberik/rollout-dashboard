<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⛔ THE FASTEST SURFACE IN THE PRODUCT WAS THE ONE THAT TOLD YOU LEAST.
	 * (2026-08-30)
	 *
	 * > *"Command palette works well; results carry version + env and age but
	 * > NO HEALTH, LAG OR PIN STATE, so the fastest navigation surface carries
	 * > no triage signal. '36 results' shows before you type anything."*
	 *
	 * Every fact it lacked was already computed and already rendered elsewhere:
	 * `buildRolloutCards` + `cardVerdict` are what `/` draws its cards from, and
	 * `env-rank.ts` is the product's one answer to `N behind`. So this file
	 * DERIVES NOTHING OF ITS OWN — it reads the same objects, which is also the
	 * only way a palette row and the page it opens cannot disagree.
	 *
	 * ── WHAT A ROLLOUT ROW ANSWERS NOW ──────────────────────────────────────
	 *
	 *   [· glyph] checkout-api                               [prod]  1h
	 *             checkout-api-prod-us-east-2  [stuck] 19 behind  4.42.0-42
	 *
	 * · the LEADING GLYPH is `RestGlyph` — a quiet 6px dot at rest, the filled
	 *   check for anything else — `/rollouts`' own dense-row unit (round 2,
	 *   design review 4; this used to be a 28px tinted disc, `/`'s CARD atom,
	 *   wrong reference for a list row). It replaced a KIND icon that was
	 *   identical on every row of a group whose header already names the
	 *   kind: a mark repeated on every row under a heading that states it is
	 *   a mark that cannot mark anything.
	 * · the rank/build are QUIET TEXT now (round 2), not a joined chip — same
	 *   `t-meta`/`t-code-sm` pair `/rollouts`' own dense row prints, and
	 *   `verdict` is `cardVerdict`'s — the RANK word, always, except `newest`
	 *   is withheld on a build that failed here. (2026-08-31: the precedence
	 *   `rolled back` > `pinned` > rank was deleting the number, so the state
	 *   moved into the leading glyph exactly as it did on `/` and `/rollouts`.
	 *   One act, one spelling, three surfaces.) The sha stops being a loose
	 *   mono span floating beside the name with nothing to say about it.
	 * · `stuck` keeps its alarm chip — the one filled chip in the product —
	 *   which was already the one thing the palette got right.
	 *
	 * ⛔ AND THE `Ready` DOT IS DELETED. It was `getRolloutStatus` — the
	 * Kubernetes `Ready` CONDITION, which no other surface in this product
	 * renders. Measured under `MOCK_API=1`, ten consecutive rows printed the
	 * same yellow `Unknown` dot, because none of those rollouts publishes the
	 * condition at all. A mark that is identical on every row AND is not the
	 * fact the reader wants is worse than no mark: it occupies the slot the
	 * real health signal needed.
	 *
	 * ── THE SECOND HALF: LINE 1 IS IDENTITY, LINE 2 IS STATE ────────────────
	 *
	 * The state chips are `ms-auto` on the second line, so they align in a
	 * COLUMN down the result list while the namespace truncates into whatever
	 * is left. A palette row is scanned vertically; chips that start at a
	 * different x on every row cannot be scanned at all. It is also what keeps
	 * 390 honest — at full-bleed width the namespace gives up characters and
	 * the marks never do.
	 */
	import { shortRevision } from '$lib/version-utils';
	import { placeKeyOf } from '$lib/view-models/sites-waves';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import type { Rollout, Environment, RolloutDependency } from '../types';
	import { formatTimeAgoCompact, getDisplayVersion, formatDate } from '$lib/utils';
	import {
		blockingStory,
		type GateContext,
		type BlockingStory,
		type ContractHolds
	} from '$lib/view-models/blocking-story';
	import Chip from '$lib/components/Chip.svelte';
	import RestGlyph from '$lib/components/RestGlyph.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import BlockedRow, { blockedKindOf } from '$lib/components/BlockedRow.svelte';
	import { isHeldByApproval } from '$lib/view-models/held';
	import Avatar from '$lib/components/Avatar.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { stepLabel } from '$lib/components/NextStep.svelte';
	import WaveMark from '$lib/components/WaveMark.svelte';
	import { waveMark, familySites } from '$lib/view-models/wave-mark';
	import { bakeWord } from '$lib/bake-status';
	import { buildRolloutCards, cardVerdict, cardStateMark } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { rankLabel, rankRole, rankTitle, lagLabel } from '$lib/view-models/env-rank';
	import { behindOfRollout } from '$lib/view-models/behind';
	import { isNeedsYou } from '$lib/view-models/fleet-groups';
	import { nodeState as cardNodeState, type NodeState } from '$lib/view-models/promotion-lanes';
	import { rolloutTabs } from '$lib/view-models/rollout-tabs';
	import {
		buildPaletteBuildIndex,
		scoreBuildEntry,
		buildChangeRefPaletteResults,
		buildMergedChangeIndex,
		parseChangeRef,
		fieldMatch
	} from '$lib/palette-index';
	import type { MyPull } from '$lib/api/my-pulls';
	import {
		SearchOutline,
		GridOutline,
		RocketOutline,
		LayersSolid,
		ClockOutline,
		FolderOutline,
		TagOutline,
		CodePullRequestOutline,
		ObjectsColumnOutline,
		ClockArrowOutline,
		TerminalOutline,
		ShareNodesOutline,
		ClipboardOutline,
		EditOutline,
		SunOutline,
		MoonOutline,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';
	import { announce } from '$lib/stores/announce.svelte';
	import { NAV_ICON } from '$lib/nav-icons';
	import { theme } from '$lib/stores/theme';
	import {
		getEnvironmentThemeStyle,
		getRolloutEnvironmentTheme,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { rolloutMatchesEnvironment, rolloutPath } from '$lib/source-dashboard';
	import { href, appPath } from '$lib/paths';
	import { now } from '$lib/stores/time';
	import { createQuery } from '@tanstack/svelte-query';
	import { changesQueryOptions } from '$lib/api/changes';
	import { fetchGithubStatus, githubStatusQueryKey } from '$lib/api/github';
	import {
		buildChangeRows,
		myChangesCount,
		familyProgress,
		standingWords,
		familyMeterAriaLabel,
		type ChangeRowVM
	} from '$lib/view-models/changes';
	import { inertSiblings, trapFocus, portal } from '$lib/a11y.svelte';

	type ResultKind = 'rollout' | 'app' | 'env' | 'namespace' | 'action' | 'build' | 'change';

	let {
		open = $bindable(false),
		scope = $bindable(null),
		rollouts,
		environments,
		gateContext,
		contractHoldsFor,
		localClusterName = '',
		currentNamespace,
		currentName,
		loading = false,
		myPulls = [],
		rolloutDependencies = []
	}: {
		open: boolean;
		scope?: ResultKind | null;
		rollouts: Rollout[];
		environments: Environment[];
		/**
		 * ⛔ U-2 CLASS FIX (2026-10-09). `buildRolloutCards` below reads
		 * `.stuck` through the SAME `detectRolloutStuck` join every list
		 * surface does (see `rollout-cards.ts`), and that join needs this to
		 * tell a genuine wedge from a gate correctly refusing a candidate.
		 * Optional only so a caller with no join table yet gets the
		 * documented conservative fallback, never a type error.
		 */
		gateContext?: GateContext;
		/**
		 * ⛔ shared/cards-join (2026-10-11). Without this a rollout held ONLY
		 * by a `RolloutDependency` CONTRACT read `held: false` in the
		 * palette while `/`/`/rollouts` correctly called it held — see
		 * `card-context.ts`'s own doc. `Navbar` (the palette's one mount
		 * point) builds it with the same `cardContext` helper every other
		 * list surface does.
		 */
		contractHoldsFor?: (rollout: Rollout, namespace?: string, cluster?: string) => ContractHolds;
		localClusterName?: string;
		currentNamespace?: string;
		currentName?: string;
		loading?: boolean;
		/**
		 * The `/mine` cache (`api/my-pulls.ts`) — `[]` before it has ever
		 * loaded, or when GitHub is not connected. Backs the `change` result
		 * kind (title matches over the user's own MERGED pulls,
		 * `buildMergedChangeIndex`) and the "Your changes" Browse tile's
		 * count. A query with none of these never behaves differently for
		 * any OTHER result kind.
		 */
		myPulls?: MyPull[];
		/**
		 * ⭐ ONE TRUTH FOR GATES-TAB VISIBILITY (squad-rollout coordinator,
		 * 2026-10-09). `hasGatesTab` reads this through `rolloutTabs` — the
		 * SAME function the rollout layout's own tab strip calls — instead of
		 * a narrower local copy. `Navbar.svelte` passes the SAME cached
		 * `rolloutsListQueryOptions().rolloutDependencies.items` the layout's
		 * own `listQuery` reads (shared query key — no second fetch). `[]`
		 * before it has loaded, same conservative-fallback shape `gateContext`
		 * above already follows.
		 */
		rolloutDependencies?: RolloutDependency[];
	} = $props();

	/**
	 * ⭐ THE ONE OVERLAY IN THE PRODUCT THAT IS NOT A NATIVE `<dialog>`.
	 *
	 * It always had `role="dialog"` and `aria-modal="true"` — and those are a
	 * PROMISE, not a mechanism. Measured on 2026-08-30 by opening the palette
	 * from the navbar and pressing Tab: the fifteenth press was still inside,
	 * the sixteenth landed on the sidebar's `Home` link, underneath the
	 * backdrop, with the palette still open on top of it. `aria-modal` had told
	 * a screen reader to ignore a page that Tab could still walk, and closing
	 * the palette left focus on `<body>` rather than on the control that opened
	 * it. The three flowbite `Modal`s never had this bug because a native
	 * `<dialog>` opened with `showModal()` does all three for free.
	 */

	/**
	 * ⭐ PALROW (2026-10-10, AD round 5): FOCUS GOES BACK TO WHERE IT WAS,
	 * AND ONLY RINGS IF IT WAS RINGING. This supersedes nit 12's redirect
	 * (which moved focus onto the sidebar Search button whenever ⌘K fired
	 * with nothing focused): that made Escape land on a button the reader
	 * never touched, drawn with a blue focus-visible ring because the last
	 * input was a key press. Linear and Raycast return to the exact prior
	 * state: nothing focused stays nothing focused.
	 *
	 * The capture is taken once per open, before the input steals focus,
	 * and records whether that element was showing `:focus-visible`. The
	 * restore passes `focusVisible` accordingly (a mouse-focused trigger
	 * comes back without a ring, a Tab-focused one with it) and always
	 * `preventScroll`, so closing never moves the page. The re-checks past
	 * the overlay's teardown are `modalFocusReturn`'s, measured there.
	 */
	let returnFocusTo: HTMLElement | null = null;
	let returnFocusRing = false;
	$effect.pre(() => {
		if (!open) return;
		untrack(() => {
			const a = document.activeElement;
			returnFocusTo = a instanceof HTMLElement && a !== document.body ? a : null;
			try {
				returnFocusRing = !!returnFocusTo?.matches(':focus-visible');
			} catch {
				returnFocusRing = false;
			}
		});
	});
	$effect(() => {
		if (open) return;
		const el = untrack(() => returnFocusTo);
		if (!el) return;
		returnFocusTo = null;
		const ring = returnFocusRing;
		// Chromium decides `:focus-visible` from the LAST input (the Escape
		// press), and ignores `focusVisible: false`. So a trigger that was
		// mouse-focused gets its ring suppressed inline until the reader's
		// next key press or blur. Tab then rings it, as the platform would.
		const unring = () => {
			el.style.removeProperty('outline');
			el.style.removeProperty('box-shadow');
			el.removeEventListener('blur', unring);
			window.removeEventListener('keydown', onKey, true);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') unring();
		};
		if (!ring) {
			el.style.setProperty('outline', 'none');
			el.style.setProperty('box-shadow', 'none');
			el.addEventListener('blur', unring);
			window.addEventListener('keydown', onKey, true);
		}
		const restore = () => {
			if (el.isConnected && document.activeElement !== el)
				el.focus({ preventScroll: true, focusVisible: ring } as FocusOptions);
		};
		restore();
		setTimeout(restore, 0);
		setTimeout(restore, 180);
	});

	/**
	 * ⛔ FIX PASS ITEM 6/8, 2026-09-10 — THE TILE COUNT READS `myChangesCount`
	 * NOW, THE SAME FUNCTION `YourChangesCard` DOES (ruling 5), NOT
	 * `kindCounts.change` (a count of how many `change`-kind rows survived
	 * INTO THE CAPPED, QUERY-SCORED `allResults` — capped at 3 by §6's own
	 * "free-text title match" rule, and zero whenever the search box is
	 * empty). That produced a "Your changes" tile whose own sentence
	 * changed with what the reader had typed, or read 0 changes merged with
	 * a connected account that has several. `changesQueryOptions` shares
	 * its query KEY with `myPullsQueryOptions` (`api/my-pulls.ts`'s own doc
	 * comment) — gated on `open` so the palette does not fetch while
	 * closed, and a cache hit whenever `/`, `/changes` or this same palette
	 * has already warmed it this session.
	 */
	const changesQuery = createQuery(() => changesQueryOptions({ days: 30, enabled: open }));
	/**
	 * ⭐ ROUND 7 (coordinator, 2026-10-10): "the fallback [change] row gets
	 * the viewer's Avatar (the demo's data-URI face via the existing viewer
	 * avatar the sidebar uses)." `GithubConnectButton.svelte` (mounted in
	 * `Sidebar.svelte` on every page) already fetches this status for its
	 * own photo; same `queryKey`, same `queryFn`, so this is a cache hit
	 * whenever the sidebar is mounted (every rollout page) and at worst one
	 * extra request on a page that somehow is not — never a second
	 * definition of "who is signed in." Gated on `open`, same as
	 * `changesQuery` above, for the identical reason.
	 */
	const githubStatusQuery = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 60_000,
		refetchInterval: false as const,
		enabled: open
	}));
	/**
	 * ⛔ FIX PASS ITEM 6, 2026-09-11 — `.filter((r) => !r.noRelease)`, MATCHING
	 * `YourChangesCard`'s OWN FILTER (ruling "NO RELEASE MEANS NOT AFFECTED,
	 * AND MUST NOT COMPETE"). Without it this tile counted a bare commit with
	 * no release anywhere as one of "your changes" — on a live fleet the tile
	 * read 59 while Home's identical card, built from the same
	 * `changesQueryOptions` cache, read 46. `myChangesCount` itself does not
	 * filter (it is the shared COUNTING function, not the shared SCOPING
	 * decision) — every caller must apply the same scope first, which this
	 * one was not doing.
	 */
	const myChangeRows = $derived(
		buildChangeRows(changesQuery.data?.changes ?? [], rollouts, environments, null, $now).filter(
			(r) => !r.noRelease
		)
	);
	const myChangeCount = $derived(myChangesCount(myChangeRows, changesQuery.data?.user ?? ''));

	/**
	 * ⛔ FIX PASS ITEM 13, 2026-09-11 — THE CHANGES RESULT ROW CARRIES THE
	 * COMPACT METER + STANDING. A `change`-kind result used to fall through
	 * to the generic `{:else if r.subtitle}` line (`#4 · owner/repo`) — the
	 * one fact a reader opens the palette to ask about a change ("did it
	 * land") was nowhere on its own result row. `familyProgress`/
	 * `standingWords` are the SAME functions `ChangeLine` already renders
	 * (`changes.ts`'s own shared view-model), so this row cannot draw a
	 * verdict that disagrees with `/changes`' or Home's. Keyed the same way
	 * `buildMergedChangeIndex` keys its own entries (`owner/repo:pull:n`) —
	 * a bare-commit or sha-guess result has no entry here and keeps the
	 * plain subtitle line, unchanged.
	 */
	const myChangeRowsByKey = $derived.by<Map<string, ChangeRowVM>>(() => {
		const map = new Map<string, ChangeRowVM>();
		for (const row of myChangeRows) {
			if (row.kind !== 'pr' || row.number == null) continue;
			map.set(`${row.owner}/${row.repo}:pull:${row.number}`, row);
		}
		return map;
	});
	function changeResultMeta(r: Result): ChangeRowVM | null {
		if (r.kind !== 'change' || !r.owner || !r.repo || r.changeRef?.kind !== 'pull') return null;
		return myChangeRowsByKey.get(`${r.owner}/${r.repo}:pull:${r.changeRef.number}`) ?? null;
	}

	/**
	 * ⭐ LOCK THE DOCUMENT SCROLL WHILE THE PALETTE IS OPEN. (2026-09-03,
	 * scroll model rewrite) The DOCUMENT is the scroller now (see
	 * `app.css`'s "THE DOCUMENT SCROLLS") — this overlay is `fixed inset-0`
	 * and reads its own list, so wheeling over it must not also move the
	 * page underneath. `html.scroll-locked` (`app.css`, unlayered) sets
	 * `overflow: hidden` on `html`; `scrollbar-gutter: stable` on the same
	 * element is what keeps the page from shifting sideways the instant this
	 * engages. The counter on `window` is defensive against two lockers
	 * (this palette and `ChangeVersionModal`) somehow being open at once —
	 * not a real product state today, but cheap insurance against one
	 * closing early and unlocking a page the other still needs locked.
	 */
	$effect(() => {
		if (typeof document === 'undefined' || !open) return;
		const w = window as unknown as { __scrollLockCount?: number };
		w.__scrollLockCount = (w.__scrollLockCount ?? 0) + 1;
		document.documentElement.classList.add('scroll-locked');
		return () => {
			w.__scrollLockCount = Math.max(0, (w.__scrollLockCount ?? 1) - 1);
			if (w.__scrollLockCount === 0) document.documentElement.classList.remove('scroll-locked');
		};
	});

	let searchInput = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);
	let query = $state('');
	let selectedIndex = $state(0);
	/**
	 * ⭐ ROUND 3, ITEM 2 (AD, 2026-10-09): "the only feedback is the sr-only
	 * announcement; focus lands on Search with a blue ring." Focus already
	 * returns correctly (`modalFocusReturn`, below — wherever it was before
	 * ⌘K, which IS the sidebar's Search button when that is how the palette
	 * was opened); what was missing is a VISIBLE confirmation so that
	 * landing spot doesn't read as "nothing happened." Declared outside the
	 * `{#if open}` block (see the template) so the toast survives the
	 * palette closing — `copyBuildSha` sets `open = false` in the same tick
	 * it fires the copy.
	 */
	let copyToastOpen = $state(false);
	let copyToastMessage = $state('');
	type Result = {
		kind: ResultKind;
		key: string;
		/**
		 * The row's own glyph, when it is not its kind's. Page rows take the
		 * sidebar's (`NAV_ICON`), command rows the one their own button
		 * draws; before, every `action` row drew Activity's clock, so
		 * "Rollouts" wore two icons (visual audit #19).
		 */
		icon?: typeof GridOutline;
		// Canonical, searchable identifier — the resource name for rollouts.
		title: string;
		// Optional human-friendly OCI title, shown muted alongside the name.
		pretty?: string;
		subtitle?: string;
		href: string;
		// Extra surface-area for visual cues
		envTheme?: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		/**
		 * ⭐ PALROW: the env chip's label on a ROLLOUT row. Normally the
		 * theme's short label; for a rollout with no Environment record
		 * (payments-svc in platform-prod) it falls back to the cluster it
		 * runs in, drawn as a neutral chip (no identity dot colour), so every
		 * rollout row carries the same qualifier in the same slot instead of
		 * a few rows printing a bare namespace there. `envFallback` marks
		 * that case for the chip's title.
		 */
		envLabel?: string;
		envFallback?: boolean;
		/** The bake state, for the leading status disc. Rollout rows only. */
		bakeStatus?: string;
		version?: string;
		timestamp?: string;
		stuck?: boolean;
		isCurrent?: boolean;
		/**
		 * THE ROW'S ONE VERDICT WORD, from `cardVerdict` — `rolled back`,
		 * `pinned`, or the rank (`19 behind` / `newest` / `unreleased` /
		 * `unknown`). Its `title` carries everything the word displaced.
		 */
		verdict?: { label: string; title: string; role: 'newest' | 'rank' | 'diverged' | 'unranked' };
		/** `rolled back` / `pinned` / `held`, drawn in the leading disc — see `/`. */
		state?: 'rolled-back' | 'pinned' | 'held' | null;
		stateWord?: string;
		stateTitle?: string;
		/**
		 * ⭐ LANE P, §5 ROUND 2 (squad-rollout coordinator, 2026-10-09): THE
		 * SAME `NodeState` `PromotionLane`/`FleetRow` READ. The leading glyph
		 * column used to mix `RestGlyph`'s own `BakeStatusIcon` fallback (a
		 * filled check, a plain spinner) with nothing shared — "a held pause,
		 * a yellow dot, a blue ring and a big green check" at inconsistent
		 * weights. `nodeState(c)` is the ONE derivation the product already
		 * has for "what is this row's state, worst-first" (`promotion-
		 * lanes.ts`); the leading glyph now reads it directly instead of
		 * re-deriving a second opinion from `bakeStatus`/`state`.
		 */
		nodeState?: NodeState;
		/**
		 * How many things under this result need a person — a rollout that has
		 * FAILED or is STUCK. 0 on everything settled, and nothing renders for
		 * a 0: a count of the norm is not a mark.
		 */
		needsYou?: number;
		/** Worst-first ordering key for the default screen. Higher is worse. */
		severity?: number;
		// For `app` rows: per-env mini-strip data (env theme + bake status)
		envCells?: Array<{
			envName: string;
			theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
			bakeStatus: string;
			version: string | null;
		}>;
		/**
		 * `build` rows only — the full git revision (never truncated) a sha
		 * PREFIX is matched against, and every label some service ships it
		 * under. See `palette-index.ts`'s `scoreBuildEntry`.
		 */
		revisionFull?: string;
		labels?: string[];
		/** `change` rows only — the reference this result resolves to. */
		owner?: string;
		repo?: string;
		changeRef?: { kind: 'pull'; number: number } | { kind: 'sha'; sha: string };
		/**
		 * A ref row (`Open change #4 · repo`) — rendered UNGROUPED, above the
		 * first group header, never inside `grouped`'s own per-kind sections.
		 * See `buildChangeRefPaletteResults`'s own doc comment.
		 */
		ungrouped?: boolean;
		/**
		 * ⭐ ROUND 3, ITEM 1 (AD, 2026-10-09): "queries history/logs/change
		 * version/copy build each return 0 results." The This-rollout and
		 * global nav rows used to live OUTSIDE `allResults` — drawn only on
		 * the unscoped opening screen — so `score()` never saw them and
		 * typing their own label found nothing. They are normal `action`-
		 * kind results now, scored like everything else; `onSelect`, when
		 * set, is what `pick()` runs INSTEAD of `goto(href)` — a command
		 * that does something (copy, toggle, open a modal via its query
		 * param) rather than only navigating.
		 */
		onSelect?: () => void;
		/** The right-aligned kind word (Raycast's own "Command" column):
		 *  "Go to" for plain navigation, "Command" for anything that DOES
		 *  something. `action`-kind rows only. */
		commandLabel?: 'Go to' | 'Command';
	};

	/**
	 * ONE DERIVATION FOR THE WHOLE PALETTE, AND IT IS `/`'S OWN.
	 *
	 * `buildRolloutCards` already resolves the theme, the version, the stuck
	 * detector, the pin, the rollback and — through `env-rank.ts` — the ONE
	 * `N behind` the product publishes. Re-deriving any of that here is how the
	 * three pages that each invented a `−N` came to print three numbers for one
	 * rollout.
	 */
	const cards = $derived.by<RolloutCard[]>(() =>
		buildRolloutCards(rollouts, environments, $now, gateContext, contractHoldsFor)
	);

	/**
	 * ⛔ U-2: WAS A SECOND, NARROWER COPY OF `isNeedsYou`, MISSING ITS
	 * `checkFailure` CLAUSE. (2026-10-08) Home's `/` needs-you-now reads a
	 * rollout whose deploy succeeded but whose health check is failing as
	 * needing a person; the palette's own local predicate here did not, so a
	 * rollout could show `NEEDS YOU` on `/`/`/rollouts` and not surface under
	 * the identical filter in the palette. `fleet-groups.ts`'s `isNeedsYou` is
	 * the one definition every surface reads (Home, `/rollouts`, this
	 * palette) — re-deriving it here is exactly how that drifted.
	 */
	const cardNeedsYou = isNeedsYou;
	/** Worst first. Failure outranks a stall; a stall outranks a lag. */
	function cardSeverity(c: RolloutCard): number {
		if (c.statusKey === 'failed') return 3;
		if (c.stuck) return 2;
		// A held rollout needs a person or another deploy; it lists above one
		// that is merely behind and will catch up on its own.
		if (c.held) return 1.5;
		if ((c.behindCount ?? behindOfRollout(c.rollout, c.rank)) > 0) return 1;
		return 0;
	}

	// Build the index from all entity types. The palette is a single
	// haystack — we filter/sort once, then render with section headers.
	const allResults = $derived.by<Result[]>(() => {
		const out: Result[] = [];

		// 1. Rollouts
		for (const c of cards) {
			const r = c.rollout;
			// THE VERDICT WORD IS `/`'S, NOT A SECOND OPINION. `cardVerdict`
			// keeps the rank in the word and folds the state's sentence into
			// the title; the state itself rides the leading disc, same as `/`.
			const sentence = rankTitle(c.rank, c.envDisplay || c.name);
			const v = cardVerdict(c, rankLabel(c.rank), sentence);
			const mark = cardStateMark(c);
			out.push({
				kind: 'rollout',
				// Source cluster must be part of the key: the hub merges rollouts
				// from multiple clusters, so namespace/name alone is not unique
				// and would produce duplicate keyed-each keys (crashes the list).
				key: `rollout:${c.sourceCluster}|${c.ns}/${c.name}`,
				title: c.name,
				pretty: r.status?.title && r.status.title !== c.name ? r.status.title : undefined,
				subtitle: c.ns,
				href: rolloutPath(c.sourceCluster || localClusterName, c.ns, c.name),
				envTheme: c.theme ?? themeByEnvLabel.get(c.sourceCluster || '') ?? null,
				envLabel: c.theme ? shortEnvLabel(c.theme) : c.sourceCluster || '',
				envFallback: !c.theme,
				bakeStatus: c.bakeStatus,
				version: c.version ?? undefined,
				timestamp: c.timestamp ?? undefined,
				stuck: !!c.stuck,
				verdict: { label: v.label, title: v.title, role: rankRole(c.rank) },
				state: mark?.kind ?? null,
				stateWord: mark?.word ?? '',
				stateTitle: mark?.title ?? '',
				needsYou: cardNeedsYou(c) ? 1 : 0,
				severity: cardSeverity(c),
				isCurrent: c.name === currentName && c.ns === currentNamespace,
				nodeState: cardNodeState(c)
			});
		}

		// 2. Apps (rollout name across envs)
		const appNames = new Set<string>();
		for (const env of environments) {
			const n = env.spec?.rolloutRef?.name;
			if (n) appNames.add(n);
		}
		for (const name of appNames) {
			const cells = environments.filter((e) => e.spec?.rolloutRef?.name === name);
			const envCells = cells
				.map((env) => {
					const envName = placeKeyOf(env, environments);
					const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
					const theme = r ? getRolloutEnvironmentTheme(r, env) : null;
					const latest = r?.status?.history?.[0];
					return {
						envName,
						theme,
						bakeStatus: latest?.bakeStatus ?? 'None',
						version: latest?.version ? getDisplayVersion(latest.version) : null
					};
				})
				.sort((a, b) => a.envName.localeCompare(b.envName));
			// THE APP'S OWN CARDS — the deepest lag and how many places need a
			// person, both read off the same objects `/apps` ranks with.
			const own = cards.filter((c) =>
				cells.some((e) => rolloutMatchesEnvironment(c.rollout, e))
			);
			const deepest = own.reduce((m, c) => Math.max(m, c.behindCount ?? behindOfRollout(c.rollout, c.rank)), 0);
			const allNewest = own.length > 0 && own.every((c) => c.rank.kind === 'newest');
			out.push({
				kind: 'app',
				key: `app:${name}`,
				title: name,
				subtitle:
					envCells.length > 0 ? `${envCells.length} env${envCells.length === 1 ? '' : 's'}` : undefined,
				href: href(`/apps/${encodeURIComponent(name)}`),
				envCells,
				// `N behind` here is the FURTHEST an environment of this app has
				// fallen — the number `/apps` prints in its own gap column, not a
				// new one. When every environment is on head the word is `newest`;
				// when neither holds there is no honest single answer and the row
				// prints none rather than a `0`.
				verdict: allNewest
					? {
							label: 'newest',
							title: `Every environment of ${name} is on the newest version it has`,
							role: 'newest'
						}
					: deepest > 0
						? {
								// ⭐ shared/age-lag-total: ONE LAG UNIT — `lagLabel`, never a
								// bare `${deepest} behind`.
								label: lagLabel({ builds: deepest }),
								title: `The furthest-behind environment of ${name} can still take ${deepest} newer version${deepest === 1 ? '' : 's'}`,
								role: 'rank'
							}
						: undefined,
				needsYou: own.filter(cardNeedsYou).length,
				severity: own.reduce((m, c) => Math.max(m, cardSeverity(c)), 0)
			});
		}

		// 3. Environments
		const envNames = new Set<string>();
		for (const env of environments) {
			const n = placeKeyOf(env, environments); // a place, not a tier: prod-us-east once prod has several sites
			if (n) envNames.add(n);
		}
		for (const name of envNames) {
			const members = environments.filter((e) => placeKeyOf(e, environments) === name);
			const refRollout = (() => {
				for (const e of members) {
					const r = rollouts.find((r) => rolloutMatchesEnvironment(r, e));
					if (r) return r;
				}
				return null;
			})();
			const theme = refRollout ? getRolloutEnvironmentTheme(refRollout) : null;
			const own = cards.filter((c) => members.some((e) => rolloutMatchesEnvironment(c.rollout, e)));
			out.push({
				kind: 'env',
				key: `env:${name}`,
				title: theme?.label || name,
				subtitle: `${members.length} app${members.length === 1 ? '' : 's'}`,
				href: href(`/envs/${encodeURIComponent(name)}`),
				envTheme: theme,
				needsYou: own.filter(cardNeedsYou).length,
				severity: own.reduce((m, c) => Math.max(m, cardSeverity(c)), 0)
			});
		}

		// 4. Namespaces
		const namespaces = new Set<string>();
		for (const c of cards) {
			if (c.ns) namespaces.add(c.ns);
		}
		for (const ns of namespaces) {
			const own = cards.filter((c) => c.ns === ns);
			out.push({
				kind: 'namespace',
				key: `ns:${ns}`,
				title: ns,
				subtitle: `${own.length} rollout${own.length === 1 ? '' : 's'}`,
				href: href(`/namespaces/${encodeURIComponent(ns)}`),
				needsYou: own.filter(cardNeedsYou).length,
				severity: own.reduce((m, c) => Math.max(m, cardSeverity(c)), 0)
			});
		}

		// 5. Actions (top-level pages) — ONE ENTRY PER `Sidebar.svelte` NAV ITEM,
		// same title and href, so typing the name printed in the sidebar is
		// guaranteed to find its own page. (operator walk: `revisions` returned
		// 0 results — this list had never grown a `Revisions` entry when the
		// page shipped, and `Home` did not resolve because the row was titled
		// `Fleet overview` instead of the word the sidebar prints.) `Dependencies`
		// deliberately stays out: `Navbar.svelte`'s own comment records that it
		// is reached from a rollout's Dependencies tab, not from the sidebar, and
		// `Sidebar.svelte` has no entry for it either.
		const actions: { title: string; href: string; subtitle?: string; icon: typeof GridOutline }[] = [
			{ title: 'Home', subtitle: 'Fleet overview — everything at a glance', href: href('/'), icon: NAV_ICON['/'] },
			{ title: 'Rollouts', subtitle: 'Full inventory list', href: href('/rollouts'), icon: NAV_ICON['/rollouts'] },
			{ title: 'Apps', subtitle: 'Apps across environments', href: href('/apps'), icon: NAV_ICON['/apps'] },
			{ title: 'Environments', subtitle: 'Cross-env matrix', href: href('/environments'), icon: NAV_ICON['/environments'] },
			{ title: 'Changes', subtitle: 'Changes and where they landed', href: href('/changes'), icon: NAV_ICON['/changes'] },
			{ title: 'Activity', subtitle: 'Recent deployments', href: href('/activity'), icon: NAV_ICON['/activity'] },
			// ⭐ APPROACH B, ITEM C — `/me` IS DELIBERATELY NOT IN THE SIDEBAR
			// (design doc: "reach it from Home and the palette"), so this
			// static row is the ONLY way a typed search ever finds it. The
			// subtitle carries the literal phrase "my pull requests" — the
			// task's own words — because `score()`'s substring match is exact
			// text, not a synonym lookup; typing that phrase must hit this
			// row even though the title itself says "Your".
			{
				title: 'Your pull requests',
				subtitle: 'My pull requests across the repos this cluster deploys',
				href: href('/me'),
				icon: NAV_ICON['/me']
			}
		];
		for (const a of actions) {
			out.push({
				kind: 'action',
				key: `action:${a.href}`,
				title: a.title,
				subtitle: a.subtitle,
				href: a.href,
				icon: a.icon,
				commandLabel: 'Go to'
			});
		}

		/**
		 * ⭐ ROUND 3, ITEM 1 (AD, 2026-10-09): "index every This-rollout
		 * command, plus global ones… as fuzzy-ranked results in a 'Commands'
		 * group, first when they match." `thisRolloutActions` used to be
		 * drawn ONLY on the unscoped opening screen; `score()` never saw it,
		 * so typing "history" or "copy build" returned nothing. Reusing the
		 * SAME derived list here (not a second copy) means a row and its own
		 * search hit can never disagree about its label or its action.
		 * "Toggle theme" has no rollout to belong to, so it lives beside the
		 * global nav rows above instead, same `commandLabel: 'Command'` as
		 * every other row here that DOES something rather than only goes
		 * somewhere.
		 */
		for (const a of thisRolloutActions) {
			out.push({
				kind: 'action',
				key: `cmd:${a.id}`,
				title: a.label,
				icon: a.icon,
				href: '',
				onSelect: a.onSelect,
				commandLabel: a.commandLabel
			});
		}
		out.push({
			kind: 'action',
			key: 'cmd:toggle-theme',
			title: 'Toggle theme',
			// the sidebar's own toggle glyph: the theme it switches TO
			icon: $theme === 'dark' ? SunOutline : MoonOutline,
			subtitle: $theme === 'dark' ? 'Switch to light' : 'Switch to dark',
			href: '',
			onSelect: () => {
				open = false;
				theme.toggle();
			},
			commandLabel: 'Command'
		});

		// 6. Builds — every revision this fleet's repos know about (deployed or
		// pending), independent of which label any one service currently prints
		// for it. See `palette-index.ts`'s own doc comment for the bug this
		// closes: a sha pasted from CI used to resolve only when it happened to
		// equal a rollout's CURRENT displayed label.
		for (const b of buildPaletteBuildIndex(rollouts, environments)) {
			out.push({
				kind: 'build',
				key: b.key,
				title: b.short,
				subtitle: `${b.labels.join(', ')} · ${b.repoShort}`,
				// PALROW: the repo rides the right edge on its own (whole); the
				// labels (`labels`, below) are the row's qualifier and truncate
				// first. Display-only: `score()` never reads `repo` on a build.
				repo: b.repoShort,
				href: b.href,
				revisionFull: b.revision,
				labels: b.labels
			});
		}

		// 7. Changes — one entry per the operator's own MERGED pull, from the
		// `/mine` cache. A NORMAL kind now (CHANGES-2026-09-10.md, "THE
		// PALETTE"): scored by `score()`'s own generic substring matcher on
		// `title` (the pull's real title, so "retry on 502" finds it), never
		// bypassed the way the old `pr` kind's title matches used to be. See
		// `score()`'s `change` guard below for the one exception (a
		// ref-shaped query never double-counts as a title match).
		for (const c of buildMergedChangeIndex(myPulls)) {
			out.push({
				kind: 'change',
				key: c.key,
				title: c.title,
				subtitle: `#${c.ref.kind === 'pull' ? c.ref.number : c.ref.sha} · ${c.repo}`,
				href: c.href,
				owner: c.owner,
				repo: c.repo,
				changeRef: c.ref
			});
		}

		return out;
	});

	/**
	 * ⛔ WHAT AN EMPTY QUERY SHOWS, AND WHY IT IS NOT A COUNT. (2026-08-30)
	 *
	 * > *"'36 results' shows before you type anything."*
	 *
	 * It did, in the footer, while the BODY showed a four-tile category picker
	 * — so the one number on the screen counted a set nobody had asked for and
	 * nothing on screen was showing. A count of everything is not an answer to
	 * any question a person opens a palette to ask.
	 *
	 * The handful that actually need a person is. `Needs you` is the same
	 * predicate `/`'s own first card uses — failed, or stuck — read off the
	 * same cards, sorted worst-first, and it sits ABOVE the picker with the
	 * cursor already on its first row. So ⌘K + Enter goes straight to the worst
	 * thing on the cluster.
	 *
	 * ⛔ AND IT DRAWS NOTHING WHEN NOTHING IS WRONG. A `Needs you — 0` header
	 * is a slot spent on absence, which is the same object this pass removed
	 * from `/apps/[name]`'s state card; on a healthy cluster the default screen
	 * is exactly the picker it always was. Capped at 6 — past that this stops
	 * being a triage list and becomes the list you already have at `/`, and the
	 * header prints the true total so the cap can never hide one.
	 */
	/**
	 * ⭐ A CHANGE REFERENCE IS PARSED FROM THE QUERY ITSELF, NEVER SCORED
	 * AGAINST A PRE-BUILT INDEX — same reasoning `build`'s sha-prefix match
	 * has, one level up: every other kind here answers "which of the
	 * fleet's OWN objects does this query name," and a PR/sha reference
	 * names an object this dashboard has never indexed (GitHub's, not the
	 * cluster's). `buildChangeRefPaletteResults` re-parses on every
	 * keystroke (cheap: a few regexes and, for the two ambiguous shapes, one
	 * pass over `rollouts`) and is rendered UNGROUPED, ahead of the first
	 * group header — see `palette-index.ts`'s own doc comment and this
	 * file's template. It is NOT merged into `filtered`'s scored ranking;
	 * only its ARRAY POSITION (spliced at the very front) puts it above
	 * everything else — this is the one destination-not-category exception
	 * the CHANGES design doc calls for. Title matches against the user's own
	 * merged changes are the opposite case, and go through `score()` like
	 * every other kind — see the `change` branch below.
	 */
	const changeRefResults = $derived.by<Result[]>(() =>
		buildChangeRefPaletteResults(query, rollouts).map((e) => ({
			kind: 'change' as const,
			key: e.key,
			title: e.title,
			href: e.href,
			owner: e.owner,
			repo: e.repo,
			changeRef: e.ref,
			ungrouped: true
		}))
	);

	/**
	 * ⭐ LANE P, §5: "Needs you" CAPS AT 3 ON THE OPENING SCREEN NOW, NOT 6.
	 * The spec's opening-screen anatomy is "This rollout" (new, below) then
	 * "Needs you" (max 3) then "Jump to" — three short lists, not one long
	 * one followed by a grid. The true total still prints in the header
	 * (`attention.length`, unchanged), so the cap never hides the number,
	 * only rows past the third.
	 */
	const ATTENTION_CAP = 3;
	/**
	 * ⭐ ROUND 5 (AD review 3 + coordinator, 2026-10-10): "Needs you" rows are
	 * `BlockedRow`s now (home-v2's shared component, design-rollout 6cb1889)
	 * — the SAME object `NeedsYouCard` draws on Home/`/apps`, `size="palette"`.
	 * `BlockedRow` wants the raw `RolloutCard`, not the `Result` this list
	 * used to carry (that mapping existed only so this file's own generic
	 * `resultRow` could draw it) — this is now the RolloutCard list directly,
	 * filtered/sorted by the exact same rule `cardSeverity`/`cardNeedsYou`
	 * state elsewhere in this file.
	 */
	/**
	 * ⭐ PALROW r8 (coordinator's call, 2026-10-10): WHEN THE FLEET HAS A
	 * FAILURE, "NEEDS YOU" LEADS, ON EVERY PAGE. The fleet's own needs-you set
	 * (`isNeedsYou`, the predicate Home reads, never a recount) decides it:
	 * when any member has FAILED, "Needs you" is the first section and this
	 * rollout's tabs follow; on a calm fleet the order stays This rollout →
	 * Needs you → Jump to. While Needs you leads, the current rollout (when it
	 * needs you) is listed there, FIRST, instead of heading "This rollout", so
	 * the first row is still SPEC §7's most likely action ("Deploy failed ·
	 * Open logs" on a failed rollout's own page) and is never listed twice.
	 * ⭐ PALROW r9 (2026-10-11): a build HELD BY APPROVAL joins too, through
	 * the fleet's shared predicate (`isHeldByApproval`, view-models/held.ts,
	 * the one Home's Needs-you reads; no page-local recount). A failure or a
	 * person-hold makes Needs you lead; a stall alone does not.
	 */
	const approvalCards = $derived(
		// No join table yet → no approval rows (the conservative fallback the
		// `gateContext` prop documents); never a guess at who holds what.
		new Set(gateContext ? cards.filter((c) => !cardNeedsYou(c) && isHeldByApproval(c, gateContext, $now)) : [])
	);
	/** Each approval row's classified story, so the row NAMES its gate
	 *  (BlockedRow's held sentence, and the row's accessible name). */
	const approvalStories = $derived.by(() => {
		const m = new Map<RolloutCard, BlockingStory>();
		if (!gateContext) return m;
		for (const c of approvalCards) m.set(c, blockingStory(c.rollout, gateContext, { place: c.envDisplay, now: $now, fleet: { environments, rollouts } }));
		return m;
	});
	function approvalGateLabel(c: RolloutCard): string | null {
		return approvalStories.get(c)?.person[0]?.label ?? null;
	}
	/** Needs a person: failed, stuck (the fleet's `isNeedsYou`), or waiting on an approval. */
	function needsPerson(c: RolloutCard): boolean {
		return cardNeedsYou(c) || approvalCards.has(c);
	}
	/** The row's kind, approval holds included (`blockedKindOf` alone sees failed/stuck). */
	function rowKind(c: RolloutCard) {
		return blockedKindOf(c, approvalCards.has(c));
	}
	/** Failures, then stalls, then approvals (coordinator, 2026-10-11). */
	const KIND_ORDER = { failed: 0, stuck: 1, held: 2 } as const;
	const needsYouLeads = $derived(
		cards.some((c) => (cardNeedsYou(c) && blockedKindOf(c) === 'failed') || approvalCards.has(c))
	);
	const attention = $derived.by<RolloutCard[]>(() =>
		cards
			// ⭐ ROUND 4, ITEM D: on a calm order the current rollout's own
			// blocking row heads "This rollout" (`incidentCard`), so it is not
			// repeated here. When Needs you leads, it is listed here instead.
			.filter((c) => needsPerson(c) && (needsYouLeads || c !== currentRolloutCard))
			.sort(
				(a, b) =>
					Number(b === currentRolloutCard) - Number(a === currentRolloutCard) ||
					KIND_ORDER[rowKind(a)] - KIND_ORDER[rowKind(b)] ||
					cardSeverity(b) - cardSeverity(a) ||
					a.name.localeCompare(b.name)
			)
	);
	const attentionShown = $derived(attention.slice(0, ATTENTION_CAP));

	/**
	 * ⭐ LANE P, §5 — "THIS ROLLOUT". ON A ROLLOUT PAGE, THE OPENING SCREEN'S
	 * FIRST SECTION IS THE PAGE ITSELF: jump to a sibling tab, or act on the
	 * build you are looking at, without ever typing a name. Built entirely
	 * from data this component already has (`cards`, from `buildRolloutCards`
	 * — the same object `/` and `/rollouts` read) so it cannot name a tab or
	 * a build the current page itself disagrees with, and needs no new prop
	 * from `Navbar.svelte`.
	 *
	 * Tabs offered: Overview/History/Logs always (same as the rollout
	 * layout's own `tabs` array — those three are unconditionally `active`
	 * there); Gates only when `hasGatesTab` below says this rollout actually
	 * has one. There is deliberately no "Change version…" row: the spec's
	 * own fallback — "an action that opens a page dialog may navigate with a
	 * query the page already honours, else skip it" — applies, because the
	 * Overview page has no query param that opens `ChangeVersionModal` and
	 * this lane's edit to that file is toast-copy only (squad spec, §5 file
	 * list). Adding that query is the Overview lane's call, not this one's.
	 */
	/**
	 * ⭐ ONE TRUTH FOR "DOES THIS ROLLOUT HAVE A GATES TAB" (squad-rollout
	 * coordinator ruling, 2026-10-09) — reads `rolloutTabs`, the SAME
	 * function the rollout layout's own tab strip calls, instead of this
	 * file's own, narrower copy (which could never see
	 * `rolloutDependencies` — this file had no prop for it). `rollouts`
	 * passes `rolloutDependencies` through from `Navbar.svelte`, which reads
	 * it off the SAME cached `rolloutsListQueryOptions` result the rollout
	 * layout's own `listQuery` reads (shared query key — no second fetch).
	 * `rolloutGates` (the per-rollout detail payload's own gate OBJECTS) is
	 * not available to a list-wide component and is omitted, same as this
	 * file's previous copy — the remaining three clauses (health selector,
	 * `status.gates`, `DeploymentBlocked`) already cover the common cases.
	 */
	function hasGatesTab(c: RolloutCard): boolean {
		const matchedEnv = environments.find((env) => rolloutMatchesEnvironment(c.rollout, env));
		return rolloutTabs({
			rollout: c.rollout,
			environment: matchedEnv,
			cluster: c.sourceCluster || localClusterName,
			localCluster: localClusterName,
			namespace: c.ns,
			name: c.name,
			environments,
			rolloutDependencies
		}).gates;
	}

	/**
	 * ⭐ ROUND 4, ITEM D superseded by ROUND 5 (AD review 3, 2026-10-10): the
	 * leading "blocking fact" row that used to be a `RolloutAction` with a
	 * hand-drawn danger-ink icon (`isIncident`) is `incidentCard` now — a
	 * real rollout `Result` rendered through `resultRow`, the same row
	 * "Needs you" already draws. `RolloutAction` is back to one shape, no
	 * exceptions: every row in this list is a plain "go here" / "do this."
	 */
	type RolloutAction = {
		id: string;
		label: string;
		icon: typeof ObjectsColumnOutline;
		onSelect: () => void;
		commandLabel: 'Go to' | 'Command';
	};

	async function copyBuildSha(sha: string) {
		open = false;
		let ok = false;
		try {
			await navigator.clipboard.writeText(sha);
			ok = true;
		} catch {
			// ⭐ ROUND 5, ITEM (AD, 2026-10-10): "restore focus after copy."
			// `open = false` above already asks `modalFocusReturn` to put focus
			// back on whatever opened the palette — but `ta.select()` NEEDS the
			// textarea focused for `execCommand('copy')` to have anything to
			// copy, and removing a focused node drops focus to `<body>` with
			// nothing left to restore it, undoing that work a moment later on
			// exactly this (clipboard-blocked) fallback path. Capture whatever
			// is focused right before this hijacks it — on the happy timing
			// that is already the restored trigger; if this runs before
			// `modalFocusReturn`'s own effect has flushed, it is whatever was
			// focused inside the (now-closing) palette instead, which is still
			// a real, visible element to land back on, never `<body>`.
			const beforeFallback = document.activeElement as HTMLElement | null;
			try {
				const ta = document.createElement('textarea');
				ta.value = sha;
				ta.setAttribute('readonly', '');
				ta.style.position = 'fixed';
				ta.style.top = '-1000px';
				document.body.appendChild(ta);
				ta.select();
				ok = document.execCommand('copy');
				document.body.removeChild(ta);
			} catch {
				ok = false;
			} finally {
				// ⭐ ROUND 6 (AD review 4, 2026-10-10): `preventScroll` — the
				// temp textarea was `position: fixed; top: -1000px`, and a
				// plain `.focus()` on the element that follows it can still
				// ask the viewport to scroll to wherever ITS OWN layout sits,
				// a jump the reader never asked for on what is, to them, a
				// silent clipboard retry.
				if (beforeFallback && beforeFallback !== document.body && beforeFallback.isConnected) {
					beforeFallback.focus({ preventScroll: true });
				}
			}
		}
		// `label` names WHAT was (not) copied, same shape `CopyButton.svelte`'s
		// own `label` prop takes ("version 0afab6f") — so the failure sentence
		// below is BYTE-IDENTICAL, post-interpolation, to CopyButton's own
		// already-allow-listed line in vocabulary.test.ts, rather than a
		// second near-duplicate that test would need a second entry for.
		const label = `build ${sha}`;
		announce(
			ok
				? `Copied ${label} to the clipboard`
				: `Could not copy ${label}. The browser blocked clipboard access — select the text and copy it manually.`,
			ok ? 'polite' : 'assertive'
		);
		// ⭐ ROUND 3, ITEM 2: the VISIBLE confirmation, title only — "Copied
		// d09e6f4", the coordinator's own wording, no description (there is
		// nothing to add: the title already names the one fact).
		if (ok) {
			copyToastMessage = `Copied ${sha}`;
			copyToastOpen = true;
			setTimeout(() => (copyToastOpen = false), 3000);
		}
	}

	const currentRolloutCard = $derived.by<RolloutCard | undefined>(() => {
		if (!currentNamespace || !currentName) return undefined;
		return cards.find((c) => c.ns === currentNamespace && c.name === currentName);
	});

	/**
	 * ⭐ ROUND 2, ITEM 1 (squad-rollout coordinator, 2026-10-09): "lists 'Go to
	 * Overview' while you are ON the Overview." A tab that goes to the page
	 * already open is not an action, it is a no-op with a label — `/rollouts`'
	 * own tab strip never draws a link to its own active tab either. Reads
	 * `page.url.pathname` (the same source `Navbar.svelte`'s `isRolloutPage`/
	 * `isActive` already read for the identical "which tab is this" question)
	 * through `appPath`, its own documented inverse of the base path, so a
	 * deployed subpath never throws this off.
	 */
	const currentTab = $derived.by<'overview' | 'history' | 'gates' | 'logs' | null>(() => {
		if (!currentRolloutCard) return null;
		const p = appPath(page.url.pathname);
		// `rolloutPath` always embeds a cluster segment; this file doesn't
		// know which one owns the CURRENT URL (multi-cluster hub), so the
		// tab is read off the trailing path shape instead of a full prefix
		// match — `.../<ns>/<name>(/history|/gates|/logs)?` — which is stable
		// across clusters and matches `+layout.svelte`'s own `isActive`.
		const m = p.match(/^\/rollouts\/[^/]+\/[^/]+\/[^/]+(?:\/([a-z]+))?\/?$/);
		if (!m) return null;
		const sub = m[1];
		if (!sub) return 'overview';
		if (sub === 'history' || sub === 'diff') return 'history';
		if (sub === 'gates') return 'gates';
		if (sub === 'logs') return 'logs';
		return null;
	});

	/**
	 * ⭐ ROUND 5 (AD review 3 + coordinator, 2026-10-10): "one blocked-row
	 * look everywhere… build your row with the same anatomy as Needs-you
	 * (StatusMark · name · env chip · fact · build · age) and the SAME
	 * StatusMark." Round 4's incident row was a bespoke sentence behind a
	 * hand-picked icon; it is `BlockedRow` now — home-v2's shared component
	 * (design-rollout 6cb1889), the SAME one `attention` below draws and
	 * `NeedsYouCard` draws on Home/`/apps`, `size="palette"`. `goRolloutSub`
	 * is shared with `thisRolloutActions` so both read one scope/cluster
	 * rule for "where does this rollout's own link go."
	 */
	function goRolloutSub(c: RolloutCard, sub?: string) {
		open = false;
		const cluster = c.sourceCluster || localClusterName;
		goto(sub ? rolloutPath(cluster, c.ns, c.name, sub) : rolloutPath(cluster, c.ns, c.name));
	}

	/** The one rollout `goRolloutSub`'s "Logs, or Overview if already there"
	 *  rule points the incident row at. */
	/**
	 * ⭐ PALROW r7 (AD r6, item 3): ONE BLOCKED ROW, ONE ACTION, EVERYWHERE.
	 * A rollout that needs a person draws the same `blockedOption` row in
	 * "This rollout", in "Needs you" and in search results, and every one
	 * carries the same trailing action, which is also what ↵ and a click do:
	 *   failed  → Open logs   (what broke, and where to look)
	 *   stuck   → See what's blocking (Gates tab; NextStep's `unblock`),
	 *             else Open overview
	 *   held by approval → Review (NextStep's `approve`, navigate reading):
	 *             the Gates tab, where the approval is decided. NOT the
	 *             change-version confirm: there is no approval endpoint, and
	 *             `/change-version` would bypass the very gate the row is
	 *             about (squad-rollout correction, 2026-10-11). The row's env
	 *             chip names the env, its held sentence names the gate.
	 * A target that IS the tab already open falls back to Overview, so the
	 * row never offers a no-op ("Open logs" while on Logs).
	 */
	type BlockedAction = { label: string; sub: string | undefined };
	function blockedAction(c: RolloutCard): BlockedAction {
		const approval = approvalCards.has(c);
		const kind = blockedKindOf(c);
		const wanted: 'logs' | 'gates' | undefined =
			kind === 'failed' ? 'logs' : approval || hasGatesTab(c) ? 'gates' : undefined;
		if (approval && !(c === currentRolloutCard && currentTab === 'gates')) {
			// The label is whatever NextStep's table says for a review that
			// navigates (with the env, so the table can name it when it does).
			return { label: stepLabel('approve', { navigate: true, env: c.envDisplay || null }), sub: 'gates' };
		}
		const isHere = c === currentRolloutCard && currentTab === wanted;
		if (!wanted || isHere) return { label: 'Open overview', sub: undefined };
		// §3.19: a hold's label comes from NextStep's table, never a string
		// here. Going to the Gates tab to read what holds it is `unblock`
		// ("See what's blocking"). A failed row's "Open logs" is a
		// destination, not a NextStep act (tl-integrate, 2026-10-10).
		return { label: wanted === 'logs' ? 'Open logs' : stepLabel('unblock'), sub: wanted };
	}
	function blockedHref(c: RolloutCard): string {
		const cluster = c.sourceCluster || localClusterName;
		return rolloutPath(cluster, c.ns, c.name, blockedAction(c).sub);
	}
	/** Search results: the RolloutCard behind a rollout result, when that
	 *  rollout needs a person, so the row renders as `blockedOption`. */
	const cardsByResultKey = $derived(
		new Map(cards.map((c) => [`rollout:${c.sourceCluster}|${c.ns}/${c.name}`, c]))
	);
	function blockedCardFor(r: Result): RolloutCard | null {
		if (r.kind !== 'rollout') return null;
		const c = cardsByResultKey.get(r.key);
		return c && needsPerson(c) ? c : null;
	}
	/** THE ONE THING A BLOCKED ROW DOES, for ↵ and a search pick: go to its
	 *  action's tab (a click follows the row's own link, same href). */
	function runBlocked(c: RolloutCard) {
		goRolloutSub(c, blockedAction(c).sub);
	}
	/**
	 * ⭐ PALROW r7 (AD r6 nit): ONE IDENTITY PER ENV NAME. A rollout with no
	 * Environment record (payments-svc) labels its chip with its cluster
	 * name; it borrows the theme of any rollout whose env chip already
	 * prints that same name, so "prod" is one tint on every row. Only
	 * when no rollout carries that name does the chip stay neutral.
	 */
	const themeByEnvLabel = $derived.by(() => {
		const m = new Map<string, NonNullable<RolloutCard['theme']>>();
		for (const c of cards) if (c.theme && c.envDisplay && !m.has(c.envDisplay)) m.set(c.envDisplay, c.theme);
		return m;
	});

	const incidentCard = $derived.by<RolloutCard | null>(() => {
		const c = currentRolloutCard;
		// While Needs you leads, the current rollout's row lives there instead.
		return c && needsPerson(c) && !needsYouLeads ? c : null;
	});

	const thisRolloutActions = $derived.by<RolloutAction[]>(() => {
		const c = currentRolloutCard;
		if (!c) return [];
		const go = (sub?: string) => goRolloutSub(c, sub);
		const actions: RolloutAction[] = [];
		/**
		 * ⭐ ROUND 5, ITEM (AD, 2026-10-10): "'Go to' is said twice." The
		 * `commandLabel: 'Go to'` column on the right already names the verb
		 * (`resultRow`'s `w-16` slot) — these labels used to spell it again
		 * at the front (`'Go to Overview'`), so a row read "Go to Overview
		 * … Go to". The label is just the destination now; the verb lives
		 * in the one column that states it.
		 */
		if (currentTab !== 'overview') {
			actions.push({
				id: 'overview',
				label: 'Overview',
				icon: ObjectsColumnOutline,
				onSelect: () => go(),
				commandLabel: 'Go to'
			});
		}
		if (currentTab !== 'history') {
			actions.push({
				id: 'history',
				label: 'History',
				icon: ClockArrowOutline,
				onSelect: () => go('history'),
				commandLabel: 'Go to'
			});
		}
		if (hasGatesTab(c) && currentTab !== 'gates') {
			actions.push({
				id: 'gates',
				label: 'Gates',
				icon: ShareNodesOutline,
				onSelect: () => go('gates'),
				commandLabel: 'Go to'
			});
		}
		if (currentTab !== 'logs') {
			actions.push({
				id: 'logs',
				label: 'Logs',
				icon: TerminalOutline,
				onSelect: () => go('logs'),
				commandLabel: 'Go to'
			});
		}
		/**
		 * ⭐ ROUND 3, ITEM 1 (AD, 2026-10-09): "Add 'Change version…' (the
		 * page's main verb)." The Overview honours `?action=change-version`
		 * (its own `$effect`, coordinator-approved one-file exception) and
		 * opens the SAME modal every on-page trigger does.
		 * ⭐ ROUND 6 (AD review 4 + coordinator, 2026-10-10): "must open ON
		 * History" too, when that is the current tab — History grew the
		 * identical `$effect` (round 6, its own file). Gates/Logs have no
		 * modal of their own, so those two still fall back to Overview — the
		 * one place the modal always exists.
		 */
		actions.push({
			id: 'change-version',
			label: 'Change version…',
			icon: EditOutline,
			onSelect: () => {
				open = false;
				const cluster = c.sourceCluster || localClusterName;
				const sub = currentTab === 'history' ? 'history' : undefined;
				goto(`${rolloutPath(cluster, c.ns, c.name, sub)}?action=change-version`);
			},
			commandLabel: 'Command'
		});
		if (c.version) {
			actions.push({
				id: 'copy-sha',
				label: 'Copy build sha',
				icon: ClipboardOutline,
				onSelect: () => copyBuildSha(c.version!),
				commandLabel: 'Command'
			});
		}
		return actions;
	});

	/**
	 * The "This rollout" block's own flat size — `incidentCard` (0 or 1)
	 * PLUS `thisRolloutActions` — every index-math site below used to read
	 * `thisRolloutActions.length` alone; now that the incident row is a
	 * separate `Result`, not the first `RolloutAction`, this is the one
	 * place that states the block's total so Enter/Tab/arrow math and the
	 * template's own `data-idx`s cannot disagree about where it ends.
	 */
	const thisRolloutCount = $derived((incidentCard ? 1 : 0) + thisRolloutActions.length);
	/** Where each opening-screen section starts in the flat index space. */
	const thisStart = $derived(needsYouLeads ? attentionShown.length : 0);
	const attnStart = $derived(needsYouLeads ? 0 : thisRolloutCount);

	// Scoring: substring on title is best, then on subtitle/version/env, etc.
	// Tied scores fall back to entity-kind priority so users see rollouts first.
	// ⭐ `change` = 1.5 (CHANGES-2026-09-10.md, "THE PALETTE") — BELOW
	// `rollout`/`app`/`env`, ABOVE `namespace`. This is the ONLY thing that
	// changed from the retired `pr: 5` entry: a title match used to outrank
	// every rollout on the page by fiat; now it is a normal kind whose
	// tiebreak sits at the bottom of the "fleet object" tier, same mechanism
	// every other kind here already uses.
	// ⭐ ROUND 3, ITEM 1: `action` IS HIGHEST NOW, NOT LOWEST. Raycast's own
	// model (and the AD's explicit ruling) is a FIXED group order — Commands
	// above every object kind, whenever the group has a match — not a single
	// sea of rows sorted purely by match score. `grouped` (below) sorts its
	// groups by this priority, descending; this is the one knob that does it.
	const KIND_PRIORITY: Record<ResultKind, number> = {
		action: 5,
		rollout: 4,
		build: 3.5,
		app: 3,
		env: 2,
		change: 1.5,
		namespace: 1
	};
	function stateWordsOf(r: Result): string {
		const c = blockedCardFor(r);
		if (!c) return '';
		const approval = approvalCards.has(c);
		const kind = blockedKindOf(c, approval);
		return [approval ? 'approval approve waits for approval waiting' : '', kind === 'failed' ? 'failed failing failure' : '', blockedAction(c).label].join(' ');
	}
	function score(r: Result, q: string): number {
		if (!q) return KIND_PRIORITY[r.kind];
		if (r.kind === 'build') {
			// Sha-prefix (≥7 hex chars) and label matching both run against
			// the full revision / label set, never the generic substring
			// haystack below — see `palette-index.ts`'s `scoreBuildEntry`,
			// which this calls directly so the row and its own unit tests
			// cannot disagree about what matched.
			return scoreBuildEntry({ revision: r.revisionFull ?? '', labels: r.labels ?? [] }, q);
		}
		// A ref-shaped query (URL / `#n` / `owner/repo#n` / a bare sha) is
		// handled ENTIRELY by `changeRefResults` above — a title match here
		// too would risk a second, differently-worded row for the identical
		// change. Free text (the normal case) is not ref-shaped and falls
		// through to the generic scorer below, same as every other kind.
		if (r.kind === 'change' && parseChangeRef(q)) return -1;
		const lower = q.toLowerCase();
		const hay = [
			r.title,
			r.pretty ?? '',
			r.subtitle ?? '',
			r.version ?? '',
			r.envTheme?.label ?? '',
			r.envTheme?.environmentName ?? '',
			// THE STATE IS SEARCHABLE NOW. `stuck`, `pinned`, `rolled back`,
			// `19 behind`, `checking` — the words the row already prints. A
			// reader who can see a word and cannot type it is being asked to
			// remember which page lists it.
			r.verdict?.label ?? '',
			r.stuck ? 'stuck' : '',
			r.bakeStatus ? bakeWord(r.bakeStatus) : '',
			// QA C7: the state words a row PRINTS ("waits for your approval", "failed", the action label) are searchable too
			stateWordsOf(r)
		]
			.join(' ')
			.toLowerCase();
		if (!fieldMatch(hay, lower)) return -1;
		let s = 0;
		const titleLower = r.title.toLowerCase();
		if (titleLower === lower) s += 100;
		else if (titleLower.startsWith(lower)) s += 60;
		else s += 30 * fieldMatch(titleLower, lower);
		// multi-word: a row whose TITLE holds more of the words ranks above one that matched them only through its subtitle (QA #24)
		const words = lower.split(/\s+/).filter(Boolean);
		if (words.length > 1) s += 6 * words.filter((w) => titleLower.includes(w)).length;
		s += 12 * fieldMatch((r.pretty ?? '').toLowerCase(), lower);
		s += 10 * fieldMatch((r.subtitle ?? '').toLowerCase(), lower);
		s += 8 * fieldMatch((r.version ?? '').toLowerCase(), lower);
		s += 8 * fieldMatch((r.envTheme?.label ?? '').toLowerCase(), lower);
		s += KIND_PRIORITY[r.kind] * 0.5;
		return s;
	}

	/**
	 * ⭐ THE LONG TAIL IS CAPPED, NOT THE WHOLE KIND. `buildMergedChangeIndex`
	 * hands every merged pull to `allResults`; capping happens HERE, after
	 * scoring/sorting, so the three shown are always the three BEST matches
	 * — never an arbitrary first-three-by-insertion-order.
	 */
	const CHANGE_TITLE_CAP = 3;
	function capKind(results: Result[], kind: ResultKind, cap: number): Result[] {
		let count = 0;
		return results.filter((r) => {
			if (r.kind !== kind) return true;
			count += 1;
			return count <= cap;
		});
	}

	const filtered = $derived.by(() => {
		const q = query.trim();
		const scoped = scope ? allResults.filter((r) => r.kind === scope) : allResults;
		const scored = scoped.map((r) => ({ r, s: score(r, q) })).filter((x) => x.s >= 0);
		scored.sort((a, b) => {
			if (b.s !== a.s) return b.s - a.s;
			// WORST FIRST WITHIN A TIE. Two rollouts of one app score the same
			// on the app's name, and the one that is failing is the one being
			// looked for.
			const sev = (b.r.severity ?? 0) - (a.r.severity ?? 0);
			if (sev !== 0) return sev;
			return a.r.title.localeCompare(b.r.title);
		});
		const ranked = capKind(scored.slice(0, 200).map((x) => x.r), 'change', CHANGE_TITLE_CAP);
		// Reference rows ride ABOVE everything else, ungrouped, and only in
		// the unscoped default search — there is no `change` picker tile to
		// scope INTO (the fifth Browse tile navigates instead, see
		// `openYourChanges` below), so a non-null `scope` is always one of
		// the other kinds asking for its own objects only.
		return !scope && changeRefResults.length > 0 ? [...changeRefResults, ...ranked] : ranked;
	});

	// Group filtered results by kind for rendering. Keeps a flat index for kb nav.
	type Group = { kind: ResultKind; label: string; items: { result: Result; idx: number }[] };
	const KIND_LABEL: Record<ResultKind, string> = {
		rollout: 'Rollouts',
		build: 'Builds',
		app: 'Apps',
		env: 'Environments',
		change: 'Changes',
		namespace: 'Namespaces',
		action: 'Commands'
	};
	const KIND_SINGULAR: Record<ResultKind, string> = {
		rollout: 'rollout',
		build: 'build',
		app: 'app',
		env: 'environment',
		change: 'change',
		namespace: 'namespace',
		action: 'page'
	};
	const grouped = $derived.by<Group[]>(() => {
		const map = new Map<ResultKind, Group>();
		filtered.forEach((result, idx) => {
			// Ref rows (`Open change #4 · repo`) are rendered separately, above
			// every group header — see the template — so they never form a
			// "Changes" group of their own. This is the fix for the measured
			// defect: a `PULL REQUESTS` group used to render here, above every
			// rollout, for exactly these rows.
			if (result.ungrouped) return;
			let g = map.get(result.kind);
			if (!g) {
				g = { kind: result.kind, label: KIND_LABEL[result.kind], items: [] };
				map.set(result.kind, g);
			}
			g.items.push({ result, idx });
		});
		// Stable group order by kind priority
		return Array.from(map.values()).sort((a, b) => KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind]);
	});

	/**
	 * ⛔ P8 — THE PALETTE OPENED UNFOCUSED AT 390, AND ESCAPE FORGOT ITS
	 * TRIGGER. (2026-09-03, operator walk)
	 *
	 * > *"The command palette opens unfocused at 390 (activeElement === BODY;
	 * > typing goes nowhere) while at 768/1440 the input is focused. Same in
	 * > the app switcher and rollout switcher."*
	 *
	 * Two bugs stacked. First, an explicit `isTouch` check SKIPPED the focus
	 * call on any coarse pointer — every phone, on purpose, forever. Second,
	 * the whole body ran inside `(async () => { … await tick(); … })()`, so
	 * even on desktop the `.focus()` call landed a microtask after the click
	 * or keydown that opened the dialog. iOS Safari only keeps a `.focus()`
	 * call inside the gesture that grants it permission to raise the
	 * keyboard when nothing async separates them — an `await` is enough to
	 * lose it. `$effect` already runs AFTER the DOM has been patched for the
	 * state change that triggered it (the input this dialog renders is
	 * already mounted and `bind:this` has already run), so neither the
	 * `async` wrapper nor `tick()` were ever buying correctness, only delay.
	 */
	$effect(() => {
		if (!open) return;
		untrack(() => {
			query = '';
			selectedIndex = 0;
			// ⭐ PRESELECT THE OBJECT WE'RE ALREADY ON. Opening the app switcher
			// from `/apps/hello-world-app` used to land on row 0 — whichever
			// app happened to be inserted first — so Enter navigated the
			// reader OFF the app they were looking at. `currentName` (and, for
			// a rollout, `currentNamespace` too) is the same route param the
			// breadcrumb itself reads, so this can't drift from what page
			// you're actually on.
			const s = scope;
			if (s) {
				const idx = filtered.findIndex((r) => isCurrentResult(r, s));
				if (idx >= 0) selectedIndex = idx;
			}
			searchInput?.focus();
			scrollSelectedIntoView();
		});
	});

	/** Does this result name the object the reader is currently looking at? */
	function isCurrentResult(r: Result, s: ResultKind): boolean {
		if (s === 'rollout') return !!r.isCurrent;
		if (!currentName) return false;
		if (s === 'app') return r.key === `app:${currentName}`;
		if (s === 'env') return r.key === `env:${currentName}`;
		if (s === 'namespace') return r.key === `ns:${currentName}`;
		return false;
	}

	function scrollSelectedIntoView() {
		requestAnimationFrame(() => {
			const el = listEl?.querySelector(`[data-idx="${selectedIndex}"]`);
			el?.scrollIntoView({ block: 'nearest' });
		});
	}

	function pick(r: Result) {
		open = false;
		const bc = blockedCardFor(r);
		if (bc) {
			runBlocked(bc);
			return;
		}
		if (r.onSelect) {
			r.onSelect();
			return;
		}
		goto(r.href);
	}

	/**
	 * THE FIFTH BROWSE TILE, "Your changes" — it NAVIGATES rather than
	 * scoping (CHANGES-2026-09-10.md, "THE PALETTE", item 3): there is no
	 * client-side index of changes to scope into the way `rollout`/`app`/
	 * `env`/`namespace` have one, so pressing it goes straight to
	 * `/changes?mine` instead of narrowing the picker.
	 */
	function openYourChanges() {
		open = false;
		goto(href('/changes?mine'));
	}

	function onInput(e: Event) {
		query = (e.currentTarget as HTMLInputElement).value;
		selectedIndex = 0;
	}

	/**
	 * THE DEFAULT SCREEN IS ONE FLAT INDEX SPACE, in the order it renders:
	 * `thisRolloutActions` (rollout pages only), then the attention rows,
	 * then the Jump to rows — five that SCOPE (`rollout`/`app`/`env`/
	 * `namespace`/`build`) plus one, "Your changes", that NAVIGATES straight
	 * to `/changes?mine` instead (`openYourChanges`, above — there is no
	 * client-side change index to scope into). `Enter` opens a row, drills
	 * into a kind, or navigates, depending on which slot the cursor is in —
	 * the reader never has to know there are three kinds of thing here, only
	 * that down-arrow and Enter work.
	 *
	 * ⛔ FIX PASS ITEM 13, 2026-09-11 — `build` JOINS THE PICKER, MAKING SIX.
	 * The `sm:grid-cols-2` Browse grid held five tiles (four scoping + "Your
	 * changes"), so the last row was one tile beside an empty 326px cell —
	 * a live fleet's own screenshot of the fifth tile alone in its row. Six
	 * fills the grid evenly. `build` was already a full `ResultKind` (its
	 * own `KIND_LABEL`/`KIND_SINGULAR`/`KIND_ICON`, its own scored results
	 * via `buildPaletteBuildIndex`, its own `kindCounts` entry) with no
	 * Browse tile of its own — adding it here is turning on a slot the type
	 * already had, not inventing a new category to pad the grid.
	 */
	const PICKER_KINDS: ResultKind[] = ['rollout', 'app', 'env', 'namespace', 'build'];
	/** The picker tiles, scoping ones plus the one navigating tile. */
	const BROWSE_TILE_COUNT = PICKER_KINDS.length + 1;
	const inPicker = $derived(!scope && !query);

	/**
	 * ⭐ LANE P, §5: THE OPENING SCREEN'S FLAT INDEX SPACE NOW HAS THREE
	 * SECTIONS, NOT TWO, in the order the template renders them —
	 * `thisRolloutActions` ("This rollout", rollout pages only), then
	 * `attentionShown` ("Needs you"), then the `PICKER_KINDS` + "Your
	 * changes" rows ("Jump to"). `jumpToIndex(idx)` is the one place that
	 * maps a flat `selectedIndex` back to "which Jump to row is this, if
	 * any" — Enter and Tab both call through it so they cannot disagree
	 * about where the Jump to section starts (the sum it subtracts is the
	 * same regardless of which of the other two sections comes first).
	 */
	function jumpToIndex(idx: number): number {
		return idx - attentionShown.length - thisRolloutCount;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		const maxIdx = inPicker
			? attentionShown.length + thisRolloutCount + BROWSE_TILE_COUNT - 1
			: filtered.length - 1;
		if (e.key === 'Escape') {
			e.preventDefault();
			// First ESC clears the scope (back to picker); second ESC closes.
			if (scope) {
				scope = null;
				query = '';
				selectedIndex = 0;
			} else {
				open = false;
			}
		} else if (e.key === 'Backspace' && query === '' && scope) {
			e.preventDefault();
			scope = null;
			selectedIndex = 0;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, maxIdx);
			scrollSelectedIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			scrollSelectedIntoView();
		} else if (e.key === 'Tab' && inPicker) {
			// ⭐ LANE P, §5: "the scope action on Tab (existing scoping)" — the
			// Jump to row the cursor sits on scopes in, same destination Enter
			// already reaches on that row, just a second way there (Linear's
			// own convention: Tab narrows, Enter opens). Never fires on
			// "Needs you"/"This rollout" rows, or on "Your changes" (it
			// navigates, nothing to scope into) — the browser's normal Tab
			// (move focus) applies there.
			const jumpIdx = jumpToIndex(selectedIndex);
			const k = jumpIdx >= 0 && jumpIdx < PICKER_KINDS.length ? PICKER_KINDS[jumpIdx] : null;
			if (k) {
				e.preventDefault();
				scope = k;
				selectedIndex = 0;
				searchInput?.focus();
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (inPicker) {
				// Flat order matches the template's visual order top to
				// bottom: This rollout (incident row first, if any), then
				// Needs you, then Jump to.
				const thisIdx = selectedIndex - thisStart;
				if (thisIdx >= 0 && thisIdx < thisRolloutCount) {
					if (incidentCard && thisIdx === 0) {
						runBlocked(incidentCard);
						return;
					}
					thisRolloutActions[incidentCard ? thisIdx - 1 : thisIdx]?.onSelect();
					return;
				}
				const attnIdx = selectedIndex - attnStart;
				if (attnIdx >= 0 && attnIdx < attentionShown.length) {
					const c = attentionShown[attnIdx];
					if (c) runBlocked(c);
					return;
				}
				const jumpIdx = jumpToIndex(selectedIndex);
				if (jumpIdx === PICKER_KINDS.length) {
					openYourChanges();
					return;
				}
				const k = PICKER_KINDS[jumpIdx];
				if (k) {
					scope = k;
					selectedIndex = 0;
					searchInput?.focus();
				}
			} else {
				const r = filtered[selectedIndex];
				if (r) pick(r);
			}
		}
	}

	/**
	 * ⭐ PALROW (AD round 5): THE LIST ENDS ON A WHOLE ROW. The list's CSS
	 * cap (`36rem`, or what the viewport leaves under the 12vh offset) is
	 * a number that knows nothing about 40px rows and 28px headers, so the
	 * incident opening state used to end 4px into a row. This trims the
	 * cap to the bottom of the last option that fits whole (plus the
	 * list's own 8px padding), at every width (PALROW r7, AD r6 item 1:
	 * the phone sheet too; its footer is `mt-auto`, so it stays docked to
	 * the bottom edge). Only OPTIONS count as "the last whole thing", so a
	 * group header can never be the last visible element: the cut lands at
	 * the bottom of the row before it. Re-measures whenever `key` (what is
	 * shown) changes.
	 */
	function snapToRows(node: HTMLElement, key: string) {
		let frame = 0;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				node.style.maxHeight = '';
				if (node.scrollHeight <= node.clientHeight + 1) return;
				const top = node.getBoundingClientRect().top - node.scrollTop;
				const limit = node.clientHeight - 8;
				let fit = 0;
				for (const o of node.querySelectorAll<HTMLElement>('[role="option"]')) {
					const r = o.getBoundingClientRect();
					const bottom = r.bottom - top;
					if (bottom <= limit + 0.5) fit = Math.max(fit, bottom);
				}
				if (fit > 0) node.style.maxHeight = `${Math.round(fit + 8)}px`;
			});
		};
		measure();
		window.addEventListener('resize', measure);
		return {
			update(_k: string) {
				measure();
			},
			destroy() {
				cancelAnimationFrame(frame);
				window.removeEventListener('resize', measure);
			}
		};
	}

	const KIND_ICON: Record<ResultKind, typeof GridOutline> = {
		change: CodePullRequestOutline,
		rollout: GridOutline,
		build: TagOutline,
		app: RocketOutline,
		env: LayersSolid,
		namespace: FolderOutline,
		action: ClockOutline
	};
</script>

<svelte:window onkeydown={handleKeydown} />

<!--
	⭐ ROUND 3, ITEM 6 (AD, 2026-10-09): ONE GROUP HEADER, NOT FOUR OBJECTS.
	"THIS ROLLOUT: x404, 28px, sticky. JUMP TO: x400 (4px off), 36px, no
	rule. ROLLOUTS/APPS in results: x404, not sticky. The hairline stops
	~90px short of the count." One snippet now, used everywhere a group of
	rows needs a label: `px-3` (matches every row's own `px-3`, so the
	label sits at the row content's own x, not 4px off it), `pb-1 pt-2` +
	`t-label`'s 16px line-height = 28px total, `sticky top-0 z-10 bg-
	overlay` in every state (search results included — it had none), and a
	SOLID full-width rule (`bg-line`, not a gradient that fades out before
	reaching the count) when a count is passed, no rule when it is not
	("Jump to" has no aggregate to show).
-->
<!-- ⭐ ROUND 4, ITEM C (AD, 2026-10-10): "one header shape, including THIS
     ROLLOUT and JUMP TO" — the rule is unconditional now (it used to only
     draw when a count followed it, so the two count-less groups had no
     rule at all, a third shape). `count === null` only suppresses the
     NUMBER, never the line beside the label. -->
{#snippet groupHeader(label: string, count: number | null = null)}
	<div class="sticky top-0 z-10 flex items-center gap-2 bg-overlay px-3 pb-1 pt-2" role="presentation">
		<span class="t-label shrink-0 text-fg-subtle">{label}</span>
		<span class="h-px flex-1 bg-line"></span>
		{#if count !== null}
			<!-- THE TRUE TOTAL, NOT THE DRAWN COUNT, where a cap hides rows. -->
			<span class="t-code-sm tabular-nums text-fg-subtle">{count}</span>
		{/if}
	</div>
{/snippet}

<!--
	⭐ ROUND 5 (AD review 3 + coordinator, 2026-10-10): `BlockedRow` (home-v2's
	shared component, design-rollout 6cb1889) draws a real `<a href>`, not
	this file's own `role="option"` combobox row — it was built for
	`NeedsYouCard`'s plain list, which has no roving `selectedIndex` to sync.
	This wrapper is the thin adapter: it owns the combobox contract (the
	`data-idx`/`aria-selected`/`onmouseenter` arrow-key machinery every other
	row here has), `BlockedRow` owns the anatomy. Enter is handled centrally
	in `handleKeydown` (same as every other picker row); a mouse click just
	follows the `<a>` `BlockedRow` already renders, same as any other link.
-->
{#snippet blockedOption(c: RolloutCard, idx: number)}
	{@const isActive = idx === selectedIndex}
	{@const actionLabel = blockedAction(c).label}
	{@const rowHref = blockedHref(c)}
	<!-- ⭐ ROUND 6 (AD review 4): the incident row's destination (Logs, or
	     Overview if already there) is not what its own link text says (the
	     rollout's name), so `aria-label` on THIS wrapper (the thing
	     `aria-activedescendant` names) states it.
	     ⭐ PALROW (AD round 5, item 2): and it is now ON SCREEN too. The
	     action rides `BlockedRow`'s `trailing` slot (tl-integrate 1fca100):
	     the right edge of the single line from `sm`, the end of line 2 on a
	     phone. `↵` joins it while the row is selected, the same "this runs"
	     key every command row shows (see `runKey`).
	     ⭐ PALROW r7: every blocked row gets its action (`blockedAction`),
	     wherever it is listed, so they all end at the same right edge. -->
	<div
		role="option"
		id={`cp-opt-${idx}`}
		aria-selected={isActive}
		aria-label={`${c.name}${c.envDisplay ? ` · ${c.envDisplay}` : ''} — ${actionLabel}${approvalGateLabel(c) ? ` ${approvalGateLabel(c)}` : ''}`}
		data-idx={idx}
		tabindex="-1"
		onmouseenter={() => (selectedIndex = idx)}
		class="rounded-sm {isActive ? 'bg-selected' : ''}"
	>
		{#snippet incidentAction()}
			<span class="flex items-center gap-2" data-meta="action">
				{@render runKey(isActive)}
				<span class="t-ui-sm whitespace-nowrap text-fg">{actionLabel}</span>
			</span>
		{/snippet}
		<BlockedRow
			card={c}
			kind={rowKind(c)}
			approval={approvalCards.has(c)}
			story={approvalStories.get(c) ?? null}
			href={rowHref}
			size="palette"
			wrap
			trailing={incidentAction}
		/>
	</div>
{/snippet}

<!-- The "↵ runs this" key on a row that DOES something (a command, a
     blocked row's action). ⭐ PALROW r7 (AD r6, item 5): drawn only on the
     selected row and LEFT of the label, so the label is the last thing on
     every row and ends at the one right edge (x=1036 at 1440); the key
     appearing never moves it. Object rows (a rollout, an app) don't carry
     it: opening is the footer's "↵ open", said once. Hidden below sm,
     where there is no Enter key to name. -->
{#snippet runKey(isActive: boolean)}
	{#if isActive}<kbd class="kbd hidden sm:inline-flex" aria-hidden="true">↵</kbd>{/if}
{/snippet}

<!--
	⭐ PALROW r7 (AD r6, item 4): A CHANGE ROW IS TWO LINES ON A PHONE.
	A change's title is a sentence; at 390 one line forced it to give up
	characters so the "#N · repo" beside it could stay whole. Below the
	list's `@lg` container width (32rem) the row stacks like BlockedRow's
	own wrap form: line 1 the WHOLE title, line 2 the staircase · state ·
	#N · repo. From `@lg` it is the one 40px line of the shared grammar:
	title, then the same items as one right-aligned meta group ending at
	the row's right edge (x=1036 at 1440). Line 2 wraps whole items
	(`flex-wrap`) rather than cutting any of them.
-->
{#snippet changeRow(r: Result, idx: number)}
	{@const isActive = idx === selectedIndex}
	{@const changeMeta = changeResultMeta(r)}
	{@const changeSteps = changeMeta ? familyProgress(changeMeta) : null}
	{@const changeRef =
		r.changeRef && r.repo && !r.ungrouped
			? `${r.changeRef.kind === 'pull' ? `#${r.changeRef.number}` : shortRevision(r.changeRef.sha)} · ${r.repo}`
			: null}
	<button
		type="button"
		role="option"
		id={`cp-opt-${idx}`}
		aria-selected={isActive}
		data-idx={idx}
		data-kind="change"
		class="flex min-h-10 w-full items-start gap-3 overflow-hidden rounded-sm px-3 py-2 text-left transition-colors @lg:h-10 @lg:items-center @lg:py-0 {isActive
			? 'bg-selected'
			: 'hover:bg-hover'}"
		onclick={() => pick(r)}
		onmouseenter={() => (selectedIndex = idx)}
	>
		<!-- The viewer's own face (`buildMergedChangeIndex` only indexes the
		     viewer's merged pulls), the same photo the sidebar draws; centred
		     on line 1 (2px down a 20px line) on a phone. -->
		<span class="mt-0.5 flex shrink-0 @lg:mt-0">
			<Avatar
				name={changeMeta?.author ?? githubStatusQuery.data?.login ?? 'You'}
				src={githubStatusQuery.data?.avatarUrl ?? null}
				size={16}
			/>
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-0.5 @lg:flex-row @lg:items-center @lg:gap-3">
			<span class="t-ui min-w-0 text-fg @lg:shrink @lg:truncate" data-slot="name">{r.title}</span>
			{#if (changeMeta && changeSteps) || changeRef}
				<span
					class="t-meta flex flex-wrap items-center gap-x-4 overflow-hidden text-fg-subtle @lg:ms-auto @lg:shrink-0 @lg:flex-nowrap @lg:whitespace-nowrap"
					data-meta="change"
				>
					{#if changeMeta && changeSteps}
						<!-- The staircase and the verdict words: ChangeLine's own
						     view-model, so this row cannot disagree with /changes.
						     One unit (8px apart inside); the 16px gap between units
						     is the "·" slot below. -->
						<span class="flex items-center gap-x-2">
						<span
							class="flex items-center gap-1"
							role="img"
							aria-label={familyMeterAriaLabel(changeSteps)}
						>
							{#each changeSteps as step (step.family)}
								<!-- the strip's own mark (WaveMark, one shared state-tone table), so this row draws the same dot or pie as the page it opens -->
								<span class="inline-flex" title="{step.family}: {step.sentence}" aria-hidden="true">
									<WaveMark mark={waveMark(familySites(step), step.family)} />
								</span>
							{/each}
						</span>
						<span
							class="whitespace-nowrap {changeMeta.verdictTone === 'live'
								? 'tone-live'
								: changeMeta.verdictTone === 'held'
									? 'text-held'
									: changeMeta.verdictTone === 'failed'
										? 'tone-bad'
										: changeMeta.verdictTone === 'not-built'
											? 'text-fg-disabled'
											: 'text-fg-muted'}">{standingWords(changeMeta)}</span
						>
						</span>
					{/if}
					{#if changeRef}
						<!-- "#N · repo": ONE unit, always whole, always last. The "·"
						     before it hangs in the 16px gap (`right-full w-4`), not in
						     the flow: when the ref wraps to the start of a line the
						     meta group's `overflow-hidden` clips it, so a wrap never
						     leaves a "·" dangling at the end of the line above
						     (visual audit #19: "4 of 7 live · queued for 2 ·" at
						     390). On one line it reads exactly as before. -->
						<span class="relative whitespace-nowrap"
							>{#if changeMeta && changeSteps}<span
									class="absolute right-full w-4 text-center"
									aria-hidden="true">·</span
								>{/if}<span data-meta="ref">{changeRef}</span></span
						>
					{/if}
				</span>
			{/if}
		</span>
	</button>
{/snippet}

<!--
	═══ THE PALETTE ROW GRAMMAR (PALROW, 2026-10-10) ════════════════════════

	One line, 40px, the same five slots on every row kind (Raycast's
	"icon · title · subtitle ········ accessory", Linear's "status · title ·
	········ id · date"):

	  [lead 16] [name] [qualifier] ··········· [meta][meta][meta]
	   glyph     t-ui    env chip /             right-aligned, t-meta /
	                     t-meta text            t-code-sm, each WHOLE

	  kind       lead          name        qualifier          meta (→ right edge)
	  rollout    StatusMark/   app name    env chip           [stuck] rank² build age²
	             RestGlyph                 + namespace²
	  app        rocket        app name    —                  needs-you rank² "9 envs"
	  env        layers        env         —                  needs-you "12 apps"
	  namespace  folder        namespace   —                  needs-you "3 rollouts"
	  build      tag           short sha   labels             repo
	  change     avatar        title       —                  meter · standing · "#82 · repo"
	             (two lines below @lg: whole title, then that meta line — see changeRow)
	  command    outline icon  label       description²       "Go to"/"Command" [↵]
	  blocked    (BlockedRow, shared: same slots, its fact line is the meta)

	THE TRUNCATION PRIORITY — one rule, written as flex-shrink ratios, so
	the squeeze order is a property of the classes, not of the data:

	  1. META never truncates. Every meta item is `shrink-0 whitespace-
	     nowrap`; the group is pushed right with `ms-auto`. An item that the
	     row cannot afford is HIDDEN by its tier, never cut: tier-2 items
	     (marked ² above) are `hidden @lg:inline-flex`, a container query
	     on the results list (`@container`, 32rem): at 1440 the list is
	     ~41rem and shows them, at 390 ~22rem and drops them whole.
	  2. The QUALIFIER gives first: `shrink-[1000]`, `min-w-12` on the env
	     chip (its label truncates INSIDE the pill: `● prod-eu-c…`), `min-w-0`
	     on qualifier text. Flex distributes a deficit by shrink × basis, so
	     at 1000:1 the qualifier absorbs effectively all of it until it is at
	     its floor.
	  3. Only then does the NAME cut: `shrink min-w-0 truncate` (ratio 1).
	  4. The lead glyph never moves (`shrink-0`, 16px).

	Fixed right tracks keep the meta in columns down a group: rank `min-w-16`,
	build `min-w-[72px]`, age `min-w-8`, all right-aligned and tabular; the
	last item of every row ends at the row's own right padding (x=1036 at
	1440, the same edge as the footer count and the group-header counts).
	═══════════════════════════════════════════════════════════════════════
-->
{#snippet resultRow(r: Result, idx: number)}
	{@const isActive = idx === selectedIndex}
	{@const Icon = r.icon ?? KIND_ICON[r.kind]}
	<!-- ⭐ ROUND 2, ITEM 2: the namespace is `<app>-<env>` by this product's
	     naming convention, and the row already prints both halves (name +
	     env chip). It is shown only when it is NOT that concatenation (a
	     shared or non-standard namespace), as a tier-2 qualifier. -->
	{@const namespaceIsRedundant =
		r.kind === 'rollout' &&
		!!r.subtitle &&
		!!r.envTheme?.environmentName &&
		r.subtitle === `${r.title}-${r.envTheme.environmentName}`}
	{@const rolloutAside =
		r.kind === 'rollout'
			? [!namespaceIsRedundant ? r.subtitle : '', r.pretty].filter(Boolean).join(' · ')
			: ''}
	{#if r.kind === 'change'}
		{@render changeRow(r, idx)}
	{:else}
	<button
		type="button"
		role="option"
		id={`cp-opt-${idx}`}
		aria-selected={isActive}
		data-idx={idx}
		data-kind={r.kind}
		aria-current={r.isCurrent ? 'page' : undefined}
		title={r.isCurrent ? 'Currently open' : undefined}
		class="flex h-10 w-full items-center gap-3 overflow-hidden rounded-sm px-3 text-left transition-colors {isActive
			? 'bg-selected'
			: 'hover:bg-hover'}"
		onclick={() => pick(r)}
		onmouseenter={() => (selectedIndex = idx)}
	>
		<!-- ── LEAD. On a rollout row it is the shared state family: RestGlyph
		     for a settled success (ALWAYS its quiet 6px dot here, `recentMs=0`:
		     PALROW item "one success glyph" — the 16px filled check for "just
		     succeeded" was the one glyph in the column that differed from its
		     neighbours for a fact the age column already states), StatusMark
		     (keyed off `nodeState`, the same derivation PromotionLane reads)
		     for everything else. A change leads with its author's face. Every
		     other kind leads with its 16px outline kind icon. -->
		{#if r.kind === 'rollout'}
			<span class="flex h-4 w-4 shrink-0 items-center justify-center">
				{#if r.bakeStatus === 'Succeeded'}
					<RestGlyph
						bakeStatus={r.bakeStatus}
						state={r.state ?? null}
						stateWord={r.stateWord ?? ''}
						timestamp={r.timestamp ?? null}
						now={$now.getTime()}
						recentMs={0}
						behind={r.nodeState === 'behind'}
						behindLabel={r.verdict?.label}
					/>
				{:else}
					<StatusMark state={r.nodeState ?? 'newest'} label={r.stateWord || bakeWord(r.bakeStatus)} />
				{/if}
			</span>
		{:else}
			<span class="flex h-4 w-4 shrink-0 items-center justify-center text-fg-subtle">
				<Icon class="h-4 w-4" aria-hidden="true" />
			</span>
		{/if}

		<!-- ── NAME. Ratio 1: cuts only after the qualifier is at its floor. -->
		<span class="t-ui min-w-0 shrink truncate text-fg" data-slot="name">{r.title}</span>

		<!-- ── QUALIFIER. Ratio 1000: gives first. `-ml-1` tightens name →
		     qualifier to 8px (one identity), against 12px everywhere else. -->
		{#if r.kind === 'rollout' && r.envLabel}
			<!-- Beside the name, not at the right edge: three rows of one app
			     differ ONLY here, so it sits where it is read. -->
			<Chip
				role="env"
				theme={r.envTheme ?? null}
				label={r.envLabel}
				title={r.envFallback ? `Runs in cluster ${r.envLabel} (no Environment record)` : r.envLabel}
				wide
				class="-ml-1 min-w-12 shrink-[1000]"
			/>
		{/if}
		{#if rolloutAside}
			<span
				class="t-meta -ml-1 hidden min-w-0 shrink-[1000] truncate text-fg-subtle @lg:inline"
				data-slot="qualifier">{rolloutAside}</span
			>
		{:else if r.kind === 'build' && r.labels?.length}
			<span class="t-meta -ml-1 min-w-0 shrink-[1000] truncate text-fg-subtle" data-slot="qualifier"
				>{r.labels.join(', ')}</span
			>
		{:else if r.kind === 'action' && r.subtitle}
			<span
				class="t-meta -ml-1 hidden min-w-0 shrink-[1000] truncate text-fg-subtle @lg:inline"
				data-slot="qualifier">{r.subtitle}</span
			>
		{/if}

		<!-- ── META. `ms-auto` pushes the group to the right edge; every item
		     is whole (`shrink-0 whitespace-nowrap`) or hidden by its tier. -->
		<span class="ms-auto flex shrink-0 items-center gap-3 whitespace-nowrap">
			{#if r.kind === 'rollout'}
				{#if r.stuck}
					<Chip role="alarm" label="stuck" title="Stopped moving" />
				{/if}
				<!-- RANK², never `newest` on a build that failed here. -->
				<span
					class="t-meta hidden min-w-16 justify-end tabular-nums text-fg-subtle @lg:inline-flex"
					data-meta="rank"
					title={r.verdict?.title}
					>{r.verdict && !(r.verdict.role === 'newest' && r.bakeStatus === 'Failed')
						? r.verdict.label
						: ''}</span
				>
				<span class="t-code-sm inline-flex min-w-[72px] justify-end text-fg-subtle" data-meta="build"
					>{r.version ?? ''}</span
				>
				<span
					class="t-code-sm hidden min-w-8 justify-end tabular-nums text-fg-subtle @lg:inline-flex"
					data-meta="age"
					title={r.timestamp ? formatDate(r.timestamp) : undefined}
					>{r.timestamp ? formatTimeAgoCompact(r.timestamp, $now) : ''}</span
				>
			{:else if r.kind === 'action'}
				<span class="t-meta inline-flex min-w-16 items-center justify-end gap-2 text-fg-subtle" data-meta="command"
					>{@render runKey(isActive)}{r.commandLabel ?? ''}</span
				>
			{:else if r.kind === 'build'}
				{#if r.repo}<span class="t-meta text-fg-subtle" data-meta="repo">{r.repo}</span>{/if}
			{:else}
				<!-- app / env / namespace: a SET, so "how many need a person"
				     is its fact (danger ink, never the alarm fill), then the
				     app's deepest lag², then the set's size, last. -->
				{#if (r.needsYou ?? 0) > 0}
					<span
						class="t-meta text-danger"
						data-meta="needs"
						title="{r.needsYou} rollout{r.needsYou === 1 ? '' : 's'} here failed or stopped moving"
						>{r.needsYou} need{r.needsYou === 1 ? 's' : ''} you</span
					>
				{/if}
				{#if r.kind === 'app' && r.verdict}
					<span
						class="t-meta hidden min-w-16 justify-end tabular-nums text-fg-subtle @lg:inline-flex"
						data-meta="rank"
						title={r.verdict.title}>{r.verdict.label}</span
					>
				{/if}
				{#if r.subtitle}
					<span class="t-meta tabular-nums text-fg-subtle" data-meta="count">{r.subtitle}</span>
				{/if}
			{/if}
		</span>
	</button>
	{/if}
{/snippet}

<Toast bind:open={copyToastOpen} tone="success" message={copyToastMessage} />


{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-start justify-center sm:pt-[12vh]"
		role="dialog"
		aria-modal="true"
		aria-label="Command palette"
		use:portal
		use:inertSiblings
		use:trapFocus
	>
		<!-- ⛔ ONE CLOSE AFFORDANCE, NOT TWO. (cosmetic, coordinator operator
		     walk, 2026-09-03) This was a `<button aria-label="Close">` —
		     the SAME accessible name as the explicit `✕` button in the header
		     below, so the accessibility tree (and Tab, since it sat first in
		     DOM order inside `use:trapFocus`, ahead of the search input) had
		     two controls both announcing "Close" for one dismiss action. A
		     backdrop click-to-dismiss is a mouse/touch convenience with no
		     keyboard equivalent to lose — Escape and the header's own `✕`
		     already cover keyboard and touch — so it is a plain `aria-hidden`,
		     untabbable `<div>` now, not a second labelled button. -->
		<div
			aria-hidden="true"
			class="fixed inset-0 bg-scrim backdrop-blur-sm backdrop-enter"
			onclick={() => (open = false)}
		></div>

		<!--
			⭐ LANE P, CRAFT STUDY P4 (depth through layers, not borders;
			2026-10-09): the palette is the one elevated object on screen,
			so it carries the scrim above (`backdrop-blur`), the overlay
			surface, the dialog shadow, AND a 1px top highlight — a thin
			line one step lighter than the surface along the top edge,
			the same cue Linear's own ⌘K and Raycast draw on a floating
			panel to read as lit from above rather than a bordered box
			sitting flush with the page. `sm:` only: the full-height phone
			sheet has no "top edge" to highlight (it fills the viewport).
		-->
		<!-- ⭐ ROUND 6 (AD review 4, 2026-10-10): "the 1440 opening state clips
		     its last row under the footer." The results list's own
		     `sm:max-h-[60dvh]` was a cap on ITS height, not on the DIALOG's —
		     the dialog itself was `sm:h-auto`, no ceiling, so header + a
		     60dvh-tall list + the footer could together exceed the viewport
		     beneath the `sm:pt-[12vh]` top offset the overlay opens at, and
		     there is nothing below `sm:h-auto` to scroll the dialog back into
		     view (`fixed inset-0`, body scroll locked). `sm:max-h-[calc(100dvh-14vh)]`
		     is the real ceiling now (12vh top clearance + 2vh breathing room);
		     the list's own `sm:flex-initial sm:min-h-0` (was `sm:flex-none`)
		     lets IT give up height first when the two constraints disagree — grow:0
		     so a short list still hugs its content exactly as before, shrink:1
		     so a tall one gives ground to the header/footer instead of pushing
		     them off-screen. -->
		<div
			class="relative z-10 flex h-full w-full flex-col overflow-hidden bg-overlay palette-enter sm:mx-4 sm:h-auto sm:max-h-[calc(100dvh-14vh)] sm:max-w-2xl sm:rounded-lg sm:[box-shadow:var(--k-shadow-dialog),inset_0_1px_0_0_var(--k-line-subtle)]"
		>
			<div
				class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3"
			>
				<SearchOutline class="h-4 w-4 shrink-0 text-fg-subtle" />
				{#if scope}
					{@const ScopeIcon = KIND_ICON[scope]}
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-xs bg-subtle px-1.5 py-0.5 t-ui-sm text-fg-muted"
					>
						<ScopeIcon class="h-3 w-3" />
						<span>{KIND_LABEL[scope]}</span>
						<button
							type="button"
							onclick={() => {
								scope = null;
								selectedIndex = 0;
								searchInput?.focus();
							}}
							aria-label="Clear scope"
							class="relative -mr-0.5 ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-xs text-fg-subtle before:absolute before:-inset-1.5 before:content-[''] hover:bg-hover hover:text-fg"
							>×</button
						>
					</span>
				{/if}
				<!-- Combobox semantics. Arrow keys move `selectedIndex` but focus never
				     leaves this input, so before `aria-activedescendant` a screen reader
				     was told NOTHING as the reader arrowed down a list of rollouts. -->
				<!-- ⭐ D-3 (2026-10-08): THE UNSCOPED PLACEHOLDER WAS 85 CHARACTERS
				     AND GOT CLIPPED MID-WORD AT 390 ("Search rollouts, apps,
				     environments,"), with no ellipsis — the input's own
				     `overflow:hidden` just cuts it, so the clip reads as broken
				     text rather than a shortened one. The `BROWSE` cards below
				     the field already list rollouts/apps/environments/
				     namespaces/builds/changes, so the placeholder's own job is
				     the ONE thing those cards do not say: this field also takes
				     a pasted PR link or commit sha. Measured against the
				     field's own canvas-rendered width at 390 (298px available):
				     this string is 260px, the full "…namespaces, or paste a PR
				     link or a commit sha…" form is 701px. -->
				<input
					bind:this={searchInput}
					value={query}
					oninput={onInput}
					type="text"
					role="combobox"
					aria-label={scope
						? `Search ${KIND_LABEL[scope].toLowerCase()}`
						: 'Search rollouts, apps, environments and namespaces, or paste a PR link or a commit sha'}
					aria-expanded="true"
					aria-controls="command-palette-results"
					aria-autocomplete="list"
					aria-activedescendant={`cp-opt-${selectedIndex}`}
					placeholder={scope
						? `Search ${KIND_LABEL[scope].toLowerCase()}…`
						: 'Search, or paste a PR link or sha'}
					autocomplete="off"
					spellcheck="false"
					class="t-ui cp-search-input min-w-0 flex-1 border-0 bg-transparent p-0 text-fg placeholder-fg-subtle outline-none focus:outline-none focus:ring-0"
				/>
				<!-- ⭐ ROUND 3, ITEM 7 (AD): Esc shown twice, two spellings ("ESC"
				     here, "Esc close" in the footer). The footer is the hint
				     line — every other key (↑↓, ↵, Tab) is said there and
				     nowhere else — so this one drops, not the footer's. -->
				<button
					type="button"
					aria-label="Close"
					onclick={() => (open = false)}
					class="-mr-1 ms-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg sm:hidden"
				>
					<span class="t-heading leading-none" aria-hidden="true">×</span>
				</button>
			</div>

			<div
				bind:this={listEl}
				id="command-palette-results"
				role="listbox"
				aria-label="Results"
				use:snapToRows={`${inPicker}|${scope}|${query}|${filtered.length}|${thisRolloutCount}|${attentionShown.length}`}
				class="@container flex-1 overflow-y-auto p-2 sm:max-h-[min(36rem,calc(100dvh-14vh-88px))] sm:min-h-0 sm:flex-initial"
			>
				{#if loading && allResults.length === 0}
					<div class="py-12 text-center t-body text-fg-subtle">Loading…</div>
				{:else if inPicker}
					<!--
						⭐ LANE P, §5 — THE OPENING SCREEN IS ROWS, NOT A 2×3 TILE GRID.
						"This rollout" (rollout pages only) → "Needs you" (max 3) →
						"Jump to" (one 40px row per kind, not a tile). The grid used to
						be the FIRST thing a reader saw even on a page that already
						named an object — Linear's own ⌘K never shows a category picker
						first on an object page, it shows that object's own actions.
					-->
					{@const kindCounts = (() => {
						const c: Record<ResultKind, number> = {
							change: 0,
							rollout: 0,
							build: 0,
							app: 0,
							env: 0,
							namespace: 0,
							action: 0
						};
						for (const r of allResults) c[r.kind]++;
						return c;
					})()}
					<!-- ⭐ ROUND 4, ITEM B (AD, 2026-10-10): "sticky group headers pile
					     up on scroll — make each header sticky WITHIN ITS OWN GROUP
					     CONTAINER, so the next header pushes the previous one out."
					     Each group (header + its rows) is a `relative` wrapper now,
					     not a flat run of siblings in the shared scroller — the
					     header's `sticky top-0` is scoped to ITS OWN container's
					     height, so once the reader scrolls past a short group, the
					     NEXT group's header is the one occupying the sticky slot,
					     not a pile of every header seen so far. -->
					<!-- PALROW r8: section order — Needs you first while the fleet has a
					     failure (`needsYouLeads`), else This rollout first. Both
					     sections read their flat-index start (`thisStart`/`attnStart`),
					     the same numbers Enter uses. -->
					{#snippet thisRolloutSection()}
					{#if thisRolloutCount > 0}
						<div class="relative">
						{@render groupHeader('This rollout')}
						<!-- ⭐ ROUND 5 (AD review 3 + coordinator, 2026-10-10): the
						     blocking fact, when there is one, leads as a `BlockedRow` —
						     the SAME shared component "Needs you" draws below — through
						     the `blockedOption` combobox adapter (see its own doc
						     comment). -->
						{#if incidentCard}
							{@render blockedOption(incidentCard, thisStart)}
						{/if}
						{#each thisRolloutActions as action, i (action.id)}
							{@const actionIdx = thisStart + (incidentCard ? i + 1 : i)}
							{@const sel = actionIdx === selectedIndex}
							{@const AIcon = action.icon}
							<button
								type="button"
								role="option"
								id={`cp-opt-${actionIdx}`}
								aria-selected={sel}
								data-idx={actionIdx}
								onclick={action.onSelect}
								onmouseenter={() => (selectedIndex = actionIdx)}
								class="flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left transition-colors {sel
									? 'bg-selected'
									: 'hover:bg-hover'}"
							>
								<AIcon class="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
								<span class="t-ui min-w-0 shrink truncate text-fg">{action.label}</span>
								<span class="ms-auto flex shrink-0 items-center gap-3 whitespace-nowrap">
									<span class="t-meta inline-flex min-w-16 items-center justify-end gap-2 text-fg-subtle" data-meta="command"
										>{@render runKey(sel)}{action.commandLabel}</span
									>
								</span>
							</button>
						{/each}
						</div>
					{/if}
					{/snippet}
					{#snippet needsYouSection()}
					{#if attentionShown.length > 0}
						<div class="relative">
						{@render groupHeader('Needs you', attention.length)}
						{#each attentionShown as c, i (c.sourceCluster + '|' + c.ns + '/' + c.name)}
							{@const idx = attnStart + i}
							{@render blockedOption(c, idx)}
						{/each}
						{#if attention.length > attentionShown.length}
							<p class="px-3 pb-1 pt-1 t-meta text-fg-subtle">
								and {attention.length - attentionShown.length} more — type to find one, or open
								<a href={href('/')} class="underline hover:text-fg"
									>Fleet overview</a
								>
							</p>
						{/if}
						</div>
					{/if}
					{/snippet}
					{#if needsYouLeads}
						{@render needsYouSection()}
						{@render thisRolloutSection()}
					{:else}
						{@render thisRolloutSection()}
						{@render needsYouSection()}
					{/if}
					<div class="relative">
					{@render groupHeader('Jump to')}
					<!--
						⭐ LANE P, §5: "40px rows" — NOT the old `sm:grid-cols-2` tile
						grid. A row is `icon · name · count` (count right, tabular),
						one per line, so Rollouts/Apps/Environments/Namespaces/Builds/
						Your changes scan as a short, ordinary list, same geometry as
						every result row below it (only this one has no status glyph —
						a kind has no single bake state to show).
					-->
					{#each PICKER_KINDS as kind, kindIdx}
						{@const KIcon = KIND_ICON[kind]}
						{@const tileIdx = attentionShown.length + thisRolloutCount + kindIdx}
						{@const sel = tileIdx === selectedIndex}
						<button
							type="button"
							role="option"
							id={`cp-opt-${tileIdx}`}
							aria-selected={sel}
							data-idx={tileIdx}
							onclick={() => {
								scope = kind;
								selectedIndex = 0;
								searchInput?.focus();
							}}
							onmouseenter={() => (selectedIndex = tileIdx)}
							class="flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left transition-colors {sel
								? 'bg-selected'
								: 'hover:bg-hover'}"
						>
							<KIcon class="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
							<span class="t-ui truncate text-fg">{KIND_LABEL[kind]}</span>
							<span class="ms-auto shrink-0 t-meta tabular-nums text-fg-subtle"
								>{kindCounts[kind]}</span
							>
						</button>
					{/each}
					<!-- THE LAST ROW — "Your changes". NAVIGATES straight to
					     `/changes?mine` (`openYourChanges`) rather than setting
					     `scope`, unlike its siblings above: there is no
					     client-side change index to scope into. Same row chrome,
					     so it reads as one more Jump to destination, not a
					     different kind of control. Wrapped in a one-item {#each} —
					     `{@const}` must be the immediate child of a block, and this
					     is the only row that is not itself inside the
					     `PICKER_KINDS` loop. -->
					{#each [0] as _}
						{@const changeTileIdx = attentionShown.length + thisRolloutCount + PICKER_KINDS.length}
						{@const changeSel = changeTileIdx === selectedIndex}
						<button
							type="button"
							role="option"
							id={`cp-opt-${changeTileIdx}`}
							aria-selected={changeSel}
							data-idx={changeTileIdx}
							title="{myChangeCount} {myChangeCount === 1 ? 'change' : 'changes'} merged in the last 30 days"
							onclick={openYourChanges}
							onmouseenter={() => (selectedIndex = changeTileIdx)}
							class="flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left transition-colors {changeSel
								? 'bg-selected'
								: 'hover:bg-hover'}"
						>
							<CodePullRequestOutline class="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
							<span class="t-ui truncate text-fg">Your changes</span>
							<span class="ms-auto shrink-0 t-meta tabular-nums text-fg-subtle">{myChangeCount}</span>
						</button>
					{/each}
					</div>
				{:else if filtered.length === 0}
					<!-- ⭐ LANE P, §5: §3.15 EMPTY, NOT A BARE SENTENCE. 20px outline
					     icon `text-fg-disabled`, a one-line headline, a `t-meta`
					     next step — the same anatomy `NotFound`/`ErrorState` use,
					     borrowed verbatim rather than a fourth hand-rolled "nothing
					     here" string.
					     ⭐ ROUND 3, ITEM 9 (AD): "scoped to Rollouts, the hint still
					     says 'Try a sha, a PR link or an environment name' — the
					     no-result state ignores scope." The next step now names the
					     scope that found nothing and offers the one way out: widen
					     the search. The hint sentence is ONLY the unscoped one when
					     there is no scope to name. -->
					<div class="flex flex-col items-center gap-2 py-12 text-center">
						<SearchOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
						<p class="t-ui text-fg">
							{#if scope}No {KIND_LABEL[scope].toLowerCase()} match "{query}"{:else}No matches for "{query}"{/if}
						</p>
						{#if scope}
							<button
								type="button"
								class="nav-link"
								onclick={() => {
									scope = null;
									selectedIndex = 0;
									searchInput?.focus();
								}}
							>
								Search everything for "{query}"
								<ChevronRightOutline aria-hidden="true" />
							</button>
						{:else}
							<p class="t-meta text-fg-subtle">Try a sha, a PR link or an environment name.</p>
						{/if}
					</div>
				{:else}
					<!-- REFERENCE ROWS — UNGROUPED, ABOVE THE FIRST GROUP HEADER, and
					     only in an UNSCOPED search: `filtered` only ever splices
					     `changeRefResults` in when `!scope` (there is no `change` scope
					     to browse into), so this guard keeps `i` here in sync with the
					     real `data-idx`/`selectedIndex` `filtered` assigned. This is the
					     fix for "why does search now have a pull request category" —
					     a reference is a destination, never a group. -->
					{#if !scope}
						{#each changeRefResults as r, i (r.key)}
							{@render resultRow(r, i)}
						{/each}
					{/if}
					{#each grouped as group (group.kind)}
						<div class="relative">
						{@render groupHeader(group.label, group.items.length)}
						{#each group.items as item (item.result.key)}
							{@const bc = blockedCardFor(item.result)}
							{#if bc}
								{@render blockedOption(bc, item.idx)}
							{:else}
								{@render resultRow(item.result, item.idx)}
							{/if}
						{/each}
						</div>
					{/each}
				{/if}
			</div>

			<!-- ⭐ ROUND 4, ITEM (AD, "empty 36px phone footer band"): on phone,
			     every hint inside this bar is `sm:flex`-gated (no hardware
			     keyboard to name keys for) and the result count only renders
			     `!inPicker` — so the default "This rollout" / "Jump to" screen
			     left an `h-9` bar with NOTHING in it, a blank 36px stripe
			     between the list and the viewport edge. The bar itself goes
			     `hidden` at phone width for exactly that screen (`inPicker`);
			     it still shows (now carrying the result count) the moment
			     there's something to report, and un-hides at `sm:` where the
			     kbd hints live. -->
			<div
				class="{inPicker
					? 'hidden sm:flex'
					: 'flex'} mt-auto h-9 shrink-0 items-center justify-between gap-3 border-t border-line bg-subtle px-5 t-meta text-fg-subtle"
			>
				<!-- ⭐ LANE P, §5: "↑↓ navigate · ↵ open · Tab scope · Esc close" —
				     the footer now names the two keys the body itself uses
				     (Tab to scope a Jump to row, §5's own addition above) and the
				     close key, not just navigate/open. All four share the one
				     `.kbd` class (language.css, "lane P") rather than each
				     hand-rolling `rounded-xs border border-line-strong …`. -->
				<div class="hidden items-center gap-3 sm:flex">
					<!-- ⭐ ROUND 3, ITEM 9 (AD): "the footer still offers ↑↓
					     navigate / ↵ open with 0 results" — there is nothing to
					     navigate to or open, so the hints that promise one go
					     quiet with the list; Esc (and Tab-scope, in the picker)
					     stay, since both still do something at 0 results. -->
					{#if !(!inPicker && filtered.length === 0)}
						<span class="flex items-center gap-1">
							<kbd class="kbd">↑</kbd>
							<kbd class="kbd">↓</kbd>
							<span>navigate</span>
						</span>
						<span class="flex items-center gap-1">
							<kbd class="kbd">↵</kbd>
							<span>open</span>
						</span>
					{/if}
					{#if inPicker}
						<span class="flex items-center gap-1">
							<kbd class="kbd">Tab</kbd>
							<span>scope</span>
						</span>
					{/if}
					<span class="flex items-center gap-1">
						<kbd class="kbd">Esc</kbd>
						<span>close</span>
					</span>
				</div>
				<!-- ⛔ THE COUNT COUNTS WHAT IS ON SCREEN, OR IT DOES NOT RENDER.
				     It used to print `128 results` over a four-tile category
				     picker: a number for a set the body was not showing, and the
				     only number on the default screen. Nothing takes its place —
				     the `Needs you` header and each tile already carry their own
				     count, and a slot kept warm for a number is the same defect
				     as a slot kept warm for an em dash.
				     ⭐ ROUND 6 (AD review 4, 2026-10-10): "the empty-query footer
				     shows a count" — scoping into a kind (Tab from a Jump to row)
				     with nothing yet typed left `inPicker` false but `filtered`
				     still the WHOLE scope, so the footer printed e.g. "59
				     results" directly under a tile that had just said "Rollouts
				     59" — the identical number, restated. `query` joins the
				     guard: the count earns its place once it is actually
				     counting a FILTER's result, not a scope's full membership. -->
				{#if !inPicker}
					<!-- PALROW r7 (AD r6, item 2): scoped with nothing typed counts
					     too: at 390 the bar used to be an empty band there.
					     PALROW: `ms-auto` so the count is right-aligned on a phone too,
					     where the hints beside it are hidden; `px-5` on the bar puts its
					     right edge at the rows' own (x=1036 at 1440). -->
					<span class="ms-auto tabular-nums" data-meta="count">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes palette-in {
		0% {
			opacity: 0;
			transform: translateY(-6px) scale(0.97);
		}
		100% {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	@keyframes backdrop-in {
		0% {
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}
	.palette-enter {
		animation: palette-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
		transform-origin: center top;
	}
	.backdrop-enter {
		animation: backdrop-in 120ms ease-out;
	}
</style>
