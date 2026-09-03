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
	import { Handle, Position, useViewport } from '@xyflow/svelte';
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
	 * ⭐ THE `Chip` COUNTER-SCALES AGAINST THE CANVAS'S OWN ZOOM. (Design
	 * sweep follow-up, 2026-09-03.) `GraphCanvasInner`'s resting fit rarely
	 * lands on exactly `1` — `fitView`'s padded fit to a measured frame
	 * computed **0.98** on the live `/dependencies` at 1440, **0.95** on the
	 * rollout Dependencies tab's `compact` graph — and every node (this
	 * component) renders INSIDE `.svelte-flow__viewport`, which the library
	 * scales by that exact number via a single ancestor `transform`. A `Chip`
	 * sized 20px everywhere else in the product (`app.css`'s `.chip`) was
	 * measuring **19px** here, and 16px measuring 14px on the compact graph —
	 * the one surface where the product's own fixed type scale was not fixed.
	 *
	 * `useViewport()` reads the SAME reactive `store.viewport` `GraphCanvasInner`
	 * already keeps as `liveZoom` — this component is rendered as a child of
	 * `<SvelteFlow>` (via the library's own `NodeWrapper`), so the context it
	 * needs is already in scope with no prop threading required. The inverse
	 * scale is applied to the `Chip` ONLY, not the whole node: the box, the
	 * name and the build id are DAGRE'S layout and are supposed to shrink and
	 * grow with the canvas the reader is panning and zooming — only the type
	 * atom the design system has already fixed a size for must not.
	 */
	const viewport = useViewport();
	const chipInvZoom = $derived(viewport.current.zoom > 0 ? 1 / viewport.current.zoom : 1);

	/**
	 * The environment axis is the one dagre RANKS along, so it follows the
	 * layout direction; the contract axis is the other one. Written by
	 * `GraphCanvasInner`; `LR` is the honest default before it has measured.
	 */
	const stacked = $derived(data.orientation === 'TB');
	const envIn = $derived(stacked ? Position.Top : Position.Left);
	const envOut = $derived(stacked ? Position.Bottom : Position.Right);
	/**
	 * ⭐ BOTH CONTRACT HANDLES ON THE RIGHT UNDER `singleFile` — see
	 * `DependencyNodeData.singleFile`'s own note. Every other case is
	 * unchanged: plain `TB` (not `singleFile` — `AppPromotionFlow` never
	 * sets it) keeps `Left`/`Right`, and `LR` keeps `Top`/`Bottom`.
	 */
	const contractIn = $derived(
		stacked ? (data.singleFile ? Position.Right : Position.Left) : Position.Top
	);
	const contractOut = $derived(stacked ? Position.Right : Position.Bottom);

	const HOLD_ICON = {
		clock: ClockOutline,
		person: UserOutline,
		check: ExclamationCircleOutline,
		upstream: ExclamationCircleOutline,
		unknown: QuestionCircleOutline
	} as const;

	/**
	 * ⭐ WRAP AT A TOKEN, NEVER THROUGH ONE. (2026-09-03, design pass 7,
	 * finding #14.) The stacked (`TB`, 92–132px) box wraps the name across
	 * two or more lines rather than truncating it — there is no ellipsis
	 * short enough to still tell `hello-frontend-app` and `hello-api-app`
	 * apart at this width. `break-words` (Tailwind's `overflow-wrap:
	 * break-word`) drew that wrap MID-WORD — `hello-fronte` / `nd-app` on
	 * the live graph. `.ident` (`app.css`) refuses that, so the only real
	 * break points left are the ones this function inserts: a `<wbr>` after
	 * each `-`, the same joint `FactList.handleParts` already wraps a k8s
	 * handle at.
	 */
	function identParts(name: string): string[] {
		return name.split(/(?<=-)/);
	}
</script>

<!--
	The handles are the anchor points the library routes edges to. They carry no
	interaction — nothing here is connectable — so they are invisible and inert,
	and the arrowhead is the only thing that lands on the border.

	The `id`s are what `DependencyNetwork` names on each edge and they are
	STABLE; the SIDES follow the canvas's layout direction, so under `LR` the
	environment axis is Left/Right and under `TB` it is Top/Bottom.

	⛔ THE LIBRARY'S OWN `Handle` HARD-CODES `role="button"`. (UX sweep finding
	5.) `tabindex="-1"` is already the library default, so Tab never lands on
	one — but `role="button"` survives regardless of tab order, and a screen
	reader's rotor/virtual-cursor navigation (element-by-role, not tab order)
	still discovers it: 4 fake buttons per node, 24 on a 6-node graph, none of
	which do anything (`nodesConnectable={false}` in `GraphCanvasInner`, so
	even a click on one is a no-op). `role`/`aria-hidden` are not destructured
	by the library's `Handle.svelte` — they fall into its `...rest` spread,
	which renders AFTER its own `role="button"`, so passing both here
	overrides the library's role rather than fighting it. `role="presentation"`
	strips the node from the accessibility tree entirely; `aria-hidden="true"`
	is the belt-and-braces second signal every other invisible/inert element
	in this product already carries. The four nodes' own `role="group"`
	wrapper (the library's `NodeWrapper`) is what Tab visits — these are never
	meant to be in that list.
-->
<Handle
	id="env-in"
	type="target"
	position={envIn}
	class="!pointer-events-none !opacity-0"
	role="presentation"
	aria-hidden="true"
/>
<Handle
	id="env-out"
	type="source"
	position={envOut}
	class="!pointer-events-none !opacity-0"
	role="presentation"
	aria-hidden="true"
/>
<Handle
	id="contract-in"
	type="target"
	position={contractIn}
	class="!pointer-events-none !opacity-0"
	role="presentation"
	aria-hidden="true"
/>
<Handle
	id="contract-out"
	type="source"
	position={contractOut}
	class="!pointer-events-none !opacity-0"
	role="presentation"
	aria-hidden="true"
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
		<span class="inline-block" style="transform-origin: left center; transform: scale({chipInvZoom})">
			<Chip role="env" label={data.envLabel} />
		</span>
		<span
			class="ident min-w-0 text-wrap text-[12px] leading-tight font-semibold text-gray-900 dark:text-white"
			>{#each identParts(data.name) as part, pi (pi)}{part}{#if pi < identParts(data.name).length - 1}<wbr
					/>{/if}{/each}</span
		>
	{:else}
		<span class="flex min-w-0 items-center gap-1.5">
			<!-- THE ENVIRONMENT IS ON THE NODE, NOT ONLY IN THE COLUMN. A column
			     header would be a fifth thing to keep aligned with dagre's output,
			     and it would vanish the moment one environment is filtered out. The
			     chip's hue is the product's env identity, so a column reads as one
			     colour without anything being drawn between the boxes. -->
			<span class="inline-block" style="transform-origin: left center; transform: scale({chipInvZoom})">
				<Chip role="env" label={data.envLabel} />
			</span>
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
		<!-- ⛔ F6 (2026-09-03, design pass 9 re-check): `truncate` CLIPPED THE
		     GATE'S OWN SENTENCE TO 94px OF 266 AT EVERY WIDTH FROM 390 TO
		     1024 — `Outside the Business Hours Only deploy window` is prose,
		     not an identifier, and this box has no ellipsis short enough to
		     keep it a claim anyone could act on. Height is free here (the
		     canvas scrolls, and `GraphCanvas`'s own note records that this
		     component's frame is height-derived, never height-constrained) —
		     the same trade the name above already makes with `identParts`.
		     `items-start`, not `items-center`: a two-line sentence beside a
		     14px icon needs the icon pinned to the FIRST line, not centred
		     across both. -->
		<span class="flex min-w-0 items-start gap-1.5">
			<Icon
				class="mt-px h-3.5 w-3.5 shrink-0 {hold.clears === 'person' || hold.clears === 'unknown'
					? 'text-red-500 dark:text-red-400'
					: 'text-gray-400 dark:text-gray-500'}"
			/>
			<span
				class="t-micro min-w-0 text-wrap {hold.clears === 'person' || hold.clears === 'unknown'
					? 'text-red-700 dark:text-red-400'
					: 'text-gray-500 dark:text-gray-400'}">{hold.short}</span
			>
		</span>
	{/each}
</svelte:element>
