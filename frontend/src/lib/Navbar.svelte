<script lang="ts">
	import { onMount } from 'svelte';
	import { MoonSolid, SunSolid } from 'flowbite-svelte-icons';
	import LogoDark from '$lib/assets/logo-rotate-dark.svg?raw';
	import LogoLight from '$lib/assets/logo-rotate-light.svg?raw';
	import { theme } from '$lib/stores/theme';

	let currentTheme: 'light' | 'dark' = 'light';

	theme.subscribe((value) => {
		currentTheme = value;
	});

	onMount(() => {
		theme.init();
	});
</script>

<nav
	class="sticky top-0 z-50 w-full border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
>
	<div class="flex w-full flex-wrap items-center justify-between p-4">
		<a href="/" class="flex items-center space-x-3 rtl:space-x-reverse">
			<div class="flex h-8 w-8 items-center justify-center">
				<div
					class="h-full w-full [&>svg]:h-full [&>svg]:max-h-full [&>svg]:w-full [&>svg]:max-w-full"
				>
					{@html currentTheme === 'dark' ? LogoDark : LogoLight}
				</div>
			</div>
			<span class="font-montserrat text-xl font-thin text-gray-600 dark:text-gray-400">kuberik</span
			>
			<div class="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
			<div class="flex flex-col">
				<span class="text-2xl font-light dark:text-white">Rollouts</span>
			</div>
		</a>
		<div class="flex items-center space-x-3">
			<button
				class="rounded-lg bg-gray-100 p-2 text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
				onclick={() => theme.toggle()}
				aria-label="Toggle dark mode"
			>
				{#if currentTheme === 'dark'}
					<SunSolid class="h-5 w-5" />
				{:else}
					<MoonSolid class="h-5 w-5" />
				{/if}
			</button>
		</div>
	</div>
</nav>
