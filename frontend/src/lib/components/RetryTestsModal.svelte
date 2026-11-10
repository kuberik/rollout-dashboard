<svelte:options runes={true} />

<script lang="ts">
	import { Modal } from 'flowbite-svelte';
	import { ExclamationCircleSolid, RefreshOutline, ForwardStepOutline } from 'flowbite-svelte-icons';
	import type { RolloutTest } from '../../types';
	import { modalFocusReturn } from '$lib/a11y.svelte';

	interface Props {
		open: boolean;
		failedTests: { test: RolloutTest; kruiseRolloutName: string }[];
		onRetryTests: () => void;
		onSkipTests: () => void;
	}

	let { open = $bindable(), failedTests, onRetryTests, onSkipTests }: Props = $props();

	// See `a11y.svelte.ts`: the dialog traps focus natively but cannot return it.
	modalFocusReturn(() => open);

	function getDisplayName(test: RolloutTest): string {
		return test.metadata?.annotations?.['kuberik.com/display-name'] || test.metadata?.name || 'Unknown test';
	}
</script>

<!-- ⭐ DIALOG CHROME PER §3.14, ON THE SHARED RISK-DIALOG SHELL. (round 2,
     2026-10-08, design review 4) A centred 48px glyph + card used to be this
     file's own composition; now it shares `RecoveryModeWarningModal`'s own
     header bar (40px disc, left-aligned, `border-b`) so every risk dialog in
     this lane reads as one family. `role="dialog" aria-modal="true"` added —
     the other risk dialogs already carry it, this one had not. The two
     choice rows (Retry Tests / Skip Tests) stay "new by design" (own note
     below): a dialog footer is one right-aligned button row, not two
     full-width choice cards, and the role here is a FORK, not a confirm/
     cancel pair — no existing component draws that. Proportions borrowed
     from `.tile` (bordered row, icon-in-a-disc, name + one meta line) so the
     two choices read as the product's own tile grammar rather than a
     bespoke card. The failed-tests list drops its tinted row band — hue
     lives in the header disc and the one 12px status glyph per row, never a
     band (same rule the other risk dialogs now follow). -->
<Modal
	bind:open
	title=""
	size="sm"
	role="dialog"
	aria-modal="true"
	class="rounded-lg bg-overlay"
	classes={{ body: 'p-0 space-y-0' }}
	aria-labelledby="rtm-title"
	aria-describedby="rtm-sub"
>
	<div class="border-b border-line px-5 py-4">
		<div class="flex items-start gap-3">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-tint ring-1 ring-danger-line">
				<ExclamationCircleSolid class="h-5 w-5 text-danger" />
			</div>
			<div class="min-w-0">
				<h2 id="rtm-title" class="t-heading text-fg">
					{failedTests.length === 1 ? '1 test failed' : `${failedTests.length} tests failed`}
				</h2>
				<p id="rtm-sub" class="t-meta text-fg-subtle">How would you like to proceed?</p>
			</div>
		</div>
	</div>

	<div class="px-5 py-4">
		<!-- Failed tests list — neutral row, the status glyph carries the ink. -->
		<ul class="space-y-1" aria-label="Failed tests">
			{#each failedTests as { test }}
				<li class="flex items-center gap-2 rounded-xs border border-line-subtle px-3 py-2">
					<ExclamationCircleSolid class="h-3 w-3 shrink-0 text-danger" />
					<span class="t-card-title min-w-0 flex-1 truncate text-fg">{getDisplayName(test)}</span>
					{#if (test.status?.retryCount ?? 0) > 0}
						<span class="shrink-0 t-meta text-fg-subtle">
							{test.status?.retryCount}× retried
						</span>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- The fork: two tile-shaped choices, not a confirm/cancel pair. -->
		<div class="mt-5 space-y-3">
			<button
				type="button"
				class="tile tile-link tap-zone flex w-full items-center gap-3 text-left"
				onclick={() => { open = false; onRetryTests(); }}
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-active-tint">
					<RefreshOutline class="h-4 w-4 text-active" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="t-card-title text-fg">Retry tests</p>
					<p class="t-meta text-fg-subtle">Re-run tests. Pipeline stays paused until they pass.</p>
				</div>
			</button>

			<button
				type="button"
				class="tile tile-link tap-zone flex w-full items-center gap-3 text-left"
				onclick={() => { open = false; onSkipTests(); }}
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle">
					<ForwardStepOutline class="h-4 w-4 text-fg-subtle" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="t-card-title text-fg">Skip tests</p>
					<p class="t-meta text-fg-subtle">Continue pipeline and ignore test results.</p>
				</div>
			</button>
		</div>
	</div>

	<div class="flex justify-end border-t border-line px-5 py-3">
		<button
			type="button"
			class="btn btn-ghost btn-sm"
			onclick={() => { open = false; }}
		>
			Cancel
		</button>
	</div>
</Modal>
