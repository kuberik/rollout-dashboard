<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE SECTION TAB STRIP of a detail page (rollout: Overview / History / Gates / Logs; app: Overview / Pipeline). ONE component so
	 * the two strips can never drift: the markup, the classes and the three tab states ('active' a real link, 'pending' a reserved
	 * disabled slot, 'hidden' removed) are the rollout layout's, moved here unchanged. The layouts own the reasoning (arity-stable
	 * tabs, the scroll-the-active-tab-into-view effect, publishing the strip into the shell chrome); this component only draws it.
	 * `el` is the scrolling row, bound by the layout for its scrollIntoView effect.
	 */
	import type { Component } from 'svelte';
	import { href as toHref } from '$lib/paths';

	export type SectionTab = {
		label: string;
		href: string;
		icon: Component<{ class?: string }>;
		state: 'active' | 'pending' | 'hidden';
	};

	let {
		tabs,
		label,
		isActive,
		inset = 'sm:px-3',
		el = $bindable(null)
	}: {
		tabs: SectionTab[];
		label: string;
		isActive: (href: string) => boolean;
		/** the strip's horizontal padding from `sm` up: the tab BOX aligns with the page container's edge (the rollout pages' is 12px, the app page's 24px) */
		inset?: string;
		el?: HTMLDivElement | null;
	} = $props();
</script>

<nav class="border-line bg-ground shrink-0 border-b" aria-label={label}>
	<div
		bind:this={el}
		class="no-scrollbar mx-auto flex w-full items-stretch overflow-x-auto px-4 sm:justify-start sm:gap-1 {inset}"
	>
		{#each tabs.filter((t) => t.state !== 'hidden') as t (t.href)}
			{@const active = t.state === 'active' && isActive(t.href)}
			{@const pending = t.state === 'pending'}
			{@const hidden = false}
			<a
				href={t.state === 'active' ? toHref(t.href) : undefined}
				aria-current={active ? 'page' : undefined}
				aria-disabled={pending ? 'true' : undefined}
				aria-hidden={hidden ? 'true' : undefined}
				tabindex={t.state === 'active' ? undefined : -1}
				title={t.label}
				class="group t-ui flex flex-1 flex-col items-center justify-center gap-0.5 border-b-2 px-1 py-2 transition-colors sm:h-11 sm:flex-initial sm:shrink-0 sm:flex-row sm:gap-2 sm:px-3 sm:py-0
					{hidden ? 'invisible' : ''}
					{pending ? 'cursor-default opacity-40' : ''}
					{active
					? 'border-accent text-fg'
					: 'text-fg-muted hover:border-line-strong hover:text-fg border-transparent'}"
			>
				<t.icon class="h-4 w-4 shrink-0" />
				<span class="max-w-full truncate leading-tight">{t.label}</span>
			</a>
		{/each}
	</div>
</nav>
