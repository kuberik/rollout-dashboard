<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { Button } from 'flowbite-svelte';
	import { ChevronLeftOutline } from 'flowbite-svelte-icons';
	import type { Rollout } from '../../../../../../types';
	import { theme } from '$lib/stores/theme';
	import { createPatch } from 'diff';
	import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui';
	import { ColorSchemeType } from 'diff2html/lib/types';
	import 'diff2html/bundles/css/diff2html.min.css';

	let rollout: Rollout | null = null;
	let loading = true;
	let error: string | null = null;
	let currentTheme: 'light' | 'dark' = 'light';
	let diffContainers: Record<string, HTMLElement | null> = {};
	let allFiles = new Set<string>();
	let patches: Record<string, string> = {};

	const { namespace, name, version } = $page.params;

	theme.subscribe((value) => {
		currentTheme = value;
		// Re-render diffs when theme changes
		Object.entries(diffContainers).forEach(([filename, container]) => {
			if (container && patches[filename]) {
				renderDiff(container, patches[filename]);
			}
		});
	});

	onMount(async () => {
		theme.init();
		await fetchRollout();
	});

	function renderDiff(targetElement: HTMLElement, patch: string) {
		const diff2htmlUi = new Diff2HtmlUI(targetElement, patch, {
			drawFileList: false,
			matching: 'lines' as const,
			outputFormat: 'side-by-side' as const,
			renderNothingWhenEmpty: false,
			colorScheme: currentTheme === 'dark' ? ColorSchemeType.DARK : ColorSchemeType.LIGHT
		});
		diff2htmlUi.draw();
		diff2htmlUi.highlightCode();
	}

	async function fetchRollout() {
		try {
			const response = await fetch(`/api/rollouts/${namespace}/${name}`);
			if (!response.ok) {
				throw new Error('Failed to fetch rollout details');
			}
			const data = await response.json();
			rollout = data.rollout;

			if (!rollout?.status?.history) {
				throw new Error('Rollout history not found');
			}

			// Find the current version and previous version in history
			const currentIndex = rollout.status.history.findIndex((h) => h.version === version);
			if (currentIndex === -1 || currentIndex === rollout.status.history.length - 1) {
				throw new Error('Version not found or no previous version to compare with');
			}

			const previousVersion = rollout.status.history[currentIndex + 1].version;

			// Fetch manifests for both versions
			const [currentManifest, previousManifest] = await Promise.all([
				fetch(`/api/rollouts/${namespace}/${name}/manifest/${version}`).then((r) => r.json()),
				fetch(`/api/rollouts/${namespace}/${name}/manifest/${previousVersion}`).then((r) =>
					r.json()
				)
			]);

			// Calculate diffs
			const currentFiles = currentManifest.files;
			const previousFiles = previousManifest.files;

			// Compare files that exist in both versions or were added/removed
			allFiles = new Set([...Object.keys(currentFiles), ...Object.keys(previousFiles)]);
			allFiles.forEach((filename) => {
				const oldContent = previousFiles[filename] || '';
				const newContent = currentFiles[filename] || '';
				patches[filename] = createPatch(filename, oldContent, newContent, previousVersion, version);

				if (diffContainers[filename]) {
					renderDiff(diffContainers[filename]!, patches[filename]);
				}
			});
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to fetch diff';
		} finally {
			loading = false;
		}
	}

	function handleDiffContainerBind(node: HTMLElement, filename: string) {
		if (patches[filename]) {
			renderDiff(node, patches[filename]);
		}
		diffContainers[filename] = node;

		return {
			update(newFilename: string) {
				if (patches[newFilename]) {
					renderDiff(node, patches[newFilename]);
				}
				diffContainers[newFilename] = node;
			},
			destroy() {
				if (diffContainers[filename] === node) {
					diffContainers[filename] = null;
				}
			}
		};
	}
</script>

<svelte:head>
	{#if currentTheme === 'dark'}
		<style>
			:root {
				--d2h-bg-color: rgb(17 24 39);
				--d2h-file-header-bg-color: rgb(31 41 55);
				--d2h-code-line-bg-color: rgb(17 24 39);
				--d2h-code-side-line-bg-color: rgb(17 24 39);
				--d2h-del-bg-color: rgb(127 29 29 / 0.1);
				--d2h-del-color: rgb(185 28 28);
				--d2h-ins-bg-color: rgb(20 83 45 / 0.1);
				--d2h-ins-color: rgb(22 101 52);
				--d2h-file-header-color: rgb(209 213 219);
				--d2h-code-line-color: rgb(209 213 219);
			}
		</style>
	{:else}
		<style>
			:root {
				--d2h-bg-color: white;
				--d2h-file-header-bg-color: rgb(243 244 246);
				--d2h-code-line-bg-color: white;
				--d2h-code-side-line-bg-color: white;
				--d2h-del-bg-color: rgb(254 226 226);
				--d2h-del-color: rgb(185 28 28);
				--d2h-ins-bg-color: rgb(220 252 231);
				--d2h-ins-color: rgb(22 101 52);
				--d2h-file-header-color: rgb(31 41 55);
				--d2h-code-line-color: rgb(31 41 55);
			}
		</style>
	{/if}
</svelte:head>

<div class="w-full px-4 py-8 dark:bg-gray-900">
	<div class="mb-6">
		<Button color="light" href={`/rollouts/${namespace}/${name}`}>
			<ChevronLeftOutline class="mr-2 h-4 w-4" />
			Back to Rollout
		</Button>
	</div>

	{#if loading}
		<div class="flex items-center justify-center p-8">
			<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900"></div>
		</div>
	{:else if error}
		<div class="p-4 text-red-500">{error}</div>
	{:else if !rollout}
		<div class="p-4 text-yellow-500">Rollout not found</div>
	{:else}
		<div class="mb-6">
			<h2 class="text-2xl font-bold text-gray-900 dark:text-white">
				<span class="text-gray-500 dark:text-gray-400">{namespace} / </span>
				{name}
			</h2>
			<p class="mt-2 text-gray-600 dark:text-gray-400">
				Comparing version {version} with previous version
			</p>
		</div>

		<div class="space-y-4">
			{#each [...allFiles] as filename}
				<div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
					<div
						class="border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
					>
						<h3 class="text-lg font-medium text-gray-900 dark:text-white">{filename}</h3>
					</div>
					<div class="overflow-x-auto" use:handleDiffContainerBind={filename}></div>
				</div>
			{/each}
		</div>
	{/if}
</div>
