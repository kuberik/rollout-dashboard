<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import type {
		Rollout,
		Kustomization,
		OCIRepository,
		ManagedResourceStatus,
		HealthCheck,
		KruiseRollout
	} from '../../../../types';
	import {
		Card,
		Badge,
		Alert,
		Button,
		Timeline,
		TimelineItem,
		Modal,
		Toast,
		Spinner,
		Tooltip,
		Listgroup,
		ListgroupItem,
		Toggle,
		Clipboard,
		Blockquote,
		Drawer,
		StepIndicator,
		Progressradial
	} from 'flowbite-svelte';
	import {
		CodePullRequestSolid,
		ReplyOutline,
		EditOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		InfoCircleSolid,
		CloseOutline,
		CodeOutline,
		DatabaseSolid,
		ClockSolid,
		ClockArrowOutline,
		PauseSolid,
		PlaySolid,
		RefreshOutline,
		CheckOutline,
		ClipboardCleanSolid,
		MessageDotsOutline,
		CalendarWeekSolid
	} from 'flowbite-svelte-icons';
	import {
		formatTimeAgo,
		formatDuration,
		formatDate,
		getRolloutStatus,
		isFieldManagedByManager,
		isFieldManagedByOtherManager,
		hasBypassGatesAnnotation,
		getBypassGatesVersion,
		getForceDeployVersion,
		hasForceDeployAnnotation,
		isVersionForceDeploying,
		isVersionBypassingGates,
		hasFailedBakeStatus,
		hasUnblockFailedAnnotation
	} from '$lib/utils';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import { fly } from 'svelte/transition';

	let rollout: Rollout | null = null;
	let kustomizations: Kustomization[] = [];
	let ociRepositories: OCIRepository[] = [];
	let rolloutGates: any[] = [];
	let managedResources: Record<string, ManagedResourceStatus[]> = {};
	let healthChecks: HealthCheck[] = [];
	let loading = true;
	let hasLoaded = false;
	let error: string | null = null;

	let annotations: Record<string, Record<string, string>> = {};
	let loadingAnnotations: Record<string, boolean> = {};

	let showPinModal = false;
	let showClearPinModal = false;
	let selectedVersion: string | null = null;

	let showToast = false;
	let toastMessage = '';
	let toastType: 'success' | 'error' = 'success';

	let showRollbackModal = false;
	let rollbackVersion: string | null = null;

	let showResumeRolloutModal = false;
	let showMarkSuccessfulModal = false;
	let markSuccessfulMessage = '';

	// New variables for deploy modal
	let showDeployModal = false;
	let pinVersionToggle = false;
	let deployExplanation = '';
	let deployConfirmationVersion = '';

	// New variables for pin version mode
	let isPinVersionMode = false;

	// Drawer state
	let showTimelineDrawer = false;

	let autoRefreshIntervalId: number | null = null;

	// Toggle for showing/hiding "current" resources
	let showAlwaysReadyResources = false;

	// Pagination variables
	let currentPage = 1;
	let itemsPerPage = 10;

	// New variables for all repository tags
	let allRepositoryTags: string[] = [];
	let loadingAllTags = false;
	let searchQuery = '';
	let showAllTags = false;
	let clipboardValue = '';

	// Function to get gate description from gate annotations
	function getGateDescription(gate: any): string | null {
		// Look for gate description in the gate's own annotations
		return gate.metadata?.annotations?.['gate.kuberik.com/description'] || null;
	}

	// Function to get gate pretty name from gate annotations
	function getGatePrettyName(gate: any): string | null {
		// Look for gate pretty name in the gate's own annotations
		return gate.metadata?.annotations?.['gate.kuberik.com/pretty-name'] || null;
	}

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

	// Computed property to determine if rollout has an actively pinned version
	$: hasActivelyPinnedVersion = rollout?.spec?.wantedVersion !== undefined;

	// Computed property to determine if pin version toggle should be disabled
	$: isPinVersionToggleDisabled = hasActivelyPinnedVersion;

	// Update pinVersionToggle when rollout state changes
	$: pinVersionToggle = hasActivelyPinnedVersion;

	// Computed property to determine if current version is custom (not in available releases)
	$: isCurrentVersionCustom = (() => {
		if (!rollout?.status?.history?.[0] || !rollout?.status?.availableReleases) return false;
		const currentVersionTag = rollout.status.history[0].version.tag;
		return !rollout.status.availableReleases.some((ar) => ar.tag === currentVersionTag);
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

	// Computed properties for all tags filtering and display
	$: filteredAllTags = allRepositoryTags.filter((tag) =>
		tag.toLowerCase().includes(searchQuery.toLowerCase())
	);
	$: nonStandardTags = allRepositoryTags.filter(
		(tag) => !rollout?.status?.availableReleases?.map((ar) => ar.tag).includes(tag)
	);
	$: filteredNonStandardTags = nonStandardTags.filter((tag) =>
		tag.toLowerCase().includes(searchQuery.toLowerCase())
	);

	// Unified list of all versions for display
	$: allVersionsForDisplay = (() => {
		const availableReleases = rollout?.status?.availableReleases;
		if (!availableReleases) return [];

		// Start with available releases (standard releases)
		const standardReleases = [...availableReleases].reverse();

		// Add additional tags that are not in available releases
		const additionalTags = allRepositoryTags.filter(
			(tag) => !availableReleases.map((ar) => ar.tag).includes(tag)
		);

		// Combine: standard releases first, then additional tags
		return [...standardReleases, ...additionalTags];
	})();

	// Filter the unified list based on search
	$: filteredVersionsForDisplay = allVersionsForDisplay.filter((version) => {
		const versionTag = typeof version === 'string' ? version : version.tag;
		return searchQuery === '' || versionTag.toLowerCase().includes(searchQuery.toLowerCase());
	});

	// Pagination for the unified list
	$: totalUnifiedPages = Math.ceil(filteredVersionsForDisplay.length / itemsPerPage);
	$: paginatedUnifiedVersions = filteredVersionsForDisplay.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	);

	// Computed property to filter managed resources based on toggle state
	$: filteredManagedResources = (() => {
		const filtered: Record<string, ManagedResourceStatus[]> = {};

		for (const [kustomizationName, resources] of Object.entries(managedResources)) {
			if (showAlwaysReadyResources) {
				// Show all resources when toggle is on
				filtered[kustomizationName] = resources;
			} else {
				// Hide resources with "resource is current" or "Resource is always ready" messages
				filtered[kustomizationName] = resources.filter((resource) => {
					const hasCurrentMessage = resource.message?.toLowerCase().includes('resource is current');
					const hasAlwaysReadyMessage = resource.message
						?.toLowerCase()
						.includes('resource is always ready');
					return !hasCurrentMessage && !hasAlwaysReadyMessage;
				});
			}
		}

		return filtered;
	})();

	function goToPage(page: number) {
		const maxPages = showAllTags ? totalUnifiedPages : totalPages;
		if (page >= 1 && page <= maxPages) {
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
			rolloutGates = data.rolloutGates?.items || [];
			console.log('Rollout gates fetched:', rolloutGates);
			console.log('Rollout status gates:', rollout?.status?.gates);

			// if (rollout?.status?.history) {
			// 	// Only fetch annotations for release candidates (custom releases)
			// 	// Regular releases will use .revisions and .version fields from availableReleases
			// 	if (rollout.status.releaseCandidates) {
			// 		const releaseCandidateVersions = rollout.status.releaseCandidates.map((rc) => rc.tag);
			// 		const annotationPromises = releaseCandidateVersions
			// 			.filter((version) => !annotations[version])
			// 			.map((version) => getAnnotations(version));
			// 		await Promise.all(annotationPromises);
			// 	}
			// }

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

			// Fetch health checks that match the rollout's health selector
			if (rollout?.spec?.healthCheckSelector) {
				try {
					const healthChecksResponse = await fetch(
						`/api/rollouts/${$page.params.namespace}/${$page.params.name}/health-checks`
					);
					if (healthChecksResponse.ok) {
						const healthChecksData = await healthChecksResponse.json();
						healthChecks = healthChecksData.healthChecks || [];

						// Log namespace search information
						if (healthChecksData.debug) {
							console.log('Health checks search info:', healthChecksData.debug);
						}
					}
				} catch (e) {
					console.error('Failed to fetch health checks:', e);
				}
			}

			// Clear any previous error on successful fetch
			error = null;
		} catch (e) {
			// Only set error on initial load, preserve stale data on subsequent failed fetches
			if (!hasLoaded) {
				error = e instanceof Error ? e.message : 'Unknown error occurred';
			} else {
				// Log the error but don't show it to the user to preserve stale data
				console.error('Failed to fetch rollout data (preserving stale data):', e);
			}
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
					body: JSON.stringify({
						version: pinVersion,
						explanation: deployExplanation
					})
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
					if (rollout?.status?.history?.[0]?.version.tag === pinVersion) {
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

	async function getAnnotations(version: string) {
		if (!rollout) return;
		loadingAnnotations[version] = true;
		loadingAnnotations = { ...loadingAnnotations };
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
		} finally {
			loadingAnnotations[version] = false;
			loadingAnnotations = { ...loadingAnnotations };
		}
	}

	// Helper function to get display version from version object or annotations
	function getDisplayVersion(versionInfo: {
		version?: string;
		revision?: string;
		tag: string;
	}): string {
		return versionInfo.version || versionInfo.revision || versionInfo.tag;
	}

	// Helper function to get revision information from version object or annotations
	function getRevisionInfo(versionInfo: { revision?: string; tag: string }): string | undefined {
		return versionInfo.revision;
	}

	// Function to load annotations on demand for custom releases when displayed
	async function loadAnnotationsOnDemand(versionTag: string): Promise<void> {
		// Only load if not already loaded and this is not a regular release in history
		const historyEntry = rollout?.status?.history?.find(
			(entry) => entry.version.tag === versionTag
		);
		if (!historyEntry && !annotations[versionTag]) {
			await getAnnotations(versionTag);
		}
	}

	async function getAllRepositoryTags() {
		if (!rollout) return;
		loadingAllTags = true;
		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/tags`
			);
			if (response.ok) {
				const data = await response.json();
				allRepositoryTags = data.tags || [];
			} else {
				allRepositoryTags = [];
			}
		} catch (e) {
			console.error('Failed to fetch repository tags:', e);
			allRepositoryTags = [];
		} finally {
			loadingAllTags = false;
		}
	}

	async function resumeRollout() {
		if (!rollout) return;

		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/unblock-failed`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					}
				}
			);

			if (!response.ok) {
				throw new Error('Failed to add unblock-failed annotation');
			}

			await updateData();
			showToast = true;
			toastMessage = 'Rollout resumed successfully';
			toastType = 'success';
			showResumeRolloutModal = false;
			selectedVersion = null;

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			console.error('Failed to resume rollout:', e);
			showToast = true;
			toastMessage = e instanceof Error ? e.message : 'Failed to resume rollout';
			toastType = 'error';

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}

	async function markDeploymentSuccessful(message: string) {
		if (!rollout) return;

		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/mark-successful`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ message })
				}
			);

			if (!response.ok) {
				throw new Error('Failed to mark deployment as successful');
			}

			await updateData();
			showToast = true;
			toastMessage = 'Deployment marked as successful';
			toastType = 'success';
			showMarkSuccessfulModal = false;

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			console.error('Failed to mark deployment as successful:', e);
			showToast = true;
			toastMessage = e instanceof Error ? e.message : 'Failed to mark deployment as successful';
			toastType = 'error';

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}

	async function reconcileFluxResources() {
		if (!rollout) return;

		// Add spinning animation to the icon
		const icon = document.getElementById('reconcile-icon');
		if (icon) {
			icon.classList.add('animate-spin');
			// Remove the spinning class after animation completes
			setTimeout(() => {
				icon.classList.remove('animate-spin');
			}, 1000);
		}

		// Show immediate notification that reconciliation is starting
		showToast = true;
		toastMessage = 'Starting reconciliation of Flux resources...';
		toastType = 'success';

		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/reconcile`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					}
				}
			);

			if (!response.ok) {
				throw new Error('Failed to reconcile Flux resources');
			}

			// Show success toast
			showToast = true;
			toastMessage = 'Successfully triggered reconciliation of all associated Flux resources';
			toastType = 'success';

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			console.error('Failed to reconcile Flux resources:', e);
			showToast = true;
			toastMessage = e instanceof Error ? e.message : 'Failed to reconcile Flux resources';
			toastType = 'error';

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}

	async function handleDeploy() {
		if (!rollout || !selectedVersion) return;

		try {
			if (pinVersionToggle) {
				// Use pin version functionality
				const response = await fetch(
					`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/pin`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							version: selectedVersion,
							explanation: deployExplanation
						})
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
						if (rollout?.status?.history?.[0]?.version.tag === selectedVersion) {
							break;
						}
					}
				}, 1000);

				// Show success toast
				toastType = 'success';
				toastMessage = `Successfully pinned and deployed version`;
			} else {
				// Use force deploy functionality
				const response = await fetch(
					`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/force-deploy`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							version: selectedVersion,
							message: deployExplanation
						})
					}
				);

				if (!response.ok) {
					throw new Error('Failed to add force-deploy annotation');
				}

				await updateData();
				toastType = 'success';
				toastMessage = `Force deploy initiated, version rolling out soon`;
			}

			showToast = true;
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			// Show error toast
			toastType = 'error';
			toastMessage = e instanceof Error ? e.message : 'Failed to deploy version';
			showToast = true;
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} finally {
			showDeployModal = false;
			selectedVersion = null;
			pinVersionToggle = false;
			deployExplanation = '';
			deployConfirmationVersion = '';
			isPinVersionMode = false;
			showTimelineDrawer = false;
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

	function parseDuration(duration: string): number {
		// Parse Kubernetes duration format (e.g., "5m", "30s", "1h")
		const match = duration.match(/^(\d+)([smhd])$/);
		if (!match) return 0;

		const value = parseInt(match[1]);
		const unit = match[2];

		switch (unit) {
			case 's':
				return value * 1000;
			case 'm':
				return value * 60 * 1000;
			case 'h':
				return value * 60 * 60 * 1000;
			case 'd':
				return value * 24 * 60 * 60 * 1000;
			default:
				return 0;
		}
	}

	function formatDurationFromMs(milliseconds: number): string {
		if (milliseconds <= 0) return '0s';

		const seconds = Math.floor(milliseconds / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) {
			return `${days}d ${hours % 24}h`;
		} else if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		} else {
			return `${seconds}s`;
		}
	}

	function getResourceStatus(resource: Kustomization | OCIRepository) {
		const readyCondition = resource.status?.conditions?.find((c) => c.type === 'Ready');
		if (!readyCondition) return { status: 'Unknown', color: 'gray' as const };

		switch (readyCondition.status) {
			case 'True':
				return { status: 'Ready', color: 'green' as const };
			case 'False':
				return { status: 'Failed', color: 'red' as const };
			default:
				return { status: 'Unknown', color: 'gray' as const };
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

	async function continueRollout(rolloutName: string, namespace: string) {
		try {
			const response = await fetch(`/api/rollouts/${namespace}/${rolloutName}/continue`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					currentStepState: 'StepReady'
				})
			});

			if (!response.ok) {
				throw new Error('Failed to continue rollout');
			}

			showToast = true;
			toastMessage = `Successfully continued rollout ${rolloutName}`;
			toastType = 'success';

			// Auto-hide toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);

			// Refresh the rollout data
			await updateData();
		} catch (error) {
			console.error('Continue rollout error:', error);
			showToast = true;
			toastMessage = `Failed to continue rollout: ${error instanceof Error ? error.message : 'Unknown error'}`;
			toastType = 'error';

			// Auto-hide toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}
</script>

<svelte:head>
	<title
		>kuberik | {rollout?.metadata
			? `${rollout.metadata.name} (${rollout.metadata.namespace})`
			: 'Rollout'}</title
	>
</svelte:head>

<div class="w-full dark:bg-gray-900">
	{#if loading}
		<div class="space-y-4 p-4">
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
		<!-- Main Layout: Full width content with drawer toggle -->
		<div class="flex h-full flex-col">
			<!-- Header with Timeline Toggle -->
			<div
				class="flex-shrink-0 border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
			>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-4">
						<h2 class="text-2xl font-bold text-gray-900 dark:text-white">
							<span class="text-gray-500 dark:text-gray-400">{rollout.metadata?.namespace} / </span>
							{rollout.metadata?.name}
						</h2>
						<div class="flex items-center gap-2">
							<Badge color={getRolloutStatus(rollout).color}>
								{getRolloutStatus(rollout).text}
							</Badge>
							<Badge color="blue">
								{#if rollout?.status?.history?.[0]}
									{getDisplayVersion(rollout.status.history[0].version)}
								{:else}
									Unknown
								{/if}
							</Badge>
							{#if rollout.spec?.wantedVersion}
								<Badge>Pinned</Badge>
							{/if}
							{#if hasUnblockFailedAnnotation(rollout)}
								<Badge color="green">Resumed</Badge>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-2">
						<Button size="sm" color="light" onclick={() => (showTimelineDrawer = true)}>
							<ClockArrowOutline class="me-2 h-4 w-4" />
							Rollout History
						</Button>
						<Button
							size="sm"
							color="light"
							disabled={!isDashboardManagingWantedVersion}
							onclick={() => {
								if (isDashboardManagingWantedVersion) {
									isPinVersionMode = true;
									showPinModal = true;
								}
							}}
						>
							<EditOutline class="me-2 h-4 w-4" />
							Pin Version
						</Button>
						{#if !isDashboardManagingWantedVersion}
							<Tooltip placement="bottom"
								>Version management disabled: This rollout's wantedVersion field is managed by
								another controller or external system. The dashboard cannot pin it to prevent
								conflicts.</Tooltip
							>
						{/if}
						{#if rollout.spec?.wantedVersion}
							<Button
								size="sm"
								color="light"
								disabled={!isDashboardManagingWantedVersion}
								onclick={() => {
									if (isDashboardManagingWantedVersion) {
										showClearPinModal = true;
									}
								}}
							>
								<CloseOutline class="me-2 h-4 w-4" />
								Clear Pin
							</Button>
							{#if !isDashboardManagingWantedVersion}
								<Tooltip placement="bottom"
									>Version management disabled: This rollout's wantedVersion field is managed by
									another controller or external system. The dashboard cannot pin it to prevent
									conflicts.</Tooltip
								>
							{/if}
						{/if}
					</div>
				</div>
			</div>

			<!-- Main Content Area -->
			<div class="flex-1 overflow-y-auto p-4">
				<!-- Failed Deployment Alert -->
				{#if rollout && hasFailedBakeStatus(rollout) && !hasUnblockFailedAnnotation(rollout)}
					<Alert color="gray" class="border-1 mb-6 border-red-600 dark:border-red-400">
						<div class="flex items-center gap-3">
							<ExclamationCircleSolid class="h-5 w-5 text-red-600 dark:text-red-400" />
							<span class="text-lg font-medium text-red-600 dark:text-red-400"
								>Deployment Failed</span
							>
						</div>
						<p class="mb-4 mt-2 text-sm">
							The latest deployment has failed. You can resume the rollout, mark it as successful,
							or deploy another version to fix the issue.
						</p>
						<div class="flex gap-2">
							<Button
								size="xs"
								color="light"
								onclick={() => {
									selectedVersion = rollout?.status?.history?.[0]?.version.tag || null;
									showResumeRolloutModal = true;
								}}
							>
								<PlaySolid class="me-2 h-4 w-4" />
								Resume Rollout
							</Button>
							<Button
								size="xs"
								outline
								color="light"
								onclick={() => {
									selectedVersion = rollout?.status?.history?.[0]?.version.tag || null;
									showMarkSuccessfulModal = true;
								}}
							>
								<CheckCircleSolid class="me-2 h-4 w-4" />
								Mark Successful
							</Button>
						</div>
					</Alert>
				{/if}

				<!-- Latest Deployment Display -->
				{#if rollout.status?.history?.[0]}
					{@const latestEntry = rollout.status.history[0]}
					<div class="mb-6">
						<h3 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">Current Version</h3>
						<div class="mb-4 flex items-center gap-3">
							{#if latestEntry.bakeStatus === 'InProgress'}
								<Spinner color="yellow" class="h-8 w-8" />
							{:else}
								<svelte:component
									this={getBakeStatusIcon(latestEntry.bakeStatus).icon}
									class="h-8 w-8 {getBakeStatusIcon(latestEntry.bakeStatus).color}"
								/>
							{/if}
							<div>
								<h3 class="text-lg font-semibold text-gray-900 dark:text-white">
									{getDisplayVersion(latestEntry.version)}
									{#if getRevisionInfo(latestEntry.version)}
										<Badge color="blue" class="ml-2 text-xs">
											{formatRevision(getRevisionInfo(latestEntry.version)!)}
										</Badge>
									{/if}
									{#if isCurrentVersionCustom}
										<Badge color="yellow" class="ml-2 text-xs">Custom</Badge>
									{/if}
								</h3>

								<div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
									<ClockSolid class="h-4 w-4" />
									<span>Deployed {formatTimeAgo(latestEntry.timestamp, $now)}</span>
								</div>
								{#if latestEntry.bakeStatus === 'InProgress' && rollout.spec?.minBakeTime}
									{@const deploymentTime = new Date(latestEntry.timestamp).getTime()}
									{@const currentTime = $now.getTime()}
									{@const elapsedTime = currentTime - deploymentTime}
									{@const minBakeTimeMs = parseDuration(rollout.spec.minBakeTime)}
									{@const maxBakeTimeMs = rollout.spec.maxBakeTime
										? parseDuration(rollout.spec.maxBakeTime)
										: null}
									{#if elapsedTime < minBakeTimeMs}
										{@const remainingTime = minBakeTimeMs - elapsedTime}
										<div class="mt-1 text-sm text-blue-600 dark:text-blue-400">
											Waiting to mark the deployment as successful for at least {formatDurationFromMs(
												remainingTime
											)}
										</div>
									{:else if maxBakeTimeMs}
										{@const timeoutTime = deploymentTime + maxBakeTimeMs}
										{@const timeUntilTimeout = timeoutTime - currentTime}
										<div class="mt-1 text-sm text-orange-600 dark:text-orange-400">
											Will mark deployment as failed if health checks don't pass in {formatDurationFromMs(
												Math.max(timeUntilTimeout, 0)
											)}
										</div>
									{:else}
										<div class="mt-1 text-sm text-blue-600 dark:text-blue-400">
											Waiting for health checks to pass...
										</div>
									{/if}
								{:else if latestEntry.bakeStatus === 'Succeeded' && latestEntry.bakeStartTime && latestEntry.bakeEndTime}
									<div class="mt-1 text-sm text-green-600 dark:text-green-400">
										Deployment completed successfully in {formatDuration(
											latestEntry.bakeStartTime,
											new Date(latestEntry.bakeEndTime)
										)}
									</div>
								{:else if latestEntry.bakeStatus === 'Failed' && latestEntry.bakeStartTime && latestEntry.bakeEndTime}
									<div class="mt-1 text-sm text-red-600 dark:text-red-400">
										Deployment failed after {formatDuration(
											latestEntry.bakeStartTime,
											new Date(latestEntry.bakeEndTime)
										)}
									</div>
								{/if}
							</div>
						</div>

						{#if latestEntry.message}
							<div class="mb-3">
								<div class="flex items-start gap-2">
									<MessageDotsOutline class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
									<p class="text-sm italic text-gray-600 dark:text-gray-400">
										{latestEntry.message}
									</p>
								</div>
							</div>
						{/if}

						<!-- Action Buttons Row -->
						<div class="flex flex-wrap gap-2">
							{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
								<SourceViewer
									namespace={rollout.metadata?.namespace || ''}
									name={rollout.metadata?.name || ''}
									version={latestEntry.version.tag}
								/>
							{/if}
							{#if rollout?.status?.source}
								<GitHubViewButton
									sourceUrl={rollout.status.source}
									version={getDisplayVersion(latestEntry.version)}
									size="sm"
									color="light"
								/>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Health Checks Section -->
				{#if rollout.spec?.healthCheckSelector || healthChecks.length > 0}
					<div class="mb-6">
						<h4 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">Health Checks</h4>

						{#if healthChecks.length > 0}
							<div class="space-y-2">
								{#each healthChecks as healthCheck ((healthCheck.metadata?.name, healthCheck.metadata?.namespace))}
									<Card class="w-full min-w-full max-w-none overflow-hidden p-3">
										<div class="flex items-center justify-between gap-4">
											<!-- Left side: Status Icon + Status Badge + Name + Message -->
											<div class="flex min-w-0 flex-1 items-center gap-4">
												<!-- Status Icon and Status Badge -->
												<div class="flex flex-shrink-0 items-center gap-2">
													<div class="flex h-6 w-6 items-center justify-center">
														{#if healthCheck.status?.status === 'Healthy'}
															<CheckCircleSolid
																class="h-5 w-5 text-green-600 dark:text-green-400"
															/>
														{:else if healthCheck.status?.status === 'Unhealthy'}
															<ExclamationCircleSolid
																class="h-5 w-5 text-red-600 dark:text-red-400"
															/>
														{:else if healthCheck.status?.status === 'Pending'}
															<Spinner size="5" color="yellow" />
														{:else}
															<ExclamationCircleSolid
																class="h-5 w-5 text-gray-500 dark:text-gray-400"
															/>
														{/if}
													</div>
													<!-- Status Badge -->
													<Badge
														color={healthCheck.status?.status === 'Healthy'
															? 'green'
															: healthCheck.status?.status === 'Unhealthy'
																? 'red'
																: 'yellow'}
														size="small"
													>
														{healthCheck.status?.status || 'Unknown'}
													</Badge>
												</div>

												<!-- Name -->
												<div class="min-w-0">
													<p class="text-sm font-medium text-gray-900 dark:text-white">
														{healthCheck.metadata?.annotations?.['kuberik.com/display-name'] ||
															healthCheck.metadata?.name}
													</p>
												</div>

												<!-- Separator -->
												{#if healthCheck.status?.message}
													<div class="flex-shrink-0 text-gray-400 dark:text-gray-500">—</div>
												{/if}

												<!-- Message -->
												{#if healthCheck.status?.message}
													<div class="min-w-0 flex-1">
														<p class="truncate text-xs text-gray-600 dark:text-gray-400">
															{healthCheck.status.message}
														</p>
													</div>
												{/if}

												<!-- Last Error Time -->
												{#if healthCheck.status?.lastErrorTime && healthCheck.status?.status === 'Unhealthy'}
													<div class="flex-shrink-0 text-xs text-red-600 dark:text-red-400">
														Last Error: {formatTimeAgo(healthCheck.status.lastErrorTime, $now)}
													</div>
												{/if}
											</div>

											<!-- Right side: Class Badge -->
											<div class="flex-shrink-0">
												<Badge color="gray" size="small">
													{healthCheck.spec?.class
														? healthCheck.spec.class.charAt(0).toUpperCase() +
															healthCheck.spec.class.slice(1)
														: 'Unknown'}
												</Badge>
											</div>
										</div>
									</Card>
								{/each}
							</div>
						{:else if rollout.spec?.healthCheckSelector}
							<Alert color="blue">
								{#snippet icon()}<InfoCircleSolid class="h-5 w-5" />{/snippet}
								No health checks were found that match the configured selector.
							</Alert>
						{:else}
							<Alert color="blue" class="mb-4">
								<div class="flex items-center">
									<ExclamationCircleSolid class="mr-2 h-5 w-5" />
									<span class="font-medium">No Health Check Selector Configured</span>
								</div>
								<p class="mt-2 text-sm">
									This rollout doesn't have a health check selector configured. Health checks can be
									used to validate deployment success.
								</p>
							</Alert>
						{/if}
					</div>
				{/if}

				<!-- OpenKruise Rollout Progress Section -->
				{#if managedResources && Object.keys(managedResources).length > 0}
					{@const openKruiseRollouts = Object.values(managedResources)
						.flat()
						.filter(
							(resource) => resource.groupVersionKind === 'rollouts.kruise.io/v1beta1/Rollout'
						)}
					{#if openKruiseRollouts.length > 0}
						<div class="mb-6">
							<div>
								<h4 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">
									OpenKruise Rollout Progress
								</h4>
								<div class="auto-fill-grid grid gap-4">
									{#each openKruiseRollouts as rolloutResource}
										{@const kruiseRollout = rolloutResource.object as KruiseRollout}
										{@const rolloutData = kruiseRollout?.status?.canaryStatus}
										{@const canarySteps = kruiseRollout?.spec?.strategy?.canary?.steps}
										{#if rolloutData && canarySteps && canarySteps.length > 0}
											<Card class="w-full min-w-full max-w-none overflow-hidden p-2 sm:p-4 md:p-6">
												<div class="mb-3 flex items-center justify-between">
													<div class="min-w-0 flex-1">
														<div class="my-1 flex items-center space-x-2">
															<p class="truncate text-sm font-medium text-gray-900 dark:text-white">
																{#if rolloutResource.namespace}
																	<span class="text-gray-500 dark:text-gray-400">
																		{rolloutResource.namespace} /
																	</span>
																{/if}
																{rolloutResource.name}
															</p>
														</div>
													</div>
													{#if rolloutData.currentStepState !== 'Completed'}
														<Button
															size="sm"
															color="blue"
															disabled={rolloutData.currentStepState !== 'StepPaused'}
															onclick={() =>
																continueRollout(rolloutResource.name, rolloutResource.namespace)}
														>
															{#if rolloutData.currentStepState !== 'StepPaused'}
																<Spinner
																	class="mr-2 inline-block h-4 w-4 align-middle"
																	color="blue"
																/>
															{/if}
															{rolloutData.currentStepState === 'StepPaused'
																? 'Continue Rollout'
																: 'Rolling out…'}
														</Button>
													{/if}
												</div>

												<div class="mb-3">
													<StepIndicator
														glow
														currentStep={(rolloutData.currentStepIndex || 1) +
															(rolloutData.currentStepState === 'Completed' ? 1 : 0)}
														steps={canarySteps.map((step: any, index: number) =>
															index === canarySteps.length - 1 &&
															rolloutData.currentStepState === 'Completed'
																? 'Completed'
																: `Step ${index + 1}`
														)}
														color="blue"
														size="sm"
													/>
												</div>
											</Card>
										{/if}
									{/each}
								</div>
							</div>
						</div>
					{/if}
				{/if}

				<div class="mb-6">
					<h4 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">
						Available version upgrades
					</h4>
					{#if rollout.status?.releaseCandidates && rollout.status.releaseCandidates.length > 0}
						<div class="auto-fill-grid grid gap-4">
							{#each rollout.status.releaseCandidates as releaseCandidate}
								{@const version = releaseCandidate.tag}
								<Card class="w-full min-w-full max-w-none overflow-hidden p-2 sm:p-4 md:p-6">
									<div class="mb-3 w-full">
										<div class="mb-2 flex w-full items-start justify-between gap-2">
											<h6
												class="min-w-0 flex-1 break-all font-medium text-gray-900 dark:text-white"
											>
												{getDisplayVersion(releaseCandidate)}
											</h6>
											{#if isVersionForceDeploying(rollout, version)}
												<Badge color="blue" class="flex-shrink-0 text-xs">Gates Skipped</Badge>
											{:else if rollout.status?.gatedReleaseCandidates
												?.map((grc) => grc.tag)
												.includes(version)}
												<Badge color="green" class="flex-shrink-0 text-xs">Available</Badge>
											{:else}
												<Badge color="yellow" class="flex-shrink-0 text-xs">Blocked</Badge>
											{/if}
										</div>

										{#if releaseCandidate.version && releaseCandidate.version !== version}
											<div class="mb-2">
												<Badge color="gray" class="break-all font-mono text-xs">
													{version}
												</Badge>
											</div>
										{/if}
										{#if releaseCandidate.created}
											<div class="text-xs text-gray-500 dark:text-gray-500">
												<div class="mb-1">
													Created: {formatDate(releaseCandidate.created)}
												</div>
												<Badge color="gray" border>
													<ClockSolid class="me-1.5 h-2.5 w-2.5" />
													{formatTimeAgo(releaseCandidate.created, $now)}
												</Badge>
											</div>
										{/if}
									</div>
									{#if rollout.status?.gates && rollout.status.gates.length > 0}
										<div
											class="relative mt-4 rounded-lg border border-gray-300 p-4 dark:border-gray-600"
										>
											<div
												class="absolute -top-2 left-3 bg-white px-2 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
											>
												Gates
											</div>
											<div class="space-y-2">
												{#each rollout.status.gates as gateStatus}
													{@const fullGate = rolloutGates.find(
														(g) => g.metadata.name === gateStatus.name
													)}
													<div class="flex items-center justify-between text-xs">
														{#if isVersionForceDeploying(rollout, version)}
															<Badge color="blue" class="text-xs">
																<CodePullRequestSolid class="mr-1 h-3 w-3" />
																{getGatePrettyName(fullGate) || gateStatus.name} (Skipped)
															</Badge>
														{:else if gateStatus.allowedVersions?.includes(version)}
															<Badge color="green" class="text-xs">
																<CheckCircleSolid class="mr-1 h-3 w-3" />
																{getGatePrettyName(fullGate) || gateStatus.name}
															</Badge>
														{:else}
															<Badge
																id="gate-{gateStatus.name}"
																color="red"
																class="cursor-help text-xs"
															>
																<ExclamationCircleSolid class="mr-1 h-3 w-3" />
																{getGatePrettyName(fullGate) || gateStatus.name}
															</Badge>
															<Tooltip
																triggeredBy="#gate-{gateStatus.name}"
																placement="top"
																class="max-w-xs"
															>
																<div class="space-y-2">
																	{#if gateStatus.message}
																		<div class="text-sm">
																			{gateStatus.message}
																		</div>
																	{/if}
																	{#if getGateDescription(fullGate)}
																		<div class="text-xs text-gray-500 dark:text-gray-400">
																			{getGateDescription(fullGate)}
																		</div>
																	{/if}
																</div>
															</Tooltip>
														{/if}
													</div>
												{/each}
											</div>
										</div>
									{/if}

									<div class="space-y-2 pt-3 dark:border-gray-700">
										<Button
											size="xs"
											color="blue"
											disabled={!isDashboardManagingWantedVersion &&
												!hasForceDeployAnnotation(rollout)}
											onclick={() => {
												selectedVersion = version;
												showDeployModal = true;
											}}
											class=""
										>
											Deploy
										</Button>
										{#if !isDashboardManagingWantedVersion && !hasBypassGatesAnnotation(rollout)}
											<Tooltip placement="top" class="">
												Deploy disabled: Version management is disabled and gates are already
												bypassed.
											</Tooltip>
										{:else if !isDashboardManagingWantedVersion}
											<Tooltip placement="top" class="">
												Version management disabled: This rollout's wantedVersion field is managed
												by another controller or external system. Only force deploy is available.
											</Tooltip>
										{:else if hasForceDeployAnnotation(rollout)}
											<Tooltip placement="top" class="">
												Force deploy already set: Only version pinning is available.
											</Tooltip>
										{/if}

										{#if loadingAnnotations[version]}
											<div
												class="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
											></div>
										{:else if rollout?.status?.source}
											<GitHubViewButton
												sourceUrl={rollout.status.source}
												version={getDisplayVersion(releaseCandidate)}
												size="xs"
												color="light"
											/>
										{/if}

										<Clipboard bind:value={releaseCandidate.tag} size="xs" color="light" class="">
											{#snippet children(success)}
												{#if success}
													<CheckOutline class="mr-1 h-3 w-3" />
													Copied
												{:else}
													<ClipboardCleanSolid class="mr-1 h-3 w-3" />
													Copy Tag
												{/if}
											{/snippet}
										</Clipboard>
									</div>
								</Card>
							{/each}
						</div>
					{:else if isCurrentVersionCustom}
						<Alert color="yellow" class="mb-4">
							<div class="flex items-center gap-3">
								<InfoCircleSolid class="h-5 w-5" />
								<span class="text-lg font-medium">Current version is custom</span>
							</div>
							<p class="mb-4 mt-2 text-sm">
								The currently deployed version is not in the available releases list. This means
								it's a custom version that was manually deployed. To change to a different version,
								you need to manually deploy another version.
							</p>
							<div class="flex gap-2">
								<Button
									size="xs"
									color="light"
									onclick={() => {
										isPinVersionMode = true;
										showPinModal = true;
									}}
								>
									<EditOutline class="me-2 h-4 w-4" />
									Change Version
								</Button>
							</div>
						</Alert>
					{:else}
						<Alert color="blue" class="mb-4">
							<div class="flex items-center">
								<ExclamationCircleSolid class="mr-2 h-5 w-5" />
								<span class="font-medium">No version upgrades available</span>
							</div>
						</Alert>
					{/if}
				</div>

				{#if kustomizations.length > 0 || ociRepositories.length > 0}
					<div class="mb-6">
						<div class="mb-4">
							<h4 class="text-lg font-medium text-gray-900 dark:text-white">
								Associated Resources
							</h4>
							<div class="mb-4 mt-3">
								<Button
									size="sm"
									color="blue"
									onclick={reconcileFluxResources}
									class="flex items-center gap-2"
								>
									<RefreshOutline class="h-4 w-4" id="reconcile-icon" />
									Reconcile Flux Resources
								</Button>
							</div>
						</div>

						{#if kustomizations.length > 0}
							<div class="mb-4">
								<h5
									class="text-md mb-2 flex items-center font-medium text-gray-700 dark:text-gray-300"
								>
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
													{#if kustomization.spec?.suspend}
														<Badge color="yellow" border>
															<PauseSolid class="me-1.5 h-2.5 w-2.5" />
															Suspended
														</Badge>
													{/if}
													{#if getLastTransitionTime(kustomization)}
														<Badge color="gray" border>
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
													<div class="mb-2 flex items-center justify-between">
														<h7 class="block text-sm font-medium text-gray-700 dark:text-gray-300">
															Managed Resources ({filteredManagedResources[
																kustomization.metadata?.name || ''
															]?.length || 0})
														</h7>
														<div class="mb-1 ml-4 mr-1">
															<Toggle bind:checked={showAlwaysReadyResources} color="blue">
																Show All
															</Toggle>
														</div>
													</div>
													{#if filteredManagedResources[kustomization.metadata?.name || '']?.length > 0}
														<div class="auto-fill-grid-compact grid gap-4">
															{#each filteredManagedResources[kustomization.metadata?.name || ''] as resource (resource.groupVersionKind + '/' + (resource.namespace || '') + '/' + resource.name)}
																<Card
																	class="w-full min-w-full max-w-none overflow-hidden p-2 sm:p-4 md:p-6"
																>
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
																				{resource.groupVersionKind.split('/').pop() ||
																					resource.groupVersionKind}
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
																			{#if resource.lastModified}
																				<div
																					class="mt-2 flex items-center text-xs text-gray-500 dark:text-gray-400"
																				>
																					<ClockSolid class="mr-1 h-3 w-3" />
																					Last modified: {formatTimeAgo(
																						resource.lastModified,
																						$now
																					)}
																				</div>
																			{/if}
																		</div>
																	</div>
																</Card>
															{/each}
														</div>
													{:else}
														<Alert color="blue" class="text-sm">
															<InfoCircleSolid class="h-4 w-4" />
															<span
																>All managed resources have "resource is current" or "Resource is
																always ready" status messages. Use the toggle above to view them.</span
															>
														</Alert>
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}

						{#if ociRepositories.length > 0}
							<div class="mb-4">
								<h5
									class="text-md mb-2 flex items-center font-medium text-gray-700 dark:text-gray-300"
								>
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
														<Badge color="gray" border>
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
			</div>
		</div>

		<!-- Timeline Drawer -->
		<Drawer
			bind:open={showTimelineDrawer}
			placement="right"
			class="z-4 w-min min-w-0 overflow-hidden"
		>
			<div class="flex h-full w-full min-w-0 flex-col">
				<div class="flex-shrink-0 border-b border-gray-200 p-4 dark:border-gray-700">
					<div class="flex items-center justify-between">
						<h4 class="text-lg font-medium text-gray-900 dark:text-white">Rollout History</h4>
					</div>
				</div>
				<div class="w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-0">
					{#if rollout.status?.history}
						<Timeline order="vertical" class="w-full min-w-0">
							{#each rollout.status.history as entry, i ((entry.version.tag, i))}
								<TimelineItem
									h3Class="font-mono"
									liClass="mr-4 flex flex-col"
									title={getDisplayVersion(entry.version)}
									date="Deployed {formatTimeAgo(entry.timestamp, $now)}"
								>
									{#snippet orientationSlot()}
										<span
											class="absolute -start-3 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-8 ring-white dark:bg-gray-800 dark:ring-gray-800"
										>
											<svelte:component
												this={getBakeStatusIcon(entry.bakeStatus).icon}
												class="h-6 w-6 {getBakeStatusIcon(entry.bakeStatus).color}"
											/>
										</span>
									{/snippet}
									<div class="flex h-full flex-col">
										<!-- Top content -->
										<div class="flex-1">
											<span class="w-full"
												>{#if getRevisionInfo(entry.version)}
													<Badge color="gray" class="mr-1">
														{formatRevision(getRevisionInfo(entry.version)!)}
													</Badge>
												{/if}</span
											>
											{#if entry.message}
												<div class="mb-2 mt-2">
													<Blockquote class="text-xs">
														{entry.message}
													</Blockquote>
												</div>
											{/if}
										</div>

										<!-- Bottom content - buttons and bake status -->
										<div class="mt-auto space-y-2">
											{#if entry.bakeStatus}
												<div class="space-y-1">
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
											<div class="space-y-2 pt-3 dark:border-gray-700">
												{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
													<SourceViewer
														namespace={rollout.metadata?.namespace || ''}
														name={rollout.metadata?.name || ''}
														version={entry.version.tag}
													/>
												{/if}
												{#if i < rollout.status.history.length - 1 && rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
													<Button
														color="light"
														size="xs"
														href={`/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/diff/${entry.version.tag}`}
														class=""
													>
														<CodePullRequestSolid class="mr-1 h-3 w-3" />
														Show diff
													</Button>
												{/if}
												{#if entry.version.tag !== rollout.status?.history[0]?.version.tag}
													<Button
														color="light"
														size="xs"
														onclick={() => {
															// Set up rollback mode
															isPinVersionMode = true;
															selectedVersion = entry.version.tag;
															pinVersionToggle = true;
															// Generate default rollback message
															const currentVersion = rollout?.status?.history?.[0]?.version.tag;
															const targetVersion = entry.version.tag;
															const currentVersionName =
																currentVersion && annotations[currentVersion]
																	? annotations[currentVersion][
																			'org.opencontainers.image.version'
																		] || currentVersion
																	: currentVersion || 'current';
															const targetVersionName =
																targetVersion && annotations[targetVersion]
																	? annotations[targetVersion][
																			'org.opencontainers.image.version'
																		] || targetVersion
																	: targetVersion;
															deployExplanation = `Rollback from ${currentVersionName} to ${targetVersionName} due to issues with the current deployment.`;
															showDeployModal = true;
														}}
														class=""
													>
														<ReplyOutline class="mr-1 h-3 w-3" />
														Rollback
													</Button>
												{/if}
												{#if rollout?.status?.source}
													<GitHubViewButton
														sourceUrl={rollout.status.source}
														version={getDisplayVersion(entry.version)}
														size="xs"
														color="light"
													/>
												{/if}
												<Clipboard bind:value={entry.version.tag} size="xs" color="light" class="">
													{#snippet children(success)}
														{#if success}
															<CheckOutline class="mr-1 h-3 w-3" />
															Copied
														{:else}
															<ClipboardCleanSolid class="mr-1 h-3 w-3" />
															Copy Tag
														{/if}
													{/snippet}
												</Clipboard>
											</div>
										</div>
									</div>
								</TimelineItem>
							{/each}
						</Timeline>
					{:else}
						<div class="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
							<p>No deployment history available</p>
						</div>
					{/if}
				</div>
			</div>
		</Drawer>
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

		<!-- Search and Toggle Section -->
		<div class="space-y-3">
			<div class="flex items-center gap-3">
				<div class="flex-1">
					<input
						type="text"
						placeholder="Search all versions..."
						bind:value={searchQuery}
						class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
					/>
				</div>
				<Toggle
					bind:checked={showAllTags}
					color="blue"
					onchange={() => {
						if (showAllTags && allRepositoryTags.length === 0) {
							getAllRepositoryTags();
						}
						// Reset to first page when switching modes
						currentPage = 1;
					}}
				>
					Show All Versions
				</Toggle>
			</div>
		</div>

		<!-- All Versions Section -->
		<div>
			<h5 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
				{showAllTags ? 'All Repository Versions' : 'Available Versions'}
				{#if showAllTags}
					<Badge color="gray" class="ml-2 text-xs">
						{filteredVersionsForDisplay.length} total versions
					</Badge>
				{:else if rollout?.status?.availableReleases}
					<Badge color="blue" class="ml-2 text-xs">
						{rollout.status.availableReleases.length} versions
					</Badge>
				{/if}
			</h5>
			<Listgroup active class="max-h-64 overflow-y-auto">
				{#if showAllTags ? filteredVersionsForDisplay.length > 0 : rollout?.status?.availableReleases}
					{#each showAllTags ? paginatedUnifiedVersions : paginatedVersions as version}
						{@const versionTag = typeof version === 'string' ? version : version.tag}
						{#if searchQuery === '' || versionTag.toLowerCase().includes(searchQuery.toLowerCase())}
							{@const _clipboard = clipboardValue = versionTag}
							{@const _loadAnnotations = loadAnnotationsOnDemand(versionTag)}
							<ListgroupItem
								onclick={() => {
									selectedVersion = versionTag;
								}}
								class="w-full cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 {selectedVersion ===
								versionTag
									? 'border-2 border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900'
									: 'border-2 border-transparent'}"
							>
								<div class="flex w-full items-center justify-between">
									<div class="flex-1 space-y-2 pr-4">
										<div class="flex items-center justify-between">
											<div class="flex-1">
												<div class="font-medium text-gray-900 dark:text-white">
													{#if loadingAnnotations[versionTag]}
														<div
															class="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
														></div>
													{:else}
														{(() => {
															// Check if this is a regular release in availableReleases
															const availableRelease = rollout?.status?.availableReleases?.find(
																(ar) => ar.tag === versionTag
															);
															if (availableRelease) {
																return getDisplayVersion(availableRelease);
															}
															// Fall back to annotations for custom releases
															return getDisplayVersion({
																version:
																	annotations[versionTag]?.['org.opencontainers.image.version'],
																tag: versionTag
															});
														})()}
													{/if}
												</div>
												{#if (() => {
													const availableRelease = rollout?.status?.availableReleases?.find((ar) => ar.tag === versionTag);
													const version = availableRelease?.version || annotations[versionTag]?.['org.opencontainers.image.version'];
													return version && version !== versionTag;
												})()}
													<div class="text-xs text-gray-500 dark:text-gray-400">
														Tag: <code
															class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800"
															>{versionTag}</code
														>
													</div>
												{/if}
											</div>
										</div>

										<!-- Version details -->
										<div class="grid grid-cols-2 gap-4 text-xs text-gray-600 dark:text-gray-400">
											{#if loadingAnnotations[versionTag]}
												<div class="col-span-2 space-y-2">
													<div
														class="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
													></div>
													<div
														class="h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
													></div>
												</div>
											{:else}
												{#if (() => {
													const availableRelease = rollout?.status?.availableReleases?.find((ar) => ar.tag === versionTag);
													return availableRelease?.created || annotations[versionTag]?.['org.opencontainers.image.created'];
												})()}
													<div>
														<span class="font-medium">Created:</span>
														<div class="mb-1">
															{formatDate(
																(() => {
																	const availableRelease = rollout?.status?.availableReleases?.find(
																		(ar) => ar.tag === versionTag
																	);
																	return (
																		availableRelease?.created ||
																		annotations[versionTag]?.['org.opencontainers.image.created']
																	);
																})()
															)}
														</div>
														<div class="text-gray-500 dark:text-gray-500">
															<Badge color="gray" border>
																<ClockSolid class="me-1.5 h-2.5 w-2.5" />
																{formatTimeAgo(
																	(() => {
																		const availableRelease =
																			rollout?.status?.availableReleases?.find(
																				(ar) => ar.tag === versionTag
																			);
																		return (
																			availableRelease?.created ||
																			annotations[versionTag]?.['org.opencontainers.image.created']
																		);
																	})(),
																	$now
																)}
															</Badge>
														</div>
													</div>
												{/if}
												{#if (() => {
													const availableRelease = rollout?.status?.availableReleases?.find((ar) => ar.tag === versionTag);
													return availableRelease?.revision || annotations[versionTag]?.['org.opencontainers.image.revision'];
												})()}
													<div>
														<span class="font-medium">Revision:</span>
														<div class="font-mono">
															{formatRevision(
																(() => {
																	const availableRelease = rollout?.status?.availableReleases?.find(
																		(ar) => ar.tag === versionTag
																	);
																	return (
																		availableRelease?.revision ||
																		annotations[versionTag]?.['org.opencontainers.image.revision']
																	);
																})()!
															)}
														</div>
													</div>
												{/if}
											{/if}
										</div>

										<!-- Status indicators -->
										<div class="flex flex-wrap gap-2">
											{#if rollout?.status?.history?.[0]?.version.tag === versionTag}
												<Badge color="green" class="text-xs">
													<CheckCircleSolid class="mr-1 h-3 w-3" />
													Currently Deployed
												</Badge>
											{/if}
											{#if rollout?.spec?.wantedVersion === versionTag}
												<Badge class="text-xs">
													<CheckCircleSolid class="mr-1 h-3 w-3" />
													Currently Pinned
												</Badge>
											{/if}
											{#if showAllTags && !rollout?.status?.availableReleases
													?.map((ar) => ar.tag)
													.includes(versionTag)}
												<Badge color="yellow" class="text-xs">
													<ExclamationCircleSolid class="mr-1 h-3 w-3" />
													Custom
												</Badge>
											{/if}
										</div>

										<!-- Action buttons -->
										<div class="flex gap-2 pt-2">
											{#if loadingAnnotations[versionTag]}
												<div class="flex gap-2">
													<div
														class="h-6 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
													></div>
													<div
														class="h-6 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
													></div>
												</div>
											{:else}
												{#if rollout?.status?.source}
													<GitHubViewButton
														sourceUrl={rollout.status.source}
														version={(() => {
															const availableRelease = rollout?.status?.availableReleases?.find(
																(ar) => ar.tag === versionTag
															);
															if (availableRelease) {
																return getDisplayVersion(availableRelease);
															}
															return getDisplayVersion({
																version:
																	annotations[versionTag]?.['org.opencontainers.image.version'],
																tag: versionTag
															});
														})()}
														size="xs"
														color="light"
													/>
												{/if}
												<Clipboard bind:value={clipboardValue} size="xs" color="light" class="">
													{#snippet children(success)}
														{#if success}
															<CheckOutline class="mr-1 h-3 w-3" />
															Copied
														{:else}
															<ClipboardCleanSolid class="mr-1 h-3 w-3" />
															Copy Tag
														{/if}
													{/snippet}
												</Clipboard>
											{/if}
										</div>
									</div>
									<div class="w-6 flex-shrink-0">
										{#if selectedVersion === versionTag}
											<CheckCircleSolid class="h-5 w-5 text-blue-600 dark:text-blue-400" />
										{/if}
									</div>
								</div>
							</ListgroupItem>
						{/if}
					{/each}
				{:else}
					<ListgroupItem class="text-center text-gray-500 dark:text-gray-400">
						No versions available
					</ListgroupItem>
				{/if}
			</Listgroup>
		</div>

		<div class="flex justify-end gap-2 pt-4">
			{#if (showAllTags ? totalUnifiedPages : totalPages) > 1}
				<div class="flex flex-1 items-center justify-center gap-2">
					<Button
						size="sm"
						color="light"
						onclick={() => goToPage(currentPage - 1)}
						disabled={currentPage === 1}
					>
						Previous
					</Button>
					<span class="text-sm text-gray-600 dark:text-gray-400">
						Page {currentPage} of {showAllTags ? totalUnifiedPages : totalPages}
					</span>
					<Button
						size="sm"
						color="light"
						onclick={() => goToPage(currentPage + 1)}
						disabled={currentPage === (showAllTags ? totalUnifiedPages : totalPages)}
					>
						Next
					</Button>
				</div>
			{/if}
			<Button
				color="light"
				onclick={() => {
					showPinModal = false;
					selectedVersion = null;
					searchQuery = '';
					showAllTags = false;
					isPinVersionMode = false;
				}}
			>
				Cancel
			</Button>
			<Button
				color="blue"
				disabled={!selectedVersion}
				onclick={() => {
					if (isPinVersionMode) {
						// In pin version mode, open deploy modal with toggle disabled and set to pin
						pinVersionToggle = true;
						showDeployModal = true;
						showPinModal = false;
					} else {
						// Original behavior for other contexts - this should not happen anymore
						// since we're using the unified deploy modal
						console.warn('Unexpected call to old confirmation modal');
					}
				}}
			>
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
				onclick={() => {
					showClearPinModal = false;
				}}
			>
				Cancel
			</Button>
			<Button color="blue" onclick={clearPin}>Clear Pin</Button>
		</div>
	</div>
</Modal>

<Modal bind:open={showResumeRolloutModal} title="Confirm Resume Rollout">
	<div class="space-y-4">
		<Alert color="yellow" class="mb-4">
			<div class="flex items-center">
				<ExclamationCircleSolid class="mr-2 h-4 w-4" />
				<p>
					<span class="font-medium">Warning:</span> This will resume the rollout process after a failed
					deployment bake.
				</p>
			</div>
		</Alert>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Are you sure you want to resume the rollout for <b>{rollout?.metadata?.name}</b>?
		</p>
		<p class="text-xs text-gray-500 dark:text-gray-400">
			This will add the unblock-failed annotation to allow the rollout controller to resume
			deployment of the failed version.
		</p>
		<div class="flex justify-end gap-2">
			<Button
				color="light"
				onclick={() => {
					showResumeRolloutModal = false;
					selectedVersion = null;
				}}
			>
				Cancel
			</Button>
			<Button color="blue" onclick={resumeRollout}>
				<PlaySolid class="mr-1 h-3 w-3" />
				Resume Rollout
			</Button>
		</div>
	</div>
</Modal>

<Modal bind:open={showMarkSuccessfulModal} title="Mark Deployment as Successful">
	<div class="space-y-4">
		<Alert color="green" class="mb-4">
			<div class="flex items-center">
				<CheckCircleSolid class="mr-2 h-4 w-4" />
				<p>
					<span class="font-medium">Mark as Successful:</span> This will mark the failed deployment as
					successful and update the deployment history.
				</p>
			</div>
		</Alert>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Are you sure you want to mark the deployment for <b>{rollout?.metadata?.name}</b> as successful?
		</p>
		<p class="text-xs text-gray-500 dark:text-gray-400">
			This will update the deployment history to show the deployment as succeeded and set the bake
			end time to now.
		</p>
		<Alert color="blue" class="mt-3">
			<div class="flex items-center">
				<InfoCircleSolid class="mr-2 h-4 w-4" />
				<p class="text-sm">
					<span class="font-medium">Alternative:</span> You can also deploy a different version to fix
					the deployment issue instead of marking this one as successful.
				</p>
			</div>
		</Alert>

		<!-- Message field -->
		<div>
			<label
				for="mark-successful-message"
				class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
			>
				Message (Optional)
			</label>
			<textarea
				id="mark-successful-message"
				bind:value={markSuccessfulMessage}
				placeholder="Provide additional details about why you're marking this deployment as successful..."
				class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
				rows="3"
			></textarea>
		</div>

		<div class="flex justify-end gap-2">
			<Button
				color="light"
				onclick={() => {
					showMarkSuccessfulModal = false;
					markSuccessfulMessage = '';
				}}
			>
				Cancel
			</Button>
			<Button color="green" onclick={() => markDeploymentSuccessful(markSuccessfulMessage)}>
				<CheckCircleSolid class="mr-1 h-3 w-3" />
				Mark Successful
			</Button>
		</div>
	</div>
</Modal>

<!-- Deploy Modal -->
<Modal bind:open={showDeployModal} title="Deploy Version">
	<div class="space-y-4">
		{#if rollout && !isDashboardManagingWantedVersion && hasForceDeployAnnotation(rollout)}
			<Alert color="yellow" class="mb-4">
				<ExclamationCircleSolid class="h-4 w-4" />
				<span class="font-medium">Warning:</span> Version management is disabled and force deploy is
				already set. No deployment options are available.
			</Alert>
		{:else if rollout && !isDashboardManagingWantedVersion}
			<Alert color="yellow" class="mb-4">
				<ExclamationCircleSolid class="h-4 w-4" />
				<span class="font-medium">Warning:</span> Version management is disabled. Only force deploy is
				available.
			</Alert>
		{:else if rollout && hasForceDeployAnnotation(rollout)}
			<Alert color="blue" class="mb-4">
				<ExclamationCircleSolid class="h-4 w-4" />
				<span class="font-medium">Info:</span> Force deploy already set. Only version pinning is available.
			</Alert>
		{/if}

		<!-- Version Display -->
		<div class="mb-3 text-center">
			<Badge color="blue" class="px-3 py-1 text-base">
				{selectedVersion
					? (() => {
							const availableRelease = rollout?.status?.availableReleases?.find(
								(ar) => ar.tag === selectedVersion
							);
							if (availableRelease) {
								return getDisplayVersion(availableRelease);
							}
							return getDisplayVersion({
								version: annotations[selectedVersion]?.['org.opencontainers.image.version'],
								tag: selectedVersion
							});
						})()
					: ''}
			</Badge>
			{#if selectedVersion && (() => {
					const availableRelease = rollout?.status?.availableReleases?.find((ar) => ar.tag === selectedVersion);
					const version = availableRelease?.version || annotations[selectedVersion]?.['org.opencontainers.image.version'];
					return version && version !== selectedVersion;
				})()}
				<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
					Tag: {selectedVersion}
				</div>
			{/if}
		</div>

		<!-- Pin Version Toggle -->
		{#if rollout && isDashboardManagingWantedVersion && !hasForceDeployAnnotation(rollout)}
			<div
				class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-gray-700"
			>
				<div class="flex-1">
					<div class="text-sm font-medium text-gray-700 dark:text-gray-300">Pin Version</div>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						{#if isPinVersionMode}
							Version pinning is enabled for this deployment.
						{:else}
							When enabled, this version will be pinned and prevent automatic deployment logic from
							changing it.
						{/if}
					</p>
				</div>
				<Toggle
					bind:checked={pinVersionToggle}
					disabled={isPinVersionToggleDisabled || isPinVersionMode}
					color="blue"
				>
					Pin Version
				</Toggle>
			</div>
		{:else if rollout && isDashboardManagingWantedVersion && hasForceDeployAnnotation(rollout)}
			<div
				class="flex items-center justify-between rounded-lg border border-gray-200 p-4 dark:border-gray-700"
			>
				<div class="flex-1">
					<div class="text-sm font-medium text-gray-700 dark:text-gray-300">Pin Version</div>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						{#if isPinVersionMode}
							Version pinning is enabled for this deployment.
						{:else}
							Version pinning is enabled because force deploy is already set.
						{/if}
					</p>
				</div>
				<Toggle bind:checked={pinVersionToggle} disabled={true} color="blue">Pin Version</Toggle>
			</div>
		{/if}

		<!-- Explanation field -->
		<div>
			<label
				for="deploy-explanation"
				class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
			>
				Explanation (Optional)
			</label>
			<textarea
				id="deploy-explanation"
				bind:value={deployExplanation}
				placeholder={pinVersionToggle
					? 'Provide a reason for pinning this version...'
					: 'Provide a reason for force deploying...'}
				class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
				rows="3"
			></textarea>
		</div>

		<!-- Version confirmation -->
		<div>
			<label
				for="deploy-confirmation-version"
				class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
			>
				Type the version to confirm: <span class="font-bold text-gray-900 dark:text-white"
					>{selectedVersion &&
						(() => {
							const availableRelease = rollout?.status?.availableReleases?.find(
								(ar) => ar.tag === selectedVersion
							);
							if (availableRelease) {
								return getDisplayVersion(availableRelease);
							}
							return getDisplayVersion({
								version: annotations[selectedVersion]?.['org.opencontainers.image.version'],
								tag: selectedVersion
							});
						})()}</span
				>
			</label>
			<input
				id="deploy-confirmation-version"
				type="text"
				bind:value={deployConfirmationVersion}
				placeholder={`Enter ${
					selectedVersion &&
					(() => {
						const availableRelease = rollout?.status?.availableReleases?.find(
							(ar) => ar.tag === selectedVersion
						);
						return (
							availableRelease?.version ||
							annotations[selectedVersion]?.['org.opencontainers.image.version']
						);
					})()
						? 'version name'
						: 'version'
				} to confirm`}
				class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
			/>
		</div>

		<!-- Action description -->
		<p class="text-xs text-gray-500 dark:text-gray-400">
			{#if pinVersionToggle}
				This will immediately deploy version <b>{selectedVersion}</b> and pin it, preventing automatic
				deployment logic from changing it.
			{:else}
				This will force deploy version <b>{selectedVersion}</b>, allowing it to deploy immediately.
			{/if}
		</p>

		<div class="flex justify-end gap-2">
			<Button
				color="light"
				onclick={() => {
					showDeployModal = false;
					selectedVersion = null;
					pinVersionToggle = false;
					deployExplanation = '';
					deployConfirmationVersion = '';
					isPinVersionMode = false;
				}}
			>
				Cancel
			</Button>
			<Button
				color="blue"
				disabled={selectedVersion
					? deployConfirmationVersion !==
						(() => {
							const availableRelease = rollout?.status?.availableReleases?.find(
								(ar) => ar.tag === selectedVersion
							);
							if (availableRelease) {
								return getDisplayVersion(availableRelease);
							}
							return getDisplayVersion({
								version: annotations[selectedVersion!]?.['org.opencontainers.image.version'],
								tag: selectedVersion!
							});
						})()
					: true}
				onclick={handleDeploy}
			>
				Deploy
			</Button>
		</div>
	</div>
</Modal>

<Toast
	transition={fly}
	position="top-right"
	params={{ x: 200 }}
	class="fixed right-4 top-24 z-50 rounded-lg"
	align={false}
	bind:toastStatus={showToast}
>
	{#snippet icon()}
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
	{/snippet}
	{toastMessage}
</Toast>

<style>
	.auto-fill-grid {
		grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
		justify-content: start;
	}

	.auto-fill-grid-compact {
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		justify-content: start;
	}
</style>
