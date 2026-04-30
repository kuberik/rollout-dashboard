<script lang="ts">
	import { Popover } from 'flowbite-svelte';
	import {
		CalendarWeekSolid,
		ClockSolid,
		ExclamationCircleSolid,
		CloseOutline
	} from 'flowbite-svelte-icons';
	import type { Rollout } from '$lib/types';
	import AlertPanel from './AlertPanel.svelte';

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

	let blockingSchedulesFull = $derived(
		allSchedules.filter((s) => {
			const { active } = s.status;
			const { action } = s.spec;
			return (action === 'Allow' && !active) || (action === 'Deny' && active);
		})
	);

	let blockingSchedules = $derived(blockingSchedulesFull.map((s) => s.metadata.name));

	const DAY_ORDER: Record<string, number> = {
		Monday: 0,
		Tuesday: 1,
		Wednesday: 2,
		Thursday: 3,
		Friday: 4,
		Saturday: 5,
		Sunday: 6,
		Mon: 0,
		Tue: 1,
		Wed: 2,
		Thu: 3,
		Fri: 4,
		Sat: 5,
		Sun: 6
	};
	const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	function formatDays(days: string[]): string {
		const sorted = [...days]
			.map((d) => (d in DAY_ORDER ? DAY_ORDER[d] : -1))
			.filter((i) => i >= 0)
			.sort((a, b) => a - b);
		if (sorted.length === 0) return days.join(', ');
		// Collapse consecutive runs into ranges (Mon-Fri).
		const ranges: string[] = [];
		let start = sorted[0];
		let prev = sorted[0];
		for (let i = 1; i <= sorted.length; i++) {
			if (i === sorted.length || sorted[i] !== prev + 1) {
				ranges.push(start === prev ? DAY_SHORT[start] : `${DAY_SHORT[start]}–${DAY_SHORT[prev]}`);
				if (i < sorted.length) {
					start = sorted[i];
					prev = sorted[i];
				}
			} else {
				prev = sorted[i];
			}
		}
		return ranges.join(', ');
	}

	function formatRule(
		rule: {
			name?: string;
			timeRange?: { start: string; end: string };
			daysOfWeek?: string[];
			dateRange?: { start: string; end: string };
		},
		timezone: string | undefined
	): string {
		const parts: string[] = [];
		if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
			parts.push(formatDays(rule.daysOfWeek));
		}
		if (rule.timeRange) {
			parts.push(`${rule.timeRange.start}–${rule.timeRange.end}`);
		}
		if (rule.dateRange) {
			parts.push(`${rule.dateRange.start} → ${rule.dateRange.end}`);
		}
		const body = parts.join(' · ') || rule.name || 'Always';
		return timezone ? `${body} (${timezone})` : body;
	}

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
		<AlertPanel
			severity="warning"
			title="Deployments currently blocked"
			message={nextChange
				? `Will be allowed in ${formatTimeUntil(nextChange)} (${formatTime(nextChange)}).`
				: 'Check schedule rules for deployment windows.'}
			icon={CalendarWeekSolid}
			pulse
		>
			{#snippet actions()}
				<button
					type="button"
					id="schedule-details"
					class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-800/10 px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-400/30 transition hover:bg-amber-800/15 hover:ring-amber-400/50 dark:bg-white/10 dark:text-white/90 dark:ring-white/20 dark:hover:bg-white/15"
				>
					{blockingSchedules.length} schedule{blockingSchedules.length > 1 ? 's' : ''}
				</button>
			{/snippet}
		</AlertPanel>
		<Popover
			triggeredBy="#schedule-details"
			placement="bottom-end"
			arrow={false}
			defaultClass=""
			class="z-20 w-96 max-w-[90vw] rounded-xl border border-amber-300/70 bg-gradient-to-br from-amber-50 via-white to-amber-50 p-0 text-amber-950 shadow-2xl shadow-amber-300/30 dark:border-amber-700/60 dark:from-amber-950 dark:via-amber-900/80 dark:to-amber-950 dark:text-amber-50 dark:shadow-amber-950/50"
		>
			<div class="border-b border-amber-200/70 px-4 py-3 dark:border-amber-800/60">
				<div class="flex items-center gap-2">
					<CalendarWeekSolid class="h-4 w-4 text-amber-600 dark:text-amber-300" />
					<p class="text-sm font-semibold tracking-tight">
						{blockingSchedulesFull.length === 1 ? 'Blocking schedule' : 'Blocking schedules'}
					</p>
				</div>
			</div>
			<ul class="divide-y divide-amber-200/60 dark:divide-amber-800/40">
				{#each blockingSchedulesFull as schedule}
					<li class="px-4 py-3">
						<div class="mb-2 flex items-center justify-between gap-2">
							<span class="truncate text-sm font-medium text-amber-900 dark:text-amber-100">
								{schedule.metadata.name}
							</span>
							<span
								class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 {schedule
									.spec.action === 'Deny'
									? 'bg-red-100 text-red-700 ring-red-300/60 dark:bg-red-500/20 dark:text-red-200 dark:ring-red-700/50'
									: 'bg-emerald-100 text-emerald-700 ring-emerald-300/60 dark:bg-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-700/50'}"
							>
								{schedule.spec.action}
							</span>
						</div>
						{#if schedule.spec.rules?.length}
							<ul class="space-y-1">
								{#each schedule.spec.rules as rule}
									<li class="flex items-start gap-2 text-xs text-amber-800/90 dark:text-amber-200/85">
										<ClockSolid class="mt-0.5 h-3 w-3 shrink-0 text-amber-500/80 dark:text-amber-400/80" />
										<span class="break-words">{formatRule(rule, schedule.spec.timezone)}</span>
									</li>
								{/each}
							</ul>
						{/if}
						{#if schedule.status?.nextTransition}
							<p class="mt-2 text-xs text-amber-700/80 dark:text-amber-300/70">
								Allowed in <span class="font-medium">{formatTimeUntil(schedule.status.nextTransition)}</span>
								· {formatTime(schedule.status.nextTransition)}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		</Popover>
	{:else if isAllowed && isClosingSoon && !isWarningDismissed}
		<AlertPanel
			severity="warning"
			title="Deployment window closing soon"
			message={`Window closes in ${formatTimeUntil(nextChange!)} (${formatTime(nextChange!)}).`}
			icon={ClockSolid}
		>
			{#snippet actions()}
				<button
					type="button"
					onclick={dismissWarning}
					class="inline-flex items-center rounded-lg p-1.5 text-amber-700 transition hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-800/40"
					aria-label="Dismiss"
				>
					<CloseOutline class="h-5 w-5" />
				</button>
			{/snippet}
		</AlertPanel>
	{/if}
{/if}
