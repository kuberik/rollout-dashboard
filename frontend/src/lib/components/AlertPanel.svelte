<svelte:options runes={true} />

<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import {
		ExclamationCircleSolid,
		InfoCircleSolid,
		PauseSolid,
		HeartSolid
	} from 'flowbite-svelte-icons';

	type Severity = 'error' | 'warning' | 'info' | 'pinned';

	interface Props {
		severity?: Severity;
		title: string;
		message?: string;
		footnote?: string;
		quoted?: boolean;
		icon?: Component;
		pulse?: boolean;
		actions?: Snippet;
		extra?: Snippet;
	}

	let {
		severity = 'info',
		title,
		message,
		footnote,
		quoted = false,
		icon,
		pulse = false,
		actions,
		extra
	}: Props = $props();

	const palette = $derived.by(() => {
		switch (severity) {
			case 'error':
				return {
					container:
						'bg-gradient-to-r from-red-100 via-red-50 to-red-100 shadow-2xl shadow-red-200/60 ring-1 ring-red-300/60 dark:from-red-950 dark:via-red-900 dark:to-red-950 dark:shadow-red-950/50 dark:ring-red-800/60',
					glowA: 'bg-red-400/8 dark:bg-red-500/10',
					glowB: 'bg-red-300/10 dark:bg-red-400/8',
					ping: 'bg-red-500/30 dark:bg-red-500/40',
					iconWrap:
						'bg-red-200 ring-2 ring-red-400/60 dark:bg-red-500/20 dark:ring-red-500/50',
					iconColor: 'text-red-600 dark:text-red-300',
					title: 'text-red-900 dark:text-white',
					message: 'text-red-700/75 dark:text-red-200/75',
					footnote: 'text-red-700/60 dark:text-red-200/55',
					quoteBorder: 'border-red-400/60 dark:border-red-500/40',
					defaultIcon: ExclamationCircleSolid
				};
			case 'warning':
				return {
					container:
						'bg-gradient-to-r from-amber-100 via-amber-50 to-amber-100 shadow-2xl shadow-amber-200/60 ring-1 ring-amber-300/60 dark:from-amber-950 dark:via-amber-900 dark:to-amber-950 dark:shadow-amber-950/50 dark:ring-amber-800/60',
					glowA: 'bg-amber-400/8 dark:bg-amber-500/10',
					glowB: 'bg-amber-300/10 dark:bg-amber-400/8',
					ping: 'bg-amber-500/25 dark:bg-amber-500/30',
					iconWrap:
						'bg-amber-200 ring-2 ring-amber-400/60 dark:bg-amber-500/20 dark:ring-amber-500/50',
					iconColor: 'text-amber-600 dark:text-amber-300',
					title: 'text-amber-900 dark:text-white',
					message: 'text-amber-700/80 dark:text-amber-200/75',
					footnote: 'text-amber-700/60 dark:text-amber-200/55',
					quoteBorder: 'border-amber-400/60 dark:border-amber-500/40',
					defaultIcon: ExclamationCircleSolid
				};
			case 'pinned':
				return {
					container:
						'bg-gradient-to-r from-orange-100 via-orange-50 to-orange-100 shadow-2xl shadow-orange-200/60 ring-1 ring-orange-300/60 dark:from-orange-950 dark:via-orange-900 dark:to-orange-950 dark:shadow-orange-950/50 dark:ring-orange-800/60',
					glowA: 'bg-orange-400/8 dark:bg-orange-500/10',
					glowB: 'bg-orange-300/10 dark:bg-orange-400/8',
					ping: 'bg-orange-500/25 dark:bg-orange-500/30',
					iconWrap:
						'bg-orange-200 ring-2 ring-orange-400/60 dark:bg-orange-500/20 dark:ring-orange-500/50',
					iconColor: 'text-orange-600 dark:text-orange-300',
					title: 'text-orange-900 dark:text-white',
					message: 'text-orange-700/80 dark:text-orange-200/75',
					footnote: 'text-orange-700/60 dark:text-orange-200/55',
					quoteBorder: 'border-orange-400/60 dark:border-orange-500/40',
					defaultIcon: PauseSolid
				};
			case 'info':
			default:
				return {
					container:
						'bg-gradient-to-r from-blue-100 via-blue-50 to-blue-100 shadow-2xl shadow-blue-200/60 ring-1 ring-blue-300/60 dark:from-blue-950 dark:via-blue-900 dark:to-blue-950 dark:shadow-blue-950/50 dark:ring-blue-800/60',
					glowA: 'bg-blue-400/8 dark:bg-blue-500/10',
					glowB: 'bg-blue-300/10 dark:bg-blue-400/8',
					ping: 'bg-blue-500/25 dark:bg-blue-500/30',
					iconWrap:
						'bg-blue-200 ring-2 ring-blue-400/60 dark:bg-blue-500/20 dark:ring-blue-500/50',
					iconColor: 'text-blue-600 dark:text-blue-300',
					title: 'text-blue-900 dark:text-white',
					message: 'text-blue-700/80 dark:text-blue-200/75',
					footnote: 'text-blue-700/60 dark:text-blue-200/55',
					quoteBorder: 'border-blue-400/60 dark:border-blue-500/40',
					defaultIcon: InfoCircleSolid
				};
		}
	});

	const Icon = $derived(icon ?? palette.defaultIcon);
</script>

<div class="mb-4">
	<div class="relative overflow-hidden rounded-xl {palette.container}">
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			<div class="absolute -right-10 -top-10 h-48 w-48 rounded-full {palette.glowA} blur-3xl"></div>
			<div class="absolute -bottom-6 left-1/4 h-32 w-32 rounded-full {palette.glowB} blur-2xl"></div>
		</div>

		<div class="relative flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:gap-x-8 sm:px-6 sm:py-5">
			<div class="flex min-w-0 flex-1 items-center gap-4">
				<div class="relative shrink-0">
					{#if pulse}
						<div class="absolute inset-0 animate-ping rounded-full {palette.ping}"></div>
					{/if}
					<div class="relative flex h-10 w-10 items-center justify-center rounded-full {palette.iconWrap}">
						<Icon class="h-6 w-6 {palette.iconColor}" />
					</div>
				</div>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<p class="text-base font-bold tracking-tight {palette.title}">{title}</p>
						{#if extra}{@render extra()}{/if}
					</div>
					{#if message}
						{#if quoted}
							<blockquote class="mt-1.5 border-l-2 pl-3 italic break-words text-sm {palette.message} {palette.quoteBorder}">
								{message}
							</blockquote>
						{:else}
							<p class="mt-0.5 break-words text-sm {palette.message}">{message}</p>
						{/if}
					{/if}
					{#if footnote}
						<p class="mt-1 break-words text-xs {palette.footnote}">{footnote}</p>
					{/if}
				</div>
			</div>

			{#if actions}
				<div class="flex items-center gap-3 sm:shrink-0">
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
</div>
