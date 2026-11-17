<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ROLL BACK AND RETRY, PRESSED IN A ROLLOUT TAB'S HEADER (History, Gates, Logs), OPEN THEIR CONFIRM WHERE YOU ARE.
	 *
	 * ROLE: the rollout Overview's failure panel owns Retry (FailurePanel: `retryConfirm()` decides whether to ask, `RetryConfirmModal`
	 * asks, `POST .../retry` fires). The tab header's Retry used to be a link to the Overview, so a Cancel left the operator on a page
	 * they had not been on, with their logs or gates gone. This is the same decision, the same modal and the same request, hosted by the
	 * tab header, so Cancel leaves you where you were. Roll back is the same: it mounts `ChangeVersionFlow` (the recovery warning, then the picker pinned to the rollback target), as the Overview's panel does.
	 *
	 * WHY A COMPONENT AND NOT PAGE CODE: three tabs share one header; the header mounts this on the first press, so a tab nobody
	 * presses either button on never runs its queries. Mounted, it reads what the Overview reads (the rollout, its health checks, its managed
	 * resources), settles them, then acts once per `request`.
	 *
	 * The one case it hands back to the Overview: a failed Kruise step test (that retry asks "retry or skip the tests", a different
	 * dialog that needs the step's data). It navigates there with `?action=retry`, as a card's Retry does.
	 */
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { goto } from '$app/navigation';
	import RetryConfirmModal from './RetryConfirmModal.svelte';
	import ChangeVersionFlow from './ChangeVersionFlow.svelte';
	import { rollbackTarget } from '$lib/view-models/deploy-risk';
	import { dashboardManagesWantedVersion } from '$lib/view-models/pin-hold';
	import { siteOf } from '$lib/view-models/sites-waves';
	import Toast from './Toast.svelte';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { healthChecksQueryOptions } from '$lib/api/health-checks';
	import { apiPath } from '$lib/api/urls';
	import { href } from '$lib/paths';
	import { retryConfirm } from '$lib/view-models/retry-confirm';
	import { visibleHealthChecksFor } from '$lib/view-models/change-version-entry';
	import { stalledKruiseName, hasFailedStepTests } from '$lib/view-models/retry-context';
	import { retryActionHref } from '$lib/components/new/rollout-view';
	import type { ManagedResourceStatus } from '../../types';

	let {
		cluster,
		namespace,
		name,
		/** bump once per press of Retry / Roll back */
		request,
		rollbackRequest
	}: { cluster: string; namespace: string; name: string; request: number; rollbackRequest: number } = $props();

	const client = useQueryClient();
	const rolloutQuery = createQuery(() => rolloutQueryOptions({ namespace, name, cluster }));
	const rollout = $derived(rolloutQuery.data?.rollout ?? null);
	const environmentName = $derived(rolloutQuery.data?.environment?.spec?.environment ?? null);
	const site = $derived(rolloutQuery.data?.environment ? siteOf(rolloutQuery.data.environment) : null);
	const kustomizations = $derived(rolloutQuery.data?.kustomizations?.items ?? []);

	const checksQuery = createQuery(() => ({
		...healthChecksQueryOptions(namespace, name, cluster),
		enabled: Boolean(rollout?.spec?.healthCheckSelector)
	}));
	// The Overview's own key and fetch, so a visit to it shares the cache.
	const managedQuery = createQuery(() => ({
		queryKey: ['managed-resources', namespace, name, cluster, kustomizations.map((k) => k.metadata?.name)],
		queryFn: async () => {
			const result: Record<string, ManagedResourceStatus[]> = {};
			await Promise.all(
				kustomizations
					.filter((k) => Boolean(k.metadata?.name))
					.map(async (k) => {
						const res = await fetch(apiPath(cluster, `/kustomizations/${k.metadata?.namespace || namespace}/${k.metadata!.name}/managed-resources`));
						if (res.ok) result[k.metadata!.name as string] = (await res.json()).managedResources || [];
					})
			);
			return result;
		},
		enabled: kustomizations.length > 0
	}));

	const settled = $derived(
		!!rollout &&
			(!rollout.spec?.healthCheckSelector || checksQuery.isSuccess || checksQuery.isError) &&
			(kustomizations.length === 0 || managedQuery.isSuccess || managedQuery.isError)
	);
	const checks = $derived(rollout ? visibleHealthChecksFor(rollout, checksQuery.data?.healthChecks ?? []) : []);
	const managed = $derived(managedQuery.data ?? {});
	const failedHCList = $derived(rollout?.status?.history?.[0]?.failedHealthChecks ?? []);
	const confirm = $derived(retryConfirm(rollout, environmentName, checks, failedHCList, site));

	let open = $state(false);
	let handled = 0;
	$effect(() => {
		if (request <= handled || !settled) return;
		handled = request;
		if (hasFailedStepTests(managed)) {
			goto(retryActionHref(href(`/rollouts/${cluster}/${namespace}/${name}`)));
		} else if (confirm.level === 'none') {
			void retry();
		} else {
			open = true;
		}
	});

	let rollbackOpen = $state(false);
	let rollbackHandled = 0;
	$effect(() => {
		if (rollbackRequest <= rollbackHandled || !rollout) return;
		rollbackHandled = rollbackRequest;
		if (!dashboardManagesWantedVersion(rollout)) return;
		rollbackOpen = true;
	});

	let toast = $state<{ tone: 'success' | 'danger'; message: string; description: string; logs?: boolean } | null>(null);
	let toastOpen = $state(false);
	/** One toast for every result this host reports (the picker's own text for Roll back, the Overview's wording). */
	function announce(next: NonNullable<typeof toast>) {
		toast = next;
		toastOpen = true;
		setTimeout(() => (toastOpen = false), 3000);
	}
	async function retry() {
		try {
			const res = await fetch(apiPath(cluster, `/rollouts/${namespace}/${name}/retry`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kruiseRolloutName: stalledKruiseName(managed) || '', testAction: '' })
			});
			if (!res.ok) throw new Error('Failed to retry deployment');
			toast = { tone: 'success', message: 'Retry started', description: `${confirm.displayTag ?? name} · Check restarted`, logs: true };
			await client.invalidateQueries({ queryKey: rolloutQueryOptions({ namespace, name, cluster }).queryKey });
		} catch (e) {
			toast = { tone: 'danger', message: `Failed to retry: ${e instanceof Error ? e.message : 'Unknown error'}`, description: '' };
		}
		toastOpen = true;
		setTimeout(() => (toastOpen = false), 3000);
	}
</script>

<RetryConfirmModal bind:open intent={confirm.intent} consequences={confirm.consequences} tag={confirm.displayTag} onConfirm={retry} />

{#if rollout}
	<ChangeVersionFlow
		bind:open={rollbackOpen}
		{rollout}
		{cluster}
		{environmentName}
		{site}
		isPinVersionMode={true}
		initialSelectedVersion={rollbackTarget(rollout)?.tag ?? null}
		onSuccess={(m) => {
			announce({ tone: 'success', message: m, description: '' });
			void client.invalidateQueries({ queryKey: rolloutQueryOptions({ namespace, name, cluster }).queryKey });
		}}
		onError={(m) => announce({ tone: 'danger', message: m, description: '' })}
	/>
{/if}

{#snippet viewLogs()}
	<a href={href(`/rollouts/${cluster}/${namespace}/${name}/logs`)} class="nav-link shrink-0">View logs</a>
{/snippet}
<Toast
	bind:open={toastOpen}
	tone={toast?.tone ?? 'info'}
	message={toast?.message ?? ''}
	description={toast?.description ?? ''}
	action={toast?.tone === 'success' && toast.logs ? viewLogs : undefined}
/>
