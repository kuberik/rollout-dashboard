import { beadRank } from './severity';
/**
 * BEADS (r39 kit parts/envrow.js `bead` / `beadsFor`): a bead is ONE small pill, inside the env-row box a change reached:
 * state mark · #ref (two refs when a group has <= 2, else "#43 +2"; compact: mark · count). Same-state changes merge into one
 * bead; a change that needs the viewer (failed, approval-yours) stays alone so it can be found. Pure; drawn by ChangeDot's
 * `bead` mode.
 */
export type BeadState = 'failed' | 'approval-yours' | 'approval' | 'held' | 'deploying' | 'checking' | 'landed';

export type BeadChange = { ref: string; title?: string; state: BeadState; href?: string; key?: string; /** the change's apps have no releases (no source, or an empty catalogue): the state word; it will not be promoted past the place it is in */ noReleases?: string };
export type Bead = {
	state: BeadState;
	/** refs printed (<= 2 uncompacted, 1 otherwise) */
	refs: string[];
	/** the "+N" remainder, or 0 */
	more: number;
	/** compact + group > 1: the count replaces the refs */
	count: number | null;
	href?: string;
	title: string;
	/** kit class: `failed` | `yours` | '' (team views show no personal emphasis) */
	emphasis: '' | 'failed' | 'yours';
	changes: BeadChange[];
};

/** worst first: `severity.ts`'s one order, the approval the viewer can give first among approvals */
const SEV = (s: BeadState): number => beadRank(s);

export function beadOf(changes: BeadChange[], { team = false, compact = false } = {}): Bead {
	const s = changes[0].state;
	const show = compact || changes.length > 2 ? 1 : 2;
	const grouped = compact && changes.length > 1;
	return {
		state: s,
		refs: grouped ? [] : changes.slice(0, show).map((c) => c.ref),
		more: grouped ? 0 : Math.max(0, changes.length - show),
		count: grouped ? changes.length : null,
		href: changes[0].href,
		title: changes.map((c) => `${c.ref} ${c.title ?? ''}`.trim()).join('\n\n'),
		emphasis: !team && s === 'failed' ? 'failed' : !team && s === 'approval-yours' ? 'yours' : '',
		changes
	};
}

/** A box's beads: worst first; failed / approval-yours changes stay alone (unless `team`), the rest merge by state. */
export function beadsFor(changes: BeadChange[], o: { team?: boolean; compact?: boolean } = {}): Bead[] {
	if (!changes.length) return [];
	const groups = new Map<string, BeadChange[]>();
	[...changes]
		.sort((a, b) => SEV(a.state) - SEV(b.state))
		.forEach((c) => {
			const k = !o.team && (c.state === 'failed' || c.state === 'approval-yours') ? 'k' + (c.key ?? c.ref) : c.state;
			groups.set(k, [...(groups.get(k) ?? []), c]);
		});
	return [...groups.values()].map((xs) => beadOf(xs, o));
}
