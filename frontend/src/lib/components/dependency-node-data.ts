import type { GateClears } from '$lib/view-models/blocking-story';

/**
 * The payload one `DependencyNode` renders — ONE ROLLOUT, i.e. one
 * (service, environment).
 *
 * It lives in its own module rather than in the component because a Svelte 5
 * instance script cannot `export type` — and because `DependencyNetwork`
 * builds these objects, so the shape belongs to neither file alone.
 *
 * ⛔ EVERYTHING HERE MUST BE JSON-SERIALISABLE. `GraphCanvasInner` compares
 * `JSON.stringify(node.data)` to decide whether the library's state needs
 * resyncing, so an `EnvironmentTheme` object is flattened to its CSS custom
 * properties (`themeStyle`) before it gets here.
 */
export type DependencyNodeData = {
	/** The Rollout name — the product's app identity. */
	name: string;
	/** The environment tier this rollout IS. `dev`, `prod-eu-central`. */
	env: string;
	/** The short form the product's env chips print. */
	envLabel: string;
	/** `getEnvironmentThemeStyle(theme)`, or null when the tier has no theme. */
	themeStyle: string | null;
	/** The build it is running now. The promotion edge's whole meaning. */
	build: string | null;
	/** No Rollout of this identity is visible to this dashboard. */
	unresolved: boolean;
	/** Held by something that does not clear itself. The RED predicate. */
	blocked: boolean;
	/** Gates holding it that have no second rollout on the far end. */
	holds: {
		gate: string;
		clears: GateClears;
		short: string;
		/**
		 * ⭐ TRUE WHILE THIS HOLD'S KIND IS STILL A GUESS. (2026-09-04,
		 * load-state audit finding 4) Carried straight off
		 * `NodeHold.pending` / `ClassifiedGate.pending` — `short` is the
		 * `check` fallback's claim ("A check is not passing") until
		 * `/schedules` has actually been consulted, and might turn out to
		 * be a `clock` gate with real window text instead. `DependencyNode`
		 * renders a `SkeletonBar` for the reason line and the `pending`
		 * glyph, never `short` or the `check` mark, while this is true.
		 */
		pending?: boolean;
	}[];
	/**
	 * ⭐ D-20b ROUND 2 (coordinator decision, 2026-10-09) — WHERE A HELD
	 * CONSTRAINT IS NOW READ. Edge labels caused unbounded label-collision
	 * work on a dense canvas and never reached zero; the fix is structural,
	 * not a better placement algorithm — stop putting the constraint text
	 * on the edge at all. Each BLOCKED inbound contract edge becomes one
	 * quiet line on the CONSUMER node (`DependencyNode`'s own template),
	 * same role `holds` already plays for a gate with no second rollout —
	 * this is its counterpart for a gate that DOES have one, which used to
	 * live only on the edge. An open (non-blocked) contract carries no
	 * entry here, same "mark the deviation, never the norm" rule `holds`
	 * already follows.
	 */
	heldConstraints: {
		/** The contract name, e.g. `payments`. Never `null` on the wire —
		 *  `DependencyNetwork` already falls back to `'contract'`. */
		contract: string;
		/** What the held candidate asks of it, e.g. `~2.9.0`. */
		requiredVersion: string | null;
		/** What the provider actually serves here, e.g. `2.4.1`. */
		providedVersion: string | null;
	}[];
	href: string | null;
	focused: boolean;
	title: string;
	/**
	 * ⭐ WRITTEN BY `GraphCanvasInner`, NOT BY THE CALLER. The canvas measures
	 * its own container and flips dagre between `LR` and `TB`; the node has to
	 * know which, because the two edge kinds are told apart by WHICH SIDE they
	 * land on and that pair of axes transposes with the layout. See
	 * `DependencyNode`.
	 */
	orientation?: 'LR' | 'TB';
	/**
	 * ⭐ ALSO WRITTEN BY `GraphCanvasInner`. Under `TB`, `singleFile` puts every
	 * node in its own rank, so a contract partner is no longer beside this
	 * node — it is somewhere else in the SAME column. `contractIn` moves to
	 * the same side as `contractOut` (`Right`) so the edge can hook out into
	 * the gutter and back in without crossing the column, instead of routing
	 * itself behind the whole stack looking for a `Left` it no longer has a
	 * clear line to. See `ContractHopEdge`.
	 */
	singleFile?: boolean;
};
