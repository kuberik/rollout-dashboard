/**
 * THE ONE "A FAILED BUILD IS NOT COMING" RULE (batch4 #1). A build that FAILED its bake in a place of an app (a Failed history entry for that
 * version, or an Environment blocker `outcome: Failed` for that revision) and was rolled back or pinned away from is not arriving, not waiting and
 * not "behind" while the place runs its rollback target: nothing will deploy it again without a person's action. Its release candidate stays
 * published (the registry still has it), so a count that reads `releaseCandidates` or the app's newest build must subtract it HERE.
 * Every surface that prints "N behind" / "N arriving" / "N waiting" reads this, never its own copy.
 */
type Ref = { tag?: string | null; version?: string | null; revision?: string | null };
type Entry = { bakeStatus?: string | null; version?: Ref | null };

const sha = (v: string): string => (/^[0-9a-f]{8,40}$/.test(v) ? v.slice(0, 7) : v);
/** every name a build answers to: its tag (b-46), its version (4.46.0-46), its revision (7-char sha) */
export function buildKeys(r: Ref | null | undefined): string[] {
	if (!r) return [];
	return [r.tag, r.version, r.revision].filter((x): x is string => !!x).map(sha);
}

/** the builds that failed their bake in this place's history, by every name; `blockerRevisions` adds the Environment's own `bake failed on <rev>` */
export function failedBuildKeys(history: readonly Entry[] | null | undefined, blockerRevisions: readonly string[] = []): Set<string> {
	const out = new Set<string>(blockerRevisions.map(sha));
	for (const e of history ?? []) if (e.bakeStatus === 'Failed') for (const k of buildKeys(e.version)) out.add(k);
	return out;
}

/** true when `candidate` failed in the place whose failed set is `failed` (the place's current build is never its own candidate) */
export const failedHere = (candidate: Ref | string | null | undefined, failed: ReadonlySet<string>): boolean =>
	typeof candidate === 'string' ? failed.has(sha(candidate)) : buildKeys(candidate).some((k) => failed.has(k));
