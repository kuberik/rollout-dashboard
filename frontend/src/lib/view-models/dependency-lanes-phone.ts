/**
 * DEPENDENCY LANES, PHONE GEOMETRY — pure helpers for the /dependencies phone forms (take B, design/deps-b-phone).
 *
 * The phone cannot draw the services × environments matrix (four 80px columns do not hold a build), so it re-reads the
 * same `LaneModel` in these shapes:
 *   - `blockerTree`: a blocker and every cell it holds, through held links, as a tree (GitHub Actions' phone job list,
 *     REFS §10: the blocker story told as an indented tree with elbows).
 *   - `promotionPath`: one service's environments in order with the promotion link that joins each pair.
 *
 * Pure: no Svelte. `dependency-lanes-phone.test.ts` pins the trees, the paths and the phrases.
 */
import type { LaneBlocker, LaneCell, LaneLink, LaneModel } from './dependency-lanes';

/** Index of each row's service in the model, for stable ordering. */
function rowOrder(model: LaneModel): Map<string, number> {
	return new Map(model.rows.map((r, i) => [r.service, i] as const));
}

export type TreeNode = {
	cell: LaneCell;
	/** The held link that reaches this cell from its parent; null on the root. */
	via: LaneLink | null;
	children: TreeNode[];
};

/** The blocker and everything it holds, through held links, each cell once (first reached), children in map order. */
export function blockerTree(model: LaneModel, blocker: LaneBlocker): TreeNode {
	const order = rowOrder(model);
	const colIx = new Map(model.columns.map((c, i) => [c.key, i] as const));
	const seen = new Set<string>([blocker.cell.key]);
	const build = (cell: LaneCell, via: LaneLink | null): TreeNode => {
		const out = model.links
			.filter((l) => l.held && l.from === cell.key && !seen.has(l.to))
			.map((l) => ({ l, c: model.cells.get(l.to)! }))
			.filter((x) => !!x.c)
			.sort((a, b) => order.get(a.c.service)! - order.get(b.c.service)! || colIx.get(a.c.col)! - colIx.get(b.c.col)!);
		for (const x of out) seen.add(x.c.key);
		return { cell, via, children: out.map((x) => build(x.c, x.l)) };
	};
	return build(blocker.cell, null);
}

export type PathStop = {
	col: string;
	cell: LaneCell;
	/** The promotion link INTO this stop from the previous one; null on the first stop or when none is declared. */
	link: LaneLink | null;
};

/** One service's environments in promotion order, each with the promotion link from the stop before it. */
export function promotionPath(model: LaneModel, service: string): PathStop[] {
	const row = model.rows.find((r) => r.service === service);
	if (!row) return [];
	const stops = model.columns.map((c) => row.cells.get(c.key)).filter((c): c is LaneCell => !!c);
	return stops.map((cell, i) => ({
		col: cell.col,
		cell,
		link: i === 0 ? null : (model.links.find((l) => l.kind === 'promotion' && l.from === stops[i - 1].key && l.to === cell.key) ?? null)
	}));
}

/** Count of cells in a tree, root excluded. */
export function treeSize(t: TreeNode): number {
	return t.children.reduce((a, c) => a + 1 + treeSize(c), 0);
}

export type NeedPhrase = {
	/** `needs payments ^3.0.0`, or `needs payments ^3.0.0 or ~2.9.0` when the regions cannot be counted. */
	need: string;
	/** `1 region ~2.9.0` when a minority of regions ask for a different range; null otherwise. */
	minority: string | null;
	/** `has 2.4.1`; null when the provider's version is unknown. */
	has: string | null;
};

/**
 * A held contract link's fact, said once, in units that never break mid-phrase: the range most held regions ask for,
 * the others counted ("1 region ~2.9.0"), and what is served. Counts come from each held edge's own range; when the
 * edges do not carry the ranges the link reports (the Gates tab's reading differs), the ranges are listed, not counted.
 */
export function needPhrase(l: LaneLink): NeedPhrase {
	const what = l.contract ?? 'a contract';
	const has = l.serves ? `has ${l.serves}` : null;
	if (l.needs.length <= 1) return { need: `needs ${what}${l.needs[0] ? ` ${l.needs[0]}` : ''}`, minority: null, has };
	const counts = new Map<string, number>();
	for (const e of l.edges) {
		if (e.state !== 'blocked') continue;
		const r = e.requiredVersion ?? e.requiredVersions?.[0] ?? null;
		if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
	}
	const sameSet = counts.size === l.needs.length && l.needs.every((n) => counts.has(n));
	if (!sameSet) return { need: `needs ${what} ${l.needs.join(' or ')}`, minority: null, has };
	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const rest = ranked.slice(1).map(([r, n]) => `${n} region${n === 1 ? '' : 's'} ${r}`);
	return { need: `needs ${what} ${ranked[0][0]}`, minority: rest.join(', '), has };
}
