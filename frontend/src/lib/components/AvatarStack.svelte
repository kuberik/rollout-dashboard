<svelte:options runes={true} />

<script lang="ts">
	/**
	 * AVATAR STACK: who shipped to it, as one row of faces. One component for
	 * every facepile (the /apps tile footer, CommitSummary's contributors).
	 *
	 * ROLE: a set of actors read as one mark, the way Linear's assignee stack
	 * and GitHub's contributor facepile draw it. The two copies this replaces
	 * were drawn two ways (−4px and −6px overlap, a ring on an INLINE wrapper
	 * span) and the inline wrapper put photo avatars on a different baseline
	 * from monogram discs, so a mixed stack zig-zagged by 5px (visual audit #8,
	 * 2026-11-13).
	 *
	 * Geometry: a flex row, `items-center`, each `Avatar` a flex item (no
	 * wrapper), so every face shares one centre line whatever it holds. Discs
	 * sit edge to edge and each one's 2px ring in the host's ground (`Avatar`'s
	 * own outer shadow) notches 2px out of its left neighbour. That is the
	 * whole overlap a monogram can afford: two letters at 10/600 measure
	 * 12-15px in a 20px disc, so any deeper overlap cuts into the letters
	 * (measured at -6px: `PS AW MC` read as `P5 AV M`). Past `max`, a `+N`
	 * disc in the same size and the same neutral fallback ground as a
	 * monogram, never loose text.
	 */
	import Avatar from './Avatar.svelte';

	type Person = { name: string; src?: string | null };

	let {
		people,
		max = 3,
		size = 20,
		class: className = ''
	}: {
		people: Person[];
		/** faces drawn before the `+N` disc */
		max?: number;
		size?: 16 | 20 | 24;
		class?: string;
	} = $props();

	const shown = $derived(people.slice(0, max));
	const rest = $derived(Math.max(0, people.length - max));
</script>

<span class="avatar-stack inline-flex shrink-0 items-center {className}" style="--as-size:{size}px">
	{#each shown as p, i (p.name + i)}
		<Avatar name={p.name} src={p.src ?? null} {size} />
	{/each}
	{#if rest > 0}
		<span class="as-more tabular-nums" aria-label="{rest} more" title="{rest} more">+{rest}</span>
	{/if}
</span>

<style>
	/* the +N disc wears a monogram disc's ground, ring and ink (Avatar's `.avatar-fallback`) */
	.as-more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		height: var(--as-size);
		min-width: var(--as-size);
		padding: 0 3px;
		border-radius: 9999px;
		background: var(--k-raised);
		box-shadow: inset 0 0 0 1px var(--k-line), 0 0 0 2px var(--av-ring, var(--k-surface));
		color: var(--k-fg-muted);
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
	}
</style>
