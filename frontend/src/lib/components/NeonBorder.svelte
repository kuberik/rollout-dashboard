<svelte:options runes={true} />

<script lang="ts">
	interface Props {
		active?: boolean;
		colors?: string[];
		blur?: boolean;
		opacity?: number;
		class?: string;
		rounded?: string;
		children?: import('svelte').Snippet;
	}

	let {
		active = false,
		colors = ['#1e40af', '#3b82f6', '#1e40af'],
		blur = true,
		opacity = 0.7,
		class: className = '',
		rounded = 'rounded-lg',
		children
	}: Props = $props();
</script>

<div class="relative {className}">
	{#if active && blur}
		<div
			class="animate-gradient-rotate absolute -inset-1 {rounded} pointer-events-none blur"
			style="background: conic-gradient(from var(--angle), {colors.join(',')}); opacity: {opacity};"
		></div>
	{/if}
	<div class="relative overflow-hidden {rounded} p-[1px]">
		{#if active}
			<div
				class="animate-gradient-rotate pointer-events-none absolute inset-[-1000%]"
				style="background: conic-gradient(from var(--angle), {colors.join(',')});"
			></div>
		{/if}
		<div class="relative {rounded}">
			{#if children}
				{@render children()}
			{/if}
		</div>
	</div>
</div>
