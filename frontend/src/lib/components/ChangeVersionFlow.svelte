<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ROLE: the one place "Change version" is mounted, on any rollout tab.
	 * (PALROW r8, AD palette round 7, item 2.)
	 *
	 * WHY: the Overview walked a person through `RecoveryModeWarningModal`
	 * before `ChangeVersionModal` whenever the next deploy would run in
	 * recovery mode; History mounted `ChangeVersionModal` alone, so the same
	 * palette command skipped that step there. Both pages now mount this
	 * instead, and the gate (`recoveryModeReason`, in
	 * `view-models/change-version-entry.ts`) is decided in one place.
	 *
	 * HOW A PAGE USES IT: bind `open`, set it `true` to start the flow,
	 * exactly the way each page already set `showChangeVersionModal = true`.
	 * The flow then shows the warning first when a reason applies (the
	 * warning's Continue opens the picker), otherwise the picker directly.
	 * `open` falls back to `false` once both dialogs are closed. The two
	 * modals' internals are untouched (owned by the dialogs lane); only
	 * their mounting moved here.
	 *
	 * Health checks: the Overview passes its own `visibleHealthChecks` (the
	 * list its page already draws). A page that passes none (History) gets
	 * the rollout's checks from the SAME query key and fetch the Overview
	 * uses, so a tab switch is a cache hit, filtered by the same cutoff.
	 */
	import ChangeVersionModal from './ChangeVersionModal.svelte';
	import RecoveryModeWarningModal from './RecoveryModeWarningModal.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { untrack } from 'svelte';
	import { apiPath } from '$lib/api/urls';
	import { pollWhenHealthy } from '$lib/api/errors';
	import type { HealthCheck, Rollout } from '../../types';
	import type { AutoDeployState } from '$lib/view-models/auto-deploy';
	import {
		recoveryModeReason,
		visibleHealthChecksFor,
		previousVersionDisplay,
		selectedVersionDisplay,
		type RecoveryReason
	} from '$lib/view-models/change-version-entry';

	let {
		open = $bindable(false),
		rollout,
		cluster,
		healthChecks = undefined,
		autoDeploy = null,
		isPinVersionMode = false,
		initialSelectedVersion = null,
		initialExplanation = '',
		environmentName = null,
		contractHeldVersions = undefined,
		onSuccess = () => {},
		onError = () => {},
		onDeployStart = () => {}
	}: {
		open?: boolean;
		rollout: Rollout | null | undefined;
		cluster: string;
		/** The page's own visible checks; omitted → fetched here. */
		healthChecks?: HealthCheck[];
		autoDeploy?: AutoDeployState | null;
		isPinVersionMode?: boolean;
		initialSelectedVersion?: string | null;
		initialExplanation?: string;
		environmentName?: string | null;
		contractHeldVersions?: ReadonlySet<string>;
		onSuccess?: (message: string) => void;
		onError?: (message: string) => void;
		onDeployStart?: () => void;
	} = $props();

	const namespace = $derived(rollout?.metadata?.namespace ?? '');
	const name = $derived(rollout?.metadata?.name ?? '');

	// Same key and fetch as the Overview's own `healthChecksQuery`, so the
	// two share one cache entry. Only runs when the page passed no list.
	const healthChecksQuery = createQuery(() => ({
		queryKey: ['health-checks', namespace, name, cluster],
		queryFn: async () => {
			const res = await fetch(apiPath(cluster, `/rollouts/${namespace}/${name}/health-checks`));
			if (!res.ok) return { healthChecks: [] };
			return res.json();
		},
		enabled: healthChecks === undefined && Boolean(rollout?.spec?.healthCheckSelector),
		refetchInterval: pollWhenHealthy(5000, 60000, cluster)
	}));

	const checks = $derived<HealthCheck[]>(
		healthChecks ??
			visibleHealthChecksFor(rollout, (healthChecksQuery.data?.healthChecks as HealthCheck[]) ?? [])
	);
	// The verdict depends on checks this component fetches and they have not
	// landed yet: deciding now would skip the Unhealthy consent step.
	const checksPending = $derived(
		healthChecks === undefined &&
			Boolean(rollout?.spec?.healthCheckSelector) &&
			healthChecksQuery.data === undefined &&
			!healthChecksQuery.isError
	);
	const reason = $derived<RecoveryReason | null>(recoveryModeReason(rollout, checks));

	let showWarning = $state(false);
	let showPicker = $state(false);
	let waiting = $state(false);
	let warningReason = $state<RecoveryReason>('previous-failed');

	// `open` turning true starts the flow; the reason is read once, at that
	// instant, so a poll landing mid-dialog cannot swap one modal for the
	// other under the reader.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			if (showWarning || showPicker) return;
			const r = reason;
			if (checksPending) {
				warningReason = 'unhealthy-health-checks';
				waiting = true;
				showWarning = true;
			} else if (r) {
				warningReason = r;
				showWarning = true;
			} else {
				showPicker = true;
			}
		});
	});
	// Checks settled while the loading warning is up: decide now, in place.
	$effect(() => {
		if (!waiting || checksPending) return;
		const r = reason;
		untrack(() => {
			waiting = false;
			if (!showWarning) return;
			if (r) {
				warningReason = r;
			} else {
				showWarning = false;
				showPicker = true;
			}
		});
	});
	// Both closed → the flow is over.
	$effect(() => {
		if (open && !showWarning && !showPicker) {
			// Defer one tick: the warning's Continue closes it and opens the
			// picker in the same handler, and this must not read the gap.
			queueMicrotask(() => {
				if (!showWarning && !showPicker) open = false;
			});
		}
	});
</script>

<ChangeVersionModal
	recoveryMode={reason !== null}
	bind:open={showPicker}
	rollout={rollout ?? null}
	{autoDeploy}
	{isPinVersionMode}
	initialSelectedVersion={initialSelectedVersion}
	initialExplanation={initialExplanation}
	{cluster}
	{environmentName}
	{contractHeldVersions}
	{onDeployStart}
	{onSuccess}
	{onError}
/>

<RecoveryModeWarningModal
	bind:open={showWarning}
	reason={warningReason}
	loading={waiting}
	versionDisplay={selectedVersionDisplay(rollout, initialSelectedVersion)}
	previousVersionDisplay={previousVersionDisplay(rollout)}
	rollout={rollout ?? null}
	selectedTag={initialSelectedVersion}
	{environmentName}
	onContinue={() => {
		showPicker = true;
	}}
/>
