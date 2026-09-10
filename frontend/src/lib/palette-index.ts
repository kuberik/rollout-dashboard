import type { Rollout, Environment } from '../types';
import { buildRevisionLedger, type RevisionRow } from '$lib/view-models/revision-ledger';
import { changeBuildPath, repoKeyFromSource, githubOwnerRepo } from '$lib/version-utils';
import { parsePrRef, changePath as changePathCanonical, type PrRef } from '$lib/pr-ref';
import type { MyPull } from '$lib/api/my-pulls';

/**
 * ⌘K's BUILD INDEX. (operator walk, blocking: `9f10e49` returned "No matches"
 * although `/revisions/github.com/littlechimera/kuberik-testing/9f10e494d560`
 * exists; `064b655` only matched because that sha happened to also be the
 * displayed VERSION LABEL of some rollout's current build.)
 *
 * The palette's existing rollout/app/env/namespace rows are all keyed off
 * `rollouts`/`environments` AS THEY STAND RIGHT NOW — a build's CURRENT
 * label on whichever rollout happens to be running it. A revision search has
 * to work regardless of what any one service calls it today, which is
 * exactly the fragmentation `revision-ledger.ts`'s `buildRevisionLedger`
 * already resolved for `/revisions` — one row per commit, every label it
 * ships under attached to that row rather than splitting it. Reusing it here
 * (read-only import; this module computes nothing `/revisions` doesn't
 * already compute) is what makes a sha resolve independently of label
 * scheme, and is also why this index and that page cannot disagree about
 * what a revision is called or where it lives.
 *
 * `rows` AND `pending` both count: a revision nobody has deployed yet is
 * still a real git commit with a real detail page (see `RepoLedger.pending`'s
 * own doc comment), and an operator pasting a sha from CI has no way to know
 * in advance which bucket it landed in.
 */

export type PaletteBuildEntry = {
	key: string;
	/** Full git revision — what a sha PREFIX is matched against, never `short`. */
	revision: string;
	/** Seven characters — the row's own title. */
	short: string;
	/** Every distinct name some service ships this revision under, own-sha included. */
	labels: string[];
	repoKey: string;
	/** `github.com/littlechimera/kuberik-testing` — `revision-ledger.ts`'s own label. */
	repoLabel: string;
	/** `kuberik-testing` — the last path segment, for the compact result line. */
	repoShort: string;
	href: string;
};

/** `github.com/littlechimera/kuberik-testing` → `kuberik-testing`. */
function repoShortName(label: string): string {
	const segs = label.split('/').filter(Boolean);
	return segs[segs.length - 1] || label;
}

export function buildPaletteBuildIndex(
	rollouts: Rollout[],
	environments: Environment[]
): PaletteBuildEntry[] {
	const ledgers = buildRevisionLedger(rollouts, environments);
	const out: PaletteBuildEntry[] = [];
	for (const ledger of ledgers) {
		const repoShort = repoShortName(ledger.repoLabel);
		const rows: RevisionRow[] = [...ledger.rows, ...ledger.pending];
		/**
		 * ⭐ LANE 9, ROUND 11 QA, ITEM 15 — MERGE BY `(repoKey, revision)`
		 * BEFORE EMITTING A RESULT, NOT AFTER.
		 *
		 * `repoKey:revision` alone is NOT unique on `rows` — round 4a's "one
		 * row per RELEASE" split means a rollback can produce two
		 * `RevisionRow`s that share one revision (rel-66/rel-67 of the same
		 * commit, under different tags/labels). This USED to push one
		 * `PaletteBuildEntry` per row and paper over the duplicate KEY with
		 * `:${i}` — which fixed the crash (`each_key_duplicate` froze the
		 * whole palette's reactivity mid-keystroke) but not the DEFECT: a
		 * search for `9f10e49` still returned two rows, both opening the
		 * identical `href` (the row's split is release-scoped; the build
		 * page is revision-scoped, so both rows resolve to the same URL) and
		 * each carrying only ITS OWN partial label — `2.66.0-66` on one,
		 * `2.67.0-67` on the other — so neither result told the reader the
		 * commit ships under both. Grouping by revision FIRST, unioning
		 * every row's `labelGroups` into one set, produces the one entry the
		 * data actually supports: one build, one destination, every label it
		 * ships under.
		 */
		const byRevision = new Map<string, { row: RevisionRow; labels: Set<string> }>();
		for (const row of rows) {
			const existing = byRevision.get(row.revision);
			if (existing) {
				for (const g of row.labelGroups) existing.labels.add(g.label);
			} else {
				byRevision.set(row.revision, { row, labels: new Set(row.labelGroups.map((g) => g.label)) });
			}
		}
		for (const { row, labels } of byRevision.values()) {
			out.push({
				// `(repoKey, revision)` is unique by construction now — the
				// `Map` above already merged every row that would have
				// collided, so no `:${i}` suffix is needed to keep this key
				// distinct.
				key: `build:${ledger.repoKey}:${row.revision}`,
				revision: row.revision,
				short: row.short,
				labels: [...labels],
				repoKey: ledger.repoKey,
				repoLabel: ledger.repoLabel,
				repoShort,
				href: changeBuildPath(ledger.repoKey, row.revision, row.revision)
			});
		}
	}
	return out;
}

/** The one line a build result prints: `<sha7> · <labels> · <repo short name>`. */
export function buildEntryLine(entry: Pick<PaletteBuildEntry, 'short' | 'labels' | 'repoShort'>): string {
	return `${entry.short} · ${entry.labels.join(', ')} · ${entry.repoShort}`;
}

/** Git's own shortest safe abbreviation on a repo this size (`core.abbrev`). */
const MIN_SHA_QUERY = 7;
const HEX = /^[0-9a-f]+$/;

/**
 * Score a build entry against a query. -1 = no match.
 *
 * TWO independent ways in, because the bug was that only one of them existed:
 *
 *  - a SHA PREFIX (≥ 7 hex characters) resolves against the FULL revision,
 *    never the displayed 7-character `short` — a 12-character slug pasted
 *    from a `/revisions/.../<slug>` URL, or a longer abbreviation from a CI
 *    log, has to resolve exactly like the 7-character one does.
 *  - a VERSION LABEL resolves against every name in `labels`, exact match
 *    scored above a prefix, above a bare substring — independent of whether
 *    that label happens to equal the sha (the `064b655` case) or not (the
 *    `9f10e49` one).
 *
 * Exported and tested directly (`palette-index.test.ts`) rather than only
 * through the component, so the ranking and the row it produces cannot
 * drift from each other.
 */
export function scoreBuildEntry(
	entry: Pick<PaletteBuildEntry, 'revision' | 'labels'>,
	query: string
): number {
	const q = query.trim().toLowerCase();
	if (!q) return -1;
	let s = -1;
	if (q.length >= MIN_SHA_QUERY && HEX.test(q) && entry.revision.toLowerCase().startsWith(q)) {
		s = Math.max(s, q.length === entry.revision.length ? 100 : 92);
	}
	for (const label of entry.labels) {
		const l = label.toLowerCase();
		if (l === q) s = Math.max(s, 96);
		else if (l.startsWith(q)) s = Math.max(s, 58);
		else if (l.includes(q)) s = Math.max(s, 28);
	}
	return s;
}

/**
 * ⌘K'S CHANGE RESULT KIND. Renamed from "PR" (2026-09-10, `CHANGES-2026-09-10
 * .md`'s "THE PALETTE" section) — the `pr` kind is renamed, not duplicated.
 * The measured defect: typing `hello` put a `PULL REQUESTS` group of five
 * ABOVE every rollout, and the human asked why search grew a pull-request
 * CATEGORY when a reference already resolved directly. One rule, two halves:
 *
 *   1. A REFERENCE IS A DESTINATION, NOT A CATEGORY. A pasted PR URL,
 *      `owner/repo#123`, a bare `#123`, or a 7-40 character hex sha names
 *      exactly one destination and renders as ONE ungrouped row at the very
 *      top of the results, above the first group header —
 *      `buildChangeRefPaletteResults` builds that row (or one per distinct
 *      cluster repo, for the two ambiguous shapes); `CommandPalette.svelte`
 *      renders its output outside the grouped list entirely.
 *   2. A FREE-TEXT TITLE MATCH IS THE LONG TAIL, not a bypass. Typing part of
 *      a title matches the operator's own MERGED changes (the `/mine`
 *      cache, merged only — open PRs are gone: "it also doesn't make sense
 *      to show open PRs. user is only interested in what they merged.")
 *      and is scored by `CommandPalette.svelte`'s own `score()`, exactly
 *      like a rollout/app/env/namespace row (`KIND_PRIORITY.change = 1.5`,
 *      below rollout/app/env, above namespace) — `buildMergedChangeIndex`
 *      only builds the static per-pull universe; there is no sha-prefix
 *      rule to special-case the way `scoreBuildEntry` needs (a title is
 *      free text), so the generic substring scorer is the whole story.
 */

// ⛔ NO SEPARATE REGEX HERE (2026-09-10, PR-view fix pass, item 12 — a
// second, hand-rolled `SOURCE_OWNER_REPO` regex used to live here, and it
// did not strip a `/tree/<branch>` tail the way `repoKeyFromSource` claimed
// every caller could rely on). `repoKeyFromSource` + `githubOwnerRepo` are
// the ONE normalisation rule every other repo-identity comparison in this
// product already uses (`version-utils.ts`'s own doc comment); reusing them
// here means a fix to that rule (the `/tree/` tail, dotted repo names)
// reaches this call site for free instead of needing to be re-applied to a
// duplicate pattern.
function ownerRepoFromSource(source: string): { owner: string; repo: string } | null {
	return githubOwnerRepo(repoKeyFromSource(source, ''));
}

/**
 * A bare 7-40 character hex string — the same floor `scoreBuildEntry`'s own
 * `MIN_SHA_QUERY` already uses for a build sha-prefix, kept here as its own
 * constant because this is a DIFFERENT rule (a whole-string match, not a
 * prefix). `pr-ref.ts` does not parse this shape — it is a PR-reference
 * parser by design (see its own doc comment) — so it lives here instead.
 *
 * TODO(lane1): `pr-ref.ts`/`version-utils.ts` are expected to grow a shared
 * change-ref parser that folds this sha case in alongside `changePath`
 * (CHANGES-2026-09-10.md, L1). Switch to that import once it lands rather
 * than keeping a second regex here.
 */
const BARE_SHA = /^[0-9a-f]{7,40}$/i;

/** A resolved reference — owner/repo already known, either a PR number or a commit sha. */
export type ChangeRef = { kind: 'pull'; number: number } | { kind: 'sha'; sha: string };

/**
 * Parse a pasted string into a reference, or `null` when it names nothing.
 * `parsePrRef`'s `'full'`/`'bare'` shapes pass through unchanged; the only
 * addition here is the bare-sha case `pr-ref.ts` does not parse.
 */
export function parseChangeRef(input: string): PrRef | { kind: 'sha'; sha: string } | null {
	const prRef = parsePrRef(input);
	if (prRef) return prRef;
	const s = input.trim();
	if (BARE_SHA.test(s)) return { kind: 'sha', sha: s.toLowerCase() };
	return null;
}

/**
 * The `/changes/github.com/{owner}/{repo}/pull/{n}` or
 * `/changes/github.com/{owner}/{repo}/{sha}` route, for an already-resolved
 * reference.
 *
 * ⭐ FIX PASS ITEM 3 (2026-09-10). This USED to be a local, host-less
 * `/changes/<owner>/<repo>/…` builder (the TODO(lane1) it replaces) — real
 * bug, live: ⌘K → paste `bf5be49` → Enter landed on
 * `/changes/littlechimera/kuberik-testing/bf5be49`, which `[...slug]`'s own
 * `changeOwnerRepo` rejects (`parts[0] !== 'github.com'`) as "This
 * repository does not exist". `pr-ref.ts`'s `changePath` (Lane 1, now
 * landed) is the ONE function that builds the real `github.com/owner/repo`
 * slug shape every change-page route expects — this thin wrapper only
 * translates this module's own tagged-union `ChangeRef` into that
 * function's `{number}|{sha}` shape so every existing call site in this
 * file keeps compiling unchanged.
 */
export function changePath(owner: string, repo: string, ref: ChangeRef): string {
	return changePathCanonical(owner, repo, ref.kind === 'pull' ? { number: ref.number } : { sha: ref.sha });
}

export type PaletteChangeEntry = {
	key: string;
	owner: string;
	repo: string;
	ref: ChangeRef;
	/** `Open change #4 · kuberik-testing` / `Open change bf5be49 · kuberik-testing`, or the merged pull's own title. */
	title: string;
	href: string;
};

function changeRefEntry(owner: string, repo: string, ref: ChangeRef): PaletteChangeEntry {
	const label = ref.kind === 'pull' ? `#${ref.number}` : ref.sha;
	const refKey = ref.kind === 'pull' ? `pull:${ref.number}` : `sha:${ref.sha}`;
	return {
		key: `change-ref:${owner}/${repo}:${refKey}`,
		owner,
		repo,
		ref,
		title: `Open change ${label} · ${repo}`,
		href: changePath(owner, repo, ref)
	};
}

/**
 * Every distinct `owner/repo` this cluster's rollouts deploy from, deduped by
 * the SAME normalised identity `version-utils.ts`'s `repoKeyFromSource` uses
 * everywhere else, so two differently-formatted sources for the same repo
 * (`.../repo.git` vs `.../repo`) produce ONE entry, not two.
 */
function distinctSourceRepos(rollouts: readonly Rollout[]): { owner: string; repo: string }[] {
	const seen = new Map<string, { owner: string; repo: string }>();
	for (const r of rollouts) {
		const source = r.status?.source;
		if (!source) continue;
		const parsed = ownerRepoFromSource(source);
		if (!parsed) continue;
		const key = `${parsed.owner}/${parsed.repo}`.toLowerCase();
		if (!seen.has(key)) seen.set(key, parsed);
	}
	return [...seen.values()].sort((a, b) =>
		`${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`)
	);
}

/**
 * ⛔ FIX PASS ITEM 8, 2026-09-10 — DOES THIS REPO'S OWN ROLLOUT DATA KNOW
 * THIS REVISION? Unlike a bare PR number (unresolvable without a network
 * call, whichever repo it turns out to belong to), a SHA is a fact this
 * cluster's own rollouts already carry — `status.availableReleases[]` (every
 * release the registry has published) and `status.history[]` (every release
 * this rollout has actually deployed), same two sources
 * `revision-ledger.ts`'s own `resolveRevision` reads. Prefix-matched, same
 * convention as every other revision lookup in this product (a 7-char sha
 * pasted from a terminal is the common case).
 */
function repoKnowsRevision(rollouts: readonly Rollout[], owner: string, repo: string, sha: string): boolean {
	const needle = sha.toLowerCase();
	for (const r of rollouts) {
		const source = r.status?.source;
		if (!source) continue;
		const parsed = ownerRepoFromSource(source);
		if (!parsed || parsed.owner.toLowerCase() !== owner.toLowerCase() || parsed.repo.toLowerCase() !== repo.toLowerCase()) {
			continue;
		}
		for (const rel of r.status?.availableReleases ?? []) {
			if (rel.revision?.toLowerCase().startsWith(needle)) return true;
		}
		for (const h of r.status?.history ?? []) {
			if (h.version?.revision?.toLowerCase().startsWith(needle)) return true;
		}
	}
	return false;
}

/**
 * Every "open this change" result the current query produces — zero, one (a
 * full reference), or one per distinct cluster repo (a bare `#123` or a bare
 * sha, both ambiguous without a network call). Rendered UNGROUPED, above the
 * first group header — see this module's own doc comment above and
 * `CommandPalette.svelte`'s template.
 */
export function buildChangeRefPaletteResults(
	query: string,
	rollouts: readonly Rollout[]
): PaletteChangeEntry[] {
	const ref = parseChangeRef(query);
	if (!ref) return [];

	if (ref.kind === 'full') {
		return [changeRefEntry(ref.owner, ref.repo, { kind: 'pull', number: ref.number })];
	}

	const repos = distinctSourceRepos(rollouts);
	if (ref.kind === 'bare') {
		return repos.map(({ owner, repo }) =>
			changeRefEntry(owner, repo, { kind: 'pull', number: ref.number })
		);
	}
	// `ref.kind === 'sha'` — ⛔ FIX PASS ITEM 8: narrow to the repos whose OWN
	// rollout data actually knows this revision. When none do (the common
	// case for a sha nobody on this cluster has built — GitHub itself may
	// still know it), fall back to every repo, but the entry says so
	// ("Look up …" rather than "Open change …") so the reader is not told a
	// destination is known to exist when it is only a guess.
	const knownIn = repos.filter(({ owner, repo }) => repoKnowsRevision(rollouts, owner, repo, ref.sha));
	if (knownIn.length > 0) {
		return knownIn.map(({ owner, repo }) => changeRefEntry(owner, repo, { kind: 'sha', sha: ref.sha }));
	}
	return repos.map(({ owner, repo }) => ({
		...changeRefEntry(owner, repo, { kind: 'sha', sha: ref.sha }),
		title: `Look up ${ref.sha} in ${repo}`
	}));
}

/**
 * The static per-pull entries `CommandPalette.svelte` folds into its own
 * `allResults` as kind `change` — ONE ENTRY PER MERGED PULL in the `/mine`
 * cache, independent of the query. `score()` in the component does the
 * actual title matching (a normal substring scorer, same as every other
 * kind) — this function only builds the universe, exactly the role
 * `buildPaletteBuildIndex` plays for builds.
 *
 * MERGED ONLY: the human rejected open PRs on this surface too ("it also
 * doesn't make sense to show open PRs. user is only interested in what they
 * merged").
 */
export function buildMergedChangeIndex(myPulls: readonly MyPull[]): PaletteChangeEntry[] {
	return myPulls
		.filter((p) => p.state === 'merged')
		.map((p) => ({
			key: `change:${p.owner}/${p.repo}:pull:${p.number}`,
			owner: p.owner,
			repo: p.repo,
			ref: { kind: 'pull' as const, number: p.number },
			title: p.title,
			href: changePath(p.owner, p.repo, { kind: 'pull', number: p.number })
		}));
}
