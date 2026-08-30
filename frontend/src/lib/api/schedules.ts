/**
 * WHEN DOES A BLOCKING GATE CLEAR?
 *
 * The rollout detail page — the page the human calls beautiful — says
 * *"Will be allowed in 1d 3h (8/31/2026, 1:00:00 PM)"*. The revision pages knew
 * the environment and the exact gate names and printed neither: a live UX
 * critique found `waiting on ghd-p2fld, schedule-gate-nwm62` rendered as raw
 * object names with no type, no owner and no clear time.
 *
 * The type is already derivable with no request at all — `promotionBlock`
 * splits gates structurally into `awaitingApprovalGates` (published an
 * allow-list, only a person changes it) and `notPassingGates` (no allow-list,
 * clears on its own). This module supplies the missing half: WHEN the
 * self-clearing kind clears.
 *
 * IT IS THE SAME ENDPOINT AND THE SAME ARITHMETIC `ScheduleStatus.svelte`
 * ALREADY RUNS — `blocked` is its `isBlocked` predicate and `nextTransition` is
 * its `nextChange` reduction, lifted out so two surfaces cannot disagree about
 * when a window opens. `ScheduleStatus` renders a Popover and an `AlertPanel`;
 * the revision pages need the fact, not the furniture.
 *
 * READ-ONLY. Nothing here mutates anything.
 */

type ScheduleLike = {
	metadata?: { name?: string; annotations?: Record<string, string> };
	spec?: { action?: 'Allow' | 'Deny' };
	status?: { active?: boolean; nextTransition?: string };
};

export type ScheduleWindow = {
	/** True when at least one schedule is currently refusing deployments. */
	blocked: boolean;
	/** Earliest moment any schedule changes state, ISO. null when unknown. */
	nextTransition: string | null;
	/**
	 * The blocking schedules' HUMAN names — `gate.kuberik.com/pretty-name` when
	 * the object publishes one, the object name otherwise. A generated name
	 * like `schedule-gate-nwm62` identifies nothing to a reader; `Business
	 * Hours Only` does, and it is a field the cluster already carries.
	 */
	names: string[];
};

export const EMPTY_WINDOW: ScheduleWindow = { blocked: false, nextTransition: null, names: [] };

export const scheduleWindowQueryKey = (namespace: string, name: string, cluster?: string) =>
	['rollout-schedule-window', namespace, name, cluster ?? ''] as const;

function isBlocking(s: ScheduleLike): boolean {
	const active = s.status?.active === true;
	const action = s.spec?.action;
	return (action === 'Allow' && !active) || (action === 'Deny' && active);
}

function prettyName(s: ScheduleLike): string {
	return (
		s.metadata?.annotations?.['gate.kuberik.com/pretty-name'] || s.metadata?.name || 'schedule'
	);
}

export async function fetchScheduleWindow(
	namespace: string,
	name: string,
	cluster?: string
): Promise<ScheduleWindow> {
	const params = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
	const res = await fetch(`/api/rollouts/${namespace}/${name}/schedules${params}`);
	if (!res.ok) throw new Error(`schedules ${res.status}`);
	const data = await res.json();
	const all: ScheduleLike[] = [
		...(data?.rolloutSchedules?.items ?? []),
		...(data?.clusterRolloutSchedules?.items ?? [])
	];

	const blocking = all.filter(isBlocking);

	let earliest: number | null = null;
	for (const s of all) {
		const t = s.status?.nextTransition ? new Date(s.status.nextTransition).getTime() : NaN;
		if (Number.isFinite(t) && (earliest === null || t < earliest)) earliest = t;
	}

	return {
		blocked: blocking.length > 0,
		nextTransition: earliest === null ? null : new Date(earliest).toISOString(),
		names: [...new Set(blocking.map(prettyName))].sort()
	};
}

/**
 * `1d 3h` — the rollout detail page's own wording, so a reader who has seen it
 * there reads the same string here. Returns null once the moment has passed
 * rather than counting backwards, because "in −4h" is not a fact about a gate.
 */
export function formatTimeUntil(iso: string, now: Date = new Date()): string | null {
	const diff = new Date(iso).getTime() - now.getTime();
	if (!Number.isFinite(diff)) return null;
	if (diff <= 0) return null;
	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	return `${minutes}m`;
}
