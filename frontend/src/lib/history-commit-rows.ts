/**
 * One commit lookup per distinct revision, read back per history row.
 *
 * A rollback redeploys a revision that is already in the history, so a
 * query per row asks for the same commit twice and svelte-query warns
 * "[QueriesObserver]: Duplicate Queries found" on every visit to the
 * History tab. The page asks once per revision and maps the answers back to
 * rows here.
 */

/** Distinct non-empty revisions, in first-seen order. */
export function distinctRevisions(revisions: readonly (string | null | undefined)[]): string[] {
	return [...new Set(revisions.filter((r): r is string => !!r))];
}

/** `results[k]` answers `distinct[k]`; returns one `{ data }` per row revision. */
export function rowsFromDistinct<T>(
	rowRevisions: readonly (string | null | undefined)[],
	distinct: readonly string[],
	results: readonly { data: T | undefined }[]
): { data: T | undefined }[] {
	const byRevision = new Map<string, T | undefined>();
	distinct.forEach((rev, k) => byRevision.set(rev, results[k]?.data));
	return rowRevisions.map((rev) => ({ data: rev ? byRevision.get(rev) : undefined }));
}
