// Parses Go-style durations ("30m", "1h30m", "45s") into milliseconds.
// Returns null for anything unparseable. Mirrors the local parseGoDuration
// implementation in ControlCenter.svelte — kept local here rather than
// importing from `$lib/utils` because no such export exists there (see
// task-1-report.md for details).
function parseGoDuration(d: string | undefined | null): number | null {
	if (!d) return null;
	const re = /(\d+(?:\.\d+)?)(h|m|s)/g;
	let total = 0;
	let matched = false;
	let m: RegExpExecArray | null;
	while ((m = re.exec(d))) {
		matched = true;
		const n = parseFloat(m[1]);
		if (m[2] === 'h') total += n * 3600000;
		else if (m[2] === 'm') total += n * 60000;
		else total += n * 1000;
	}
	return matched ? total : null;
}

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
