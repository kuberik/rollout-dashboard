<svelte:options runes={true} />

<script lang="ts">
	let {
		n,
		label,
		tone = 'default',
		color,
		selected = false,
		disabled = false,
		href,
		onclick
	}: {
		n: number;
		label: string;
		tone?: 'default' | 'fail';
		// Optional small status dot — lets a filter-tile row (e.g. Rollouts list
		// quick filters) show "status circle + count + label" without every
		// caller needing to invent its own dot markup.
		color?: 'gray' | 'red' | 'blue' | 'green' | 'amber';
		// Toggle-button affordance for filter tiles: a selected tile gets the
		// same dark ring treatment the old bespoke filter chips used.
		selected?: boolean;
		disabled?: boolean;
		href?: string;
		onclick?: () => void;
	} = $props();

	const toneClass = $derived(
		tone === 'fail' ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'
	);

	const selectedClass = $derived(
		selected
			? 'border-gray-900 ring-1 ring-gray-900 dark:border-white dark:ring-white'
			: ''
	);

	const dotClass: Record<string, string> = {
		gray: 'bg-gray-400 dark:bg-gray-500',
		red: 'bg-red-500',
		blue: 'bg-blue-500',
		green: 'bg-green-500',
		amber: 'bg-amber-500'
	};

	const tileClass = $derived(
		`flex flex-col items-center gap-1 rounded-lg border bg-white px-4 py-3 text-center transition-colors hover:border-gray-300 dark:bg-gray-800 dark:hover:border-gray-600 disabled:pointer-events-none disabled:opacity-40 ${toneClass} ${selectedClass}`
	);

	// A tile is a genuine toggle only when it has a click handler. Plain summary
	// tiles (ControlCenter's fleet counts — no href, no onclick) must NOT announce
	// themselves as inactive toggle buttons, so aria-pressed is emitted only here.
	const isToggle = $derived(onclick != null);
</script>

{#if href}
	<a {href} class={tileClass}>
		{#if color}<span class="mb-0.5 h-2 w-2 shrink-0 rounded-full {dotClass[color]}"></span>{/if}
		<span class="font-montserrat text-3xl font-semibold text-gray-900 dark:text-gray-100">{n}</span>
		<span class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
			>{label}</span
		>
	</a>
{:else}
	<button type="button" {onclick} {disabled} aria-pressed={isToggle ? selected : undefined} class={tileClass}>
		{#if color}<span class="mb-0.5 h-2 w-2 shrink-0 rounded-full {dotClass[color]}"></span>{/if}
		<span class="font-montserrat text-3xl font-semibold text-gray-900 dark:text-gray-100">{n}</span>
		<span class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
			>{label}</span
		>
	</button>
{/if}
