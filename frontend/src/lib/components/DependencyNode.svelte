<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE ROLLOUT — a (service, environment) — on the dependency canvas.
	 *
	 * ── ⭐ FOUR HANDLES, AND THEY ARE THE LEGEND ────────────────────────────
	 *
	 * The human has rejected legends explicitly, so the two edge kinds are told
	 * apart by WHERE THEY LAND, using the difference that is already in the
	 * domain:
	 *
	 *   · a PROMOTION is *the same thing moving* — it runs along the
	 *     ENVIRONMENT axis, between two boxes printing the SAME service name,
	 *     and it is UNLABELLED. Whether the build id on the two ends matches is
	 *     then the whole state of the promotion, readable without any mark.
	 *   · a CONTRACT is *two different things agreeing* — it runs along the
	 *     SERVICE axis, inside ONE environment, between two boxes with
	 *     DIFFERENT names, and it carries the contract's name on it. A
	 *     promotion has no name to carry, because it is not an agreement.
	 *
	 * So: along-the-environment-axis + unlabelled + same name = promotion.
	 * Across-it + labelled + two names = contract. Nothing has to be looked up.
	 *
	 * ── ⭐ AND THAT PAIR OF AXES TRANSPOSES WITH THE LAYOUT ─────────────────
	 *
	 * `GraphCanvasInner` flips dagre from `LR` to `TB` on a narrow container —
	 * at 390 the environments run DOWN the page and the services ACROSS it,
	 * which is the transpose of the desktop reading and the only arrangement in
	 * which the axis that grows with the fleet (services) is the one that does
	 * not fight the page's own scroll.
	 *
	 * ⛔ THE HANDLE IDS DO NOT CHANGE, ONLY THEIR SIDES. `DependencyNetwork`
	 * names `env-*` on a promotion and `contract-*` on a contract and never has
	 * to know which way the canvas is pointing; a fixed Left/Right on the
	 * environment axis under `TB` would route every promotion as a hook out of
	 * the right of one box and into the left of the box directly below it.
	 *
	 * The DISCRIMINATOR survives the flip because it was never "horizontal":
	 * it is *same name + no label* against *two names + a label*, and neither
	 * of those is a direction.
	 *
	 * ⛔ THE BOX SIZES ITSELF. Svelte Flow measures the rendered node and hands
	 * dagre the real number, so no width is ever estimated from a character
	 * count — the defect that truncated `hello-frontend-app`, the exact name
	 * the widening existed for.
	 *
	 * ⛔ ALMOST NOTHING SPENDS COLOUR. Red is for a rollout held by something
	 * that does NOT clear itself — `blockingStory`'s own `!selfClearing`. A
	 * rollout waiting only on a deploy window is NOT red: amber means `stuck`
	 * and nothing else, and a clock that reopens at 1pm is neither. It carries
	 * a clock glyph and says when.
	 *
	 * ── ⭐ 2026-09-03 · THE BOX ITSELF SHRINKS UNDER `TB`, AND THAT IS WHAT
	 * MAKES ONE COMPONENT WORK AT 390 ─────────────────────────────────────
	 *
	 * The desktop box lays `[env chip][icon] name` on one row because a 1182px
	 * canvas has the width to spare. At 390 it does not: two of these boxes
	 * side by side (a held contract pair, which is the exact case the reader
	 * came to see) need more width than a phone card has at any zoom this
	 * product accepts as legible (`GraphCanvasInner`'s `NARROW` floor, 0.85).
	 * Shrinking the ROW does not fit; shrinking the BOX does — the chip moves
	 * to its own line, the status icon (redundant with the red border/fill
	 * already on a blocked box) is dropped, and the name WRAPS instead of
	 * truncating, because at this width there is no ellipsis short enough to
	 * still say `hello-frontend-app` and `hello-api-app` apart. Height is free
	 * here — the page scrolls — so trading a wider box for a taller one is the
	 * whole trade.
	 */
	import { Handle, Position } from '@xyflow/svelte';
	import {
		ServerSolid,
		QuestionCircleOutline,
		ClockOutline,
		UserOutline,
		ExclamationCircleOutline
	} from 'flowbite-svelte-icons';
	import Chip from '$lib/components/Chip.svelte';
	import type { DependencyNodeData } from '$lib/components/dependency-node-data';

	let { data }: { data: DependencyNodeData } = $props();

	const linked = $derived(Boolean(data.href) && !data.unresolved);

	/**
	 * The environment axis is the one dagre RANKS along, so it follows the
	 * layout direction; the contract axis is the other one. Written by
	 * `GraphCanvasInner`; `LR` is the honest default before it has measured.
	 */
	const stacked = $derived(data.orientation === 'TB');
	const envIn = $derived(stacked ? Position.Top : Position.Left);
	const envOut = $derived(stacked ? Position.Bottom : Position.Right);
	const contractIn = $derived(stacked ? Position.Left : Position.Top);
	const contractOut = $derived(stacked ? Position.Right : Position.Bottom);

	const HOLD_ICON = {
		clock: ClockOutline,
		person: UserOutline,
		check: ExclamationCircleOutline,
		upstream: ExclamationCircleOutline,
		unknown: QuestionCircleOutline
	} as const;
</script>

<!--
	The handles are the anchor points the library routes edges to. They carry no
	interaction — nothing here is connectable — so they are invisible and inert,
	and the arrowhead is the only thing that lands on the border.

	The `id`s are what `DependencyNetwork` names on each edge and they are
	STABLE; the SIDES follow the canvas's layout direction, so under `LR` the
	environment axis is Left/Right and under `TB` it is Top/Bottom.
-->
<Handle id="env-in" type="target" position={envIn} class="!pointer-events-none !opacity-0" />
<Handle id="env-out" type="source" position={envOut} class="!pointer-events-none !opacity-0" />
<Handle
	id="contract-in"
	type="target"
	position={contractIn}
	class="!pointer-events-none !opacity-0"
/>
<Handle
	id="contract-out"
	type="source"
	position={contractOut}
	class="!pointer-events-none !opacity-0"
/>

<svelte:element
	this={linked ? 'a' : 'div'}
	href={linked ? data.href : undefined}
	title={data.title}
	class="environment-theme-scope flex w-max flex-col rounded-lg border transition-colors
		{stacked ? 'min-w-[92px] max-w-[132px] gap-0.5 px-2 py-1.5' : 'min-w-[176px] max-w-[280px] gap-1 px-2.5 py-2'}
		{data.blocked
		? 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40'
		: data.unresolved
			? 'border-dashed border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50'
			: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}
		{linked ? 'cursor-pointer hover:border-gray-400 dark:hover:border-gray-500' : ''}
		{data.focused ? 'ring-2 ring-gray-900/70 dark:ring-white/70' : ''}"
	style={data.themeStyle ?? undefined}
>
	{#if stacked}
		<!-- ⭐ CHIP ON ITS OWN LINE, ICON DROPPED. Neither competes with the
		     name for the one axis this box is short of. The icon said
		     nothing the border/fill colour does not already say. -->
		<Chip role="env" label={data.envLabel} />
		<span
			class="min-w-0 text-wrap break-words text-[12px] leading-tight font-semibold text-gray-900 dark:text-white"
			>{data.name}</span
		>
	{:else}
		<span class="flex min-w-0 items-center gap-1.5">
			<!-- THE ENVIRONMENT IS ON THE NODE, NOT ONLY IN THE COLUMN. A column
			     header would be a fifth thing to keep aligned with dagre's output,
			     and it would vanish the moment one environment is filtered out. The
			     chip's hue is the product's env identity, so a column reads as one
			     colour without anything being drawn between the boxes. -->
			<Chip role="env" label={data.envLabel} />
			{#if data.unresolved}
				<QuestionCircleOutline class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
			{:else}
				<ServerSolid
					class="h-3.5 w-3.5 shrink-0 {data.blocked
						? 'text-red-600 dark:text-red-400'
						: 'text-gray-400 dark:text-gray-500'}"
				/>
			{/if}
			<span class="min-w-0 truncate text-[13px] font-semibold text-gray-900 dark:text-white"
				>{data.name}</span
			>
		</span>
	{/if}

	<!--
		THE BUILD IS THE SECOND LINE, AND IT IS WHAT MAKES A PROMOTION EDGE
		READABLE. Two boxes on one row carrying the same build id have promoted;
		two carrying different ones have not. That is the state of the edge
		between them, printed on its ends, spending no colour at all.
	-->
	<span class="flex min-w-0 items-center gap-1.5">
		{#if data.unresolved}
			<span class="t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
				>not in this dashboard</span
			>
		{:else if data.build}
			<span class="t-code-sm min-w-0 truncate text-gray-600 dark:text-gray-300">{data.build}</span>
		{:else}
			<span class="t-micro min-w-0 truncate text-gray-500 dark:text-gray-400">never deployed</span>
		{/if}
	</span>

	<!--
		⭐ A GATE WITH NO FAR END LIVES HERE, NOT AS A PHANTOM NODE. A schedule
		holds a rollout and there is no second rollout anywhere in it, so it is a
		property of this box. One line per hold, each with the glyph its `clears`
		kind earns — a clock is not a person and must never look like one.
	-->
	{#each data.holds as hold (hold.gate + hold.short)}
		{@const Icon = HOLD_ICON[hold.clears] ?? QuestionCircleOutline}
		<span class="flex min-w-0 items-center gap-1.5">
			<Icon
				class="h-3.5 w-3.5 shrink-0 {hold.clears === 'person' || hold.clears === 'unknown'
					? 'text-red-500 dark:text-red-400'
					: 'text-gray-400 dark:text-gray-500'}"
			/>
			<span
				class="t-micro min-w-0 truncate {hold.clears === 'person' || hold.clears === 'unknown'
					? 'text-red-700 dark:text-red-400'
					: 'text-gray-500 dark:text-gray-400'}">{hold.short}</span
			>
		</span>
	{/each}
</svelte:element>
