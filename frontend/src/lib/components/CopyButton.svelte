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
	import {
		ClipboardCleanOutline,
		CheckOutline,
		ExclamationCircleOutline
	} from 'flowbite-svelte-icons';
	import { announce } from '$lib/stores/announce.svelte';

	/**
	 * ⭐ D-13 (2026-10-08, "system" lane): THE BUTTON NOW USES `.btn`'S OWN
	 * LADDER INSTEAD OF A SEPARATE flowbite SIZE SCALE. `size="xs"`
	 * rendered 28px tall next to a 36px `Deploy` and a hand-rolled 24px
	 * `Refresh` on the same Overview card — three heights sharing one row.
	 * `xs`/`sm`/`md` here now map 1:1 to `app.css`'s `.btn-xs`/`.btn-sm`/
	 * `.btn` (28/32/36px, ONE radius at every step), so a caller sitting
	 * beside `.btn-primary` (Deploy, 36px) picks `size="md"` and the two
	 * controls line up exactly; the icon-only call sites that used to pass
	 * `class="!p-1.5"` to fight flowbite's padding can drop that override
	 * — `.btn-icon` already gives a square box at the chosen size. Existing
	 * call sites (`xs`, the default) are UNCHANGED in height (28px) and
	 * only trade their old box-model for the same numbers drawn from one
	 * shared class instead of a second, uncoordinated one.
	 */
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
		/** `.btn-xs` (28px, default — dense rows) / `.btn-sm` (32px) / `.btn` (36px — beside a `.btn-primary` row). */
		size?: 'xs' | 'sm' | 'md';
		/** `light`/`alternative` both render `.btn-secondary`; `primary` renders
		 *  `.btn-primary`; `ghost` renders `.btn-ghost` (a row/card-header
		 *  utility action with no box until hover — round 2, 2026-10-08). */
		color?: 'light' | 'alternative' | 'primary' | 'ghost';
		class?: string;
	}

	let { value, label, text, size = 'xs', color = 'light', class: className = '' }: Props = $props();

	const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
		xs: 'btn-xs',
		sm: 'btn-sm',
		md: ''
	};
	const sizeClass = $derived(SIZE_CLASS[size]);
	/** §3.6: a button icon is 12px at the 28px height, 16px above it. */
	const iconClass = $derived(size === 'xs' ? 'h-3 w-3' : 'h-4 w-4');
	const colorClass = $derived(
		color === 'primary' ? 'btn-primary' : color === 'ghost' ? 'btn-ghost' : 'btn-secondary'
	);

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

<button
	type="button"
	class="btn {colorClass} {sizeClass} {text ? '' : 'btn-icon'} {className}"
	onclick={copy}
	aria-label={accessibleName}
	title={accessibleName}
>
	{#if state === 'copied'}
		<CheckOutline class={iconClass} />
		{#if text}Copied{/if}
	{:else if state === 'failed'}
		<ExclamationCircleOutline class="{iconClass} text-danger" />
		{#if text}Copy failed{/if}
	{:else}
		<ClipboardCleanOutline class={iconClass} />
		{#if text}{text}{/if}
	{/if}
</button>
