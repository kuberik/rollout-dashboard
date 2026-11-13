/**
 * A synchronous memo scope for the view-model layer. data.ts derivations are pure over (fixture or live source, approvals, GitHub answers), but
 * they are called from inside loops: `classified` asks `rowsOf` once per (change x place), and `rowsOf` rebuilt the whole `rollouts()` table every
 * time (home-incident: ~1 s per /changes derivation, `rowsOf < classified < rideTruth < rides < classifyChanges < changesPage`).
 *
 * `inScope(fn)` runs a page-level derivation; inside it, `scoped(key, make)` computes each key once. The cache lives only for the duration of the
 * OUTERMOST `inScope` call (the code is synchronous, so nothing it reads can change meanwhile) and is dropped in `finally`, so nothing is ever
 * served stale across the reactive ticks (approvals, GitHub answers, the clock) that re-run a derivation. Reactive reads still happen on the first
 * call of each key, so `$derived` dependency tracking is unchanged. Outside a scope `scoped` just calls `make`.
 */
let depth = 0;
let cache: Map<string, unknown> | null = null;
/** work counters for the pin test (`derivation-perf.test.ts`): how often each key was computed (miss) vs served (hit) */
export const stats = { /** off in production: the pin test turns it on, so the per-key map never grows in a long session */ track: false, hits: 0, misses: 0, byKey: new Map<string, number>() };

export function inScope<T>(fn: () => T): T {
	if (depth++ === 0) cache = new Map();
	try { return fn(); } finally { if (--depth === 0) cache = null; }
}
export function scoped<T>(key: string, make: () => T): T {
	if (!cache) return make();
	if (cache.has(key)) { if (stats.track) stats.hits++; return cache.get(key) as T; }
	if (stats.track) { stats.misses++; stats.byKey.set(key, (stats.byKey.get(key) ?? 0) + 1); }
	const v = make();
	cache.set(key, v);
	return v;
}
