<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import type {
		Rollout,
		Kustomization,
		OCIRepository,
		ManagedResourceStatus
	} from '../../../../types';
	import {
		Card,
		Badge,
		Alert,
		Button,
		Timeline,
		TimelineItem,
		Modal,
		Select,
		Toast,
		Spinner,
		Tooltip,
		Listgroup,
		ListgroupItem
	} from 'flowbite-svelte';
	import {
		CodePullRequestSolid,
		ReplyOutline,
		EditOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		CloseOutline,
		CodeOutline,
		DatabaseSolid,
		ClockSolid,
		PauseSolid,
		ClipboardOutline
	} from 'flowbite-svelte-icons';
	import {
		formatTimeAgo,
		formatDuration,
		formatDate,
		getRolloutStatus,
		isFieldManagedByManager,
		isFieldManagedByOtherManager
	} from '$lib/utils';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import { fly } from 'svelte/transition';

	let rollout: Rollout | null = null;
	let kustomizations: Kustomization[] = [];
	let ociRepositories: OCIRepository[] = [];
	let managedResources: Record<string, ManagedResourceStatus[]> = {};
	let loading = true;
	let hasLoaded = false;
	let error: string | null = null;

	let mediaTypes: Record<string, string> = {};
	let annotations: Record<string, Record<string, string>> = {};

	let showPinModal = false;
	let showClearPinModal = false;
	let showReleaseCandidatePinModal = false;
	let selectedVersion: string | null = null;

	let showToast = false;
	let toastMessage = '';
	let toastType: 'success' | 'error' = 'success';

	let showRollbackModal = false;
	let rollbackVersion: string | null = null;

	let autoRefreshIntervalId: number | null = null;

	// Pagination variables
	let currentPage = 1;
	let itemsPerPage = 10;

	// Computed property to determine if dashboard is managing the wantedVersion field
	$: isDashboardManagingWantedVersion = (() => {
		if (!rollout) return false;

		// If no wantedVersion is set, dashboard can manage it
		if (rollout.spec?.wantedVersion === undefined) return true;

		// Check if dashboard is managing the wantedVersion field through managedFields
		if (rollout.metadata?.managedFields) {
			if (
				isFieldManagedByManager(
					rollout.metadata.managedFields,
					'rollout-dashboard',
					'spec.wantedVersion'
				)
			) {
				return true;
			}
		}

		// Check if any other manager is managing the wantedVersion field
		if (rollout.metadata?.managedFields) {
			if (
				isFieldManagedByOtherManager(
					rollout.metadata.managedFields,
					'rollout-dashboard',
					'spec.wantedVersion'
				)
			) {
				return false; // Another manager is managing this field
			}
		}

		// Default to allowing management if no conflicts detected
		return true;
	})();

	// Computed properties for pagination
	$: reversedVersions = rollout?.status?.availableReleases
		? [...rollout.status.availableReleases].reverse()
		: [];
	$: totalPages = Math.ceil(reversedVersions.length / itemsPerPage);
	$: paginatedVersions = reversedVersions.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	);

	function goToPage(page: number) {
		if (page >= 1 && page <= totalPages) {
			currentPage = page;
			selectedVersion = null; // Reset selection when changing pages
		}
	}

	async function updateData() {
		if (!hasLoaded) {
			loading = true;
		}
		try {
			const response = await fetch(`/api/rollouts/${$page.params.namespace}/${$page.params.name}`);
			if (!response.ok) {
				throw new Error('Failed to fetch rollout details');
			}
			const data = await response.json();
			rollout = data.rollout;
			kustomizations = data.kustomizations?.items || [];
			ociRepositories = data.ociRepositories?.items || [];

			if (rollout?.status?.history) {
				const mediaTypePromises = rollout.status.history
					.filter((entry) => !mediaTypes[entry.version])
					.map((entry) => getMediaType(entry.version));
				await Promise.all(mediaTypePromises);

				// Fetch annotations for all history and release candidate versions (deduplicated)
				const allVersions = [
					...(rollout.status.history?.map((entry) => entry.version) || []),
					...(rollout.status.releaseCandidates || [])
				];
				const uniqueVersions = Array.from(new Set(allVersions));
				const annotationPromises = uniqueVersions
					.filter((version) => !annotations[version])
					.map((version) => getAnnotations(version));
				await Promise.all(annotationPromises);
			}

			// Fetch managed resources for each Kustomization
			const tempResources: Record<string, ManagedResourceStatus[]> = {};
			await Promise.all(
				kustomizations
					.filter((kustomization) => Boolean(kustomization.metadata?.name))
					.map(async (kustomization) => {
						const name = kustomization.metadata!.name as string;
						const namespace = kustomization.metadata?.namespace || $page.params.namespace;
						try {
							const resourcesResponse = await fetch(
								`/api/kustomizations/${namespace}/${name}/managed-resources`
							);
							if (resourcesResponse.ok) {
								const resourcesData = await resourcesResponse.json();
								tempResources[name] = resourcesData.managedResources || [];
							}
						} catch (e) {
							console.error(`Failed to fetch managed resources for ${name}:`, e);
						}
					})
			);
			managedResources = tempResources;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error occurred';
		} finally {
			loading = false;
			hasLoaded = true;
		}
	}

	onMount(async () => {
		await updateData();
		autoRefreshIntervalId = window.setInterval(() => {
			updateData();
		}, 5000);
	});

	onDestroy(() => {
		if (autoRefreshIntervalId) {
			clearInterval(autoRefreshIntervalId);
			autoRefreshIntervalId = null;
		}
	});

	async function submitPin(version?: string) {
		const pinVersion = version ?? selectedVersion;
		if (!rollout || !pinVersion) return;

		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/pin`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ version: pinVersion })
				}
			);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				if (
					response.status === 500 &&
					errorData.details &&
					errorData.details.includes('dashboard is not managing the wantedVersion field')
				) {
					throw new Error(
						"Cannot pin version: Dashboard is not managing this rollout's wantedVersion field. This field may be managed by another controller or external system."
					);
				}
				throw new Error('Failed to pin version');
			}

			// Refresh the data
			setTimeout(async () => {
				for (let i = 0; i < 10; i++) {
					await updateData();
					if (rollout?.status?.history?.[0]?.version === pinVersion) {
						break;
					}
				}
			}, 1000);

			// Show success toast
			toastType = 'success';
			toastMessage = `Successfully pinned version`;
			showToast = true;
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			// Show error toast
			toastType = 'error';
			toastMessage = e instanceof Error ? e.message : 'Failed to pin version';
			showToast = true;
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} finally {
			showPinModal = false;
			selectedVersion = null;
		}
	}

	async function clearPin() {
		if (!rollout) return;

		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/pin`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ version: null })
				}
			);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				if (
					response.status === 500 &&
					errorData.details &&
					errorData.details.includes('dashboard is not managing the wantedVersion field')
				) {
					throw new Error(
						"Cannot clear pin: Dashboard is not managing this rollout's wantedVersion field. This field may be managed by another controller or external system."
					);
				}
				throw new Error('Failed to clear version pin');
			}

			// Refresh the data
			await updateData();

			// Show success toast
			toastType = 'success';
			toastMessage = 'Successfully cleared version pin';
			showToast = true;
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			// Show error toast
			toastType = 'error';
			toastMessage = e instanceof Error ? e.message : 'Failed to clear version pin';
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} finally {
			showClearPinModal = false;
		}
	}

	async function getMediaType(version: string) {
		if (!rollout) return;
		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/mediatype/${version}`
			);
			if (response.ok) {
				const data = await response.json();
				if (data.mediaType) {
					mediaTypes[version] = data.mediaType;
				} else {
					mediaTypes[version] = 'unknown';
				}
			} else {
				mediaTypes[version] = 'error';
			}
			mediaTypes = { ...mediaTypes };
		} catch (e) {
			console.error(`Failed to fetch media type for ${version}:`, e);
			mediaTypes[version] = 'error';
			mediaTypes = { ...mediaTypes };
		}
	}

	async function getAnnotations(version: string) {
		if (!rollout) return;
		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/annotations/${version}`
			);
			if (response.ok) {
				const data = await response.json();
				annotations[version] = data.annotations || {};
			} else {
				annotations[version] = {};
			}
			annotations = { ...annotations };
		} catch (e) {
			console.error(`Failed to fetch annotations for ${version}:`, e);
			annotations[version] = {};
			annotations = { ...annotations };
		}
	}

	function formatRevision(revision: string) {
		let result = '';
		if (revision.includes('@sha1:')) {
			result = revision.split('@sha1:')[1];
		} else {
			result = revision;
		}
		return result.substring(0, 7);
	}

	function getResourceStatus(resource: Kustomization | OCIRepository) {
		const readyCondition = resource.status?.conditions?.find((c) => c.type === 'Ready');
		if (!readyCondition) return { status: 'Unknown', color: 'dark' as const };

		switch (readyCondition.status) {
			case 'True':
				return { status: 'Ready', color: 'green' as const };
			case 'False':
				return { status: 'Failed', color: 'red' as const };
			default:
				return { status: 'Unknown', color: 'dark' as const };
		}
	}

	function getLastTransitionTime(resource: Kustomization | OCIRepository) {
		const readyCondition = resource.status?.conditions?.find((c) => c.type === 'Ready');
		return readyCondition?.lastTransitionTime;
	}

	function getBakeStatusIcon(bakeStatus?: string) {
		switch (bakeStatus) {
			case 'Succeeded':
				return { icon: CheckCircleSolid, color: 'text-green-600 dark:text-green-400' };
			case 'Failed':
				return { icon: ExclamationCircleSolid, color: 'text-red-600 dark:text-red-400' };
			case 'InProgress':
				return { icon: ClockSolid, color: 'text-yellow-600 dark:text-yellow-400' };
			case 'Cancelled':
				return { icon: CloseOutline, color: 'text-gray-600 dark:text-gray-400' };
			case 'None':
				return { icon: PauseSolid, color: 'text-gray-600 dark:text-gray-400' };
			default:
				return { icon: ClockSolid, color: 'text-gray-600 dark:text-gray-400' };
		}
	}

	function getBakeStatusColor(bakeStatus?: string) {
		switch (bakeStatus) {
			case 'Succeeded':
				return 'bg-green-200 dark:bg-green-900';
			case 'Failed':
				return 'bg-red-200 dark:bg-red-900';
			case 'InProgress':
				return 'bg-yellow-200 dark:bg-yellow-900';
			case 'Cancelled':
				return 'bg-gray-200 dark:bg-gray-700';
			case 'None':
				return 'bg-gray-200 dark:bg-gray-700';
			default:
				return 'bg-gray-200 dark:bg-gray-700';
		}
	}

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);

			// Show success toast
			toastType = 'success';
			toastMessage = `Copied version to clipboard`;
			showToast = true;
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			// Fallback for older browsers
			const textArea = document.createElement('textarea');
			textArea.value = text;
			document.body.appendChild(textArea);
			textArea.select();
			try {
				document.execCommand('copy');

				// Show success toast
				toastType = 'success';
				toastMessage = `Copied version to clipboard`;
				showToast = true;
				setTimeout(() => {
					showToast = false;
				}, 2000);
			} catch (fallbackError) {
				// Show error toast
				toastType = 'error';
				toastMessage = 'Failed to copy to clipboard';
				showToast = true;
				setTimeout(() => {
					showToast = false;
				}, 3000);
			} finally {
				document.body.removeChild(textArea);
			}
		}
	}
</script>

<div class="w-full px-4 py-8 dark:bg-gray-900">
	{#if loading}
		<div class="space-y-4">
			<div class="w-full">
				<div class="h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			</div>
			<div class="grid gap-4">
				{#each Array(3) as _}
					<div class="w-full">
						<div class="h-16 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
					</div>
				{/each}
			</div>
		</div>
	{:else if error}
		<Alert color="red" class="mb-4">
			{error}
		</Alert>
	{:else if !rollout}
		<Alert color="yellow" class="mb-4">Release not found</Alert>
	{:else}
		<div class="mb-6">
			<div class="flex items-center gap-4">
				<h2 class="text-2xl font-bold text-gray-900 dark:text-white">
					<span class="text-gray-500 dark:text-gray-400">{rollout.metadata?.namespace} / </span>
					{rollout.metadata?.name}
				</h2>
			</div>
			<div class="mb-4 mt-2 flex items-center gap-2">
				<Badge color={getRolloutStatus(rollout).color}>
					{getRolloutStatus(rollout).text}
				</Badge>
				<Badge color="blue">
					{#if rollout?.status?.history?.[0]}
						{annotations[rollout.status.history[0].version]?.['org.opencontainers.image.version'] ||
							rollout.status.history[0].version}
					{:else}
						Unknown
					{/if}
				</Badge>
				{#if rollout.spec?.wantedVersion}
					<Badge color="purple">Pinned</Badge>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<Button
					size="sm"
					color="light"
					disabled={!isDashboardManagingWantedVersion}
					on:click={() => {
						if (isDashboardManagingWantedVersion) {
							showPinModal = true;
						}
					}}
				>
					<EditOutline class="h-4 w-4" />
					Pin Version
				</Button>
				{#if !isDashboardManagingWantedVersion}
					<Tooltip placement="bottom"
						>Version management disabled: This rollout's wantedVersion field is managed by another
						controller or external system. The dashboard cannot pin it to prevent conflicts.</Tooltip
					>
				{/if}
				{#if rollout.spec?.wantedVersion}
					<Button
						size="sm"
						color="light"
						disabled={!isDashboardManagingWantedVersion}
						on:click={() => {
							if (isDashboardManagingWantedVersion) {
								showClearPinModal = true;
							}
						}}
					>
						<CloseOutline class="h-4 w-4" />
						Clear Pin
					</Button>
					{#if !isDashboardManagingWantedVersion}
						<Tooltip placement="bottom"
							>Version management disabled: This rollout's wantedVersion field is managed by another
							controller or external system. The dashboard cannot pin it to prevent conflicts.</Tooltip
						>
					{/if}
				{/if}
			</div>

			<!-- {#if rollout.status?.history?.[0]?.bakeStatus}
				<div class="mt-2">
					<Badge
						color={rollout.status.history[0].bakeStatus === 'Succeeded'
							? 'green'
							: rollout.status.history[0].bakeStatus === 'Failed'
								? 'red'
								: rollout.status.history[0].bakeStatus === 'InProgress'
									? 'yellow'
									: rollout.status.history[0].bakeStatus === 'Cancelled'
										? 'dark'
										: 'dark'}
						class="mr-2"
					>
						<svelte:component
							this={getBakeStatusIcon(rollout.status.history[0].bakeStatus).icon}
							class="mr-1 h-3 w-3"
						/>
						Bake: {rollout.status.history[0].bakeStatus}
					</Badge>
					{#if rollout.status.history[0].bakeStatusMessage}
						<span class="text-sm text-gray-600 dark:text-gray-400">
							{rollout.status.history[0].bakeStatusMessage}
						</span>
					{/if}
				</div>
			{/if} -->
		</div>

		<div class="mb-6 grid grid-cols-6 gap-4">
			<div>
				<p class="text-sm text-gray-600 dark:text-gray-400">Releases Image Policy</p>
				<p class="font-medium dark:text-white">
					{rollout.spec?.releasesImagePolicy?.name}
				</p>
			</div>
			<div>
				<p class="text-sm text-gray-600 dark:text-gray-400">Version History Limit</p>
				<p class="font-medium dark:text-white">
					{rollout.spec?.versionHistoryLimit || 5}
				</p>
			</div>
			{#if rollout.spec?.minBakeTime || rollout.spec?.maxBakeTime}
				{#if rollout.spec?.minBakeTime}
					<div>
						<p class="text-sm text-gray-600 dark:text-gray-400">Minimum Bake Time</p>
						<p class="font-medium dark:text-white">{rollout.spec.minBakeTime}</p>
					</div>
				{/if}
				{#if rollout.spec?.maxBakeTime}
					<div>
						<p class="text-sm text-gray-600 dark:text-gray-400">Maximum Bake Time</p>
						<p class="font-medium dark:text-white">{rollout.spec.maxBakeTime}</p>
					</div>
				{/if}
			{/if}
		</div>

		<div class="mb-6">
			<h4 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">
				Upcoming Release Candidates
			</h4>
			{#if rollout.status?.releaseCandidates && rollout.status.releaseCandidates.length > 0}
				<div
					class="grid gap-4"
					style="grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));"
				>
					{#each rollout.status.releaseCandidates as version}
						<Card class="w-full min-w-full max-w-none overflow-hidden">
							<div class="mb-3 w-full">
								<div class="mb-2 flex w-full items-start justify-between gap-2">
									<h6 class="min-w-0 flex-1 break-all font-medium text-gray-900 dark:text-white">
										{annotations[version]?.['org.opencontainers.image.version'] || version}
									</h6>
									{#if rollout.status?.gatedReleaseCandidates?.includes(version)}
										<Badge color="green" class="flex-shrink-0 text-xs">Available</Badge>
									{:else}
										<Badge color="yellow" class="flex-shrink-0 text-xs">Blocked</Badge>
									{/if}
								</div>

								{#if annotations[version]?.['org.opencontainers.image.version']}
									<div class="mb-2">
										<Badge color="dark" class="break-all font-mono text-xs">
											{version}
										</Badge>
									</div>
								{/if}
								{#if annotations[version]?.['org.opencontainers.image.created']}
									<div class="text-xs text-gray-500 dark:text-gray-500">
										<div class="mb-1">
											Created: {formatDate(
												annotations[version]['org.opencontainers.image.created']
											)}
										</div>
										<Badge color="dark" border>
											<ClockSolid class="me-1.5 h-2.5 w-2.5" />
											{formatTimeAgo(
												annotations[version]['org.opencontainers.image.created'],
												$now
											)}
										</Badge>
									</div>
								{/if}
							</div>

							{#if rollout.status?.gates && rollout.status.gates.length > 0}
								<div class="space-y-2">
									<p class="text-xs font-medium text-gray-700 dark:text-gray-300">Gate Status:</p>
									{#each rollout.status.gates as gate}
										<div class="flex items-center justify-between text-xs">
											{#if gate.allowedVersions?.includes(version)}
												<Badge color="green" class="text-xs">
													<CheckCircleSolid class="mr-1 h-3 w-3" />
													{gate.name}
												</Badge>
											{:else}
												<Badge color="red" class="text-xs">
													<ExclamationCircleSolid class="mr-1 h-3 w-3" />
													{gate.name}
												</Badge>
											{/if}
										</div>
									{/each}
								</div>
							{/if}

							<div class="space-y-2 pt-3 dark:border-gray-700">
								<Button
									size="xs"
									color="blue"
									disabled={!isDashboardManagingWantedVersion}
									on:click={() => {
										if (isDashboardManagingWantedVersion) {
											selectedVersion = version;
											showReleaseCandidatePinModal = true;
										}
									}}
									class=""
								>
									<EditOutline class="mr-1 h-3 w-3" />
									Pin Version
								</Button>
								{#if !isDashboardManagingWantedVersion}
									<Tooltip placement="top" class="">
										Version management disabled: This rollout's wantedVersion field is managed by
										another controller or external system. The dashboard cannot pin it to prevent
										conflicts.
									</Tooltip>
								{/if}

								{#if annotations[version]?.['org.opencontainers.image.source']}
									<GitHubViewButton
										sourceUrl={annotations[version]['org.opencontainers.image.source']}
										version={annotations[version]?.['org.opencontainers.image.version'] || version}
										size="xs"
										color="light"
									/>
								{/if}

								<Button size="xs" color="light" on:click={() => copyToClipboard(version)} class="">
									<ClipboardOutline class="mr-1 h-3 w-3" />
									Copy Tag
								</Button>
							</div>
						</Card>
					{/each}
				</div>
			{:else}
				<Alert color="blue" class="mb-4">
					<div class="flex items-center">
						<ExclamationCircleSolid class="mr-2 h-5 w-5" />
						<span class="font-medium">No Release Candidates Available</span>
					</div>
					<!-- <p class="mt-2 text-sm">
						There are currently no release candidates available for this rollout. This could be due
						to:
					</p>
					<ul class="mt-2 list-inside list-disc space-y-1 text-sm">
						<li>No new versions have been published to the repository</li>
						<li>All available versions are blocked by deployment gates</li>
						<li>The rollout configuration needs to be updated</li>
					</ul> -->
				</Alert>
			{/if}
		</div>

		{#if rollout.status?.history}
			<div class="mb-6">
				<div class="flex items-center justify-between">
					<h4 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">Rollout History</h4>
				</div>
				<div class="overflow-x-auto">
					<Timeline order="horizontal">
						{#each rollout.status.history as entry, i ((entry.version, i))}
							<TimelineItem
								classLi="mr-4"
								title={annotations[entry.version]?.['org.opencontainers.image.version'] ||
									entry.version}
								date="Deployed {formatTimeAgo(entry.timestamp, $now)}"
							>
								<svelte:fragment slot="icon">
									<div class="flex items-center">
										<div
											class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-0 ring-white sm:ring-8 dark:ring-gray-900 {getBakeStatusColor(
												entry.bakeStatus
											)}"
										>
											<svelte:component
												this={getBakeStatusIcon(entry.bakeStatus).icon}
												class="h-4 w-4 {getBakeStatusIcon(entry.bakeStatus).color}"
											/>
										</div>
										<div class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"></div>
									</div>
								</svelte:fragment>
								<span class="w-full"
									>{#if annotations[entry.version]?.['org.opencontainers.image.revision']}
										<Badge color="dark" class="mr-1">
											{formatRevision(
												annotations[entry.version]['org.opencontainers.image.revision']
											)}
										</Badge>
									{/if}</span
								>

								{#if entry.bakeStatus}
									<div class="mt-2 space-y-1">
										{#if entry.bakeStatusMessage}
											<p class="text-xs text-gray-600 dark:text-gray-400">
												{entry.bakeStatusMessage}
											</p>
										{/if}

										{#if entry.bakeStartTime && entry.bakeEndTime}
											<p class="text-xs text-gray-500 dark:text-gray-500">
												Bake completed in {formatDuration(
													entry.bakeStartTime,
													new Date(entry.bakeEndTime)
												)}
											</p>
										{/if}
									</div>
								{/if}
								<div class="py-2 text-base font-normal text-gray-500 dark:text-gray-400">
									<div class="space-y-2 pt-3 dark:border-gray-700">
										{#if mediaTypes[entry.version] === 'application/vnd.cncf.flux.config.v1+json'}
											<SourceViewer
												namespace={rollout.metadata?.namespace || ''}
												name={rollout.metadata?.name || ''}
												version={entry.version}
											/>
										{/if}
										{#if i < rollout.status.history.length - 1 && mediaTypes[entry.version] === 'application/vnd.cncf.flux.config.v1+json'}
											<Button
												color="light"
												size="xs"
												href={`/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/diff/${entry.version}`}
												class=""
											>
												<CodePullRequestSolid class="mr-1 h-3 w-3" />
												Show diff
											</Button>
										{/if}
										{#if entry.version !== rollout.status?.history[0]?.version}
											<Button
												color="light"
												size="xs"
												on:click={() => {
													rollbackVersion = entry.version;
													showRollbackModal = true;
												}}
												class=""
											>
												<ReplyOutline class="mr-1 h-3 w-3" />
												Rollback
											</Button>
										{/if}
										{#if annotations[entry.version]?.['org.opencontainers.image.source']}
											<GitHubViewButton
												sourceUrl={annotations[entry.version]['org.opencontainers.image.source']}
												version={annotations[entry.version]?.['org.opencontainers.image.version'] ||
													entry.version}
												size="xs"
												color="light"
											/>
										{/if}
										<Button
											size="xs"
											color="light"
											on:click={() => copyToClipboard(entry.version)}
											class=""
										>
											<ClipboardOutline class="mr-1 h-3 w-3" />
											Copy Tag
										</Button>
									</div>
								</div>
							</TimelineItem>
						{/each}
					</Timeline>
				</div>
			</div>
		{/if}

		{#if kustomizations.length > 0 || ociRepositories.length > 0}
			<div class="mb-6">
				<h4 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">Associated Resources</h4>

				{#if kustomizations.length > 0}
					<div class="mb-4">
						<h5 class="text-md mb-2 flex items-center font-medium text-gray-700 dark:text-gray-300">
							<CodeOutline class="mr-2 h-4 w-4" />
							Kustomizations
						</h5>
						<div class="space-y-4">
							{#each kustomizations as kustomization (kustomization.metadata?.name)}
								<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
									<div class="mb-3 flex items-center justify-between">
										<div class="flex items-center space-x-3">
											<div>
												<h6 class="font-medium text-gray-900 dark:text-white">
													{kustomization.metadata?.name}
												</h6>
												<p class="text-sm text-gray-500 dark:text-gray-400">
													Source: {kustomization.spec?.sourceRef?.kind}
													{kustomization.spec?.sourceRef?.name}
												</p>
												{#if kustomization.spec?.interval}
													<p class="text-sm text-gray-500 dark:text-gray-400">
														Interval: {kustomization.spec.interval}
													</p>
												{/if}
											</div>
										</div>
										<div class="flex items-center space-x-2">
											<Badge color={getResourceStatus(kustomization).color}>
												{getResourceStatus(kustomization).status}
											</Badge>
											{#if getLastTransitionTime(kustomization)}
												<Badge color="dark" border>
													<ClockSolid class="me-1.5 h-2.5 w-2.5" />
													{formatTimeAgo(getLastTransitionTime(kustomization)!, $now)}
												</Badge>
											{/if}
										</div>
									</div>
									{#if kustomization.status?.lastAppliedRevision}
										<p class="mb-3 truncate text-sm text-gray-600 dark:text-gray-400">
											Last applied: {kustomization.status.lastAppliedRevision}
										</p>
									{/if}

									{#if managedResources[kustomization.metadata?.name || '']?.length > 0}
										<div class="mt-4">
											<h7 class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
												Managed Resources ({managedResources[kustomization.metadata?.name || '']
													.length})
											</h7>
											<div class="flex flex-wrap gap-2">
												{#each managedResources[kustomization.metadata?.name || ''] as resource (resource.groupVersionKind + '/' + (resource.namespace || '') + '/' + resource.name)}
													<Card size="xs" class="min-w-0 flex-shrink-0 p-4 sm:p-4">
														<div class="flex items-center">
															<div
																class="mr-3 flex h-8 w-8 flex-shrink-0 items-center justify-center"
															>
																{#if resource.status === 'InProgress'}
																	<Spinner size="6" color="yellow" />
																{:else if resource.status === 'Current'}
																	<CheckCircleSolid
																		class="h-6 w-6 text-green-600 dark:text-green-400"
																	/>
																{:else if resource.status === 'Failed' || resource.status === 'NotFound' || resource.status === 'Error'}
																	<ExclamationCircleSolid
																		class="h-6 w-6 text-red-600 dark:text-red-400"
																	/>
																{:else}
																	<ExclamationCircleSolid
																		class="h-6 w-6 text-gray-500 dark:text-gray-400"
																	/>
																{/if}
															</div>
															<div class="min-w-0 flex-1">
																<Badge color="blue" class="text-xs">
																	{(() => {
																		const parts = resource.groupVersionKind.split('/');
																		if (parts.length === 1) {
																			return parts[0]; // Just the kind
																		} else if (parts.length === 2) {
																			return parts[0] && parts[1]
																				? `${parts[0]}/${parts[1]}`
																				: parts[0] || parts[1];
																		} else if (parts.length === 3) {
																			const [group, version, kind] = parts;
																			const result = [];
																			if (group) result.push(group);
																			if (version) result.push(version);
																			if (kind) result.push(kind);
																			return result.join('/');
																		}
																		return resource.groupVersionKind;
																	})()}
																</Badge>
																<div class="my-1 flex items-center space-x-2">
																	<p
																		class="truncate text-sm font-medium text-gray-900 dark:text-white"
																	>
																		{#if resource.namespace}
																			<span class="text-gray-500 dark:text-gray-400">
																				{resource.namespace} /
																			</span>
																		{/if}
																		{resource.name}
																	</p>
																</div>
																{#if resource.message}
																	<span
																		class="mt-1 block truncate text-xs text-gray-600 dark:text-gray-400"
																	>
																		{resource.message}
																	</span>
																{/if}
															</div>
														</div>
													</Card>
												{/each}
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if ociRepositories.length > 0}
					<div class="mb-4">
						<h5 class="text-md mb-2 flex items-center font-medium text-gray-700 dark:text-gray-300">
							<DatabaseSolid class="mr-2 h-4 w-4" />
							OCI Repositories
						</h5>
						<div class="space-y-4">
							{#each ociRepositories as ociRepository (ociRepository.metadata?.name)}
								<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
									<div class="flex items-center justify-between">
										<div class="flex items-center space-x-3">
											<div>
												<h6 class="font-medium text-gray-900 dark:text-white">
													{ociRepository.metadata?.name}
												</h6>
												<p class="text-sm text-gray-500 dark:text-gray-400">
													URL: {ociRepository.spec?.url}
												</p>
												{#if ociRepository.spec?.interval}
													<p class="text-sm text-gray-500 dark:text-gray-400">
														Interval: {ociRepository.spec.interval}
													</p>
												{/if}
											</div>
										</div>
										<div class="flex items-center space-x-2">
											<Badge color={getResourceStatus(ociRepository).color}>
												{getResourceStatus(ociRepository).status}
											</Badge>
											{#if getLastTransitionTime(ociRepository)}
												<Badge color="dark" border>
													<ClockSolid class="me-1.5 h-2.5 w-2.5" />
													{formatTimeAgo(getLastTransitionTime(ociRepository)!, $now)}
												</Badge>
											{/if}
										</div>
									</div>
									{#if ociRepository.status?.url}
										<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
											Last observed URL: {ociRepository.status.url}
										</p>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<Modal bind:open={showPinModal} title="Pin Version">
	<div class="space-y-4">
		{#if !isDashboardManagingWantedVersion}
			<Alert color="yellow" class="mb-4">
				<ExclamationCircleSolid class="h-4 w-4" />
				<span class="font-medium">Warning:</span> The dashboard is not currently managing the wantedVersion
				field for this rollout. Setting a pin may conflict with other controllers or external systems.
			</Alert>
		{/if}

		<div>
			<h5 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Available Versions</h5>
			<Listgroup active class="max-h-96 overflow-y-auto">
				{#if rollout?.status?.availableReleases}
					{#each paginatedVersions as version}
						<ListgroupItem
							on:click={() => {
								selectedVersion = version;
							}}
							class="w-full cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 {selectedVersion ===
							version
								? 'border-2 border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900'
								: 'border-2 border-transparent'}"
						>
							<div class="flex w-full items-center justify-between">
								<div class="flex-1 space-y-2 pr-4">
									<div class="flex items-center justify-between">
										<div class="flex-1">
											<div class="font-medium text-gray-900 dark:text-white">
												{annotations[version]?.['org.opencontainers.image.version'] || version}
											</div>
											{#if annotations[version]?.['org.opencontainers.image.version']}
												<div class="text-xs text-gray-500 dark:text-gray-400">
													Tag: <code
														class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800"
														>{version}</code
													>
												</div>
											{/if}
										</div>
									</div>

									<!-- Version details -->
									<div class="grid grid-cols-2 gap-4 text-xs text-gray-600 dark:text-gray-400">
										{#if annotations[version]?.['org.opencontainers.image.created']}
											<div>
												<span class="font-medium">Created:</span>
												<div class="mb-1">
													{formatDate(annotations[version]['org.opencontainers.image.created'])}
												</div>
												<div class="text-gray-500 dark:text-gray-500">
													<Badge color="dark" border>
														<ClockSolid class="me-1.5 h-2.5 w-2.5" />
														{formatTimeAgo(
															annotations[version]['org.opencontainers.image.created'],
															$now
														)}
													</Badge>
												</div>
											</div>
										{/if}
										{#if annotations[version]?.['org.opencontainers.image.revision']}
											<div>
												<span class="font-medium">Revision:</span>
												<div class="font-mono">
													{formatRevision(
														annotations[version]['org.opencontainers.image.revision']
													)}
												</div>
											</div>
										{/if}
									</div>

									<!-- Status indicators -->
									<div class="flex flex-wrap gap-2">
										{#if rollout?.status?.history?.[0]?.version === version}
											<Badge color="green" class="text-xs">
												<CheckCircleSolid class="mr-1 h-3 w-3" />
												Currently Deployed
											</Badge>
										{/if}
										{#if rollout?.spec?.wantedVersion === version}
											<Badge color="purple" class="text-xs">
												<CheckCircleSolid class="mr-1 h-3 w-3" />
												Currently Pinned
											</Badge>
										{/if}
									</div>

									<!-- Action buttons -->
									<div class="flex gap-2 pt-2">
										{#if annotations[version]?.['org.opencontainers.image.source']}
											<GitHubViewButton
												sourceUrl={annotations[version]['org.opencontainers.image.source']}
												version={annotations[version]?.['org.opencontainers.image.version'] ||
													version}
												size="xs"
												color="light"
											/>
										{/if}
										<Button
											size="xs"
											color="light"
											on:click={() => copyToClipboard(version)}
											class="text-xs"
										>
											<ClipboardOutline class="mr-1 h-3 w-3" />
											Copy Tag
										</Button>
									</div>
								</div>
								<div class="w-6 flex-shrink-0">
									{#if selectedVersion === version}
										<CheckCircleSolid class="h-5 w-5 text-blue-600 dark:text-blue-400" />
									{/if}
								</div>
							</div>
						</ListgroupItem>
					{/each}
				{:else}
					<ListgroupItem class="text-center text-gray-500 dark:text-gray-400">
						No versions available
					</ListgroupItem>
				{/if}
			</Listgroup>
		</div>

		<div class="flex justify-end gap-2 pt-4">
			{#if totalPages > 1}
				<div class="flex flex-1 items-center justify-center gap-2">
					<Button
						size="sm"
						color="light"
						on:click={() => goToPage(currentPage - 1)}
						disabled={currentPage === 1}
					>
						Previous
					</Button>
					<span class="text-sm text-gray-600 dark:text-gray-400">
						Page {currentPage} of {totalPages}
					</span>
					<Button
						size="sm"
						color="light"
						on:click={() => goToPage(currentPage + 1)}
						disabled={currentPage === totalPages}
					>
						Next
					</Button>
				</div>
			{/if}
			<Button
				color="light"
				on:click={() => {
					showPinModal = false;
					selectedVersion = null;
				}}
			>
				Cancel
			</Button>
			<Button color="blue" disabled={!selectedVersion} on:click={() => submitPin()}>
				Pin Version
			</Button>
		</div>
	</div>
</Modal>

<Modal bind:open={showClearPinModal} title="Clear Pin">
	<div class="space-y-4">
		{#if !isDashboardManagingWantedVersion}
			<Alert color="yellow" class="mb-4">
				<ExclamationCircleSolid class="h-4 w-4" />
				<span class="font-medium">Warning:</span> The dashboard is not currently managing the wantedVersion
				field for this rollout. Clearing the pin may conflict with other controllers or external systems.
			</Alert>
		{/if}
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Are you sure you want to clear the version pin for {rollout?.metadata?.name}?
		</p>
		<div class="flex justify-end gap-2">
			<Button
				color="light"
				on:click={() => {
					showClearPinModal = false;
				}}
			>
				Cancel
			</Button>
			<Button color="blue" on:click={clearPin}>Clear Pin</Button>
		</div>
	</div>
</Modal>

<Modal bind:open={showRollbackModal} title="Confirm Rollback">
	<div class="space-y-4">
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Are you sure you want to rollback to version <b>{rollbackVersion}</b>?
		</p>
		<div class="flex justify-end gap-2">
			<Button
				color="light"
				on:click={() => {
					showRollbackModal = false;
					rollbackVersion = null;
				}}
			>
				Cancel
			</Button>
			<Button
				color="blue"
				on:click={async () => {
					await submitPin(rollbackVersion || undefined);
					showRollbackModal = false;
					rollbackVersion = null;
				}}
			>
				Rollback
			</Button>
		</div>
	</div>
</Modal>

<Modal bind:open={showReleaseCandidatePinModal} title="Confirm Version Pin">
	<div class="space-y-4">
		{#if !isDashboardManagingWantedVersion}
			<Alert color="yellow" class="mb-4">
				<ExclamationCircleSolid class="h-4 w-4" />
				<span class="font-medium">Warning:</span> The dashboard is not currently managing the wantedVersion
				field for this rollout. Setting a pin may conflict with other controllers or external systems.
			</Alert>
		{/if}
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Are you sure you want to set <b>{selectedVersion}</b> as the current version pin for
			<b>{rollout?.metadata?.name}</b>?
		</p>
		<p class="text-xs text-gray-500 dark:text-gray-400">
			This will immediately deploy this version and pin it, preventing automatic deployment logic
			from changing it.
		</p>
		<div class="flex justify-end gap-2">
			<Button
				color="light"
				on:click={() => {
					showReleaseCandidatePinModal = false;
					selectedVersion = null;
				}}
			>
				Cancel
			</Button>
			<Button
				color="blue"
				on:click={async () => {
					await submitPin(selectedVersion || undefined);
					showReleaseCandidatePinModal = false;
					selectedVersion = null;
				}}
			>
				Set Pin
			</Button>
		</div>
	</div>
</Modal>

<Toast
	transition={fly}
	position="top-right"
	params={{ x: 200 }}
	class="mt-20 rounded-lg"
	align={false}
	bind:toastStatus={showToast}
>
	<div
		class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {toastType ===
		'success'
			? 'bg-green-100 text-green-500 dark:bg-green-800 dark:text-green-200'
			: 'bg-red-100 text-red-500 dark:bg-red-800 dark:text-red-200'}"
	>
		{#if toastType === 'success'}
			<CheckCircleSolid class="h-5 w-5" />
		{:else}
			<ExclamationCircleSolid class="h-5 w-5" />
		{/if}
	</div>
	{toastMessage}
</Toast>
