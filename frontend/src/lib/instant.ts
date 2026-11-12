/**
 * ONE rule for ordering instants (ISO-8601 / RFC 3339 timestamp strings).
 *
 * Why it exists: comparing the STRINGS (`localeCompare`, `<`, `.sort()`) is only right while every value has the same offset and the same fractional-second
 * width. "2026-11-12T10:00:00+02:00" is EARLIER than "2026-11-12T09:30:00Z" by the clock and LATER by the string; "…:00.5Z" sorts before "…:00Z" as text
 * and after it in time. So every surface that orders, picks the oldest/newest of, or compares timestamps goes through these, which parse with `Date.parse`.
 *
 * Missing (null / undefined / '') and unparseable values are "no instant": they sort LAST in both directions (never first, never NaN-poisoning a sort),
 * and lose to any real instant in `earliest` / `latest`. Two missing values compare equal, so a stable sort keeps their order.
 */
type Instant = string | null | undefined;

/** Epoch ms of an ISO timestamp, or null when it is missing or unparseable. */
export function instantMs(s: Instant): number | null {
	if (!s) return null;
	const ms = Date.parse(s);
	return Number.isNaN(ms) ? null : ms;
}

function byInstant(a: Instant, b: Instant, dir: 1 | -1): number {
	const x = instantMs(a), y = instantMs(b);
	if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
	return x === y ? 0 : (x < y ? -1 : 1) * dir;
}
/** Sort comparator: earliest first, missing last. */
export const oldestFirst = (a: Instant, b: Instant): number => byInstant(a, b, 1);
/** Sort comparator: latest first, missing last. */
export const newestFirst = (a: Instant, b: Instant): number => byInstant(a, b, -1);

/** The earliest of several timestamps (the original string, not re-formatted). Unparseable ones lose to parseable ones; null only when there is nothing at all. */
export function earliest(clocks: Instant[]): string | null {
	let best: string | null = null, bestMs = Infinity;
	for (const c of clocks) { const ms = instantMs(c); if (ms !== null && ms < bestMs) { best = c!; bestMs = ms; } }
	return best ?? clocks.find((c): c is string => !!c) ?? null;
}
/** The latest of several timestamps; same missing/unparseable rules as `earliest`. */
export function latest(clocks: Instant[]): string | null {
	let best: string | null = null, bestMs = -Infinity;
	for (const c of clocks) { const ms = instantMs(c); if (ms !== null && ms > bestMs) { best = c!; bestMs = ms; } }
	return best ?? clocks.find((c): c is string => !!c) ?? null;
}
/** true when `a` is strictly later than `b` as instants; false when either is missing or unparseable. */
export function isLater(a: Instant, b: Instant): boolean {
	const x = instantMs(a), y = instantMs(b);
	return x !== null && y !== null && x > y;
}
/** true when `a` is the same instant as `b` or later; false when either is missing or unparseable. */
export function isNotEarlier(a: Instant, b: Instant): boolean {
	const x = instantMs(a), y = instantMs(b);
	return x !== null && y !== null && x >= y;
}
