<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout } from '../../types';
	import { Modal, Alert, Badge, Button, Toggle, Toast, Tooltip } from 'flowbite-svelte';
	import { ExclamationCircleSolid, CheckCircleSolid } from 'flowbite-svelte-icons';
	import {
		hasForceDeployAnnotation,
		getDisplayVersion as utilsGetDisplayVersion
	} from '$lib/utils';

	interface Props {
		open: boolean;
		rollout: Rollout | null;
		selectedVersionTag: string | null;
		// Optional nicer display version (e.g., semver) if caller has it; falls back to tag
		selectedVersionDisplay?: string | null;
		// If true, force pin mode and disable toggle (used for rollback)
		isPinVersionMode?: boolean;
		// Optional initial explanation (e.g., for rollback)
		initialExplanation?: string;
		// Callbacks
		onSuccess?: (message: string) => void;
		onError?: (message: string) => void;
	}

	let {
		open = $bindable(),
		rollout,
		selectedVersionTag,
		selectedVersionDisplay = null,
		isPinVersionMode = false,
		initialExplanation = '',
		onSuccess = () => {},
		onError = () => {}
	}: Props = $props();

	// Internal form state
	let pinVersionToggle = $state(false);
	let deployExplanation = $state('');
	let deployConfirmationVersion = $state('');

	// Toast (fallback if parent doesn't provide callbacks)
	let showLocalToast = $state(false);
	let localToastMessage = $state('');
	let localToastType = $state<'success' | 'error'>('success');

	// Reset form state when modal closes or selection changes
	$effect(() => {
		// Just referencing open and selectedVersionTag to trigger the effect
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		open;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		selectedVersionTag;

		deployExplanation = '';
		deployConfirmationVersion = '';
		pinVersionToggle = pinVersionToggleComputed;

		if (open && initialExplanation) {
			deployExplanation = initialExplanation;
		}
	});

	// Pin logic evaluation
	const isOlderThanCurrent = $derived.by(() => {
		if (!rollout || !selectedVersionTag) return false;
		const currentTag = rollout.status?.history?.[0]?.version?.tag;
		const releases = rollout.status?.availableReleases;
		if (!currentTag || !releases) return false;
		const currentIdx = releases.findIndex((r) => r.tag === currentTag);
		const selectedIdx = releases.findIndex((r) => r.tag === selectedVersionTag);
		if (currentIdx === -1 || selectedIdx === -1) return false;
		return selectedIdx < currentIdx;
	});

	const isCustomVersion = $derived.by(() => {
		if (!rollout || !selectedVersionTag) return false;
		const releases = rollout.status?.availableReleases;
		if (!releases) return true;
		return !releases.some((ar) => ar.tag === selectedVersionTag);
	});

	const mustPin = $derived(isPinVersionMode || isOlderThanCurrent || isCustomVersion);

	const pinVersionToggleComputed = $derived(mustPin || rollout?.spec?.wantedVersion !== undefined);

	const isPinVersionToggleDisabled = $derived(mustPin || hasForceDeployAnnotation(rollout as any));

	// Sync computed value to state
	$effect(() => {
		pinVersionToggle = pinVersionToggleComputed;
	});

	function getDisplayVersion(): string {
		if (!selectedVersionTag) return '';
		return selectedVersionDisplay || selectedVersionTag;
	}

	async function handleDeploy() {
		if (!rollout || !selectedVersionTag) return;

		try {
			const response = await fetch(
				`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/change-version`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						version: selectedVersionTag,
						pin: pinVersionToggle,
						message: deployExplanation
					})
				}
			);
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				if (
					pinVersionToggle &&
					response.status === 500 &&
					errorData.details &&
					errorData.details.includes('dashboard is not managing the wantedVersion field')
				) {
					throw new Error(
						"Cannot pin version: Dashboard is not managing this rollout's wantedVersion field. This field may be managed by another controller or external system."
					);
				}
				throw new Error('Failed to change version');
			}
			notifySuccess(
				pinVersionToggle
					? 'Successfully pinned and deployed version'
					: 'Force deploy initiated, version rolling out soon'
			);

			// Close and reset
			open = false;
			deployExplanation = '';
			deployConfirmationVersion = '';
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Failed to deploy version';
			notifyError(message);
		}
	}

	function notifySuccess(message: string) {
		if (onSuccess) onSuccess(message);
		else {
			localToastType = 'success';
			localToastMessage = message;
			showLocalToast = true;
			setTimeout(() => (showLocalToast = false), 3000);
		}
	}

	function notifyError(message: string) {
		if (onError) onError(message);
		else {
			localToastType = 'error';
			localToastMessage = message;
			showLocalToast = true;
			setTimeout(() => (showLocalToast = false), 3000);
		}
	}
</script>

<Modal bind:open title="Deploy Version" size="sm">
	<div class="space-y-3 sm:space-y-4">
		{#if rollout && rollout.metadata}
			{#if rollout && !rollout.metadata?.managedFields && hasForceDeployAnnotation(rollout)}
				<Alert color="yellow" class="mb-3 text-xs sm:mb-4 sm:text-sm">
					<ExclamationCircleSolid class="h-4 w-4" />
					<span class="font-medium">Warning:</span> Version management disabled, force deploy already set.
				</Alert>
			{:else if rollout && hasForceDeployAnnotation(rollout)}
				<Alert color="blue" class="mb-3 text-xs sm:mb-4 sm:text-sm">
					<ExclamationCircleSolid class="h-4 w-4" />
					<span class="font-medium">Info:</span> Force deploy already set. Only version pinning available.
				</Alert>
			{/if}
		{/if}

		<div class="mb-2 text-center sm:mb-3">
			<Badge color="blue" class="px-2 py-1 text-sm sm:px-3 sm:text-base">{getDisplayVersion()}</Badge>
			{#if selectedVersionTag && selectedVersionDisplay && selectedVersionDisplay !== selectedVersionTag}
				<div class="mt-1 text-xs text-gray-500 dark:text-gray-400">Tag: {selectedVersionTag}</div>
			{/if}
		</div>

		{#if rollout && !hasForceDeployAnnotation(rollout)}
			<div
				class="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4"
			>
				<div class="flex-1">
					<div class="text-sm font-medium text-gray-700 dark:text-gray-300">Pin Version</div>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						{#if isPinVersionMode}
							Pinning enabled for this deployment.
						{:else}
							Prevents automatic deployment from changing this version.
						{/if}
					</p>
				</div>
				<div class="flex items-center">
					<Toggle
						bind:checked={pinVersionToggle}
						disabled={isPinVersionToggleDisabled}
						color="blue"
					/>
					{#if isPinVersionMode}
						<Tooltip placement="top"
							>Pin-only: Older than current version, must pin to roll back.</Tooltip
						>
					{/if}
				</div>
			</div>
		{/if}

		<div>
			<label
				for="deploy-explanation"
				class="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:mb-2 sm:text-sm"
			>
				Explanation (Optional)
			</label>
			<textarea
				id="deploy-explanation"
				bind:value={deployExplanation}
				placeholder={pinVersionToggle
					? 'Reason for pinning...'
					: 'Reason for force deploy...'}
				class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
				rows="2"
			></textarea>
		</div>

		<div>
			<label
				for="deploy-confirmation-version"
				class="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300 sm:mb-2 sm:text-sm"
			>
				Type to confirm: <span class="font-bold text-gray-900 dark:text-white"
					>{getDisplayVersion()}</span
				>
			</label>
			<input
				id="deploy-confirmation-version"
				type="text"
				bind:value={deployConfirmationVersion}
				placeholder={`Enter ${getDisplayVersion() ? 'version' : 'version'}`}
				class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
			/>
		</div>

		<p class="text-xs text-gray-500 dark:text-gray-400">
			{#if pinVersionToggle}
				Deploys <b>{selectedVersionTag}</b> and pins it.
			{:else}
				Force deploys <b>{selectedVersionTag}</b> immediately.
			{/if}
		</p>

		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button
				color="light"
				class="w-full sm:w-auto"
				onclick={() => {
					open = false;
				}}
			>
				Cancel
			</Button>
			<Button
				color="blue"
				class="w-full sm:w-auto"
				disabled={!selectedVersionTag || deployConfirmationVersion !== getDisplayVersion()}
				onclick={handleDeploy}
			>
				Deploy
			</Button>
		</div>
	</div>
</Modal>

{#if showLocalToast}
	<Toast class="fixed right-4 top-24 z-50 rounded-lg" bind:toastStatus={showLocalToast}>
		{#snippet icon()}
			<div
				class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {localToastType ===
				'success'
					? 'bg-green-100 text-green-500 dark:bg-green-800 dark:text-green-200'
					: 'bg-red-100 text-red-500 dark:bg-red-800 dark:text-red-200'}"
			>
				{#if localToastType === 'success'}
					<CheckCircleSolid class="h-5 w-5" />
				{:else}
					<ExclamationCircleSolid class="h-5 w-5" />
				{/if}
			</div>
		{/snippet}
		{localToastMessage}
	</Toast>
{/if}

<style></style>
