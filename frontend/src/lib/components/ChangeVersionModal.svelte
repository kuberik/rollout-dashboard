<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout, Environment, RolloutDependency } from '../../types';
	import { Modal, Alert, Badge, Button, Toggle, Toast } from 'flowbite-svelte';
	import {
		ExclamationCircleSolid,
		ArrowUpOutline,
		ReplyOutline,
		CodePullRequestSolid,
		GithubSolid,
		PauseSolid
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
		typedPrompt
	} from '$lib/view-models/deploy-risk';
	import { promotionBlock, gateAllows } from '$lib/view-models/promotion';
	import { requirementsChangedSentence } from '$lib/view-models/release-delta';
	import {
		commitsQueryOptions,
		formatCommitMessage,
		connectGithubInNewTab,
		fetchGithubStatus,
		githubAbsenceSentence,
		githubStatusQueryKey,
		FetchCommitsError,
		type CommitsError
	} from '$lib/api/github';
	import { modalFocusReturn } from '$lib/a11y.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import FactList, { type Fact } from './FactList.svelte';

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
		onError = () => {}
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
	let leftPaneMaxHeight = $state<number | null>(null);

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
		if (!selectedVersion || !leftHeaderEl || !leftListEl || !rightPaneEl) {
			leftPaneMaxHeight = null;
			return;
		}
		const header = leftHeaderEl;
		const list = leftListEl;
		const right = rightPaneEl;
		void rowCount;

		function recompute() {
			const natural = header.getBoundingClientRect().height + measuredContentHeight(list);
			const available = right.getBoundingClientRect().height;
			leftPaneMaxHeight = available > 0 && natural < available ? natural : null;
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
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
		};
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

	/** One composed line — build date, deploy date (current row only) and
	 * rank — so the template never has to reason about which separators to
	 * print. `null` when there is nothing to say. */
	function pickerRowLine(
		created: string | undefined,
		isCurrent: boolean,
		versionTag: string
	): string | null {
		const parts: string[] = [];
		if (created) parts.push(`Built ${formatTimeAgo(created)}`);
		if (isCurrent && currentDeployedAt) parts.push(`Deployed ${formatTimeAgo(currentDeployedAt)}`);
		const rank = pickerRankLabel(versionTag);
		if (rank) parts.push(rank);
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
	const needsTypedConfirmation = $derived(level === 'typed');
	const deployNotice = $derived(selectedVersion ? confirmNotice(intent, pinVersionToggle) : null);
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
	const deployButtonLabel = $derived(deployActionLabel(intent));
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

	async function handleDeploy() {
		if (!rollout || !selectedVersion) return;
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
     only once the right pane has something to draw. -->
<Modal
	bind:open
	title=""
	size="none"
	role="dialog"
	aria-modal="true"
	class="[&>div]:p-0 {selectedVersion ? 'max-w-4xl' : 'max-w-md'}"
	aria-labelledby="cvm-title"
>
	<div class="flex max-h-[85vh] flex-col">
		<!-- Header. pr-14 reserves space for the modal's floating close (✕) in the
		     top-right corner so the right-aligned mobile Back button clears it. -->
		<div
			class="flex shrink-0 items-center gap-2 border-b border-gray-200 py-4 pr-14 pl-5 dark:border-gray-700"
		>
			<h2 id="cvm-title" class="text-base font-semibold text-gray-900 dark:text-white">
				Change Version
			</h2>
			{#if rollout?.metadata?.name}
				<span class="text-gray-500 dark:text-gray-400">/</span>
				<code class="min-w-0 truncate text-sm text-gray-500 dark:text-gray-400"
					>{rollout.metadata.name}</code
				>
			{/if}
			{#if envLabel}
				<!-- ⭐ NAMES WHERE THIS LANDS. (operator walk, 2026-09-03) The crumb
				     said `Change Version / hello-world-app` on a page listing this
				     app in three environments, with nothing above it naming which
				     one this dialog acts on. `cluster` only prints when this
				     rollout lives on a spoke — the one case one environment word
				     is ambiguous. -->
				<span class="text-gray-500 dark:text-gray-400" aria-hidden="true">·</span>
				<span
					class="shrink-0 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400"
				>
					{envLabel}{clusterLabel ? ` · ${clusterLabel}` : ''}
				</span>
			{/if}
			<div class="flex-1"></div>
			{#if selectedVersion}
				<button
					type="button"
					class="flex shrink-0 items-center gap-1 text-sm text-gray-500 hover:text-gray-700 md:hidden dark:text-gray-400 dark:hover:text-gray-200"
					onclick={() => (selectedVersion = null)}
				>
					&larr; Back
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
				<div
					bind:this={leftListEl}
					class="flex-1 overflow-y-auto"
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
							{@const pickerLine = pickerRowLine(created, isCurrent, versionTag)}
							{#await loadAnnotationsOnDemand(versionTag)}{/await}
							<button
								type="button"
								aria-pressed={isSelected}
								class="flex w-full items-start gap-2 border-b border-gray-100 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 {isSelected
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
											<Badge color="green" class="text-[10px]">Current</Badge>
										{/if}
										{#if isPinned}
											<Badge color="blue" class="text-[10px]">Pinned</Badge>
										{/if}
									</div>
									{#if pickerLine}
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
										     `newest`) narrowed to a per-row `N back` / `N newer`. -->
										<div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
											{pickerLine}
										</div>
									{/if}
								</div>
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
				     placeholder to fill. -->
				<div bind:this={rightPaneEl} class="flex flex-col overflow-hidden">
					<div class="flex-1 space-y-4 overflow-y-auto p-5">
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
								<div class="mb-2 flex items-center justify-between">
									<span
										class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400"
									>
										{direction === 'rollback' ? 'Commits reverted' : 'Commits deployed'}
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
												<Button size="xs" color="light" onclick={() => connectGithubInNewTab()}>
													<GithubSolid class="mr-1.5 h-3.5 w-3.5" />
													Connect GitHub
												</Button>
											{/if}
										{/if}
									</div>
								{:else if commitsError === 'no_access'}
									<p class="text-sm text-gray-500 dark:text-gray-400">
										You don't have access to this repository on GitHub. You can still proceed.
									</p>
								{:else if commitsQuery.isError}
									<!-- ⛔ ONE SENTENCE FOR "UNREACHABLE", IN EVERY DIALOG.
									     (operator walk, 2026-09-03) A live walk found the PROD
									     force-deploy dialog printing `No commit changes detected
									     between versions.` while GitHub answered 401 — asserting
									     ABSENCE for a question that was never actually answered.
									     `githubAbsenceSentence({unreachable:true})` is the shared
									     wording now (F10, design pass 2 re-check) — its own doc
									     comment names this exact call site and says the caller
									     appends its extra clause by concatenation, so `You can
									     still proceed.` stays a dialog-only suffix rather than
									     something rebuilt into the shared sentence. -->
									<p class="text-sm text-gray-500 dark:text-gray-400">
										{githubAbsenceSentence(undefined, { unreachable: true })}
										{commitsQuery.error instanceof Error
											? commitsQuery.error.message
											: 'unknown error'}. You can still proceed.
									</p>
								{:else if commitsQuery.isSuccess && commitsQuery.data.commits.length > 0}
									<ul
										class="space-y-3"
										aria-label={direction === 'rollback' ? 'Commits reverted' : 'Commits deployed'}
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
									     SAME unreachable sentence as the `isError` branch, never the
									     "no changes" one. Absence is a claim; this is not one. -->
									<p class="text-sm text-gray-500 dark:text-gray-400">
										{githubAbsenceSentence(undefined, { unreachable: true })} You can still
										proceed.
									</p>
								{/if}
							</div>
						{/if}
					</div>

					<!-- Deploy footer -->
					<div class="shrink-0 space-y-3 border-t border-gray-200 p-4 dark:border-gray-700">
						{#if !deployNotice && gateNote}
							<!-- Same `Alert color="blue"` at 12px the force-deploy note already
							     uses: informational, because it does NOT hold this action. Its
							     whole job is to stop the amber banner on the page behind this
							     modal from being the reader's only statement about the gate.
							     When there IS a consequence alert it moves INSIDE it rather
							     than stacking — see below. -->
							<Alert color="blue" class="text-xs dark:bg-blue-950/60 dark:text-blue-200">
								<PauseSolid class="h-4 w-4" />
								{gateNote}
							</Alert>
						{/if}
						{#if rollout && hasForceDeployAnnotation(rollout)}
							<Alert color="blue" class="text-xs">
								<ExclamationCircleSolid class="h-4 w-4" />
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
								class="text-xs {level === 'typed'
									? 'dark:bg-red-950/60 dark:text-red-200'
									: 'dark:bg-yellow-950/50 dark:text-yellow-100'}"
							>
								<ExclamationCircleSolid class="h-4 w-4" />
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
								<!-- ⛔ NOT BLUE, AND A DISABLED ONE MUST READ DISABLED. (operator
									     walk, 2026-09-03) Same rule as the picker's own toggle
									     above — blue is `Deploying`'s colour. The rollback path
									     pins unconditionally and disables this control (a rollback
									     always pins), and disabled+checked was rendering at the
									     SAME full-saturation fill as an enabled one — flowbite's
									     `disabled` variant only drops the surrounding `<label>` to
									     `opacity-50`, and one `!important` background utility beat
									     another only by luck of generation order. A dedicated,
									     visibly muted fill for the disabled+checked pair removes
									     that race and is the actual "this cannot be touched" cue. -->
								<Toggle
									bind:checked={pinVersionToggle}
									disabled={isPinVersionToggleDisabled}
									color="gray"
									classes={{
										span: isPinVersionToggleDisabled
											? 'peer-checked:!bg-gray-400 dark:peer-checked:!bg-gray-600'
											: 'peer-checked:!bg-gray-900 dark:peer-checked:!bg-gray-100'
									}}
								/>
							</div>
						{/if}

						<textarea
							bind:value={deployExplanation}
							placeholder="Why are you deploying this version? (optional)"
							rows="2"
							class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
						></textarea>

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
							<Button color="light" class="flex-1" onclick={() => (open = false)}>Cancel</Button>
							<!-- THE BUTTON SAYS WHERE IT LANDS. `Deploy Now` named the
							     act and hid the target; `Deploy to production` is the
							     same click and the reader can predict it. RED only at
							     `typed`, so the alarm still means something. -->
							<Button
								color={level === 'typed' ? 'red' : 'blue'}
								class="flex-1"
								disabled={(needsTypedConfirmation &&
									deployConfirmationVersion !== getDisplaySelectedVersion()) ||
									direction === 'same'}
								onclick={handleDeploy}
							>
								{#if direction === 'rollback'}
									<ReplyOutline class="mr-2 h-4 w-4 shrink-0" />
								{:else}
									<ArrowUpOutline class="mr-2 h-4 w-4 shrink-0" />
								{/if}
								<span class="truncate">{deployButtonLabel}</span>
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
