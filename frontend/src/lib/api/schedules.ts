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

import { apiJson } from './errors';
import { apiPath } from './urls';

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
	const data = await apiJson<{
		rolloutSchedules?: { items?: ScheduleLike[] };
		clusterRolloutSchedules?: { items?: ScheduleLike[] };
	}>(apiPath(cluster, `/rollouts/${namespace}/${name}/schedules`));
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

/**
 * ⭐ THE ABSOLUTE INSTANT, IN THE SCHEDULE'S OWN ZONE — NOT THE BROWSER'S.
 * (P2, operator-walk finding) `clearsAt` used to reach the screen as
 * `new Date(iso).toLocaleString()` or `.toLocaleTimeString([], {...})` —
 * both silently defer to whatever timezone the READER's machine happens to
 * be in, print in US date order, and (the `toLocaleString()` form) carry
 * seconds nobody asked for on a schedule boundary. Measured live: a rule
 * whose own label says `9 AM - 5 PM EST` reopened at `(9/3/2026, 1:00:00
 * PM)` with no zone printed at all — a reader in any OTHER zone has no way
 * to tell whose 1:00 PM that is, and `EST` in September is itself wrong
 * (the US is on daylight time) — the schedule's OWN `spec.timezone` (an
 * IANA name, `America/New_York`) is authoritative and is what this
 * formats against, never a hand-typed abbreviation.
 *
 * 24-hour, no AM/PM ambiguity, no seconds: `09:00 America/New_York (13:00
 * UTC)`. The UTC figure rides along unconditionally — it is the one
 * reading every reader can convert from without knowing the IANA name's
 * own offset — and is dropped only when the schedule's zone already IS
 * UTC, where repeating it would say the same clock time twice.
 */
export function formatAbsoluteReopen(iso: string, timezone: string | null | undefined): string {
	const target = new Date(iso);
	if (Number.isNaN(target.getTime())) return '';
	const zone = timezone && timezone.trim() ? timezone : null;
	const clock = (tz: string) =>
		target.toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: tz
		});
	if (!zone || zone === 'UTC') return `${clock('UTC')} UTC`;
	return `${clock(zone)} ${zone} (${clock('UTC')} UTC)`;
}

/**
 * `reopens in 7h 21m — 09:00 America/New_York (13:00 UTC)` — the relative
 * figure LEADS (it is the number a reader actually acts on) and the
 * absolute clock trails it, joined by an em dash rather than parentheses:
 * this pass's own finding is that a parenthetical absolute time reads as a
 * footnote nobody has to check, when it is the one thing that disambiguates
 * WHOSE clock the relative figure is counting down on. Returns just the
 * absolute form once the countdown has expired (`formatTimeUntil` false),
 * so a caller never has to special-case "the moment has passed."
 */
export function formatReopensAt(
	iso: string,
	timezone: string | null | undefined,
	now: Date = new Date()
): string {
	const until = formatTimeUntil(iso, now);
	const absolute = formatAbsoluteReopen(iso, timezone);
	return until ? `reopens in ${until} — ${absolute}` : `reopens ${absolute}`;
}

/**
 * The RAW schedule objects for one rollout.
 *
 * `fetchScheduleWindow` reduces to a page-level "is anything closed, and when
 * does the earliest one open" — which is the right shape for a banner about a
 * whole page and the WRONG shape for attributing ONE gate. A card that says
 * `schedule-gate-nwm62` needs that gate's own schedule: its pretty name and its
 * own `nextTransition`. The join is published — `RolloutSchedule.status
 * .managedGates` lists the gates a schedule owns — and `withSchedules` in
 * `view-models/blocking-story` consumes exactly this shape.
 *
 * Same endpoint, same request, so nothing here can disagree with the window.
 * READ-ONLY.
 */
export type ScheduleObject = {
	metadata?: { name?: string; annotations?: Record<string, string> };
	spec?: { action?: 'Allow' | 'Deny' };
	status?: { active?: boolean; nextTransition?: string; managedGates?: string[] };
};

export async function fetchScheduleObjects(
	namespace: string,
	name: string,
	cluster?: string
): Promise<ScheduleObject[]> {
	const data = await apiJson<{
		rolloutSchedules?: { items?: ScheduleObject[] };
		clusterRolloutSchedules?: { items?: ScheduleObject[] };
	}>(apiPath(cluster, `/rollouts/${namespace}/${name}/schedules`));
	return [...(data?.rolloutSchedules?.items ?? []), ...(data?.clusterRolloutSchedules?.items ?? [])];
}

/**
 * ⭐ THE BULK FORM, FOR A GRAPH OF MANY ROLLOUTS. (2026-09-03, operator-walk
 * finding B1)
 *
 * `fetchScheduleObjects` above is scoped to ONE rollout and is what
 * `ScheduleStatus`/rollout detail already call. `/dependencies` and the
 * rollout `Dependencies` tab classify gates for an entire NETWORK of
 * rollouts across many namespaces, and were calling `buildGateContext` with
 * no schedule join at all — so a `RolloutSchedule`-owned gate had no
 * `ctx.schedule` entry, `classifyGate` fell through to the last, most
 * pessimistic branch (`clears: 'check'`, `short: 'A check is not passing'`),
 * and a schedule holding a rollout printed the SAME sentence a genuinely
 * failing health check does — while the same rollout's own Overview
 * correctly named the window (`Business Hours Only — reopens 1:00 PM`).
 *
 * `GET /api/schedules?namespace=all` (a bulk, ALL-namespaces list — see
 * `main.go`) is the one request per CLUSTER that makes the join possible
 * without an N-rollout fan-out of the single-rollout endpoint. One call per
 * cluster the fleet actually uses (typically 1–2, never N).
 */
export type NetworkScheduleObject = {
	metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
	spec?: { action?: 'Allow' | 'Deny' };
	status?: { active?: boolean; nextTransition?: string; managedGates?: string[] };
};

export type NetworkSchedules = {
	rolloutSchedules?: { items?: NetworkScheduleObject[] } | null;
	clusterRolloutSchedules?: { items?: NetworkScheduleObject[] } | null;
};

/**
 * One request per cluster name given (`''` = the local/hub cluster — `apiPath`
 * treats a falsy cluster the same as every other call site in this product).
 * Failures degrade to an empty result for that cluster rather than rejecting
 * the whole call — a
 * spoke that cannot be reached should not blank out every OTHER cluster's
 * schedule join, and `classifyGate` already has an honest `unknown`/`check`
 * fallback for gates it ends up with no schedule join for.
 */
export async function fetchNetworkSchedules(
	clusters: string[]
): Promise<Map<string, NetworkSchedules>> {
	const names = [...new Set(clusters)];
	const results = await Promise.all(
		names.map(async (cluster) => {
			try {
				return await apiJson<NetworkSchedules>(apiPath(cluster, '/schedules?namespace=all'));
			} catch {
				return { rolloutSchedules: { items: [] }, clusterRolloutSchedules: { items: [] } };
			}
		})
	);
	return new Map(names.map((cluster, i) => [cluster, results[i]]));
}
