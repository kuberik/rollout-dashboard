<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The failure toasts' host, mounted once in the root layout. Role: the one place a failed request is reported when its dialog is gone;
	 * no existing component fits because `Toast` is a single page-local message with a timer. It reuses `Toast` for the face and takes the
	 * house dock: bottom-right from `sm`, and on a phone at the bottom, 8px above the fixed tab bar, stacked newest last.
	 */
	import Toast from './Toast.svelte';
	import { failureToasts, dismissFailure } from '$lib/stores/failure-toasts.svelte';
</script>

{#if failureToasts.items.length > 0}
	<div
		class="pointer-events-none fixed right-2 left-2 z-[60] bottom-[calc(var(--tabbar-h,0px)+8px)] flex flex-col items-stretch gap-2 sm:right-4 sm:bottom-4 sm:left-auto sm:w-[380px]"
		data-failure-toasts
	>
		{#each failureToasts.items as t (t.id)}
			<div class="pointer-events-auto">
				<Toast open={true} tone="danger" message={t.message} floating={false} onclose={() => dismissFailure(t.id)} />
			</div>
		{/each}
	</div>
{/if}
