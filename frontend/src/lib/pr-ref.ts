/**
 * PARSE WHAT A DEVELOPER PASTES INTO ⌘K, INTO A PULL REQUEST REFERENCE.
 *
 * Three shapes, per the PR-centric view design doc (`luka-polish-revisions-
 * pass-6-design-20260910-092839.md`, "⌘K" section):
 *
 *   1. A full GitHub PR URL — `https://github.com/owner/repo/pull/123`,
 *      with or without a scheme, a `www.` prefix, a trailing slash, or a
 *      tail (`/files`, `/commits`, `?diff=split`, `#issuecomment-1`).
 *   2. `owner/repo#123` — unambiguous without ever touching the network.
 *   3. A bare `#123` — ambiguous across every repo the palette knows about.
 *      This module does not resolve it; `palette-index.ts` fans it out to
 *      one candidate per distinct cluster source repo, because a bare PR
 *      number exists in nearly every repository at once and there is no
 *      honest way to pick one here.
 *
 * Deliberately NOT a `resolve` endpoint (see the design doc's backend
 * section): the ambiguity in (3) is real, not a gap this file can close by
 * guessing.
 */

export type FullPrRef = {
	kind: 'full';
	owner: string;
	repo: string;
	number: number;
};

export type BarePrRef = {
	kind: 'bare';
	number: number;
};

export type PrRef = FullPrRef | BarePrRef;

// `github.com/owner/repo/pull/123`, tolerant of scheme, `www.`, a trailing
// `.git` on the repo segment (never valid here, but cheap to strip), and any
// `/…`, `?…` or `#…` tail after the number.
const PR_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

// `owner/repo#123`. GitHub repo/owner segments are `[A-Za-z0-9._-]`.
const OWNER_REPO_HASH = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

// A bare `#123`.
const BARE_HASH = /^#(\d+)$/;

/**
 * Parse a pasted string into a `PrRef`, or `null` when it names nothing.
 *
 * The owner/repo segments are returned VERBATIM (not lower-cased) — they are
 * for display (`Open PR #123 · owner/repo`) and for the `/api/github/pulls/
 * :owner/:repo/:number` path, which is case-insensitive on GitHub's own side.
 * Normalising for repo-identity comparisons (`status.source` matching) is
 * `version-utils.ts`'s job, not this parser's.
 */
export function parsePrRef(input: string): PrRef | null {
	const s = input.trim();
	if (!s) return null;

	const urlMatch = s.match(PR_URL);
	if (urlMatch) {
		return {
			kind: 'full',
			owner: urlMatch[1],
			repo: urlMatch[2].replace(/\.git$/i, ''),
			number: Number(urlMatch[3])
		};
	}

	const ownerRepoMatch = s.match(OWNER_REPO_HASH);
	if (ownerRepoMatch) {
		return {
			kind: 'full',
			owner: ownerRepoMatch[1],
			repo: ownerRepoMatch[2],
			number: Number(ownerRepoMatch[3])
		};
	}

	const bareMatch = s.match(BARE_HASH);
	if (bareMatch) {
		return { kind: 'bare', number: Number(bareMatch[1]) };
	}

	return null;
}

/** The `/pr/{owner}/{repo}/{number}` route, for a resolved reference.
 *  ⛔ SUPERSEDED but PERMANENT (CHANGES-2026-09-10.md §1): the human keeps
 *  PR tabs open "for longer time", so this route 308s to `changePath`'s
 *  address forever and is never deleted. New call sites use `changePath`. */
export function prPath(owner: string, repo: string, number: number): string {
	return `/pr/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`;
}

/**
 * THE `/changes` ROUTE, for a resolved owner/repo + PR number or bare sha.
 *
 * CHANGES-2026-09-10.md §1: `/pr/<owner>/<repo>/<n>` → `/changes/<repoSlug>/pull/<n>`,
 * and a bare commit maps onto `/changes/<repoSlug>/<sha>` — ONE page kind,
 * disambiguated by shape. `owner`/`repo` are joined into the same
 * `github.com/<owner>/<repo>` slug `version-utils.ts`'s `repoSlug` produces
 * from a `repo:` key, so a caller holding a bare owner/repo pair (the PR API
 * response, a palette match) does not have to round-trip through a
 * `repoKey` first. `changeRepoPath`/`changeBuildPath` (`version-utils.ts`)
 * are the `repoKey`-keyed siblings of this function, for callers that
 * already hold one.
 */
export function changePath(
	owner: string,
	repo: string,
	ref: { number: number } | { sha: string }
): string {
	const repoSlug = ['github.com', owner, repo].map(encodeURIComponent).join('/');
	if ('number' in ref) return `/changes/${repoSlug}/pull/${ref.number}`;
	return `/changes/${repoSlug}/${encodeURIComponent(ref.sha)}`;
}

export type ChangeRef = { kind: 'pull'; number: number } | { kind: 'sha'; sha: string };

/**
 * Splits a `/changes/[...slug]` rest-param into the repo slug and the
 * reference it names — CHANGES-2026-09-10.md §1's ONE disambiguation rule,
 * evaluated first: **a slug whose last two segments are `pull/<digits>` is
 * a change page keyed on a PR; everything else splits the last segment off
 * as a build key**, exactly as `/revisions/[...slug]` already does for a
 * sha. `null` when the slug is too short to name a repo at all (fewer than
 * two segments — a repo needs at least `owner/repo` before its ref).
 */
export function parseChangeSlug(segments: readonly string[]): { repoSlug: string; ref: ChangeRef } | null {
	if (segments.length < 2) return null;
	const last = segments[segments.length - 1];
	const secondLast = segments[segments.length - 2];
	if (secondLast === 'pull' && /^\d+$/.test(last)) {
		const repoSlug = segments.slice(0, -2).join('/');
		if (!repoSlug) return null;
		return { repoSlug, ref: { kind: 'pull', number: Number(last) } };
	}
	const repoSlug = segments.slice(0, -1).join('/');
	if (!repoSlug) return null;
	return { repoSlug, ref: { kind: 'sha', sha: last } };
}
