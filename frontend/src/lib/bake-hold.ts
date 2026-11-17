import { parseGoDuration } from '$lib/utils';

/**
 * The bake clock stops while a selected health check is not Healthy. The
 * controller records that on the history entry:
 *  - `bakeHoldStartTime`: set while the clock is stopped right now;
 *  - `bakeHeldDuration`: total stopped time, excluding the current hold.
 * Both are optional (older controllers never write them), so every reader of
 * "how far into the bake are we" goes through here and absent fields mean 0.
 */
export type BakeHoldFields = {
	bakeHoldStartTime?: string | null;
	bakeHeldDuration?: string | null;
};

/** Is the bake clock stopped right now? */
export function bakePaused(e: BakeHoldFields | null | undefined): boolean {
	return !!e?.bakeHoldStartTime && Number.isFinite(Date.parse(e.bakeHoldStartTime));
}

/** Total time the bake clock has not counted: past holds plus the current one. */
export function bakeHeldMs(e: BakeHoldFields | null | undefined, now: Date, until?: Date): number {
	if (!e) return 0;
	let held = e.bakeHeldDuration ? parseGoDuration(e.bakeHeldDuration) : 0;
	if (bakePaused(e)) {
		const from = Date.parse(e.bakeHoldStartTime as string);
		held += Math.max(0, (until ?? now).getTime() - from);
	}
	return held;
}

/** Bake time that has counted: `now - start - held`, never negative. NaN start gives 0. */
export function bakeElapsedMs(
	e: (BakeHoldFields & { bakeStartTime?: string | null }) | null | undefined,
	now: Date
): number {
	if (!e?.bakeStartTime) return 0;
	const start = Date.parse(e.bakeStartTime);
	if (!Number.isFinite(start)) return 0;
	return Math.max(0, now.getTime() - start - bakeHeldMs(e, now));
}
