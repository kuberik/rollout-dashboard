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
	import { toDock } from '$lib/toast-dock';
	import { failureToasts, dismissFailure } from '$lib/stores/failure-toasts.svelte';

	/** At most this many failures show at once; the rest wait behind a "+N more failures" row. */
	const SHOWN = 3;
	let expanded = $state(false);
	const shown = $derived(expanded ? failureToasts.items : failureToasts.items.slice(-SHOWN));
	const hidden = $derived(failureToasts.items.length - shown.length);
	$effect(() => {
		if (failureToasts.items.length <= SHOWN) expanded = false;
	});

	/**
	 * Esc dismisses the newest failure, but only when nothing else owns Esc: no dialog, sheet or palette is open, and focus is not in a
	 * field the key would otherwise leave (a text input, a select, an editable region).
	 */
	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented || failureToasts.items.length === 0) return;
		if (document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"], [role="menu"]')) return;
		const a = document.activeElement as HTMLElement | null;
		if (a && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || a.isContentEditable)) return;
		dismissFailure(failureToasts.items[failureToasts.items.length - 1].id);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="pointer-events-none fixed right-2 left-2 z-[60] bottom-[calc(var(--tabbar-h,0px)+8px)] flex max-h-[calc(100dvh-var(--tabbar-h,0px)-72px)] flex-col items-stretch gap-2 overflow-y-auto sm:right-4 sm:bottom-4 sm:left-auto sm:w-[380px] [&>*]:pointer-events-auto"
	data-toast-dock
></div>

{#if hidden > 0}
	<!-- one quiet row above the newest few; it docks first (order 0) -->
	<button
		type="button"
		class="t-meta rounded-md bg-overlay px-4 py-2 text-left text-fg-muted"
		style="box-shadow: var(--k-shadow-overlay)"
		data-failure-more
		use:toDock={{ enabled: true, onDocked: () => {}, order: 0 }}
		onclick={() => (expanded = true)}>+{hidden} more failure{hidden === 1 ? '' : 's'}</button
	>
{/if}

{#each shown as t (t.id)}
	<Toast open={true} tone="danger" message={t.message} order={t.id} onclose={() => dismissFailure(t.id)} />
{/each}
