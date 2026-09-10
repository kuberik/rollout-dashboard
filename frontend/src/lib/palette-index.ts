import type { Rollout, Environment } from '../types';
import { buildRevisionLedger, type RevisionRow } from '$lib/view-models/revision-ledger';
import { revisionPath } from '$lib/version-utils';
import { parsePrRef, prPath } from '$lib/pr-ref';

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
				href: revisionPath(ledger.repoKey, row.revision)
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
 * ⌘K'S PR RESULT KIND. A pasted PR URL or `owner/repo#123` names exactly one
 * PR — one result. A bare `#123` names a number that exists in nearly every
 * repository at once, so this fans it out to one candidate per DISTINCT
 * repo any rollout on this cluster deploys, rather than guessing which one
 * the reader meant. No network call: this is client-side, off the same
 * `rollouts` list every other result kind already reads.
 */
export type PalettePrEntry = {
	key: string;
	owner: string;
	repo: string;
	number: number;
	title: string;
	href: string;
};

// `https://github.com/owner/repo(.git)?`, `github.com/owner/repo`, or the
// ssh form `git@github.com:owner/repo.git` — the shapes `status.source`
// (an OCI-annotation-derived repo URL) actually arrives in. Owner/repo are
// captured VERBATIM (display casing), never lower-cased — that is
// `repoKeyFromSource`'s job, used here only to DEDUPE, not to print.
const SOURCE_OWNER_REPO = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

function ownerRepoFromSource(source: string): { owner: string; repo: string } | null {
	const m = source.match(SOURCE_OWNER_REPO);
	if (!m) return null;
	return { owner: m[1], repo: m[2] };
}

function prEntry(owner: string, repo: string, number: number): PalettePrEntry {
	return {
		key: `pr:${owner}/${repo}#${number}`,
		owner,
		repo,
		number,
		title: `Open PR #${number} · ${owner}/${repo}`,
		href: prPath(owner, repo, number)
	};
}

/**
 * Every PR result the current query produces — zero, one (a full reference),
 * or one per distinct cluster repo (a bare `#123`). `rollouts` supplies the
 * distinct-repo list for the bare case; unused for a full reference, which
 * needs no cluster data to resolve.
 */
export function buildPrPaletteResults(query: string, rollouts: readonly Rollout[]): PalettePrEntry[] {
	const ref = parsePrRef(query);
	if (!ref) return [];

	if (ref.kind === 'full') {
		return [prEntry(ref.owner, ref.repo, ref.number)];
	}

	// Bare `#n` — one candidate per distinct repo, deduped by the SAME
	// normalised identity `version-utils.ts`'s `repoKeyFromSource` uses
	// everywhere else, so two differently-formatted sources for the same
	// repo (`.../repo.git` vs `.../repo`) produce ONE result, not two.
	const seen = new Map<string, { owner: string; repo: string }>();
	for (const r of rollouts) {
		const source = r.status?.source;
		if (!source) continue;
		const parsed = ownerRepoFromSource(source);
		if (!parsed) continue;
		const key = `${parsed.owner}/${parsed.repo}`.toLowerCase();
		if (!seen.has(key)) seen.set(key, parsed);
	}
	return [...seen.values()]
		.sort((a, b) => `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`))
		.map(({ owner, repo }) => prEntry(owner, repo, ref.number));
}
