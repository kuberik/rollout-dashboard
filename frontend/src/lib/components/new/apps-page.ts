/**
 * APPS PAGE MODEL (r39 build). Pure: Apps.svelte hands over the apps the Attention section does not claim; this decides the In flight / At rest split and the Attention rollup words.
 * One-app repos come first as ONE headerless grid (the tile is the repo); then each multi-app repo under its header. Both are ordered by their most
 * active app (moving, waiting, at rest) and then by name, as the mock does.
 */
import { needApprovalCount } from './state-words';
/** Apps group by STATE only (owner 2026-11-08; "By repo" is retired): the apps Attention does not claim are In flight (something is moving) or At rest. Each list keeps its caller's order. */
export function groupByState<T extends { group: string }>(apps: readonly T[]): { inFlight: T[]; atRest: T[] } {
	return { inFlight: apps.filter((a) => a.group === 'moving'), atRest: apps.filter((a) => a.group !== 'moving') };
}

/** "3 failing · 3 need approval · 1 yours": what the tiles say, zero parts left out */
export function attentionRollup(c: { failing: number; approval: number; yours: number }): { text: string; ink?: 'danger' | 'held' }[] {
	return [
		c.failing ? { text: `${c.failing} failing`, ink: 'danger' as const } : null,
		c.approval ? { text: needApprovalCount(c.approval), ink: 'held' as const } : null,
		c.yours ? { text: `${c.yours} yours` } : null
	].filter((x): x is { text: string; ink?: 'danger' | 'held' } => !!x);
}
