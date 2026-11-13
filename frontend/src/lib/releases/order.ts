/**
 * THE ONE ORDER OF AN APP'S BUILDS: the release catalogue's slice order, oldest to newest.
 *
 * Every place of an app reads its own copy of the catalogue (one list per rollout), and those copies are windows of the SAME
 * sequence: a spoke trims old releases on its own schedule, so two places can hold lists of different length and different
 * start. A build's position inside ONE place's list therefore says nothing about another place's; the builds are put in one
 * order first (`catalogueOrder`), and every "Newest" and every "N behind" is read off that order:
 *   - "Newest" = the last build of the order, even when it failed (its row says it failed). A held older build is never Newest.
 *   - "N behind" = how many builds of the order sit after the build a place runs (c1 is 2 behind c3, whatever happened to c2).
 * Surfaces never rank builds themselves: ledger (app-model ledgerOf), Slipway, Facia, the /apps tile and /envs/<env> all call
 * these functions.
 */

/** Join per-place catalogues (each oldest → newest) into one order, oldest → newest. Adjacent pairs of every list are edges; the
 *  result is the topological order of that graph (lists that are windows of one sequence give exactly that sequence). A build
 *  two lists order differently (never expected) falls back to first-seen order. */
export function catalogueOrder(lists: readonly (readonly string[])[]): string[] {
	const seen: string[] = [];
	const after = new Map<string, Set<string>>();
	const indeg = new Map<string, number>();
	for (const l of lists)
		for (let i = 0; i < l.length; i++) {
			const b = l[i];
			if (!indeg.has(b)) {
				indeg.set(b, 0);
				after.set(b, new Set());
				seen.push(b);
			}
			if (i === 0) continue;
			const a = l[i - 1];
			if (a === b || after.get(a)!.has(b)) continue;
			after.get(a)!.add(b);
			indeg.set(b, (indeg.get(b) ?? 0) + 1);
		}
	const out: string[] = [];
	const done = new Set<string>();
	const rank = new Map(seen.map((b, i) => [b, i] as const));
	for (;;) {
		const ready = seen.filter((b) => !done.has(b) && (indeg.get(b) ?? 0) === 0);
		/* a cycle (two lists disagree): take the first unplaced build and go on */
		const next = ready.length ? ready.reduce((m, b) => (rank.get(b)! < rank.get(m)! ? b : m)) : seen.find((b) => !done.has(b));
		if (next === undefined) break;
		done.add(next);
		out.push(next);
		for (const c of after.get(next) ?? []) indeg.set(c, (indeg.get(c) ?? 1) - 1);
	}
	return out;
}

/** The newest build of the order (null: no catalogue). */
export const newestOf = (order: readonly string[]): string | null => order[order.length - 1] ?? null;

/** How many builds of the order are newer than `build`; null when `build` is not in the order (a custom build, or an unknown lag). */
export function behindIn(order: readonly string[], build: string | null | undefined): number | null {
	if (!build) return null;
	const i = order.lastIndexOf(build);
	return i < 0 ? null : order.length - 1 - i;
}

/**
 * THE ONE "BEHIND" (coordinator 2026-11-13): how many builds of the app's catalogue are newer than `build`. The Builds card, the Progress tab, the
 * app page's header strip and the ledger all print this number; `ownCount` is the place's own list (releaseCandidates), used only when the build is
 * not in the catalogue order (a custom build, or an app with no catalogue). Never the other way round.
 */
export function catalogueBehind(order: readonly string[], build: string | null | undefined, ownCount: () => number): number {
	return behindIn(order, build) ?? ownCount();
}
