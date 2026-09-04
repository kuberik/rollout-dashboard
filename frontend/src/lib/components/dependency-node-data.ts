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
