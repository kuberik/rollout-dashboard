<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { SvelteFlow, Background } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { createQuery } from '@tanstack/svelte-query';
	import { Card, Badge, Spinner, Alert } from 'flowbite-svelte';
	import { CheckCircleSolid, ExclamationCircleSolid, ClockSolid } from 'flowbite-svelte-icons';
	import type { Node, Edge } from '@xyflow/svelte';
	import DeploymentNode from '$lib/components/DeploymentNode.svelte';
	import SimpleNode from '$lib/components/SimpleNode.svelte';
	import { rolloutQueryOptions, type RolloutResponse } from '$lib/api/rollouts';
	import { getBakeStatusIcon } from '$lib/bake-status';
	import { getDisplayVersion } from '$lib/utils';
	import type { Rollout } from '../../../../../types';
	import type {
		EnvironmentStatusEntry,
		EnvironmentInfo
	} from '../../../../../types/environment-types';

	// Flattened entry with environment field added
	type DeploymentStatusWithEnv = EnvironmentStatusEntry & { environment: string };
	// @ts-ignore - dagre types may not be available
	import dagre from 'dagre';

	// Params
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	// Fetch rollout data
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			options: {
				refetchInterval: 5000
			}
		})
	);

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null | undefined);
	const environment = $derived(rolloutQuery.data?.environment);

	const environmentInfos = $derived(environment?.status?.environmentInfos ?? []);

	// Flatten history entries from all environmentInfos, adding environment field
	const deploymentStatuses = $derived.by(() => {
		const statuses: DeploymentStatusWithEnv[] = [];
		environmentInfos.forEach((envInfo: EnvironmentInfo) => {
			if (envInfo.history) {
				envInfo.history.forEach((entry: EnvironmentStatusEntry) => {
					statuses.push({ ...entry, environment: envInfo.environment });
				});
			}
		});
		return statuses;
	});

	// Get current environment from namespace (e.g., hello-world-dev -> dev)
	const currentEnvironment = $derived.by(() => {
		const parts = namespace.split('-');
		return parts[parts.length - 1] || namespace;
	});

	// Get available versions from rollout (for version index calculation)
	const availableVersions = $derived.by(() => {
		if (!rollout?.status?.availableReleases || rollout.status.availableReleases.length === 0) {
			return [];
		}
		// availableReleases are already sorted newest first
		return rollout.status.availableReleases.map((ar) => getDisplayVersion(ar));
	});

	// Collect all unique versions across all environments and sort them
	const allVersions = $derived.by(() => {
		if (!deploymentStatuses || deploymentStatuses.length === 0) return [];

		const versionMap = new Map<
			string,
			{ version: string; id: number; environments: Set<string> }
		>();

		deploymentStatuses.forEach((status: DeploymentStatusWithEnv) => {
			const versionStr = getDisplayVersion(status.version);
			if (!versionMap.has(versionStr)) {
				versionMap.set(versionStr, {
					version: versionStr,
					id: status.id || 0,
					environments: new Set()
				});
			}
			versionMap.get(versionStr)!.environments.add(status.environment);
		});

		// Sort by id (newest first)
		return Array.from(versionMap.values()).sort((a, b) => b.id - a.id);
	});

	// Build nodes and edges from environmentInfos with current/next state
	const nodes = $derived.by(() => {
		if (!environmentInfos || environmentInfos.length === 0) return [];

		const envInfos = environmentInfos;

		// Global version index (newest first) to compare environments
		// Use availableVersions from rollout, not deploymentStatuses
		const versionIndex = new Map<string, number>();
		availableVersions.forEach((version, idx) => {
			versionIndex.set(version, idx);
		});

		// Helper: get current version for an environment
		const getCurrentForEnv = (env: string): string | null => {
			const envStatuses = deploymentStatuses
				.filter((s: DeploymentStatusWithEnv) => s.environment === env)
				.sort(
					(a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) => (b.id || 0) - (a.id || 0)
				);
			const currentStatus =
				envStatuses.find((s: EnvironmentStatusEntry) => s.bakeStatus && s.bakeStatus !== 'None') ||
				envStatuses[0];
			return currentStatus ? getDisplayVersion(currentStatus.version) : null;
		};

		// Build dependency graph from relationships
		// Relationship type "After" means this environment depends on the related environment
		const envDependencies = new Map<string, string[]>();
		const envDependents = new Map<string, string[]>();
		envInfos.forEach((envInfo: EnvironmentInfo) => {
			const deps: string[] = [];
			if (envInfo.relationship?.type === 'After') {
				deps.push(envInfo.relationship.environment);
			}
			envDependencies.set(envInfo.environment, deps);
			deps.forEach((dep) => {
				if (!envDependents.has(dep)) {
					envDependents.set(dep, []);
				}
				envDependents.get(dep)!.push(envInfo.environment);
			});
		});

		// Find all environments related to current (dependencies, current, dependents)
		const relatedEnvs = new Set<string>();
		relatedEnvs.add(currentEnvironment);

		// Add dependencies of current
		const currentDeps = envDependencies.get(currentEnvironment) || [];
		currentDeps.forEach((dep) => relatedEnvs.add(dep));

		// Add dependents of current
		const currentDependents = envDependents.get(currentEnvironment) || [];
		currentDependents.forEach((dep) => relatedEnvs.add(dep));

		// Filter to only related environments
		const relatedEnvInfos = envInfos.filter((ei: EnvironmentInfo) =>
			relatedEnvs.has(ei.environment)
		);

		// Get current environment's version for comparison
		const currentEnvVersion = getCurrentForEnv(currentEnvironment);
		const currentEnvIdx = currentEnvVersion ? versionIndex.get(currentEnvVersion) : undefined;

		// Create nodes - current in middle, dependencies above, dependents below
		const nodeMap = new Map<string, Node>();

		// Top: dependencies (or "start" if none)
		if (currentDeps.length === 0) {
			// Add "start" node
			nodeMap.set('__start__', {
				id: '__start__',
				type: 'simple',
				position: { x: 0, y: 0 }, // Temporary, will be overridden by dagre
				draggable: false,
				selectable: false,
				data: { label: 'start', isStartEnd: true }
			});
		} else {
			// Add dependency nodes
			currentDeps.forEach((depEnv) => {
				const envInfo = relatedEnvInfos.find((ei: EnvironmentInfo) => ei.environment === depEnv);
				if (!envInfo) return;

				const envStatuses = deploymentStatuses
					.filter((s: DeploymentStatusWithEnv) => s.environment === depEnv)
					.sort(
						(a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) => (b.id || 0) - (a.id || 0)
					);
				const currentStatus =
					envStatuses.find(
						(s: EnvironmentStatusEntry) => s.bakeStatus && s.bakeStatus !== 'None'
					) || envStatuses[0];
				const currentVersion = currentStatus ? getDisplayVersion(currentStatus.version) : 'N/A';
				const envVersionIdx =
					currentVersion !== 'N/A' ? versionIndex.get(currentVersion) : undefined;

				nodeMap.set(depEnv, {
					id: depEnv,
					type: 'deployment',
					position: { x: 0, y: 0 }, // Temporary, will be overridden by dagre
					draggable: false,
					selectable: false,
					data: {
						environment: depEnv,
						currentVersion,
						bakeStatus: currentStatus?.bakeStatus,
						environmentInfo: envInfo,
						isCurrentEnvironment: false,
						versionIndex: envVersionIdx,
						currentEnvironmentVersionIndex: currentEnvIdx
					}
				});
			});
		}

		// Middle: current environment
		const currentEnvInfo = relatedEnvInfos.find(
			(ei: EnvironmentInfo) => ei.environment === currentEnvironment
		);
		if (currentEnvInfo) {
			const envStatuses = deploymentStatuses
				.filter((s: DeploymentStatusWithEnv) => s.environment === currentEnvironment)
				.sort(
					(a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) => (b.id || 0) - (a.id || 0)
				);
			const currentStatus =
				envStatuses.find((s: EnvironmentStatusEntry) => s.bakeStatus && s.bakeStatus !== 'None') ||
				envStatuses[0];
			const currentVersion = currentStatus ? getDisplayVersion(currentStatus.version) : 'N/A';
			const envVersionIdx = currentVersion !== 'N/A' ? versionIndex.get(currentVersion) : undefined;

			nodeMap.set(currentEnvironment, {
				id: currentEnvironment,
				type: 'deployment',
				position: { x: 0, y: 0 }, // Temporary, will be overridden by dagre
				draggable: false,
				selectable: false,
				data: {
					environment: currentEnvironment,
					currentVersion,
					bakeStatus: currentStatus?.bakeStatus,
					environmentInfo: currentEnvInfo,
					isCurrentEnvironment: true,
					versionIndex: envVersionIdx,
					currentEnvironmentVersionIndex: currentEnvIdx
				}
			});
		}

		// Bottom: dependents (or "end" if none)
		if (currentDependents.length === 0) {
			// Add "end" node
			nodeMap.set('__end__', {
				id: '__end__',
				type: 'simple',
				position: { x: 0, y: 0 }, // Temporary, will be overridden by dagre
				draggable: false,
				selectable: false,
				data: { label: 'end', isStartEnd: true }
			});
		} else {
			// Add dependent nodes
			currentDependents.forEach((depEnv) => {
				const envInfo = relatedEnvInfos.find((ei: EnvironmentInfo) => ei.environment === depEnv);
				if (!envInfo) return;

				const envStatuses = deploymentStatuses
					.filter((s: DeploymentStatusWithEnv) => s.environment === depEnv)
					.sort(
						(a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) => (b.id || 0) - (a.id || 0)
					);
				const currentStatus =
					envStatuses.find(
						(s: EnvironmentStatusEntry) => s.bakeStatus && s.bakeStatus !== 'None'
					) || envStatuses[0];
				const currentVersion = currentStatus ? getDisplayVersion(currentStatus.version) : 'N/A';
				const envVersionIdx =
					currentVersion !== 'N/A' ? versionIndex.get(currentVersion) : undefined;

				nodeMap.set(depEnv, {
					id: depEnv,
					type: 'deployment',
					position: { x: 0, y: 0 }, // Temporary, will be overridden by dagre
					draggable: false,
					selectable: false,
					data: {
						environment: depEnv,
						currentVersion,
						bakeStatus: currentStatus?.bakeStatus,
						environmentInfo: envInfo,
						isCurrentEnvironment: false,
						versionIndex: envVersionIdx,
						currentEnvironmentVersionIndex: currentEnvIdx
					}
				});
			});
		}

		return Array.from(nodeMap.values());
	});

	// Helper function to get node dimensions
	function getNodeDimensions(node: Node): { width: number; height: number } {
		if (node.type === 'simple') {
			return { width: 120, height: 80 };
		}
		// deployment node - fixed width for consistent layout alignment
		return { width: 320, height: 110 };
	}

	// Apply dagre layout to nodes
	const layoutedNodes = $derived.by(() => {
		if (nodes.length === 0) return [];

		const graphEdges = edges.map((edge) => ({
			source: edge.source,
			target: edge.target
		}));

		// Create dagre graph
		const g = new dagre.graphlib.Graph();
		g.setDefaultEdgeLabel(() => ({}));
		g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 120 });

		// Add nodes to dagre graph
		nodes.forEach((node) => {
			const { width, height } = getNodeDimensions(node);
			g.setNode(node.id, { width, height });
		});

		// Add edges to dagre graph
		graphEdges.forEach((edge) => {
			g.setEdge(edge.source, edge.target);
		});

		// Calculate layout
		dagre.layout(g);

		// Apply positions from dagre to nodes
		// Dagre returns center positions, so we need to convert to top-left
		return nodes.map((node) => {
			const dagreNode = g.node(node.id);
			if (!dagreNode) return node;
			return {
				...node,
				position: {
					x: dagreNode.x - dagreNode.width / 2,
					y: dagreNode.y - dagreNode.height / 2
				}
			};
		});
	});

	const edges = $derived.by(() => {
		if (!environmentInfos || environmentInfos.length === 0) return [];

		const envInfos = environmentInfos;
		const edgeList: Edge[] = [];

		// Build dependency graph from relationships
		const envDependencies = new Map<string, string[]>();
		const envDependents = new Map<string, string[]>();
		envInfos.forEach((envInfo: EnvironmentInfo) => {
			const deps: string[] = [];
			if (envInfo.relationship?.type === 'After') {
				deps.push(envInfo.relationship.environment);
			}
			envDependencies.set(envInfo.environment, deps);
			deps.forEach((dep) => {
				if (!envDependents.has(dep)) {
					envDependents.set(dep, []);
				}
				envDependents.get(dep)!.push(envInfo.environment);
			});
		});

		const relatedEnvs = new Set<string>();
		relatedEnvs.add(currentEnvironment);
		(envDependencies.get(currentEnvironment) || []).forEach((dep) => relatedEnvs.add(dep));
		(envDependents.get(currentEnvironment) || []).forEach((dep) => relatedEnvs.add(dep));

		const currentDeps = envDependencies.get(currentEnvironment) || [];
		const currentDependents = envDependents.get(currentEnvironment) || [];

		// Add edges from dependencies to current
		if (currentDeps.length === 0) {
			// Edge from start to current
			edgeList.push({
				id: '__start__-current',
				source: '__start__',
				target: currentEnvironment,
				type: 'smoothstep',
				animated: true,
				style: 'stroke: #6b7280; stroke-width: 2.5;',
				markerEnd: {
					type: 'arrowclosed',
					color: '#6b7280'
				}
			});
		} else {
			// Edges from each dependency to current
			currentDeps.forEach((dep) => {
				if (!relatedEnvs.has(dep)) return;
				edgeList.push({
					id: `${dep}-${currentEnvironment}`,
					source: dep,
					target: currentEnvironment,
					type: 'smoothstep',
					animated: true,
					style: 'stroke: #6b7280; stroke-width: 2.5;',
					markerEnd: {
						type: 'arrowclosed',
						color: '#6b7280'
					}
				});
			});
		}

		// Add edges from current to dependents
		if (currentDependents.length === 0) {
			// Edge from current to end
			edgeList.push({
				id: `current-__end__`,
				source: currentEnvironment,
				target: '__end__',
				type: 'smoothstep',
				animated: true,
				style: 'stroke: #6b7280; stroke-width: 2.5;',
				markerEnd: {
					type: 'arrowclosed',
					color: '#6b7280'
				}
			});
		} else {
			// Edges from current to each dependent
			currentDependents.forEach((dep) => {
				if (!relatedEnvs.has(dep)) return;
				edgeList.push({
					id: `${currentEnvironment}-${dep}`,
					source: currentEnvironment,
					target: dep,
					type: 'smoothstep',
					animated: true,
					style: 'stroke: #6b7280; stroke-width: 2.5;',
					markerEnd: {
						type: 'arrowclosed',
						color: '#6b7280'
					}
				});
			});
		}

		return edgeList;
	});

	const nodeTypes = {
		deployment: DeploymentNode,
		simple: SimpleNode
	};

	const environments = $derived.by(() => {
		if (!environmentInfos || environmentInfos.length === 0) return [];

		// Compute a simple "progress index" per env based on its current version
		const envInfos = environmentInfos;

		return [...envInfos]
			.map((envInfo: EnvironmentInfo) => {
				const env = envInfo.environment;
				const statuses = deploymentStatuses
					.filter((s: DeploymentStatusWithEnv) => s.environment === env)
					.sort(
						(a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) => (b.id || 0) - (a.id || 0)
					);
				const currentStatus =
					statuses.find((s: EnvironmentStatusEntry) => s.bakeStatus && s.bakeStatus !== 'None') ||
					statuses[0];
				const currentVersion = currentStatus ? getDisplayVersion(currentStatus.version) : null;
				const idx = currentVersion
					? allVersions.findIndex((v) => v.version === currentVersion)
					: Number.POSITIVE_INFINITY;
				return { env, idx };
			})
			.sort((a, b) => a.idx - b.idx)
			.map((e) => e.env);
	});

	// Current version per environment (for global timeline)
	const currentVersionsByEnv = $derived.by(() => {
		const map = new Map<string, string>();
		if (!environmentInfos || environmentInfos.length === 0) return map;

		environmentInfos.forEach((envInfo: EnvironmentInfo) => {
			const envStatuses = deploymentStatuses
				.filter((s: DeploymentStatusWithEnv) => s.environment === envInfo.environment)
				.sort(
					(a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) => (b.id || 0) - (a.id || 0)
				);
			const currentStatus =
				envStatuses.find((s: EnvironmentStatusEntry) => s.bakeStatus && s.bakeStatus !== 'None') ||
				envStatuses[0];
			if (currentStatus) {
				const versionStr = getDisplayVersion(currentStatus.version);
				map.set(envInfo.environment, versionStr);
			}
		});

		return map;
	});

	// Versions to show in the global swimlane (oldest on the left, newest on the right)
	const timelineVersions = $derived.by(() => {
		// allVersions is newest-first; reverse to get oldest-left layout
		return [...allVersions].slice(0, 12).reverse();
	});

	// Version summary for the current rollout/environment
	const versionSummary = $derived.by(() => {
		const result: {
			currentVersion: string | null;
			deployed: Array<{ version: string; bakeStatus?: string }>;
			upcoming: Array<{
				version: string;
				dependencyBakeStatus?: string;
				state: 'not-available' | 'failed' | 'cancelled' | 'succeeded' | 'evaluating';
			}>;
		} = {
			currentVersion: null,
			deployed: [],
			upcoming: []
		};

		if (!environmentInfos || environmentInfos.length === 0 || allVersions.length === 0) {
			return result;
		}

		const envInfos = environmentInfos;
		const currentEnvInfo = envInfos.find(
			(e: EnvironmentInfo) => e.environment === currentEnvironment
		);
		const currentDeps: string[] = [];
		if (currentEnvInfo?.relationship?.type === 'After') {
			currentDeps.push(currentEnvInfo.relationship.environment);
		}

		// Current environment statuses
		const envStatuses = deploymentStatuses
			.filter((s: DeploymentStatusWithEnv) => s.environment === currentEnvironment)
			.sort((a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) => (b.id || 0) - (a.id || 0));
		const currentStatus =
			envStatuses.find((s: EnvironmentStatusEntry) => s.bakeStatus && s.bakeStatus !== 'None') ||
			envStatuses[0];
		if (!currentStatus) {
			return result;
		}

		const currentVersionStr = getDisplayVersion(currentStatus.version);
		result.currentVersion = currentVersionStr;

		const currentIdx = allVersions.findIndex((v) => v.version === currentVersionStr);
		if (currentIdx === -1) return result;

		// Deployed versions (history) for the current environment, including current
		// Use bakeStatus directly from environmentInfo history, not from rollout history
		const seen = new Set<string>();
		for (const s of envStatuses) {
			const versionStr = getDisplayVersion(s.version);
			if (!versionStr || seen.has(versionStr)) continue;
			seen.add(versionStr);

			// Use bakeStatus directly from the environment history entry
			result.deployed.push({
				version: versionStr,
				bakeStatus: s.bakeStatus
			});
			if (result.deployed.length >= 6) break;
		}

		// Upcoming newer versions (relative to current)
		// Only show versions that are strictly newer than current (i < currentIdx)
		// AND are in releaseCandidates
		// Iterate from newest (index 0) to currentIdx - 1 to maintain newest-first order

		// Build a set of release candidate versions for quick lookup
		const releaseCandidateVersions = new Set<string>();
		if (rollout?.status?.releaseCandidates) {
			rollout.status.releaseCandidates.forEach((rc) => {
				const versionStr = getDisplayVersion(rc);
				releaseCandidateVersions.add(versionStr);
			});
		}

		if (currentIdx > 0) {
			for (let i = 0; i < currentIdx && result.upcoming.length < 10; i++) {
				const candidate = allVersions[i];
				if (!candidate) continue;

				const version = candidate.version;

				// Only include versions that are in releaseCandidates
				if (!releaseCandidateVersions.has(version)) continue;

				// Check deployments of this version in direct dependencies
				const depStatuses = deploymentStatuses.filter(
					(s: DeploymentStatusWithEnv) =>
						currentDeps.includes(s.environment) && getDisplayVersion(s.version) === version
				);

				// Determine state based on dependency statuses
				let state: 'not-available' | 'failed' | 'cancelled' | 'succeeded' | 'evaluating';
				let combinedBakeStatus: string | undefined;

				if (currentDeps.length === 0) {
					// No dependencies, so it's available
					state = 'succeeded';
					combinedBakeStatus = 'Succeeded';
				} else if (depStatuses.length === 0) {
					// Not yet available in any dependency
					state = 'not-available';
					combinedBakeStatus = undefined;
				} else {
					// Determine combined bakeStatus from dependencies
					const bakeStatuses = depStatuses
						.map((s: EnvironmentStatusEntry) => s.bakeStatus)
						.filter(Boolean);

					if (bakeStatuses.some((bs) => bs === 'Failed')) {
						state = 'failed';
						combinedBakeStatus = 'Failed';
					} else if (bakeStatuses.some((bs) => bs === 'Cancelled')) {
						state = 'cancelled';
						combinedBakeStatus = 'Cancelled';
					} else if (
						currentDeps.every((dep) =>
							depStatuses.some(
								(s: DeploymentStatusWithEnv) =>
									s.environment === dep && s.bakeStatus === 'Succeeded'
							)
						)
					) {
						// All dependencies have succeeded
						state = 'succeeded';
						combinedBakeStatus = 'Succeeded';
					} else if (bakeStatuses.some((bs) => bs === 'InProgress')) {
						state = 'evaluating';
						combinedBakeStatus = 'InProgress';
					} else {
						// Some other status or not all dependencies have this version
						state = 'evaluating';
						combinedBakeStatus = bakeStatuses[0] || 'None';
					}
				}

				result.upcoming.push({ version, dependencyBakeStatus: combinedBakeStatus, state });
			}
		}

		return result;
	});
</script>

<svelte:head>
	<title
		>kuberik | {rollout?.metadata
			? `${rollout.metadata.name} (${rollout.metadata.namespace}) - Environments`
			: 'Environments'}</title
	>
</svelte:head>

<div class="flex h-full w-full flex-col p-4">
	{#if rolloutQuery.isLoading}
		<div class="flex h-full items-center justify-center">
			<Spinner size="8" />
		</div>
	{:else if rolloutQuery.error}
		<Alert color="red" class="mb-4">
			Error loading deployment pipeline: {rolloutQuery.error.message}
		</Alert>
	{:else if !environmentInfos || environmentInfos.length === 0 || nodes.length === 0}
		<Card class="mb-4">
			<p class="text-gray-600 dark:text-gray-400">
				No environment information found. The deployment pipeline will appear here once deployments
				with environment relationships are configured.
			</p>
		</Card>
	{:else}
		<div
			class="flex w-full flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
		>
			<div class="flex h-full w-full">
				<!-- Left: version list focused on current rollout -->
				<div
					class="min-w-sm max-w-md overflow-y-auto border-r border-gray-200 p-4 dark:border-gray-700"
				>
					<h3 class="mb-1 text-sm font-semibold text-gray-900 dark:text-white">Version Status</h3>
					<p class="mb-3 text-xs text-gray-600 dark:text-gray-400">
						Shows how versions relate to the current environment and its direct dependencies.
					</p>

					<!-- Upcoming versions -->
					<div class="mb-4">
						<div class="mb-1 flex items-center justify-between">
							<div
								class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
							>
								Upcoming
							</div>
						</div>
						{#if versionSummary.upcoming.length === 0}
							<div class="text-xs text-gray-400 dark:text-gray-500">
								No newer versions available.
							</div>
						{:else}
							<div class="space-y-1.5">
								{#each versionSummary.upcoming as v}
									{@const isDisabled =
										v.state === 'not-available' || v.state === 'failed' || v.state === 'cancelled'}
									{@const statusInfo = getBakeStatusIcon(v.dependencyBakeStatus)}
									{@const StatusIcon = statusInfo.icon}
									{@const badgeColor = statusInfo.color.includes('green')
										? 'green'
										: statusInfo.color.includes('red')
											? 'red'
											: statusInfo.color.includes('yellow')
												? 'yellow'
												: 'gray'}
									{@const borderColor =
										v.state === 'succeeded'
											? 'border-blue-400 dark:border-blue-500'
											: v.state === 'failed'
												? 'border-red-400 dark:border-red-500'
												: v.state === 'cancelled'
													? 'border-gray-400 dark:border-gray-500'
													: v.state === 'evaluating'
														? 'border-yellow-400 dark:border-yellow-500'
														: 'border-gray-300 dark:border-gray-600'}
									{@const bgColor =
										v.state === 'succeeded' ? 'bg-transparent' : 'bg-gray-50 dark:bg-gray-800/60'}
									{@const message =
										v.state === 'succeeded'
											? 'Ready to deploy'
											: v.state === 'failed'
												? 'Failed in dependencies'
												: v.state === 'cancelled'
													? 'Cancelled in dependencies'
													: v.state === 'evaluating'
														? 'Under evaluation'
														: 'Not yet available in dependencies'}
									<div
										class="flex flex-col gap-2 rounded-md border px-2 py-1.5 text-xs {borderColor} {bgColor}"
										class:opacity-60={isDisabled}
										class:cursor-not-allowed={isDisabled}
										class:border-dashed={v.state === 'succeeded'}
									>
										<div
											class="break-all font-mono text-[11px] text-gray-900 dark:text-gray-100"
											title={v.version}
										>
											{v.version}
										</div>
										<div class="flex items-center justify-between">
											<div
												class="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400"
											>
												<span>{message}</span>
												{#if v.dependencyBakeStatus}
													<Badge color={badgeColor} size="small" class="flex items-center gap-1">
														<StatusIcon class="h-2.5 w-2.5" />
														{v.dependencyBakeStatus}
													</Badge>
												{/if}
											</div>
											<div class="flex flex-wrap gap-1">
												{#each environments as env}
													{@const current = currentVersionsByEnv.get(env)}
													{#if current === v.version}
														{@const envStatus = deploymentStatuses
															.filter(
																(s: DeploymentStatusWithEnv) =>
																	s.environment === env &&
																	getDisplayVersion(s.version) === v.version
															)
															.sort(
																(a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) =>
																	(b.id || 0) - (a.id || 0)
															)[0]}
														{@const envStatusInfo = getBakeStatusIcon(envStatus?.bakeStatus)}
														{@const StatusIcon = envStatusInfo.icon}
														<span
															class="flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 dark:bg-gray-900 dark:text-gray-200"
														>
															<StatusIcon class="h-2.5 w-2.5 {envStatusInfo.color}" />
															{env}
														</span>
													{/if}
												{/each}
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Deployed versions (including current) -->
					<div>
						<div
							class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
						>
							Deployed
						</div>
						{#if versionSummary.deployed.length === 0}
							<div class="text-xs text-gray-400 dark:text-gray-500">
								No deployments for this environment yet.
							</div>
						{:else}
							<div class="space-y-1.5">
								{#each versionSummary.deployed as v}
									{@const statusInfo = v.bakeStatus
										? getBakeStatusIcon(v.bakeStatus)
										: getBakeStatusIcon('None')}
									{@const StatusIcon = statusInfo.icon}
									<div
										class="flex flex-col gap-2 rounded-md border px-2 py-1.5 text-xs {versionSummary.currentVersion ===
										v.version
											? 'border-blue-500'
											: 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60'}"
									>
										<div class="flex items-center gap-2">
											<div class="flex h-3 w-3 flex-shrink-0 items-center justify-center">
												{#if v.bakeStatus === 'InProgress'}
													<Spinner color="yellow" size="4" class="h-3 w-3" />
												{:else}
													<StatusIcon class="h-3 w-3 {statusInfo.color}" />
												{/if}
											</div>
											<div
												class="break-all font-mono text-xs text-gray-900 dark:text-gray-100"
												title={v.version}
											>
												{v.version}
											</div>
										</div>
										<!-- Environments where this version is active -->
										<div class="flex flex-wrap gap-1">
											{#each environments as env}
												{@const current = currentVersionsByEnv.get(env)}
												{#if current === v.version}
													{@const envStatus = deploymentStatuses
														.filter(
															(s: DeploymentStatusWithEnv) =>
																s.environment === env && getDisplayVersion(s.version) === v.version
														)
														.sort(
															(a: DeploymentStatusWithEnv, b: DeploymentStatusWithEnv) =>
																(b.id || 0) - (a.id || 0)
														)[0]}
													{@const envStatusInfo = getBakeStatusIcon(envStatus?.bakeStatus)}
													{@const StatusIcon = envStatusInfo.icon}
													<span
														class="flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 dark:bg-gray-900 dark:text-gray-200"
													>
														<StatusIcon class="h-2.5 w-2.5 {envStatusInfo.color}" />
														{env}
													</span>
												{/if}
											{/each}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Right: dependency graph -->
				<div class="flex-1 overflow-auto">
					<SvelteFlow
						nodes={layoutedNodes}
						{edges}
						{nodeTypes}
						fitView
						fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 1 }}
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable={false}
						panOnDrag={false}
						panOnScroll={false}
						zoomOnScroll={false}
						zoomOnPinch={false}
						zoomOnDoubleClick={false}
					>
						<Background gap={24} />
					</SvelteFlow>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Make the flow canvas inherit the parent background (light/dark) */
	:global(.svelte-flow) {
		background-color: transparent !important;
	}

	:global(.svelte-flow__node) {
		cursor: default;
	}

	:global(.svelte-flow__node-default) {
		padding: 0;
		border: none;
		background: transparent;
	}

	/* Let the parent container background (light/dark) show through */
	:global(.svelte-flow__viewport) {
		background-color: transparent;
	}

	/* Hide Svelte Flow attribution */
	:global(.svelte-flow__attribution) {
		display: none !important;
	}

	/* Allow scrolling - disable pointer events on pane/viewport but keep them on nodes/edges */
	:global(.svelte-flow__pane) {
		pointer-events: none !important;
		overflow: visible !important;
	}

	:global(.svelte-flow__viewport) {
		pointer-events: none !important;
		overflow: visible !important;
	}

	:global(.svelte-flow__container) {
		pointer-events: none !important;
	}

	:global(.svelte-flow__node) {
		pointer-events: auto !important;
	}

	:global(.svelte-flow__edge) {
		pointer-events: auto !important;
	}

	:global(.svelte-flow__edge-path) {
		pointer-events: auto !important;
	}

	:global(.svelte-flow__background) {
		pointer-events: none !important;
	}
</style>
