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
		QuestionCircleOutline,
		ClockOutline,
		UserOutline,
		ExclamationCircleOutline
	} from 'flowbite-svelte-icons';
	import Chip from '$lib/components/Chip.svelte';
	import RestGlyph from '$lib/components/RestGlyph.svelte';
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
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
	 * ⭐ D-20b — `zoom`, NOT `transform: scale`. A `transform` never changes
	 * the box it is applied to — `getBoundingClientRect` (what Svelte Flow
	 * measures a node by, and what dagre then packs the row around) still
	 * reports the chip's UNSCALED size, so at `chipInvZoom > 1` (every zoom
	 * under 1, which `restingFit` rests on whenever a fleet does not fit at
	 * zoom 1) the chip painted LARGER than the room `DependencyNode`'s own
	 * flex row ever reserved for it — measured live, `prod-af-south-1`
	 * overprinting `checkout-api` on the name right beside it. The CSS
	 * `zoom` property (unlike `transform`) DOES resize the box in layout —
	 * the element's own content and its reported dimensions both scale, so
	 * the flex row the chip sits in grows to fit it and the sibling name
	 * is pushed clear instead of painted over. Supported by every engine
	 * this product ships to (Chromium always; Firefox 126+, Safari 17+ —
	 * both well under this project's own baseline).
	 */
	const chipLayoutStyle = $derived(`zoom: ${chipInvZoom};`);

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
		unknown: QuestionCircleOutline,
		/**
		 * ⭐ THE SAME MARK `unknown` USES, AND FOR THE SAME REASON.
		 * (2026-09-04, load-state audit finding 4) `BlockingStoryPanel`'s own
		 * `iconForKind` and `GateRecord`'s `gateMark` both give a `pending`
		 * gate the question mark, never the kind it might turn out NOT to be
		 * — `unknown` means "we asked every source and none can attribute
		 * this," `pending` means "we have not asked yet," and neither is a
		 * claim about the gate's actual kind. A hold whose `clears` still
		 * reads `check` while `pending` is true must NOT get `check`'s
		 * shield glyph here — see the `{#each}` below, which reads
		 * `hold.pending` before `hold.clears`.
		 */
		pending: QuestionCircleOutline
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

<!--
	⭐ D-20b ROUND 2 — STACKED `max-w` 132 → 168px. Measured live at 360px
	(the measurement script's own `node-text-overflow` check): a `wide` env
	chip (`prod-ap-southeast-2`, this fixture's longest, 20 chars) rendered
	at 143-154px, past the 132px box — `.chip.chip-wide` only lifts the
	TEXT cap (`max-width: none`), it never adds wrap (`white-space: nowrap`
	stays, inherited from `.chip`), so a chip that cannot fit simply
	overflows its box rather than clipping or wrapping. `wide` exists
	specifically so two differently-suffixed region names never read as
	the same chip (`prod-us-east-1`/`-2`) — reverting to the 12ch
	truncation this box used before `wide` would reintroduce that exact
	defect. 168px is the measured worst case (154px) plus a safety margin,
	not a round number designed around; `min-w-[92px]` and the LR branch's
	own 280/176px are untouched.
-->
<svelte:element
	this={linked ? 'a' : 'div'}
	href={linked ? data.href : undefined}
	title={data.title}
	class="environment-theme-scope flex w-max flex-col rounded-md border transition-[border-color,background-color]
		focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]
		{stacked
		? 'max-w-[168px] min-w-[92px] gap-0.5 px-2 py-1.5'
		: 'max-w-[280px] min-w-[176px] gap-1 px-2.5 py-2'}
		{data.blocked
		? 'border-held-line bg-surface'
		: data.unresolved
			? 'border-dashed border-line-strong bg-surface'
			: 'border-line bg-surface'}
		{linked ? 'cursor-pointer hover:border-line-strong' : ''}
		{data.focused ? 'ring-2 ring-fg/70' : ''}"
	style={data.themeStyle ?? undefined}
>
	{#if stacked}
		<!-- ⭐ CHIP ON ITS OWN LINE, ICON DROPPED. Neither competes with the
		     name for the one axis this box is short of. The icon said
		     nothing the border/fill colour does not already say. -->
		<!--
			⛔ AN ENV CHIP ONLY WHEN THERE IS AN ENVIRONMENT. (2026-09-18.)
			This was an unconditional `Chip role="env"` — the one such call site in
			the product without the no-theme fallback every other one has. The
			dependencies page next door already writes the rule out: a resolved
			theme gets the chip, anything else gets plain `t-code-sm` text.
		
			It matters because `envLabel` is not always an environment.
			`dependency-graph.ts`'s `envOfNs` falls back to the NAMESPACE when no
			Environment maps it, so on a fleet whose namespaces are not named after
			tiers — `flux-deployments` here — the graph printed a namespace inside
			an environment chip. And this chip passes no `theme` prop: it inherits
			the node's `--rollout-theme-*` vars, so when the node has no theme the
			vars are unset and the chip renders as a bare bordered box. With an
			empty label that is the reported artifact exactly — a bordered box with
			nothing in it.
		
			`themeStyle` is already `null` for precisely "no environment resolved",
			so it is the condition — no new field, and it cannot drift from the vars
			the chip actually depends on.
		-->
		{#if data.themeStyle}
			<span class="inline-block" style={chipLayoutStyle}>
				<Chip role="env" label={data.envLabel} wide />
			</span>
		{:else if data.envLabel}
			<!-- SANS, NOT MONO (round 2 review) — an environment/namespace
			     label is a NAME, same as the Chip branch above draws it in
			     `t-ui-sm` sans; this is the identical fact with no theme to
			     colour it, not a different kind of value. `t-meta`, not
			     `t-code-sm`: one drawing for "the place", on or off a
			     resolved theme. -->
			<span class="t-meta block text-fg-subtle" title={data.envLabel}
				>{data.envLabel}</span
			>
		{/if}
		<span
			class="ident t-card-title min-w-0 leading-tight text-wrap text-fg"
			>{#each identParts(data.name) as part, pi (pi)}{part}{#if pi < identParts(data.name).length - 1}<wbr
					/>{/if}{/each}</span
		>
	{:else}
		<span class="flex min-w-0 items-center gap-1.5">
			<!-- ⭐ `wide` — THE CHIP IS THE IDENTIFIER HERE, AND THE BOX MEASURES
			     ITSELF. (2026-09-13, eighth film review: `PLATFOR…` and
			     `PROD-US…` on the two nodes of the demo's own graph.) `.chip`'s
			     12ch cap resolves to 72.25px, i.e. 8.5 characters, so
			     `platform-prod` (13) and `prod-us-east-2` (14) both died in an
			     ellipsis — and `Chip`'s own note names this exact failure as the
			     one `wide` exists for: "`prod-us-east-1`, `prod-us-east-2` and
			     `prod-us-west-1` all render as the same eight characters". The
			     cap is right where a chip shares a fixed track with other
			     content; this node has no track to share — it hands dagre its
			     OWN measured width (see this file's header), so an uncapped chip
			     makes the BOX wider and clips nothing. -->
			<!-- THE ENVIRONMENT IS ON THE NODE, NOT ONLY IN THE COLUMN. A column
			     header would be a fifth thing to keep aligned with dagre's output,
			     and it would vanish the moment one environment is filtered out. The
			     chip's hue is the product's env identity, so a column reads as one
			     colour without anything being drawn between the boxes. -->
			{#if data.themeStyle}
				<span class="inline-block" style={chipLayoutStyle}>
					<Chip role="env" label={data.envLabel} wide />
				</span>
			{:else if data.envLabel}
				<!-- SANS, NOT MONO — see the identical note on the `stacked`
				     branch above. -->
				<span class="t-meta shrink-0 truncate text-fg-subtle" title={data.envLabel}
					>{data.envLabel}</span
				>
			{/if}
			{#if data.unresolved}
				<QuestionCircleOutline class="h-3 w-3 shrink-0 text-fg-disabled" />
			{:else}
				<!-- ⭐ D-20b (design review, per design-rollout) — `RestGlyph`,
				     NOT a bare `ServerSolid` recoloured by hand. A held
				     node's status mark must be the product's ONE held mark
				     (`HeldGlyph`, the outline gate, `text-held`), never a
				     different glyph tinted to match; a healthy one rests as
				     the quiet 6px dot `RestGlyph` already draws for exactly
				     this "nothing to report" case elsewhere (Home's
				     Trailing/Steady rows). `RestGlyph` picks between the two
				     the same way those rows do — `state: 'held'` routes
				     through `BakeStatusIcon` to `HeldGlyph` itself, `null`
				     with `bakeStatus: 'Succeeded'` and no `timestamp` rests
				     at the dot — so this node never draws its own copy of
				     either glyph's shape. -->
				<RestGlyph
					bakeStatus="Succeeded"
					state={data.blocked ? 'held' : null}
					class="h-3 w-3 shrink-0 {data.blocked ? 'text-held' : 'text-fg-disabled'}"
				/>
			{/if}
			<!-- ⛔ 2026-10-09 · D-20 round 5 — REVERSED FOR THIS (non-`stacked`,
			     `LR`) BRANCH ONLY: THE NAME NO LONGER WRAPS, IT TRUNCATES WITH
			     A `title`.
			     The 2026-09-20 reasoning this replaces (wrap because no
			     ellipsis is short enough to tell two names apart) held for a
			     hand-laid-out, two-or-three-node canvas where a taller box cost
			     nothing. It stopped holding once `GraphCanvasInner` started
			     PACKING many components onto one canvas (D-20 round 4): a
			     wrapped name changes the node's own MEASURED height, which
			     dagre then bakes into that component's rank spacing — the
			     reported defect, `PROD-AP-SOUTHEAST-2`'s `checkout-api`
			     wrapping to `checkout-` / `api`, is exactly a long name
			     fighting the fixed-width column every other row in its stacked
			     rank already committed to. Truncating keeps every row in a
			     column the SAME height, which packing (and the gutter router
			     reading each component's own height) depends on; the full name
			     is one hover away via `title`, same mechanism `envLabel`
			     already uses two attributes up. `stacked` (the phone/`TB`
			     card) is UNCHANGED — a single column has no row-height
			     neighbours to disagree with, so the 2026-09-20 trade (taller
			     box, not a shorter name) still holds exactly as written there. -->
			<span
				class="ident t-card-title min-w-0 truncate leading-tight whitespace-nowrap text-fg"
				title={data.name}>{data.name}</span
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
			<!-- Wraps rather than truncating: `not in this dashbo…` is the
			     ellipsis saying nothing the full phrase does not, on the one
			     node whose whole message IS that phrase. -->
			<span class="t-meta min-w-0 text-wrap text-fg-subtle"
				>not in this dashboard</span
			>
		{:else if data.build}
			<!-- `text-fg-muted`, not `-subtle` (round 2 review): measured
			     4.22:1/4.43:1 on the old held-tint fill — under 4.5:1. The
			     fill is gone (#10, surface for every node now), but the
			     build id is still the row's one machine value worth a
			     slightly stronger ink than the chrome around it. -->
			<span class="t-code-sm min-w-0 truncate text-fg-muted">{data.build}</span>
		{:else}
			<span class="t-meta min-w-0 text-wrap text-fg-subtle">never deployed</span>
		{/if}
	</span>

	<!--
		⭐ A GATE WITH NO FAR END LIVES HERE, NOT AS A PHANTOM NODE. A schedule
		holds a rollout and there is no second rollout anywhere in it, so it is a
		property of this box. One line per hold, each with the glyph its `clears`
		kind earns — a clock is not a person and must never look like one.
	-->
	{#each data.holds as hold (hold.gate + hold.short)}
		{@const Icon = hold.pending
			? HOLD_ICON.pending
			: (HOLD_ICON[hold.clears] ?? QuestionCircleOutline)}
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
				class="mt-px h-3 w-3 shrink-0 {!hold.pending &&
				(hold.clears === 'person' || hold.clears === 'unknown')
					? 'text-held'
					: 'text-fg-disabled'}"
			/>
			{#if hold.pending}
				<!-- ⭐ LINES RESERVED FOR THE WORST REALISTIC SENTENCE, NOT
				     `short`. (2026-09-04, load-state audit finding 4: +14px
				     on `/dependencies`, +24px on the compact rollout-tab
				     graph.) `short` here is the `check` fallback's claim
				     ("A check is not passing") — ONE line — printed before
				     `/schedules` has been consulted. Once it answers, this
				     hold very often turns out to be a `clock` gate whose
				     real sentence ("Outside the Business Hours Only deploy
				     window", 46 characters) wraps — that extra height is
				     exactly the growth the audit measured.
				     ⭐ THE LINE COUNT IS NOT ONE NUMBER: it depends on the
				     BOX, and the box's own width halves under `stacked`
				     (92-132px vs 176-280px — see this component's own note
				     up top on why the box shrinks under `TB`). Measured
				     live with that exact sentence: 2 lines at the
				     unstacked width, 4 at the stacked one. Reserving the
				     SAME two lines at both would have traded the audit's
				     +14/+24px growth for a new +30px growth at 390 — this
				     reserves per orientation instead, at `t-micro`'s own
				     line height (15.4px), so the flip to the real sentence
				     moves nothing at either width. -->
				<SkeletonBar
					width="w-full"
					height={stacked ? 'h-[62px]' : 'h-[28px]'}
					class="min-w-0 flex-1"
				/>
			{:else}
				<span
					class="t-meta min-w-0 text-wrap {hold.clears === 'person' || hold.clears === 'unknown'
						? 'text-held'
						: 'text-fg-subtle'}">{hold.short}</span
				>
			{/if}
		</span>
	{/each}

	<!--
		⭐ D-20b ROUND 2 (coordinator decision) — THE HELD CONSTRAINT, READ
		HERE, NOT ON THE EDGE. An edge used to carry this as text; placing
		N of them on a dense canvas never reached zero collisions, however
		good the placement algorithm got. The fact itself has not moved —
		this box IS the consumer the constraint is about — so it reads
		here instead, one quiet line per blocked contract, same row shape
		`holds` (just above) already uses for a gate with no second
		rollout. `text-held` sits ONLY on the version that is actually
		short, never the whole sentence: the contract's name and which
		version IS served are facts, not the complaint.
	-->
	{#each data.heldConstraints as hc (hc.contract + (hc.requiredVersion ?? '') + (hc.providedVersion ?? ''))}
		<span class="flex min-w-0 items-start gap-1.5">
			<ExclamationCircleOutline class="mt-px h-3 w-3 shrink-0 text-held" />
			<span class="t-meta min-w-0 text-wrap text-fg-subtle"
				>Needs {hc.contract}{#if hc.requiredVersion}{' '}<span class="text-held"
						>{hc.requiredVersion}</span
					>{/if}{#if hc.providedVersion}{' '}· has {hc.providedVersion}{:else}{' '}· not served here{/if}</span
			>
		</span>
	{/each}
</svelte:element>
