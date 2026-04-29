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

<Modal bind:open title="" size="sm" class="[&>div]:p-0">
	<div class="p-6">
		<!-- Version header -->
		<div class="mb-6 text-center">
			<div class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Deploy Version</div>
			<div class="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-2 dark:bg-blue-900/30">
				<span class="text-xl font-bold text-blue-600 dark:text-blue-400">{getDisplayVersion()}</span>
			</div>
		</div>

		{#if rollout && rollout.metadata}
			{#if rollout && !rollout.metadata?.managedFields && hasForceDeployAnnotation(rollout)}
				<Alert color="yellow" class="mb-4 text-sm">
					<ExclamationCircleSolid class="h-4 w-4" />
					<span class="font-medium">Warning:</span> Version management disabled, force deploy already set.
				</Alert>
			{:else if rollout && hasForceDeployAnnotation(rollout)}
				<Alert color="blue" class="mb-4 text-sm">
					<ExclamationCircleSolid class="h-4 w-4" />
					<span class="font-medium">Info:</span> Force deploy already set. Only version pinning available.
				</Alert>
			{/if}
		{/if}

		<div class="space-y-4">
			{#if rollout && !hasForceDeployAnnotation(rollout)}
				<div
					class="flex items-center justify-between rounded-lg bg-gray-50 p-4 dark:bg-gray-800"
				>
					<div>
						<div class="font-medium text-gray-900 dark:text-white">Pin Version</div>
						<p class="text-sm text-gray-500 dark:text-gray-400">
							{#if isPinVersionMode}
								Required for rollback
							{:else}
								Lock to this version
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
							<Tooltip placement="top">Older than current version, must pin to roll back.</Tooltip>
						{/if}
					</div>
				</div>
			{/if}

			<div>
				<label
					for="deploy-explanation"
					class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
				>
					Explanation <span class="font-normal text-gray-400">(optional)</span>
				</label>
				<textarea
					id="deploy-explanation"
					bind:value={deployExplanation}
					placeholder="Why are you deploying this version?"
					class="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 dark:focus:border-blue-500"
					rows="2"
				></textarea>
			</div>

			<div>
				<label
					for="deploy-confirmation-version"
					class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
				>
					Type <span class="font-bold text-blue-600 dark:text-blue-400">{getDisplayVersion()}</span> to confirm
				</label>
				<input
					id="deploy-confirmation-version"
					type="text"
					bind:value={deployConfirmationVersion}
					placeholder="Enter version to confirm"
					class="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 dark:focus:border-blue-500"
				/>
			</div>
		</div>

		<!-- Footer -->
		<div class="mt-6 flex gap-3">
			<Button
				color="light"
				class="flex-1"
				onclick={() => {
					open = false;
				}}
			>
				Cancel
			</Button>
			<Button
				color="blue"
				class="flex-1"
				disabled={!selectedVersionTag || deployConfirmationVersion !== getDisplayVersion()}
				onclick={handleDeploy}
			>
				{#if pinVersionToggle}
					Pin & Deploy
				{:else}
					Deploy Now
				{/if}
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
