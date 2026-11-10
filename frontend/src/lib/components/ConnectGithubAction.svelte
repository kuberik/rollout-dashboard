<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The inline "Connect GitHub" action for a region that is empty BECAUSE GitHub is not connected (QA #20, #9).
	 * Role: the sidebar/navbar control is the global one; a page that says "needs GitHub" must carry the remedy
	 * beside the sentence, not rely on the reader noticing the corner. Same `.btn-secondary` the navbar's connect shape draws.
	 */
	import { GithubSolid } from 'flowbite-svelte-icons';
	import { connectGithub } from '$lib/api/github';

	/** spacing is the caller's (a sibling gap), not baked in */
	let { class: className = '', onclick = () => connectGithub() }: { class?: string; onclick?: () => void } = $props();
</script>

<button type="button" class="btn btn-secondary btn-sm {className}" data-connect-github {onclick}>
	<GithubSolid class="h-4 w-4" aria-hidden="true" />
	Connect GitHub
</button>
