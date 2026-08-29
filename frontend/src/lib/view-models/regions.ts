/**
 * Production fan-out — the LINE-vs-SET rule, made structural.
 *
 * Stages are a LINE: dev, then staging, then prod. Reading order IS
 * promotion order, so each stage earns a row.
 *
 * Production regions are a SET: five prod-tier Environments are five
 * copies of the same promotion step, not five steps. Giving each one a
 * row states an order that does not exist and makes a healthy fan-out
 * cost five rows of vertical attention for one decision.
 *
 * So: regions are TILES while healthy, and become ROWS when they need a
 * decision. `splitRegions` is that rule and nothing else — one predicate
 * in, two disjoint lists out. The caller renders `tiles` inside the set
 * row's state cell and `rows` as full ledger rows directly below it.
 *
 * NOTE ON VOCABULARY: the word "region" appears NOWHERE in the kuberik
 * API. Multiple prod-tier Environments ARE the fan-out; "region" is only
 * a legitimate word for that shape when there is more than one of them.
 * With exactly one prod Environment the caller must render an ordinary
 * row and never say "region" at all.
 */

/** Tile min-width. The grid is `auto-fit` over this, so the column count
 *  is a function of the CONTAINER's width — which is what makes 12
 *  regions wrap onto more rows instead of overflowing sideways. There is
 *  no region count at which this grid scrolls horizontally. */
export const REGION_TILE_MIN_WIDTH_PX = 150;

/** 8px — "between atoms in a cluster" on the page's 5-value spacing scale. */
export const REGION_TILE_GAP_PX = 8;

export const REGION_TILE_GRID_TEMPLATE = `repeat(auto-fit, minmax(${REGION_TILE_MIN_WIDTH_PX}px, 1fr))`;

/** The whole inline style for the tile grid, so the component and the
 *  test assert the same string rather than two hand-copied ones. */
export const REGION_TILE_GRID_STYLE =
	`display:grid;grid-template-columns:${REGION_TILE_GRID_TEMPLATE};gap:${REGION_TILE_GAP_PX}px`;

export type RegionSplit<T> = {
	/** Healthy regions. Rendered as tiles inside ONE row. */
	tiles: T[];
	/** Regions that need a decision. Promoted OUT of the set into their
	 *  own full ledger rows, directly below the set row. */
	rows: T[];
};

/**
 * Split prod-tier cells into the tile set and the promoted-out rows.
 * Input order is preserved in both lists so the caller's promotion order
 * survives the split.
 */
export function splitRegions<T>(
	prodCells: readonly T[],
	isAdverse: (cell: T) => boolean
): RegionSplit<T> {
	const tiles: T[] = [];
	const rows: T[] = [];
	for (const cell of prodCells) {
		if (isAdverse(cell)) rows.push(cell);
		else tiles.push(cell);
	}
	return { tiles, rows };
}

/**
 * The build most of the fan-out is running, and how many are on it.
 *
 * This is the SET's identity. Ties break lexicographically so the answer
 * is stable across renders rather than dependent on Map iteration order.
 * Returns null when not one tile has a deploy to its name.
 */
export function modalBuild<T>(
	tiles: readonly T[],
	versionOf: (cell: T) => string | null | undefined
): { version: string; count: number } | null {
	const counts = new Map<string, number>();
	for (const cell of tiles) {
		const v = versionOf(cell);
		if (!v) continue;
		counts.set(v, (counts.get(v) ?? 0) + 1);
	}
	if (counts.size === 0) return null;

	let version = '';
	let count = 0;
	for (const [v, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (n > count) {
			version = v;
			count = n;
		}
	}
	return { version, count };
}

/**
 * The tiles that are NOT on the modal build — the fan-out's stragglers, in
 * the caller's order.
 *
 * A tile with no deploy at all counts as a straggler: it is definitionally
 * not on the modal build, and dropping it would make the summary's numbers
 * not add up to the tiles on screen.
 *
 * This is also the ONLY thing allowed to decide whether the set row may
 * carry a promote control — see the page. One straggler is a control with
 * an unambiguous target; two is not, because there is no batch mutation in
 * this product and `ChangeVersionModal` takes exactly one rollout.
 */
export function regionLaggards<T>(
	tiles: readonly T[],
	versionOf: (cell: T) => string | null | undefined
): T[] {
	const modal = modalBuild(tiles, versionOf);
	if (!modal) return [];
	return tiles.filter((cell) => versionOf(cell) !== modal.version);
}

/**
 * IS THE FLEET CONSISTENT? — the set row's lead, and the whole reason the
 * prod fan-out is one row instead of five.
 *
 * It used to read `4 on a44b210 · 1 behind` in 11px gray UNDER the tiles,
 * which answers the question only after the reader has counted the tiles
 * themselves — i.e. after doing the work the row exists to save them. The
 * lead now states the verdict first and the tiles are its evidence, which
 * is the order every other row on this page reads in.
 *
 * `total` is the number of prod-tier environments, which is NOT
 * `tiles.length` whenever an adverse region has been promoted out into its
 * own row. Saying "all 5 regions" while a sixth sits below in red is the
 * kind of confident wrong summary this page exists to remove, so the
 * denominator is always the whole fleet.
 *
 * Three shapes, in decreasing goodness:
 *   · `All 6 regions on a44b210`      — converged, and the sha is the proof
 *   · `5 of 6 regions on a44b210`     — one straggler, named by the tiles
 *   · `6 regions across 3 builds`     — scattered; no build is the answer
 */
export function regionSummary<T>(
	tiles: readonly T[],
	versionOf: (cell: T) => string | null | undefined,
	total: number = tiles.length
): string {
	if (tiles.length === 0) return '';
	const n = Math.max(total, tiles.length);
	const unit = n === 1 ? 'region' : 'regions';

	const modal = modalBuild(tiles, versionOf);
	// Every tile is undeployed — say so rather than inventing a version.
	if (!modal) return n === 1 ? 'no deploy yet' : `${n} ${unit} with no deploy yet`;

	const distinct = new Set<string>();
	let undeployed = 0;
	for (const cell of tiles) {
		const v = versionOf(cell);
		if (v) distinct.add(v);
		else undeployed++;
	}
	// Regions promoted out of the set are, by construction, not on the
	// modal build either — they are counted but never named here.
	const spread = distinct.size + (undeployed > 0 ? 1 : 0) + (n - tiles.length);

	if (modal.count === n) return `All ${n} ${unit} on ${modal.version}`;
	if (spread > 2) return `${n} ${unit} across ${spread} builds`;
	return `${modal.count} of ${n} ${unit} on ${modal.version}`;
}

/**
 * A region tile's label: the part of the environment name that is not the
 * word "prod".
 *
 * The tile already sits inside a row whose env chip says PROD, so six
 * tiles reading `PROD-US-EAST` spend six chips restating the row header
 * and leave the one distinguishing token to fight for what is left of a
 * 12ch chip. `prod-eu-central` is 15 characters and ellipsises to
 * `PROD-EU-CENT…`; `eu-central` fits whole.
 *
 * Strips only a leading or trailing `prod`/`production` token, and only
 * when something survives it — an environment genuinely named `prod` keeps
 * its name rather than rendering an empty chip.
 */
export function regionLabel(envName: string | null | undefined): string {
	const raw = (envName ?? '').trim();
	if (!raw) return '';
	const stripped = raw
		.replace(/^(prod|production)[-_/. ]+/i, '')
		.replace(/[-_/. ]+(prod|production)$/i, '')
		.trim();
	return stripped || raw;
}
