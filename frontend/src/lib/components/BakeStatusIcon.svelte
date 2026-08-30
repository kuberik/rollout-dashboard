<svelte:options runes={true} />

<script lang="ts">
	import StatusSpinner from './StatusSpinner.svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		PauseSolid,
		CircleMinusSolid,
		RefreshOutline
	} from 'flowbite-svelte-icons';
	import { getBakeStatusColor } from '$lib/bake-status';

	interface Props {
		bakeStatus?: string;
		size?: 'small' | 'medium' | 'large';
		class?: string;
	}

	let { bakeStatus, size = 'medium', class: className = '' }: Props = $props();

	// All icons (static and spinning) share the same h-_ w-_ footprint
	// at each size, so running rows on the activity rail don't read
	// bigger than settled ones. `small` is `h-4 w-4` (16px) which is
	// the smallest Flowbite `Spinner` accepts.
	const sizeClasses = {
		small: 'h-4 w-4',
		medium: 'h-6 w-6',
		large: 'h-8 w-8'
	};

	const spinnerSizes: Record<'small' | 'medium' | 'large', '4' | '6' | '8'> = {
		small: '4',
		medium: '6',
		large: '8'
	};

	// Literal class map, not a `text-${family}-600` template. Two reasons:
	// Tailwind cannot see an interpolated class name (these only ever got
	// generated because the same strings happened to appear elsewhere in
	// the source), and the status ink is a design token that should be
	// greppable. -700 rather than -600: it is the shade that clears 4.5:1
	// on white, and there is exactly ONE green in the product — this one —
	// which the `newest` rank chip also uses. Pending/None recedes to gray.
	// `yellow` is spent TWICE: by the static glyph below and — since the
	// contrast fix — by the InProgress bake mark's `currentColor`, so the
	// running bake and the settled bake print the same yellow.
	const TONE: Record<string, string> = {
		green: 'text-green-700 dark:text-green-400',
		red: 'text-red-700 dark:text-red-400',
		yellow: 'text-yellow-700 dark:text-yellow-400',
		blue: 'text-blue-700 dark:text-blue-400',
		gray: 'text-gray-500 dark:text-gray-400'
	};

	function getStatusConfig(status?: string) {
		const baseColor = getBakeStatusColor(status);
		const color = TONE[baseColor] ?? TONE.gray;

		switch (status) {
			case 'Succeeded':
				return { icon: CheckCircleSolid, color };
			case 'Failed':
				return { icon: ExclamationCircleSolid, color };
			case 'InProgress':
				return { icon: ClockSolid, color };
			case 'Deploying':
				return { icon: RefreshOutline, color };
			case 'Cancelled':
				return { icon: CircleMinusSolid, color };
			case 'None':
				return { icon: PauseSolid, color };
			default:
				return { icon: ClockSolid, color };
		}
	}

	const statusInfo = $derived(getStatusConfig(bakeStatus));
	const Icon = $derived(statusInfo.icon);
</script>

<!-- In-flight states: Deploying is an actively-running deploy → rotating
     border spinner. InProgress is the bake window — the rollout is just
     watching health checks — → concentric dots radiating out, which reads
     as "passive watch" rather than "actively transferring".

     ⛔ THIS IS NOT `<Spinner type="pulse" color="yellow">` ANY MORE, AND IT
     MUST NOT GO BACK. Flowbite's pulse spinner is three circles that ALL
     animate `opacity: 0.9 → 0` while expanding, painted `fill-yellow-400`,
     with `animate-pulse` (a second 1 → 0.5 opacity fade) stacked on the
     `<svg>` on top of that. It therefore has NO mark that is present at
     rest, and its brightest instant measured **1.05–1.41:1 in light** on
     the `bg-yellow-100` status disc — the icon a reader looks at to know
     something is baking right now was effectively invisible on `/`,
     `/rollouts`, rollout detail, `/apps` and `/envs`. The 2026-08-30
     contrast sweep never caught it because no rollout was mid-bake on the
     live cluster while it ran.

     Two things fix it and both are free:
     · a SOLID CORE at full opacity, so the mark can never fall below its
       floor mid-cycle — this is exactly why the blue `Deploying` spinner
       passed (its `border-t` arc is opaque) and this one did not;
     · the LIGHT ink steps `yellow-400` → `yellow-700`, which is `TONE.yellow`,
       the ink this component's own static yellow glyph already prints. Zero
       new colour values, and baking stays YELLOW — it does not drift toward
       amber or toward the blue that `Deploying` owns.
     The radiating waves keep Flowbite's original geometry and rhythm
     (r 18→46, 1.5s, three waves 0.5s apart) so the motion is unchanged. -->
{#if bakeStatus === 'InProgress'}
	<svg
		class="{sizeClasses[size]} shrink-0 {TONE.yellow} {className}"
		viewBox="0 0 100 100"
		aria-hidden="true"
	>
		{#each [0, 0.5, 1] as begin (begin)}
			<circle cx="50" cy="50" r="18" fill="currentColor" opacity="0">
				<animate
					attributeName="r"
					values="18;46"
					begin="{begin}s"
					dur="1.5s"
					repeatCount="indefinite"
				/>
				<animate
					attributeName="opacity"
					values="0.5;0"
					begin="{begin}s"
					dur="1.5s"
					repeatCount="indefinite"
				/>
			</circle>
		{/each}
		<circle cx="50" cy="50" r="18" fill="currentColor" />
	</svg>
{:else if bakeStatus === 'Deploying'}
	<StatusSpinner color="blue" size={spinnerSizes[size]} class={className} />
{:else}
	<Icon class="{sizeClasses[size]} {statusInfo.color} {className}" />
{/if}
