<svelte:options runes={true} />

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import type {
		Rollout,
		Kustomization,
		OCIRepository,
		ManagedResourceStatus,
		HealthCheck,
		KruiseRollout,
		Environment
	} from '../../../../types';
	import type {
		EnvironmentStatusEntry,
		EnvironmentInfo
	} from '../../../../types/environment-types';
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
		Popover,
		Listgroup,
		ListgroupItem,
		Toggle,
		Clipboard,
		Blockquote,
		StepIndicator,
		Progressradial,
		Sidebar,
		SidebarGroup,
		SidebarItem
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
		CalendarWeekSolid,
		QuestionCircleOutline,
		HeartSolid,
		CubesStackedSolid
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
		hasUnblockFailedAnnotation,
		getDisplayVersion
	} from '$lib/utils';
	import { getBakeStatusIcon } from '$lib/bake-status';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import DeployModal from '$lib/components/DeployModal.svelte';
	import ResourceCard from '$lib/components/ResourceCard.svelte';
	import HealthCheckBadge from '$lib/components/HealthCheckBadge.svelte';
	import JoinedBadge from '$lib/components/JoinedBadge.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import { fly, blur } from 'svelte/transition';

	import { createQuery } from '@tanstack/svelte-query';
	import {
		rolloutQueryOptions,
		type RolloutResponse,
		rolloutPermissionsQueryOptions
	} from '$lib/api/rollouts';

	// Params (runes)
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	// Query for rollout - fetches all rollout data including kustomizations, ociRepositories, rolloutGates
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name
		})
	);

	// Query for permissions - checks if user can update/patch rollouts
	const permissionsQuery = createQuery(() =>
		rolloutPermissionsQueryOptions({
			namespace,
			name
		})
	);

	// Derived permissions state
	const canUpdate = $derived(permissionsQuery.data?.permissions?.update ?? false);
	const canPatch = $derived(permissionsQuery.data?.permissions?.patch ?? false);
	// Most actions require update permission, but some (like force-deploy, bypass-gates) use patch
	const canModify = $derived(canUpdate || canPatch);

	// Maintain existing local vars used throughout
	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const loading = $derived(rolloutQuery.isLoading);
	let error: string | null = $state(null);

	let kustomizations = $state<Kustomization[]>([]);
	let ociRepositories = $state<OCIRepository[]>([]);
	let rolloutGates = $state<any[]>([]);
	let managedResources = $state<Record<string, ManagedResourceStatus[]>>({});
	let healthChecks = $state<HealthCheck[]>([]);

	// Map data from query response to state
	$effect(() => {
		if (rolloutQuery.data) {
			kustomizations = rolloutQuery.data.kustomizations?.items || [];
			ociRepositories = rolloutQuery.data.ociRepositories?.items || [];
			rolloutGates = rolloutQuery.data.rolloutGates?.items || [];
		}
	});

	// Fetch managed resources when kustomizations change
	$effect(() => {
		const currentKustomizations = kustomizations;
		if (!currentKustomizations || currentKustomizations.length === 0) {
			managedResources = {};
			return;
		}

		const tempResources: Record<string, ManagedResourceStatus[]> = {};
		Promise.all(
			currentKustomizations
				.filter((kustomization) => Boolean(kustomization.metadata?.name))
				.map(async (kustomization) => {
					const name = kustomization.metadata!.name as string;
					const kustomizationNamespace = kustomization.metadata?.namespace || namespace;
					try {
						const resourcesResponse = await fetch(
							`/api/kustomizations/${kustomizationNamespace}/${name}/managed-resources`
						);
						if (resourcesResponse.ok) {
							const resourcesData = await resourcesResponse.json();
							tempResources[name] = resourcesData.managedResources || [];
						}
					} catch (e) {
						console.error(`Failed to fetch managed resources for ${name}:`, e);
					}
				})
		).then(() => {
			// Only update if kustomizations haven't changed
			if (kustomizations === currentKustomizations) {
				managedResources = { ...tempResources };
			}
		});
	});

	// Fetch health checks when rollout or healthCheckSelector changes
	$effect(() => {
		const currentRollout = rollout;
		if (!currentRollout?.spec?.healthCheckSelector) {
			healthChecks = [];
			return;
		}

		fetch(`/api/rollouts/${namespace}/${name}/health-checks`)
			.then((healthChecksResponse) => {
				if (healthChecksResponse.ok) {
					return healthChecksResponse.json();
				}
				return null;
			})
			.then((healthChecksData) => {
				// Only update if rollout hasn't changed
				if (healthChecksData && rollout === currentRollout) {
					healthChecks = healthChecksData.healthChecks || [];
				}
			})
			.catch((e) => {
				console.error('Failed to fetch health checks:', e);
			});
	});

	let annotations = $state<Record<string, Record<string, string>>>({});
	let loadingAnnotations = $state<Record<string, boolean>>({});

	let showPinModal = $state(false);
	// removed Clear Pin functionality
	let selectedVersion = $state<string | null>(null);

	let showToast = $state(false);
	let toastMessage = $state('');
	let toastType = $state<'success' | 'error'>('success');

	let showRollbackModal = $state(false);
	let rollbackVersion = $state<string | null>(null);

	let showMarkSuccessfulModal = $state(false);
	let markSuccessfulMessage = $state('');

	let showClearPinModal = $state(false);

	// New variables for deploy modal
	let showDeployModal = $state(false);
	let pinVersionToggle = $state(false);
	let deployExplanation = $state('');
	let deployConfirmationVersion = $state('');

	// New variables for pin version mode
	let isPinVersionMode = $state(false);

	// Toggle for showing/hiding "current" resources

	// Pagination variables
	let currentPage = $state(1);
	let itemsPerPage = 10;

	// New variables for all repository tags
	let allRepositoryTags = $state<string[]>([]);
	let loadingAllTags = $state(false);
	let searchQuery = $state('');
	let showAllTags = $state(false);

	// Selected version display label (for modal confirmation)
	function selectedVersionDisplay(): string | null {
		if (!selectedVersion) return null;
		const availableRelease = rollout?.status?.availableReleases?.find(
			(ar) => ar.tag === selectedVersion
		);
		if (availableRelease) {
			return getDisplayVersion(availableRelease);
		}
		return selectedVersion;
	}

	// Helper function to map failed health checks to full health checks
	function findFullHealthCheck(
		failedHC: { name: string; namespace?: string },
		allHealthChecks: HealthCheck[]
	): HealthCheck | undefined {
		return allHealthChecks.find(
			(hc) =>
				hc.metadata?.name === failedHC.name &&
				(!failedHC.namespace || hc.metadata?.namespace === failedHC.namespace)
		);
	}

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

	// Function to get gates blocking a specific version
	function getBlockingGates(version: string): any[] {
		if (!rollout?.status?.gates || rollout.status.gates.length === 0) return [];

		// Filter gates that are blocking this specific version
		const blockingGates = rollout.status.gates.filter((gate) => {
			// If gate has allowedVersions, check if this version is in the allowed list
			// A gate can be passing but still blocking if the version is not in allowedVersions
			if (Array.isArray(gate.allowedVersions)) {
				// Version is blocked if it's NOT in the allowedVersions list (regardless of passing status)
				return !gate.allowedVersions.includes(version);
			}

			// If gate doesn't have allowedVersions, check the passing status
			// If gate is not passing, it's blocking
			return gate.passing === false;
		});

		// Map to full gate objects from rolloutGates for display (name, description, etc.)
		return blockingGates
			.map((gateStatus) => {
				// Find the corresponding full gate object
				const fullGate = rolloutGates.find((g) => g.metadata?.name === gateStatus.name);
				return fullGate || null;
			})
			.filter((gate): gate is any => gate !== null);
	}

	// Computed property to determine if dashboard is managing the wantedVersion field
	const isDashboardManagingWantedVersion = $derived.by(() => {
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
	});

	// Computed property to determine if current version is custom (not in available releases)
	const isCurrentVersionCustom = $derived.by(() => {
		if (!rollout?.status?.history?.[0] || !rollout?.status?.availableReleases) return false;
		const currentVersionTag = rollout.status.history[0].version.tag;
		return !rollout.status.availableReleases.some((ar) => ar.tag === currentVersionTag);
	});

	function isOlderThanCurrent(selectedTag: string): boolean {
		const currentTag = rollout?.status?.history?.[0]?.version?.tag;
		const releases = rollout?.status?.availableReleases;
		if (!currentTag || !releases) return false;
		const currentIdx = releases.findIndex((r) => r.tag === currentTag);
		const selectedIdx = releases.findIndex((r) => r.tag === selectedTag);
		if (currentIdx === -1 || selectedIdx === -1) return false;
		// In availableReleases, higher index is newer; lower is older
		return selectedIdx < currentIdx;
	}

	function toTag(version: string | { tag: string } | undefined): string {
		return typeof version === 'string' ? version : (version?.tag ?? '');
	}

	// Helper function to get dependency status for a version
	function getDependencyStatus(versionTag: string): string | null {
		const environment = rolloutQuery.data?.environment;
		if (!environment?.status?.environmentInfos) {
			return null;
		}

		// Get current environment from namespace
		const parts = namespace.split('-');
		const currentEnv = parts[parts.length - 1] || namespace;

		// Find current environment info
		const currentEnvInfo = environment.status.environmentInfos.find(
			(e: EnvironmentInfo) => e.environment === currentEnv
		);
		const depEnv =
			currentEnvInfo?.relationship?.type === 'After'
				? currentEnvInfo.relationship.environment
				: null;
		if (!depEnv) {
			return null;
		}

		// Find the dependency environment info
		const depEnvInfo = environment.status.environmentInfos.find(
			(e: EnvironmentInfo) => e.environment === depEnv
		);
		if (!depEnvInfo?.history) {
			return null;
		}

		// Find the release candidate, history entry, or available release to get all version identifiers
		if (!rollout) return null;
		const historyEntry = rollout.status?.history?.find(
			(entry) => entry.version?.tag === versionTag
		);
		const availableRelease = rollout.status?.availableReleases?.find((ar) => ar.tag === versionTag);

		// Collect all possible version identifiers to match against
		const versionIdentifiers = new Set<string>([versionTag]);
		if (historyEntry?.version) {
			if (historyEntry.version.digest) versionIdentifiers.add(historyEntry.version.digest);
			if (historyEntry.version.revision) versionIdentifiers.add(historyEntry.version.revision);
		}
		if (availableRelease) {
			if (availableRelease.digest) versionIdentifiers.add(availableRelease.digest);
			if (availableRelease.revision) versionIdentifiers.add(availableRelease.revision);
		}

		// Find matching deployment history entry in the dependency environment
		// EnvironmentInfo.history contains DeploymentHistoryEntry objects with bakeStatus
		const matchingEntry = depEnvInfo.history.find(
			(entry: EnvironmentStatusEntry) =>
				versionIdentifiers.has(entry.version.tag) ||
				(entry.version.digest && versionIdentifiers.has(entry.version.digest)) ||
				(entry.version.revision && versionIdentifiers.has(entry.version.revision))
		);

		if (!matchingEntry) {
			return null;
		}

		// Return bakeStatus directly from DeploymentHistoryEntry
		return matchingEntry.bakeStatus || null;
	}

	function getStatusIcon(status: string | null) {
		if (!status) return { icon: ExclamationCircleSolid, color: 'text-gray-500 dark:text-gray-400' };
		switch (status.toLowerCase()) {
			case 'success':
				return { icon: CheckCircleSolid, color: 'text-green-600 dark:text-green-400' };
			case 'failure':
				return { icon: ExclamationCircleSolid, color: 'text-red-600 dark:text-red-400' };
			case 'in_progress':
			case 'pending':
				return { icon: ClockSolid, color: 'text-yellow-600 dark:text-yellow-400' };
			default:
				return { icon: ExclamationCircleSolid, color: 'text-gray-500 dark:text-gray-400' };
		}
	}

	function getStatusColor(status: string | null): 'green' | 'red' | 'yellow' | 'gray' {
		if (!status) return 'gray';
		switch (status.toLowerCase()) {
			case 'success':
				return 'green';
			case 'failure':
				return 'red';
			case 'in_progress':
			case 'pending':
				return 'yellow';
			case 'inactive':
				return 'gray';
			default:
				return 'gray';
		}
	}

	// Computed properties for pagination
	const reversedVersions = $derived(
		rollout?.status?.availableReleases ? [...rollout.status.availableReleases].reverse() : []
	);
	const totalPages = $derived(Math.ceil(reversedVersions.length / itemsPerPage));
	const paginatedVersions = $derived(
		reversedVersions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
	);

	// Computed properties for all tags filtering and display
	const filteredAllTags = $derived(
		allRepositoryTags.filter((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
	);
	const nonStandardTags = $derived(
		allRepositoryTags.filter(
			(tag) => !rollout?.status?.availableReleases?.map((ar) => ar.tag).includes(tag)
		)
	);
	const filteredNonStandardTags = $derived(
		nonStandardTags.filter((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
	);

	// Unified list of all versions for display
	const allVersionsForDisplay = $derived.by(() => {
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
	});

	// Filter the unified list based on search
	const filteredVersionsForDisplay = $derived(
		allVersionsForDisplay.filter((version) => {
			const versionTag = typeof version === 'string' ? version : version.tag;
			return searchQuery === '' || versionTag.toLowerCase().includes(searchQuery.toLowerCase());
		})
	);

	// Pagination for the unified list
	const totalUnifiedPages = $derived(Math.ceil(filteredVersionsForDisplay.length / itemsPerPage));
	const paginatedUnifiedVersions = $derived(
		filteredVersionsForDisplay.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
	);

	// Computed property to filter managed resources - now always shows all resources
	const filteredManagedResources = $derived(managedResources);

	function goToPage(page: number) {
		const maxPages = showAllTags ? totalUnifiedPages : totalPages;
		if (page >= 1 && page <= maxPages) {
			currentPage = page;
			selectedVersion = null; // Reset selection when changing pages
		}
	}

	// Note: Data fetching is handled by rolloutQuery with automatic refetch via layout's refetchInterval
	// Dependent data (managedResources, healthChecks) is fetched via $effect when parent data changes

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
					await rolloutQuery.refetch();
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
					body: JSON.stringify({
						version: null,
						explanation: ''
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
						"Cannot clear pin: Dashboard is not managing this rollout's wantedVersion field. This field may be managed by another controller or external system."
					);
				}
				throw new Error('Failed to clear pin');
			}

			// Refresh the data
			await rolloutQuery.refetch();

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
			toastMessage = e instanceof Error ? e.message : 'Failed to clear pin';
			showToast = true;
			setTimeout(() => {
				showToast = false;
			}, 3000);
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

	// Helper function to get revision information from version object or annotations
	function getRevisionInfo(versionInfo: { revision?: string; tag: string }): string | undefined {
		return versionInfo.revision;
	}

	// Function to load annotations on demand for custom releases when displayed
	async function loadAnnotationsOnDemand(versionTag: string): Promise<void> {
		// Only load if not already loaded and this is not a regular release
		const availableReleaseEntry = rollout?.status?.availableReleases?.find(
			(entry) => entry?.tag === versionTag
		);
		if (!availableReleaseEntry && !annotations[versionTag]) {
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

			await rolloutQuery.refetch();
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
			await rolloutQuery.refetch();
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
			? `${rollout.status?.title || rollout.metadata.name} (${rollout.metadata.namespace})`
			: 'Rollout'}</title
	>
</svelte:head>

<div class="h-full w-full dark:bg-gray-900">
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
		<!-- Main Layout: Sidebar and content side by side -->
		<div class="flex h-full overflow-hidden">
			<!-- Content -->
			<div class="flex flex-1 flex-col overflow-hidden">
				<!-- Content Area -->
				<div class="flex-1 overflow-y-auto p-4">
					<!-- Failed Environment Deployment Alert -->
					{#if rollout && hasFailedBakeStatus(rollout) && !hasUnblockFailedAnnotation(rollout)}
						{@const latestEntry = rollout.status?.history?.[0]}
						{@const failedHealthChecks = latestEntry?.failedHealthChecks || []}
						<Alert color="red" class="mb-4">
							<div class="flex items-center gap-3">
								<ExclamationCircleSolid class="h-5 w-5 text-red-600 dark:text-red-400" />
								<span class="text-lg font-medium text-red-600 dark:text-red-400"
									>Deployment Failed</span
								>
							</div>
							<p class="mb-3 mt-2 text-sm">
								The latest deployment has failed
								{#if failedHealthChecks.length > 0}
									with {failedHealthChecks.length} failed health check{failedHealthChecks.length > 1
										? 's'
										: ''}.
								{/if}
								Automated rollouts are paused until you manually mark this version as successful or change
								to another version.
							</p>
							{#if failedHealthChecks.length > 0}
								<div class="mb-4">
									<div class="flex flex-wrap gap-1.5">
										{#each failedHealthChecks as failedHC, index}
											<HealthCheckBadge
												failedHealthCheck={failedHC}
												fullHealthCheck={findFullHealthCheck(failedHC, healthChecks)}
												{index}
												prefix="failed-hc-alert"
											/>
										{/each}
									</div>
								</div>
							{/if}
							<div class="flex flex-wrap gap-2">
								{#if canUpdate}
									<Button
										id="mark-successful-btn"
										size="xs"
										color="light"
										onclick={() => {
											selectedVersion = rollout?.status?.history?.[0]?.version.tag || null;
											showMarkSuccessfulModal = true;
										}}
									>
										<CheckCircleSolid class="me-2 h-4 w-4" />
										Mark Successful
									</Button>
								{/if}
								<Tooltip
									triggeredBy="#mark-successful-btn"
									placement="bottom"
									class="max-w-xs"
									transition={blur}
									transitionParams={{ duration: 300 }}
								>
									Mark this deployment as successful to resume automated rollouts. Use when issues
									are resolved or you want to manually override the failure status.
								</Tooltip>
								{#if canModify}
									<Button
										id="change-version-btn"
										size="xs"
										color="light"
										disabled={!isDashboardManagingWantedVersion}
										onclick={() => {
											if (isDashboardManagingWantedVersion) {
												isPinVersionMode = false;
												showPinModal = true;
											}
										}}
									>
										<EditOutline class="me-2 h-4 w-4" />
										Change Version
									</Button>
								{/if}
								<Tooltip
									triggeredBy="#change-version-btn"
									placement="bottom"
									class="max-w-xs"
									transition={blur}
									transitionParams={{ duration: 300 }}
								>
									Deploy a different version to replace the failed deployment. Choose from available
									releases or any version in the repository.
									{#if !isDashboardManagingWantedVersion}
										<br />
										<span class="text-yellow-600 dark:text-yellow-400">
											Disabled: dashboard is not managing the wantedVersion field.
										</span>
									{/if}
								</Tooltip>
								{#if rollout?.status?.history && rollout.status.history.length > 1}
									{#if canModify}
										<Button
											id="rollback-btn"
											size="xs"
											color="light"
											disabled={!isDashboardManagingWantedVersion}
											onclick={() => {
												if (
													isDashboardManagingWantedVersion &&
													rollout?.status?.history &&
													rollout.status.history.length > 1
												) {
													const previousVersion = rollout.status.history[1];
													isPinVersionMode = true;
													selectedVersion = previousVersion.version.tag;
													pinVersionToggle = true;
													const currentVersion = rollout.status.history[0].version;
													const currentVersionName = getDisplayVersion(currentVersion);
													const targetVersionName = getDisplayVersion(previousVersion.version);
													deployExplanation = `Rollback from ${currentVersionName} to ${targetVersionName} due to issues with the current deployment.`;
													showDeployModal = true;
												}
											}}
										>
											<ReplyOutline class="me-2 h-4 w-4" />
											Rollback
										</Button>
									{/if}
									<Tooltip
										triggeredBy="#rollback-btn"
										placement="bottom"
										class="max-w-xs"
										transition={blur}
										transitionParams={{ duration: 300 }}
									>
										Revert to the previous version that was deployed before this one.
										{#if !isDashboardManagingWantedVersion}
											<br />
											<span class="text-yellow-600 dark:text-yellow-400">
												Disabled: dashboard is not managing the wantedVersion field.
											</span>
										{/if}
									</Tooltip>
								{/if}
							</div>
						</Alert>
					{/if}
					{#if rollout.status?.title || rollout.status?.description || rolloutQuery.data?.environment}
						{@const environment = rolloutQuery.data?.environment}
						{@const currentEnvInfo = environment?.status?.environmentInfos?.find(
							(e: EnvironmentInfo) => {
								const parts = namespace.split('-');
								const currentEnv = parts[parts.length - 1] || namespace;
								return e.environment === currentEnv;
							}
						)}
						<Card class="mb-4 w-full max-w-none p-6">
							<div class="flex flex-col gap-2">
								<div class="flex items-center justify-between gap-4">
									<div class="flex-1">
										{#if rollout.status?.title}
											<h2 class="text-lg font-semibold text-gray-900 dark:text-white">
												{rollout.status.title}
											</h2>
										{/if}
										{#if rollout.status?.description}
											<p class="text-sm text-gray-600 dark:text-gray-400">
												{rollout.status.description}
											</p>
										{/if}
									</div>
									{#if currentEnvInfo}
										<JoinedBadge
											label="Environment"
											value={currentEnvInfo.environment || 'N/A'}
											valueColor="blue"
											large
										/>
									{/if}
								</div>
							</div>
						</Card>
					{/if}

					<!-- Dashboard Grid -->
					<div class="grid w-full grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-2">
						<!-- Current Version Card -->
						{#if rollout.status?.history?.[0]}
							{@const latestEntry = rollout.status.history[0]}
							<Card class="w-full max-w-none p-6 lg:col-span-2">
								<!-- Header Section -->
								<div class="mb-6">
									<h3 class="text-xl font-bold text-gray-900 dark:text-white">Current Version</h3>
								</div>

								<!-- Version Display Section -->
								<div class="mb-6">
									<div class="flex items-center gap-4">
										<!-- Status Icon -->
										<div
											class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"
										>
											<BakeStatusIcon bakeStatus={latestEntry.bakeStatus} size="medium" />
										</div>

										<!-- Version Info -->
										<div class="flex-1">
											<h4 class="text-2xl font-bold text-gray-900 dark:text-white">
												{getDisplayVersion(latestEntry.version)}
											</h4>
											<div class="mt-1 flex items-center gap-2">
												{#if getRevisionInfo(latestEntry.version)}
													<Badge color="blue" size="small">
														{formatRevision(getRevisionInfo(latestEntry.version)!)}
													</Badge>
												{/if}
												{#if isCurrentVersionCustom}
													<Badge color="yellow" size="small">Custom</Badge>
												{/if}
												<Badge
													color={latestEntry.bakeStatus === 'Succeeded'
														? 'green'
														: latestEntry.bakeStatus === 'Failed'
															? 'red'
															: latestEntry.bakeStatus === 'Deploying'
																? 'blue'
																: latestEntry.bakeStatus === 'InProgress'
																	? 'yellow'
																	: 'gray'}
													size="small"
												>
													{latestEntry.bakeStatus}
												</Badge>
												{#if rollout.spec?.wantedVersion}
													<Badge size="small">Pinned</Badge>
												{/if}
												{#if rollout.status?.releaseCandidates && rollout.status.releaseCandidates.length > 0}
													<Badge color="orange" size="small">
														{rollout.status.releaseCandidates.length} upgrade{rollout.status
															.releaseCandidates.length > 1
															? 's'
															: ''}
													</Badge>
												{/if}
											</div>
										</div>
									</div>
								</div>

								<!-- Deployment Timeline -->
								<div class="mb-6">
									<h5 class="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
										Deployment Timeline
									</h5>

									<Timeline order="horizontal" class="w-full">
										<!-- Started -->
										<TimelineItem
											title="Started"
											date={formatTimeAgo(latestEntry.timestamp, $now)}
											class="min-w-0 flex-1 pr-3"
										>
											{#snippet orientationSlot()}
												<div class="flex items-center">
													<div
														class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-200 ring-0 ring-white sm:ring-8 dark:bg-blue-900 dark:ring-gray-800"
													>
														<ClockSolid class="h-4 w-4 text-blue-600 dark:text-blue-400" />
													</div>
													<div
														class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"
													></div>
												</div>
											{/snippet}
											{#if latestEntry.message}
												<Blockquote
													class="mt-2 break-words text-sm text-gray-600 dark:text-gray-400"
												>
													"{latestEntry.message}"
												</Blockquote>
											{/if}
										</TimelineItem>

										<!-- OpenKruise Rollout Progress (during baking and after completion) -->
										{@const openKruiseRollouts = Object.values(managedResources)
											.flat()
											.filter(
												(resource) =>
													resource.groupVersionKind === 'rollouts.kruise.io/v1beta1/Rollout'
											)}
										{@const validRollouts = openKruiseRollouts
											.map((rolloutResource) => {
												const kruiseRollout = rolloutResource.object as KruiseRollout;
												const rolloutData = kruiseRollout?.status?.canaryStatus;
												const canarySteps = kruiseRollout?.spec?.strategy?.canary?.steps;
												if (rolloutData && canarySteps && canarySteps.length > 0) {
													return {
														rolloutResource,
														kruiseRollout,
														rolloutData,
														canarySteps,
														isCompleted: kruiseRollout.status?.currentStepState === 'Completed'
													};
												}
												return null;
											})
											.filter((r): r is NonNullable<typeof r> => r !== null)}
										{#if validRollouts.length > 0}
											{@const allRolloutsCompleted = validRollouts.every((r) => r.isCompleted)}
											{@const anyRolloutPaused = validRollouts.some(
												(r) => r.rolloutData.currentStepState === 'StepPaused'
											)}
											<TimelineItem
												title={allRolloutsCompleted ? 'Rolled out' : 'Rolling out'}
												date={allRolloutsCompleted
													? 'All rollouts completed'
													: anyRolloutPaused
														? 'Some rollouts paused'
														: 'In progress'}
												class="min-w-0 flex-1 pr-3"
											>
												{#snippet orientationSlot()}
													<div class="flex items-center">
														<div
															class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-0 ring-white sm:ring-8 dark:ring-gray-800 {allRolloutsCompleted
																? 'bg-green-200 dark:bg-green-900'
																: anyRolloutPaused
																	? 'bg-yellow-200 dark:bg-yellow-900'
																	: 'bg-yellow-200 dark:bg-yellow-900'}"
														>
															{#if allRolloutsCompleted}
																<CheckCircleSolid
																	class="h-4 w-4 text-green-600 dark:text-green-400"
																/>
															{:else if anyRolloutPaused}
																<PauseSolid class="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
															{:else}
																<Spinner size="4" color="yellow" />
															{/if}
														</div>
														<div
															class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"
														></div>
													</div>
												{/snippet}
												<div class="mt-2 space-y-3">
													{#each validRollouts as rollout}
														<div class="space-y-2">
															<div class="flex items-center justify-between gap-2">
																<div class="flex items-center gap-2">
																	{#if rollout.rolloutData.currentStepState === 'Completed'}
																		<CheckCircleSolid
																			class="h-3 w-3 text-green-600 dark:text-green-400"
																		/>
																	{:else if rollout.rolloutData.currentStepState === 'StepPaused'}
																		<PauseSolid
																			class="h-3 w-3 text-yellow-600 dark:text-yellow-400"
																		/>
																	{:else}
																		<Spinner size="4" color="yellow" />
																	{/if}
																	<span class="text-sm text-gray-600 dark:text-gray-400">
																		{rollout.rolloutResource.namespace}
																		<span class="text-gray-500 dark:text-gray-400">/</span>
																		<span class="font-medium text-gray-700 dark:text-gray-300"
																			>{rollout.rolloutResource.name}</span
																		>
																	</span>
																</div>
																{#if rollout.rolloutData.currentStepState === 'StepPaused'}
																	{#if canUpdate}
																		<Button
																			size="xs"
																			color="blue"
																			onclick={() =>
																				continueRollout(
																					rollout.rolloutResource.name,
																					rollout.rolloutResource.namespace
																				)}
																		>
																			<PlaySolid class="mr-1 h-3 w-3" />
																			Continue
																		</Button>
																	{/if}
																{/if}
															</div>
															{#if !rollout.isCompleted}
																<StepIndicator
																	glow
																	currentStep={(rollout.rolloutData.currentStepIndex || 1) +
																		(rollout.rolloutData.currentStepState === 'Completed' ? 1 : 0)}
																	steps={rollout.canarySteps.map((step: any, index: number) =>
																		index === rollout.canarySteps.length - 1 &&
																		rollout.rolloutData.currentStepState === 'Completed'
																			? 'Completed'
																			: `Step ${index + 1}`
																	)}
																	color="blue"
																	size="sm"
																/>
															{/if}
														</div>
													{/each}
												</div>
											</TimelineItem>
										{/if}

										<!-- Baked -->
										{#if latestEntry.bakeStatus === 'Succeeded' && latestEntry.bakeEndTime}
											<TimelineItem
												title="Baked"
												date={formatTimeAgo(latestEntry.bakeEndTime, $now)}
												class="min-w-0 flex-1 pr-3"
											>
												{#snippet orientationSlot()}
													<div class="flex items-center">
														<div
															class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-200 ring-0 ring-white sm:ring-8 dark:bg-green-900 dark:ring-gray-800"
														>
															<CheckCircleSolid
																class="h-4 w-4 text-green-600 dark:text-green-400"
															/>
														</div>
														<div
															class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"
														></div>
													</div>
												{/snippet}
												<div class="mt-1 text-sm text-gray-600 dark:text-gray-400">
													Completed after {formatDuration(
														latestEntry.bakeStartTime || latestEntry.timestamp,
														new Date(latestEntry.bakeEndTime)
													)}
													{#if latestEntry.bakeStatusMessage}
														<br />
														{latestEntry.bakeStatusMessage}
													{/if}
												</div>
											</TimelineItem>
										{:else if latestEntry.bakeStatus === 'Pending' || !latestEntry.bakeStatus || latestEntry.bakeStatus === 'None'}
											<TimelineItem
												title="Bake"
												date={rollout.spec?.deployTimeout
													? (() => {
															const deploymentTime = new Date(latestEntry.timestamp).getTime();
															const currentTime = $now.getTime();
															const deployTimeoutMs = parseDuration(rollout.spec.deployTimeout);
															const timeoutTime = deploymentTime + deployTimeoutMs;
															const timeUntilTimeout = timeoutTime - currentTime;
															if (timeUntilTimeout > 0) {
																return `Will timeout in ${formatDurationFromMs(timeUntilTimeout)}`;
															} else {
																return 'Timed out';
															}
														})()
													: 'Waiting for bake to start...'}
												class="min-w-0 flex-1 pr-3"
											>
												{#snippet orientationSlot()}
													<div class="flex items-center">
														<div
															class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 ring-0 ring-white sm:ring-8 dark:bg-gray-700 dark:ring-gray-800"
														>
															<ClockSolid class="h-4 w-4 text-gray-600 dark:text-gray-400" />
														</div>
														<div
															class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"
														></div>
													</div>
												{/snippet}
												<div class="mt-1 text-sm text-gray-600 dark:text-gray-400">
													{#if latestEntry.bakeEndTime && latestEntry.bakeStartTime}
														Completed after {formatDuration(
															latestEntry.bakeStartTime,
															new Date(latestEntry.bakeEndTime)
														)}
														<br />
													{:else if latestEntry.bakeStartTime}
														Baking in progress...
														<br />
													{/if}
													{#if latestEntry.bakeStatusMessage}
														{latestEntry.bakeStatusMessage}
													{/if}
												</div>
											</TimelineItem>
										{:else if latestEntry.bakeStatus === 'Failed' && latestEntry.bakeEndTime}
											{@const failedHealthChecks = latestEntry.failedHealthChecks || []}
											<TimelineItem
												title="Deployment failed"
												date={formatTimeAgo(latestEntry.bakeEndTime, $now)}
												class="min-w-0 flex-1 pr-3"
											>
												{#snippet orientationSlot()}
													<div class="flex items-center">
														<div
															class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-200 ring-0 ring-white sm:ring-8 dark:bg-red-900 dark:ring-gray-800"
														>
															<ExclamationCircleSolid
																class="h-4 w-4 text-red-600 dark:text-red-400"
															/>
														</div>
														<div
															class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"
														></div>
													</div>
												{/snippet}
												<div class="mt-1 text-sm text-gray-600 dark:text-gray-400">
													Failed after {formatDuration(
														latestEntry.bakeStartTime || latestEntry.timestamp,
														new Date(latestEntry.bakeEndTime)
													)}
													{#if latestEntry.bakeStatusMessage}
														<br />
														{latestEntry.bakeStatusMessage}
													{/if}
													{#if failedHealthChecks.length > 0}
														<div class="mt-2">
															<p
																class="mb-1.5 text-xs font-medium text-gray-900 dark:text-gray-100"
															>
																Failed Health Checks ({failedHealthChecks.length}):
															</p>
															<div class="flex flex-wrap gap-1.5">
																{#each failedHealthChecks as failedHC, index}
																	<HealthCheckBadge
																		failedHealthCheck={failedHC}
																		fullHealthCheck={findFullHealthCheck(failedHC, healthChecks)}
																		{index}
																		prefix="failed-hc-timeline"
																	/>
																{/each}
															</div>
														</div>
													{/if}
												</div>
											</TimelineItem>
										{:else if latestEntry.bakeStatus === 'InProgress' && latestEntry.bakeStartTime}
											{@const bakeProgress = rollout.spec?.bakeTime
												? (() => {
														const bakeStartTime = new Date(latestEntry.bakeStartTime).getTime();
														const currentTime = $now.getTime();
														const elapsedTime = currentTime - bakeStartTime;
														const bakeTimeMs = parseDuration(rollout.spec.bakeTime);
														if (bakeTimeMs > 0) {
															return Math.min(100, Math.max(0, (elapsedTime / bakeTimeMs) * 100));
														}
														return 0;
													})()
												: 0}
											<TimelineItem
												title="Baking"
												date={rollout.spec?.bakeTime
													? (() => {
															const deploymentTime = new Date(latestEntry.timestamp).getTime();
															const currentTime = $now.getTime();
															const elapsedTime = currentTime - deploymentTime;
															const bakeTimeMs = parseDuration(rollout.spec.bakeTime);
															if (elapsedTime < bakeTimeMs) {
																const remainingTime = bakeTimeMs - elapsedTime;
																return `Waiting for at least ${formatDurationFromMs(remainingTime)}`;
															} else {
																return 'Baking in progress...';
															}
														})()
													: 'Waiting for bake to start...'}
												class="min-w-0 flex-1 pr-3"
											>
												{#snippet orientationSlot()}
													<div class="flex items-center">
														<div
															class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-0 ring-white sm:ring-8 dark:ring-gray-800 {latestEntry.bakeStatus ===
															'InProgress'
																? 'bg-yellow-200 dark:bg-yellow-900'
																: healthChecks.every((hc) => hc.status?.status === 'Healthy')
																	? 'bg-green-200 dark:bg-green-900'
																	: healthChecks.some((hc) => hc.status?.status === 'Unhealthy')
																		? 'bg-red-200 dark:bg-red-900'
																		: 'bg-yellow-200 dark:bg-yellow-900'}"
														>
															{#if latestEntry.bakeStatus === 'InProgress'}
																<Spinner size="4" color="yellow" />
															{:else if healthChecks.every((hc) => hc.status?.status === 'Healthy')}
																<CheckCircleSolid
																	class="h-4 w-4 text-green-600 dark:text-green-400"
																/>
															{:else if healthChecks.some((hc) => hc.status?.status === 'Unhealthy')}
																<ExclamationCircleSolid
																	class="h-4 w-4 text-red-600 dark:text-red-400"
																/>
															{:else}
																<ClockSolid class="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
															{/if}
														</div>
														<div
															class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"
														></div>
													</div>
												{/snippet}
												<div class="mt-1 space-y-2">
													<div class="text-sm text-gray-600 dark:text-gray-400">
														{latestEntry.bakeStatusMessage || 'Baking in progress...'}
													</div>
													{#if rollout.spec?.bakeTime}
														{@const remainingTime = (() => {
															const bakeStartTime = latestEntry.bakeStartTime
																? new Date(latestEntry.bakeStartTime).getTime()
																: new Date(latestEntry.timestamp).getTime();
															const currentTime = $now.getTime();
															const elapsedTime = currentTime - bakeStartTime;
															const bakeTimeMs = parseDuration(rollout.spec.bakeTime);
															return Math.max(0, bakeTimeMs - elapsedTime);
														})()}
														<div class="w-full">
															<div class="mb-1 flex items-center justify-between text-xs">
																<span class="text-gray-600 dark:text-gray-400">Bake Progress</span>
																<span class="font-medium text-gray-700 dark:text-gray-300">
																	{Math.round(bakeProgress)}%
																</span>
															</div>
															<div class="relative">
																<div
																	class="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
																>
																	<div
																		class="h-full rounded-full bg-yellow-500 transition-all duration-300 ease-out dark:bg-yellow-600"
																		style="width: {bakeProgress}%"
																	></div>
																</div>
																<div class="mt-0.5 flex justify-end">
																	<span class="text-xs text-gray-500 dark:text-gray-400">
																		{remainingTime > 0
																			? `${formatDurationFromMs(remainingTime)} remaining`
																			: 'Baking complete'}
																	</span>
																</div>
															</div>
														</div>
													{/if}
												</div>
											</TimelineItem>
										{:else if latestEntry.bakeStatus === 'Deploying'}
											<TimelineItem
												title="Deploying"
												date="Deployment in progress..."
												class="min-w-0 flex-1 pr-3"
											>
												{#snippet orientationSlot()}
													<div class="flex items-center">
														<div
															class="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-200 ring-0 ring-white sm:ring-8 dark:bg-blue-900 dark:ring-gray-800"
														>
															<Spinner size="4" color="blue" />
														</div>
														<div
															class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"
														></div>
													</div>
												{/snippet}
												<div class="mt-1 text-sm text-gray-600 dark:text-gray-400">
													{latestEntry.bakeStatusMessage || 'Deployment in progress...'}
												</div>
											</TimelineItem>
										{/if}
									</Timeline>
								</div>

								<!-- Action Buttons -->
								<div class="flex flex-wrap gap-3">
									{#if rollout?.status?.source}
										<GitHubViewButton
											sourceUrl={rollout.status.source}
											version={getDisplayVersion(latestEntry.version)}
											size="sm"
											color="light"
										/>
									{/if}
									{#if canModify}
										<Button
											size="sm"
											color="light"
											class="text-xs"
											disabled={!isDashboardManagingWantedVersion}
											onclick={() => {
												if (isDashboardManagingWantedVersion) {
													isPinVersionMode = false;
													showPinModal = true;
												}
											}}
										>
											<EditOutline class="me-2 h-4 w-4" />
											Change Version
										</Button>
									{/if}
									{#if !isDashboardManagingWantedVersion}
										<Tooltip placement="bottom"
											>Version management disabled: This rollout's wantedVersion field is managed by
											another controller or external system. The dashboard cannot pin it to prevent
											conflicts.</Tooltip
										>
									{/if}
									{#if rollout?.status?.history && rollout.status.history.length > 1}
										{#if canModify}
											<Button
												size="sm"
												color="light"
												class="text-xs"
												disabled={!isDashboardManagingWantedVersion}
												onclick={() => {
													if (
														isDashboardManagingWantedVersion &&
														rollout?.status?.history &&
														rollout.status.history.length > 1
													) {
														const previousVersion = rollout.status.history[1];
														isPinVersionMode = true;
														selectedVersion = previousVersion.version.tag;
														pinVersionToggle = true;
														const currentVersion = rollout.status.history[0].version;
														const currentVersionName = getDisplayVersion(currentVersion);
														const targetVersionName = getDisplayVersion(previousVersion.version);
														deployExplanation = `Rollback from ${currentVersionName} to ${targetVersionName} due to issues with the current deployment.`;
														showDeployModal = true;
													}
												}}
											>
												<ReplyOutline class="me-2 h-4 w-4" />
												Rollback
											</Button>
										{/if}
									{/if}
									{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
										<SourceViewer
											namespace={rollout.metadata?.namespace || ''}
											name={rollout.metadata?.name || ''}
											version={latestEntry.version.tag}
										/>
									{/if}
								</div>
							</Card>
						{/if}

						<!-- Health Checks Card -->
						{#if healthChecks.length > 0}
							<Card class="w-full max-w-none p-6">
								<div class="mb-4 flex items-center justify-between">
									<h4
										class="flex items-center gap-2 text-lg font-medium text-gray-900 dark:text-white"
									>
										<HeartSolid class="h-5 w-5" />
										Health Checks
									</h4>
									<div class="flex items-center gap-2">
										<Badge color="blue" size="small">
											{healthChecks.filter((hc) => hc.status?.status === 'Healthy').length} / {healthChecks.length}
											healthy
										</Badge>
									</div>
								</div>
								{#if healthChecks.filter((hc) => hc.status?.status !== 'Healthy').length > 0}
									<div class="space-y-0">
										{#each healthChecks.filter((hc) => hc.status?.status !== 'Healthy') as healthCheck (healthCheck.metadata?.name + '/' + healthCheck.metadata?.namespace)}
											<div
												class="border-b border-gray-200 py-4 last:border-b-0 dark:border-gray-700"
											>
												<div class="flex items-center justify-between">
													<div class="flex items-center gap-3">
														<div class="flex h-8 w-8 items-center justify-center">
															{#if healthCheck.status?.status === 'Healthy'}
																<CheckCircleSolid
																	class="h-5 w-5 text-green-600 dark:text-green-400"
																/>
															{:else if healthCheck.status?.status === 'Unhealthy'}
																<ExclamationCircleSolid
																	class="h-5 w-5 text-red-600 dark:text-red-400"
																/>
															{:else if healthCheck.status?.status === 'Pending'}
																<Spinner size="6" color="yellow" />
															{:else}
																<ExclamationCircleSolid
																	class="h-5 w-5 text-gray-500 dark:text-gray-400"
																/>
															{/if}
														</div>
														<div class="min-w-0 flex-1">
															<h3
																class="truncate text-sm font-medium text-gray-900 dark:text-white"
															>
																{healthCheck.metadata?.annotations?.['kuberik.com/display-name'] ||
																	healthCheck.metadata?.name}
															</h3>
															{#if healthCheck.spec?.class}
																<p class="text-xs text-gray-500 dark:text-gray-400">
																	{healthCheck.spec.class.charAt(0).toUpperCase() +
																		healthCheck.spec.class.slice(1)}
																</p>
															{/if}
														</div>
													</div>
													<div class="flex items-center gap-2">
														{#if healthCheck.status?.lastChangeTime}
															<div class="text-xs text-gray-500 dark:text-gray-400">
																{formatTimeAgo(healthCheck.status.lastChangeTime, $now)}
															</div>
														{/if}
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
												</div>

												{#if healthCheck.status?.message}
													<div class="ml-11 mt-2">
														<p class="mb-1 text-xs text-gray-600 dark:text-gray-400">
															{healthCheck.status.message}
														</p>
													</div>
												{/if}
												{#if healthCheck.status?.lastErrorTime && healthCheck.status?.status === 'Unhealthy'}
													<div class="ml-11 mt-1">
														<div
															class="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
														>
															<ExclamationCircleSolid class="h-3 w-3" />
															<span
																>Error {formatTimeAgo(healthCheck.status.lastErrorTime, $now)}</span
															>
														</div>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{:else}
									<div class="flex items-center justify-center py-8">
										<div class="text-center">
											<div class="mb-2 flex items-center justify-center">
												<CheckCircleSolid class="h-8 w-8 text-green-600 dark:text-green-400" />
											</div>
											<p class="text-sm font-medium text-gray-900 dark:text-white">
												All health checks are healthy
											</p>
										</div>
									</div>
								{/if}
							</Card>
						{/if}

						<!-- Kubernetes Resources Status Card -->
						{#if kustomizations.length > 0 || ociRepositories.length > 0 || (managedResources && Object.keys(managedResources).length > 0)}
							<Card class="w-full max-w-none p-6">
								<div class="mb-4 flex items-center justify-between">
									<h4
										class="flex items-center gap-2 text-lg font-medium text-gray-900 dark:text-white"
									>
										<CubesStackedSolid class="h-5 w-5" />
										Kubernetes Resources Status
									</h4>
									{#if kustomizations.length > 0 || ociRepositories.length > 0 || (managedResources && Object.keys(managedResources).length > 0)}
										{@const allResources = [
											...kustomizations.map((k) => ({
												name: k.metadata?.name,
												namespace: k.metadata?.namespace,
												status: getResourceStatus(k).status,
												message: k.status?.lastAppliedRevision
													? `Last applied: ${k.status.lastAppliedRevision}`
													: undefined,
												lastModified: getLastTransitionTime(k),
												groupVersionKind: 'Kustomization',
												type: 'Kustomization'
											})),
											...ociRepositories.map((r) => ({
												name: r.metadata?.name,
												namespace: r.metadata?.namespace,
												status: getResourceStatus(r).status,
												message: r.status?.url ? `URL: ${r.status.url}` : undefined,
												lastModified: getLastTransitionTime(r),
												groupVersionKind: 'OCIRepository',
												type: 'OCIRepository'
											})),
											...Object.values(filteredManagedResources)
												.flat()
												.map((r) => ({
													...r,
													type: r.groupVersionKind?.split('/').pop() || 'Resource'
												}))
										]}
										{@const healthyResources = allResources.filter(
											(r) =>
												r.status === 'Ready' ||
												r.status === 'Healthy' ||
												r.status === 'Succeeded' ||
												r.status === 'Current'
										)}
										<Badge color="blue" size="small">
											{healthyResources.length} / {allResources.length} healthy
										</Badge>
									{/if}
								</div>

								<div class="space-y-4">
									{#if kustomizations.length > 0 || ociRepositories.length > 0 || (managedResources && Object.keys(managedResources).length > 0)}
										{@const allResources = [
											...kustomizations.map((k) => ({
												name: k.metadata?.name,
												namespace: k.metadata?.namespace,
												status: getResourceStatus(k).status,
												message: k.status?.lastAppliedRevision
													? `Last applied: ${k.status.lastAppliedRevision}`
													: undefined,
												lastModified: getLastTransitionTime(k),
												groupVersionKind: 'Kustomization',
												type: 'Kustomization'
											})),
											...ociRepositories.map((r) => ({
												name: r.metadata?.name,
												namespace: r.metadata?.namespace,
												status: getResourceStatus(r).status,
												message: r.status?.url ? `URL: ${r.status.url}` : undefined,
												lastModified: getLastTransitionTime(r),
												groupVersionKind: 'OCIRepository',
												type: 'OCIRepository'
											})),
											...Object.values(filteredManagedResources)
												.flat()
												.map((r) => ({
													...r,
													type: r.groupVersionKind?.split('/').pop() || 'Resource'
												}))
										]}
										{@const pendingResources = allResources.filter(
											(r) =>
												r.status === 'Failed' ||
												r.status === 'Error' ||
												r.status === 'InProgress' ||
												r.status === 'Pending' ||
												r.status === 'Unhealthy'
										)}
										{@const healthyResources = allResources.filter(
											(r) =>
												r.status === 'Ready' ||
												r.status === 'Healthy' ||
												r.status === 'Succeeded' ||
												r.status === 'Current'
										)}

										{#if pendingResources.length > 0}
											<div>
												{#each pendingResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
													<ResourceCard {resource} resourceType={resource.type} showRich={true} />
												{/each}
											</div>
										{/if}

										{#if healthyResources.length > 0 && pendingResources.length === 0}
											<div class="flex items-center justify-center py-8">
												<div class="text-center">
													<div class="mb-2 flex items-center justify-center">
														<CheckCircleSolid class="h-8 w-8 text-green-600 dark:text-green-400" />
													</div>
													<p class="text-sm font-medium text-gray-900 dark:text-white">
														All resources are healthy
													</p>
												</div>
											</div>
										{/if}
									{/if}
								</div>
							</Card>
						{/if}

						<!-- Available Versions Card -->
						<Card class="w-full max-w-none p-6 lg:col-span-2">
							<div class="mb-4 flex items-center justify-between">
								<h4
									class="flex items-center gap-2 text-lg font-medium text-gray-900 dark:text-white"
								>
									<CodeOutline class="h-5 w-5" />
									Available Version Upgrades
								</h4>
								{#if rollout.status?.releaseCandidates && rollout.status.releaseCandidates.length > 0}
									<Badge color="blue" size="small">{rollout.status.releaseCandidates.length}</Badge>
								{/if}
							</div>
							{#if rollout.spec?.wantedVersion}
								<Alert color="yellow" class="mb-4">
									<div class="flex items-center justify-between gap-3">
										<div class="flex items-center gap-2">
											<PauseSolid class="h-4 w-4" />
											<span class="text-sm"
												>Automated upgrades are paused because the rollout is pinned to a version.</span
											>
										</div>
										{#if canModify}
											<Button
												size="xs"
												color="light"
												disabled={!isDashboardManagingWantedVersion}
												onclick={() => {
													showClearPinModal = true;
												}}
											>
												Clear pin
											</Button>
										{/if}
									</div>
								</Alert>
							{/if}
							{#if rollout.status?.releaseCandidates && rollout.status.releaseCandidates.length > 0}
								<div>
									{#each rollout.status.releaseCandidates as releaseCandidate}
										{@const version = releaseCandidate.tag}
										<div class="border-b border-gray-200 py-4 last:border-b-0 dark:border-gray-700">
											<div
												class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
											>
												<div class="flex items-center gap-3">
													<!-- Version and time stacked vertically -->
													<div class="flex flex-col gap-1">
														<!-- Version row -->
														<h6 class="truncate text-sm font-medium text-gray-900 dark:text-white">
															{getDisplayVersion(releaseCandidate)}
														</h6>
														<!-- Time and Dependency row -->
														<div class="flex flex-wrap items-center gap-2">
															{#if releaseCandidate.created}
																<Badge
																	color="gray"
																	border
																	size="small"
																	class="flex items-center gap-1"
																>
																	<ClockSolid class="h-3 w-3" />
																	{formatTimeAgo(releaseCandidate.created, $now)}
																</Badge>
															{/if}
															{#if getDependencyStatus(version)}
																{@const depBakeStatus = getDependencyStatus(version)}
																{#if depBakeStatus}
																	{@const depStatusInfo = getBakeStatusIcon(
																		depBakeStatus ?? undefined
																	)}
																	{@const DepStatusIcon = depStatusInfo.icon}
																	{@const valueColor =
																		depBakeStatus === 'Succeeded'
																			? 'green'
																			: depBakeStatus === 'Failed'
																				? 'red'
																				: depBakeStatus === 'InProgress'
																					? 'yellow'
																					: 'gray'}
																	<JoinedBadge
																		label="Dependency"
																		value={depBakeStatus}
																		icon={DepStatusIcon}
																		iconColor={depStatusInfo.color}
																		{valueColor}
																	/>
																{/if}
															{/if}
														</div>
													</div>
												</div>
												<!-- Action buttons on the right -->
												<div class="flex flex-wrap items-center gap-2 sm:justify-end">
													{#if canModify}
														<Button
															size="xs"
															color="blue"
															disabled={!isDashboardManagingWantedVersion &&
																!hasForceDeployAnnotation(rollout)}
															onclick={() => {
																selectedVersion = version;
																showDeployModal = true;
															}}
														>
															Deploy
														</Button>
													{/if}
													{#if rollout?.status?.source}
														<GitHubViewButton
															sourceUrl={rollout.status.source}
															version={getDisplayVersion(releaseCandidate)}
															size="xs"
															color="light"
														/>
													{/if}
													<Clipboard value={releaseCandidate.tag} size="xs" color="light">
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
													<!-- Blocked/Ready badge - far right -->
													{#if rollout.status?.gatedReleaseCandidates
														?.map((grc) => grc.tag)
														.includes(version)}
														<Badge color="green" size="small">Ready</Badge>
													{:else}
														{@const blockingGates = getBlockingGates(version)}
														{#if blockingGates.length > 0}
															<Badge color="yellow" size="small" class="cursor-help">
																Blocked
																<QuestionCircleOutline class="ml-1 h-3 w-3" />
															</Badge>
															<Popover class="max-w-sm" title="Blocked by Gates">
																<div class="p-3">
																	<div class="space-y-2">
																		{#each blockingGates as gate}
																			<div class="flex items-start gap-2">
																				<ExclamationCircleSolid
																					class="mt-0.5 h-4 w-4 text-yellow-600 dark:text-yellow-400"
																				/>
																				<div class="min-w-0 flex-1">
																					<p
																						class="text-sm font-medium text-gray-900 dark:text-white"
																					>
																						{getGatePrettyName(gate) ||
																							gate.metadata?.name ||
																							'Unknown Gate'}
																					</p>
																					{#if getGateDescription(gate)}
																						<p class="text-xs text-gray-600 dark:text-gray-400">
																							{getGateDescription(gate)}
																						</p>
																					{/if}
																					{#if gate.status?.status}
																						<p class="text-xs text-yellow-600 dark:text-yellow-400">
																							Status: {gate.status.status}
																						</p>
																					{/if}
																				</div>
																			</div>
																		{/each}
																	</div>
																</div>
															</Popover>
														{:else}
															<Badge color="yellow" size="small">Blocked</Badge>
														{/if}
													{/if}
												</div>
											</div>
										</div>
									{/each}
								</div>
							{:else if isCurrentVersionCustom}
								<Alert color="yellow">
									<div class="flex items-center gap-3">
										<InfoCircleSolid class="h-5 w-5" />
										<span class="text-lg font-medium">Current version is custom</span>
									</div>
									<p class="mb-4 mt-2 text-sm">
										The currently deployed version is not in the available releases list. This means
										it's a custom version that was manually deployed. To change to a different
										version, you need to manually deploy another version.
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
								<Alert color="blue">
									<div class="flex items-center">
										<ExclamationCircleSolid class="mr-2 h-5 w-5" />
										<span class="font-medium">No version upgrades available</span>
									</div>
								</Alert>
							{/if}
						</Card>
					</div>
				</div>
			</div>
		</div>
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
							{#await loadAnnotationsOnDemand(versionTag)}{/await}
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
												<Clipboard value={versionTag} size="xs" color="light" class="">
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
					if (!selectedVersion) return;
					const tag = toTag(selectedVersion);
					const mustPin = isOlderThanCurrent(tag);
					isPinVersionMode = mustPin; // disables toggle in DeployModal when true
					pinVersionToggle = mustPin; // default to pin if older; allow user toggle if newer
					showDeployModal = true;
					showPinModal = false;
				}}
			>
				Change Version
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

<Modal bind:open={showClearPinModal} title="Clear Version Pin">
	<div class="space-y-4">
		<Alert color="yellow" class="mb-4">
			<div class="flex items-center">
				<ExclamationCircleSolid class="mr-2 h-4 w-4" />
				<p>
					<span class="font-medium">Clear Pin:</span> This will remove the version pin and allow automated
					upgrades to resume.
				</p>
			</div>
		</Alert>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Are you sure you want to clear the version pin for <b>{rollout?.metadata?.name}</b>?
		</p>
		<p class="text-xs text-gray-500 dark:text-gray-400">
			Once cleared, the rollout will resume automated upgrades based on available release
			candidates.
		</p>
		{#if !isDashboardManagingWantedVersion}
			<Alert color="yellow" class="mt-3">
				<div class="flex items-center">
					<ExclamationCircleSolid class="mr-2 h-4 w-4" />
					<p class="text-sm">
						<span class="font-medium">Warning:</span> The dashboard is not currently managing the wantedVersion
						field for this rollout. Clearing the pin may conflict with other controllers or external
						systems.
					</p>
				</div>
			</Alert>
		{/if}

		<div class="flex justify-end gap-2">
			<Button
				color="light"
				onclick={() => {
					showClearPinModal = false;
				}}
			>
				Cancel
			</Button>
			<Button
				color="blue"
				onclick={() => {
					showClearPinModal = false;
					clearPin();
				}}
			>
				Clear Pin
			</Button>
		</div>
	</div>
</Modal>

<DeployModal
	bind:open={showDeployModal}
	{rollout}
	selectedVersionTag={selectedVersion}
	selectedVersionDisplay={selectedVersionDisplay()}
	{isPinVersionMode}
	onSuccess={(m) => {
		toastType = 'success';
		toastMessage = m;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
	}}
	onError={(m) => {
		toastType = 'error';
		toastMessage = m;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
	}}
/>

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
</style>
