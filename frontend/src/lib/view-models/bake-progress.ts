import { parseGoDuration } from '$lib/utils';
import { bakeElapsedMs, bakePaused, type BakeHoldFields } from '$lib/bake-hold';

/**
 * Bake progress. `hold` is the history entry (or just its hold fields): time the
 * clock was stopped by a not-Healthy check does not count, and `paused` is true
 * while it is stopped now.
 */
export function computeBakeProgress(
	bakeStartTime: string | undefined,
	bakeTime: string | undefined,
	now: Date,
	hold?: BakeHoldFields | null
): { elapsedMs: number; totalMs: number; fraction: number; paused: boolean } | null {
	if (!bakeStartTime || !bakeTime) return null;
	const totalMs = parseGoDuration(bakeTime);
	if (!totalMs || totalMs <= 0) return null;
	if (Number.isNaN(new Date(bakeStartTime).getTime())) return null;
	const elapsedMs = bakeElapsedMs({ ...hold, bakeStartTime }, now);
	const fraction = Math.min(1, elapsedMs / totalMs);
	return { elapsedMs, totalMs, fraction, paused: bakePaused(hold) };
}
