/**
 * Formatting helpers for the reader's display timezone. The preference itself
 * (Local / UTC, the navbar toggle) lives in `./timezone.svelte`; these are pure
 * functions over it, kept out of the `.svelte.ts` module so they can build
 * plain `Date`s without tripping `svelte/prefer-svelte-reactivity`.
 */
import { displayTimeZone, timeZonePreference } from './timezone.svelte';

/**
 * ⭐ THE ONE CLOCK-TIME FORMATTER. (2026-10-08, D-10/D-17 — "system" lane of
 * the polish pass.) `CLAUDE.md`'s existing "24-hour, no AM/PM" ruling
 * (`schedules.ts`, `ScheduleStatus.svelte`, `DeploymentTimeline.svelte`,
 * `LogsViewer.svelte`, the History tab) was never centralised, so it had
 * to be re-typed at every call site — correctly, four times, and WITHOUT
 * `hour12: false` at three more (`ActivityRail.svelte`'s `hourLabel`,
 * `/activity`'s `clockOf`, `/changes/[...slug]`'s "updated" timestamp),
 * which is why Home/App/Environment activity rows print `07:12 AM` next
 * to History's `Oct 8, 06:49` for the SAME underlying field. At 390 the
 * two-letter suffix is also what D-10 catches wrapping onto its own line
 * ("06:49" / "AM").
 *
 * `formatClockTime` is the one function every call site should hold
 * instead: always 24-hour, always the reader's display zone
 * (`displayTimeZone()`, the Local/UTC toggle), never a locale-dependent
 * AM/PM. Pass `seconds: true` for a log-line-precision reading; the
 * default (minute precision) is every list row and chart tick.
 */
export function formatClockTime(value: string | number | Date, opts: { seconds?: boolean } = {}): string {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: opts.seconds ? '2-digit' : undefined,
		hour12: false,
		timeZone: displayTimeZone()
	});
}

/**
 * ⭐ RELATIVE TIME HAS TWO SPELLINGS, NOT A CHOICE BETWEEN THEM. `utils.ts`
 * already ships both — `formatTimeAgoCompact` ("1h", "3d", "40d") and
 * `formatTimeAgo` ("1 hour ago", "3 days ago") — sharing one set of unit
 * boundaries (`formatDurationMs`'s), so "1h" and "1 hour ago" can never
 * disagree about where an hour ends. D-17 names that pair as drift
 * ("the version card says '1h'" vs "Recent events says '1 hour ago'");
 * it is not — SHORT is the form for a badge/chip/dense row (`Newer
 * builds`, a rank chip, a card rollup), LONG is the form for a sentence
 * (an events feed, a dialog, a banner's prose). Re-exported here so a
 * call site reaching for "the display-time module" finds the relative
 * pair beside the clock-time and timestamp ones instead of hunting for
 * `utils.ts`, without duplicating the one set of boundaries into a
 * second implementation.
 *
 * ⛔ DO NOT ADD A THIRD SPELLING. If neither reads right, the fix is a
 * call site choosing the wrong one of these two, not a new format.
 */
export { formatTimeAgo as formatRelativeLong, formatTimeAgoCompact as formatRelativeShort } from './utils';

/**
 * Short name of the display zone at `at`: `UTC`, `CEST`, `EDT`, `BST`.
 * en-US only knows abbreviations for US zones (Zurich is `GMT+2` there) and
 * en-GB only for European ones (New York is `GMT-4`), so take whichever of
 * the two names the zone, and fall back to the `GMT±N` offset (`GMT+9` for
 * Tokyo) when neither does.
 */
export function displayTimeZoneName(at: Date = new Date()): string {
	const name = (locale: string) =>
		new Intl.DateTimeFormat(locale, { timeZone: displayTimeZone(), timeZoneName: 'short' })
			.formatToParts(at)
			.find((p) => p.type === 'timeZoneName')?.value ?? '';
	const us = name('en-US');
	if (us && !us.startsWith('GMT')) return us;
	const gb = name('en-GB');
	if (gb && !gb.startsWith('GMT')) return gb;
	return us || gb || (timeZonePreference.zone === 'utc' ? 'UTC' : '');
}

/** A full timestamp in the display zone, zone named: `10/7/2026, 14:03:12 CEST`. */
export function formatTimestamp(value: string | number | Date): string {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return '';
	return `${d.toLocaleString(undefined, { timeZone: displayTimeZone() })} ${displayTimeZoneName(d)}`;
}

/** Calendar fields of `d` in the display zone (`month` 0-based, like `Date`). */
export function zonedYMD(d: Date): { year: number; month: number; day: number } {
	return timeZonePreference.zone === 'utc'
		? { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() }
		: { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

/**
 * Epoch ms of the start of `d`'s calendar day in the display zone. Day buckets
 * (`Today`, `Yesterday`, per-day counts) use this, so a 23:30 UTC deploy is
 * filed under the day the printed clock says, not the browser's day.
 */
export function startOfDayMs(d: Date): number {
	const { year, month, day } = zonedYMD(d);
	return timeZonePreference.zone === 'utc'
		? Date.UTC(year, month, day)
		: new Date(year, month, day).getTime();
}
