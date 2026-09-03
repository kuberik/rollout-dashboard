<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout, Environment, RolloutDependency } from '../../types';
	import { Modal, Alert, Badge, Button, Toggle, Toast } from 'flowbite-svelte';
	import {
		ExclamationCircleSolid,
		CodeOutline,
		ArrowUpOutline,
		ReplyOutline,
		CodePullRequestSolid,
		GithubSolid,
		PauseSolid,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';
	import { createQuery } from '@tanstack/svelte-query';
	import { hasForceDeployAnnotation, getDisplayVersion, formatTimeAgo } from '$lib/utils';
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
		releaseIndex,
		rolloutEnvironmentName,
		splitLeadSentence,
		targetPhrase,
		typedPrompt
	} from '$lib/view-models/deploy-risk';
	import { promotionBlock, gateAllows, isDeployable } from '$lib/view-models/promotion';
	import Chip from '$lib/components/Chip.svelte';
	import { requirementsChangedSentence } from '$lib/view-models/release-delta';
	import {
		commitsQueryOptions,
		formatCommitMessage,
		connectGithubInNewTab, isMobileConnectContext,
		fetchGithubStatus,
		githubAbsenceSentence,
		githubStatusQueryKey,
		FetchCommitsError,
		type CommitsError
	} from '$lib/api/github';
	import { modalFocusReturn } from '$lib/a11y.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import FactList, { type Fact } from './FactList.svelte';
	import StatusSpinner from './StatusSpinner.svelte';

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
		onSuccess = () => {},
		onError = () => {},
		onDeployStart = () => {}
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

	function apiUrl(path: string): string {
		if (!cluster) return path;
		const sep = path.includes('?') ? '&' : '?';
		return `${path}${sep}cluster=${encodeURIComponent(cluster)}`;
	}

	// --- Picker state ---------------------------------------------------
	let selectedVersion = $state<string | null>(null);
	let searchQuery = $state('');
	let showAllTags = $state(false);
	let allRepositoryTags = $state<string[]>([]);
	let loadingAllTags = $state(false);
	let annotations = $state<Record<string, Record<string, string>>>({});
	let loadingAnnotations = $state<Record<string, boolean>>({});

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
				const available = leftPaneEl?.getBoundingClientRect().height ?? 0;
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

	async function loadOverrideContext(namespace: string) {
		try {
			const response = await fetch(
				apiUrl(`/api/rollouts?namespace=${encodeURIComponent(namespace)}`)
			);
			if (!response.ok) return;
			const data = await response.json();
			overrideEnvironments = data?.environments?.items ?? [];
			overrideDependencies = data?.rolloutDependencies?.items ?? [];
		} catch {
			// Best-effort: the notice sentence above the list already states the
			// consequence on its own, so a failed join just leaves the list empty
			// rather than blocking the dialog.
		}
	}

	// --- Deploy footer state ---------------------------------------------
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
		}
	});

	const availableReleases = $derived(rollout?.status?.availableReleases ?? []);
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
	const envLabel = $derived(rolloutEnvironmentName(rollout, environmentName).toUpperCase());
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
	const clusterLabel = $derived(
		cluster && cluster.toLowerCase() !== envLabel.toLowerCase() ? cluster : null
	);
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
	 * `N back` / `N newer`, relative to the version RUNNING NOW — this
	 * rollout's own oldest-first `availableReleases`, the same list the
	 * delta summary and `env-rank.ts`'s `N behind` both count from. `null`
	 * for the current row itself (already the green `Current` badge) and for
	 * anything not in this rollout's own list (a "show all repo tags" extra,
	 * or a version this rollout has aged out of tracking) — a rank next to a
	 * build this list cannot place would be inventing a distance.
	 */
	function pickerRankLabel(versionTag: string): string | null {
		if (!rollout || !currentTag || versionTag === currentTag) return null;
		const curIdx = releaseIndex(rollout, currentTag);
		const idx = releaseIndex(rollout, versionTag);
		if (curIdx === -1 || idx === -1) return null;
		const diff = idx - curIdx;
		return diff > 0 ? `${diff} newer` : `${-diff} back`;
	}

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

	async function getAnnotations(version: string) {
		if (!rollout) return;
		loadingAnnotations[version] = true;
		loadingAnnotations = { ...loadingAnnotations };
		try {
			const response = await fetch(
				apiUrl(
					`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/annotations/${version}`
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
		const isKnownRelease = availableReleases.some((entry) => entry.tag === versionTag);
		if (!isKnownRelease && !annotations[versionTag]) {
			await getAnnotations(versionTag);
		}
	}

	async function getAllRepositoryTags() {
		if (!rollout) return;
		loadingAllTags = true;
		try {
			const response = await fetch(
				apiUrl(`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/tags`)
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
		const standardReleases = [...availableReleases].reverse();
		if (!showAllTags) return standardReleases;
		const additionalTags = allRepositoryTags.filter(
			(tag) => !availableReleases.some((ar) => ar.tag === tag)
		);
		return [...standardReleases, ...additionalTags];
	});

	const filteredVersionsForDisplay = $derived(
		allVersionsForDisplay.filter((version) => {
			const versionTag = typeof version === 'string' ? version : version.tag;
			return searchQuery === '' || versionTag.toLowerCase().includes(searchQuery.toLowerCase());
		})
	);

	function selectVersion(versionTag: string) {
		selectedVersion = versionTag;
	}

	// --- Direction + changelist -------------------------------------------
	const selectedRelease = $derived(
		availableReleases.find((r) => r.tag === selectedVersion) ?? null
	);
	// The currently-deployed release's own `VersionInfo` — the OTHER half
	// `requirementsChangedSentence` needs. Separate from `currentTag` (a bare
	// string): this is the object `releaseRequires` reads `requires` off.
	const currentRelease = $derived(availableReleases.find((r) => r.tag === currentTag) ?? null);
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
	const commitsError = $derived<CommitsError | null>(
		commitsQuery.error instanceof FetchCommitsError ? commitsQuery.error.reason : null
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

	const supportsManifestDiff = $derived(
		rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'
	);

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
	// Every version change is confirmed by typing it — see `typedPrompt`.
	const needsTypedConfirmation = $derived(direction !== 'same');
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
	const deployNotice = $derived(
		selectedVersion ? confirmNotice(intent, pinVersionToggle, deployStepsBack) : null
	);
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
	const deployButtonLabel = $derived(
		isSameVersionPin
			? `Pin ${targetPhrase(intent)} to ${getDisplaySelectedVersion()}`
			: deployActionLabel(intent)
	);
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
	 * ⭐ THE CONFIRM IS NEVER THE SAME BLUE AS AN ORDINARY FORWARD DEPLOY. (P6,
	 * 2026-09-03, operator walk) `Roll back dev` rendered in the identical
	 * filled blue `.btn-primary`, in the identical slot, as `Deploy to dev` —
	 * a reader scanning the footer by colour alone could not tell a
	 * destructive reversal from an ordinary forward move. Production's
	 * `typed` rollback already reads filled red (unchanged, `confirmColor`
	 * below still returns `'red'` there); a non-production rollback (the
	 * `notice` level) gets the SAME hue at a lower step — text-and-outline
	 * red rather than a filled block — so it reads as "this direction is
	 * destructive" without competing with `typed`'s louder, filled alarm.
	 * Forward deploys are untouched: still filled blue.
	 */
	const confirmColor = $derived(direction === 'rollback' ? 'red' : level === 'typed' ? 'red' : 'blue');
	const confirmOutline = $derived(direction === 'rollback' && level !== 'typed');
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
	const deployNoteRequired = $derived(intent.production || direction === 'rollback');
	// The suffix states the rule, not a hope: the note IS required for a
	// rollback and for production (`deployNoteRequired`), and the button
	// stays dead until it is written. "(recommended)" was a lie of omission.
	const deployNotePlaceholder = $derived.by(() => {
		const q =
			direction === 'rollback'
				? 'Why are you rolling back?'
				: level === 'typed'
					? 'Why are you overriding the rules?'
					: 'Why are you deploying this version?';
		return `${q} ${deployNoteRequired ? '(required)' : '(optional)'}`;
	});
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

	// --- The rules a `typed` force-deploy overrides, named -----------------
	// Every gate in `rollout.status.gates` that does not currently allow the
	// SELECTED tag — the exact set the primary button is about to override.
	const overriddenGates = $derived.by(() => {
		if (!rollout || !selectedVersion) return [];
		return (rollout.status?.gates ?? []).filter((g) => !gateAllows(g, selectedVersion as string));
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
			const upstream = env.spec?.relationship?.environment;
			return {
				label: upstream ? `after ${upstream}` : 'after its upstream environment',
				value: upstream
					? `${upstream} has not taken this build`
					: 'its upstream environment has not taken this build'
			};
		}
		return { label: gateName, value: 'currently does not allow this build' };
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
				apiUrl(
					`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/change-version`
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
						"Cannot pin version: Dashboard is not managing this rollout's wantedVersion field. This field may be managed by another controller or external system."
					);
				}
				throw new Error('Failed to change version');
			}
			notifySuccess(
				pinVersionToggle
					? 'Successfully pinned and deployed version'
					: 'Force deploy initiated, version rolling out soon'
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
<Modal
	bind:open
	title=""
	size="none"
	role="dialog"
	aria-modal="true"
	dismissable={false}
	class="[&>div]:p-0 {selectedVersion
		? 'max-w-4xl'
		: 'max-w-lg'} max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
	aria-labelledby="cvm-title"
>
	<div class="flex max-h-[85vh] flex-col max-sm:h-full max-sm:max-h-none">
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
		<div
			class="flex min-h-[47px] shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
		>
			<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<CodeOutline class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
				<h2 id="cvm-title" class="text-sm font-semibold text-gray-900 dark:text-white">
					Change Version
				</h2>
				{#if rollout?.metadata?.name}
					<span class="text-gray-500 dark:text-gray-400" aria-hidden="true">/</span>
					<code class="min-w-0 text-sm break-words text-gray-500 dark:text-gray-400"
						>{rollout.metadata.name}</code
					>
				{/if}
				{#if envLabel}
					<span class="text-gray-500 dark:text-gray-400" aria-hidden="true">·</span>
					<span
						class="shrink-0 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400"
					>
						{envLabel}{clusterLabel ? ` · ${clusterLabel}` : ''}
					</span>
				{/if}
			</div>
			{#if selectedVersion}
				<button
					type="button"
					class="hit-32 flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-white px-3 py-[1px] text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 md:hidden dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
					onclick={() => (selectedVersion = null)}
				>
					&larr; Back
				</button>
			{:else}
				<button
					type="button"
					class="hit-32 flex shrink-0 items-center rounded border border-gray-200 bg-white px-3 py-[1px] text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
					disabled={deploying}
					onclick={() => (open = false)}
				>
					Cancel
				</button>
			{/if}
		</div>

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
		<div class="grid flex-1 overflow-hidden {selectedVersion ? 'md:grid-cols-[300px_1fr]' : ''}">
			<!-- LEFT: version picker. Full width, on its own, until a version is
			     picked; a narrow bordered column beside the preview once one is. -->
			<div
				bind:this={leftPaneEl}
				style={leftPaneMaxHeight != null ? `max-height: ${leftPaneMaxHeight}px` : ''}
				class="flex-col overflow-hidden border-gray-200 dark:border-gray-700 {selectedVersion
					? 'hidden md:flex md:border-r'
					: 'flex'}"
			>
				<div bind:this={leftHeaderEl} class="shrink-0 space-y-3 p-4">
					<input
						type="text"
						placeholder="Search versions..."
						bind:value={searchQuery}
						class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
					/>
					<div class="flex items-center justify-between">
						<!-- The `span` was decoration: measured, the checkbox behind this
						     Toggle was the first tab stop in the dialog and had NO name. -->
						<span id="cvm-showall-label" class="text-xs text-gray-500 dark:text-gray-400"
							>Show all repo tags</span
						>
						<!-- ⛔ NOT BLUE. (operator walk, 2026-09-03) `src/lib/CLAUDE.md`'s
						     rule: a selected toggle is gray-900/gray-100, always — blue
						     is `Deploying`'s colour and this switch deploys nothing.
						     `color="gray"` only neutralises the focus ring
						     (flowbite's `gray` variant checks in at `gray-500`, not
						     `gray-900`); the checked fill is overridden to match every
						     other toggle in the product (`LogsViewer`'s `Follow`/`Wrap`,
						     the History tab's `Compare namespace`/`Show environments`).

						     ⛔ ONE SWITCH SIZE. (F10, design pass 2 re-check) This was
						     `size="small"` (36×20) while `Pin Version` below — the
						     dialog's other, more consequential toggle — is the
						     default 44×24. Two sizes for the same control in one
						     dialog reads as two different KINDS of control; there is
						     no reading of "show all repo tags" that is less important
						     than "pin this deploy" to justify it being smaller. Sized
						     to match. -->
						<Toggle
							bind:checked={showAllTags}
							color="gray"
							classes={{ span: 'peer-checked:!bg-gray-900 dark:peer-checked:!bg-gray-100' }}
							aria-labelledby="cvm-showall-label"
							onchange={() => {
								if (showAllTags && allRepositoryTags.length === 0) getAllRepositoryTags();
							}}
						/>
					</div>
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
						{#each filteredVersionsForDisplay as version (typeof version === 'string' ? version : version.tag)}
							{@const versionTag = typeof version === 'string' ? version : version.tag}
							{@const availableRelease = availableReleases.find((ar) => ar.tag === versionTag)}
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
							{@const isHeld =
								!isCurrent && rank?.endsWith('newer') === true && !isDeployable(rollout, versionTag)}
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
							<button
								type="button"
								aria-pressed={isSelected}
								class="flex w-full items-start gap-2 border-b border-gray-100 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 {isSelected
									? 'bg-blue-50 dark:bg-blue-900/30'
									: ''}"
								onclick={() => selectVersion(versionTag)}
							>
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="text-sm font-medium text-gray-900 dark:text-white"
											>{displayVersion}</span
										>
										{#if isCurrent}
											<Chip role="count" label="current" />
										{/if}
										{#if isPinned}
											<Chip role="count" label="pinned" />
										{/if}
										<!-- ⭐ THE PICKER SAYS `held` WHERE THE PAGE BEHIND IT DOES.
										     (operator walk, 2026-09-03) A newer build the rules do
										     not allow yet showed here as `2.67.0-67 · 1 newer` and
										     nothing else — on the one screen where overriding those
										     rules is one tap away. Same chip as rollout detail's
										     upgrade list; the confirm step still spells the rules out. -->
										{#if isHeld}
											<Chip role="held" label="held" />
										{/if}
									</div>
									{#if pickerLine || rank}
										<!-- ⛔ `created` IS THE IMAGE'S BUILD TIME, NOT WHEN THIS
										     ROLLOUT RAN IT. Said explicitly ("Built") because the
										     status card behind this dialog shows DEPLOY age for the
										     same current build, and the two clocks can disagree by
										     weeks — a build sitting untouched for a month before its
										     first deploy is not exotic. The current row also carries
										     the deploy age, the one other surfaces already show.
										     ⭐ AND THE RANK, NOT JUST THE DATE. Ten rows of `<sha> /
										     N days ago` give no sense of how far back a pick goes —
										     the exact case "relative beats absolute" was written
										     for. `current` is already the green badge above; every
										     other row says its distance from it in release-list
										     steps, `env-rank.ts`'s own vocabulary (`N behind` /
										     `newest`) narrowed to a per-row `N back` / `N newer`.
										     ⭐ AND `back` IS THE DESTRUCTIVE DIRECTION, IN WARM INK.
										     (P6, 2026-09-03, operator walk) `N back` and `N newer`
										     read in the identical neutral gray — the one number that
										     says "picking this row is a rollback" carried no more
										     weight than the one that says "this is further ahead".
										     Amber is this file's own rollback ink everywhere else
										     (the delta summary's `ReplyOutline` + "Rollback" label),
										     reused here rather than inventing a second warning hue. -->
										<div class="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
											{#if pickerLine}<span>{pickerLine}</span>{/if}
											{#if pickerLine && rank}<span aria-hidden="true">·</span>{/if}
											{#if rank}
												<span
													class={isBackRank
														? 'font-medium text-amber-700 dark:text-amber-400'
														: ''}>{rank}</span
												>
											{/if}
										</div>
									{/if}
								</div>
								<ChevronRightOutline
									class="mt-0.5 h-4 w-4 shrink-0 self-center text-gray-300 dark:text-gray-600"
									aria-hidden="true"
								/>
							</button>
						{/each}
					{:else}
						<div class="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
							No versions available
						</div>
					{/if}
				</div>
			</div>

			{#if selectedVersion}
				<!-- RIGHT: changelist + deploy. Renders only once a version is
				     picked — the placeholder pane ("Select a version to preview
				     what will change") is gone with it; before a pick this is the
				     whole dialog, so there is nothing beside the list for a
				     placeholder to fill.

				     ⭐ `style="max-height"` MIRRORS `leftPaneEl`'S OWN. (F6,
				     2026-09-03 re-check) See `rightPaneMaxHeight`'s own doc
				     comment: when this pane's content (the delta summary plus a
				     short "not configured"/"no changes" sentence) is shorter than
				     the LEFT list's own rendered height, grid `stretch` was
				     inflating this box to match it anyway — 279px of blank space
				     under one sentence. Explicit `max-height`, exactly like
				     `leftPaneEl`'s, clamps the stretch instead of fighting it. -->
				<div
					bind:this={rightPaneEl}
					style={rightPaneMaxHeight != null ? `max-height: ${rightPaneMaxHeight}px` : ''}
					class="flex flex-col overflow-hidden"
				>
					<div bind:this={rightContentEl} class="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
						<!-- Delta summary -->
						<div
							class="flex flex-col gap-2 rounded-lg p-3 {direction === 'rollback'
								? 'bg-amber-50 dark:bg-amber-900/20'
								: direction === 'forward'
									? 'bg-green-50 dark:bg-green-900/20'
									: 'bg-gray-50 dark:bg-gray-800'}"
						>
							<div class="flex items-center gap-2 text-sm font-medium">
								{#if direction === 'rollback'}
									<ReplyOutline class="h-4 w-4 text-amber-600 dark:text-amber-400" />
									<span class="text-amber-700 dark:text-amber-400">
										Rollback{#if commitsQuery.data}&nbsp;— reverts {commitsQuery.data.commits
												.length} commit{commitsQuery.data.commits.length !== 1 ? 's' : ''}{/if}
									</span>
								{:else if direction === 'forward'}
									<ArrowUpOutline class="h-4 w-4 text-green-700 dark:text-green-400" />
									<span class="text-green-700 dark:text-green-400">
										Deploy{#if commitsQuery.data}&nbsp;— ships {commitsQuery.data.commits.length} commit{commitsQuery
												.data.commits.length !== 1
												? 's'
												: ''}{/if}
									</span>
								{:else}
									<span class="text-gray-500 dark:text-gray-400">Already deployed</span>
								{/if}
							</div>
							{#if currentTag}
								<div
									class="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-gray-500 dark:text-gray-400"
								>
									<code>{currentDisplayVersion}</code>
									<span>&rarr;</span>
									<code>{getDisplaySelectedVersion()}</code>
								</div>
							{/if}
						</div>

						<!-- Changelist -->
						{#if direction !== 'same'}
							<div>
								{#if compareBase && compareHead && compareBase === compareHead}
									<!-- The one fact that decides whether a bypass is safe: two
									     releases of the same commit ship no code. (operator walk,
									     2026-09-03 — rel-66 and rel-67 share 9f10e49, and the dialog
									     only said GitHub was not connected.) -->
									<p class="mb-2 text-sm text-gray-700 dark:text-gray-200">
										Same commit as the running build (<code class="t-code-sm">{compareHead.slice(0, 7)}</code>)
										— only the release changed. No code moves.
									</p>
								{/if}
								<div class="mb-2 flex items-center justify-between">
									<!-- A section title at the card-title role, not a tracked
									     eyebrow over a prose sentence (`lib/CLAUDE.md` bans the
									     latter, and the sentence under it is prose whenever GitHub
									     is absent). -->
									<span class="text-sm font-semibold text-gray-900 dark:text-white">
										{direction === 'rollback' ? 'Commits to revert' : 'Commits to deploy'}
									</span>
									{#if supportsManifestDiff}
										<Button
											size="xs"
											color="light"
											href={`/rollouts/${cluster}/${rollout?.metadata?.namespace}/${rollout?.metadata?.name}/diff/${selectedVersion}`}
										>
											<CodePullRequestSolid class="mr-1 h-3 w-3" />
											View file diff
										</Button>
									{/if}
								</div>

								{#if !rollout?.status?.source}
									<p class="text-sm text-gray-500 dark:text-gray-400">
										No source repository linked — commit changelist unavailable.
									</p>
								{:else if !selectedRevision}
									<p class="text-sm text-gray-500 dark:text-gray-400">
										No commit revision known for this version — changelist unavailable.
									</p>
								{:else if commitsQuery.isLoading}
									<p class="text-sm text-gray-500 dark:text-gray-400">Loading commits…</p>
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
											<p class="text-sm text-gray-500 dark:text-gray-400">
												{githubAbsenceSentence(githubStatusQuery.data)}
											</p>
										{:else}
											<p class="text-sm text-gray-500 dark:text-gray-400">
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
													<p class="text-xs text-gray-500 dark:text-gray-400">
														Connect GitHub from the navbar first, then reopen this dialog.
													</p>
												{:else}
													<Button size="xs" color="light" onclick={() => connectGithubInNewTab()}>
														<GithubSolid class="mr-1.5 h-3.5 w-3.5" />
														Connect GitHub
													</Button>
												{/if}
											{/if}
										{/if}
									</div>
								{:else if commitsError === 'no_access'}
									<p class="text-sm text-gray-500 dark:text-gray-400">
										You don't have access to this repository on GitHub. You can still proceed.
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
									<p class="text-sm text-gray-500 dark:text-gray-400">
										{githubStatusQuery.data && !githubStatusQuery.data.connected
											? githubAbsenceSentence(githubStatusQuery.data)
											: githubAbsenceSentence(undefined, { unreachable: true })}
										{commitsQuery.error instanceof Error
											? commitsQuery.error.message
											: 'unknown error'}. You can still proceed.
									</p>
								{:else if commitsQuery.isSuccess && commitsQuery.data.commits.length > 0}
									<ul
										class="space-y-3"
										aria-label={direction === 'rollback' ? 'Commits to revert' : 'Commits to deploy'}
									>
										{#each commitsQuery.data.commits as commit (commit.sha)}
											<li class="flex gap-2.5">
												<span
													class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full {direction === 'rollback'
														? 'bg-amber-500'
														: 'bg-green-700 dark:bg-green-400'}"
												></span>
												<div class="min-w-0 flex-1">
													<a
														href={commit.url}
														target="_blank"
														rel="noopener noreferrer"
														class="block text-sm font-medium text-gray-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
													>
														{formatCommitMessage(commit.message)}
													</a>
													<div
														class="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
													>
														<span>{commit.author || 'unknown'}</span>
														<span>·</span>
														<code>{commit.sha.slice(0, 7)}</code>
														{#if commit.commitDate}
															<span>·</span>
															<span title={new Date(commit.commitDate).toLocaleString()}>
																{formatTimeAgo(commit.commitDate)}
															</span>
														{/if}
													</div>
												</div>
											</li>
										{/each}
									</ul>
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
									<p class="text-sm text-gray-500 dark:text-gray-400">
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
									     is not one. -->
									<p class="text-sm text-gray-500 dark:text-gray-400">
										{githubStatusQuery.data && !githubStatusQuery.data.connected
											? githubAbsenceSentence(githubStatusQuery.data)
											: githubAbsenceSentence(undefined, { unreachable: true })} You can still
										proceed.
									</p>
								{/if}
							</div>
						{/if}
					</div>

					<!-- Deploy footer. `bind:this={rightFooterEl}` + `shrink-0`: this is
					     the block `rightPaneMaxHeight`'s natural-height measurement must
					     never drop (see its own doc comment) -- a sibling of the scrollable
					     `rightContentEl` above, not a descendant of it, so it is always
					     laid out at full height and never scrolled away. -->
					<div
						bind:this={rightFooterEl}
						class="shrink-0 space-y-3 border-t border-gray-200 p-4 dark:border-gray-700"
					>
						{#if !deployNotice && gateNote}
							<!-- Same `Alert color="blue"` at 12px the force-deploy note already
							     uses: informational, because it does NOT hold this action. Its
							     whole job is to stop the amber banner on the page behind this
							     modal from being the reader's only statement about the gate.
							     When there IS a consequence alert it moves INSIDE it rather
							     than stacking — see below. -->
							<Alert color="blue" class="flex items-start text-xs dark:bg-blue-950/60 dark:text-blue-200">
								<PauseSolid class="mt-0.5 h-4 w-4 shrink-0" />
								{gateNote}
							</Alert>
						{/if}
						{#if rollout && hasForceDeployAnnotation(rollout)}
							<Alert color="blue" class="flex items-start text-xs">
								<ExclamationCircleSolid class="mt-0.5 h-4 w-4 shrink-0" />
								Force deploy already set. Only version pinning available.
							</Alert>
						{/if}

						<!-- ⭐ THE CONSEQUENCE, NAMED, WHERE THE DECISION IS MADE.
						     The critique's charge was that a build reached PRODUCTION
						     through three closed gates in two clicks and *"the modal
						     never says production"*. It says it now, and it says what
						     the gates currently think of this exact build.

						     The shape is `Clear Version Pin`'s — the copy the critic
						     named as the best in the product: consequence, then
						     non-consequence, then the rule in human terms. `notice`
						     is amber; `typed` is red, because at that level the
						     primary is genuinely held. Neither fires on an ordinary
						     vouched deploy — `confirmNotice` returns null there. -->
						{#if deployNotice}
							<!-- ⚠️ THE DARK FILL IS OVERRIDDEN ON PURPOSE. Flowbite's
							     `Alert` ships `dark:bg-red-200` / `dark:bg-yellow-200` — a
							     LIGHT-MODE fill on a dark page, measured as the brightest
							     block in the dialog. These are the same tinted-dark grounds
							     `bake-status.ts` and `AlertPanel` already use. -->
							<Alert
								color={level === 'typed' ? 'red' : 'yellow'}
								class="flex items-start text-xs {level === 'typed'
									? 'dark:bg-red-950/60 dark:text-red-200'
									: 'dark:bg-yellow-950/50 dark:text-yellow-100'}"
							>
								<!-- `shrink-0 mt-0.5`: flowbite's Alert is not a flex box, so the
								     glyph sat on its own line above the text. The Alert gets
								     `flex items-start` below and the glyph rides the first line. -->
								<ExclamationCircleSolid class="mt-0.5 h-4 w-4 shrink-0" />
								<!-- ⭐ ONE BOLD SENTENCE — THE CONSEQUENCE — THEN REST WEIGHT.
								     (F10, design pass 2 re-check) The icon, the full notice,
								     the paused-automation tail and the override `FactList`
								     were all one flat red at one flat weight: four facts at
								     equal loudness reads as none of them loud. Only the LEAD
								     sentence (`splitLeadSentence`) — the one that names the
								     actual consequence — carries `font-semibold` now. -->
								<div>
									<span class="font-semibold">{deployNoticeParts?.lead}</span>{deployNoticeParts?.rest
										? ` ${deployNoticeParts.rest}`
										: ''}
									{#if gateWhy}
										<span class="mt-1 block opacity-90"
											>Automatic promotion is paused right now — {gateWhy}.</span
										>
									{/if}
									<!-- ⭐ THE RULES IT OVERRIDES, NAMED — the prod force-deploy
									     dialog used to say only "a rule is holding it" while the
									     banner behind it named the count and the Dependencies tab
									     named the contract. Structured, not a second sentence: a
									     `FactList` under the consequence, one row per gate.
									     ⛔ NOT `tone="banner"` here — that tone gives the label
									     AND the value the alert's own ink on purpose (see its own
									     note: no alpha clears 4.5:1 over `AlertPanel`'s gradient),
									     which is what made the label, the value and the prose
									     read as one undifferentiated red block. This alert is a
									     flat tint, not a gradient, so the value can afford to be
									     the same neutral ink the `card` record uses — the label
									     stays in the alert's own ink via `tone="alert"`. -->
									{#if overrideFacts.length > 0}
										<FactList
											facts={overrideFacts}
											tone="alert"
											class="mt-2 border-t border-current/15 pt-2"
										/>
									{/if}
								</div>
							</Alert>
						{/if}

						{#if rollout && !hasForceDeployAnnotation(rollout)}
							<div
								class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800"
							>
								<div>
									<div class="text-sm font-medium text-gray-900 dark:text-white">Pin Version</div>
									<!-- ⛔ THIS CAPTION SAID `Required for rollback` ON A MODAL
									     HEADED `Deploy 51b976a → aa17645` — a roll-FORWARD. It
									     was reading the CALLER'S intent flag instead of what the
									     picked version actually is. It reads the direction now,
									     so it can no longer contradict the header above it. -->
									<p class="text-xs text-gray-500 dark:text-gray-400">
										{direction === 'rollback'
											? 'Going back pins the version'
											: intent.custom
												? 'Required for a version outside the release list'
												: 'Lock to this version'}
									</p>
								</div>
								<!-- ⛔ A LOCKED SETTING IS A SENTENCE NOW, NOT A DISABLED
									     TOGGLE. (B3, 2026-09-03, operator walk) The previous fix
									     here gave disabled+checked a dedicated muted fill
									     (`gray-400`) so it would not read as the SAME full-strength
									     "on" as an enabled toggle — and a live walk found the
									     result still reads as OFF at a glance: a light-grey track
									     is this product's own vocabulary for "not set" everywhere
									     else it appears, whatever the knob's own position says.
									     `hasForceDeployAnnotation(rollout)` is `false` for every
									     branch that reaches this element (the whole block is
									     already gated on `!hasForceDeployAnnotation(rollout)`
									     above), so INSIDE this block `isPinVersionToggleDisabled`
									     is exactly `mustPin` — there is no other reason for it to
									     be disabled here. A control with only one possible value
									     is not a control; it is a fact, and a fact reads better as
									     words than as a switch nobody can flip. -->
								{#if mustPin}
									<p class="max-w-[55%] text-right text-xs font-medium text-gray-700 dark:text-gray-300">
										{targetPhraseCapitalized} will be pinned to {getDisplaySelectedVersion()}.
									</p>
								{:else}
									<Toggle
										bind:checked={pinVersionToggle}
										disabled={isPinVersionToggleDisabled}
										color="gray"
										classes={{
											span: 'peer-checked:!bg-gray-900 dark:peer-checked:!bg-gray-100'
										}}
									/>
								{/if}
							</div>
						{/if}

						<textarea
							bind:value={deployExplanation}
							placeholder={deployNotePlaceholder}
							aria-required={deployNoteRequired}
							rows="2"
							class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
						></textarea>
						{#if deployNoteRequired && deployExplanation.trim() === ''}
							<!-- The reason the confirm is disabled, said where the reader
							     is looking. (operator walk, 2026-09-03: typed the version
							     exactly, button stayed dead, nothing on screen said why.) -->
							<p class="t-dense text-gray-500 dark:text-gray-400">
								The note is required here — it is recorded with the deploy.
							</p>
						{/if}

						{#if needsTypedConfirmation}
							<div>
								<label
									for="cvm-confirm-version"
									class="mb-1 block text-xs text-gray-500 dark:text-gray-400"
								>
									{typedPrompt(intent)}
									<span class="font-semibold text-red-600 dark:text-red-400"
										>{getDisplaySelectedVersion()}</span
									> to confirm
								</label>
								<input
									id="cvm-confirm-version"
									type="text"
									bind:value={deployConfirmationVersion}
									class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
								/>
							</div>
						{/if}

						<div class="flex gap-2">
							<Button size="sm" color="light" class="flex-1" disabled={deploying} onclick={() => (open = false)}
								>Cancel</Button
							>
							<!-- THE BUTTON SAYS WHERE IT LANDS. `Deploy Now` named the
							     act and hid the target; `Deploy to production` is the
							     same click and the reader can predict it.

							     ⭐ COLOUR NOW MARKS THE DIRECTION, NOT JUST THE TIER. (P6,
							     2026-09-03, operator walk) See `confirmColor`/`confirmOutline`'s
							     own note: RED (filled at `typed`, outlined otherwise) for
							     every rollback; filled BLUE only for an ordinary forward
							     deploy. `outline` is flowbite's own variant — it swaps the
							     filled `bg-{color}-700` for `bg-transparent` + a
							     `border-{color}-700`/`text-{color}-700` pair via
							     `tailwind-merge`, so the same `color="red"` reads as a
							     quieter warning at `notice` and the full alarm at `typed`.

							     ⭐ THE PENDING STATE. (B3, 2026-09-03, operator walk) See
							     `handleDeploy`'s own note: `deploying` disables the button
							     (on top of the existing typed/same guards) and swaps both
							     the icon for a spinner and the label for the
							     present-continuous form, so a reader can see the click
							     registered instead of an armed button that looks untouched
							     for 5-8s. -->
							<!-- `size="sm"`: 8/16 padding, 38px — the `.btn` height the page
							     behind this dialog uses. The default `md` was 42px, a third
							     height for one role. -->
							<Button
								size="sm"
								color={confirmColor}
								outline={confirmOutline}
								class="flex-1"
								disabled={(needsTypedConfirmation &&
									deployConfirmationVersion !== getDisplaySelectedVersion()) ||
									(direction === 'same' && !pinVersionToggle) ||
									(deployNoteRequired && deployExplanation.trim() === '') ||
									deploying}
								onclick={handleDeploy}
							>
								{#if deploying}
									<StatusSpinner
										size="4"
										color={confirmOutline ? 'red' : 'white'}
										class="mr-2"
									/>
									<span class="truncate">{deployingLabel}</span>
								{:else}
									{#if direction === 'rollback'}
										<ReplyOutline class="mr-2 h-4 w-4 shrink-0" />
									{:else}
										<ArrowUpOutline class="mr-2 h-4 w-4 shrink-0" />
									{/if}
									<span class="truncate">{deployButtonLabel}</span>
								{/if}
							</Button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</Modal>

{#if showLocalToast}
	<Toast class="fixed top-24 right-4 z-50 rounded-lg" bind:toastStatus={showLocalToast}>
		{#snippet icon()}
			<div
				class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {localToastType ===
				'success'
					? 'bg-gray-100 text-green-700 dark:bg-gray-700 dark:text-green-400'
					: 'bg-red-100 text-red-500 dark:bg-red-800 dark:text-red-200'}"
			>
				<ExclamationCircleSolid class="h-5 w-5" />
			</div>
		{/snippet}
		{localToastMessage}
	</Toast>
{/if}

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
		background-image:
			linear-gradient(to bottom, #fff 40%, rgba(255, 255, 255, 0)),
			linear-gradient(to top, #fff 40%, rgba(255, 255, 255, 0)),
			radial-gradient(farthest-side at 50% 0%, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0)),
			radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0));
		background-position:
			top,
			bottom,
			top,
			bottom;
		background-size:
			100% 24px,
			100% 24px,
			100% 10px,
			100% 10px;
		background-attachment: local, local, scroll, scroll;
	}

	:global(.dark) .cvm-scroll-fade {
		background-image:
			linear-gradient(to bottom, #1f2937 40%, rgba(31, 41, 55, 0)),
			linear-gradient(to top, #1f2937 40%, rgba(31, 41, 55, 0)),
			radial-gradient(farthest-side at 50% 0%, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0)),
			radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0));
	}
</style>
