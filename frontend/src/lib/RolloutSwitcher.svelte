<svelte:options runes={true} />

<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import type { Rollout } from '../types';
	import { getRolloutStatus } from '$lib/utils';
	import { SearchOutline } from 'flowbite-svelte-icons';

	let {
		open = $bindable(false),
		rollouts,
		currentNamespace,
		currentName,
		loading = false
	}: {
		open: boolean;
		rollouts: Rollout[];
		currentNamespace?: string;
		currentName?: string;
		loading?: boolean;
	} = $props();

	let searchInput = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);
	let query = $state('');
	let selectedIndex = $state(0);

	// Filter + sort (namespace first, then name)
	const filtered = $derived.by(() => {
		const q = query.toLowerCase().trim();
		const result = rollouts.filter((r) => {
			if (!q) return true;
			const name = r.metadata?.name?.toLowerCase() || '';
			const ns = r.metadata?.namespace?.toLowerCase() || '';
			const title = r.status?.title?.toLowerCase() || '';
			return name.includes(q) || ns.includes(q) || title.includes(q);
		});
		result.sort((a, b) => {
			const nsA = a.metadata?.namespace || '';
			const nsB = b.metadata?.namespace || '';
			if (nsA !== nsB) return nsA.localeCompare(nsB);
			return (a.metadata?.name || '').localeCompare(b.metadata?.name || '');
		});
		return result;
	});

	// Group filtered list by namespace (preserves flat index for kb nav)
	const grouped = $derived.by(() => {
		const g: { ns: string; items: { rollout: Rollout; idx: number }[] }[] = [];
		let current: { ns: string; items: { rollout: Rollout; idx: number }[] } | null = null;
		filtered.forEach((r, idx) => {
			const ns = r.metadata?.namespace || 'default';
			if (!current || current.ns !== ns) {
				current = { ns, items: [] };
				g.push(current);
			}
			current.items.push({ rollout: r, idx });
		});
		return g;
	});

	// On open: jump to current rollout, focus search
	$effect(() => {
		if (!open) return;
		(async () => {
			query = '';
			await tick();
			const idx = filtered.findIndex(
				(r) =>
					r.metadata?.name === currentName && r.metadata?.namespace === currentNamespace
			);
			selectedIndex = idx >= 0 ? idx : 0;
			searchInput?.focus();
			scrollSelectedIntoView();
		})();
	});

	function scrollSelectedIntoView() {
		requestAnimationFrame(() => {
			const el = listEl?.querySelector(`[data-idx="${selectedIndex}"]`);
			el?.scrollIntoView({ block: 'nearest' });
		});
	}

	function selectRollout(r: Rollout) {
		open = false;
		goto(`/rollouts/${r.metadata?.namespace}/${r.metadata?.name}`);
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
			const r = filtered[selectedIndex];
			if (r) selectRollout(r);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]" role="dialog" aria-modal="true" aria-label="Switch rollout">
		<!-- Backdrop -->
		<button
			type="button"
			aria-label="Close"
			class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm backdrop-enter"
			onclick={() => (open = false)}
		></button>

		<!-- Palette -->
		<div class="relative z-10 mx-4 w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-gray-200 palette-enter dark:bg-gray-800 dark:ring-gray-700">
			<!-- Search -->
			<div class="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<SearchOutline class="h-4 w-4 shrink-0 text-gray-400" />
				<input
					bind:this={searchInput}
					value={query}
					oninput={onInput}
					type="text"
					placeholder="Search rollouts..."
					autocomplete="off"
					spellcheck="false"
					class="flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 placeholder-gray-400 outline-none focus:outline-none focus:ring-0 dark:text-white"
				/>
				<kbd class="hidden shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 sm:inline-block">ESC</kbd>
			</div>

			<!-- List -->
			<div bind:this={listEl} class="max-h-[50vh] overflow-y-auto p-2">
				{#if loading && rollouts.length === 0}
					<div class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
						Loading rollouts...
					</div>
				{:else if filtered.length === 0}
					<div class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
						No rollouts match <span class="font-medium text-gray-700 dark:text-gray-300">"{query}"</span>
					</div>
				{:else}
					{#each grouped as group (group.ns)}
						<div class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
							{group.ns}
						</div>
						{#each group.items as item (`${group.ns}/${item.rollout.metadata?.name}`)}
							{@const r = item.rollout}
							{@const idx = item.idx}
							{@const isCurrent = r.metadata?.name === currentName && r.metadata?.namespace === currentNamespace}
							{@const status = getRolloutStatus(r)}
							{@const isActive = idx === selectedIndex}
							<button
								type="button"
								data-idx={idx}
								class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors {isActive
									? 'bg-blue-50 dark:bg-blue-900/40'
									: 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}"
								onclick={() => selectRollout(r)}
								onmouseenter={() => (selectedIndex = idx)}
							>
								<span class="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
									{#if status.color === 'yellow'}
										<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-60"></span>
									{/if}
									<span class="h-2 w-2 rounded-full {status.color === 'green' ? 'bg-green-500' : status.color === 'red' ? 'bg-red-500' : 'bg-yellow-500'}"></span>
								</span>
								<div class="flex min-w-0 flex-1 flex-col">
									<span class="truncate text-sm font-medium {isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-900 dark:text-white'}">
										{r.metadata?.name}
									</span>
									{#if r.status?.title}
										<span class="truncate text-xs text-gray-500 dark:text-gray-400">
											{r.status.title}
										</span>
									{/if}
								</div>
								{#if isCurrent}
									<span class="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">Current</span>
								{/if}
							</button>
						{/each}
					{/each}
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
				<div class="flex items-center gap-3">
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
				<span>{filtered.length} rollout{filtered.length === 1 ? '' : 's'}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes palette-in {
		0% {
			opacity: 0;
			transform: translateY(-6px) scale(0.97);
		}
		100% {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	@keyframes backdrop-in {
		0% {
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
	}
	.palette-enter {
		animation: palette-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
		transform-origin: center top;
	}
	.backdrop-enter {
		animation: backdrop-in 120ms ease-out;
	}
</style>
