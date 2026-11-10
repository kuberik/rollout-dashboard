/**
 * ONE SOURCE OF TRUTH FOR "WHAT IS THIS BUILD CALLED."
 *
 * ⛔ WHY THIS EXISTS. A mock-only `commitMessage` field used to be written,
 * by hand, into three separate fixture files (`mock-data.ts`'s
 * `HF_COMMIT_TITLES`/`FLEET_COMMIT_TITLES`, `mock-details.ts`'s
 * `mkCwRollout`, `mock-promote.ts`'s hello-world history row) — a SECOND,
 * independent guess at the same commit's title that `lib/demo/github-data.ts`
 * already answers authoritatively for every sha this product ever shows.
 * The two guesses disagreed (confirmed live: a02f1c4 read "Add retry budget
 * to payment webhook" on its History row and "Add dead-letter queue for
 * failed checkout events" on its own diff page), and some mock objects
 * (`rollout.status.availableReleases`) never got the field at all, so the
 * SAME build read "No commit message" in one dialog and a real sentence two
 * clicks away.
 *
 * The real CRD has no commit-title field — production has never had this
 * problem because production has never had an answer to show. So the fix is
 * not a smarter mock field, it is ONE reader that every surface shares,
 * backed by whichever real commit data that surface already fetches (a
 * `commitsQueryOptions` range, or a single `commitQueryOptions` lookup) — in
 * the demo build, both of those are answered by `github-data.ts`, so asking
 * either one is asking the same ledger.
 *
 * `null` means "nothing to show" — the caller renders nothing, or a quiet
 * `t-meta` "No commit title" in `fg-subtle`, never a title-sized placeholder
 * (see this module's own callers for the one line each uses).
 */

/** The shape a commit range's own entry carries (`CommitInfo`, `$lib/api/github`). */
type RangeCommit = { message: string };
/** The shape a single bare-commit lookup carries (`Commit`, `$lib/api/commit`). */
type BareCommit = { subject: string };

export function buildTitle(
	commit: RangeCommit | BareCommit | null | undefined
): string | null {
	if (!commit) return null;
	const text = 'message' in commit ? commit.message : commit.subject;
	return typeof text === 'string' && text.length > 0 ? text.split('\n')[0] : null;
}

/**
 * The title of the NEWEST commit in an oldest→newest commit list — the
 * commit that actually produced the range's own `head` (see
 * `github-data.ts`'s `buildRange`/`headCommit`'s own doc comment in
 * `ChangeVersionModal`: a compare range only ever names its head's commit,
 * never its base's). `null` for an empty or missing list, same contract as
 * `buildTitle`.
 */
export function headCommitTitle(commits: readonly RangeCommit[] | null | undefined): string | null {
	if (!commits || commits.length === 0) return null;
	return buildTitle(commits[commits.length - 1]);
}

/**
 * Indices, from a list of `{i, base, head}` pairs (`consecutiveTagPairs`'s
 * shape, or a history page's own per-entry base/head), whose `base` is
 * missing while `head` is present — a row with NO OLDER SIBLING to diff
 * against: a one-deploy rollout (a single `history` entry), or any entry
 * whose predecessor fell off the version-history window. A two-sha COMPARE
 * can never name these (`headCommitTitle`'s own range always needs both
 * ends) — the caller's job is to fall back to a single-sha LOOKUP
 * (`$lib/api/commit`'s `commitQueryOptions`) for exactly these indices,
 * never for a row that already has a `base` to ask about.
 */
export function rootPairIndices(
	pairs: readonly { i: number; base?: string | undefined; head?: string | undefined }[]
): number[] {
	return pairs.filter((p) => !p.base && !!p.head).map((p) => p.i);
}

/**
 * Oldest→newest consecutive pairs for a tag ladder — `[{base: tags[0], head:
 * tags[1]}, {base: tags[1], head: tags[2]}, …]`. One pair per ladder step, so
 * a batched per-step commit lookup (`ChangeVersionModal`'s picker, which
 * cannot await one query per row) never asks for a range wider than a single
 * hop — which keeps every hop's own answer under the commits endpoint's own
 * display cap (`github-data.ts`'s `buildRange` keeps only the LAST 6 commits
 * of a range; a single hop is 1-3 commits, never truncated) and keeps each
 * request identical, and therefore cache-shared, with whichever OTHER
 * surface (a history row, `CommitSummary`) already asked the exact same
 * one-hop question.
 */
export function consecutiveTagPairs(
	tagsOldestFirst: readonly string[]
): { base: string; head: string }[] {
	const pairs: { base: string; head: string }[] = [];
	for (let i = 1; i < tagsOldestFirst.length; i++) {
		const base = tagsOldestFirst[i - 1];
		const head = tagsOldestFirst[i];
		if (base && head && base !== head) pairs.push({ base, head });
	}
	return pairs;
}
