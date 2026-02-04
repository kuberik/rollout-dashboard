<script lang="ts">
	import { Button } from 'flowbite-svelte';
	import { GithubSolid } from 'flowbite-svelte-icons';

	export let sourceUrl: string;
	export let version: string;
	export let size: 'xs' | 'sm' | 'md' | 'lg' = 'xs';
	export let color: 'light' | 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'dark' = 'light';

	function openGitHubUrl() {
		// Convert to GitHub URL if it's a git URL
		let githubUrl = sourceUrl;
		if (sourceUrl.includes('github.com')) {
			// If it's already a GitHub URL, append the version
			githubUrl = sourceUrl.endsWith('/')
				? sourceUrl + 'tree/' + version
				: sourceUrl + '/tree/' + version;
			window.open(githubUrl, '_blank');
		} else if (sourceUrl.includes('git@github.com:')) {
			// Convert SSH to HTTPS and append version
			githubUrl = sourceUrl.replace('git@github.com:', 'https://github.com/') + '/tree/' + version;
			window.open(githubUrl, '_blank');
		} else if (sourceUrl.includes('.git')) {
			// Remove .git extension, append version
			githubUrl = sourceUrl.replace('.git', '') + '/tree/' + version;
			window.open(githubUrl, '_blank');
		} else {
			// Try to open as is with version
			githubUrl = sourceUrl.endsWith('/')
				? sourceUrl + 'tree/' + version
				: sourceUrl + '/tree/' + version;
			window.open(githubUrl, '_blank');
		}
	}
</script>

<Button {size} {color} onclick={openGitHubUrl} class="text-xs" title="View on GitHub">
	<GithubSolid class="h-3 w-3 sm:mr-1" />
	<span class="hidden sm:inline">View on GitHub</span>
</Button>
