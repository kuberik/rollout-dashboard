/**
 * WHICH failure event of a place is the current one. A place's history can hold several failed deploys; only the newest is the
 * place's current state (and only while the place is still failed, see `failureRecoveredNow` in components/new/data.ts), so only it can
 * take the recovered mark. Older failures are history: they keep the plain failed mark, they are never marked recovered by the
 * place's later health.
 */
export function newestFailureEvents<T extends { kind: string; href: string | null; at: string | null }>(evs: readonly T[], failedKind = 'failed'): Set<T> {
	const best = new Map<string, T>();
	for (const e of evs) {
		if (e.kind !== failedKind || !e.href) continue;
		const cur = best.get(e.href);
		if (!cur || (Date.parse(e.at ?? '') || 0) > (Date.parse(cur.at ?? '') || 0)) best.set(e.href, e);
	}
	return new Set(best.values());
}
