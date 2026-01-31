<script lang="ts">
	import { Alert, Popover } from 'flowbite-svelte';
	import {
		CalendarWeekSolid,
		ClockSolid,
		ExclamationCircleSolid,
		CloseOutline
	} from 'flowbite-svelte-icons';
	import type { Rollout } from '$lib/types';

	type RolloutSchedule = {
		metadata: { name: string; namespace: string };
		spec: {
			rules: Array<{
				name?: string;
				timeRange?: { start: string; end: string };
				daysOfWeek?: string[];
				dateRange?: { start: string; end: string };
			}>;
			timezone?: string;
			action: 'Allow' | 'Deny';
		};
		status: {
			active: boolean;
			activeRules?: string[];
			nextTransition?: string;
		};
	};

	type ClusterRolloutSchedule = {
		metadata: { name: string };
		spec: {
			rules: Array<{
				name?: string;
				timeRange?: { start: string; end: string };
				daysOfWeek?: string[];
				dateRange?: { start: string; end: string };
			}>;
			timezone?: string;
			action: 'Allow' | 'Deny';
		};
		status: {
			active: boolean;
			activeRules?: string[];
			nextTransition?: string;
		};
	};

	let { rollout }: { rollout: Rollout } = $props();

	let allSchedules = $state<Array<RolloutSchedule | ClusterRolloutSchedule>>([]);
	let loading = $state(true);
	let error = $state('');
	let dismissedWarnings = $state<Set<string>>(new Set());

	// Derived state for UI
	let isBlocked = $derived.by(() => {
		const blocking = allSchedules.filter((s) => {
			const { active } = s.status;
			const { action } = s.spec;
			return (action === 'Allow' && !active) || (action === 'Deny' && active);
		});
		return blocking.length > 0;
	});

	let isAllowed = $derived.by(() => {
		const blocking = allSchedules.filter((s) => {
			const { active } = s.status;
			const { action } = s.spec;
			return (action === 'Allow' && !active) || (action === 'Deny' && active);
		});
		const allowing = allSchedules.filter((s) => {
			const { active } = s.status;
			const { action } = s.spec;
			return (action === 'Allow' && active) || (action === 'Deny' && !active);
		});
		return allowing.length > 0 && blocking.length === 0;
	});

	let nextChange = $derived.by(() => {
		let earliestTransition: Date | null = null;
		for (const schedule of allSchedules) {
			if (schedule.status.nextTransition) {
				const transitionDate = new Date(schedule.status.nextTransition);
				if (!earliestTransition || transitionDate < earliestTransition) {
					earliestTransition = transitionDate;
				}
			}
		}
		return earliestTransition ? earliestTransition.toISOString() : null;
	});

	let blockingSchedules = $derived(
		allSchedules
			.filter((s) => {
				const { active } = s.status;
				const { action } = s.spec;
				return (action === 'Allow' && !active) || (action === 'Deny' && active);
			})
			.map((s) => s.metadata.name)
	);

	let allowingSchedules = $derived(
		allSchedules
			.filter((s) => {
				const { active } = s.status;
				const { action } = s.spec;
				return (action === 'Allow' && active) || (action === 'Deny' && !active);
			})
			.map((s) => s.metadata.name)
	);

	// Check if window is closing soon (within 1 hour)
	let isClosingSoon = $derived.by(() => {
		if (!nextChange) return false;
		const target = new Date(nextChange);
		const now = new Date();
		const diff = target.getTime() - now.getTime();
		const oneHour = 60 * 60 * 1000;
		return diff > 0 && diff <= oneHour;
	});

	// Generate unique key for this warning based on transition time
	let warningKey = $derived(nextChange ? `schedule-warning-${nextChange}` : '');

	// Check if this specific warning has been dismissed
	let isWarningDismissed = $derived(warningKey && dismissedWarnings.has(warningKey));

	function dismissWarning() {
		if (warningKey) {
			dismissedWarnings.add(warningKey);
			// Store in localStorage
			try {
				const stored = JSON.parse(localStorage.getItem('dismissedScheduleWarnings') || '{}');
				stored[warningKey] = true;
				localStorage.setItem('dismissedScheduleWarnings', JSON.stringify(stored));
			} catch (e) {
				// Ignore localStorage errors
			}
		}
	}

	// Load dismissed warnings from localStorage on mount
	$effect(() => {
		try {
			const stored = JSON.parse(localStorage.getItem('dismissedScheduleWarnings') || '{}');
			// Clean up old warnings (older than 24 hours)
			const now = Date.now();
			const cleaned: Record<string, boolean> = {};
			for (const [key, value] of Object.entries(stored)) {
				const match = key.match(/schedule-warning-(.+)/);
				if (match) {
					const transitionTime = new Date(match[1]).getTime();
					if (now - transitionTime < 24 * 60 * 60 * 1000) {
						cleaned[key] = value as boolean;
						dismissedWarnings.add(key);
					}
				}
			}
			localStorage.setItem('dismissedScheduleWarnings', JSON.stringify(cleaned));
		} catch (e) {
			// Ignore localStorage errors
		}
	});

	async function fetchSchedules() {
		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata.namespace}/${rollout.metadata.name}/schedules`
			);
			if (!response.ok) throw new Error('Failed to fetch schedules');

			const data = await response.json();
			const rolloutSchedules = data.rolloutSchedules?.items || [];
			const clusterSchedules = data.clusterRolloutSchedules?.items || [];
			allSchedules = [...rolloutSchedules, ...clusterSchedules];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load schedules';
		} finally {
			loading = false;
		}
	}

	// Use effect to fetch and auto-refresh
	$effect(() => {
		fetchSchedules();
		const interval = setInterval(fetchSchedules, 30000);
		return () => clearInterval(interval);
	});

	function formatTimeUntil(isoString: string): string {
		const target = new Date(isoString);
		const now = new Date();
		const diff = target.getTime() - now.getTime();

		if (diff < 0) return 'now';

		const minutes = Math.floor(diff / 1000 / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ${hours % 24}h`;
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		return `${minutes}m`;
	}

	function formatTime(isoString: string): string {
		return new Date(isoString).toLocaleString();
	}
</script>

{#if !loading && !error && allSchedules.length > 0}
	{#if isBlocked}
		<!-- Blocked State - Yellow Alert -->
		<Alert color="yellow" class="mb-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<ExclamationCircleSolid class="h-5 w-5" />
					<div>
						<div class="font-semibold">Deployments Currently Blocked</div>
						<div class="mt-1 text-sm">
							{#if nextChange}
								Will be allowed in <span class="font-medium"
									>{formatTimeUntil(nextChange)}</span
								>
								({formatTime(nextChange)})
							{:else}
								Check schedule rules for deployment windows
							{/if}
						</div>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<CalendarWeekSolid class="h-4 w-4" />
					<button
						type="button"
						id="schedule-details"
						class="text-sm underline hover:no-underline"
					>
						{blockingSchedules.length} schedule{blockingSchedules.length > 1 ? 's' : ''}
					</button>
				</div>
			</div>
		</Alert>
		<Popover triggeredBy="#schedule-details" class="w-80 text-sm" placement="bottom">
			<div class="space-y-2 p-3">
				<div class="font-semibold text-gray-900 dark:text-white">Blocking Schedules:</div>
				<ul class="list-inside list-disc space-y-1 text-gray-700 dark:text-gray-300">
					{#each blockingSchedules as name}
						<li>{name}</li>
					{/each}
				</ul>
			</div>
		</Popover>
	{:else if isAllowed && isClosingSoon && !isWarningDismissed}
		<!-- Warning: Window closing soon - Dismissable -->
		<Alert color="yellow" class="mb-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<ClockSolid class="h-5 w-5" />
					<div>
						<div class="font-semibold">Deployment Window Closing Soon</div>
						<div class="mt-1 text-sm">
							Window closes in <span class="font-medium">{formatTimeUntil(nextChange!)}</span>
							({formatTime(nextChange!)})
						</div>
					</div>
				</div>
				<button
					type="button"
					onclick={dismissWarning}
					class="ml-auto inline-flex items-center rounded-lg p-1.5 text-yellow-500 hover:bg-yellow-200 dark:text-yellow-400 dark:hover:bg-gray-700"
					aria-label="Dismiss"
				>
					<CloseOutline class="h-5 w-5" />
				</button>
			</div>
		</Alert>
	{/if}
{/if}
