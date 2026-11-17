<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE TOAST DOCK, mounted once in the root layout. Role: the single column every floating toast stacks in (success, loading and failure
	 * alike, newest last, 8px apart), so two toasts never share coordinates; and the host of the failure list, the one place a failed request
	 * is reported when its dialog is gone. No existing component fits: `Toast` is one page-local message and cannot know its neighbours. It
	 * reuses `Toast` for the face (each floating toast moves itself into the dock, `toast-dock.ts`) and takes the house position:
	 * bottom-right from `sm`, and on a phone at the bottom, 8px above the fixed tab bar.
	 */
	import Toast from './Toast.svelte';
	import { failureToasts, dismissFailure } from '$lib/stores/failure-toasts.svelte';

	/**
	 * Esc dismisses the newest failure, but only when nothing else owns Esc: no dialog, sheet or palette is open, and focus is not in a
	 * field the key would otherwise leave (a text input, a select, an editable region).
	 */
	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented || failureToasts.items.length === 0) return;
		if (document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]')) return;
		const a = document.activeElement as HTMLElement | null;
		if (a && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || a.isContentEditable)) return;
		dismissFailure(failureToasts.items[failureToasts.items.length - 1].id);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="pointer-events-none fixed right-2 left-2 z-[60] bottom-[calc(var(--tabbar-h,0px)+8px)] flex flex-col items-stretch gap-2 sm:right-4 sm:bottom-4 sm:left-auto sm:w-[380px] [&>*]:pointer-events-auto"
	data-toast-dock
></div>

{#each failureToasts.items as t (t.id)}
	<Toast open={true} tone="danger" message={t.message} onclose={() => dismissFailure(t.id)} />
{/each}
