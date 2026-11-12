<script lang="ts">
	import PageHeader from './PageHeader.svelte';
	let { show = false }: { show?: boolean } = $props();
</script>

<PageHeader title="t" eyebrow="Rollout">
	{#snippet identity()}{#if show}<span>chip</span>{/if}{/snippet}
	{#snippet summary()}{#if show}<span>sum</span>{/if}{/snippet}
	{#snippet below()}{#if show}<span>lane</span>{/if}{/snippet}
	{#snippet actions()}{#if show}<button>go</button>{/if}{/snippet}
</PageHeader>
