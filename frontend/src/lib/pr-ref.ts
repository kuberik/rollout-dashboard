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

/** The `/pr/{owner}/{repo}/{number}` route, for a resolved reference. */
export function prPath(owner: string, repo: string, number: number): string {
	return `/pr/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`;
}
