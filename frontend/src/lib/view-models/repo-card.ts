/**
 * REPO CARD MODEL (r39 kit parts/repocard.js `repoRow` / `countParts`). A repo's in-flight changes drawn on ONE environment row:
 * a cell per tier the repo's apps reach (plus a leading "merged" cell for changes not deployed anywhere yet), the changes as beads
 * inside the cell they reached; "N landed" ends the row. Pure: callers hand over changes with their column; this decides the
 * cells, the beads (bead.ts) and the rollup words. Placement truth: a change sits in the column its own data says (`col`).
 */
import { beadsFor, type Bead, type BeadChange } from './bead';
import { beadRank } from './severity';
import { TIERS as TIER_LIST } from '$lib/view-models/sites-waves';

export const REPO_TIERS = TIER_LIST;
export type RepoChange = BeadChange & { /** 'merged' or a tier */ col: string };
export type RepoCell = { tier: string; label: string; beads: Bead[] };
export type RollupPart = { text: string; ink: 'danger' | 'held' | 'subtle' };
export type RepoCardModel = { /** the apps this repo's changes deploy (empty or one = nothing to say); the card names them when there are several */ apps?: string[]; repo: string; cells: RepoCell[]; landed: number; landedTitle: string; rollup: RollupPart[]; worst: number };

/** a bead state's rank: `severity.ts`'s one order */
const SEV = (s: string): number => beadRank(s);

/** adverse first; landed is excluded (the row's end says it). Only failing takes ink, and "waiting" takes held ink when one is yours. */
export function rollupParts(changes: readonly { state: string; noReleases?: string }[]): RollupPart[] {
	const n = (...ks: string[]) => changes.filter((c) => ks.includes(c.state)).length;
	const failed = n('failed'), wait = n('approval', 'approval-yours', 'held'), mov = changes.filter((c) => !c.noReleases && ['deploying', 'checking'].includes(c.state)).length, stuck = changes.filter((c) => c.noReleases && ['deploying', 'checking'].includes(c.state)).length;
	return [
		failed ? { text: `${failed} failing`, ink: 'danger' as const } : null,
		wait ? { text: `${wait} waiting`, ink: n('approval-yours') ? ('held' as const) : ('subtle' as const) } : null,
		mov ? { text: `${mov} moving`, ink: 'subtle' as const } : null,
		/* no releases: nothing will carry it on, so it is not "moving" */
		stuck ? { text: changes.find((c) => c.noReleases)!.noReleases!.toLowerCase(), ink: 'subtle' as const } : null
	].filter((x): x is RollupPart => !!x);
}

export function repoCardModel(i: { repo: string; changes: RepoChange[]; tiers?: readonly string[]; landed?: { ref: string; title?: string }[]; team?: boolean; compact?: boolean }): RepoCardModel {
	const fly = i.changes.filter((c) => c.state !== 'landed');
	const tiers = (i.tiers ?? REPO_TIERS.filter((t) => fly.some((c) => c.col === t)));
	const cols = [...(fly.some((c) => c.col === 'merged') ? ['merged'] : []), ...tiers];
	const cells = cols.map((t) => ({ tier: t, label: t === 'merged' ? 'released' : t, beads: beadsFor(fly.filter((c) => c.col === t), { team: i.team, compact: i.compact }) }));
	const landed = i.landed ?? [];
	return {
		repo: i.repo,
		cells,
		landed: landed.length,
		landedTitle: landed.map((l) => `${l.ref} ${l.title ?? ''}`.trim()).join('\n'),
		rollup: rollupParts(fly),
		worst: Math.min(SEV('none'), ...fly.map((c) => SEV(c.state)))
	};
}
