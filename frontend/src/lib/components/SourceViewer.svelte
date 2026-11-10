<script lang="ts">
	import { onMount } from 'svelte';
	import { Modal, Tabs, TabItem } from 'flowbite-svelte';
	import Highlight from 'svelte-highlight';
	import yaml from 'svelte-highlight/languages/yaml';
	import plaintext from 'svelte-highlight/languages/plaintext';
	import githubDark from 'svelte-highlight/styles/github-dark';
	import githubLight from 'svelte-highlight/styles/github';
	import { theme } from '$lib/stores/theme';
	import { CodeOutline } from 'flowbite-svelte-icons';
	import { apiPath } from '$lib/api/urls';
	export let namespace: string;
	export let name: string;
	export let version: string;
	// Spoke URL when this rollout lives on a remote cluster — appended as
	// ?cluster=<name> so the hub proxies the manifest fetch to that spoke.
	export let cluster: string | undefined = undefined;

	let files: Record<string, string> = {};
	let loading = false;
	let error: string | null = null;
	let showModal = false;
	let currentTheme: 'light' | 'dark' = 'light';

	theme.subscribe((value) => {
		currentTheme = value;
	});

	onMount(() => {
		theme.init();
	});

	async function fetchFiles() {
		loading = true;
		error = null;
		try {
			const response = await fetch(
				apiPath(cluster, `/rollouts/${namespace}/${name}/manifest/${version}`)
			);
			if (!response.ok) {
				throw new Error(`Failed to fetch files: ${response.statusText}`);
			}
			const data = await response.json();
			files = data.files;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to fetch files';
		} finally {
			loading = false;
		}
	}

	function getFileExtension(filename: string): string {
		return filename.split('.').pop() || '';
	}

	function getLanguage(filename: string): string {
		const ext = getFileExtension(filename);
		switch (ext) {
			case 'yaml':
			case 'yml':
				return 'yaml';
			case 'json':
				return 'json';
			case 'sh':
				return 'bash';
			case 'go':
				return 'go';
			case 'ts':
				return 'typescript';
			case 'js':
				return 'javascript';
			default:
				return 'plaintext';
		}
	}

	$: if (showModal && Object.keys(files).length === 0) {
		fetchFiles();
	}
</script>

<svelte:head>
	{#if currentTheme === 'dark'}
		{@html githubDark}
	{:else}
		{@html githubLight}
	{/if}
</svelte:head>

<button type="button" class="btn btn-secondary btn-xs" onclick={() => (showModal = true)}>
	<CodeOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
	View source
</button>

<Modal bind:open={showModal} size="xl">
	<div class="p-6">
		<h3 class="t-heading mb-4 text-fg">
			Source files for <span class="t-code">{name}</span> <span class="t-code-sm text-fg-subtle">v{version}</span>
		</h3>

		{#if loading}
			<div class="flex items-center justify-center p-8">
				<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-fg"></div>
			</div>
		{:else if error}
			<p class="t-body text-danger">{error}</p>
		{:else}
			<Tabs>
				{#each Object.entries(files) as [filename, content]}
					<TabItem title={filename}>
						<div class="t-code h-[60vh] overflow-auto rounded-md border border-line bg-subtle p-4">
							<Highlight
								language={getLanguage(filename) === 'yaml' ? yaml : plaintext}
								code={content}
							/>
						</div>
					</TabItem>
				{/each}
			</Tabs>
		{/if}
	</div>
</Modal>
