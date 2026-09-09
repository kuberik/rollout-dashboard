import type { Rollout, Environment } from '../types';
import { buildRevisionLedger, type RevisionRow } from '$lib/view-models/revision-ledger';
import { revisionPath } from '$lib/version-utils';

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
		for (const [i, row] of rows.entries()) {
			out.push({
				// ⛔ `repoKey:revision` alone is NOT unique — round 4a's "one row
				// per RELEASE" split means a rollback can produce two
				// `RevisionRow`s that share one revision (rel-66/rel-67 of the
				// same commit, under different tags/labels). Measured live:
				// `{#each ... (result.key)}` threw `each_key_duplicate` on
				// `9f10e494d560...` the moment a repo with a rollback reached
				// this index, which froze the WHOLE palette's reactivity
				// mid-keystroke (query kept advancing in the DOM input, but
				// every derived list downstream stopped updating). The row's
				// own index in `rows` is always unique per repo.
				key: `build:${ledger.repoKey}:${row.revision}:${i}`,
				revision: row.revision,
				short: row.short,
				labels: row.labelGroups.map((g) => g.label),
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
