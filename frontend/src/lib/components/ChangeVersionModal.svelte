<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout } from '../../types';
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
		autoDeployState,
		type AutoDeployState
	} from '$lib/view-models/auto-deploy';
	import {
		fetchCommits,
		commitsQueryKey,
		formatCommitMessage,
		connectGithub,
		FetchCommitsError,
		type CommitsError
	} from '$lib/api/github';

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
		onSuccess = () => {},
		onError = () => {}
	}: Props = $props();

	function apiUrl(path: string): string {
		if (!cluster) return path;
		const sep = path.includes('?') ? '&' : '?';
		return `${path}${sep}cluster=${encodeURIComponent(cluster)}`;
	}

	// --- Picker state ---------------------------------------------------
	let selectedVersion = $state<string | null>(null);
	let searchQuery = $state('');
	let showAllTags = $state(false);
	let currentPage = $state(1);
	let allRepositoryTags = $state<string[]>([]);
	let loadingAllTags = $state(false);
	let annotations = $state<Record<string, Record<string, string>>>({});
	let loadingAnnotations = $state<Record<string, boolean>>({});
	const itemsPerPage = 10;

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
			currentPage = 1;
		}
	});

	const availableReleases = $derived(rollout?.status?.availableReleases ?? []);
	const currentTag = $derived(rollout?.status?.history?.[0]?.version?.tag ?? null);
	// Display form (semver/revision) of the currently-deployed version, so the
	// delta summary reads consistently with the picked side rather than dumping
	// the raw OCI tag.
	const currentDisplayVersion = $derived(
		rollout?.status?.history?.[0]?.version
			? getDisplayVersion(rollout.status.history[0].version)
			: (currentTag ?? '')
	);
	const currentRevision = $derived(rollout?.status?.history?.[0]?.version?.revision ?? null);

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

	const totalPages = $derived(Math.ceil(filteredVersionsForDisplay.length / itemsPerPage));
	const paginatedVersions = $derived(
		filteredVersionsForDisplay.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
	);

	function goToPage(page: number) {
		if (page >= 1 && page <= totalPages) currentPage = page;
	}

	function selectVersion(versionTag: string) {
		selectedVersion = versionTag;
	}

	// --- Direction + changelist -------------------------------------------
	const selectedRelease = $derived(availableReleases.find((r) => r.tag === selectedVersion) ?? null);
	const selectedRevision = $derived(
		selectedRelease?.revision || annotations[selectedVersion ?? '']?.['org.opencontainers.image.revision'] || null
	);

	const currentIdx = $derived(availableReleases.findIndex((r) => r.tag === currentTag));
	const selectedIdx = $derived(availableReleases.findIndex((r) => r.tag === selectedVersion));

	const isOlderThanCurrent = $derived(
		currentIdx !== -1 && selectedIdx !== -1 ? selectedIdx < currentIdx : false
	);
	const isCustomVersion = $derived(
		!!selectedVersion && availableReleases.length > 0 && selectedIdx === -1
	);
	const isSameAsCurrent = $derived(!!selectedVersion && selectedVersion === currentTag);

	type Direction = 'forward' | 'rollback' | 'same';
	const direction = $derived<Direction>(
		isSameAsCurrent ? 'same' : isOlderThanCurrent ? 'rollback' : 'forward'
	);

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

	const commitsQuery = createQuery(() => ({
		queryKey: commitsQueryKey(
			rollout?.metadata?.namespace ?? '',
			rollout?.metadata?.name ?? '',
			compareBase ?? '',
			compareHead ?? '',
			cluster
		),
		queryFn: () =>
			fetchCommits(
				rollout!.metadata!.namespace!,
				rollout!.metadata!.name!,
				compareBase!,
				compareHead!,
				cluster
			),
		enabled: canFetchCommits
	}));

	// Distinguish "connect GitHub" / "no access" from a generic failure.
	const commitsError = $derived<CommitsError | null>(
		commitsQuery.error instanceof FetchCommitsError ? commitsQuery.error.reason : null
	);

	const supportsManifestDiff = $derived(
		rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'
	);

	// --- Deploy footer logic ------------------------------------------------
	/**
	 * ⭐ THE FRICTION NOW MATCHES THE CONSEQUENCE.
	 *
	 * A live UX critique found the gradient INVERTED: `Continue to next stage`
	 * moved production traffic and cut a bake short with **no dialog at all**,
	 * while deploying one listed version made you **type the sha**. Both ends
	 * were wrong, and adding a modal everywhere would only have made the
	 * cheapest action as expensive as the most dangerous one.
	 *
	 * Typing is kept for the two cases a reader genuinely cannot predict or
	 * cheaply undo:
	 *
	 * - **a ROLLBACK.** Going backwards re-runs older code against data the
	 *   newer code has already touched; it is a different KIND of event, not a
	 *   smaller one, and it pins as a side effect.
	 * - **a CUSTOM version** — a tag that is not in `availableReleases`, so
	 *   nothing on screen has vouched for it and the changelist above may be
	 *   empty.
	 *
	 * It is dropped for a forward deploy to a listed release candidate. That is
	 * the same move the controller makes unattended; the commit list for it is
	 * displayed immediately above the button; and `Go back a version` is one
	 * click away. Making it expensive taught people to type without reading.
	 */
	const needsTypedConfirmation = $derived(direction === 'rollback' || isCustomVersion);
	/**
	 * The caller may hand us the state it already derived (rollout detail does,
	 * because it holds the full gate objects and so can print their published
	 * pretty names). Every OTHER call site — history, `/versions/<rev>`,
	 * `/envs/<name>`, `/apps/<name>`, `FailurePanel` — gets the same truth
	 * derived from the rollout alone rather than getting silence.
	 */
	const gateState = $derived(autoDeploy ?? autoDeployState(rollout));
	const gateNote = $derived(manualDeployNote(gateState));
	const mustPin = $derived(isPinVersionMode || isOlderThanCurrent || isCustomVersion);
	const pinVersionToggleComputed = $derived(mustPin || rollout?.spec?.wantedVersion !== undefined);
	const isPinVersionToggleDisabled = $derived(mustPin || hasForceDeployAnnotation(rollout ?? undefined));

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
			open = false;
		} catch (e) {
			notifyError(e instanceof Error ? e.message : 'Failed to deploy version');
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

<Modal bind:open title="" size="lg" class="[&>div]:p-0">
	<div class="flex max-h-[85vh] flex-col">
		<!-- Header. pr-14 reserves space for the modal's floating close (✕) in the
		     top-right corner so the right-aligned mobile Back button clears it. -->
		<div
			class="flex shrink-0 items-center gap-2 border-b border-gray-200 py-4 pl-5 pr-14 dark:border-gray-700"
		>
			<div class="text-base font-semibold text-gray-900 dark:text-white">Change Version</div>
			{#if rollout?.metadata?.name}
				<span class="text-gray-500 dark:text-gray-400">/</span>
				<code class="min-w-0 truncate text-sm text-gray-500 dark:text-gray-400">{rollout.metadata.name}</code>
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

		<div class="grid flex-1 overflow-hidden md:grid-cols-[300px_1fr]">
			<!-- LEFT: version picker -->
			<div
				class="flex-col overflow-hidden border-gray-200 md:flex md:border-r dark:border-gray-700 {selectedVersion
					? 'hidden'
					: 'flex'}"
			>
				<div class="shrink-0 space-y-3 p-4">
					<input
						type="text"
						placeholder="Search versions..."
						bind:value={searchQuery}
						class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
					/>
					<div class="flex items-center justify-between">
						<span class="text-xs text-gray-500 dark:text-gray-400">Show all repo tags</span>
						<Toggle
							bind:checked={showAllTags}
							size="small"
							color="blue"
							onchange={() => {
								if (showAllTags && allRepositoryTags.length === 0) getAllRepositoryTags();
								currentPage = 1;
							}}
						/>
					</div>
				</div>

				<div class="flex-1 overflow-y-auto">
					{#if paginatedVersions.length > 0}
						{#each paginatedVersions as version (typeof version === 'string' ? version : version.tag)}
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
							{#await loadAnnotationsOnDemand(versionTag)}{/await}
							<button
								type="button"
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
									{#if created}
										<div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
											{formatTimeAgo(created)}
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

				{#if totalPages > 1}
					<div class="flex shrink-0 items-center justify-center gap-3 border-t border-gray-100 p-2 dark:border-gray-800">
						<Button size="xs" color="light" onclick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>
							Prev
						</Button>
						<span class="text-xs text-gray-500 dark:text-gray-400">{currentPage} / {totalPages}</span>
						<Button size="xs" color="light" onclick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}>
							Next
						</Button>
					</div>
				{/if}
			</div>

			<!-- RIGHT: changelist + deploy -->
			<div class="flex-col overflow-hidden md:flex {selectedVersion ? 'flex' : 'hidden'}">
				{#if !selectedVersion}
					<div class="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400">
						Select a version to preview what will change.
					</div>
				{:else}
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
										Rollback{#if commitsQuery.data}&nbsp;— reverts {commitsQuery.data.commits.length} commit{commitsQuery
												.data.commits.length !== 1
												? 's'
												: ''}{/if}
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
								<div class="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-gray-500 dark:text-gray-400">
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
									<span class="text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
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
									<div class="flex flex-col items-start gap-2">
										<p class="text-sm text-gray-500 dark:text-gray-400">
											Connect your GitHub account to see which commits will {direction === 'rollback'
												? 'be reverted'
												: 'deploy'}.
										</p>
										<Button size="xs" color="light" onclick={() => connectGithub()}>
											<GithubSolid class="mr-1.5 h-3.5 w-3.5" />
											Connect GitHub
										</Button>
									</div>
								{:else if commitsError === 'no_access'}
									<p class="text-sm text-gray-500 dark:text-gray-400">
										You don't have access to this repository on GitHub. You can still proceed.
									</p>
								{:else if commitsQuery.isError}
									<p class="text-sm text-gray-500 dark:text-gray-400">
										Unable to load commit history. You can still proceed.
									</p>
								{:else if commitsQuery.data && commitsQuery.data.commits.length > 0}
									<ul class="space-y-3">
										{#each commitsQuery.data.commits as commit (commit.sha)}
											<li class="flex gap-2.5">
												<span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full {direction === 'rollback' ? 'bg-amber-500' : 'bg-green-700 dark:bg-green-400'}"
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
													<div class="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
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
								{:else}
									<p class="text-sm text-gray-500 dark:text-gray-400">
										No commit changes detected between versions.
									</p>
								{/if}
							</div>
						{/if}
					</div>

					<!-- Deploy footer -->
					<div class="shrink-0 space-y-3 border-t border-gray-200 p-4 dark:border-gray-700">
						{#if gateNote}
							<!-- Same `Alert color="blue"` at 12px the force-deploy note already
							     uses: informational, because it does NOT hold this action. Its
							     whole job is to stop the amber banner on the page behind this
							     modal from being the reader's only statement about the gate. -->
							<Alert color="blue" class="text-xs">
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

						{#if rollout && !hasForceDeployAnnotation(rollout)}
							<div class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
								<div>
									<div class="text-sm font-medium text-gray-900 dark:text-white">Pin Version</div>
									<p class="text-xs text-gray-500 dark:text-gray-400">
										{isPinVersionMode ? 'Required for rollback' : 'Lock to this version'}
									</p>
								</div>
								<Toggle bind:checked={pinVersionToggle} disabled={isPinVersionToggleDisabled} color="blue" />
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
									{direction === 'rollback'
										? 'Going backwards. Type'
										: 'This version is not in the release list. Type'}
									<span class="font-semibold text-blue-600 dark:text-blue-400"
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
							<Button
								color={direction === 'rollback' ? 'yellow' : 'blue'}
								class="flex-1"
								disabled={(needsTypedConfirmation &&
									deployConfirmationVersion !== getDisplaySelectedVersion()) ||
									direction === 'same'}
								onclick={handleDeploy}
							>
								{#if direction === 'rollback'}
									<ReplyOutline class="mr-2 h-4 w-4" />
								{:else}
									<ArrowUpOutline class="mr-2 h-4 w-4" />
								{/if}
								{pinVersionToggle ? 'Pin & Deploy' : 'Deploy Now'}
							</Button>
						</div>
					</div>
				{/if}
			</div>
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
