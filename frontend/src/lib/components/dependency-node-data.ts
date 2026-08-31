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
	holds: { gate: string; clears: GateClears; short: string }[];
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
};
