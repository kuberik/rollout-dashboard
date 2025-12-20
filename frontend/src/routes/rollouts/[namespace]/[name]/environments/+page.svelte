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

	const deploymentStatuses = $derived(environment?.status?.deploymentStatuses ?? []);
	const environmentInfos = $derived(environment?.status?.environmentInfos ?? []);

	// Get current environment from namespace (e.g., hello-world-dev -> dev)
	const currentEnvironment = $derived.by(() => {
		const parts = namespace.split('-');
		return parts[parts.length - 1] || namespace;
	});

	// Collect all unique versions across all environments and sort them
	const allVersions = $derived.by(() => {
		if (!deploymentStatuses || deploymentStatuses.length === 0) return [];

		const versionMap = new Map<
			string,
			{ version: string; id: number; environments: Set<string> }
		>();

		deploymentStatuses.forEach((status: EnvironmentStatusEntry) => {
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
		const versionIndex = new Map<string, number>();
		allVersions.forEach((v, idx) => {
			versionIndex.set(v.version, idx);
		});

		// Helper: get current version for an environment
		const getCurrentForEnv = (env: string): string | null => {
			const envStatuses = deploymentStatuses
				.filter((s: EnvironmentStatusEntry) => s.environment === env)
				.sort((a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) => (b.id || 0) - (a.id || 0));
			const currentStatus =
				envStatuses.find((s: EnvironmentStatusEntry) => getDeploymentStatus(s) !== 'inactive') ||
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
					.filter((s: EnvironmentStatusEntry) => s.environment === depEnv)
					.sort(
						(a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) => (b.id || 0) - (a.id || 0)
					);
				const currentStatus =
					envStatuses.find((s: EnvironmentStatusEntry) => getDeploymentStatus(s) !== 'inactive') ||
					envStatuses[0];
				const currentVersion = currentStatus ? getDisplayVersion(currentStatus.version) : 'N/A';
				const deploymentStatus = getDeploymentStatus(currentStatus);
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
						deploymentStatus,
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
				.filter((s: EnvironmentStatusEntry) => s.environment === currentEnvironment)
				.sort((a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) => (b.id || 0) - (a.id || 0));
			const currentStatus =
				envStatuses.find((s: EnvironmentStatusEntry) => getDeploymentStatus(s) !== 'inactive') ||
				envStatuses[0];
			const currentVersion = currentStatus ? getDisplayVersion(currentStatus.version) : 'N/A';
			const deploymentStatus = getDeploymentStatus(currentStatus);
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
					deploymentStatus,
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
					.filter((s: EnvironmentStatusEntry) => s.environment === depEnv)
					.sort(
						(a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) => (b.id || 0) - (a.id || 0)
					);
				const currentStatus =
					envStatuses.find((s: EnvironmentStatusEntry) => getDeploymentStatus(s) !== 'inactive') ||
					envStatuses[0];
				const currentVersion = currentStatus ? getDisplayVersion(currentStatus.version) : 'N/A';
				const deploymentStatus = getDeploymentStatus(currentStatus);
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
						deploymentStatus,
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
		// deployment node
		return { width: 400, height: 150 };
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
		g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 200 });

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
					.filter((s: EnvironmentStatusEntry) => s.environment === env)
					.sort(
						(a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) => (b.id || 0) - (a.id || 0)
					);
				const currentStatus =
					statuses.find((s: EnvironmentStatusEntry) => getDeploymentStatus(s) !== 'inactive') ||
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
				.filter((s: EnvironmentStatusEntry) => s.environment === envInfo.environment)
				.sort((a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) => (b.id || 0) - (a.id || 0));
			const currentStatus =
				envStatuses.find((s: EnvironmentStatusEntry) => getDeploymentStatus(s) !== 'inactive') ||
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
			eligible: Array<{ version: string; dependencyStatus: string }>;
			uneligible: Array<{ version: string }>;
		} = {
			currentVersion: null,
			deployed: [],
			eligible: [],
			uneligible: []
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
			.filter((s: EnvironmentStatusEntry) => s.environment === currentEnvironment)
			.sort((a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) => (b.id || 0) - (a.id || 0));
		const currentStatus =
			envStatuses.find((s: EnvironmentStatusEntry) => getDeploymentStatus(s) !== 'inactive') ||
			envStatuses[0];
		if (!currentStatus) {
			return result;
		}

		const currentVersionStr = getDisplayVersion(currentStatus.version);
		result.currentVersion = currentVersionStr;

		const currentIdx = allVersions.findIndex((v) => v.version === currentVersionStr);
		if (currentIdx === -1) return result;

		// Deployed versions (history) for the current environment, including current
		// Match with rollout history to get bakeStatus
		const seen = new Set<string>();
		for (const s of envStatuses) {
			const versionStr = getDisplayVersion(s.version);
			if (!versionStr || seen.has(versionStr)) continue;
			seen.add(versionStr);

			// Find matching entry in rollout history by version tag, digest, or revision
			const historyEntry = rollout?.status?.history?.find(
				(entry) =>
					entry.version?.tag === s.version.tag ||
					entry.version?.digest === s.version.digest ||
					entry.version?.revision === s.version.revision
			);

			result.deployed.push({
				version: versionStr,
				bakeStatus: historyEntry?.bakeStatus || s.bakeStatus
			});
			if (result.deployed.length >= 6) break;
		}

		// Upcoming newer versions (relative to current) partitioned into eligible / uneligible
		for (
			let i = currentIdx - 1;
			i >= 0 && result.eligible.length + result.uneligible.length < 10;
			i--
		) {
			const candidate = allVersions[i];
			if (!candidate) continue;

			const version = candidate.version;

			// Check deployments of this version in direct dependencies
			const depStatuses = deploymentStatuses.filter(
				(s: EnvironmentStatusEntry) =>
					currentDeps.includes(s.environment) && getDisplayVersion(s.version) === version
			);

			// Determine combined status from dependencies
			const statuses = depStatuses.map((s: EnvironmentStatusEntry) => getDeploymentStatus(s));
			let combinedStatus = 'unknown';
			if (statuses.some((s: string) => s === 'failure')) combinedStatus = 'failure';
			else if (statuses.some((s: string) => s === 'in_progress' || s === 'pending'))
				combinedStatus = 'in_progress';
			else if (statuses.every((s: string) => s === 'success')) combinedStatus = 'success';
			else if (statuses.some((s: string) => s === 'inactive')) combinedStatus = 'inactive';

			// "Eligible" = deployed successfully to all direct dependencies
			const allDepsSucceeded =
				currentDeps.length > 0 &&
				currentDeps.every((dep) =>
					depStatuses.some(
						(s: EnvironmentStatusEntry) =>
							s.environment === dep && getDeploymentStatus(s) === 'success'
					)
				);

			if (allDepsSucceeded) {
				result.eligible.push({ version, dependencyStatus: combinedStatus });
			} else {
				// "Uneligible" = newer but not yet fully deployed to direct dependencies
				result.uneligible.push({ version });
			}
		}

		return result;
	});

	// Helper function to derive status from bakeStatus
	function getDeploymentStatus(entry: EnvironmentStatusEntry | undefined): string {
		if (!entry) return 'unknown';
		const bakeStatus = entry.bakeStatus?.toLowerCase();
		if (bakeStatus === 'succeeded') return 'success';
		if (bakeStatus === 'failed') return 'failure';
		if (bakeStatus === 'inprogress' || bakeStatus === 'in_progress') return 'in_progress';
		if (bakeStatus === 'pending' || bakeStatus === 'none') return 'pending';
		// If no bakeStatus, consider it inactive (old deployment)
		return 'inactive';
	}

	function getStatusIcon(status: string) {
		switch (status?.toLowerCase()) {
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

	function getStatusColor(status: string) {
		switch (status?.toLowerCase()) {
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

	function getStatusDotColor(status: string | null | undefined): string {
		if (!status) return 'bg-gray-300 dark:bg-gray-700';
		const s = status.toLowerCase();
		if (s === 'success') return 'bg-green-500';
		if (s === 'failure') return 'bg-red-500';
		if (s === 'in_progress' || s === 'pending') return 'bg-yellow-400';
		if (s === 'inactive') return 'bg-gray-400';
		return 'bg-slate-400';
	}
</script>

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

					<!-- Newer but uneligible versions (blocked) -->
					<div class="mb-4">
						<div class="mb-1 flex items-center justify-between">
							<div
								class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
							>
								Newer but blocked
							</div>
							<div class="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
								<span
									class="h-2.5 w-2.5 rounded-full border border-gray-400 bg-gray-100 opacity-60 dark:border-gray-600 dark:bg-gray-800"
								></span>
								<span>disabled = not yet in all dependencies</span>
							</div>
						</div>
						{#if versionSummary.uneligible.length === 0}
							<div class="text-xs text-gray-400 dark:text-gray-500">
								No newer versions blocked by dependencies.
							</div>
						{:else}
							<div class="space-y-1.5">
								{#each versionSummary.uneligible as v}
									<div
										class="flex flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs opacity-60 dark:border-gray-700 dark:bg-gray-800/60"
									>
										<div
											class="break-all font-mono text-[11px] text-gray-900 dark:text-gray-100"
											title={v.version}
										>
											{v.version}
										</div>
										<div class="flex items-center justify-between">
											<div class="text-[11px] text-gray-500 dark:text-gray-400">
												Newer than current, but missing in at least one dependency.
											</div>
											<div class="flex flex-wrap gap-1">
												{#each environments as env}
													{@const current = currentVersionsByEnv.get(env)}
													{#if current === v.version}
														{@const envStatus = deploymentStatuses
															.filter(
																(s: EnvironmentStatusEntry) =>
																	s.environment === env &&
																	getDisplayVersion(s.version) === v.version
															)
															.sort(
																(a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) =>
																	(b.id || 0) - (a.id || 0)
															)[0]}
														{@const envStatusInfo = getStatusIcon(getDeploymentStatus(envStatus))}
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

					<!-- Upcoming eligible versions -->
					<div class="mb-4">
						<div class="mb-1 flex items-center justify-between">
							<div
								class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
							>
								Upcoming (eligible)
							</div>
							<div class="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
								<span class="h-2.5 w-2.5 rounded-full border border-blue-500"></span>
								<span>hollow = ready in all dependencies</span>
							</div>
						</div>
						{#if versionSummary.eligible.length === 0}
							<div class="text-xs text-gray-400 dark:text-gray-500">
								No newer versions fully deployed to all direct dependencies.
							</div>
						{:else}
							<div class="space-y-1.5">
								{#each versionSummary.eligible as v}
									{@const isDisabled = v.dependencyStatus !== 'success'}
									{@const statusInfo = getStatusIcon(v.dependencyStatus)}
									{@const StatusIcon = statusInfo.icon}
									<div
										class="flex flex-col gap-2 rounded-md border border-dashed border-blue-400 bg-transparent px-2 py-1.5 text-xs dark:border-blue-500"
										class:opacity-60={isDisabled}
										class:cursor-not-allowed={isDisabled}
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
												<span>Newer than current, eligible to roll out.</span>
												<Badge
													color={getStatusColor(v.dependencyStatus)}
													size="small"
													class="flex items-center gap-1"
												>
													<StatusIcon class="h-2.5 w-2.5" />
													{v.dependencyStatus}
												</Badge>
											</div>
											<div class="flex flex-wrap gap-1">
												{#each environments as env}
													{@const current = currentVersionsByEnv.get(env)}
													{#if current === v.version}
														{@const envStatus = deploymentStatuses
															.filter(
																(s: EnvironmentStatusEntry) =>
																	s.environment === env &&
																	getDisplayVersion(s.version) === v.version
															)
															.sort(
																(a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) =>
																	(b.id || 0) - (a.id || 0)
															)[0]}
														{@const envStatusInfo = getStatusIcon(getDeploymentStatus(envStatus))}
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
															(s: EnvironmentStatusEntry) =>
																s.environment === env && getDisplayVersion(s.version) === v.version
														)
														.sort(
															(a: EnvironmentStatusEntry, b: EnvironmentStatusEntry) =>
																(b.id || 0) - (a.id || 0)
														)[0]}
													{@const envStatusInfo = getStatusIcon(getDeploymentStatus(envStatus))}
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
