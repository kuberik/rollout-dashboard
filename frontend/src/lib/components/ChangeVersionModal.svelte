<svelte:options runes={true} />

<script lang="ts">
	import { availableReleases } from '$lib/releases/registry.svelte';
	import HeldGlyph from './HeldGlyph.svelte';
	import Avatar from './Avatar.svelte';
	import { formatTimestamp } from '$lib/display-time';
	import type { Rollout, Environment, RolloutDependency } from '../../types';
	import { Modal, Toggle } from 'flowbite-svelte';
	import Toast from './Toast.svelte';
	import {
		ExclamationCircleSolid,
		ArrowUpOutline,
		UndoOutline,
		CodePullRequestSolid,
		GithubSolid,
		ChevronLeftOutline,
		CloseOutline,
		SearchOutline
	} from 'flowbite-svelte-icons';
	import { createQuery, createQueries } from '@tanstack/svelte-query';
	import {
		hasForceDeployAnnotation,
		getDisplayVersion,
		formatTimeAgo,
		formatTimeAgoCompact
	} from '$lib/utils';
	import StatusMark from './StatusMark.svelte';
	import EmptyGlyph from './EmptyGlyph.svelte';
	import type { NodeState } from '$lib/view-models/promotion-lanes';
	import { rolloutStateChip } from '$lib/view-models/rollout-state-chip';
	import {
		manualDeployNote,
		autoDeployWhy,
		autoDeployState,
		type AutoDeployState
	} from '$lib/view-models/auto-deploy';
	import {
		confirmLevel,
		confirmNotice,
		deployActionLabel,
		deployIntent,
		pickerRankLabel as pickerRankLabelFn,
		releaseIndex,
		rolloutEnvironmentName,
		splitLeadSentence,
		targetPhrase
	} from '$lib/view-models/deploy-risk';
	import { promotionBlock, gateAllows, isDeployable } from '$lib/view-models/promotion';
	import { buildRolloutGraph, contractHeldVersionsFor } from '$lib/view-models/dependency-graph';
	import { graphNodeForRollout } from '$lib/view-models/app-tasks';
	import { rolloutsListQueryOptions, fetchRolloutsList } from '$lib/api/rollouts';
	import { buildGateContext, classifyGate } from '$lib/view-models/blocking-story';
	import { pollWhenHealthy } from '$lib/api/errors';
	import { compareEnvironmentNames } from '$lib/env-order';
	import Chip from '$lib/components/Chip.svelte';
	import { getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { requirementsChangedSentence } from '$lib/view-models/release-delta';
	import { consecutiveTagPairs, headCommitTitle, buildTitle } from '$lib/view-models/build-title';
	import { commitQueryOptions } from '$lib/api/commit';
	import { revisionSha } from '$lib/git-ref';
	import { githubKnownDisconnected } from '$lib/api/github-gate.svelte';
	import { githubOwnerRepo, repoKeyFor } from '$lib/version-utils';
	import {
		commitsQueryOptions,
		formatCommitMessage,
		connectGithubInNewTab,
		isMobileConnectContext,
		fetchGithubStatus,
		githubAbsenceSentence,
		githubStatusQueryKey,
		FetchCommitsError,
		type CommitsError
	} from '$lib/api/github';
	import { modalFocusReturn } from '$lib/a11y.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import FactList, { type Fact } from './FactList.svelte';
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	import StatusSpinner from './StatusSpinner.svelte';
	import ConnectGithubAction from './ConnectGithubAction.svelte';
	import { resolveGateName } from '$lib/view-models/gate-name';
	import { gateLabel, gateLabelMarked, plainGateText } from '$lib/view-models/gate-label';
	import GateText from './GateText.svelte';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { modEnterHint } from '$lib/shortcut-hint';
	import { apiPath } from '$lib/api/urls';
	import { href } from '$lib/paths';
	import { noReleasesOf } from '$lib/releases/registry.svelte';
	import { recoveryModeReason } from '$lib/view-models/change-version-entry';

	interface Props {
		open: boolean;
		rollout: Rollout | null;
		/**
		 * ⭐ THE GATE STATE, RESTATED WHERE THE DECISION IS MADE.
		 *
		 * The critique's charge was exact: the page showed a full-width amber
		 * *"Deployments currently blocked"* banner, the reader opened this
		 * modal, typed the sha, pressed Deploy Now — and production changed
		 * immediately. The modal is the last screen before the change and it
		 * said nothing at all about the gate, so the only statement the reader
		 * had was the one that was wrong.
		 */
		autoDeploy?: AutoDeployState | null;
		// If true, force pin mode and disable toggle (used for rollback)
		isPinVersionMode?: boolean;
		// Pre-select a version when the modal opens (e.g. rollback's previous
		// version, or a specific release candidate's "Deploy" button).
		initialSelectedVersion?: string | null;
		initialExplanation?: string;
		// Multi-cluster: the cluster name when this rollout lives on a spoke.
		cluster?: string;
		/**
		 * ⭐ (2026-10-09, integration round 3, item 3; round 4, item
		 * follow-up) THE CONTRACT HOLD, THE HALF `isDeployable` CANNOT SEE.
		 * Measured live on `checkout-api`/`prod-us-east-2`: Overview's
		 * "Newer builds" ledger and the Gates tab both mark
		 * `4.43.0-43`/`4.44.0-44`/`4.45.0-45` HELD — payments-svc hasn't
		 * shipped the version this build needs — while this picker marked
		 * only the two gate-blocked builds and left `4.43.0-43` reading
		 * plain `Ready`. The cause: a `RolloutDependency` contract hold is
		 * not always published on `rollout.status.gates` (this fixture's own
		 * `ckGates()` deliberately omits it — see `mock-data.ts`), so
		 * `isDeployable` (`promotion.ts`), which reads only `status.gates`,
		 * cannot see it.
		 *
		 * ⛔ ROUND 3's FIX ONLY COVERED ROLLOUT DETAIL. That page passed this
		 * prop from its own `providerNetwork` graph, but history,
		 * `/envs/<name>`, `/apps/<name>` and `FailurePanel` all open this
		 * SAME dialog and never built that graph — so the prop silently
		 * defaulted to empty everywhere else, and `4.43.0-43` kept reading
		 * `Ready` from four of the five entry points. The dialog now builds
		 * its OWN copy of the graph (`selfHeldGraph` below) off the SAME
		 * `/api/rollouts` payload every other graph view reads
		 * (`buildRolloutGraph`, `contractHeldVersionsFor` —
		 * `dependency-graph.ts`), keyed the same way `rolloutsListQueryOptions`
		 * already is everywhere else, so a caller that already has the query
		 * running (rollout detail, `/apps/<name>`, `/envs/<name>`) gets a
		 * cache hit, not a second request.
		 *
		 * This prop is now an OVERRIDE, not the only path: when a caller
		 * passes it (rollout detail does, since it already has the graph in
		 * hand for other reasons), the dialog trusts it and skips building
		 * its own. Every other caller leaves it `undefined` and the dialog
		 * resolves the same answer itself.
		 */
		contractHeldVersions?: ReadonlySet<string>;
		/**
		 * ⭐ WHERE THIS LANDS, AND IT IS THE WORD THE MODAL OWED ITS READER.
		 *
		 * The critique: a build was force-deployed to PRODUCTION through three
		 * closed gates and *"the modal never says production"*. Rollout detail
		 * holds the `Environment` object and passes `spec.environment` here;
		 * every other call site gets it derived from the rollout by
		 * `rolloutEnvironmentName`, so no surface can silently lose it.
		 */
		environmentName?: string | null;
		onSuccess?: (message: string) => void;
		onError?: (message: string) => void;
		/**
		 * ⭐ THE MUTATION'S PENDING STATUS, FOR THE PAGE BEHIND THIS DIALOG.
		 * (B3, 2026-09-03, operator walk) Confirming Deploy/Roll back changed
		 * nothing on screen for 5-8s while the request was in flight — the
		 * button stayed armed with no spinner, so a reader could not tell
		 * whether the click had registered. This dialog now shows its own
		 * pending state (see `deploying` below); `onDeployStart` fires the
		 * instant the request is sent, before the `await`, so the Overview can
		 * show its own "Deploy requested — starting" the moment a person acts,
		 * not 5-8s later when the response finally lands.
		 */
		onDeployStart?: () => void;
		/**
		 * ⭐ RECOVERY MODE CARRIES INTO THE CONFIRM. (squad-rollout, Lane D,
		 * round 6 — AD round 4, item 2.) `RecoveryModeWarningModal` asks for
		 * consent first; the confirm that follows says it once more as one
		 * `t-meta` line inside the callout, so the reader confirming never has
		 * to remember the previous dialog. `undefined` derives it with the same
		 * `recoveryModeReason()` helper, with no health checks known (so only
		 * the running-build-FAILED branch); a caller that also knows about unhealthy
		 * checks passes it explicitly.
		 */
		recoveryMode?: boolean;
	}

	let {
		open = $bindable(),
		rollout,
		autoDeploy = null,
		isPinVersionMode = false,
		initialSelectedVersion = null,
		initialExplanation = '',
		cluster,
		environmentName = null,
		contractHeldVersions,
		onSuccess = () => {},
		onError = () => {},
		onDeployStart = () => {},
		recoveryMode = undefined
	}: Props = $props();

	/**
	 * Verified by tabbing the running app: the native `<dialog>` under
	 * `flowbite`'s `Modal` already traps focus and makes the page behind inert
	 * (`dialog.matches(':modal')` is true, and 40 Tab presses never left it).
	 * What it does NOT do is restore focus, because the element is inside
	 * `{#if open}` and is destroyed rather than closed — measured landing on
	 * `<body>`. This puts it back on `Change Version`.
	 */
	modalFocusReturn(() => open);

	/**
	 * ⭐ LOCK THE DOCUMENT SCROLL WHILE THIS DIALOG IS OPEN. (2026-09-03,
	 * scroll model rewrite) The DOCUMENT is the scroller now (see
	 * `app.css`'s "THE DOCUMENT SCROLLS"). A native `<dialog>` opened with
	 * `showModal()` (flowbite's `Modal`) already makes the page behind it
	 * inert to keyboard and pointer interaction, but it does not stop a
	 * wheel/touch gesture from moving the DOCUMENT'S own scroll position
	 * underneath it — measured on the running page before this fix: wheeling
	 * over the dimmed backdrop at 390 scrolled the rollout page behind the
	 * open dialog. `html.scroll-locked` (`app.css`, unlayered) sets
	 * `overflow: hidden` on `html`; `scrollbar-gutter: stable` on the same
	 * element is what keeps the page from shifting sideways the instant this
	 * engages. The counter on `window` is shared with `CommandPalette`'s
	 * identical lock — defensive against both somehow being open at once,
	 * so neither's close can unlock a page the other still needs locked.
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

	// --- Picker state ---------------------------------------------------
	let selectedVersion = $state<string | null>(null);
	let searchQuery = $state('');
	let showAllTags = $state(false);
	let allRepositoryTags = $state<string[]>([]);
	let loadingAllTags = $state(false);
	let annotations = $state<Record<string, Record<string, string>>>({});
	let loadingAnnotations = $state<Record<string, boolean>>({});
	/**
	 * ⭐ COMMAND-MENU KEYBOARD NAV. (squad-rollout, Lane D, §4: "Keyboard: ↑↓
	 * move `bg-selected`, ↵ selects, the selection is visible without
	 * hover.") Separate from `selectedVersion` on purpose — that field means
	 * "this build is CHOSEN, step 2 is showing", while this one means
	 * "this row is where the arrow keys are, while still browsing step 1".
	 * Reset to 0 whenever the visible list changes shape (a new search
	 * string, the tags toggle) so it never points past the end of a
	 * shorter filtered list.
	 */
	let activeVersionIndex = $state(0);
	/** Phone breakpoint, live (round 7: the shorter search placeholder). */
	let isPhone = $state(false);
	$effect(() => {
		if (!open || typeof window === 'undefined' || !window.matchMedia) return;
		const mq = window.matchMedia('(max-width: 639px)');
		isPhone = mq.matches;
		const onChange = () => (isPhone = mq.matches);
		mq.addEventListener?.('change', onChange);
		return () => mq.removeEventListener?.('change', onChange);
	});
	$effect(() => {
		// Re-run on every filter change; clamp rather than reset to 0 so
		// typing one more character of an already-narrowed search does not
		// keep yanking the highlight back to the top of what's left.
		const len = filteredVersionsForDisplay.length;
		if (activeVersionIndex > len - 1) activeVersionIndex = Math.max(0, len - 1);
	});

	function onPickerKeydown(event: KeyboardEvent) {
		const len = filteredVersionsForDisplay.length;
		if (len === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeVersionIndex = Math.min(activeVersionIndex + 1, len - 1);
			scrollActiveVersionIntoView();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeVersionIndex = Math.max(activeVersionIndex - 1, 0);
			scrollActiveVersionIntoView();
		} else if (event.key === 'Enter') {
			const version = filteredVersionsForDisplay[activeVersionIndex];
			if (!version) return;
			event.preventDefault();
			selectVersion(typeof version === 'string' ? version : version.tag);
		}
	}

	function scrollActiveVersionIntoView() {
		if (!leftListEl) return;
		const row = leftListEl.querySelectorAll<HTMLButtonElement>('button[data-version-row]')[
			activeVersionIndex
		];
		row?.scrollIntoView({ block: 'nearest' });
	}

	/**
	 * ⭐ SHRINK THE PICKER TO ITS CONTENT ONLY WHEN THAT IS SAFE. See the note
	 * above the grid markup for the full account of why this is measured in
	 * JS rather than solved with `align-items` alone: `stretch` is what makes
	 * an oversized picker correctly shrink-and-scroll inside the dialog's
	 * `max-h-[85vh]` budget, and `start` breaks exactly that for a rollout
	 * with enough releases to need it. This never touches the right pane —
	 * its rendered height (under untouched `stretch`) is the one honest
	 * reading of "what the row actually has available," which is why it is
	 * the thing measured against rather than the picker's own (self-inflicted)
	 * height.
	 */
	let leftPaneEl: HTMLDivElement | undefined = $state();
	let leftHeaderEl: HTMLDivElement | undefined = $state();
	let leftListEl: HTMLDivElement | undefined = $state();
	let rightPaneEl: HTMLDivElement | undefined = $state();
	let rightContentEl: HTMLDivElement | undefined = $state();
	let rightFooterEl: HTMLDivElement | undefined = $state();
	let leftPaneMaxHeight = $state<number | null>(null);
	/**
	 * ⭐ THE MIRROR OF `leftPaneMaxHeight`, FOR THE SAME DEFECT ON THE OTHER
	 * SIDE. (F6, 2026-09-03 re-check) The note above only ever caps the LEFT
	 * pane — it was written for a short PICKER beside a tall preview (2-3
	 * releases, a long changelist). Nothing capped the inverse: a rollout
	 * with a long release history (17 rows) beside a preview whose commits
	 * region collapses to one sentence — "GitHub is not configured for this
	 * dashboard." — measured 279px of blank space under that sentence, because
	 * `align-items: stretch` (the grid's default, unchanged, and still needed
	 * for the case above) stretches BOTH columns to the row's height, and the
	 * row's height is the LEFT list's, whichever side happens to be taller.
	 * `rightPaneMaxHeight` is the same cap, aimed the other way: when the
	 * RIGHT side's own content is the shorter one, it gets the explicit
	 * `max-height` instead of the left, so a short answer renders as a short
	 * pane rather than as a short paragraph inside a tall one.
	 *
	 * ⛔ THE CAP MUST COVER THE WHOLE COLUMN, NOT JUST THE SCROLLABLE PART.
	 * (F6, fifth re-check, BLOCKING) This `max-height` is applied to
	 * `rightPaneEl`, which contains BOTH the scrollable changelist
	 * (`rightContentEl`) AND the pinned deploy footer (Pin Version / Cancel /
	 * confirm) as a sibling `shrink-0` block below it. The previous spelling
	 * measured only `rightContentEl`'s own content and used that alone as the
	 * cap — so on a short changelist ("GitHub is not configured") beside a
	 * full-height footer (gate alert, pin row, textarea, typed-confirm
	 * input, two buttons), the cap came out smaller than the footer alone
	 * needs. Because `rightPaneEl` is `overflow-hidden` with no scroller of
	 * its own, that under-measurement did not just fail to help — it PAINTED
	 * OVER the footer: measured live, a 148px cap against 514px of real
	 * content (delta card + footer) clipped the confirm/cancel buttons
	 * entirely off-screen while leaving them in the layout, so
	 * `elementFromPoint` at their centre returned the grid div instead of the
	 * button underneath the clip. The natural height compared against
	 * `available` must be the FULL column's need — content plus footer —
	 * never a measurement that silently drops the one part of the pane that
	 * must always be reachable.
	 */
	let rightPaneMaxHeight = $state<number | null>(null);

	/**
	 * ⛔ `scrollHeight` LIES ONCE THE ELEMENT IS THE THING BEING STRETCHED.
	 * `scrollHeight` is defined as `max(clientHeight, content height)` — so on
	 * a `flex-1` list that the grid has ALREADY inflated to 517px, two ~60px
	 * rows still read back as 517, because there is nothing to "scroll past"
	 * relative to the list's own (inflated) box. Measuring the true content
	 * extent needs the list's CHILDREN's own rendered positions, which do not
	 * grow just because their container did.
	 */
	function measuredContentHeight(container: HTMLElement): number {
		const top = container.getBoundingClientRect().top;
		let bottom = top;
		for (const child of Array.from(container.children)) {
			bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
		}
		return bottom - top;
	}

	$effect(() => {
		// Re-run whenever the shape of the picker or the preview can change —
		// `selectedVersion` mounts/unmounts the right pane and the ResizeObserver
		// targets with it. Referencing the list's own length (rather than just
		// the DOM nodes) makes this re-run on search/tag-toggle filtering too,
		// where the list's own box does not resize but its CONTENT does.
		const rowCount = filteredVersionsForDisplay.length;
		if (
			!selectedVersion ||
			!leftHeaderEl ||
			!leftListEl ||
			!rightPaneEl ||
			!rightContentEl ||
			!rightFooterEl
		) {
			leftPaneMaxHeight = null;
			rightPaneMaxHeight = null;
			return;
		}
		const header = leftHeaderEl;
		const list = leftListEl;
		const right = rightPaneEl;
		const rightContent = rightContentEl;
		const rightFooter = rightFooterEl;
		void rowCount;

		/**
		 * ⭐ WHICHEVER SIDE IS THE SHORTER ONE GETS CAPPED; THE OTHER KEEPS
		 * `stretch` AND ITS OWN SCROLL. (F6, 2026-09-03 re-check) Comparing
		 * the two sides' NATURAL content heights directly — not each side's
		 * currently-rendered (possibly already-stretched) height — is what
		 * keeps this from being circular: `measuredContentHeight` reads
		 * actual child positions, which do not grow just because an ancestor
		 * stretched the box around them (same reasoning as the function's own
		 * doc comment). Only the LONGER side's rendered height is used as the
		 * ceiling for the shorter one, because that is the one number that is
		 * still honest under `stretch` — it is the row's own real height, not
		 * a capped one.
		 *
		 * ⛔ `rightNatural` IS THE WHOLE COLUMN'S NEED, FOOTER INCLUDED. (F6,
		 * fifth re-check, BLOCKING) `rightPaneMaxHeight` is applied to
		 * `rightPaneEl`, the ancestor of BOTH `rightContent` (the scrollable
		 * changelist) and `rightFooter` (the pinned Pin Version / Cancel /
		 * confirm block, a `shrink-0` sibling below it, never a descendant of
		 * `rightContent`). Measuring `rightContent` alone and using that as
		 * the cap on their shared ancestor under-sized the cap by the
		 * footer's own height every time the changelist was short — the
		 * footer then rendered, unclipped in the DOM, but visually painted
		 * over by `rightPaneEl`'s own `overflow-hidden` (measured live: a
		 * 148px cap against 514px of real content, the confirm and cancel
		 * buttons neither painted nor at `elementFromPoint`). `rightFooter`
		 * is `shrink-0`, so its `getBoundingClientRect().height` is its true
		 * natural height regardless of any cap already applied to its
		 * ancestor — flex children are not shrunk by an ancestor's
		 * `overflow: hidden`, only clipped from view, so this measurement
		 * stays honest even while a stale small cap is still applied from a
		 * previous run.
		 */
		function recompute() {
			const leftNatural = header.getBoundingClientRect().height + measuredContentHeight(list);
			const rightNatural =
				measuredContentHeight(rightContent) + rightFooter.getBoundingClientRect().height;
			if (leftNatural <= rightNatural) {
				// ⛔ THE PICKER IS NEVER CAPPED. (2026-09-03, from the human: "version
				// selection is not expanded to cover the full height of the modal.")
				// Capping a short list to its own content left the left column
				// ending mid-dialog with dead ground under it and, once the sticky
				// header was counted, a two-row list that scrolled. The picker
				// stretches to the row like any column; only the RIGHT side is ever
				// capped, for the inverse case below.
				leftPaneMaxHeight = null;
				rightPaneMaxHeight = null;
			} else {
				// ⛔ NO CAP WHEN THE PANES ARE STACKED. (operator walk, 2026-09-07)
				// Below `md` the picker is `hidden` once a version is picked, so its
				// rendered height is 0 or a sliver — and "the other column's height"
				// is not a ceiling at all. Measured live at 390: a 117px cap on a
				// 240px pane, the "Same commit as the running build" line sliced.
				const leftShown = !!leftPaneEl && getComputedStyle(leftPaneEl).display !== 'none';
				const available = leftShown ? (leftPaneEl?.getBoundingClientRect().height ?? 0) : 0;
				rightPaneMaxHeight = available > 0 && rightNatural < available ? rightNatural : null;
				leftPaneMaxHeight = null;
			}
		}

		recompute();
		// A second pass after layout settles: the effect's own `recompute()`
		// can land between the DOM update and the browser's next layout (e.g.
		// while `{#await loadAnnotationsOnDemand}` rows are still resolving
		// their build-date line), and a `requestAnimationFrame` catches that
		// without re-measuring on every animation frame forever.
		const raf = requestAnimationFrame(recompute);
		const ro = new ResizeObserver(recompute);
		ro.observe(list);
		ro.observe(right);
		ro.observe(rightContent);
		ro.observe(rightFooter);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
		};
	});

	/**
	 * ⭐ STEP 2 STARTS SCROLLED TO ITS OWN TOP, ALWAYS. (user3 repro, 390 dark,
	 * hello-world-prod/hello-world-app -> Change Version -> pick 0afab6f)
	 * Measured live: the amber `Rollback 064b655 -> 0afab6f` step header sat
	 * mostly scrolled OUT of view under the sticky title, its bottom edge
	 * showing at y~=185 -- the content region had a non-zero initial
	 * `scrollTop` the instant it appeared, not a user scroll. Two candidate
	 * causes, both real and both covered by the same fix: (1) flowbite's own
	 * `Dialog.svelte` autofocuses the first focusable
	 * `input, textarea, select, button` in DOM order on `showModal()` — on a
	 * rollout with `mustPin` true (every rollback), the footer's `<textarea>`
	 * is the first ELIGIBLE one once the picker's own search input is
	 * `hidden` (mobile, past a pick), and a browser scrolls a newly-focused
	 * element into view; (2) CSS scroll anchoring, which can shift a
	 * scrollable ancestor's position when content above the viewport changes
	 * size — exactly what happens when the grid goes from one column to two
	 * and the left picker collapses to `hidden` at mobile. Rather than
	 * chase which one fired on a given browser, this resets BOTH scroll
	 * containers a person could land in — `rightContentEl` itself, and
	 * flowbite's own outer body wrapper (`<dialog><div class="... overflow-y-auto
	 * ...">`, the direct child of `<dialog>` this component's own markup
	 * lives inside) — to the top the instant step 2's content exists.
	 * Depends only on `selectedVersion` and `rightContentEl`, NOT on the
	 * effect above's `ResizeObserver`, so switching preview or annotations
	 * loading later never yanks a reader's own manual scroll back to zero.
	 */
	$effect(() => {
		if (!selectedVersion || !rightContentEl) return;
		rightContentEl.scrollTop = 0;
		if (rightPaneEl) rightPaneEl.scrollTop = 0;
		const flowbiteBody = rightContentEl.closest('dialog')?.firstElementChild as HTMLElement | null;
		if (flowbiteBody) flowbiteBody.scrollTop = 0;
	});

	// --- Override context: WHO this force-deploy overrides ----------------
	// ⭐ THE PROD FORCE-DEPLOY DIALOG NAMED NO RULE. The banner behind it says
	// `2 rules` and the Dependencies tab names the contract, provider and
	// version; this dialog said only "a rule is holding it". Naming the gates
	// needs the `Environment`/`RolloutDependency` objects the gate names join
	// against, and neither rides on the `Rollout` this modal already has —
	// every call site passes the bare rollout. Rather than plumb a new prop
	// through five route files this modal does not own, it fetches its own
	// namespace-scoped copy of the same list `/environments`, `/apps` and the
	// Dependencies tab already read (`/api/rollouts?namespace=…`), lazily,
	// only once the dialog is actually about to show the override notice.
	let overrideEnvironments = $state<Environment[]>([]);
	let overrideDependencies = $state<RolloutDependency[]>([]);
	let overrideContextLoadedFor = $state<string | null>(null);
	/**
	 * ⭐ THE JOIN'S OWN LOADEDNESS, SEPARATE FROM `overrideContextLoadedFor`.
	 * (2026-09-04, load-state audit finding 12) `overrideContextLoadedFor` is
	 * a de-dupe guard — it is set the instant the fetch STARTS, so it was
	 * being read as "the data is here" when it only meant "we asked". Before
	 * the response lands, `overrideFact` had nothing to join against and fell
	 * to its own last-resort branch — the gate's raw generated id
	 * (`GHD-XM669`), exactly the "finished sentence that is wrong" the
	 * audit's principle 4 bans. `overrideContextReady` flips true once the
	 * fetch has actually resolved (success OR failure — a failed join still
	 * means "no more join data is coming", not "still pending") for the
	 * namespace it was asked about, so a caller can withhold the row until
	 * then instead of printing a guess.
	 */
	let overrideContextReady = $state(false);

	async function loadOverrideContext(namespace: string) {
		overrideContextReady = false;
		try {
			// The namespace-scoped list carries this namespace's gates and
			// dependencies; the app's sites & waves topology needs EVERY
			// namespace's Environments for this app (staging lives in another
			// namespace than prod), so the fleet list is read alongside it.
			const [response, fleet] = await Promise.all([
				fetch(apiPath(cluster, `/rollouts?namespace=${encodeURIComponent(namespace)}`)),
				fetchRolloutsList().catch(() => null)
			]);
			if (!response.ok) return;
			const data = await response.json();
			const seen = new Set<string>();
			overrideEnvironments = [
				...(data?.environments?.items ?? []),
				...((fleet?.environments?.items ?? []) as Environment[])
			].filter((e: Environment) => {
				const k = `${e.metadata?.namespace}/${e.metadata?.name}`;
				if (seen.has(k)) return false;
				seen.add(k);
				return true;
			});
			overrideDependencies = data?.rolloutDependencies?.items ?? [];
		} catch {
			// Best-effort: the notice sentence above the list already states the
			// consequence on its own, so a failed join just leaves the list empty
			// rather than blocking the dialog.
		} finally {
			overrideContextReady = true;
		}
	}

	// --- Deploy footer state ---------------------------------------------
	// the platform the shortcut hint is spelled for; set after mount so SSR and hydration agree (QA #22)
	let platform = $state<string | null>(null);
	$effect(() => {
		platform = navigator.platform;
	});
	let pinVersionToggle = $state(false);
	let deployExplanation = $state('');
	let deployConfirmationVersion = $state('');
	/**
	 * ⭐ THE CONFIRM BUTTON'S PENDING STATE. (B3, 2026-09-03, operator walk)
	 * See `handleDeploy`'s own note: set the instant the request is sent,
	 * cleared in `finally` so an error re-arms the button rather than leaving
	 * it permanently spinning.
	 */
	let deploying = $state(false);

	let showLocalToast = $state(false);
	let localToastMessage = $state('');
	let localToastType = $state<'success' | 'error'>('success');

	$effect(() => {
		if (open) {
			selectedVersion = initialSelectedVersion;
			deployExplanation = initialExplanation;
			deployConfirmationVersion = '';
			searchQuery = '';
			showAllTags = false;
			deploying = false;
			activeVersionIndex = 0;
			// `initialSelectedVersion` is never a picker pick — see
			// `reachedViaPicker`'s own doc comment.
			reachedViaPicker = false;
			attemptedDeploy = false;
			showAllCommits = false;
		}
	});

	/**
	 * ⭐ ROUND 5 (squad-rollout, Lane D, AD round 3, item 1 — "Lock the page
	 * behind the dialog (body overflow hidden while it's open on a
	 * phone)."). Flowbite's native `<dialog>` + `showModal()` does NOT by
	 * itself stop the PAGE underneath from scrolling on a touch browser —
	 * only the dialog's own box is a modal, the body behind it is still a
	 * normal scrollable document. Measured live on the mobile profile: a
	 * touch-scroll that started outside this dialog's own internal
	 * scroller moved the page behind it instead, which shifts the visual
	 * viewport (the on-screen address bar collapsing/expanding) out from
	 * under the dialog's `max-sm:h-dvh` sizing mid-gesture — the symptom
	 * the AD named ("the header scrolls away with the body… the from-tile
	 * slides under a fixed header and its sha gets sliced") is that
	 * reflow, not a bug in this dialog's own internal flex layout. `sm`+
	 * never reaches this: the page itself doesn't need to scroll there,
	 * the dialog is a centred box over a static backdrop. `matchMedia`
	 * reads the breakpoint once per open rather than tracking resize —
	 * a phone does not become a desktop mid-dialog.
	 */
	$effect(() => {
		if (!open || typeof document === 'undefined') return;
		if (!window.matchMedia('(max-width: 639px)').matches) return;
		// ⭐ round 6: COUNTED, shared with RecoveryModeWarningModal. The warning
		// closes right after this confirm opens; a saved-and-restored value let
		// its cleanup unlock the page under this sheet (measured: body
		// `visible` on the recovery rollback at 390).
		const w = window as unknown as { __bodyLockCount?: number };
		w.__bodyLockCount = (w.__bodyLockCount ?? 0) + 1;
		document.body.style.overflow = 'hidden';
		return () => {
			w.__bodyLockCount = Math.max(0, (w.__bodyLockCount ?? 1) - 1);
			if (w.__bodyLockCount === 0) document.body.style.overflow = '';
		};
	});

	/**
	 * ⭐ THE DIALOG'S OWN COPY OF THE DEPENDENCY GRAPH, FOR WHEN NO CALLER
	 * OVERRIDES `contractHeldVersions`. (2026-10-09, integration round 4,
	 * item follow-up — see that prop's own doc comment above for the root
	 * cause.) Built off the SAME `/api/rollouts` payload and the SAME
	 * `rolloutsListQueryOptions` query key every other graph view in the
	 * product reads (`/apps/<name>`, rollout detail's own `providerNetwork`)
	 * — a page that already has this query running gets a cache hit, never a
	 * second request, because TanStack Query dedupes observers by key
	 * regardless of which component asked first.
	 *
	 * ⛔ ONLY FETCHED WHILE THE DIALOG IS OPEN AND NO OVERRIDE WAS GIVEN.
	 * `enabled` keeps `history`/`FailurePanel` — which run no fleet-wide list
	 * query at rest — from firing one on every page load; `open` alone would
	 * still fire it the instant the dialog mounts even when rollout detail's
	 * own override makes the answer unnecessary.
	 *
	 * ⛔ NO `gates` CONTEXT. `buildRolloutGraph`'s `gates` argument only
	 * shapes NODE state (`holds`/`waiting`/`blocked` — see its own doc
	 * comment, "NODE STATE, AND THE GATES THAT ARE NOT EDGES"); the CONTRACT
	 * EDGE state this dialog actually reads is resolved earlier, straight off
	 * `rollout.status.gates` and the `RolloutDependency` objects themselves,
	 * so omitting it (same as the agreement test's own `graphFor`) changes
	 * nothing about the answer and avoids rebuilding the schedule/approval
	 * join this dialog has no use for.
	 */
	const selfHeldGraphEnabled = $derived(open && contractHeldVersions === undefined);
	const selfHeldGraphQuery = createQuery(() => ({
		...rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000, 300_000) } }),
		enabled: selfHeldGraphEnabled
	}));
	const selfHeldGraphEnvOrder = $derived(
		[
			...new Set(
				(selfHeldGraphQuery.data?.environments?.items ?? [])
					.map((e: Environment) => e.spec?.environment)
					.filter(Boolean) as string[]
			)
		].sort(compareEnvironmentNames)
	);
	/**
	 * ⭐ THE REAL ROOT CAUSE, FOUND ON ROUND 2. (squad-rollout, Lane D,
	 * 2026-10-09 — "first find out why the rollout list 'failed' on a
	 * healthy mock.") It never failed: `curl /api/rollouts` on 5250 returns
	 * `checkout-edge-prod/checkout-edge` in the payload every time, and so
	 * does this query once it settles. The miss was `graphNodeForRollout`
	 * (`app-tasks.ts`), which filters `graph.nodes` — NODES ALREADY IN THE
	 * GRAPH, never a fresh sweep over `rollouts` — and `buildRolloutGraph`
	 * only ever creates a node for a rollout that is a consumer or provider
	 * of a `RolloutDependency` edge (its own doc comment: "A ROLLOUT THAT
	 * IS ALWAYS A NODE, EDGES OR NOT", the fix the Gates tab already needed
	 * for the identical reason). `checkout-edge` has no dependency edges at
	 * all — a perfectly ordinary leaf service — so it never had a node,
	 * `selfHeldNode` was always `null`, and EVERY row downstream read as a
	 * permanent unknown, never because anything failed to load.
	 *
	 * `focus` (same shape the Gates tab already passes) makes this graph
	 * include the dialog's OWN rollout as a node even with zero edges, so
	 * `contractHeldVersionsFor` — which only ever needed the node to find
	 * ZERO blocked edges pointing at it, see its own one-line body — reads
	 * the correct, immediate answer: "no dependency, never held", not
	 * "unknown, ask again never." `heldStatePending`/`heldStateErrored`
	 * below are UNCHANGED — they still cover a genuine slow/failed fetch —
	 * this only stops a leaf service from manufacturing one.
	 */
	const selfHeldGraph = $derived(
		buildRolloutGraph({
			rollouts: (selfHeldGraphQuery.data?.rollouts?.items ?? []) as Rollout[],
			environments: (selfHeldGraphQuery.data?.environments?.items ?? []) as Environment[],
			dependencies: (selfHeldGraphQuery.data?.rolloutDependencies?.items ??
				[]) as RolloutDependency[],
			envOrder: selfHeldGraphEnvOrder,
			...(rollout?.metadata?.namespace && rollout?.metadata?.name
				? {
						focus: {
							cluster: cluster ?? '',
							namespace: rollout.metadata.namespace,
							name: rollout.metadata.name,
							localCluster: cluster
						}
					}
				: {})
		})
	);
	/**
	 * ⭐ ITEM (c), coordinator follow-up, 2026-10-09. THE NODE LOOKUP MUST
	 * SURVIVE AN UNSTAMPED CLUSTER. This used to build a node id by hand
	 * (`nodeId(cluster ?? '', namespace, name)`) and look it up in
	 * `selfHeldGraph.nodes`. `buildRolloutGraph`'s own node ids key off each
	 * rollout's RAW `source-cluster` annotation (`clusterOf`, empty string
	 * when absent) — but a hub-local rollout carries no such annotation,
	 * while THIS prop is `cluster?: string`, which on the page is either
	 * `undefined` (a hub route) or the SPOKE's name (never `''`). The two
	 * conventions only coincide by accident; a caller that passes `cluster`
	 * as the page's `localClusterName` (plausible — it is the page's own
	 * name for "here") would build `"<localClusterName>/<ns>/<name>"` and
	 * never match this rollout's own `"/<ns>/<name>"` node, at which point
	 * `contractHeldVersionsFor` would have silently answered for a node
	 * that does not exist.
	 *
	 * `graphNodeForRollout` (`app-tasks.ts`) is the SAME lookup `/apps/[name]`
	 * already uses for exactly this reason (see its own doc comment): match
	 * on namespace + name alone, which is always stable, and let the graph's
	 * own `clusterOf` convention stay internal to how the id was BUILT, never
	 * part of how it is FOUND.
	 */
	/**
	 * ⭐ ITEM 4 (coordinator, 2026-10-09). `cluster` (this component's own
	 * prop) IS NOW PASSED THROUGH as the fourth, tie-breaking argument —
	 * `graphNodeForRollout`'s own doc comment (`app-tasks.ts`) explains why
	 * this cannot regress the hub-local `''`-vs-`localClusterName` case
	 * item (c) fixed: it is read only when more than one node shares this
	 * rollout's namespace+name, which a single-cluster graph never has.
	 */
	const selfHeldNode = $derived(
		rollout ? graphNodeForRollout(selfHeldGraph, rollout, undefined, cluster) : null
	);
	/**
	 * ⭐ ITEM 2 (coordinator, 2026-10-09). "UNKNOWN" MUST NOT MEAN "FOREVER".
	 * `/api/rollouts` can fail outright (network, 5xx) — `selfHeldGraphQuery`
	 * then SETTLES with `isError: true`, `isLoading: false`, and `data`
	 * unchanged (`undefined`). Before this flag existed, that read as
	 * EXACTLY the `selfHeldNodeMissing` shape below (settled, no data, no
	 * node) forever — the held state never had anywhere else to go, so
	 * `heldStatePending` stayed `true` and the dialog said "Checking whether
	 * this build is held…" for a request that will never resolve. Measured:
	 * reject `/api/rollouts`, open the dialog, wait — the blocker sentence
	 * never changes and `Deploy` never un-sticks.
	 *
	 * `selfHeldGraphEnabled` scopes it the same way every other self-derived
	 * flag here is scoped: only meaningful while THIS dialog is the one
	 * doing the asking (`open && contractHeldVersions === undefined`).
	 */
	const selfHeldGraphErrored = $derived(selfHeldGraphEnabled && selfHeldGraphQuery.isError);
	/**
	 * Genuinely unresolvable, not merely loading: the self-derivation path is
	 * active, the query has SETTLED WITHOUT ERROR (so an empty graph is not
	 * just "not fetched yet", and a FAILED request — `selfHeldGraphErrored` —
	 * is excluded here and gets its own, distinct dev signal below, rather
	 * than being misreported as "the lookup itself failed"), there is a
	 * rollout to look for, and it still is not in its own graph.
	 * `console.warn` only in dev — this is a signal for whoever wired a new
	 * call site, never a thing an operator should see.
	 */
	const selfHeldNodeMissing = $derived(
		contractHeldVersions === undefined &&
			!selfHeldGraphQuery.isLoading &&
			!selfHeldGraphErrored &&
			!!rollout &&
			!selfHeldNode
	);
	$effect(() => {
		if (!import.meta.env.DEV) return;
		// ⭐ ITEM 2 (coordinator, 2026-10-09): THE DEV WARNING NAMES WHICH OF THE
		// TWO FAILURES IT IS. Both used to read identically to a developer
		// watching the console — "the lookup came back empty" — which is true
		// of a node that genuinely is not in the graph and false of a graph
		// this dialog never even received. Checked first, and returns: a
		// failed request has no node to report on either way.
		if (selfHeldGraphErrored) {
			const errNs = rollout?.metadata?.namespace ?? '?';
			const errName = rollout?.metadata?.name ?? '?';
			console.warn(
				'ChangeVersionModal: /api/rollouts failed — contract-hold state for ' +
					errNs +
					'/' +
					errName +
					' could not be checked — a list failure, not a lookup miss. Falling back to' +
					' the explicit risk path, never asserting "not held".'
			);
			return;
		}
		if (!selfHeldNodeMissing) return;
		const ns = rollout?.metadata?.namespace;
		const name = rollout?.metadata?.name;
		const clusterLabel = cluster ?? '(hub)';
		console.warn(
			'ChangeVersionModal: ' +
				ns +
				'/' +
				name +
				' was not found in its own dependency graph (cluster=' +
				clusterLabel +
				') — a lookup miss, not a list failure. Treating its held state as unknown, never Ready.'
		);
	});
	/**
	 * The effective held set: the caller's override when one was given, else
	 * this dialog's own answer from `selfHeldGraph`. Both resolve through the
	 * SAME `contractHeldVersionsFor` (`dependency-graph.ts`), so the two paths
	 * cannot drift from one another by construction. `selfHeldNodeMissing`
	 * (above) falls through to an empty set here exactly as "still loading"
	 * does — `heldStatePending` (below) is what keeps that empty set from
	 * ever being read as "nothing is held".
	 */
	const effectiveContractHeldVersions = $derived(
		contractHeldVersions ??
			(selfHeldNode ? contractHeldVersionsFor(selfHeldGraph, selfHeldNode.id) : new Set<string>())
	);

	/**
	 * ⭐ ITEM (b), coordinator follow-up, 2026-10-09. THE HELD SET IS EMPTY
	 * WHILE THE GRAPH IS STILL LOADING, AND EMPTY IS NOT THE SAME FACT AS
	 * "NOTHING IS HELD". `effectiveContractHeldVersions` falls back to
	 * `contractHeldVersionsFor(selfHeldGraph, ...)`, and before
	 * `selfHeldGraphQuery` has resolved ONCE, `selfHeldGraph` is built off
	 * `[]`/`[]`/`[]` — a graph with no edges at all, which answers "held" the
	 * same way a graph that genuinely has no contracts would. Measured live:
	 * opening this dialog from a cold cache on `checkout-api`/`prod-us-east-2`
	 * showed `4.43.0-43` reading plain (no `held` chip) for the first paint,
	 * then the chip appeared once the list query landed — a real build
	 * silently misreported, not a build this dialog is actually unsure about.
	 *
	 * Only true while the dialog is relying on ITS OWN derivation
	 * (`contractHeldVersions === undefined`, same guard `selfHeldGraphEnabled`
	 * uses) — a caller that passes the prop has already resolved it, by
	 * definition, so there is nothing to wait for.
	 *
	 * ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D — §4, "fix today's
	 * defect: an empty 40×16 grey box renders beside every sha… a skeleton
	 * that never resolves"). Item (c) above folded `selfHeldNodeMissing` into
	 * PENDING on the reasoning that a lookup miss and a slow network read the
	 * same to the operator — both withhold "Ready". True, but it also means
	 * a node that will NEVER be found (measured live: `checkout-edge-prod/
	 * checkout-edge` — the picker's `SkeletonBar` beside every single row,
	 * forever, once the list query settles) never leaves the loading state
	 * either, which is exactly the "skeleton that never resolves" defect.
	 * `heldStateErrored` already exists for "a known unknown that will not
	 * resolve on its own" (`selfHeldGraphErrored`, below) and already carries
	 * the correct safety property — `needsTypedConfirmation` treats it as
	 * risk, never as "Ready" — so a permanently-missing node now joins it
	 * instead of staying in `heldStatePending`, which is reserved for the
	 * query genuinely still being in flight.
	 */
	const heldStatePending = $derived(
		contractHeldVersions === undefined &&
			!selfHeldGraphErrored &&
			!selfHeldNodeMissing &&
			selfHeldGraphQuery.isLoading
	);
	/**
	 * ⭐ ITEM 2 (coordinator, 2026-10-09). THE THIRD STATE — NOT YET KNOWN,
	 * BUT ALSO NEVER GOING TO RESOLVE ON ITS OWN. `heldStatePending` (above)
	 * now excludes this case by construction (`!selfHeldGraphErrored`), so a
	 * failed list request no longer wedges the dialog in "Checking…"
	 * forever — see `selfHeldGraphErrored`'s own comment for the measured
	 * defect this fixes. `selfHeldNodeMissing` (squad-rollout, Lane D) joins
	 * it here for the same reason: a lookup miss that will never resolve is
	 * the same user-facing shape as a request that failed outright, not an
	 * in-flight one.
	 */
	const heldStateErrored = $derived(
		contractHeldVersions === undefined && (selfHeldGraphErrored || selfHeldNodeMissing)
	);

	const releaseList = $derived(availableReleases(rollout) ?? []);
	const currentTag = $derived(rollout?.status?.history?.[0]?.version?.tag ?? null);
	/**
	 * ⭐ THE TITLE NAMES WHERE THIS LANDS. (operator walk, 2026-09-03)
	 * `Change Version / hello-world-app` said nothing about WHICH
	 * `hello-world-app` — the same header renders for every environment this
	 * app runs in. `rolloutEnvironmentName` is the same derivation
	 * `ClearPinModal`'s title already uses; `cluster` only prints when this
	 * rollout lives on a spoke, which is the one case one environment name
	 * can mean two different clusters.
	 */
	/**
	 * ⭐ AS WRITTEN, NEVER UPPERCASE. (round 2, 2026-10-08, design review 4)
	 * `.toUpperCase()` broke principle 11 — an environment is drawn one way
	 * everywhere: the name as written, a neutral chip, a 6px identity dot.
	 * Uppercase is for STATE labels (`t-label`), not identity.
	 */
	const envLabel = $derived(rolloutEnvironmentName(rollout, environmentName));
	/**
	 * ⭐ ROUND 5 (coordinator, final design review): THE DOT WAS MISSING.
	 * `getRolloutEnvironmentTheme(rollout, environmentName)` — the bare
	 * `environmentName` PROP — resolves an identity colour only through its
	 * own narrow string branch, and skips its labels-fallback branch
	 * entirely (that one only fires for a truthy OBJECT second argument,
	 * never for `null`). On this rollout the Overview page's own
	 * `environment` object was `null` (no bound Environment record it could
	 * find), so it passed `environmentName={null}` down — and the Navbar's
	 * OWN breadcrumb call, `getRolloutEnvironmentTheme(rollout, rolloutQuery
	 * .data?.environment)`, gets the full object and never hits this gap.
	 *
	 * `envLabel` just above is already the ROBUST resolution — the same
	 * `rolloutEnvironmentName` helper that falls through `environmentName`
	 * → `metadata.labels.environment` → `metadata.annotations[...]` →
	 * `metadata.namespace`, so it is NEVER empty while `rollout` exists
	 * (confirmed live: it read "staging" here while the raw prop was
	 * `null`). Feeding `getRolloutEnvironmentTheme` that already-resolved
	 * NAME instead of the possibly-null prop lands it in the SAME string
	 * branch the breadcrumb's object argument's OWN internal fallback would
	 * have reached — no new prop, no call-site change, same identity colour
	 * the breadcrumb chip shows for this exact rollout. Still `null` only
	 * when the rollout truly carries no environment fact of any kind — the
	 * crumb then falls back to plain text, unchanged from before this round.
	 */
	const envTheme = $derived(getRolloutEnvironmentTheme(rollout, envLabel));
	/**
	 * ⛔ NOT WHEN IT REPEATS THE ENVIRONMENT. (coordinator residue,
	 * 2026-09-03) On the prod rollout `cluster` is also literally `"prod"`
	 * (this cluster's own name), so the naive "cluster ? show : don't" this
	 * mirrored from `ClearPinModal` printed `PROD · PROD` — the suffix
	 * added nothing a reader didn't already have. It earns its place only
	 * when it says something `envLabel` does not: a DIFFERENT string,
	 * case-insensitively (`cluster` and the environment label are never in
	 * the same case).
	 */
	// ⭐ round 7 (coordinator, AD r6 item 7): ALSO not when the environment
	// already spells the tier — `prod-us-east-2 · prod` repeated "prod".
	const clusterLabel = $derived.by(() => {
		if (!cluster) return null;
		const c = cluster.toLowerCase();
		const e = envLabel.toLowerCase();
		return c === e || e.startsWith(`${c}-`) || e.endsWith(`-${c}`) ? null : cluster;
	});
	// Display form (semver/revision) of the currently-deployed version, so the
	// delta summary reads consistently with the picked side rather than dumping
	// the raw OCI tag.
	const currentDisplayVersion = $derived(
		rollout?.status?.history?.[0]?.version
			? getDisplayVersion(rollout.status.history[0].version)
			: (currentTag ?? '')
	);
	const currentRevision = $derived(rollout?.status?.history?.[0]?.version?.revision ?? null);
	// WHEN THIS ROLLOUT ACTUALLY DEPLOYED the running build — distinct from
	// `created` (the image's build time) below.
	const currentDeployedAt = $derived(rollout?.status?.history?.[0]?.timestamp ?? null);

	/**
	 * ⭐ ITEM 3 (coordinator, 2026-10-09). MOVED TO `deploy-risk.ts` — see
	 * that export's own doc comment for why (the agreement test needed a
	 * real function to call, not this component's closure to reimplement).
	 * This wrapper keeps every call site in the template unchanged
	 * (`pickerRankLabel(versionTag)`, not `pickerRankLabel(rollout,
	 * versionTag)` at each of the two call sites) while reading the SAME
	 * export `currentTag`'s test coverage already exercises.
	 */
	function pickerRankLabel(versionTag: string): string | null {
		return pickerRankLabelFn(rollout, versionTag);
	}

	/**
	 * ⭐ ITEM (b), coordinator follow-up, 2026-10-09. THE DEPLOY BUTTON'S OWN
	 * READ OF THE SAME UNKNOWN. Same three-way split the picker row below
	 * computes per-row (gate-held / contract-held / genuinely unknown), run
	 * once for whichever version is actually selected — this is what the
	 * Deploy button gates on. A gate-held build is already KNOWN held
	 * (`!isDeployable`, synchronous, no query involved); only a build that
	 * passes every gate and is waiting on the contract graph
	 * (`heldStatePending`) is genuinely unknown, and this dialog may not
	 * deploy a build whose held state it cannot yet vouch for.
	 */
	const selectedVersionIsNewerCandidate = $derived(
		!!selectedVersion &&
			selectedVersion !== currentTag &&
			(pickerRankLabel(selectedVersion)?.endsWith('newer') ?? false)
	);
	const selectedVersionGateHeld = $derived(
		!!selectedVersion && !isDeployable(rollout, selectedVersion)
	);
	const selectedVersionHeldPending = $derived(
		selectedVersionIsNewerCandidate && !selectedVersionGateHeld && heldStatePending
	);
	/**
	 * ⭐ ITEM 2 (coordinator, 2026-10-09). THE SAME SPLIT, FOR THE ERRORED
	 * CASE. A build that passes every gate and whose contract-hold state
	 * could not be checked (`heldStateErrored`) is not "Checking…" any more
	 * — it is a known unknown, and `needsTypedConfirmation` (below) treats it
	 * as risk, the same way `confirmLevel` already treats an unvouched build:
	 * the existing typed-confirmation ceremony, not a new blocking state.
	 */
	const selectedVersionHeldErrored = $derived(
		selectedVersionIsNewerCandidate && !selectedVersionGateHeld && heldStateErrored
	);

	/** The date half of the row's second line — build date, and deploy date
	 * on the current row only. `null` when there is nothing to say. The rank
	 * (`pickerRankLabel`) is rendered separately by the template now (P6,
	 * 2026-09-03, operator walk) so a `back` row can carry its own warm ink
	 * without recolouring the dates beside it. */
	function pickerRowLine(created: string | undefined, isCurrent: boolean): string | null {
		const parts: string[] = [];
		if (created) parts.push(`Built ${formatTimeAgo(created)}`);
		if (isCurrent && currentDeployedAt) parts.push(`Deployed ${formatTimeAgo(currentDeployedAt)}`);
		return parts.length > 0 ? parts.join(' · ') : null;
	}

	/**
	 * ⭐ (2026-10-10, truth-bug fix) THERE IS NO MORE `commitTitleOf` FOR A
	 * SINGLE RELEASE. It used to prefer a mock-only `commitMessage` field
	 * over the GitHub-sourced title below — and `availableReleases` never
	 * actually carried that field (only `history[]` entries did), so a
	 * release read here printed "No commit message" while the SAME build's
	 * History row, reading the other field, printed a real sentence; where
	 * both a mock release's hand-written title and `github-data.ts`'s own
	 * title existed, they simply disagreed (confirmed live on `4d0b7e8`:
	 * "Bump go to 1.23" here, "Add circuit breaker for upstream
	 * checkout-api calls" in this same dialog's own commit list, two lines
	 * down). The tiles now read `headCommit`/`fromTileCommit`/
	 * `toTileCommit` only (below); the picker's many rows read
	 * `pickerTitleBySha` (below `commitsQuery`), a batched, one-hop-per-row
	 * query over the SAME `commitsQueryOptions` the tiles and
	 * `history/+page.svelte`'s rows already use for identical pairs.
	 */

	/**
	 * ⭐ ONE SENTENCE, FROM WHICHEVER SOURCE ALREADY HAS IT. See the call
	 * site's own doc comment for why this never fires a new fetch: a
	 * gate-held row reads `rollout.status.gates` (already in hand), a
	 * contract-held row reads `selfHeldGraph.edges` (already in hand
	 * whenever this dialog is the one deriving the held set itself).
	 */
	function heldReasonFor(
		versionTag: string,
		displayVersion: string,
		isGateHeld: boolean
	): string | null {
		if (isGateHeld) {
			const gate = (rollout?.status?.gates ?? []).find((g) => !gateAllows(g, versionTag));
			return gate?.name ? `Held by ${gateLabelMarked(gateLabel(gate, nameOfGate(gate.name)))}` : null; /* a promotion gate is named by kind, never by its published sentence */
		}
		const edge = selfHeldGraph.edges.find(
			(e) => e.writer === 'contract' && e.state === 'blocked' && e.held.includes(displayVersion)
		);
		if (!edge) return null;
		const needClause = edge.requiredVersion
			? `needs ${edge.contract ?? 'a contract'} ${edge.requiredVersion}`
			: `needs a newer ${edge.contract ?? 'contract'}`;
		return edge.providedVersion
			? `Held — ${needClause}, has ${edge.providedVersion}`
			: `Held — ${needClause}`;
	}

	async function getAnnotations(version: string) {
		if (!rollout) return;
		loadingAnnotations[version] = true;
		loadingAnnotations = { ...loadingAnnotations };
		try {
			const response = await fetch(
				apiPath(
					cluster,
					`/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/annotations/${version}`
				)
			);
			annotations[version] = response.ok ? (await response.json()).annotations || {} : {};
			annotations = { ...annotations };
		} catch {
			annotations[version] = {};
			annotations = { ...annotations };
		} finally {
			loadingAnnotations[version] = false;
			loadingAnnotations = { ...loadingAnnotations };
		}
	}

	async function loadAnnotationsOnDemand(versionTag: string): Promise<void> {
		const isKnownRelease = releaseList.some((entry) => entry.tag === versionTag);
		if (!isKnownRelease && !annotations[versionTag]) {
			await getAnnotations(versionTag);
		}
	}

	async function getAllRepositoryTags() {
		if (!rollout) return;
		loadingAllTags = true;
		try {
			const response = await fetch(
				apiPath(cluster, `/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/tags`)
			);
			allRepositoryTags = response.ok ? (await response.json()).tags || [] : [];
		} catch {
			allRepositoryTags = [];
		} finally {
			loadingAllTags = false;
		}
	}

	// Unified newest-first version list: available releases plus any extra
	// repository tags not already covered, when "show all" is toggled on.
	const allVersionsForDisplay = $derived.by(() => {
		const standardReleases = [...releaseList].reverse();
		if (!showAllTags) return standardReleases;
		const additionalTags = allRepositoryTags.filter(
			(tag) => !releaseList.some((ar) => ar.tag === tag)
		);
		return [...standardReleases, ...additionalTags];
	});

	/** Registry tags the release list does not already carry — what "show all" adds. */
	const extraTagCount = $derived(
		allRepositoryTags.filter((tag) => !releaseList.some((ar) => ar.tag === tag)).length
	);

	const filteredVersionsForDisplay = $derived(
		allVersionsForDisplay.filter((version) => {
			const versionTag = typeof version === 'string' ? version : version.tag;
			return searchQuery === '' || versionTag.toLowerCase().includes(searchQuery.toLowerCase());
		})
	);

	/**
	 * ⭐ GROUP HEADERS, THE RUNNING BUILD AS THE ANCHOR. (squad-rollout, Lane
	 * D, §4: "Group headers … so the running build is the anchor.") The list
	 * is already newest-first (`allVersionsForDisplay`), so a build's group
	 * is decided once, here, by the SAME `pickerRankLabel` the row's own
	 * quiet fact already reads — never a second classification that could
	 * drift from the label sitting right beside it. One pass, one label per
	 * group boundary (`null` for every row that continues the group above
	 * it) so the template can test a single value per row instead of
	 * recomputing "is this the first row of its group" itself.
	 */
	const versionGroupLabels = $derived.by(() => {
		const labels: (string | null)[] = [];
		let lastGroup: string | null = null;
		for (const version of filteredVersionsForDisplay) {
			const versionTag = typeof version === 'string' ? version : version.tag;
			const rank = pickerRankLabel(versionTag);
			const group =
				versionTag === currentTag
					? 'Running'
					: (rank?.endsWith('newer') ?? false)
						? 'Newer than running'
						: 'Older';
			labels.push(group === lastGroup ? null : group);
			lastGroup = group;
		}
		return labels;
	});

	/**
	 * ⭐ "BACK TO WHAT?" (squad-rollout, Lane D, round 3 — AD item 8: "A
	 * back chevron on a rollback opened straight from the banner (back to
	 * what?), none at 1440 even after the picker.") The chevron used to be
	 * unconditional (any `selectedVersion`, `md:hidden`) — wrong on BOTH
	 * counts: a "Roll back to X" button skips the picker entirely
	 * (`initialSelectedVersion`), so there is no step 1 to go back TO; and
	 * a picker pick at `md`+ hid the chevron that WOULD have had somewhere
	 * real to go. This flips to `true` only on an actual in-dialog pick
	 * (`selectVersion`, below — never the open-effect's own assignment
	 * from `initialSelectedVersion`), so the chevron now renders exactly
	 * when a previous step exists, at every width.
	 */
	let reachedViaPicker = $state(false);

	function selectVersion(versionTag: string) {
		selectedVersion = versionTag;
		reachedViaPicker = true;
	}

	// --- Direction + changelist -------------------------------------------
	const selectedRelease = $derived(
		releaseList.find((r) => r.tag === selectedVersion) ?? null
	);
	// The currently-deployed release's own `VersionInfo` — the OTHER half
	// `requirementsChangedSentence` needs. Separate from `currentTag` (a bare
	// string): this is the object `releaseRequires` reads `requires` off.
	const currentRelease = $derived(releaseList.find((r) => r.tag === currentTag) ?? null);
	const selectedRevision = $derived(
		selectedRelease?.revision ||
			annotations[selectedVersion ?? '']?.['org.opencontainers.image.revision'] ||
			null
	);

	/**
	 * DIRECTION, TARGET AND VOUCHING — one object, computed in
	 * `view-models/deploy-risk.ts` where it has tests. A safety rule that
	 * lives only in a template is one refactor from being lost.
	 */
	const intent = $derived(deployIntent(rollout, selectedVersion, environmentName));
	const direction = $derived(intent.direction);
	/** `targetPhrase` capitalized for the one place it opens a sentence. */
	const targetPhraseCapitalized = $derived.by(() => {
		const t = targetPhrase(intent);
		return t.charAt(0).toUpperCase() + t.slice(1);
	});

	// Commit range is always requested oldest→newest; direction only changes
	// how it's labeled (added vs. reverted).
	const compareBase = $derived(direction === 'rollback' ? selectedRevision : currentRevision);
	const compareHead = $derived(direction === 'rollback' ? currentRevision : selectedRevision);

	const canFetchCommits = $derived(
		!!rollout?.status?.source &&
			!!compareBase &&
			!!compareHead &&
			compareBase !== compareHead &&
			direction !== 'same'
	);

	/**
	 * ⛔ THIS ONE INHERITED THE 5-SECOND POLL, AND IT IS THE WORST SCREEN TO
	 * INHERIT IT ON. The three other commits readers each set their own
	 * `refetchInterval: false`; this one set nothing, so while an operator sat
	 * reading "what am I about to deploy" the dashboard re-asked GitHub for
	 * the same fixed sha range every five seconds. `commitsQueryOptions` is
	 * that policy in one place — see the note on it in `$lib/api/github`.
	 */
	const commitsQuery = createQuery(() =>
		commitsQueryOptions({
			namespace: rollout?.metadata?.namespace ?? '',
			name: rollout?.metadata?.name ?? '',
			base: compareBase,
			head: compareHead,
			cluster,
			enabled: canFetchCommits
		})
	);

	// Distinguish "connect GitHub" / "no access" from a generic failure.
	/* the shared gate (QA2 #4) keeps the request from firing while GitHub is known not connected, so that known state is the reason here (same word the 401 used to produce) */
	const commitsError = $derived<CommitsError | null>(
		commitsQuery.error instanceof FetchCommitsError
			? commitsQuery.error.reason
			: githubKnownDisconnected()
				? 'not_connected'
				: null
	);

	/**
	 * ⭐ NEVER OFFER `Connect GitHub` WITHOUT KNOWING IT WILL WORK. (operator
	 * walk, 2026-09-03) `commitsError === 'not_connected'` fires identically
	 * whether the SERVER has no GitHub App configured at all, or the SERVER
	 * is configured and this one person just hasn't linked their account —
	 * `fetchCommits` cannot tell those apart from a 401 alone. Pressing
	 * `Connect GitHub` in the first case took a live reader to a 503
	 * (`GitHub integration not configured`), raw JSON, no chrome. This is
	 * the same status query `GithubConnectButton` (navbar) and `ChangeList`
	 * (`/activity`) already use — same query key, so it is usually already
	 * cached and this costs nothing extra.
	 */
	const githubStatusQuery = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 60_000,
		refetchInterval: false as const
	}));

	/**
	 * The gate OBJECTS, for their published pretty names (QA #17: the Gates tab said "Manual Approval Required" while this dialog said
	 * "Hello world manual approval"). Same query key as the rollout page's own, so it is normally already cached.
	 */
	const gateObjectsQuery = createQuery(() => ({
		...rolloutQueryOptions({
			namespace: rollout?.metadata?.namespace ?? '',
			name: rollout?.metadata?.name ?? '',
			cluster,
			options: { staleTime: 60_000, refetchInterval: false as const }
		}),
		enabled: open && !!rollout?.metadata?.name
	}));
	const gateObjects = $derived<{ metadata?: { name?: string; annotations?: Record<string, string> } }[]>(
		(gateObjectsQuery.data as { rolloutGates?: { items?: never[] } } | undefined)?.rolloutGates?.items ?? []
	);
	const nameOfGate = (n: string) => resolveGateName(n, gateObjects);

	/** no ReleaseSource: the controller's message (there is no list of releases to pick from) */
	const noReleases = $derived(noReleasesOf(rollout));
	const supportsManifestDiff = $derived(
		rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'
	);
	/**
	 * ⭐ THE SECTION HEADER APPEARS ONLY WHEN THERE IS A LIST TO HEAD.
	 * (squad-rollout, Lane D, round 2, §4: "'Commits to deploy / GitHub did
	 * not answer' leaves a ~60px void … the section header appears only
	 * when there are commits.") Every other branch below this (no source,
	 * no revision, not connected, no access, errored, same-commit) is ONE
	 * sentence; a card-title header plus its own margin above a single line
	 * of prose was the void — a label for a list that was not there.
	 */
	const hasCommitList = $derived(commitsQuery.isSuccess && commitsQuery.data.commits.length > 0);

	// --- Deploy footer logic ------------------------------------------------
	/**
	 * ⛔ THE FRICTION WAS ON THE WRONG DIRECTION. (Reversed 2026-08-31.)
	 *
	 * ── WHAT THIS FILE USED TO SAY, AND WHY IT WAS WRONG ────────────────
	 *
	 * The previous ruling kept typing for *"a ROLLBACK — going backwards
	 * re-runs older code…"* and dropped it for *"a forward deploy to a listed
	 * release candidate — the same move the controller makes unattended"*.
	 * The second half assumed the controller WOULD make that move. It does
	 * not check. A live critic then force-deployed an unvetted build **into
	 * production through three closed gates in two clicks with no
	 * confirmation**, while the rollback out of it demanded a transcribed sha.
	 * The recovery was the slowest action in the product and the irreversible
	 * one was the fastest.
	 *
	 * ── THE RULE NOW ────────────────────────────────────────────────────
	 *
	 * `deploy-risk.ts` weighs three things — direction, whether the target is
	 * production, and whether the gates ACTUALLY allow this build right now —
	 * and returns one of three levels. `typed` fires on two shapes only:
	 * forward into production past rules that refuse the build, and a tag
	 * that is not in the release list at all. `notice` is one sentence and no
	 * input. A rollback never reaches `typed`.
	 *
	 * ⛔ NOT FRICTION EVERYWHERE. Friction that fires on every action stops
	 * being read, and the ordinary vouched deploy to a non-production
	 * environment still asks for nothing at all.
	 */
	const level = $derived(confirmLevel(intent));
	// ⛔ SUPERSEDED, 2026-10-08 (U-23, ledger). This used to be
	// `direction !== 'same'` — "every version change is confirmed by typing
	// it" — so a routine vouched staging deploy and the rollback of a
	// just-failed staging deploy both demanded a transcribed sha, the exact
	// production-tier ceremony `deploy-risk.ts`'s own `confirmLevel` reserves
	// for `typed`. Friction that fires on every action stops being read (the
	// same argument `deploy-risk.ts` already makes about `notice`); the typed
	// box now appears exactly when `confirmLevel` says `typed` — production in
	// either direction, or a tag outside the release list — which is the one
	// shape `deploy-risk.ts` itself calls high-risk. A non-production forward
	// deploy and a non-production rollback still get `deployNotice`'s sentence
	// (the `notice` level, unchanged) with no typing required.
	// ⭐ ITEM 2 (coordinator, 2026-10-09). ALSO `typed` WHEN A HOLD COULD NOT
	// BE CHECKED. `level`/`confirmLevel` are unchanged — `intent.vouched`
	// still answers "do the GATES allow this build", a real, true fact this
	// dialog can state in `confirmNotice`'s own prose. A contract graph that
	// failed to load answers a DIFFERENT question this dialog has no prose
	// for yet (see the dedicated alert, below) — OR'd in here rather than
	// folded into `intent` so the existing typed-confirmation mechanism (the
	// box below, `confirmBlocker`'s own typed-match guard) does the work
	// without `typedPrompt`/`confirmNotice` asserting a claim ("no rule
	// currently allows this build") that would not be true of this case.
	const needsTypedConfirmation = $derived(level === 'typed' || selectedVersionHeldErrored);
	/**
	 * ⭐ THE PICKER'S OWN `N back`, CARRIED INTO THE CONFIRMATION. (B3,
	 * 2026-09-03, operator walk) `pickerRankLabel` already computes this per
	 * row via `releaseIndex`; a rollback's confirmation sentence gets the
	 * same number rather than restating "goes back to a version" with no
	 * count, which was true and told a reader nothing the picker's row had
	 * not already said better.
	 */
	const deployStepsBack = $derived.by<number | null>(() => {
		if (direction !== 'rollback' || !rollout || !currentTag || !selectedVersion) return null;
		const curIdx = releaseIndex(rollout, currentTag);
		const selIdx = releaseIndex(rollout, selectedVersion);
		if (curIdx === -1 || selIdx === -1) return null;
		return curIdx - selIdx;
	});
	// Every gate in `rollout.status.gates` that does not currently allow the
	// SELECTED tag — the exact set the primary button is about to override.
	const overriddenGates = $derived.by(() => {
		if (!rollout || !selectedVersion) return [];
		return (rollout.status?.gates ?? []).filter((g) => !gateAllows(g, selectedVersion as string));
	});
	const deployNotice = $derived(
		selectedVersion
			? confirmNotice(intent, pinVersionToggle, deployStepsBack, overriddenGates.map((g) => nameOfGate(g.name)))
			: null
	);

	/**
	 * ⭐ THE TRANSITION BLOCK IS THE DIALOG'S FACE. (squad-rollout, Lane D,
	 * craft-study addendum, 2026-10-09 — D9/craft-refs/composites/03-
	 * presence-devices.jpg, Vercel's object page: a face, a facts grid,
	 * a who/what/where row.) The confirm step used to spend its one
	 * `bg-subtle` well on a single line ("Deploy" + an arrow between two
	 * `<code>` tags) — true, but nothing in it had WEIGHT; every other
	 * region in the dialog (the commit list, the consequence alert) was
	 * drawn with more care than the one block whose whole job is answering
	 * "what build goes where." Two tiles, a drawn arrow between them, a
	 * `FactList` underneath — the same grammar `FactList`/`Chip`/`t-code-lg`
	 * already give every other object page in the product, not a new one.
	 *
	 * ⛔ ONLY THE `compareHead` SIDE GETS A COMMIT. GitHub's own compare API
	 * (`base...head`) returns commits STRICTLY AFTER `base`, so the base
	 * build's own commit is never actually in the list `commitsQuery`
	 * returns — only `compareHead`'s is (the newest entry, oldest→newest
	 * order). `compareHead` is `selectedRevision` on a forward deploy and
	 * `currentRevision` on a rollback (`compareBase`/`compareHead`, above) —
	 * so the commit title + author lands on whichever TILE that build is,
	 * never invented for the side the API never actually named.
	 */
	const headCommit = $derived(
		commitsQuery.data && commitsQuery.data.commits.length > 0
			? commitsQuery.data.commits[commitsQuery.data.commits.length - 1]
			: null
	);
	const fromTileCommit = $derived(direction === 'rollback' ? headCommit : null);
	const toTileCommit = $derived(direction === 'rollback' ? null : headCommit);

	/**
	 * ⭐ (2026-10-10, truth-bug fix) ONE TITLE PER BUILD, FOR EVERY ROW THE
	 * PICKER SHOWS — AND THE TILES' OWN FALLBACK FOR THE SIDE `headCommit`
	 * NEVER NAMES. `headCommit`'s own doc comment explains why GitHub's
	 * compare range only ever covers `compareHead`: the OTHER tile (the
	 * base build) used to fall back to a mock-only `commitMessage` field,
	 * which both disagreed with `github-data.ts` where the two happened to
	 * overlap and was simply absent on `availableReleases` otherwise (the
	 * field only ever existed on `history[]` entries) — the "No commit
	 * message" tile an art director found.
	 *
	 * This asks ONE question per consecutive pair of `availableReleases`
	 * tags — oldest→newest, so every tag but the very first names the hop
	 * that produced it — batched under one `createQueries` call rather than
	 * a `createQuery` per picker row. Each pair is the SAME one-hop range
	 * `history/+page.svelte`'s own rows and `CommitSummary` ask for the
	 * identical two tags, so the cache is shared, not duplicated, and a
	 * one-hop range is 1-3 commits — never truncated by the commits
	 * endpoint's own 6-commit display cap the way one single request
	 * spanning the WHOLE ladder would be.
	 */
	const pickerTagPairs = $derived(consecutiveTagPairs(releaseList.map((r) => r.tag)));
	const pickerTitleQueries = createQueries(() => ({
		queries: pickerTagPairs.map(({ base, head }) => {
			const o = commitsQueryOptions({
				namespace: rollout?.metadata?.namespace ?? '',
				name: rollout?.metadata?.name ?? '',
				base,
				head,
				cluster
			});
			/* composed with the factory's own enabled (range complete, and the GitHub gate), not replacing it */
			return { ...o, enabled: !!rollout?.status?.source && o.enabled };
		}),
		// Wrap the per-pair results in an object. svelte-query 6.0.12's
		// `createRawRef` deletes array keys one by one and each delete also does
		// `length--`, so an array that shrinks by 2+ (switching to a rollout with
		// a shorter ladder) throws "'deleteProperty' on proxy: trap returned
		// falsish". An object keeps one stable key (`items`).
		combine: (results) => ({
			items: results.map((r) => ({ data: r.data }))
		})
	}));
	const pickerTitleBySha = $derived.by(() => {
		const map = new Map<string, string>();
		pickerTagPairs.forEach(({ head }, i) => {
			const title = headCommitTitle(pickerTitleQueries.items[i]?.data?.commits);
			if (title) map.set(head, title);
		});
		return map;
	});
	/**
	 * ⭐ (2026-10-10) THE OLDEST BUILD IN THE LADDER STILL HAS NO HOP INTO
	 * IT. `pickerTagPairs` names every tag but `availableReleases[0]` — a
	 * one-hop range is, definitionally, the commit that produced its OWN
	 * `head`, so the very first (oldest) release has no predecessor to hop
	 * from and `pickerTitleBySha` can never cover it, same as `headCommit`
	 * never does (its own doc comment). That oldest build still has a real
	 * title (`github-data.ts`'s own `rootTitle` for this ladder) — just not
	 * reachable through a two-sha COMPARE. A single-sha LOOKUP
	 * (`$lib/api/commit`, the same endpoint the bare-sha change page already
	 * uses) answers it directly, so this is the one case that needs it: two
	 * extra one-shot queries, cached, only for whichever tag the tiles are
	 * actually showing right now.
	 */
	const sourceOwnerRepo = $derived.by(() => {
		const source = rollout?.status?.source;
		if (!source) return null;
		return githubOwnerRepo(repoKeyFor(rollout, rollout?.metadata?.name ?? ''));
	});
	/**
	 * round 9 (AD r8, P3): the picker's OLDEST row has no one-hop range
	 * into it, so it read untitled while the tiles (single-sha lookup below)
	 * named it ("3f1ed09 Bump connection pool size"). The same lookup now
	 * titles that one row too, so the picker and the comparison agree.
	 */
	const rootReleaseTag = $derived(releaseList[0]?.tag ?? null);
	const rootReleaseSha = $derived(revisionSha(releaseList[0]?.revision));
	const rootCommitQuery = createQuery(() =>
		commitQueryOptions({
			owner: sourceOwnerRepo?.owner ?? '',
			repo: sourceOwnerRepo?.repo ?? '',
			sha: rootReleaseSha,
			cluster,
			enabled: open && !!sourceOwnerRepo && !!rootReleaseSha
		})
	);
	const currentCommitQuery = createQuery(() =>
		commitQueryOptions({
			owner: sourceOwnerRepo?.owner ?? '',
			repo: sourceOwnerRepo?.repo ?? '',
			sha: revisionSha(currentRelease?.revision),
			cluster,
			enabled: !!sourceOwnerRepo && !!revisionSha(currentRelease?.revision)
		})
	);
	const selectedCommitQuery = createQuery(() =>
		commitQueryOptions({
			owner: sourceOwnerRepo?.owner ?? '',
			repo: sourceOwnerRepo?.repo ?? '',
			sha: revisionSha(selectedRelease?.revision),
			cluster,
			enabled: !!sourceOwnerRepo && !!revisionSha(selectedRelease?.revision)
		})
	);
	/**
	 * ⭐ THE TILE'S TITLE — `pickerTitleBySha` FIRST (it covers both sides of
	 * every hop but the ladder's own first one), `headCommit`'s own range
	 * second (covers `compareHead` even when this release is not itself in
	 * `availableReleases`, e.g. an off-ladder tag typed into the picker's
	 * search box), the bare single-sha lookup above LAST (the oldest-ladder-
	 * step case neither of those can ever name). No more mock-only
	 * `commitMessage` preference — see this block's own doc comment.
	 */
	const fromTileTitle = $derived(
		(currentRelease ? pickerTitleBySha.get(currentRelease.tag) : undefined) ??
			(fromTileCommit ? formatCommitMessage(fromTileCommit.message) : null) ??
			buildTitle(currentCommitQuery.data)
	);
	const toTileTitle = $derived(
		(selectedRelease ? pickerTitleBySha.get(selectedRelease.tag) : undefined) ??
			(toTileCommit ? formatCommitMessage(toTileCommit.message) : null) ??
			buildTitle(selectedCommitQuery.data)
	);
	/** The build's own age — dropped entirely from the TO tile before round
	 * 3 (AD item 2: "the build's age … is dropped"). Both tiles get it now,
	 * from the SAME `created` timestamp the picker row already shows. */
	const fromTileAge = $derived(
		currentRelease?.created ? `Built ${formatTimeAgo(currentRelease.created)}` : null
	);
	const toTileAge = $derived(
		selectedRelease?.created ? `Built ${formatTimeAgo(selectedRelease.created)}` : null
	);
	/**
	 * ⭐ THE FROM TILE'S STATE GLYPH. (squad-rollout, Lane D, round 3 — AD
	 * item 2: "No state: on the incident the 'from' tile is a02f1c4 (just
	 * failed) drawn identical to the healthy target… each tile gets a
	 * status glyph… the from tile carries failed/checking ink when true.")
	 * The SAME `rolloutStateChip` reading the picker's own "running" row
	 * already uses — `history[0].bakeStatus` is the one ground truth for
	 * "what is this rollout doing right now," so the glyph here and the
	 * picker row's glyph can never disagree. The TO tile gets none: nothing
	 * in this dialog's own data says where the picked build is running
	 * elsewhere (the squad lead's own round-3 ruling — "or nothing" is the
	 * explicitly correct fallback, not a gap to fill with a guess).
	 */
	const fromTileRole = $derived(rolloutStateChip(rollout?.status?.history?.[0]?.bakeStatus).role);
	/** "Running in prod" / "Running in staging since 2h" — the FROM tile's
	 * own where-it-runs-now fact; the TO tile has not run anywhere yet. */
	const fromTileWhere = $derived.by(() => {
		if (!envLabel) return null;
		return currentDeployedAt
			? `Running in ${envLabel} since ${formatTimeAgo(currentDeployedAt)}`
			: `Running in ${envLabel}`;
	});
	const toTileWhere = $derived.by(() => {
		if (direction === 'rollback') {
			// A rollback's target already ran here once — that IS the reason
			// it is a safe place to go back to (see `typedPrompt`'s own
			// rollback-tier note). Not "where it runs now" (nowhere, yet),
			// the honest prior fact instead.
			return currentTag ? 'Ran here before' : null;
		}
		const rank = selectedVersion ? pickerRankLabel(selectedVersion) : null;
		return rank === 'newest' || rank?.endsWith('newer') ? 'Not deployed here yet' : null;
	});
	/** The facts row under the two tiles: Environment, direction + distance,
	 * whether this pins, and (production only) whether typing is required. */
	/**
	 * ⭐ ONE BOLD SENTENCE, NOT FOUR EQUAL INKS. (F10, design pass 2 re-check)
	 * The consequence alert set the icon, the full multi-sentence notice, the
	 * `gateWhy` tail and the override `FactList` all at one flat weight in one
	 * red — nothing read as louder than anything else. The lead sentence (the
	 * actual consequence) is bolded; everything after it — the "how it
	 * applies" detail, the paused-automation tail, the overridden rules —
	 * stays at rest weight. See `splitLeadSentence`'s own note.
	 */
	const deployNoticeParts = $derived(deployNotice ? splitLeadSentence(deployNotice) : null);
	// ⭐ PINNING THE RUNNING VERSION IS A REAL ACT. `direction === 'same'` is
	// a no-op deploy, but with Pin on it writes `spec.wantedVersion` — the
	// dialog's own pin flow, which the Clear Pin verification walks. The
	// button is live for it and says what it does; no typed confirm, since
	// nothing moves.
	const isSameVersionPin = $derived(direction === 'same' && pinVersionToggle);
	const deployButtonShortLabel = $derived(
		isSameVersionPin ? 'Pin' : direction === 'rollback' ? 'Roll back' : 'Deploy'
	);
	const deployButtonLabel = $derived(
		isSameVersionPin
			? `Pin ${targetPhrase(intent)} to ${getDisplaySelectedVersion()}`
			: deployActionLabel(intent)
	);
	/**
	 * ⭐ THE DIALOG NAMES THE INTENT AND THE BUILD, NOT A GENERIC VERB. (U-11,
	 * ledger, 2026-10-08 — canonical vocabulary, decided by the TL.) The
	 * header used to say the fixed title-case `Change Version` on every
	 * screen of this dialog, including the confirmation screen for a build
	 * already picked — so a reader confirming a production rollback and a
	 * reader opening the picker for the first time read the identical words.
	 * `Change version` (sentence case) now survives ONLY as the open-ended
	 * entry point, before a build is chosen; the moment one is, the dialog
	 * retitles itself to the form that names the actual act:
	 * `Deploy <build> to <environment>` / `Roll back <environment> to
	 * <build>`. Same shape `deployButtonLabel` already uses for its own
	 * pin branch, so the title and the footer's confirm never name the act
	 * two different ways.
	 */
	/**
	 * ⭐ ROUND 5 (squad-rollout, Lane D, AD round 3 — "The title names the
	 * environment as written … not the tier."). `targetPhrase(intent)`
	 * returns the WORD `production` for any prod-tier target — correct for
	 * the body's consequence sentence (B3: the reader is owed that word),
	 * wrong for a title whose whole job is naming WHICH rollout this acts
	 * on. A cluster can have several prod-tier environments
	 * (`prod-us-east-2`, `prod-eu-west-1`); "Deploy 4.45.0-45 to production"
	 * is ambiguous between them in a way the picker's own env `Chip`
	 * (`envLabel`, the cluster's own spelling) never is. `intent.environment`
	 * is that same spelling — unconditional, tier or not.
	 */
	const dialogTitleTarget = $derived(intent.environment || 'this environment');
	const dialogTitle = $derived.by(() => {
		if (!selectedVersion) return 'Change version';
		const build = getDisplaySelectedVersion();
		if (isSameVersionPin) return `Pin ${dialogTitleTarget} to ${build}`;
		if (direction === 'rollback') return `Roll back ${dialogTitleTarget} to ${build}`;
		return `Deploy ${build} to ${dialogTitleTarget}`;
	});
	/**
	 * ⭐ THE LABEL WHILE THE REQUEST IS IN FLIGHT. (B3, 2026-09-03, operator
	 * walk) `deployButtonLabel` ("Roll back production" / "Deploy to dev") is
	 * an IMPERATIVE — correct at rest, wrong once the click has already
	 * happened and the button is disabled. The present-continuous form says
	 * what is happening NOW, matching the spinner beside it.
	 */
	const deployingLabel = $derived(
		isSameVersionPin ? 'Pinning…' : direction === 'rollback' ? 'Rolling back…' : 'Deploying…'
	);
	/**
	 * ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2 — "The
	 * confirm button must be the PRIMARY (filled blue, btn-primary) for
	 * both deploy and rollback. A red outline with red text reads as an
	 * error.") P6's own reasoning (kept below for the record) was that a
	 * filled-blue rollback was indistinguishable from an ordinary forward
	 * deploy; the fix this round makes is different — not a second colour,
	 * but recognising that `.btn-danger` (an OUTLINE, never filled — see
	 * the design language's own "no filled red buttons" rule) reads to a
	 * reader as "something has gone wrong," on the ONE button in the
	 * dialog whose whole job is "press this to proceed." The direction is
	 * still said in words (the header: "Roll back production to b7e0d41"),
	 * the icon (`UndoOutline` vs `ArrowUpOutline`) and the danger ink on
	 * the callout's own glyph when the consequence is genuinely adverse
	 * (`calloutIsAdverse`) — colour on the ACT only where the act is
	 * actually destructive and irreversible, never as a second "which
	 * direction" label competing with the ones already there.
	 *
	 * ── P6's original ruling, 2026-09-03 (superseded) ──
	 * `Roll back dev` rendered in the identical filled blue `.btn-primary`,
	 * in the identical slot, as `Deploy to dev` — a reader scanning the
	 * footer by colour alone could not tell a destructive reversal from an
	 * ordinary forward move. That observation is still true; round 2's
	 * call is that an outline-red CONFIRM button is the wrong fix for it.
	 */
	const confirmBtnClass = $derived('btn-primary');
	/**
	 * ⭐ NOTE REQUIRED FOR THE CHANGES THAT ARE HARDEST TO UNDO. (P5,
	 * 2026-09-03, operator walk) The note field read "(optional)" on every
	 * path, including a production change and a rollback — the two shapes
	 * this file's own rules (B3) already single out for the typed
	 * confirmation and the filled/outlined red button above. An ordinary dev
	 * forward deploy keeps it optional; `intent.production` covers a
	 * production change in EITHER direction (matching `confirmLevel`'s own
	 * `if (intent.production) return 'typed'`, which fires before the
	 * direction check), and `direction === 'rollback'` covers a non-production
	 * rollback that `confirmLevel` alone would not catch (it is `notice`, not
	 * `typed`, there).
	 */
	// ⛔ SUPERSEDED IN PART, 2026-09-05, FROM THE HUMAN ON A DEV ROLLBACK: "selecting an
	// older version and typing the correct version doesn't enable the button — it
	// remains disabled." The note was required on every rollback (P5, an agent
	// walk); the human's own ruling (B3) reserves the ceremony for PRODUCTION
	// and keeps a non-production rollback the fast recovery path. The note is
	// required for a production change in either direction and optional
	// elsewhere — and whatever still blocks the confirm is now SAID under the
	// button (`confirmBlocker`), never left as a dead control.
	const deployNoteRequired = $derived(intent.production);
	/**
	 * ⭐ FACTORED OUT, FOR THE FOOTER'S ⌘↵ HINT. (squad-rollout, Lane D, §4:
	 * "left `t-meta` kbd hints … ⌘↵ to deploy".) The confirm button's own
	 * `disabled` expression used to live only inline on the button; `⌘Enter`
	 * (below) needs to make the SAME decision the button's own click would,
	 * never a looser one — a shortcut that could fire where the visible
	 * button cannot is the one keyboard affordance worse than none. Declared
	 * after `deployNoteRequired`, which it reads — `$derived` values are
	 * ordinary block-scoped `const`s, unlike the hoisted functions/exports
	 * elsewhere in this file, so this cannot sit above its own dependency.
	 */
	const confirmDisabled = $derived(
		(needsTypedConfirmation && deployConfirmationVersion !== getDisplaySelectedVersion()) ||
			(direction === 'same' && !pinVersionToggle) ||
			(deployNoteRequired && deployExplanation.trim() === '') ||
			selectedVersionHeldPending ||
			deploying
	);
	/**
	 * ⭐ ROUND 5 (squad-rollout, Lane D, AD round 3 — "No disabled-reason
	 * line before anything has been typed (show it only after an attempt
	 * or once the input has a value)."). The dialog used to show "The
	 * typed confirmation above does not match yet" the INSTANT step 2
	 * opened, before a reader had touched either field — a reason for a
	 * mismatch nobody had attempted yet, stated as if it were already a
	 * failure. Set the moment a `⌘↵` is pressed while still disabled (the
	 * one deliberate "try it" signal this dialog has — a disabled button
	 * itself fires no click event to hook); the typed-confirm message ALSO
	 * qualifies the instant the field has any text (a wrong character is
	 * worth naming immediately, an EMPTY field is not).
	 */
	let attemptedDeploy = $state(false);
	/**
	 * Either field has SOME value already, or a `⌘↵` was pressed while
	 * still disabled — the two forms "an attempt" takes. Both of the
	 * blocker messages that name an EMPTY/WRONG required field (not the
	 * pin/held ones below, which are not about typing anything) wait on
	 * this, together — typing the confirm sha first and seeing the NOTE
	 * blocker appear next (`P5`'s own test name: "the blocker names it
	 * once the build is typed") is the reader starting to engage with this
	 * step at all, not a second, separate attempt at the note field.
	 */
	const confirmAttempted = $derived(
		attemptedDeploy || deployConfirmationVersion !== '' || deployExplanation !== ''
	);
	/** The one thing still keeping the confirm disabled, in words, or null. */
	const confirmBlocker = $derived.by((): string | null => {
		if (deploying) return null;
		// One line at 390 (≤ 48 characters): the footer must not change height.
		// ⭐ NO REPEATED PROMPT. (round 2, design review 4) This used to
		// restate `Type ${build} above to confirm.` — the same instruction
		// the label right above the input already gives, visible on screen
		// at the same time. This names WHAT is missing without repeating
		// the instruction itself.
		if (needsTypedConfirmation && deployConfirmationVersion !== getDisplaySelectedVersion()) {
			if (!confirmAttempted) return null;
			return 'The typed confirmation above does not match yet.';
		}
		if (deployNoteRequired && deployExplanation.trim() === '') {
			if (!confirmAttempted) return null;
			return 'Add a note — required for a prod change.';
		}
		if (direction === 'same' && !pinVersionToggle)
			return 'Already running — turn on Pin build to keep it.';
		if (selectedVersionHeldPending) return 'Checking whether this build is held…';
		return null;
	});
	// The suffix states the rule, not a hope: the note IS required for a
	// rollback and for production (`deployNoteRequired`), and the button
	// stays dead until it is written. "(recommended)" was a lie of omission.
	/**
	 * ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 3 — AD item 4:
	 * "Note '(required)' in placeholder AND helper line."). The dedicated
	 * `<p>` right under the textarea (below, `deployNoteRequired &&
	 * deployExplanation.trim() === ''`) already says "The note is required
	 * here" at the exact moment the placeholder's own "(required)" suffix
	 * was ALSO visible — the one state where the field is both empty and
	 * required says so twice. `(optional)` has no such second line, so it
	 * stays: it is the only place that fact is said at all.
	 */
	/**
	 * The caller may hand us the state it already derived (rollout detail does,
	 * because it holds the full gate objects and so can print their published
	 * pretty names). Every OTHER call site — history, `/versions/<rev>`,
	 * `/envs/<name>`, `/apps/<name>`, `FailurePanel` — gets the same truth
	 * derived from the rollout alone rather than getting silence.
	 */
	const rawGateState = $derived(autoDeploy ?? autoDeployState(rollout));
	/**
	 * ⛔ `autoDeployState`'s `gates` reason is a blunt read of the
	 * `GatesPassing` CONDITION, and that condition goes False for TWO
	 * different reasons this dialog must not conflate: a gate genuinely
	 * refusing an EXISTING candidate, and simply having no newer candidate to
	 * check at all — `NoAllowedVersions` fires trivially in the second case
	 * too. Reproduced live on `hello-world-dev/hello-world-app`: with the
	 * deployed build already the newest release, `GatesPassing` was `False`
	 * while every individual gate in `status.gates` was itself `passing:
	 * true`. The page's own banner (`ScheduleStatus`) read the schedule
	 * directly and correctly said nothing was blocked *right now* (only that
	 * the window closes SOON); this dialog, reading the same rollout through
	 * `autoDeployState`, said *"paused right now — a rule is holding it"*.
	 *
	 * `promotionBlock` is the product's own ground truth for "gates refuse
	 * every candidate that exists" — `blocking-story.ts`'s `stuckFor` already
	 * leans on the identical distinction ("a gate correctly refusing a
	 * candidate is not a stoppage"). So the `gates` reason is dropped here
	 * unless `promotionBlock` agrees something is actually held back today.
	 * The other three reasons (`health`, `pin`, `failed`) are untouched: each
	 * is a fact about right now on its own terms, not a read of this same
	 * blunt condition.
	 */
	const gateState = $derived.by((): AutoDeployState => {
		const state = rawGateState;
		if (!state.reasons.includes('gates') || promotionBlock(rollout).blocked) return state;
		const reasons = state.reasons.filter((r) => r !== 'gates');
		return { ...state, paused: reasons.length > 0, reasons };
	});
	const gateNote = $derived(manualDeployNote(gateState));
	/**
	 * The gate line WITHOUT its "it applies immediately" tail, for when it
	 * rides inside the consequence alert — which already says that, and at
	 * 390px two stacked alerts squeezed the changelist to a sliver. Both facts
	 * survive; only the duplicated clause goes.
	 */
	const gateWhy = $derived(gateState.paused ? autoDeployWhy(gateState) : null);
	/**
	 * ⭐ DANGER INK IS FOR AN ADVERSE FACT, NOT A TIER. (squad-rollout, Lane
	 * D, round 2, §4: "'This changes production. Every rule currently
	 * allows this build…' carries a DANGER icon, but it describes a safe
	 * state. Colour = state: no danger hue for a non-adverse fact.") The
	 * callout used to colour its icon off `level === 'typed'` alone — true
	 * of an ordinary vouched production deploy (every rule allows it,
	 * nothing is wrong) exactly as much as a genuinely adverse one. The
	 * real adverse signals are narrower: `gateWhy` is non-null only while
	 * automatic promotion is ACTUALLY paused for some other reason (this
	 * press overrides a real, current hold), and `knownFailedHere` means
	 * the build already failed on this exact rollout. Neither is true of
	 * "this is production" on its own.
	 */
	// --- The rules a `typed` force-deploy overrides, named -----------------

	/**
	 * ⭐ ROUND 5 (squad-rollout, Lane D, AD round 3, item 3 — the TO tile's
	 * own held state, for its state line/glyph in the transition block
	 * (markup below). The SAME two signals the picker row's own
	 * `gateHeld`/`effectiveContractHeldVersions.has(displayVersion)` read
	 * (that row's own doc comments, above) — `overriddenGates.length > 0`
	 * is exactly `!isDeployable`'s own gate check (`gates.every(gateAllows)`
	 * negated), so this can never disagree with the picker row the reader
	 * clicked to get here. Rollback is excluded: the picker's own row logic
	 * only ever marks a NEWER candidate held (`isNewerCandidate`), and a
	 * rollback target is always older — it is a PAST build, never a
	 * currently-held one.
	 */
	const toTileGateHeld = $derived(direction !== 'rollback' && overriddenGates.length > 0);
	const toTileContractHeld = $derived(
		direction !== 'rollback' &&
			!!selectedVersion &&
			effectiveContractHeldVersions.has(getDisplaySelectedVersion())
	);
	const toTileHeld = $derived(toTileGateHeld || toTileContractHeld);
	const toTileHeldReason = $derived(
		toTileHeld && selectedVersion
			? heldReasonFor(selectedVersion, getDisplaySelectedVersion(), toTileGateHeld)
			: null
	);

	/**
	 * ⭐ ONE TILE ANATOMY, EVERY CASE. (squad-rollout, Lane D, round 6 — AD
	 * round 4, items 2, 5, 9.) Both tiles of the transition block draw the
	 * same four lines, whatever is known:
	 *   1. a 16px `StatusMark` (always — rest dot, empty ring, or the state's
	 *      own mark) + the build in `t-code-lg`;
	 *   2. the commit title in `t-body`, or a quiet placeholder;
	 *   3. the author (avatar + login, when GitHub named one) and the build
	 *      age, always grey;
	 *   4. the build's state HERE as a word in its own ink (Failed, Checking,
	 *      Deploying, Held) or quiet grey (Running, Ran here before, Not
	 *      deployed here) — never a rule name: the callout names the rule,
	 *      once.
	 * Facts on lines 3-4 are `.dot-list` items with `whitespace-nowrap`, so a
	 * wrap moves a whole fact ("Built 3 days ago"), never a lone word.
	 */
	type TileState = { word: string; ink: string } | null;
	const inRecoveryMode = $derived(
		recoveryMode ?? recoveryModeReason(rollout, []) !== null
	);
	const fromTileMark = $derived<NodeState>(
		fromTileRole === 'failing'
			? 'failed'
			: fromTileRole === 'checking'
				? 'checking'
				: fromTileRole === 'deploying'
					? 'deploying'
					: fromTileRole === 'ready'
						? 'newest'
						: 'none'
	);
	const fromTileState = $derived<TileState>(
		fromTileRole === 'failing'
			? { word: 'Failed', ink: 'text-danger' }
			: fromTileRole === 'checking'
				? { word: 'Checking', ink: 'text-progress' }
				: fromTileRole === 'deploying'
					? { word: 'Deploying', ink: 'text-active' }
					: fromTileRole === 'ready'
						? { word: 'Running', ink: 'text-fg-subtle' }
						: null
	);
	const fromTileSince = $derived(
		currentDeployedAt ? `deployed ${formatTimeAgo(currentDeployedAt)}` : null
	);
	/** The rollback target's own outcome when it last ran here. */
	const toTilePriorBake = $derived(
		direction === 'rollback' && selectedVersion
			? ((rollout?.status?.history ?? []).find((h) => h.version?.tag === selectedVersion)
					?.bakeStatus ?? null)
			: null
	);
	const toTileMark = $derived<NodeState>(
		toTileHeld
			? 'held'
			: direction === 'rollback' && toTilePriorBake === 'Succeeded'
				? 'newest'
				: 'none'
	);
	const toTileState = $derived<TileState>(
		toTileHeld
			? { word: 'Held', ink: 'text-held' }
			: direction === 'rollback'
				? { word: 'Ran here before', ink: 'text-fg-subtle' }
				: direction === 'forward'
					? { word: 'Not deployed here', ink: 'text-fg-subtle' }
					: null
	);
	/**
	 * ⭐ round 7 (AD r6 item 1): the connector counts BUILDS and says so —
	 * "19 newer builds" beside "Commits to deploy · 6 of 19" read as one
	 * contradictory number when both said only "19"/"6".
	 */
	const connectorLabel = $derived.by(() => {
		const plural = (n: number) => (n === 1 ? 'build' : 'builds');
		if (direction === 'rollback')
			return deployStepsBack != null
				? `${deployStepsBack} ${plural(deployStepsBack)} back`
				: 'back';
		if (direction === 'forward') {
			const rank = selectedVersion ? pickerRankLabel(selectedVersion) : null;
			const n = rank ? Number.parseInt(rank, 10) : NaN;
			if (Number.isFinite(n)) return `${n} newer ${plural(n)}`;
			return rank;
		}
		return null;
	});

	/**
	 * ⭐ round 7 (AD r6 item 2): SAME BUILD, SAME TILE. The author comes from
	 * whichever source names this exact build — its own one-hop range (the
	 * same per-tag queries the titles use), then this dialog's range head,
	 * then the single-sha lookup — so d09e6f4 carries its author whether it
	 * is the FROM tile (deploy) or the TO tile (rollback).
	 */
	type TileAuthor = { author?: string | null; avatarUrl?: string | null } | null;
	const pickerCommitBySha = $derived.by(() => {
		const map = new Map<string, { author?: string; avatarUrl?: string }>();
		pickerTagPairs.forEach(({ head }, i) => {
			const commits = pickerTitleQueries.items[i]?.data?.commits;
			const last = commits && commits.length > 0 ? commits[commits.length - 1] : null;
			if (last?.author) map.set(head, { author: last.author, avatarUrl: last.avatarUrl });
		});
		return map;
	});
	function tileAuthorFor(
		tag: string | null | undefined,
		rangeCommit: { author?: string; avatarUrl?: string } | null,
		single: unknown
	): TileAuthor {
		const fromLadder = tag ? pickerCommitBySha.get(tag) : undefined;
		if (fromLadder) return fromLadder;
		if (rangeCommit?.author) return rangeCommit;
		const one = single as { author?: string; avatarUrl?: string } | null | undefined;
		return one?.author ? { author: one.author, avatarUrl: one.avatarUrl ?? null } : null;
	}
	const fromTileAuthor = $derived(
		tileAuthorFor(currentRelease?.tag ?? currentTag, fromTileCommit, currentCommitQuery.data)
	);
	const toTileAuthor = $derived(
		tileAuthorFor(selectedRelease?.tag ?? selectedVersion, toTileCommit, selectedCommitQuery.data)
	);

	/**
	 * ⭐ round 7 (AD r6 item 1): the commit list in date order (newest first,
	 * whatever order the compare returned), and its TRUE size. The compare
	 * endpoint may cap what it returns; `ahead` (forward) or `behind`
	 * (rollback) is GitHub's own count of the range, so a capped list says
	 * "6 of 19" instead of passing the cap off as the total.
	 */
	const commitsSorted = $derived.by(() => {
		const list = commitsQuery.data?.commits ?? [];
		return [...list].sort((a, b) => {
			const ta = a.commitDate ? Date.parse(a.commitDate) : 0;
			const tb = b.commitDate ? Date.parse(b.commitDate) : 0;
			return tb - ta;
		});
	});
	const commitsTotal = $derived.by(() => {
		const d = commitsQuery.data;
		if (!d) return 0;
		const reported =
			direction === 'rollback' ? Math.max(d.ahead ?? 0, d.behind ?? 0) : (d.ahead ?? 0);
		return Math.max(reported, d.commits.length);
	});
	const commitsCapped = $derived(
		!!commitsQuery.data && commitsTotal > commitsQuery.data.commits.length
	);

	/**
	 * The note's helper line, one per case (AD round 4, item 11) — the
	 * placeholder asks the question, this line says whether it is needed and
	 * where it goes. Said once: no "(optional)" suffix on the placeholder.
	 */
	const noteHelper = $derived.by(() => {
		const act = direction === 'rollback' ? 'rollback' : 'deploy';
		if (!deployNoteRequired) return `Optional. Recorded with the ${act}.`;
		if (direction !== 'rollback' && isActualOverride)
			return 'Required: say why the rule should not apply. Recorded with the deploy.';
		return `Required for a prod ${act}. Recorded with it.`;
	});

	/**
	 * The commit list folds to its first 3 rows plus "Show all N" at EVERY
	 * width (AD round 5, item 2): only the dialog body scrolls, never a
	 * list inside it.
	 */
	/**
	 * ⭐ round 6, squad lead: the desktop body scroller shows a bottom fade
	 * while more is below (at 900px tall the typed-confirm field sat under
	 * the footer with no cue), and a focused field is always scrolled clear
	 * of the footer — on a phone that scroller is the whole pane.
	 * ⛔ The fade is a sticky gradient ELEMENT, never a CSS mask (AD round 5,
	 * item 1: a mask on this scroller plus one on the old inner commit list
	 * made Chromium paint the whole body solid black at 1440×900).
	 */
	let bodyMore = $state(false);
	function updateBodyMore() {
		const el = rightContentEl;
		if (!el) return;
		const scrolls = getComputedStyle(el).overflowY !== 'visible';
		bodyMore = scrolls && el.scrollHeight - el.scrollTop - el.clientHeight > 6;
	}
	$effect(() => {
		const el = rightContentEl;
		if (!el || !selectedVersion) return;
		updateBodyMore();
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(updateBodyMore);
		ro.observe(el);
		for (const child of Array.from(el.children)) ro.observe(child);
		return () => ro.disconnect();
	});
	function revealFocused(event: FocusEvent) {
		const t = event.target;
		if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
			// `nearest` scrolls only as far as needed inside the body scroller
			// (or the phone pane), so the footer never covers the field.
			t.scrollIntoView?.({ block: 'nearest' });
		}
	}

	const COMMITS_FOLD = 3;
	let showAllCommits = $state(false);

	/**
	 * ⛔ SUPERSEDED IN PART, 2026-10-10 (squad-rollout, Lane D, round 5 — AD
	 * round 3, item 2: "Name the rule ONCE, in the callout; today it
	 * appears 3×."). Round 4 put the gate's own name in THIS placeholder
	 * too (`overridingGateName`) — measured live on the held-deploy
	 * scenario (`ad/dialogs-r3/held__1440-dark.png`): `promotion-prod-us-
	 * east-2` named itself three times on one screen (the now-removed
	 * facts row, the callout's own `FactList` row below, AND this
	 * placeholder). The callout's `FactList` is the one place built to
	 * name rules correctly for any count (one row each, never squeezed
	 * into a single noun phrase) — this placeholder goes back to the
	 * generic question `isActualOverride` always asked before round 4,
	 * and `overriddenGates`/`intent.custom` still decide WHEN to ask it,
	 * same as round 4 fixed (an ordinary vouched deploy still gets "Add a
	 * note", never override wording).
	 */
	const isActualOverride = $derived(overriddenGates.length > 0 || intent.custom);
	const deployNotePlaceholder = $derived.by(() => {
		const q =
			direction === 'rollback'
				? 'Why are you rolling back?'
				: isActualOverride
					? 'Why are you overriding the rules?'
					: deployNoteRequired
						? 'Why deploy this now?'
						: 'Add a note';
		// `(required)` dropped (round 3): the dedicated helper line under the
		// textarea already says so when it is. `(optional)` has no such
		// second line, so it is the only place that fact is said — stays on
		// EVERY case, rollback included (a non-production rollback's note
		// is genuinely optional; `deployNoteRequired` is production-only).
		// ⭐ round 6 (AD round 4, item 11): no "(optional)" suffix — the
		// helper line under the field (`noteHelper`) says required/optional
		// once, per case.
		return q;
	});

	/**
	 * ⛔ CORRECTED, 2026-10-09 (squad-rollout, Lane D, round 2). The first
	 * pass only read `gateWhy` (the ROLLOUT's own current pause reason) and
	 * `knownFailedHere` — missing the single case item 6's own example
	 * sentence names: "This deploys to production a build that no rule
	 * currently allows." That fact is `overriddenGates.length > 0` (a gate
	 * on THIS BUILD, not the rollout's general pause state) — measured live
	 * on `checkout-api-prod-us-east-2`/`4.45.0-45`: the callout still read
	 * neutral grey while naming an actively-overridden promotion rule,
	 * which is exactly the adverse fact the icon exists to flag. An
	 * unlisted tag (`intent.custom`) is the same shape — a build nothing
	 * has vouched for at all.
	 *
	 * ⛔ CORRECTED AGAIN, 2026-10-09, round 3 (AD-dialogs-round1.md item 5:
	 * "Incident rollback (the recommended action) has a red error glyph;
	 * prod rollback a grey info glyph: same action, two inks… danger only
	 * for something irreversible"). `direction === 'rollback'` now
	 * short-circuits this to `false` outright: a rollback's OWN target is a
	 * build that already ran here successfully (the whole reason it is a
	 * safe place to go back to — `typedPrompt`'s own rollback-tier note
	 * makes the identical argument), so it is never the shape this flag
	 * exists to catch, however it is triggered. Measured live: an incident
	 * rollout's own `gateState.paused` (automatic promotion paused by the
	 * SAME failure the rollback is the remedy for) was flipping `gateWhy`
	 * true and painting the RECOMMENDED action's icon red — the opposite of
	 * what the colour should say about it. A rollback is reversible by
	 * definition (roll forward again later); only a FORWARD move that
	 * overrides a rule, ships an unlisted tag, or repeats a build that
	 * already failed here earns the danger ink.
	 */
	/**
	 * ⛔ CORRECTED A THIRD TIME, 2026-10-10, round 4 (AD round 2, item 3:
	 * "A held override is reversible, so it is held ink, not danger.").
	 * `calloutIsAdverse` was a binary neutral/danger switch; overriding a
	 * gate or an unlisted-tag build is a HOLD being bypassed, not an
	 * irreversible act — the hold itself is exactly the kind of thing a
	 * later deploy can re-satisfy, same reasoning round 3 already used to
	 * exempt rollback. Only a build that already PROVED broken on this
	 * exact rollout (`knownFailedHere`) is the genuinely irreversible
	 * shape danger ink is for. A rollback stays neutral (round 3,
	 * unchanged — never even reaches the held branch).
	 */
	const calloutTone = $derived.by((): 'neutral' | 'held' | 'danger' => {
		if (direction === 'rollback') return 'neutral';
		if (intent.knownFailedHere) return 'danger';
		if (!!gateWhy || overriddenGates.length > 0 || intent.custom) return 'held';
		return 'neutral';
	});

	// Fetch the join data once we are actually about to show the override
	// list — a plain vouched deploy or a rollback never needs it.
	$effect(() => {
		if (!open || !rollout || level !== 'typed' || intent.custom) return;
		const namespace = rollout.metadata?.namespace;
		if (!namespace || overrideContextLoadedFor === namespace) return;
		overrideContextLoadedFor = namespace;
		void loadOverrideContext(namespace);
	});

	function overrideFact(
		gateName: string | undefined,
		tag: string,
		namespace: string | undefined
	): Fact {
		if (!gateName) return { label: 'a rule', value: 'currently does not allow this build' };
		const dep = overrideDependencies.find(
			(d) => d.metadata?.namespace === namespace && d.status?.gateName === gateName
		);
		if (dep) {
			const blocked = dep.status?.blockedReleases?.find((b) => b.tag === tag);
			const need = blocked?.requiredVersion;
			const contract = dep.spec?.contract ?? 'a contract';
			const provider = dep.spec?.providerRef?.name ?? 'another service';
			const have = dep.status?.providedVersion;
			const needClause = need ? `needs ${contract} ${need}` : `needs a newer ${contract}`;
			return {
				label: dep.metadata?.name ?? gateName,
				value: have
					? `${needClause}, ${provider} serves ${have}`
					: `${needClause} — ${provider} has not shipped it`
			};
		}
		const env = overrideEnvironments.find(
			(e) => e.metadata?.namespace === namespace && e.status?.rolloutGateRef?.name === gateName
		);
		if (env) {
			// The promotion rule in the product's one wording (sites & waves):
			// "after staging", "after wave 1 (eu-west-1, us-east-1)", "follows
			// eu-west-1's pick", "Lockstep: waiting for ap-south-1 …".
			const said = classifyGate(
				{ name: gateName },
				namespace,
				buildGateContext({ environments: { items: overrideEnvironments }, rollouts: rollout ? [rollout] : null })
			);
			return { label: said.label, value: said.short };
		}
		// ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 3 — AD item 5:
		// "Held callout prints the gate name uppercased
		// (PROMOTION-PROD-US-EAST-2): identifiers keep their case (t-code).")
		// This used to put the raw gate name in `label`, which `FactList`
		// always draws as `t-label` (11/600 CAPS +6%, every label, no
		// exception) — correct for a NOUN ("Rule"), wrong for an IDENTIFIER,
		// which this product draws in its own case everywhere else (§3: ids
		// are mono, never shouted). `handle: true` on the value gives it
		// `t-code-sm`, unchanged case, same as every other k8s object name
		// in a `FactList` row.
		return { label: 'Rule', value: resolveGateName(gateName, gateObjects) };
	}

	/**
	 * ⭐ THE RULES, NAMED — RENDERED AS A `FactList`, NOT A SECOND SENTENCE.
	 * `deployNotice` above already states the CONSEQUENCE ("nothing checks it
	 * first"); this states WHICH rules that consequence overrides, the way
	 * the Dependencies tab and `/environments` already name theirs, so the
	 * dialog making the change can be read against the banner behind it
	 * rather than trusting a bare "a rule".
	 */
	const overrideFacts = $derived.by<Fact[]>(() => {
		if (level !== 'typed' || intent.custom || !selectedVersion || !rollout) return [];
		const namespace = rollout.metadata?.namespace;
		return overriddenGates.map((g) => overrideFact(g.name, selectedVersion as string, namespace));
	});

	/**
	 * ⭐ TRUE WHILE THE OVERRIDE LIST WOULD OTHERWISE PRINT A RAW GATE ID.
	 * (2026-09-04, load-state audit finding 12) `overrideFacts` above is
	 * computed the instant `overriddenGates` is known — off `rollout.status
	 * .gates` alone — but `overrideFact`'s LABEL for each row needs the join
	 * data `loadOverrideContext` is still fetching. Read this BEFORE trusting
	 * `overrideFacts`: while `true`, the row's kind is not known yet — render
	 * a `SkeletonBar` in its place (below), never the id.
	 */
	const overrideContextPending = $derived(
		level === 'typed' &&
			!intent.custom &&
			!!selectedVersion &&
			!!rollout &&
			overriddenGates.length > 0 &&
			(overrideContextLoadedFor !== rollout.metadata?.namespace || !overrideContextReady)
	);

	const mustPin = $derived(isPinVersionMode || direction === 'rollback' || intent.custom);
	const pinVersionToggleComputed = $derived(mustPin || rollout?.spec?.wantedVersion !== undefined);
	const isPinVersionToggleDisabled = $derived(
		mustPin || hasForceDeployAnnotation(rollout ?? undefined)
	);

	$effect(() => {
		pinVersionToggle = pinVersionToggleComputed;
	});

	function getDisplaySelectedVersion(): string {
		if (!selectedVersion) return '';
		if (selectedRelease) return getDisplayVersion(selectedRelease);
		return selectedVersion;
	}

	/**
	 * ⭐ THE CLICK NOW HAS A PENDING STATE. (B3, 2026-09-03, operator walk)
	 * Measured live: confirming Deploy/Roll back produced no visible change
	 * for 5-8s (a real network round trip to the Go backend, then to the k8s
	 * API) while the button stayed fully armed — no spinner, not disabled — so
	 * a reader could not tell a click had registered and could press it again.
	 * `deploying` guards against exactly that double-submit and drives the
	 * button's own spinner + `Rolling back…`/`Deploying…` label (see the
	 * Button markup below); `onDeployStart` fires BEFORE the `await` so a
	 * caller holding its own banner (rollout detail's Overview) can say
	 * "Deploy requested — starting" the instant the person acts, not once the
	 * response finally lands. The modal already only closed on success
	 * (`open = false` sits after the `await`, unchanged) — the missing piece
	 * was feedback DURING the wait, not premature closing.
	 */
	async function handleDeploy() {
		if (!rollout || !selectedVersion || deploying) return;
		deploying = true;
		onDeployStart();
		try {
			const response = await fetch(
				apiPath(
					cluster,
					`/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/change-version`
				),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						version: selectedVersion,
						pin: pinVersionToggle,
						message: deployExplanation
					})
				}
			);
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				if (
					pinVersionToggle &&
					response.status === 500 &&
					errorData.details?.includes('dashboard is not managing the wantedVersion field')
				) {
					throw new Error(
						"Another controller owns this rollout's wanted version, so the dashboard cannot pin it."
					);
				}
				throw new Error('Failed to change version');
			}
			notifySuccess(
				pinVersionToggle
					? 'Successfully pinned and deployed version'
					: `Deploy requested for ${getDisplaySelectedVersion()}.`
			);
			announce(
				`${pinVersionToggle ? 'Pinned and deployed' : 'Deploy requested for'} ${getDisplaySelectedVersion()}.`
			);
			open = false;
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Failed to deploy version';
			notifyError(message);
			announce(message, 'assertive');
		} finally {
			// On success `open = false` already unmounts this dialog, so this is
			// only observable on the error path — where it re-arms the button
			// instead of leaving it spinning forever.
			deploying = false;
		}
	}

	function notifySuccess(message: string) {
		if (onSuccess) onSuccess(message);
		else {
			localToastType = 'success';
			localToastMessage = message;
			showLocalToast = true;
			setTimeout(() => (showLocalToast = false), 3000);
		}
	}

	function notifyError(message: string) {
		if (onError) onError(message);
		else {
			localToastType = 'error';
			localToastMessage = message;
			showLocalToast = true;
			setTimeout(() => (showLocalToast = false), 3000);
		}
	}
</script>

<!-- `aria-labelledby` rather than `title`: the header is a two-part crumb
     (`Change Version / <rollout>`) that `Modal`'s own `title` slot cannot
     render, and without either the dialog announced as an unnamed "dialog".

     ⭐ THE DIALOG IS ONE COLUMN UNTIL THERE IS SOMETHING TO PREVIEW. (F11,
     2026-09-03) At `size="lg"` (896px) with nothing picked yet, the list
     column was 300px and the other 597px held one gray sentence — 2.3% ink.
     `size="none"` plus a class that switches on `selectedVersion` narrows the
     dialog to the list's own measure (`max-w-md`, 448px — inside the
     420-480px the list needs at full width) before a pick, and widens back to
     the original 896px (`max-w-4xl`, byte-identical to the old `size="lg"`)
     only once the right pane has something to draw.

     ⭐ BELOW `sm` THIS IS A FULL-SCREEN SHEET, NOT A SHORT CARD. (user3
     repro, 2026-09-03) Measured live at 390: the dialog's own box was
     roughly 85vh tall and vertically CENTERED (flowbite's own
     `my-auto mx-auto` on the underlying `<dialog>`, native UA default when
     no explicit height overrides it) — the navbar showed, dimmed, above it
     and a page row (`Stage 2 DONE`) showed, dimmed, below its footer. Two
     dimmed layers of real content read as "a second modal behind this one".
     `max-sm:` mirrors flowbite's own `fullscreen` MODAL VARIANT (see
     `modal/theme.js`'s `fullscreen: true` classes) rather than inventing a
     new shape — `h-dvh` over that variant's own `h-screen` because a mobile
     browser's collapsing address bar makes `100vh` taller than the ACTUAL
     visible area, which is exactly the gap that let the page underneath
     show through in the first place. `max-w-none` overrides the width class
     two lines above it (a `max-sm:` utility wins over an unprefixed one of
     the same property at the same specificity — ordinary Tailwind cascade,
     already relied on everywhere else in this file). -->
<!-- ⭐ ROUND 3 (coordinator, whole-product consistency): ONE DIALOG SHELL.
     `dismissable={false}` used to suppress flowbite's own corner close
     button because the header carried a second, redundant text "Cancel" —
     every OTHER dialog in this lane (Recovery, Retry×2, Clear pin) left
     `dismissable` at its default and gets that corner × for free. Dropping
     the override here and deleting this file's own hand-rolled header
     "Cancel" (below) makes this dialog's header identical to theirs: a
     title and flowbite's own close icon, nothing else. Escape and the
     backdrop click were never gated by `dismissable` (see `Dialog.svelte`'s
     own `_oncancel`/`_onclick`), so this changes only which element draws
     the icon, not the dialog's dismiss behaviour. -->
<!-- ⭐ ROUND 4 (coordinator QA on shots-r3): NO BLANK BAND BELOW THE FOOTER.
     Measured live at 390: the `<dialog>` itself is 844px (`max-sm:h-dvh`,
     deliberate — the full-screen sheet), but flowbite's own BODY wrapper
     (the `classes.body` slot, between the `<dialog>` and this file's own
     `max-sm:h-full` flex-col) stayed content-sized at ~674px — nothing told
     IT to fill the dialog, so the extra ~170px sat as dead space below the
     footer. `classes={{ body: 'max-sm:h-full' }}` completes the height
     chain (dialog → flowbite body → this file's flex-col, each full-height
     of its parent on mobile); the grid's existing `flex-1` then fills
     whatever is left between the header and the (now correctly bottom-
     anchored) footer, same as it already did at the width where the sheet
     is content-sized instead of viewport-locked. -->
<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D — §4: "640px wide…
     Step 2 changes in place (one dialog per step)… No left-hand version
     list beside a rollback"). The two-column `max-w-4xl` master/detail
     (picker list pinned at 300px beside the preview, both visible at once
     on desktop) was exactly the shape the spec rules out — a rollback or a
     forced deploy opened here showed a stale, inert version list beside the
     decision, and nothing in the lane's reference (Linear's command menu)
     ever shows two steps at once. One width now, at every step: `640px`,
     the command-menu measure. The left pane below is `hidden` (not
     `hidden md:flex`) the instant a version is picked, at every breakpoint
     — see its own class, below. `sm:mt-[12vh] sm:mb-auto` overrides the
     native `<dialog>` UA default `margin: auto` vertical centering with the
     command-menu's own top-anchored position (CommandPalette's own
     `sm:pt-[12vh]`, the same reference) so the list can grow downward
     without the whole dialog jumping as rows filter. -->
<!-- ⭐ ⌘/CTRL+ENTER DEPLOYS. (squad-rollout, Lane D, §4) Mirrors the footer's
     own `⌘↵` hint — a shortcut that drew a hint nobody could press would be
     worse than no hint at all. Reuses `confirmDisabled`, the SAME guard the
     visible button's own `disabled` reads, so this can never fire where a
     click could not. -->
<svelte:window
	onkeydown={(event) => {
		if (!open || !selectedVersion) return;
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			if (confirmDisabled) {
				// ⭐ ROUND 5: the "try it" signal `attemptedDeploy`'s own doc
				// comment calls for — a disabled button fires no click to hook,
				// so this keyboard attempt is the one place "the reader tried"
				// can be observed at all.
				attemptedDeploy = true;
				return;
			}
			handleDeploy();
		}
	}}
/>
<!-- ⭐ round 4, AD item: "44px close button on phone" — Flowbite's own
     close button defaults to its desktop touch target everywhere;
     `classes.close` (below) appends the 44px minimum below `sm` only.
     ⭐ ROUND 5 (AD round 3: "The close button on the title's centre line,
     16px from the edge, 6px radius."). `top-4` (16px, a FIXED offset) was
     centred on the picker's own 52px step-1 row by coincidence, not by
     construction — step 2's header is `min-h-[47px] h-auto`, shorter at
     rest, so the same 16px landed high there. The close button is
     positioned by the `<dialog>` element itself (flowbite's `Dialog.svelte`
     renders it as a sibling of this whole markup, not a child of the
     header row — see that component's own `content` snippet), so it
     cannot read this header's real height directly; `top-[23px]` is that
     header's own rest-state centre (47px min-height ÷ 2) rather than a
     guess, and `rounded-sm` is the 6px step on the design language's own
     radius scale (`--radius-sm`), which this button never had at all. -->
<Modal
	bind:open
	title=""
	size="none"
	dismissable={!selectedVersion}
	role="dialog"
	aria-modal="true"
	classes={{
		body: selectedVersion ? 'max-sm:max-h-dvh' : 'max-sm:h-full',
		close:
			'end-4 top-[23px] -translate-y-1/2 rounded-sm max-sm:h-11 max-sm:w-11 max-sm:p-0 max-sm:flex max-sm:items-center max-sm:justify-center'
	}}
	class="max-w-[640px] max-sm:m-0 max-sm:w-screen max-sm:max-w-none sm:mt-[12vh] sm:mb-auto [&>div]:p-0 {selectedVersion
		? 'max-sm:mt-auto max-sm:mb-0 max-sm:h-fit max-sm:max-h-dvh max-sm:rounded-b-none'
		: 'max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none'}"
	aria-labelledby="cvm-title"
>
	<!-- Below `sm` the dialog has two shapes. Picking a build (long list) is the full-screen sheet above. A chosen build (the confirm,
	     which is the whole of a rollback) is content-sized and sits on the bottom edge like the Approve confirm: the box ends where its
	     footer ends, so a short confirm no longer carries a blank band between its last line and its buttons. -->
	<div class="flex max-h-[85dvh] flex-col {selectedVersion ? 'max-sm:max-h-dvh' : 'max-sm:h-full max-sm:max-h-none'}">
		<!-- Header.

		     ⛔ ONE CLOSE AFFORDANCE, NOT TWO. (cosmetic, coordinator operator
		     walk, 2026-09-03) `dismissable={false}` above drops flowbite's own
		     floating `✕` (`Dialog.svelte` renders it independently of `Modal`'s
		     `title` branch — it fires on `title=""` being merely falsy, which
		     it always was here). This dialog's footer already has an explicit,
		     labelled `Cancel` next to the very button it means to guard — a
		     second, unlabelled corner control doing the same thing is the
		     redundant one, and on a dialog that can ask for a typed production
		     confirmation, a quick corner-click dismiss sat needlessly close to
		     the reader's hand. Escape and the backdrop click still close it —
		     `dismissable` only gates the CloseButton's own rendering in
		     flowbite's `Dialog.svelte`, never `_oncancel`/`_onclick`. The
		     header no longer needs `pr-14` to keep the mobile Back button
		     clear of a button that is no longer there.

		     ⭐ WRAPS, NEVER TRUNCATES. (B3, 2026-09-03, operator walk) This was
		     `truncate` on the app name alone — a namespace holding two rollouts
		     (`hello-world-*`) truncated to `hello-wo…`, on the SAME dialog that
		     asks a reader to roll back production. A destructive dialog cannot
		     hide the one word that says which object it acts on. `flex-wrap` on
		     the row plus `break-words` (not `truncate`) on the name lets it wrap
		     to a second line instead — the row is already this tall on any
		     narrow viewport that also shows the env crumb, so the extra line is
		     not a new shape, only a safer one. -->
		<!-- ⭐ THE PRODUCT'S OWN HEADER BAND. (design sweep, 2026-09-03) Every
		     titled region in the product is a 47px band: 16px icon, 14/600 title,
		     the answer hard-right, 16px side padding. This dialog — the one
		     surface that changes production — had a 16px/600 title in a
		     20px-padded wrapping row with its Cancel landing on a second line at
		     the LEFT edge at 390. The crumb still wraps rather than truncates
		     (it is what names the object being acted on); the control on the
		     right never wraps, and is the same `hit-32` toggle geometry the
		     history tab uses. -->
		<!-- ⭐ `pr-10` CLEARS FLOWBITE'S OWN CLOSE ICON. (round 4, coordinator
		     QA on shots-r3) The close button is `absolute top-2.5 end-2.5` —
		     taken out of flow, so it does not push this row's own content
		     away from it, only floats on top of whatever is there. Measured
		     live: the env crumb (`Chip role="env"`) ran its text straight
		     under the icon at 390 on the open-ended picker step (no second
		     line to wrap onto, since the row had width left according to
		     flex, just not according to the icon floating over the last
		     ~40px of it). Reserving that 40px as right padding on the ROW
		     gives `flex-wrap` on the title group an honest content box to
		     wrap within — every other dialog in the lane never needed this
		     because their titles are short enough to never reach the corner;
		     this one routinely is not. -->
		<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2 — "The
		     header IS the search, as in Linear. Today there are three rows of
		     chrome.") Step 1's title row, the boxed search input and the
		     switch row used to be three separate bands; the title row and the
		     search input are now ONE 52px row — icon, borderless input, the
		     crumb and Esc right-aligned — and "Show all repo tags" moved into
		     a quiet 32px row under the list (see `leftHeaderEl`, below). Step
		     2 keeps its OWN header exactly as it was (back chevron, title,
		     rollout crumb): it is not a search, and merging the two steps'
		     headers into one shape here would have meant a borderless input
		     box sitting where step 2 needs a `t-heading`. `h2#cvm-title` is
		     now the Modal's accessible name on BOTH steps even though step 1
		     no longer shows it as text — `sr-only`, not deleted. -->
		<!-- round 4: the close button moved from `end-2.5`/default size to
		     `end-4` (16px, matching every other right inset) at a 44px
		     touch target below `sm` — this row's own reserved space grows
		     to match (`pr-12` desktop, `pr-16` below `sm`) so it still
		     clears the larger button rather than the old fixed `pr-10`. -->
		{#if !selectedVersion}
			<div
				class="border-line flex h-[52px] shrink-0 items-center justify-between gap-3 border-b pr-12 pl-4 max-sm:pr-16"
			>
				<h2 id="cvm-title" class="sr-only">
					{dialogTitle}{#if rollout?.metadata?.name}
						/ {rollout.metadata.name}{/if}
				</h2>
				<SearchOutline class="text-fg-subtle h-4 w-4 shrink-0" aria-hidden="true" />
				<input
					type="text"
					placeholder={isPhone ? 'Search builds…' : 'Search builds by sha, version or commit…'}
					bind:value={searchQuery}
					onkeydown={onPickerKeydown}
					aria-label="Search builds by sha, version or commit"
					class="t-body cvm-ios-16 text-fg placeholder:text-fg-subtle min-w-0 flex-1 border-0 bg-transparent p-0 focus:ring-0 focus:outline-none"
				/>
				{#if envLabel}
					<!-- D-19, ledger (design reviewer, 2026-10-08): the `·` used to
					     be its own flex child, sibling to the env label — at 512px
					     the row wrapped BETWEEN them, leaving a bare `·` orphaned at
					     the end of line one and the env alone on line two. One span
					     now, `·` and all, so the wrap can only land before the whole
					     unit, never inside it.

					     ⭐ `Chip role="env"` NOW, NOT BARE UPPERCASE TEXT. (round 2,
					     design review 4) An environment is drawn ONE way everywhere
					     — the name as written, a neutral outline, a 6px identity
					     dot (principle 11). `envTheme` is `null` for a rollout with
					     no matching `Environment` record; the chip then falls back
					     to the plain label with no dot, same shape every other
					     theme-less env render in the product already takes. -->
					<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 3 —
					     AD item 8: "The picker header loses the env crumb (on
					     prod you can't see which env)."). `max-sm:hidden` used to
					     drop the ONE fact that says which environment a prod
					     build is about to land in, at exactly the width an
					     operator is most likely to be glancing at this quickly.
					     The chip stays below `sm` now; only the cluster suffix
					     (a second, lower-priority fact) still hides there to keep
					     the row from fighting the search input for space. -->
					<span class="flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap">
						<Chip role="env" theme={envTheme} label={envLabel} />
						{#if clusterLabel}
							<span class="t-ui-sm text-fg-subtle max-sm:hidden">· {clusterLabel}</span>
						{/if}
					</span>
				{/if}
				<!-- ⭐ Esc kbd. (squad-rollout, Lane D, §4: "the title crumb
				     right-aligned … and Esc kbd".) Step 1 only — once a build
				     is picked the header carries the back chevron instead, and
				     the footer's own kbd row already restates Esc there. -->
				<!-- ⭐ `Cancel` LIVES IN THE SHARED FOOTER. (round 3, coordinator
			     review) This header used to carry its own `Cancel` button when
			     no version was picked yet — the one dialog in the lane with no
			     footer at that step at all. The footer below is now ALWAYS
			     rendered (Cancel always, the confirm action once a build is
			     picked), so the header's only remaining job is the title —
			     `Back` moved to the title's own row, above — and flowbite's own
			     close icon, which this empty right-hand box reserves room for
			     (it is absolutely positioned by `Dialog.svelte`, not a flex
			     child here, but the row still needs its own right edge clear of
			     any OTHER control for it to land in). -->
			</div>
		{/if}

		<!-- ⭐ THE LEFT PANE'S HEIGHT IS ITS OWN CONTENT'S, NOT THE RIGHT PANE'S —
		     BUT ONLY WHEN THAT IS SAFE. (F10, design pass 2 re-check)
		     `align-items: stretch` (the grid default) forced the picker column
		     to match the preview column's height every time they differ —
		     measured 300×626 holding a search field and two rows, 65% empty,
		     while the right pane's own content ran the full height beside it.
		     A first attempt switched the grid to `items-start`, and a second
		     look with a 22-release fixture (`hello-multi-app`) caught what it
		     broke: `align-items` does not just position an already-sized
		     track, it changes whether an OVERSIZED item is allowed to overflow
		     it. With `stretch`, an oversized grid item forces the ancestor
		     flex chain to `flex-shrink` the whole grid down to the dialog's
		     `max-h-[85vh]` budget and the picker's own `overflow-y-auto`
		     engages correctly (verified: 708px, scrollable). With `start`, the
		     picker used its own uncapped intrinsic height (1406px) and spilled
		     the version list out through the BOTTOM of the dialog card onto
		     the page behind it — worse than the defect it fixed.
		     `leftPaneMaxHeight` below measures the picker's true content need
		     (header + the list's real `scrollHeight`, not its stretched
		     rendered height) against the RIGHT pane's own rendered height —
		     the right pane is never overridden, so its height is always an
		     honest read of what the row actually has available. Only when the
		     picker's content is SHORTER than that does an explicit `max-height`
		     apply, which `stretch` still respects (a definite max-height wins
		     over "fill the track"); otherwise no override is set and the
		     picker keeps the exact stretch-and-scroll behaviour verified safe
		     above. -->
		<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D). This grid used to
		     switch to `md:grid-cols-[300px_1fr]` once a version was picked —
		     a 300px picker column staying visible beside the preview at
		     desktop widths. §4's "Step 2 changes in place (one dialog per
		     step)" and "No left-hand version list beside a rollback" both
		     rule that out: one column, always, at every breakpoint. -->
		<div
			class="grid min-h-0 flex-1 overflow-hidden {selectedVersion
				? 'grid-rows-[minmax(0,1fr)]'
				: ''}"
		>
			<!-- LEFT: version picker. The whole dialog until a version is
			     picked; hidden entirely (every breakpoint) once one is —
			     step 2 replaces step 1 in place, it never sits beside it. -->
			<div
				bind:this={leftPaneEl}
				style={leftPaneMaxHeight != null ? `max-height: ${leftPaneMaxHeight}px` : ''}
				class="border-line flex-col overflow-hidden {selectedVersion ? 'hidden' : 'flex'}"
			>
				<div bind:this={leftHeaderEl} class="shrink-0">
					<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2).
					     The search box that used to live here moved INTO the
					     header row (the header IS the search now, above) — this
					     is the one thing left: a quiet 32px switch row, not its
					     own boxed `.input` + a 44×24 toggle at full card weight.
					     `cvm-showall-label` keeps the Toggle's accessible name
					     (measured: the checkbox behind it was the first tab stop
					     with no name at all). -->
					<div class="flex h-8 items-center justify-between px-4">
						<span id="cvm-showall-label" class="t-meta text-fg-subtle">Show all repo tags</span>
						<!-- ⛔ NOT BLUE. (operator walk, 2026-09-03) `src/lib/CLAUDE.md`'s
						     rule: a selected toggle is gray-900/gray-100, always — blue
						     is `Deploying`'s colour and this switch deploys nothing.
						     `color="gray"` only neutralises the focus ring
						     (flowbite's `gray` variant checks in at `gray-500`, not
						     `gray-900`); the checked fill is overridden to match every
						     other toggle in the product (`LogsViewer`'s `Follow`/`Wrap`,
						     the History tab's `Compare namespace`/`Show environments`).
						     ⛔ SIZED DOWN, 2026-10-09 (round 2): a quiet row inside the
						     list footer is not "Pin Version"'s own weight — `size="small"`
						     (36×20) here now, matching the row's own reduced height;
						     `Pin Version` (the dialog's genuinely consequential toggle,
						     in the confirm step) stays the default 44×24. -->
						<Toggle
							bind:checked={showAllTags}
							size="small"
							color="gray"
							classes={{ span: 'peer-checked:!bg-inverse' }}
							aria-labelledby="cvm-showall-label"
							onchange={() => {
								if (showAllTags && allRepositoryTags.length === 0) getAllRepositoryTags();
							}}
						/>
					</div>
					<!-- The toggle answers. (operator walk, 2026-09-07: "toggles → zero
					     change, no 'no additional tags'.") When every registry tag is
					     already a release, flipping it changed nothing on screen and
					     said nothing about why. -->
					{#if showAllTags && !loadingAllTags}
						<p class="t-meta text-fg-subtle px-4 pb-2">
							{extraTagCount === 0
								? noReleases
									? `${noReleases.label}: no tag is a release yet.`
									: 'No other tags in the registry — every tag is already a release.'
								: `${extraTagCount} more tag${extraTagCount === 1 ? '' : 's'} from the registry, below.`}
						</p>
					{/if}
				</div>

				<!-- ⛔ ONE TAIL MECHANISM, NOT TWO. (F11, 2026-09-03) This list had
				     both a scrollbar (`overflow-y-auto`, below) AND `Prev 1/2 Next`
				     pagination — two ways to reach the same tail, and the pagination
				     bar sliced the last row of whichever page it sat under. Scroll
				     alone is the list's own idiom everywhere else in the product. -->
				<!-- ⭐ `pb-4` + `cvm-scroll-fade`. (F6, 2026-09-03 re-check) The last
				     row used to sit flush against the dialog's own bottom edge —
				     zero padding below it, no fade, no scrollbar affordance, so a
				     17-row list read as though it just stopped rather than
				     continuing off-screen. `pb-4` matches the deploy footer's own
				     `p-4` so the last row breathes the same 16px every other edge
				     of this dialog does. `cvm-scroll-fade` is the classic
				     background-attachment scroll-shadow (see the `<style>` block
				     below): two soft shadows pinned to the viewport's own top/bottom
				     edges (`background-attachment: scroll`), masked by two matching
				     covers that scroll WITH the content (`attachment: local`) — so
				     the cue is only visible on the edge that still has more list
				     behind it, and disappears on its own once you have scrolled
				     past it. No JS scroll-position tracking needed. -->
				<div
					bind:this={leftListEl}
					class="cvm-scroll-fade flex-1 overflow-y-auto pb-4"
					role="group"
					aria-label="Available versions"
				>
					{#if filteredVersionsForDisplay.length > 0}
						{#each filteredVersionsForDisplay as version, versionIndex (typeof version === 'string' ? version : version.tag)}
							{@const versionTag = typeof version === 'string' ? version : version.tag}
							{@const groupLabel = versionGroupLabels[versionIndex]}
							{#if groupLabel}
								<!-- 28px group header, the running build as the anchor
								     (§4). `role="presentation"` inside `role="group"`'s own
								     list: it is a visual break, not a second nameable group
								     the list's own `aria-label` already covers. -->
								<div
									class="t-label bg-surface text-fg-subtle sticky top-0 z-10 flex h-7 items-center px-4"
								>
									{groupLabel}
								</div>
							{/if}
							{@const availableRelease = releaseList.find((ar) => ar.tag === versionTag)}
							{@const commitTitle =
								pickerTitleBySha.get(versionTag) ??
								(versionTag === rootReleaseTag ? buildTitle(rootCommitQuery.data) : null)}
							{@const displayVersion = availableRelease
								? getDisplayVersion(availableRelease)
								: getDisplayVersion({
										version: annotations[versionTag]?.['org.opencontainers.image.version'],
										tag: versionTag
									})}
							{@const created =
								availableRelease?.created ||
								annotations[versionTag]?.['org.opencontainers.image.created']}
							{@const isCurrent = currentTag === versionTag}
							{@const isPinned = rollout?.spec?.wantedVersion === versionTag}
							{@const isSelected = selectedVersion === versionTag}
							{@const pickerLine = pickerRowLine(created, isCurrent)}
							{@const rank = pickerRankLabel(versionTag)}
							{@const isBackRank = rank?.endsWith('back') ?? false}
							<!-- ⭐ (2026-10-09, integration round 3, item 3; round 4, item
							     follow-up) `isDeployable` ALONE MISSES A CONTRACT HOLD —
							     see the doc comment on `contractHeldVersions` above.
							     `displayVersion` is the key because the dependency graph's
							     held set is already in DISPLAY-VERSION form
							     (`contractHoldFor`, rollout detail's own doc comment:
							     "matching `getDisplayVersion(releaseCandidate)`, never the
							     tag"). `effectiveContractHeldVersions` is the caller's
							     override when given, else this dialog's own
							     `selfHeldGraph` answer — see that derivation's own
							     comment. -->
							{@const isNewerCandidate = !isCurrent && rank?.endsWith('newer') === true}
							{@const gateHeld = isNewerCandidate && !isDeployable(rollout, versionTag)}
							<!-- ⭐ ITEM (b), coordinator follow-up, 2026-10-09. A row is only
							     genuinely UNKNOWN while it passes every gate (`!gateHeld`) and
							     the contract graph this `held` chip also depends on hasn't
							     resolved yet (`heldStatePending`) — a gate-held row is already
							     known held with no query involved, same as `isHeld` below. -->
							{@const rowHeldPending = isNewerCandidate && !gateHeld && heldStatePending}
							<!-- ⭐ ITEM 2 (coordinator, 2026-10-09). THE SAME SPLIT AS
							     `rowHeldPending`, FOR A LIST THAT FAILED RATHER THAN ONE
							     STILL LOADING — see `heldStateErrored`'s own comment. -->
							{@const rowHeldErrored = isNewerCandidate && !gateHeld && heldStateErrored}
							{@const isHeld =
								isNewerCandidate && (gateHeld || effectiveContractHeldVersions.has(displayVersion))}
							<!-- ⭐ THE REASON, AS THE ROW'S META — NOT JUST THE WORD
							     "held". (squad-rollout, Lane D, round 3, AD item 7: "held
							     rows say only 'held' while the page behind says 'held ·
							     1 rule · Needs payments-svc ≥2.9.0'.") Two sources, no
							     new network call: a gate-held row already has
							     `rollout.status.gates` in hand (the same list
							     `overriddenGates` reads for the SELECTED version, read
							     here per-row instead); a contract-held row reads the
							     self-derived graph's own edges when that path is active
							     (`selfHeldGraph.edges`, same object `effectiveContract
							     HeldVersions` is already built from) for the contract/
							     required-version/provider a caller-supplied override
							     set has no edges to explain, in which case this falls
							     back to `null` and the glyph's own tooltip is the only
							     reason given. -->
							{@const heldReason = isHeld
								? heldReasonFor(versionTag, displayVersion, gateHeld)
								: null}
							<!-- ⭐ THE NEWEST ROW, FOR THE LEADING GLYPH. (squad-rollout,
							     Lane D, round 2, §4: "newest = success rest dot".) The
							     list is sorted newest-first; the first row that is not
							     the running build IS the newest release, by construction
							     — no second ranking needed. -->
							{@const isNewestOfAll = versionIndex === 0 && !isCurrent}
							{@const currentRowRole = isCurrent
								? rolloutStateChip(rollout?.status?.history?.[0]?.bakeStatus).role
								: null}
							{@const ageShort =
								isCurrent && currentDeployedAt
									? `deployed ${formatTimeAgoCompact(currentDeployedAt)} ago`
									: created
										? formatTimeAgoCompact(created)
										: null}
							{#await loadAnnotationsOnDemand(versionTag)}{/await}
							<!-- ⭐ A RESTING AFFORDANCE, NOT JUST A HOVER FILL. (P6,
							     2026-09-03, operator walk) `dark:border-gray-800` on the row
							     divider was THE SAME SHADE as the dialog's own dark
							     background (`dark:bg-gray-800`) — invisible, so in dark mode
							     the list read as one undivided block with no per-row edge at
							     all, and with nothing else marking a row as a control (no
							     border, no chevron, no icon), tapping one read like toggling
							     a filter rather than opening a confirmation. Divider bumped
							     one step lighter (`dark:border-gray-700`, this file's own
							     border colour everywhere else) and a trailing chevron now
							     sits at REST on every row, not only on `:hover` — hover does
							     not exist on touch, so a hover-only affordance is invisible
							     on the phone this list is equally used on. -->
							<!-- ⭐ `bg-selected`, NOT `bg-active-tint`. (round 2, design
							     review 4) `active` is the deploying/live hue — a picked-
							     but-not-yet-deployed row is not in flight, so tinting it
							     blue claimed a state that was not true yet. `bg-selected`
							     is the product's one "this is the current selection" mark
							     (a master/detail list, a selected nav item, §2.4) — neutral,
							     no hue borrowed from a status it does not hold. -->
							<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2 —
							     "Rows are one line, 44px … Drop the per-row chevron;
							     selection is bg-selected"). Round 1 kept the two-line
							     row (build+badges, then a date/rank meta line) and a
							     resting chevron on every row. One line now: a 16px
							     leading glyph (state/newest/held — the SAME family
							     `StatusMark`/`HeldGlyph` draw everywhere else, §3.11),
							     the build and its badges, then the age right-aligned.
							     No chevron — a `bg-selected` row at rest (keyboard nav
							     or hover) already says "this is where ↵ lands" without
							     a second affordance repeating it twenty times down the
							     list. -->
							<button
								type="button"
								data-version-row
								aria-pressed={isSelected}
								class="border-line-subtle hover:bg-hover flex h-11 w-full items-center gap-3 border-b px-4 text-left transition-colors last:border-b-0 {isSelected ||
								versionIndex === activeVersionIndex
									? 'bg-selected'
									: ''}"
								onclick={() => selectVersion(versionTag)}
								onpointerenter={(e) => {
									// round 7 (AD r6 item 6): a TOUCH never moves the
									// highlight — the tap that opened the dialog landed
									// on a row under the finger and highlighted it.
									if (e.pointerType === 'mouse') activeVersionIndex = versionIndex;
								}}
							>
								<!-- Leading glyph: pending (checking a hold) > held > the
								     running build's own state > the newest release's rest
								     dot > nothing, for every other row (§4: "others
								     empty"). -->
								<span class="flex h-4 w-4 shrink-0 items-center justify-center">
									{#if rowHeldPending}
										<span class="sr-only">Checking whether this build is held</span>
										<span
											class="bg-fg-disabled h-2.5 w-2.5 animate-pulse rounded-full"
											aria-hidden="true"
										></span>
									{:else if isHeld}
										<HeldGlyph
											class="text-held h-4 w-4"
											title={heldReason ? plainGateText(heldReason) :
												'Held — a rule currently blocks this build from deploying automatically'}
										/>
									{:else if isCurrent}
										<StatusMark
											state={currentRowRole === 'failing'
												? 'failed'
												: currentRowRole === 'checking'
													? 'checking'
													: currentRowRole === 'deploying'
														? 'deploying'
														: 'behind'}
											label="running"
										/>
									{:else if isNewestOfAll}
										<StatusMark state="behind" label="newest" />
									{/if}
								</span>
								<div class="flex min-w-0 flex-1 items-baseline gap-2">
									<!-- D-5, ledger (design reviewer, 2026-10-08): a build id is
									     the product's MONO role everywhere it is the row's own
									     identity — rollout detail's "Newer builds" list, History,
									     `/versions`. Design language: ids are mono → `t-code`
									     (14/400), the name ink carries the row's emphasis. -->
									<span class="t-code text-fg shrink-0">{displayVersion}</span>
									<!-- ⭐ (2026-10-10, truth-bug fix) THE COMMIT TITLE, FROM
									     THE SAME BATCHED GITHUB QUERY EVERY OTHER SURFACE READS
									     (`pickerTitleBySha`, above `headCommit`) — no more
									     mock-only `commitMessage`. Absent in production (no
									     GitHub data to batch), so nothing renders there; the
									     search box's placeholder promise is only true once
									     there is something here to match against. -->
									{#if commitTitle}
										<span class="t-body text-fg-muted min-w-0 truncate">{commitTitle}</span>
									{/if}
									{#if isCurrent}
										<!-- QUIET TEXT, NOT A CHIP. (round 4, coordinator QA) §3.11:
										     "a healthy row's state is its glyph" -- a chip on a row
										     that is simply FINE spends a mark the direction reserves
										     for a state that needs a person. -->
										<!-- round 8 (AD r7 item 2): one meaning per column — the
										     right-hand age is BUILD age on every row; the running
										     row's label carries when it was deployed here. -->
										<!-- round 9 (AD r8, P2): the running row shows ONE age, its
										     deploy time, in the age column (below); "current" only
										     when no deploy time is known. -->
										{#if !currentDeployedAt}
											<span class="t-meta text-fg-subtle shrink-0 whitespace-nowrap">current</span>
										{/if}
									{/if}
									{#if isPinned}
										<Chip role="count" label="pinned" />
									{/if}
									<!-- ⭐ ITEM 2 (coordinator, 2026-10-09), STILL SAID IN WORDS,
									     NOW AS THE ROW'S ONE LINE OF META INSTEAD OF A SECOND
									     BADGE. (round 2, squad-rollout, Lane D) With round 2's
									     fix to `selfHeldGraph` (its own doc comment, above:
									     `focus` so a dependency-free rollout gets a node), this
									     branch is now rare — an actual list failure or a true
									     cross-cluster lookup miss, not the common case it used
									     to paper over. -->
									{#if rowHeldErrored}
										<span class="t-meta text-fg-subtle min-w-0 truncate">
											Couldn't check dependency holds
										</span>
									{:else if isHeld}
										<!-- The glyph carries the mark; this is the "as the row's
										     meta" half of §4's "held = HeldGlyph in held ink … and
										     as the row's meta" — quiet text, not a filled chip (a
										     healthy-adjacent row spends no more hue than the glyph
										     already does). The REASON when one is known
										     (`heldReasonFor`, round 3), "held" bare only when it
										     is not. -->
										<span class="t-meta text-held min-w-0 truncate">{#if heldReason}<GateText text={heldReason} />{:else}held{/if}</span>
									{/if}
								</div>
								<!-- ⭐ SUPERSEDED, 2026-10-10 (squad-rollout, Lane D, round 4
								     — AD round 2, item 2: "Drop 'N newer' from every picker
								     row (the group header says it)."). The rank used to
								     repeat here on every single row under a group header
								     ("Newer than running") that already says the same
								     thing for the whole group — twenty rows each re-stating
								     a direction the section title already named once. Age
								     is the one per-row fact that still earns its place
								     (every row's age genuinely differs); `title` carries
								     the full relative sentence for a reader who wants it. -->
								<div class="flex shrink-0 items-center gap-2 self-center pl-2">
									{#if ageShort}
										<span
											class="t-meta text-fg-subtle whitespace-nowrap tabular-nums"
											title={pickerLine}>{ageShort}</span
										>
									{/if}
								</div>
							</button>
						{/each}
					{:else}
						{#if noReleases}
							<div class="px-4 py-8 text-center" data-no-release-source>
								<p class="t-body text-fg">{noReleases.label}</p>
								<p class="t-meta text-fg-subtle mt-1">{noReleases.message}</p>
							</div>
						{:else}
							<div class="t-body text-fg-subtle px-4 py-8 text-center">No versions available</div>
						{/if}
					{/if}
				</div>
			</div>

			{#if selectedVersion}
				<!-- ⭐ STEP 2: ONE PANE, ONE SCROLLER. (squad-rollout, Lane D, round 6 —
				     AD round 4, items 3, 6, 7, 10.) Below `sm` this pane is the sheet's
				     only scroller and the header scrolls WITH the body (only the
				     footer, outside the pane, stays); from `sm` up the header is fixed
				     and the body under it scrolls. The header is the shell every
				     dialog in the lane shares (RecoveryModeWarningModal is the same
				     markup): the rollout crumb in `t-meta` ABOVE the title on the same
				     left edge; the title in `t-heading`, wrapping (never truncating the
				     environment); a 32px ghost back chevron on the title's line only
				     when a picker step exists (the crumb is indented by the same 28px
				     so the two text edges stay one); a 32px ghost close on the same
				     line. Flowbite's own floating close is off at this step
				     (`dismissable={!selectedVersion}`): it cannot scroll with a
				     header. -->
				<div
					bind:this={rightPaneEl}
					style={rightPaneMaxHeight != null ? `max-height: ${rightPaneMaxHeight}px` : ''}
					class="flex min-h-0 flex-col max-sm:overflow-y-auto sm:overflow-hidden"
				>
					<header class="border-line shrink-0 border-b px-4 py-3">
						{#if rollout?.metadata?.name}
							<p class="t-meta text-fg-subtle truncate {reachedViaPicker ? 'pl-6' : ''}">
								{rollout.metadata.name}
							</p>
						{/if}
						<div class="flex items-start">
							{#if reachedViaPicker}
								<button
									type="button"
									class="btn btn-ghost btn-sm btn-icon hit-44 -my-1 -ml-2 shrink-0"
									onclick={() => {
										selectedVersion = null;
										activeVersionIndex = 0;
									}}
									aria-label="Back to version list"
								>
									<ChevronLeftOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
								</button>
							{/if}
							<h2
								id="cvm-title"
								class="t-heading text-fg mr-1 min-w-0 flex-1 [overflow-wrap:anywhere]"
							>
								{dialogTitle}
							</h2>
							<button
								type="button"
								class="btn btn-ghost btn-sm btn-icon hit-44 -my-1 -mr-2 shrink-0"
								aria-label="Close"
								disabled={deploying}
								onclick={() => (open = false)}
							>
								<CloseOutline class="h-4 w-4" aria-hidden="true" />
							</button>
						</div>
					</header>

					<div
						bind:this={rightContentEl}
						onscroll={updateBodyMore}
						onfocusin={revealFocused}
						class="flex flex-col gap-4 p-4 sm:min-h-0 sm:flex-1 sm:overflow-y-auto"
					>
						<!-- ⭐ THE TRANSITION BLOCK, THE DIALOG'S FACE. (round 6 — AD round 4,
						     items 2, 5, 9.) One well (`rounded-md`, the language's well
						     radius), two tiles of ONE anatomy (see `fromTileMark`'s doc
						     comment), joined by a drawn connector that names the move. Side by
						     side from `sm`; stacked below it, the connector then runs down the
						     16px status column so the two marks read as one line. -->
						{#if currentTag && direction !== 'same'}
							{#snippet tile(
								mark: NodeState,
								build: string,
								title: string | null,
								commit: { author?: string | null; avatarUrl?: string | null } | null,
								age: string | null,
								state: TileState,
								since: string | null
							)}
								<div class="min-w-0">
									<div class="flex min-w-0 items-center gap-2">
										{#if mark === 'none'}
											<!-- AD round 5, item 3: both tiles carry a 16px mark. The
											     empty mark is `EmptyGlyph` itself, drawn at the 16px
											     footprint in the subtle ink so "Not deployed here" is
											     visible beside the other tile's disc (its default 8px
											     line-strong ring measured ~15% contrast on the well). -->
											<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center">
												<EmptyGlyph class="[&>span]:border-fg-subtle [&>span]:h-4 [&>span]:w-4" />
											</span>
										{:else if mark === 'newest'}
											<!-- round 7 (AD r6 item 2): a healthy tile carries a 16px
											     mark like its neighbour, not the 6px rest dot alone:
											     the rest dot inside StatusMark's own tint + line
											     circle (success hue). -->
											<span
												class="bg-success-tint ring-success-line inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset"
											>
												<span class="bg-success-solid h-1.5 w-1.5 rounded-full"></span>
											</span>
										{:else}
											<StatusMark state={mark} />
										{/if}
										<div class="t-code-lg text-fg min-w-0 truncate">{build}</div>
									</div>
									<div class="mt-1 pl-6">
										{#if title}
											<p class="t-body text-fg line-clamp-2 [overflow-wrap:anywhere]" {title}>
												{title}
											</p>
										{:else}
											<p class="t-body text-fg-subtle truncate">
												{githubStatusQuery.data && !githubStatusQuery.data.connected
													? 'Commit message unavailable'
													: 'No commit message'}
											</p>
										{/if}
										<div class="dot-list mt-1">
											<div class="dot-list-row t-meta text-fg-subtle flex flex-wrap items-center">
												{#if commit}
													<span class="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
														<Avatar
															name={commit.author || 'unknown'}
															src={commit.avatarUrl}
															size={16}
														/>
														{commit.author || 'unknown'}
													</span>
												{/if}
												{#if age}<span class="whitespace-nowrap">{age}</span>{/if}
											</div>
										</div>
										{#if state || since}
											<div class="dot-list">
												<div class="dot-list-row t-meta text-fg-subtle flex flex-wrap items-center">
													{#if state}<span class="whitespace-nowrap {state.ink}">{state.word}</span
														>{/if}
													{#if since}<span class="whitespace-nowrap">{since}</span>{/if}
												</div>
											</div>
										{/if}
									</div>
								</div>
							{/snippet}
							<div
								class="border-line bg-subtle grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] sm:gap-0 sm:p-4"
							>
								{@render tile(
									fromTileMark,
									currentDisplayVersion,
									fromTileTitle,
									fromTileAuthor,
									fromTileAge,
									fromTileState,
									fromTileSince
								)}
								<div
									class="flex items-center gap-2 sm:flex-col sm:items-center sm:justify-start sm:gap-0"
									aria-hidden="true"
								>
									<svg
										width="16"
										height="20"
										viewBox="0 0 16 20"
										fill="none"
										class="text-fg-subtle shrink-0 sm:hidden"
									>
										<path
											d="M8 1v17m-5-5 5 5.5 5-5.5"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
									<svg
										width="28"
										height="14"
										viewBox="0 0 28 14"
										fill="none"
										class="text-fg-subtle mt-[7px] hidden shrink-0 sm:block"
									>
										<path
											d="M1 7h25m-5.5-5L26 7l-5.5 5"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
									{#if connectorLabel}
										<span class="t-meta text-fg-subtle tabular-nums sm:mt-1 sm:text-center"
											>{connectorLabel}</span
										>
									{/if}
								</div>
								{@render tile(
									toTileMark,
									getDisplaySelectedVersion(),
									toTileTitle,
									toTileAuthor,
									toTileAge,
									toTileState,
									null
								)}
							</div>
						{/if}
						{#if (!deployNotice && gateNote) || (rollout && hasForceDeployAnnotation(rollout)) || selectedVersionHeldErrored || deployNotice || inRecoveryMode}
							<div
								class="t-meta border-line bg-subtle text-fg-muted flex items-start gap-2 rounded-md border p-3"
							>
								<ExclamationCircleSolid
									class="mt-0.5 h-4 w-4 shrink-0 {calloutTone === 'danger'
										? 'text-danger'
										: calloutTone === 'held'
											? 'text-held'
											: 'text-fg-subtle'}"
								/>
								<div class="min-w-0 flex-1 [&>*:not(:first-child)]:mt-2">
									{#if !deployNotice && gateNote}
										<!-- This does NOT hold this action — its whole job is to
										     stop the page's own hold banner behind this modal from
										     being the reader's only statement about the gate, which
										     is a FACT to carry forward. Mutually exclusive with
										     `deployNotice` by construction (the `!deployNotice`
										     guard), so this is never the box's SECOND line. -->
										<p>{gateNote}</p>
									{/if}
									{#if deployNotice}
										<!-- ⭐ THE CONSEQUENCE, NAMED, WHERE THE DECISION IS MADE.
										     The critique's charge was that a build reached
										     PRODUCTION through three closed gates in two clicks and
										     *"the modal never says production"*. It says it now,
										     and it says what the gates currently think of this
										     exact build.

										     ⭐ ONE FULL-STRENGTH SENTENCE — THE CONSEQUENCE — THEN
										     MUTED REST. (F10, design pass 2 re-check; round 3
										     revision) Only the LEAD sentence (`splitLeadSentence`)
										     carries full-strength `text-fg`; the rest is
										     `text-fg-muted`. Emphasis inside a sentence is colour,
										     never weight (DESIGN-LANGUAGE.md §4's do/don't table).
										     `{' '}` (not a template-literal space) survives Svelte's
										     own whitespace trimming across the two spans (round 3
										     fix, QA4: "…has already run.It applies…" ran together
										     without it). -->
										<div>
											<span class="text-fg">{deployNoticeParts?.lead}</span
											>{#if deployNoticeParts?.rest}<span class="text-fg-muted"
													>{' '}{deployNoticeParts.rest}</span
												>{/if}
											{#if gateWhy && !(inRecoveryMode && direction === 'rollback')}
												<span class="text-fg-muted mt-1 block"
													>Automatic promotion is held right now — {gateWhy}.</span
												>
											{/if}
											<!-- ⭐ THE RULES IT OVERRIDES, NAMED — the prod
											     force-deploy dialog used to say only "a rule is
											     holding it" while the banner behind it named the
											     count and the Dependencies tab named the contract.
											     Structured, not a second sentence: a `FactList`
											     under the consequence, one row per gate.
											     ⛔ NOT `tone="banner"` here — that tone gives the
											     label AND the value the alert's own ink on purpose
											     (no alpha clears 4.5:1 over `AlertPanel`'s gradient),
											     which read as one undifferentiated red block. This
											     well is a flat tint, so the value can afford the
											     same neutral ink the `card` record uses — the label
											     stays in the alert's own ink via `tone="alert"`. -->
											{#if overrideContextPending}
												<!-- ⭐ THE ROW WITHHOLDS THE GATE'S NAME AND KIND
												     WHILE PENDING, NEVER THE RAW ID. (2026-09-04,
												     load-state audit finding 12) The row COUNT is
												     real; only each row's NAME and KIND are pending,
												     so one skeleton row per gate replaces the record
												     until the join resolves. -->
												<div class="mt-2 flex flex-col gap-1" aria-hidden="true">
													{#each overriddenGates as g (g.name)}
														<div class="flex items-center gap-3">
															<SkeletonBar width="w-16" height="h-[15px]" />
															<SkeletonBar width="flex-1" height="h-[15px]" />
														</div>
													{/each}
												</div>
											{:else if overrideFacts.length > 0}
												<FactList facts={overrideFacts} tone="alert" class="mt-2" />
											{/if}
										</div>
									{/if}
									{#if inRecoveryMode}
										<!-- round 6 (AD round 4, item 2): the warning that opened
										     before this confirm, carried in as one line. -->
										<p>
											<span class="text-fg">Recovery mode:</span> waits for health checks instead of&nbsp;failing.
										</p>
									{/if}
									{#if rollout && hasForceDeployAnnotation(rollout)}
										<p>
											A force deploy is already set on this rollout; this deploy replaces its
											target.
										</p>
									{/if}
									<!-- ⭐ ITEM 2 (coordinator, 2026-10-09). SAYS SO PLAINLY,
									     NEVER A PERMANENT DISABLE. `/api/rollouts` failed, so
									     this dialog cannot vouch for whether another service is
									     holding this build — a deliberately separate FACT from
									     `deployNotice` above (that states what the GATES allow,
									     a checked truth; this states what could not be checked
									     at all). Its own icon tone stays out of `calloutIsAdverse`
									     on purpose: an unknown is not a known-bad build. -->
									{#if selectedVersionHeldErrored}
										<p>
											<span class="text-fg">Couldn't check dependency holds for this build.</span
											>{' '}The rollout list failed to load, so another service holding this build
											can't be ruled out. Treating it as a risk — type the version below to confirm.
										</p>
									{/if}
								</div>
							</div>
						{/if}

						{#if direction !== 'same'}
							<div>
								{#if compareBase && compareHead && compareBase === compareHead}
									<!-- The one fact that decides whether a bypass is safe: two
									     releases of the same commit ship no code. (operator walk,
									     2026-09-03 — rel-66 and rel-67 share 9f10e49, and the dialog
									     only said GitHub was not connected.) -->
									<p class="t-body text-fg-muted mb-2">
										Same commit as the running build (<code class="t-code-sm"
											>{compareHead.slice(0, 7)}</code
										>) — only the release changed. No code moves.
									</p>
								{/if}
								<!-- ⭐ ONLY WHEN THERE IS A LIST TO HEAD. (squad-rollout, Lane
								     D, round 2 — `hasCommitList`'s own doc comment.) Also
								     shown while loading UNLESS `githubStatusQuery` has
								     already settled the "not connected" branch — the SAME
								     fork the loading skeleton just below already makes, so
								     the header never promises a list this load is not
								     heading toward. -->
								{#if hasCommitList || (commitsQuery.isLoading && !(githubStatusQuery.data && !githubStatusQuery.data.connected))}
									<div class="mb-2 flex items-center justify-between">
										<!-- A section title at the card-title role, not a tracked
										     eyebrow over a prose sentence (`lib/CLAUDE.md` bans the
										     latter, and the sentence under it is prose whenever GitHub
										     is absent). -->
										<span class="flex items-baseline gap-2">
											<span class="t-card-title text-fg">
												{direction === 'rollback' ? 'Commits to revert' : 'Commits to deploy'}
											</span>
											<!-- The count that used to open the transition block as its own
											     "ships/reverts N commits" line now lands here instead -- a
											     card-title row own rollup. A SIBLING, not a child, of the
											     title span, so the title text stays an exact, undecorated
											     string. -->
											{#if commitsQuery.data}
												<span class="t-meta text-fg-subtle whitespace-nowrap tabular-nums"
													>&middot; {commitsCapped
														? `${commitsQuery.data.commits.length} of ${commitsTotal}`
														: commitsQuery.data.commits.length}</span
												>
												{#if commitsCapped}
													<!-- round 8 (AD r7 item 1): the cap, on the header line
													     in the collapsed state, so "6 of 22" is never read
													     as something "Show more" could complete. -->
													<span class="t-meta text-fg-subtle whitespace-nowrap"
														>&middot; GitHub returns the newest {commitsQuery.data.commits
															.length}</span
													>
												{/if}
											{/if}
										</span>
										{#if supportsManifestDiff}
											<a
												href={href(
													`/rollouts/${cluster}/${rollout?.metadata?.namespace}/${rollout?.metadata?.name}/diff/${selectedVersion}`
												)}
												class="nav-link"
											>
												<CodePullRequestSolid class="mr-1 h-3 w-3" aria-hidden="true" />
												See the diff
											</a>
										{/if}
									</div>
								{:else if supportsManifestDiff && !hasCommitList && !commitsQuery.isLoading}
									<!-- No list, but a diff still exists to see (a manifest
									     diff does not depend on GitHub commit history) — the
									     link survives without the header it used to sit in. -->
									<a
										href={href(
											`/rollouts/${cluster}/${rollout?.metadata?.namespace}/${rollout?.metadata?.name}/diff/${selectedVersion}`
										)}
										class="nav-link mb-2 inline-flex"
									>
										<CodePullRequestSolid class="mr-1 h-3 w-3" aria-hidden="true" />
										See the diff
									</a>
								{/if}

								{#if !rollout?.status?.source}
									<!-- ⭐ ROUND 5 (AD round 3, item 3: "Every 'unavailable' line
									     becomes one quiet t-meta line"). Was `t-body` (16px/full
									     strength), the same weight as a real fact; this and the
									     sibling branch below are both an ABSENCE, same register
									     as the "GitHub did not answer" branches further down. -->
									<p class="t-meta text-fg-subtle">
										No source repository linked — the commit list is unavailable.
									</p>
								{:else if !selectedRevision}
									<p class="t-meta text-fg-subtle">
										No commit revision known for this build — the commit list is unavailable.
									</p>
								{:else if commitsQuery.isLoading}
									<!-- ⭐ THE COMMITS REGION RESERVES ITS GEOMETRY NOW, NOT A
									     BARE SENTENCE. (2026-09-04, load-state audit finding
									     12) `Loading commits…` was literal prose with nothing
									     reserved under it — the flip to the real list (or the
									     "GitHub is not connected" branch) moved the deploy
									     footer below it by however tall that content turned
									     out to be. Which shape to reserve is decided from the
									     status this dialog ALREADY HAS: `githubStatusQuery`
									     answers, in practice, before the fixed-sha commits
									     fetch does, so when it already says GitHub is not
									     connected, this is heading for that branch's two-line
									     sentence, not a list. -->
									{#if githubStatusQuery.data && !githubStatusQuery.data.connected}
										<!-- ⭐ THE MESSAGE, AND — WHEN IT WILL DRAW ONE —
										     THE BUTTON UNDER IT. (2026-09-04, live-verified
										     with `dlg3.mjs`: reserving the message alone
										     still moved the deploy footer 48px once
										     `Connect GitHub` popped in below it.) The
										     `not_connected` branch's own `configured` /
										     `isMobileConnectContext()` checks below are
										     read here too — `githubStatusQuery` already
										     answers both, so whether a button renders is
										     knowable before `commitsQuery` even settles,
										     same as the message shape itself. -->
										<div class="flex flex-col items-start gap-2" aria-hidden="true">
											<SkeletonBar width="w-full" height="h-[40px]" />
											{#if githubStatusQuery.data.configured && !isMobileConnectContext()}
												<SkeletonBar width="w-32" height="h-[34px]" />
											{/if}
										</div>
									{:else}
										<!-- Two rows shaped exactly like the real `<li>` below —
										     same dot, same two text lines — so the per-row height
										     cannot move when real commits replace them. The ROW
										     COUNT is the one thing that cannot be reserved: how
										     many commits sit in this range is genuinely unknown
										     until GitHub answers. -->
										<ul class="space-y-3" aria-hidden="true">
											{#each Array.from({ length: 2 }) as _, i (i)}
												<li class="flex gap-2">
													<span class="bg-line mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"></span>
													<div class="min-w-0 flex-1">
														<SkeletonBar width="w-3/4" height="h-3.5" />
														<div class="mt-0.5">
															<SkeletonBar width="w-32" height="h-3" />
														</div>
													</div>
												</li>
											{/each}
										</ul>
									{/if}
								{:else if commitsError === 'not_connected'}
									<!-- ⛔ NEVER OFFER THE BUTTON UNTIL WE KNOW IT WORKS, AND NEVER
									     NAVIGATE AWAY FROM AN OPEN DIALOG. (operator walk,
									     2026-09-03) See `githubStatusQuery`'s own note above: this
									     branch used to offer `Connect GitHub` unconditionally, which
									     404/503'd for a server with no GitHub App at all, via a
									     full-page nav that destroyed this dialog. Now it says the
									     honest thing while `githubStatusQuery` is still loading (no
									     button, so nothing destructive can happen), then either names
									     the missing server-side setup or offers the button — opened
									     in a new tab, never `window.location.href`. -->
									<div class="flex flex-col items-start gap-2">
										{#if githubStatusQuery.data && !githubStatusQuery.data.configured}
											<p class="t-body text-fg-subtle">
												{githubAbsenceSentence(githubStatusQuery.data)}
											</p>
										{:else}
											<p class="t-body text-fg-subtle">
												<!-- ⭐ THE SENTENCE IS `githubAbsenceSentence`'s NOW, NOT A
												     PRIVATE SPELLING. (F10, design pass 2 re-check) See its
												     own note on `/versions/<rev>`: "GitHub is not connected"
												     is one canonical fact, worded once, and every surface
												     that can hit it says it the same way. Prefixed only once
												     `githubStatusQuery` has actually answered `configured` —
												     while it is still loading, the bare CTA below is honest
												     on its own and there is no fact yet to prefix. -->
												{#if githubStatusQuery.data?.configured}{githubAbsenceSentence(
														githubStatusQuery.data
													)}{' '}{/if}Connect your GitHub account to see which commits will {direction ===
												'rollback'
													? 'be reverted'
													: 'deploy'}.
											</p>
											{#if githubStatusQuery.data?.configured}
												{#if isMobileConnectContext()}
													<!-- ⛔ NEVER NAVIGATE AWAY FROM AN ARMED DIALOG. On a phone the
													     connect flow is a same-tab redirect (see `connectGithubInNewTab`),
													     and an operator walk lost a typed production rollback to it.
													     The navbar's own Connect GitHub is the way in from here. -->
													<p class="t-meta text-fg-subtle">
														Connect with the GitHub icon in the top bar first, then reopen this dialog.
													</p>
												{:else}
													<ConnectGithubAction onclick={() => connectGithubInNewTab()} />
												{/if}
											{/if}
										{/if}
									</div>
								{:else if commitsError === 'no_access'}
									<!-- Same round-3 simplification as the `isError` branch
									     below: one quiet `t-meta` line, no "you can still
									     proceed" tail. -->
									<p class="t-meta text-fg-subtle">
										You don't have access to this repository on GitHub.
									</p>
								{:else if commitsQuery.isError}
									<!-- ⛔ ONE SENTENCE FOR "UNREACHABLE", IN EVERY DIALOG —
									     AND ONE DIAGNOSIS PER FAILURE, NOT A HARD-CODED ONE.
									     (P14, 2026-09-03, operator walk) This branch used to say
									     `githubAbsenceSentence(undefined, { unreachable: true })`
									     UNCONDITIONALLY — "GitHub did not answer" — whatever the
									     commits endpoint actually returned. A live walk found the
									     SAME 401, on the SAME cluster config, printing that
									     sentence in the force-deploy dialog while the rollback
									     dialog (which reaches the `not_connected` branch above
									     for the identical cause) correctly said "GitHub is not
									     configured for this dashboard." One fact, two diagnoses,
									     because this branch asked the COMMITS query what went
									     wrong instead of asking the STATUS query what is actually
									     true — and the commits endpoint's error body does not
									     always carry the `github_not_connected` marker
									     `fetchCommitRange` classifies on, even when the STATUS
									     query already knows GitHub is not configured or not
									     connected. `githubStatusQuery` is authoritative here
									     exactly as it is in the branch above; only when IT also
									     has nothing to say (still loading, or it reports GitHub
									     genuinely connected) does "did not answer" remain the
									     honest read of a commits-fetch failure. -->
									<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 3
									     — AD item 9: "'GitHub did not answer. You can still
									     proceed.' is 14px t-body: make it one quiet t-meta
									     line, drop 'You can still proceed'."). The deploy
									     footer already proceeds once every blocking condition
									     clears — a missing commit list has never itself
									     disabled Deploy — so the tail clause restated a given,
									     not a fact. -->
									<p class="t-meta text-fg-subtle">
										{githubStatusQuery.data && !githubStatusQuery.data.connected
											? githubAbsenceSentence(githubStatusQuery.data)
											: githubAbsenceSentence(undefined, { unreachable: true })}
									</p>
									<FactList
										facts={[
											{
												label: 'Server said',
												value:
													commitsQuery.error instanceof Error
														? commitsQuery.error.message
														: 'unknown error'
											}
										]}
										tone="card"
										class="mt-2"
									/>
								{:else if commitsQuery.isSuccess && commitsQuery.data.commits.length > 0}
									<!-- ⭐ round 6 (AD round 4 items 4, 9, 10; round 5 item 2):
									     neutral bullets (a commit is not a state), titles 12/500,
									     the first 3 plus "Show all N" at every width — no inner
									     scroller. -->
									<ul
										class="flex flex-col gap-3"
										aria-label={direction === 'rollback'
											? 'Commits to revert'
											: 'Commits to deploy'}
									>
										{#each commitsSorted as commit, i (commit.sha)}
											<li class="flex gap-2 {i >= COMMITS_FOLD && !showAllCommits ? 'hidden' : ''}">
												<span class="bg-line-strong mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
												></span>
												<div class="min-w-0 flex-1">
													<a
														href={commit.url}
														target="_blank"
														rel="noopener noreferrer"
														class="t-ui-sm text-fg hover:text-accent-text block truncate"
													>
														{formatCommitMessage(commit.message)}
													</a>
													<div class="dot-list">
														<div
															class="dot-list-row t-meta text-fg-subtle flex flex-wrap items-center"
														>
															<span class="whitespace-nowrap">{commit.author || 'unknown'}</span>
															<code class="t-code-sm whitespace-nowrap"
																>{commit.sha.slice(0, 7)}</code
															>
															{#if commit.commitDate}
																<span
																	class="whitespace-nowrap"
																	title={formatTimestamp(commit.commitDate)}
																>
																	committed {formatTimeAgo(commit.commitDate)}
																</span>
															{/if}
														</div>
													</div>
												</div>
											</li>
										{/each}
									</ul>
									{#if commitsQuery.data.commits.length > COMMITS_FOLD && !showAllCommits}
										<button
											type="button"
											class="btn btn-secondary btn-xs mt-3"
											onclick={() => (showAllCommits = true)}
										>
											Show {commitsQuery.data.commits.length - COMMITS_FOLD} more
										</button>
									{/if}
								{:else if commitsQuery.isSuccess}
									<!-- ⭐ "SAME COMMIT" IS NOT "NOTHING CHANGED". (operator walk,
									     2026-09-03) Two releases can share a git revision — a
									     re-published artifact — while asking something different of
									     the fleet: `rel-67` moved `requires.api` from `^1.66.0` to
									     `^1.67.0` on the exact commit `rel-66` shipped.
									     `requirementsChangedSentence` reads the two releases'
									     `VersionInfo.requires`, already on `availableReleases`, and
									     says so; `null` falls back to the plain sentence, which is
									     now provably true (`commitsQuery.isSuccess` — GitHub actually
									     answered zero commits, this branch is not also catching the
									     unreachable case). -->
									<p class="t-body text-fg-subtle">
										{requirementsChangedSentence(
											currentDisplayVersion,
											currentRelease,
											selectedRelease
										) ?? 'No commit changes detected between versions.'}
									</p>
								{:else}
									<!-- The query never ran or never resolved (e.g. `canFetchCommits`
									     was false for a reason none of the branches above name) — the
									     SAME diagnosis as the `isError` branch just above (status
									     query first, "did not answer" only once it has nothing to
									     say), never the "no changes" one. Absence is a claim; this
									     is not one.
									     ⛔ SUPERSEDED, 2026-10-10 (squad-rollout, Lane D, round 5 —
									     AD round 3, item 3: "Every 'unavailable' line becomes one
									     t-meta line ('GitHub did not answer').") This was the one
									     branch round 3's own fix (above, same item in an earlier
									     round) missed — still 14px `t-body` with the "You can
									     still proceed" tail the deploy footer already makes true
									     by never disabling on a missing commit list. -->
									<p class="t-meta text-fg-subtle">
										{githubStatusQuery.data && !githubStatusQuery.data.connected
											? githubAbsenceSentence(githubStatusQuery.data)
											: githubAbsenceSentence(undefined, { unreachable: true })}
									</p>
								{/if}
							</div>
						{/if}

						<div bind:this={rightFooterEl} class="flex flex-col gap-3">
							{#if rollout && !hasForceDeployAnnotation(rollout) && !mustPin}
								<div class="flex items-center justify-between gap-3">
									<div class="min-w-0">
										<div class="t-card-title text-fg">Pin build</div>
										<p class="t-meta text-fg-subtle">Keep this build until the pin is cleared</p>
									</div>
									<!-- `me-0`: flowbite's track carries `me-3` for an
									     off-state label we never render; without it the track
									     ended 12px short of the fields' right edge. -->
									<Toggle
										bind:checked={pinVersionToggle}
										aria-label="Pin build"
										disabled={isPinVersionToggleDisabled}
										color="gray"
										classes={{
											span: 'me-0 peer-checked:!bg-inverse'
										}}
									/>
								</div>
							{/if}

							<div class="flex flex-col gap-2">
								<textarea
									bind:value={deployExplanation}
									placeholder={deployNotePlaceholder}
									aria-label={deployNotePlaceholder}
									aria-required={deployNoteRequired}
									aria-describedby="cvm-note-help"
									rows="3"
									class="input cvm-note cvm-ios-16 t-body h-auto resize-none py-3"
								></textarea>
								<p id="cvm-note-help" class="t-meta text-fg-subtle">{noteHelper}</p>
							</div>

							{#if needsTypedConfirmation}
								<div class="flex flex-col gap-2">
									<label for="cvm-confirm-version" class="t-meta text-fg-subtle block">
										Type
										<code
											class="t-code-sm bg-subtle text-fg rounded-xs px-1 py-0.5 whitespace-nowrap"
											>{getDisplaySelectedVersion()}</code
										> to confirm
									</label>
									<input
										id="cvm-confirm-version"
										type="text"
										bind:value={deployConfirmationVersion}
										class="input cvm-ios-16"
									/>
								</div>
							{/if}
						</div>
						{#if bodyMore}
							<!-- The "more below" fade: a sticky gradient element at the
							     scroller's bottom edge (never a CSS mask — see
							     `bodyMore`). `-mt-10 h-6`: the flex gap (16) + height (24)
							     are cancelled, so it takes no layout space. Desktop only:
							     below `sm` the footer's top rule is the edge. -->
							<div
								class="to-overlay pointer-events-none sticky bottom-0 -mt-10 h-6 shrink-0 bg-linear-to-b from-transparent max-sm:hidden"
								aria-hidden="true"
							></div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- ⭐ ROUND 3 (coordinator, whole-product consistency): ONE SHARED
		     FOOTER, ALWAYS RENDERED. This dialog used to have THREE footer
		     grammars depending on step: a header "Cancel" with no footer at
		     all before a build was picked, and a button row scoped to the
		     RIGHT PANE (so a rollback's Cancel/confirm pair spanned only the
		     ~600px preview column, not the dialog) once one was. Every other
		     dialog in this lane (Recovery, Retry×2, Clear pin) has exactly
		     one footer — `border-t border-line px-4 py-3` (round 3: one
		     16px inset everywhere, AD item 6), right-aligned
		     `btn-sm`s, full dialog width — and this is that same footer now.
		     `Cancel` is always here; the confirm action joins it once a build
		     is picked. The two-pane picker/preview grid stays entirely in the
		     BODY above, unchanged — only the ACTIONS moved.

		     Width family, documented (the coordinator asked for this in
		     writing): `max-w-lg` (512px) is this lane's shared "simple
		     confirm" width — the SAME value `RetryConfirmModal`/`RetryTestsModal`
		     use at `size="sm"`. This dialog only grows to `max-w-4xl` (896px)
		     for the span that genuinely needs two columns at once — the
		     picker list beside the changelist/consequence preview, once a
		     build is picked — and returns to the shared 512px the moment
		     there is only a list to show. No dialog in this lane is ever
		     wider than 896px, and none has a THIRD width.

		     ⭐ ALWAYS AT THE TRUE BOTTOM NOW. (round 4, coordinator QA on
		     shots-r3) `classes={{ body: 'max-sm:h-full' }}` above gives the
		     mobile sheet's own flex chain real height to work with, closing
		     the ~170px dead band this file's own `max-sm:h-dvh` otherwise left
		     BELOW the footer (measured live: footer used to end at 674px
		     inside an 844px sheet). The grid above keeps its existing `flex-1`
		     (load-bearing for a long release list — see that div's own F6
		     comment) and grows into the newly-available space, so a SHORT
		     list's blank space moves to where it belongs — inside the
		     scrollable content area, above this footer — while this footer
		     (and the blocker paragraph after it) land flush against the
		     sheet's actual bottom edge, not a phantom one 170px short of it. -->
		<div
			class="border-line flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 max-sm:min-h-11 max-sm:pb-[calc(12px+env(safe-area-inset-bottom))]"
		>
			<!-- ⭐ KBD HINTS, LEFT. (squad-rollout, Lane D, §4: "left `t-meta`
			     kbd hints (\"Esc\" \"⌘↵ to deploy\")".) Hidden on a phone sheet
			     (no physical keyboard, no room beside the full-width Cancel/
			     confirm pair) the same way the rest of the lane hides its
			     keyboard affordances below `sm`. -->
			<div class="t-meta text-fg-subtle hidden items-center gap-2 sm:flex">
				<span class="kbd">Esc</span>
				{#if selectedVersion}
					<span class="kbd">{modEnterHint(platform)}</span>
					<span>to {direction === 'rollback' ? 'roll back' : 'deploy'}</span>
				{/if}
			</div>
			<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 3 — AD
			     item 8: "Cancel + primary left-aligned with ~170px ragged
			     right (confirm). Target: full-width split footer buttons."
			     and "a lone Cancel bottom-left (picker)".) Below `sm`, this
			     group fills the row and each button takes an equal half —
			     the kbd hints already hide there (no competing content), so
			     there is nothing else the row needs to leave room for. -->
			<div class="flex items-center gap-2 max-sm:w-full">
				<button
					type="button"
					class="btn btn-sm btn-secondary max-sm:min-h-11 max-sm:flex-1 max-sm:basis-0"
					disabled={deploying}
					onclick={() => (open = false)}>Cancel</button
				>
				{#if selectedVersion}
					<!-- THE BUTTON SAYS WHERE IT LANDS. `Deploy Now` named the
				     act and hid the target; `Deploy to production` is the
				     same click and the reader can predict it.

				     ⭐ COLOUR MARKS THE DIRECTION, NOT JUST THE TIER. (P6,
				     2026-09-03, operator walk) See `confirmColor`/`confirmOutline`'s
				     own note: RED (filled at `typed`, outlined otherwise) for
				     every rollback; filled BLUE only for an ordinary forward
				     deploy.

				     ⭐ THE PENDING STATE. (B3, 2026-09-03, operator walk) See
				     `handleDeploy`'s own note: `deploying` disables the button
				     (on top of the existing typed/same guards) and swaps both
				     the icon for a spinner and the label for the
				     present-continuous form, so a reader can see the click
				     registered instead of an armed button that looks untouched
				     for 5-8s. -->
					<button
						type="button"
						class="btn btn-sm {confirmBtnClass} max-sm:min-h-11 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-0"
						disabled={confirmDisabled}
						onclick={handleDeploy}
						aria-label={deploying ? undefined : deployButtonLabel}
					>
						{#if deploying}
							<!-- ⛔ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 2):
						     `confirmBtnClass` is always `'btn-primary'` now (its own
						     doc comment, above) — the spinner is always white, same
						     as the button it sits on. -->
							<StatusSpinner size="4" color="white" class="mr-2" />
							<span class="truncate">{deployingLabel}</span>
						{:else}
							{#if direction === 'rollback'}
								<UndoOutline class="mr-2 h-4 w-4 shrink-0" />
							{:else}
								<ArrowUpOutline class="mr-2 h-4 w-4 shrink-0" />
							{/if}
							<!-- AD round 5: the phone label never cuts — the title
						     already names the environment, so the phone says the verb. -->
							<span class="truncate max-sm:hidden" aria-hidden="true">{deployButtonLabel}</span>
							<span class="truncate sm:hidden" aria-hidden="true">{deployButtonShortLabel}</span>
						{/if}
					</button>
				{/if}
			</div>
		</div>
		{#if selectedVersion && confirmBlocker}
			<!-- ⭐ SUPERSEDED, 2026-10-09 (squad-rollout, Lane D, round 3 -- AD
			     item 6: "The disabled-reason <p> always reserves 28px (dead
			     band when empty)."). min-h-[1.25rem] used to hold that band
			     open even with nothing in it, to avoid a layout shift when
			     the reason appears/disappears -- the AD measurement says the
			     empty band is the worse defect of the two. Renders only when
			     there is a reason now; aria-live="polite" still announces it
			     the instant it does. -->
			<p class="t-meta text-fg-subtle shrink-0 truncate px-4 pb-3 text-right" aria-live="polite">
				{confirmBlocker}
			</p>
		{/if}
	</div>
</Modal>

<Toast
	bind:open={showLocalToast}
	tone={localToastType === 'success' ? 'success' : 'danger'}
	message={localToastMessage}
/>

<style>
	/*
	 * ⭐ THE CSS-ONLY SCROLL SHADOW. (F6, 2026-09-03 re-check) Four background
	 * layers on the SCROLLING element itself, no JS scroll-position tracking:
	 *
	 *   layers 1-2  a flat cover matching the dialog's own background, pinned
	 *               to the CONTENT (`background-attachment: local`) at the
	 *               list's top and bottom edge.
	 *   layers 3-4  a soft radial shadow, pinned to the VIEWPORT
	 *               (`background-attachment: scroll`, i.e. fixed relative to
	 *               the element's own box, not the content inside it).
	 *
	 * At `scrollTop: 0` the top cover sits exactly over the top shadow and
	 * hides it — there is nothing above to hint at. Scroll down 1px and the
	 * cover (attached to the content) moves away while the shadow (attached
	 * to the viewport) stays put, so the cue appears exactly when there is
	 * more list behind it, and the same mechanism at the bottom edge retires
	 * itself once the list is scrolled to its end. Dark mode gets its own
	 * cover colour (`gray-800`, this dialog's own dark background) — the
	 * shadow itself is already a neutral black wash and needs no swap.
	 */
	.cvm-scroll-fade {
		background-repeat: no-repeat;
		/* round 9 (AD r8, P4): the covers are the dialog's own surface token,
		   not a hard-coded white / gray-800, so they match in both themes. */
		background-image:
			linear-gradient(
				to bottom,
				var(--k-overlay) 40%,
				color-mix(in oklab, var(--k-overlay) 0%, transparent)
			),
			linear-gradient(
				to top,
				var(--k-overlay) 40%,
				color-mix(in oklab, var(--k-overlay) 0%, transparent)
			),
			radial-gradient(farthest-side at 50% 0%, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0)),
			radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0));
		background-position: top, bottom, top, bottom;
		background-size:
			100% 24px,
			100% 24px,
			100% 10px,
			100% 10px;
		background-attachment: local, local, scroll, scroll;
	}

	/* round 8 (AD r7 item 3): the note is 14px from `sm` up, like every other
	   body field; app.css's unlayered iOS rule (`font-size: max(16px, 1em)`
	   on every textarea) keeps 16px below `sm`, where it prevents the zoom.
	   Unlayered here too, one class more specific. */
	/* ⭐ round 9 (AD r8, P1): below `sm` every field in this dialog computes
	   16px, or iOS Safari zooms on focus. `.t-body` (unlayered, one class)
	   beat app.css's element-only `input, textarea { font-size: max(16px,
	   1em) }`; this scoped rule is two classes, so it beats `.t-body`. */
	@media (max-width: 639px) {
		.cvm-ios-16 {
			font-size: 16px;
			line-height: 24px;
		}
	}

	@media (min-width: 640px) {
		input.input.cvm-ios-16 {
			font-size: 14px;
			line-height: 20px;
		}
		textarea.cvm-note {
			font-size: 14px;
			line-height: 20px;
		}
	}

	:global(.dark) .cvm-scroll-fade {
		background-image:
			linear-gradient(
				to bottom,
				var(--k-overlay) 40%,
				color-mix(in oklab, var(--k-overlay) 0%, transparent)
			),
			linear-gradient(
				to top,
				var(--k-overlay) 40%,
				color-mix(in oklab, var(--k-overlay) 0%, transparent)
			),
			radial-gradient(farthest-side at 50% 0%, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0)),
			radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0));
	}
</style>
