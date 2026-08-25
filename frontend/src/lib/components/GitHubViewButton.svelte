<script lang="ts">
	import { Button } from 'flowbite-svelte';
	import { GithubSolid } from 'flowbite-svelte-icons';
	import { buildGitHubTreeUrl, getGitHubRef } from '$lib/utils';

	export let sourceUrl: string;
	export let version: string;
	export let revision: string | undefined = undefined;
	export let size: 'xs' | 'sm' | 'md' | 'lg' = 'xs';
	export let color: 'light' | 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'dark' = 'light';

	function openGitHubUrl() {
		const ref = getGitHubRef({ revision, version, tag: version });
		const githubUrl = buildGitHubTreeUrl(sourceUrl, ref);
		if (githubUrl) {
			window.open(githubUrl, '_blank');
		}
	}
</script>

<Button {size} {color} onclick={openGitHubUrl} title="View on GitHub">
	<GithubSolid class="me-2 h-4 w-4" />
	View on GitHub
</Button>
