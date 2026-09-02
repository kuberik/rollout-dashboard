<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⛔ "RELEASE THE HOLD" DID NOT RELEASE THE HOLD. THIS COMPONENT IS THE
	 * CONTROL IT WAS ALWAYS PROMISING. (2026-08-31)
	 *
	 * A live UX critique followed the CTA end to end:
	 *
	 * > *"On `/apps` it is an `<a href="/apps/<name>">` styled as a button. On
	 * > `/apps/<name>` it opens **Change Version** — a version picker
	 * > containing no way to clear a pin. The real control is `Clear pin` on
	 * > rollout detail, two pages away. A CTA that lands on the wrong control
	 * > is worse than no CTA, because the operator now believes they tried."*
	 *
	 * The act existed; it was reachable from exactly one page. So it moves
	 * into a component and the button that names it now performs it.
	 *
	 * ── WHY THE COPY IS COPIED, NOT REWRITTEN ───────────────────────────────
	 *
	 * The same critique named rollout detail's clear-pin dialog **the best copy
	 * in the product** — *"states the consequence, the non-consequence, and
	 * names the rule in human terms."* `clearPinOutcome` is what does that: it
	 * reads the rollout's OTHER holds and says whether anything will actually
	 * move. Duplicating the markup on a second page would have been the way to
	 * lose it, so rollout detail uses this component too and there is one copy.
	 */
	import { Modal, Button, Toast } from 'flowbite-svelte';
	import { LockOpenOutline, ExclamationCircleSolid } from 'flowbite-svelte-icons';
	import type { Rollout } from '../../types';
	import { autoDeployState, clearPinOutcome, type AutoDeployState } from '$lib/view-models/auto-deploy';
	import { rolloutEnvironmentName } from '$lib/view-models/deploy-risk';
	import { isFieldManagedByManager, isFieldManagedByOtherManager } from '$lib/utils';
	import { announce } from '$lib/stores/announce.svelte';

	interface Props {
		open: boolean;
		rollout: Rollout | null;
		/** Multi-cluster: the cluster name when this rollout lives on a spoke. */
		cluster?: string;
		/**
		 * Rollout detail derives this WITH the full gate objects, so its
		 * sentence can print the gates' published pretty names. Everywhere else
		 * the same truth is derived from the rollout alone rather than silence.
		 */
		autoDeploy?: AutoDeployState | null;
		/**
		 * ⭐ WHICH ENVIRONMENT THIS ACTUALLY UNPINS, NAMED.
		 *
		 * From a live operator walk on `/apps/hello-world-app` — a page listing
		 * THREE environments, with the banner saying DEV is pinned — the dialog
		 * this opens asked *"Remove the version pin for hello-world-app?"* with
		 * no environment anywhere in it, while it unpins only the one rollout it
		 * was actually opened for. Optional and rarely needed: every call site
		 * hands over one rollout, whose own `metadata.labels.environment` (or
		 * the environment-theme annotations, or the namespace) already resolves
		 * it — see `rolloutEnvironmentName`. A caller only needs this when it
		 * knows a truer name than the rollout can derive on its own.
		 */
		environmentName?: string | null;
		onSuccess?: ((message: string) => void) | null;
		onError?: ((message: string) => void) | null;
		/**
		 * Raise the component's own toast. Rollout detail sets this false
		 * because it already owns one; every other caller gets feedback without
		 * having to build a second toast to get it.
		 */
		toast?: boolean;
	}

	let {
		open = $bindable(),
		rollout,
		cluster,
		autoDeploy = null,
		environmentName = null,
		onSuccess = null,
		onError = null,
		toast = true
	}: Props = $props();

	// `DEV`, `STAGING`, `PROD` — the product's own case for an environment
	// tier, matched to the `[DEV]` chips this rollout appears under elsewhere.
	const envLabel = $derived(rolloutEnvironmentName(rollout, environmentName).toUpperCase());
	// A cluster name is only worth saying when it disambiguates something —
	// the environment word alone is enough on a single-cluster dashboard, and
	// repeating "dev" right after "DEV" would read as a stutter, not a fact.
	const clusterSuffix = $derived(cluster ? ` on the ${cluster} cluster` : '');
	const clearPinTitle = $derived(
		rollout?.metadata?.name && envLabel
			? `Remove the pin on ${rollout.metadata.name} in ${envLabel}?`
			: 'Clear Version Pin'
	);

	let showLocalToast = $state(false);
	let localToastMessage = $state('');
	let localToastType = $state<'success' | 'error'>('success');

	function notify(kind: 'success' | 'error', message: string) {
		// The live region is raised here rather than at each call site, so no
		// caller can wire the button up and lose the announcement.
		announce(message, kind === 'error' ? 'assertive' : 'polite');
		(kind === 'success' ? onSuccess : onError)?.(message);
		if (!toast) return;
		localToastType = kind;
		localToastMessage = message;
		showLocalToast = true;
		setTimeout(() => (showLocalToast = false), 3000);
	}

	const gateState = $derived(autoDeploy ?? autoDeployState(rollout));

	/**
	 * The same guard rollout detail applies: if another controller owns
	 * `spec.wantedVersion`, clearing it here will be fought over. Said, not
	 * hidden — the operator can still press it.
	 */
	const isDashboardManaging = $derived.by(() => {
		if (!rollout) return false;
		if (rollout.spec?.wantedVersion === undefined) return true;
		const managed = rollout.metadata?.managedFields;
		if (managed) {
			if (isFieldManagedByManager(managed, 'rollout-dashboard', 'spec.wantedVersion')) return true;
			if (isFieldManagedByOtherManager(managed, 'rollout-dashboard', 'spec.wantedVersion'))
				return false;
		}
		return true;
	});

	let busy = $state(false);

	function apiUrl(path: string): string {
		if (!cluster) return path;
		const sep = path.includes('?') ? '&' : '?';
		return `${path}${sep}cluster=${encodeURIComponent(cluster)}`;
	}

	async function clearPin() {
		if (!rollout || busy) return;
		busy = true;
		try {
			const response = await fetch(
				apiUrl(`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/pin`),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ version: null, explanation: '' })
				}
			);
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				if (
					response.status === 500 &&
					typeof errorData.details === 'string' &&
					errorData.details.includes('dashboard is not managing the wantedVersion field')
				) {
					throw new Error(
						"Cannot clear pin: Dashboard is not managing this rollout's wantedVersion field. This field may be managed by another controller or external system."
					);
				}
				throw new Error('Failed to clear pin');
			}
			open = false;
			notify('success', 'Successfully cleared version pin');
		} catch (e) {
			open = false;
			notify('error', e instanceof Error ? e.message : 'Failed to clear pin');
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title={clearPinTitle}>
	<div class="space-y-4">
		<p class="text-sm text-gray-600 dark:text-gray-400">
			<!-- ⛔ THIS USED TO NAME NO ENVIRONMENT, ON A PAGE LISTING THREE OF
			     THEM. The dialog acts on exactly ONE rollout — the one it was
			     opened for — so it says which one before the press, the same way
			     the title above it does. -->
			This clears the pin currently held in <strong>{envLabel}</strong>{clusterSuffix}.
			{clearPinOutcome(gateState)}
		</p>
		{#if !isDashboardManaging}
			<p class="text-xs text-amber-600 dark:text-amber-400">
				The dashboard is not managing the wantedVersion field. Clearing may conflict with other
				controllers.
			</p>
		{/if}
		<div class="flex justify-end gap-2 pt-2">
			<Button color="light" onclick={() => (open = false)}>Cancel</Button>
			<Button color="blue" disabled={busy} onclick={clearPin}>
				<LockOpenOutline class="mr-1.5 h-4 w-4" />
				Clear Pin
			</Button>
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
