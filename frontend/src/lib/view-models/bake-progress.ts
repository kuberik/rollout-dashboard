import { parseGoDuration } from '$lib/utils';

export function computeBakeProgress(
	bakeStartTime: string | undefined,
	bakeTime: string | undefined,
	now: Date
): { elapsedMs: number; totalMs: number; fraction: number } | null {
	if (!bakeStartTime || !bakeTime) return null;
	const totalMs = parseGoDuration(bakeTime);
	if (!totalMs || totalMs <= 0) return null;
	const start = new Date(bakeStartTime).getTime();
	if (Number.isNaN(start)) return null;
	const elapsedMs = Math.max(0, now.getTime() - start);
	const fraction = Math.min(1, elapsedMs / totalMs);
	return { elapsedMs, totalMs, fraction };
}
