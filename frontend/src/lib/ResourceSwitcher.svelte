<svelte:options runes={true} />

<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { SearchOutline } from 'flowbite-svelte-icons';

	type Item = {
		key: string;
		label: string;
		href: string;
		mono?: boolean;
		subtext?: string;
	};

	let {
		open = $bindable(false),
		title,
		items,
		currentKey
	}: {
		open: boolean;
		title: string;
		items: Item[];
		currentKey?: string;
	} = $props();

	let searchInput = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);
	let query = $state('');
	let selectedIndex = $state(0);

	const filtered = $derived.by(() => {
		const q = query.toLowerCase().trim();
		if (!q) return items;
		return items.filter(
			(i) => i.label.toLowerCase().includes(q) || (i.subtext ?? '').toLowerCase().includes(q)
		);
	});

	$effect(() => {
		if (!open) return;
		(async () => {
			query = '';
			await tick();
			const idx = filtered.findIndex((i) => i.key === currentKey);
			selectedIndex = idx >= 0 ? idx : 0;
			const isTouch =
				typeof window !== 'undefined' &&
				(window.matchMedia?.('(pointer: coarse)').matches ?? false);
			if (!isTouch) searchInput?.focus();
			scrollSelectedIntoView();
		})();
	});

	function scrollSelectedIntoView() {
		requestAnimationFrame(() => {
			const el = listEl?.querySelector(`[data-idx="${selectedIndex}"]`);
			el?.scrollIntoView({ block: 'nearest' });
		});
	}

	function select(i: Item) {
		open = false;
		goto(i.href);
	}

	function onInput(e: Event) {
		query = (e.currentTarget as HTMLInputElement).value;
		selectedIndex = 0;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
			scrollSelectedIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			scrollSelectedIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const i = filtered[selectedIndex];
			if (i) select(i);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-start justify-center sm:pt-[12vh]"
		role="dialog"
		aria-modal="true"
		aria-label={`Switch ${title}`}
	>
		<button
			type="button"
			aria-label="Close"
			class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm backdrop-enter"
			onclick={() => (open = false)}
		></button>

		<div
			class="relative z-10 flex h-full w-full flex-col overflow-hidden bg-white palette-enter dark:bg-gray-800 sm:mx-4 sm:h-auto sm:max-w-xl sm:rounded-xl sm:shadow-2xl sm:ring-1 sm:ring-gray-200 sm:dark:ring-gray-700"
		>
			<div
				class="flex shrink-0 items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
			>
				<SearchOutline class="h-4 w-4 shrink-0 text-gray-400" />
				<input
					bind:this={searchInput}
					value={query}
					oninput={onInput}
					type="text"
					placeholder={`Search ${title.toLowerCase()}…`}
					autocomplete="off"
					spellcheck="false"
					class="flex-1 border-0 bg-transparent p-0 text-base text-gray-900 placeholder-gray-400 outline-none focus:outline-none focus:ring-0 sm:text-sm dark:text-white"
				/>
				<kbd
					class="hidden shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 sm:inline-block"
					>ESC</kbd
				>
				<button
					type="button"
					aria-label="Close"
					onclick={() => (open = false)}
					class="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700/60 dark:hover:text-gray-200 sm:hidden"
				>
					<span class="text-xl leading-none" aria-hidden="true">×</span>
				</button>
			</div>

			<div bind:this={listEl} class="flex-1 overflow-y-auto p-2 sm:max-h-[50vh] sm:flex-none">
				{#if filtered.length === 0}
					<div class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
						No {title.toLowerCase()} match
						<span class="font-medium text-gray-700 dark:text-gray-300">"{query}"</span>
					</div>
				{:else}
					{#each filtered as i, idx}
						{@const isCurrent = i.key === currentKey}
						{@const isActive = idx === selectedIndex}
						<button
							type="button"
							data-idx={idx}
							aria-current={isCurrent ? 'page' : undefined}
							onclick={() => select(i)}
							onmouseenter={() => (selectedIndex = idx)}
							class="relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-3 text-left transition-colors sm:py-2 {isActive
								? 'bg-blue-50 dark:bg-blue-900/40'
								: 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}"
						>
							{#if isCurrent}
								<span
									class="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r-full bg-blue-500 dark:bg-blue-400"
									aria-hidden="true"
								></span>
							{/if}
							<div class="flex min-w-0 flex-1 flex-col">
								<span
									class="truncate text-sm font-medium {i.mono ? 'font-mono' : ''} {isActive
										? 'text-blue-700 dark:text-blue-200'
										: 'text-gray-900 dark:text-white'}"
								>
									{i.label}
								</span>
								{#if i.subtext}
									<span class="truncate text-xs text-gray-500 dark:text-gray-400">{i.subtext}</span>
								{/if}
							</div>
						</button>
					{/each}
				{/if}
			</div>

			<div
				class="flex shrink-0 items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
			>
				<div class="hidden items-center gap-3 sm:flex">
					<span class="flex items-center gap-1">
						<kbd class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700">↑</kbd>
						<kbd class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700">↓</kbd>
						<span>navigate</span>
					</span>
					<span class="flex items-center gap-1">
						<kbd class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700">↵</kbd>
						<span>select</span>
					</span>
				</div>
				<span>{filtered.length} {title.toLowerCase()}</span>
			</div>
		</div>
	</div>
{/if}
