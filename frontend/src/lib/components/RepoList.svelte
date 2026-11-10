<svelte:options runes={true} />

<script lang="ts">
	/** Home's body (r39 kit `repoList`, a9): ONE list card, a RepoCard `shell="item"` per repo, items split by one subtle line. */
	import type { Snippet } from 'svelte';
	let { class: className = '', children }: { class?: string; children: Snippet } = $props();
</script>

<ul class="divide-y divide-line-subtle overflow-hidden rounded-lg border border-line bg-surface {className}">{@render children()}</ul>
