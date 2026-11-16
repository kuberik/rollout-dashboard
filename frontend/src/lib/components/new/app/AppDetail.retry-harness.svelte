<svelte:options runes={true} />
<script lang="ts">
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import AppDetail from './AppDetail.svelte';
	let { name }: { name: string } = $props();
	const client = new QueryClient();
</script>

<QueryClientProvider {client}><AppDetail state="calm" {name} /></QueryClientProvider>
