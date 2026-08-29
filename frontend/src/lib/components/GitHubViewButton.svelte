<script lang="ts">
	import { Button } from 'flowbite-svelte';
	import { GithubSolid } from 'flowbite-svelte-icons';

	export let sourceUrl: string;
	export let version: string;
	export let size: 'xs' | 'sm' | 'md' | 'lg' = 'xs';
	export let color: 'light' | 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'dark' = 'light';
	/**
	 * LAYOUT ONLY, forwarded to the underlying flowbite `Button`. It exists
	 * because flowbite's own radius is `rounded-lg` (8px) and DESIGN.md's
	 * budget is exactly two radii — so a caller that puts this button in a
	 * row beside other buttons can bring it into budget (`class="rounded"`)
	 * instead of hand-rolling a fourth GitHub button. Default is empty, so
	 * every existing call site renders byte-identically.
	 */
	let className = '';
	export { className as class };

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

<Button {size} {color} class={className} onclick={openGitHubUrl} title="View on GitHub">
	<GithubSolid class="me-2 h-4 w-4" />
	View on GitHub
</Button>
