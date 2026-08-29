<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE STAGE CHAIN — Direction B's state half, object 1.
	 *
	 * A vertical list of NODES joined by HOPS. It is deliberately not a table
	 * and deliberately not a build ladder: the ladder puts one row per BUILD
	 * and marks environments onto it, which is the form the human has now
	 * rejected. This puts one row per ENVIRONMENT and makes the GAP between
	 * two environments a first-class object with its own count, so
	 * "where is this app stuck" is read straight down one column.
	 *
	 * NODE — `[status dot] [env chip] ……… [rank + build badge]`.
	 *   · The dot is the product's ONE status mark: 5x5, 4px radius, the six
	 *     status hues. `DESIGN.md` fixes that geometry on every page without
	 *     exception, so the study's 9px circle is rendered as the product's
	 *     5px square. Loose, not joined, because a row here has exactly one
	 *     possible subject — the same argument that licenses a loose dot on
	 *     `/environments` and `/envs/[name]`.
	 *   · ⛔ IT IS DRAWN ONLY WHEN THE STATE IS A DEVIATION (2026-08-27). A
	 *     `Succeeded` node draws NO dot and keeps its 5px track, so the rail
	 *     still runs down one centre line and every chip still starts at the
	 *     same x. `edge-mesh` was rendering THIRTEEN green dots down a 340px
	 *     column, every one of them saying "fine" — the exact inversion
	 *     *"mark the deviation, never the norm"* exists to stop, and the
	 *     reason a single amber or red node was invisible in the set. Failed
	 *     RED, baking YELLOW, deploying BLUE and never-deployed gray still
	 *     draw, because each of those IS the deviation.
	 *     The status word is in the node's `title` in every case.
	 *   · The rank and the build it ranks are ONE fact, so they are ONE
	 *     joined `Chip` — the badge `/rollouts` draws and every other page
	 *     has converged onto. `−N` red, `diverged` red, `unknown` gray,
	 *     `not deployed` gray. Zero new colour values, zero new geometry.
	 *   · ⛔ A NODE ON HEAD PRINTS ITS BUILD AND NO RANK WORD (2026-08-29).
	 *     One half means "on head"; two halves carry a verdict. See the
	 *     branch itself for the argument — the short version is that a
	 *     `[NEWEST][build]` box per environment is the norm drawn N times,
	 *     and *"an env with no rank chip is on the newest build"* has been
	 *     the product's rule since 2026-08-23.
	 *   · A node that is not serving anything renders in the neutral line
	 *     colour throughout: gray dot, `not deployed` where the badge goes.
	 *
	 * HOP — the 20px gap BETWEEN two nodes, drawn as a vertical rail with a
	 * label. This is the point of the whole object.
	 *   · The rail is DASHED when builds are waiting and SOLID when the edge
	 *     is in sync. Shape, not hue: the study paints the label amber, and
	 *     amber in this product is `stuck` AND NOTHING ELSE for state
	 *     (`DESIGN.md` → "Colour — closed"). A pipeline that is merely mid
	 *     promotion is not stuck, and painting every promoting edge with the
	 *     alarm's colour is exactly the inversion the closed budget exists to
	 *     stop. The count is printed, in mono, which is how this product
	 *     carries rank everywhere else.
	 *
	 * The same component draws the PRODUCTION FLEET rows with `hops={[]}` —
	 * production regions are a SET, and a set has no order, so it gets the
	 * nodes and none of the rails.
	 */
	import Chip from './Chip.svelte';
	import type { EnvironmentTheme } from '$lib/environment-theme';

	type Node = {
		key: string;
		/** Chip label — the region token in a fan-out, the env name otherwise. */
		label: string;
		title: string;
		theme: EnvironmentTheme | null;
		/** Display sha, or null when this environment has never deployed. */
		version: string | null;
		/** Build-ladder rank. 0 = newest, -1 = not on the ladder. */
		rank: number;
		diverged: boolean;
		/** `bg-green-700 dark:bg-green-400` etc. — the six status hues only. */
		dotClass: string;
		/** True when the deploy simply succeeded — no dot is drawn. See above. */
		settled?: boolean;
		/** Screen-reader / tooltip word for the dot. */
		statusWord: string;
		/** Link to this environment's rollout. Omitted for a folded mark. */
		href?: string;
		/**
		 * MARK THE DEVIATION, NEVER THE NORM.
		 *
		 * True for a production region that is on the build the fleet agreed
		 * on. Its distance from newest is already stated once — by the hop
		 * into the fleet — so repeating it in the loud red `rank` ink twelve
		 * times spends the page's deviation colour on the majority case and
		 * leaves the two regions that actually differ with nothing to stand
		 * out against. Quiet rows keep the full number and the full sha; they
		 * only give up the colour.
		 */
		quiet?: boolean;
	};

	type Hop = {
		/** Builds waiting to cross this edge. Drives dashed vs solid. */
		waiting: number;
		label: string;
	};

	let {
		nodes,
		hops = [],
		emptyLabel = 'No environments bound'
	}: {
		nodes: Node[];
		/** `hops[i]` sits between `nodes[i]` and `nodes[i + 1]`. */
		hops?: (Hop | null)[];
		emptyLabel?: string;
	} = $props();
</script>

{#if nodes.length === 0}
	<p class="t-micro text-gray-500 dark:text-gray-400">{emptyLabel}</p>
{:else}
	<ol class="sc">
		{#each nodes as n, i (n.key)}
			<li class="sc-node" title="{n.title} — {n.statusWord}">
				<!-- The track is 5px whether or not a dot is in it, so the rail
				     stays on one centre line and every chip starts at the same x. -->
				{#if n.version && !n.settled}
					<span class="sc-dot {n.dotClass}" aria-hidden="true"></span>
				{:else if !n.version}
					<span class="sc-dot bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span>
				{:else}
					<span aria-hidden="true"></span>
				{/if}
				<span class="flex min-w-0 items-center gap-2">
					{#if n.href}
						<a href={n.href} class="flex min-w-0" title="Open the {n.title} rollout">
							<Chip
							role="env"
							theme={n.theme}
							label={n.label}
							title={n.title}
							wide class="min-w-0"
						/>
						</a>
					{:else}
						<Chip
							role="env"
							theme={n.theme}
							label={n.label}
							title={n.title}
							wide class="min-w-0"
						/>
					{/if}
				</span>
				<span class="justify-self-end">
					{#if n.version === null}
						<Chip role="unranked" label="not deployed" title="{n.title} has never deployed" />
					{:else if n.diverged}
						<Chip
							role="diverged"
							label="diverged"
							value={n.version}
							title="{n.title} runs a build that is on no environment's release line"
						/>
					{:else if n.rank === 0}
						<!-- ON HEAD: THE BUILD ALONE. NO RANK WORD. (2026-08-29)

						     This used to render `[NEWEST][<build>]`, and on a converged
						     chain that is the norm drawn once per environment: three
						     quiet-mint chips on the live cluster's own three-stage app,
						     saying "fine" three times. It is the pattern that got
						     `Fleet by build`, `EnvHealthStrip` and `DeployHistoryStrip`
						     cut, and the product's own rule has said the opposite since
						     2026-08-23: *"An env with no rank chip is on the newest
						     build."* `/apps` deleted twelve green per-environment
						     `newest` chips on exactly this reasoning; the stage chain
						     was the one list of N environments still printing it.

						     THE BUILD IS NOT LOST, WHICH IS WHY THIS IS NOT SIMPLY A
						     DELETION. `newest` and the build were ONE joined box, so
						     dropping the box would drop the identifier with it. It
						     becomes the IDENTIFIER-ONLY form instead — `Chip`'s
						     `valueOnly` branch, the same 20px box, 6px padding, 1px
						     hairline and 4px radius, all four corners. THE NUMBER OF
						     HALVES IS THE ENCODING: one half is on head, two halves
						     carry a verdict (`−N`, `diverged`, `unknown`). That is the
						     same structure-over-ink fix `/envs/[name]` took when it
						     dropped `valueDim` for a lone chip, and it costs ZERO
						     colour values — it REMOVES one, the quiet mint, from every
						     chain.

						     `newest` itself is untouched and still means what it means
						     on `/`, `/rollouts` and `/versions`, where a card is ONE
						     subject and the word is a verdict about it rather than a
						     mark repeated down a list. -->
						<Chip
							value={n.version}
							valueTitle="{n.title} runs the newest known build"
						/>
					{:else if n.rank > 0}
						<Chip
							role={n.quiet ? 'count' : 'rank'}
							label="−{n.rank}"
							value={n.version}
							title="{n.title} is {n.rank} build{n.rank === 1 ? '' : 's'} behind the newest"
						/>
					{:else}
						<Chip
							role="unranked"
							label="unknown"
							value={n.version}
							title="This build is not on the ladder"
						/>
					{/if}
				</span>
			</li>

			{#if hops[i]}
				{@const h = hops[i] as Hop}
				<!-- The rail is always drawn; the LABEL only when it is a count.
				     Solid rail = in sync, and that used to be said twice. -->
				<li class="sc-hop" aria-hidden="false">
					<span class="sc-rail {h.waiting > 0 ? 'sc-rail--gap' : ''}"></span>
					{#if h.label}
						<span class="t-code-sm truncate text-gray-500 dark:text-gray-400">{h.label}</span>
					{/if}
				</li>
			{/if}
		{/each}
	</ol>
{/if}

<style>
	.sc {
		display: flex;
		flex-direction: column;
	}

	/* `5px minmax(0,1fr) auto` — the dot's track is the product's status mark
	   width, so the rail below it lands on the dot's own centre line. */
	.sc-node {
		display: grid;
		grid-template-columns: 5px minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 8px;
		padding-block: 4px;
	}

	.sc-dot {
		width: 5px;
		height: 5px;
		border-radius: 4px;
	}

	.sc-hop {
		display: grid;
		grid-template-columns: 5px minmax(0, 1fr);
		align-items: center;
		column-gap: 8px;
		height: 20px;
	}

	/* The rail runs through the dot column's centre. Solid = in sync;
	   dashed = builds are waiting on this edge. */
	.sc-rail {
		display: block;
		width: 0;
		height: 100%;
		margin-left: 2px;
		border-left: 1px solid var(--color-gray-200);
	}
	:global(.dark) .sc-rail {
		border-left-color: var(--color-gray-700);
	}
	.sc-rail--gap {
		border-left-style: dashed;
		border-left-color: var(--color-gray-400);
	}
	:global(.dark) .sc-rail--gap {
		border-left-color: var(--color-gray-500);
	}
</style>
