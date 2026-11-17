<svelte:options runes={true} />
<script lang="ts">
	import RetryConfirmModal from './RetryConfirmModal.svelte';
	import type { DeployIntent } from '$lib/view-models/deploy-risk';
	let { intent }: { intent: DeployIntent } = $props();
	let open = $state(true);
</script>

<RetryConfirmModal bind:open {intent} consequences={[]} tag="1.4.0" onConfirm={async () => {}} />
<output data-open>{open}</output>
