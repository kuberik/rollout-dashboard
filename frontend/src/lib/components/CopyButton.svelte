<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE UNNAMED BUTTON THAT FAILED IN SILENCE.
	 *
	 * Two defects, one control, found by a live UX critique and confirmed by
	 * dumping the accessibility tree of rollout detail on 2026-08-30: the page
	 * carried **nineteen** `<button>`s with no accessible name of any kind — no
	 * text, no `title`, no `aria-label` — one on every release-candidate row.
	 * They were `flowbite-svelte`'s `Clipboard` with an icon-only children
	 * snippet, and `Clipboard` contributes no name of its own.
	 *
	 * The second defect is worse than the first. `Clipboard` sets `success =
	 * true` BEFORE it awaits `navigator.clipboard.writeText`, and on rejection
	 * it does `console.error(...)` and silently reverts. So a blocked clipboard
	 * — the browser's default when the document is not focused, which is
	 * exactly the state a click from a background window leaves it in —
	 * produced a tick that flashed and vanished, an error only in devtools, and
	 * an operator who believes they are holding a version tag they are not.
	 *
	 * This component is a drop-in with the same geometry (`Button` + the
	 * `gap-2` the `Clipboard` theme adds, same `size`/`color`/`class`
	 * pass-through) so the reference pages do not move a pixel, and it:
	 *
	 * - has a name that says what will be copied;
	 * - only claims success after `writeText` resolves;
	 * - falls back to `execCommand('copy')` before giving up;
	 * - says so out loud on BOTH outcomes, in the live region and on screen.
	 */
	import { Button } from 'flowbite-svelte';
	import {
		ClipboardCleanSolid,
		CheckOutline,
		ExclamationCircleOutline
	} from 'flowbite-svelte-icons';
	import { announce } from '$lib/stores/announce.svelte';

	interface Props {
		/** The exact string placed on the clipboard. */
		value: string;
		/**
		 * What the value IS, in words, for the accessible name — e.g.
		 * `version 0afab6f`. The button reads `Copy version 0afab6f`.
		 */
		label: string;
		/** Optional visible text. Omit for the icon-only form. */
		text?: string;
		size?: 'xs' | 'sm' | 'md';
		color?: 'light' | 'alternative' | 'primary';
		class?: string;
	}

	let { value, label, text, size = 'xs', color = 'light', class: className = '' }: Props = $props();

	type State = 'idle' | 'copied' | 'failed';
	let state = $state<State>('idle');
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	function schedule() {
		clearTimeout(resetTimer);
		resetTimer = setTimeout(() => (state = 'idle'), 2500);
	}

	/** Last-resort path for browsers/contexts where the async API is refused. */
	function execCommandCopy(text: string): boolean {
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.top = '-1000px';
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand('copy');
			document.body.removeChild(ta);
			return ok;
		} catch {
			return false;
		}
	}

	async function copy() {
		let ok = false;
		try {
			await navigator.clipboard.writeText(value);
			ok = true;
		} catch {
			ok = execCommandCopy(value);
		}
		state = ok ? 'copied' : 'failed';
		announce(
			ok
				? `Copied ${label} to the clipboard`
				: `Could not copy ${label}. The browser blocked clipboard access — select the text and copy it manually.`,
			ok ? 'polite' : 'assertive'
		);
		schedule();
	}

	const accessibleName = $derived(
		state === 'copied'
			? `Copied ${label}`
			: state === 'failed'
				? `Copy ${label} — failed, clipboard blocked`
				: `Copy ${label}`
	);
</script>

<Button
	{size}
	{color}
	class="gap-2 {className}"
	onclick={copy}
	aria-label={accessibleName}
	title={accessibleName}
>
	{#if state === 'copied'}
		<CheckOutline class="h-3.5 w-3.5 {text ? 'mr-1 h-3 w-3' : ''}" />
		{#if text}Copied{/if}
	{:else if state === 'failed'}
		<ExclamationCircleOutline
			class="h-3.5 w-3.5 text-red-600 dark:text-red-400 {text ? 'mr-1 h-3 w-3' : ''}"
		/>
		{#if text}Copy failed{/if}
	{:else}
		<ClipboardCleanSolid class="h-3.5 w-3.5 {text ? 'mr-1 h-3 w-3' : ''}" />
		{#if text}{text}{/if}
	{/if}
</Button>
