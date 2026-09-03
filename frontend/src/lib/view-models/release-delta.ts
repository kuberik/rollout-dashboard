/**
 * ⭐ "SAME COMMIT" IS NOT THE SAME RELEASE. (operator walk, 2026-09-03)
 *
 * Two release candidates can point at the identical git revision — a
 * re-published OCI artifact with no source change — while still asking
 * something different of the fleet: `rel-66` and `rel-67` shared one commit
 * but moved `requires.api` from `^1.66.0` to `^1.67.0`. `ChangeVersionModal`
 * printed `No commit changes detected between versions.` for that pick,
 * which is TRUE of the source tree and FALSE of the deploy's actual
 * requirements — the reader would have picked it believing nothing changed.
 *
 * The data already exists on both `VersionInfo` objects
 * (`releaseRequires`, `../../types/rollout-dependency-types.ts`), served on
 * every entry of `status.availableReleases[]`. This is the join.
 */

import { releaseRequires } from '../../types';

export type RequirementChange = {
	contract: string;
	kind: 'changed' | 'added' | 'removed';
	/** Present for `changed` and `removed`. */
	from?: string;
	/** Present for `changed` and `added`. */
	to?: string;
};

/**
 * `from`/`to` are the two releases' own `VersionInfo` objects (or anything
 * `releaseRequires` can read) — typed `unknown` for the same reason
 * `releaseRequires` is: the generated `Rollout` type predates this field.
 */
export function requirementsDelta(from: unknown, to: unknown): RequirementChange[] {
	const a = releaseRequires(from) ?? {};
	const b = releaseRequires(to) ?? {};
	const contracts = new Set([...Object.keys(a), ...Object.keys(b)]);
	const changes: RequirementChange[] = [];
	for (const contract of [...contracts].sort()) {
		const av = a[contract];
		const bv = b[contract];
		if (av === bv) continue;
		if (av !== undefined && bv !== undefined) {
			changes.push({ contract, kind: 'changed', from: av, to: bv });
		} else if (bv !== undefined) {
			changes.push({ contract, kind: 'added', to: bv });
		} else if (av !== undefined) {
			changes.push({ contract, kind: 'removed', from: av });
		}
	}
	return changes;
}

function clause(c: RequirementChange): string {
	if (c.kind === 'changed') return `${c.contract} ${c.from} → ${c.to}`;
	if (c.kind === 'added') return `${c.contract} ${c.to} (new)`;
	return `${c.contract} ${c.from} (removed)`;
}

/**
 * The sentence for the "these two releases share a commit" branch of
 * `ChangeVersionModal`'s changelist. `null` when there is nothing to say —
 * a caller falls back to the plain "No commit changes" sentence.
 */
export function requirementsChangedSentence(
	currentDisplayVersion: string,
	from: unknown,
	to: unknown
): string | null {
	const changes = requirementsDelta(from, to);
	if (changes.length === 0) return null;
	return `Same commit as ${currentDisplayVersion}. What changed: requires ${changes.map(clause).join(', ')}.`;
}
