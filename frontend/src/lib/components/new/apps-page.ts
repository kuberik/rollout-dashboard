/**
 * APPS PAGE MODEL (r39 build). Pure: Apps.svelte hands over the apps the Attention section does not claim; this decides the In flight / At rest split and the Attention rollup words.
 * One-app repos come first as ONE headerless grid (the tile is the repo); then each multi-app repo under its header. Both are ordered by their most
 * active app (moving, waiting, at rest) and then by name, as the mock does.
 */
import { needApprovalCount, failedInkParts } from './state-words';
/** The Attention tier of an app by its worst state: a failure live now (0), a recovered failure whose checks are OK again (1), a wait for approval (2), the rest (3). A lead or a person's ability to act only breaks ties inside a tier. */
export const attentionTier = (worst: string, recovered: boolean): number => (worst === 'failed' ? (recovered ? 1 : 0) : worst === 'approval' ? 2 : 3);
/** Apps group by STATE only (owner 2026-11-08; "By repo" is retired): the apps Attention does not claim are In flight (something is moving) or At rest. Each list keeps its caller's order. */
export function groupByState<T extends { group: string }>(apps: readonly T[]): { inFlight: T[]; atRest: T[] } {
	return { inFlight: apps.filter((a) => a.group === 'moving'), atRest: apps.filter((a) => a.group !== 'moving') };
}

/** "3 failing · 3 need approval · 1 yours": what the tiles say, zero parts left out */
export function attentionRollup(c: { failing: number; /** of `failing`, the apps whose checks have all recovered: they read `failed` */ recovered?: number; approval: number; yours: number }): { text: string; ink?: 'danger' | 'held' }[] {
	const rec = Math.min(c.recovered ?? 0, c.failing), live = c.failing - rec;
	return [
		...failedInkParts(live + rec, rec).map((p) => (p.ink === 'danger' ? { text: p.text, ink: 'danger' as const } : { text: p.text })),
		c.approval ? { text: needApprovalCount(c.approval), ink: 'held' as const } : null,
		c.yours ? { text: `${c.yours} yours` } : null
	].filter((x): x is { text: string; ink?: 'danger' | 'held' } => !!x);
}
