<svelte:options runes={true} />

<script lang="ts">
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import type { Rollout, Environment } from '../types';
	import {
		getRolloutStatus,
		formatTimeAgoCompact,
		getDisplayVersion,
		detectStuck
	} from '$lib/utils';
	import { Badge } from 'flowbite-svelte';
	import {
		SearchOutline,
		GridOutline,
		RocketOutline,
		LayersSolid,
		ClockOutline,
		FolderOutline
	} from 'flowbite-svelte-icons';
	import {
		getEnvironmentThemeStyle,
		getRolloutEnvironmentTheme,
		shortEnvLabel
	} from '$lib/environment-theme';
	import { rolloutMatchesEnvironment, sourceDashboardURL, withDashboardParam } from '$lib/source-dashboard';
	import { now } from '$lib/stores/time';

	type ResultKind = 'rollout' | 'app' | 'env' | 'namespace' | 'action';

	let {
		open = $bindable(false),
		scope = $bindable(null),
		rollouts,
		environments,
		localClusterURL = '',
		currentNamespace,
		currentName,
		loading = false
	}: {
		open: boolean;
		scope?: ResultKind | null;
		rollouts: Rollout[];
		environments: Environment[];
		localClusterURL?: string;
		currentNamespace?: string;
		currentName?: string;
		loading?: boolean;
	} = $props();

	let searchInput = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);
	let query = $state('');
	let selectedIndex = $state(0);
	type Result = {
		kind: ResultKind;
		key: string;
		title: string;
		subtitle?: string;
		href: string;
		// Extra surface-area for visual cues
		envTheme?: ReturnType<typeof getRolloutEnvironmentTheme> | null;
		statusColor?: 'green' | 'red' | 'yellow' | null;
		statusText?: string;
		version?: string;
		timestamp?: string;
		stuck?: boolean;
		isCurrent?: boolean;
		// For `app` rows: per-env mini-strip data (env theme + bake status)
		envCells?: Array<{
			envName: string;
			theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
			bakeStatus: string;
			version: string | null;
		}>;
	};

	// Build the index from all entity types. The palette is a single
	// haystack — we filter/sort once, then render with section headers.
	const allResults = $derived.by<Result[]>(() => {
		const out: Result[] = [];

		// 1. Rollouts
		for (const r of rollouts) {
			// Pair to the rollout's Environment resource if one exists so we
			// pick up the env theme even when the rollout has no theme
			// annotations (e.g. kuberik-demo-app).
			const env = environments.find((e) => rolloutMatchesEnvironment(r, e));
			const theme = getRolloutEnvironmentTheme(r, env);
			const status = getRolloutStatus(r);
			const latest = r.status?.history?.[0];
			out.push({
				kind: 'rollout',
				// Source cluster must be part of the key: the hub merges rollouts
				// from multiple clusters, so namespace/name alone is not unique
				// and would produce duplicate keyed-each keys (crashes the list).
				key: `rollout:${sourceDashboardURL(r)}|${r.metadata?.namespace}/${r.metadata?.name}`,
				title: r.status?.title || r.metadata?.name || '',
				subtitle: r.metadata?.namespace,
				href: withDashboardParam(`/rollouts/${r.metadata?.namespace}/${r.metadata?.name}`, sourceDashboardURL(r), localClusterURL),
				envTheme: theme,
				statusColor: status.color,
				statusText: status.text,
				version: latest ? getDisplayVersion(latest.version) : undefined,
				timestamp: latest?.timestamp,
				stuck: !!detectStuck(r, { now: $now }),
				isCurrent:
					r.metadata?.name === currentName && r.metadata?.namespace === currentNamespace
			});
		}

		// 2. Apps (rollout name across envs)
		const appNames = new Set<string>();
		for (const env of environments) {
			const n = env.spec?.rolloutRef?.name;
			if (n) appNames.add(n);
		}
		for (const name of appNames) {
			const cells = environments.filter((e) => e.spec?.rolloutRef?.name === name);
			const envCells = cells
				.map((env) => {
					const envName = env.spec?.environment ?? '';
					const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
					const theme = r ? getRolloutEnvironmentTheme(r, env) : null;
					const latest = r?.status?.history?.[0];
					return {
						envName,
						theme,
						bakeStatus: latest?.bakeStatus ?? 'None',
						version: latest?.version ? getDisplayVersion(latest.version) : null
					};
				})
				.sort((a, b) => a.envName.localeCompare(b.envName));
			out.push({
				kind: 'app',
				key: `app:${name}`,
				title: name,
				subtitle: envCells.length > 0 ? `${envCells.length} env${envCells.length === 1 ? '' : 's'}` : undefined,
				href: `/apps/${encodeURIComponent(name)}`,
				envCells
			});
		}

		// 3. Environments
		const envNames = new Set<string>();
		for (const env of environments) {
			const n = env.spec?.environment;
			if (n) envNames.add(n);
		}
		for (const name of envNames) {
			const refRollout = (() => {
				for (const e of environments) {
					if (e.spec?.environment !== name) continue;
					const r = rollouts.find((r) => rolloutMatchesEnvironment(r, e));
					if (r) return r;
				}
				return null;
			})();
			const theme = refRollout ? getRolloutEnvironmentTheme(refRollout) : null;
			const appCount = environments.filter((e) => e.spec?.environment === name).length;
			out.push({
				kind: 'env',
				key: `env:${name}`,
				title: theme?.label || name,
				subtitle: `${appCount} app${appCount === 1 ? '' : 's'}`,
				href: `/envs/${encodeURIComponent(name)}`,
				envTheme: theme
			});
		}

		// 4. Namespaces
		const namespaces = new Set<string>();
		for (const r of rollouts) {
			const ns = r.metadata?.namespace;
			if (ns) namespaces.add(ns);
		}
		for (const ns of namespaces) {
			const nsRollouts = rollouts.filter((r) => r.metadata?.namespace === ns);
			out.push({
				kind: 'namespace',
				key: `ns:${ns}`,
				title: ns,
				subtitle: `${nsRollouts.length} rollout${nsRollouts.length === 1 ? '' : 's'}`,
				href: `/namespaces/${encodeURIComponent(ns)}`
			});
		}

		// 5. Actions (top-level pages)
		const actions: { title: string; href: string; subtitle?: string }[] = [
			{ title: 'Rollouts', subtitle: 'Home view', href: '/' },
			{ title: 'Apps', subtitle: 'Apps across environments', href: '/apps' },
			{ title: 'Environments', subtitle: 'Cross-env matrix', href: '/environments' },
			{ title: 'Activity', subtitle: 'Recent deployments', href: '/activity' }
		];
		for (const a of actions) {
			out.push({
				kind: 'action',
				key: `action:${a.href}`,
				title: a.title,
				subtitle: a.subtitle,
				href: a.href
			});
		}

		return out;
	});

	// Scoring: substring on title is best, then on subtitle/version/env, etc.
	// Tied scores fall back to entity-kind priority so users see rollouts first.
	const KIND_PRIORITY: Record<ResultKind, number> = {
		rollout: 4,
		app: 3,
		env: 2,
		namespace: 1,
		action: 0
	};
	function score(r: Result, q: string): number {
		if (!q) return KIND_PRIORITY[r.kind];
		const lower = q.toLowerCase();
		const hay = [
			r.title,
			r.subtitle ?? '',
			r.version ?? '',
			r.envTheme?.label ?? '',
			r.envTheme?.environmentName ?? ''
		]
			.join(' ')
			.toLowerCase();
		if (!hay.includes(lower)) return -1;
		let s = 0;
		const titleLower = r.title.toLowerCase();
		if (titleLower === lower) s += 100;
		else if (titleLower.startsWith(lower)) s += 60;
		else if (titleLower.includes(lower)) s += 30;
		if ((r.subtitle ?? '').toLowerCase().includes(lower)) s += 10;
		if ((r.version ?? '').toLowerCase().includes(lower)) s += 8;
		if ((r.envTheme?.label ?? '').toLowerCase().includes(lower)) s += 8;
		s += KIND_PRIORITY[r.kind] * 0.5;
		return s;
	}

	const filtered = $derived.by(() => {
		const q = query.trim();
		const scoped = scope ? allResults.filter((r) => r.kind === scope) : allResults;
		const scored = scoped
			.map((r) => ({ r, s: score(r, q) }))
			.filter((x) => x.s >= 0);
		scored.sort((a, b) => {
			if (b.s !== a.s) return b.s - a.s;
			return a.r.title.localeCompare(b.r.title);
		});
		return scored.slice(0, 200).map((x) => x.r);
	});

	// Group filtered results by kind for rendering. Keeps a flat index for kb nav.
	type Group = { kind: ResultKind; label: string; items: { result: Result; idx: number }[] };
	const KIND_LABEL: Record<ResultKind, string> = {
		rollout: 'Rollouts',
		app: 'Apps',
		env: 'Environments',
		namespace: 'Namespaces',
		action: 'Go to'
	};
	const KIND_SINGULAR: Record<ResultKind, string> = {
		rollout: 'rollout',
		app: 'app',
		env: 'environment',
		namespace: 'namespace',
		action: 'page'
	};
	const grouped = $derived.by<Group[]>(() => {
		const map = new Map<ResultKind, Group>();
		filtered.forEach((result, idx) => {
			let g = map.get(result.kind);
			if (!g) {
				g = { kind: result.kind, label: KIND_LABEL[result.kind], items: [] };
				map.set(result.kind, g);
			}
			g.items.push({ result, idx });
		});
		// Stable group order by kind priority
		return Array.from(map.values()).sort(
			(a, b) => KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind]
		);
	});

	$effect(() => {
		if (!open) return;
		(async () => {
			query = '';
			await tick();
			selectedIndex = 0;
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

	function pick(r: Result) {
		open = false;
		goto(r.href);
	}

	function onInput(e: Event) {
		query = (e.currentTarget as HTMLInputElement).value;
		selectedIndex = 0;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		const inPicker = !scope && !query;
		const maxIdx = inPicker ? 3 : filtered.length - 1;
		if (e.key === 'Escape') {
			e.preventDefault();
			// First ESC clears the scope (back to picker); second ESC closes.
			if (scope) {
				scope = null;
				query = '';
				selectedIndex = 0;
			} else {
				open = false;
			}
		} else if (e.key === 'Backspace' && query === '' && scope) {
			e.preventDefault();
			scope = null;
			selectedIndex = 0;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, maxIdx);
			scrollSelectedIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			scrollSelectedIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (inPicker) {
				const kinds: ResultKind[] = ['rollout', 'app', 'env', 'namespace'];
				const k = kinds[selectedIndex];
				if (k) {
					scope = k;
					selectedIndex = 0;
					searchInput?.focus();
				}
			} else {
				const r = filtered[selectedIndex];
				if (r) pick(r);
			}
		}
	}

	const KIND_ICON: Record<ResultKind, typeof GridOutline> = {
		rollout: GridOutline,
		app: RocketOutline,
		env: LayersSolid,
		namespace: FolderOutline,
		action: ClockOutline
	};
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-start justify-center sm:pt-[12vh]"
		role="dialog"
		aria-modal="true"
		aria-label="Command palette"
	>
		<button
			type="button"
			aria-label="Close"
			class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm backdrop-enter"
			onclick={() => (open = false)}
		></button>

		<div
			class="relative z-10 flex h-full w-full flex-col overflow-hidden bg-white palette-enter dark:bg-gray-800 sm:mx-4 sm:h-auto sm:max-w-2xl sm:rounded-xl sm:shadow-2xl sm:ring-1 sm:ring-gray-200 sm:dark:ring-gray-700"
		>
			<div class="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<SearchOutline class="h-4 w-4 shrink-0 text-gray-400" />
				{#if scope}
					{@const ScopeIcon = KIND_ICON[scope]}
					<span class="inline-flex shrink-0 items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700/60 dark:text-gray-200">
						<ScopeIcon class="h-3 w-3" />
						<span>{KIND_LABEL[scope]}</span>
						<button
							type="button"
							onclick={() => { scope = null; selectedIndex = 0; searchInput?.focus(); }}
							aria-label="Clear scope"
							class="-mr-0.5 ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-600/60 dark:hover:text-gray-200"
						>×</button>
					</span>
				{/if}
				<input
					bind:this={searchInput}
					value={query}
					oninput={onInput}
					type="text"
					placeholder={scope ? `Search ${KIND_LABEL[scope].toLowerCase()}…` : 'Search rollouts, apps, environments, namespaces…'}
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

			<div bind:this={listEl} class="flex-1 overflow-y-auto p-2 sm:max-h-[60vh] sm:flex-none">
				{#if loading && allResults.length === 0}
					<div class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
						Loading…
					</div>
				{:else if !scope && !query}
					<!-- Kind-picker mode: top-level categories. Click drills in. -->
					{@const kindCounts = (() => {
						const c: Record<ResultKind, number> = { rollout: 0, app: 0, env: 0, namespace: 0, action: 0 };
						for (const r of allResults) c[r.kind]++;
						return c;
					})()}
					<div class="px-2 pb-1 pt-2">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Browse</span>
					</div>
					<div class="grid gap-1.5 px-1 sm:grid-cols-2">
						{#each (['rollout','app','env','namespace'] as ResultKind[]) as kind, kindIdx}
							{@const KIcon = KIND_ICON[kind]}
							{@const sel = kindIdx === selectedIndex}
							<button
								type="button"
								data-idx={kindIdx}
								onclick={() => { scope = kind; selectedIndex = 0; searchInput?.focus(); }}
								onmouseenter={() => (selectedIndex = kindIdx)}
								class="group flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-3 text-left transition-colors dark:border-gray-700 {sel ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50/50 hover:bg-gray-100 dark:bg-gray-700/30 dark:hover:bg-gray-700/60'}"
							>
								<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-400">
									<KIcon class="h-4 w-4" />
								</span>
								<span class="flex flex-1 flex-col gap-0.5">
									<span class="text-sm font-medium text-gray-900 dark:text-white">{KIND_LABEL[kind]}</span>
									<span class="text-[11px] text-gray-500 dark:text-gray-400">{kindCounts[kind]} {kindCounts[kind] === 1 ? KIND_SINGULAR[kind] : KIND_LABEL[kind].toLowerCase()}</span>
								</span>
								<span class="text-gray-300 group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" aria-hidden="true">›</span>
							</button>
						{/each}
					</div>
					<div class="mt-3 border-t border-gray-100 px-2 pb-1 pt-3 dark:border-gray-700/60">
						<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Or type to search across everything</span>
					</div>
				{:else if filtered.length === 0}
					<div class="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
						No matches for
						<span class="font-medium text-gray-700 dark:text-gray-300">"{query}"</span>
					</div>
				{:else}
					{#each grouped as group (group.kind)}
						<div class="flex items-center gap-2 px-3 pb-1 pt-2">
							<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{group.label}</span>
							<span class="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent dark:from-gray-700"></span>
							<span class="font-mono text-[10px] tabular-nums text-gray-300 dark:text-gray-600">{group.items.length}</span>
						</div>
						{#each group.items as item (item.result.key)}
							{@const r = item.result}
							{@const idx = item.idx}
							{@const isActive = idx === selectedIndex}
							{@const Icon = KIND_ICON[r.kind]}
							<button
								type="button"
								data-idx={idx}
								aria-current={r.isCurrent ? 'page' : undefined}
								title={r.isCurrent ? 'Currently open' : undefined}
								class="group relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-left transition-colors {isActive
									? 'bg-blue-50 dark:bg-blue-900/40'
									: 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}"
								onclick={() => pick(r)}
								onmouseenter={() => (selectedIndex = idx)}
							>
								{#if r.isCurrent}
									<span class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-blue-500 dark:bg-blue-400" aria-hidden="true"></span>
								{/if}
								<!-- Type icon -->
								<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-700/60 dark:text-gray-400">
									<Icon class="h-3.5 w-3.5" />
								</span>

								<!-- Title + subtitle column. For app rows, the subtitle line
								     becomes a per-env mini-strip: `[DEV ●] [STAGING ●] [PROD ●]`
								     where each chip is the env's theme badge with a colored
								     status dot. Gives a glance at app fleet health without
								     opening the app page. -->
								<div class="flex min-w-0 flex-1 flex-col">
									<div class="flex min-w-0 items-baseline gap-2">
										<span class="truncate text-sm font-medium {isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-900 dark:text-white'}">{r.title}</span>
										{#if r.version}
											<span class="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">{r.version}</span>
										{/if}
									</div>
									{#if r.kind === 'app' && r.envCells && r.envCells.length > 0}
										<!-- Per-env mini-strip — just the themed env badges,
										     no status dot inside (the inner dot was reading
										     as part of the badge chrome rather than a status
										     cue). Tooltip still surfaces the bake state. -->
										<div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
											{#each r.envCells as ec (ec.envName)}
												<span
													class="environment-theme-scope environment-theme-badge inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
													style={ec.theme ? getEnvironmentThemeStyle(ec.theme) : undefined}
													title={`${ec.envName} · ${ec.version ?? 'no deploy'} · ${ec.bakeStatus}`}
												>
													{shortEnvLabel(ec.theme) || ec.envName}
												</span>
											{/each}
										</div>
									{:else if r.subtitle}
										<span class="truncate text-xs text-gray-500 dark:text-gray-400">{r.subtitle}</span>
									{/if}
								</div>

								<!-- Right-side meta: env badge, stuck pill, status dot, time -->
								{#if r.stuck}
									<span class="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700/60">stuck</span>
								{/if}
								{#if r.statusColor}
									<span class="relative flex h-2 w-2 shrink-0 items-center justify-center" title={r.statusText}>
										{#if r.statusColor === 'yellow'}
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-60"></span>
										{/if}
										<span class="h-2 w-2 rounded-full {r.statusColor === 'green' ? 'bg-green-500' : r.statusColor === 'red' ? 'bg-red-500' : 'bg-yellow-500'}"></span>
									</span>
								{/if}
								{#if r.envTheme}
									<Badge
										color="gray"
										size="small"
										style={getEnvironmentThemeStyle(r.envTheme)}
										class="environment-theme-scope environment-theme-badge shrink-0 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
									>
										{shortEnvLabel(r.envTheme)}
									</Badge>
								{/if}
								{#if r.timestamp}
									<span class="hidden shrink-0 font-mono text-[10px] tabular-nums text-gray-400 dark:text-gray-500 sm:inline">{formatTimeAgoCompact(r.timestamp, $now)}</span>
								{/if}
							</button>
						{/each}
					{/each}
				{/if}
			</div>

			<div class="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
				<div class="hidden items-center gap-3 sm:flex">
					<span class="flex items-center gap-1">
						<kbd class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700">↑</kbd>
						<kbd class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700">↓</kbd>
						<span>navigate</span>
					</span>
					<span class="flex items-center gap-1">
						<kbd class="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] font-medium dark:border-gray-600 dark:bg-gray-700">↵</kbd>
						<span>open</span>
					</span>
				</div>
				<span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
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
