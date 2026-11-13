import type { FamilyProgressStep } from './changes';
/**
 * WAVE MARK aggregation (strip-dots, owner 2026-11-12: "just dots ... waves get an icon (it can be even mixed pie per sites)").
 * The environment strip draws ONE mark per wave (one per tier when the tier has no waves). A wave whose sites share a state is a
 * plain dot in that state's colour; a wave in mixed states is a pie split by the share of sites in each state. Pure: the slice
 * order is fixed by KIND_ORDER (never by site order), so the same sites always draw the same pie.
 */
export type MarkSiteState = 'done' | 'checking' | 'deploying' | 'held' | 'approval' | 'approval-yours' | 'failed' | 'stuck' | 'notreached' | 'notaffected';
/** `approval-yours` is an approval the VIEWER can give: the same orange as `approval`, drawn with a ring (state-tone.ts `ring`). */
/** the kinds that get their own colour: approval folds into held (both are the held orange) */
export type MarkKind = 'done' | 'checking' | 'deploying' | 'held' | 'stuck' | 'failed' | 'notreached' | 'notaffected';

export const KIND_ORDER: MarkKind[] = ['done', 'checking', 'deploying', 'held', 'stuck', 'failed', 'notreached', 'notaffected'];
const NOUN: Record<MarkKind, string> = {
	done: 'deployed',
	checking: 'checking',
	deploying: 'deploying',
	held: 'held',
	stuck: 'stuck',
	failed: 'failed',
	notreached: 'not reached',
	notaffected: 'not affected'
};
/** the slice that is in motion (the only part of a mark that ever animates) */
export const ANIMATED: ReadonlySet<MarkKind> = new Set<MarkKind>(['checking', 'deploying']);

export type WaveSlice = { kind: MarkKind; count: number; share: number; from: number; to: number };
export type WaveMark = { slices: WaveSlice[]; mixed: boolean; label: string; /** some site is an approval the viewer can give: the mark carries the viewer's ring */ yours: boolean };

export const kindOf = (s: MarkSiteState): MarkKind => (s === 'approval' || s === 'approval-yours' ? 'held' : s);

/** `prefix`: "Wave 1" or the tier name. The label sums the sites: "Wave 1: 1 deployed, 1 checking". */
export function waveMark(sites: { state: MarkSiteState }[], prefix = ''): WaveMark {
	const n = sites.length;
	const counts = new Map<MarkKind, number>();
	for (const s of sites) counts.set(kindOf(s.state), (counts.get(kindOf(s.state)) ?? 0) + 1);
	let at = 0;
	const slices: WaveSlice[] = [];
	for (const kind of KIND_ORDER) {
		const count = counts.get(kind);
		if (!count) continue;
		const share = count / n;
		slices.push({ kind, count, share, from: at, to: at + share });
		at += share;
	}
	const sum = slices.map((s) => `${s.count} ${NOUN[s.kind]}`).join(', ');
	const yours = sites.some((x) => x.state === 'approval-yours');
	return { slices, mixed: slices.length > 1, label: (prefix ? prefix + ': ' : '') + (sum || 'no sites') + (yours ? ' (you can approve)' : ''), yours };
}

/** SVG path of one pie slice (fractions of a turn, clockwise from 12 o'clock) in a box centred on (cx, cy). A full turn is a circle. */
export function slicePath(from: number, to: number, r: number, cx = 8, cy = 8): string {
	if (to - from >= 0.9999) return `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}Z`;
	const pt = (t: number) => `${(cx + r * Math.sin(t * 2 * Math.PI)).toFixed(3)} ${(cy - r * Math.cos(t * 2 * Math.PI)).toFixed(3)}`;
	return `M${cx} ${cy}L${pt(from)}A${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${pt(to)}Z`;
}

/**
 * A change's per-family step (the command palette's change row: DEV · STG · PRD) as the strip's own sites, so ⌘K draws the SAME
 * dots and pies as the page it opens (2026-11-13; the 8px family meter and `ChangeDot` step mode are gone). Live and complete = a
 * dot; partly live = a pie of live and not-reached; resolved (rolled back) and queued = the not-reached ring; stuck = held;
 * active = checking for baking / retrying, else deploying.
 */
export function familySites(step: Pick<FamilyProgressStep, 'tone' | 'state' | 'resolved' | 'builtCount' | 'liveCount'>): { state: MarkSiteState }[] {
	if (step.resolved) return [{ state: 'notreached' }];
	switch (step.tone) {
		case 'live':
			return step.liveCount < step.builtCount
				? [...Array(step.liveCount).fill({ state: 'done' as const }), ...Array(step.builtCount - step.liveCount).fill({ state: 'notreached' as const })]
				: [{ state: 'done' }];
		case 'failed':
			return [{ state: 'failed' }];
		case 'stuck':
			return [{ state: 'held' }];
		case 'queued':
		case 'none':
			return [{ state: 'notreached' }];
		default:
			return [{ state: step.state === 'baking' || step.state === 'retrying' ? 'checking' : 'deploying' }];
	}
}
