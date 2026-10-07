/**
 * Formatting helpers for the reader's display timezone. The preference itself
 * (Local / UTC, the navbar toggle) lives in `./timezone.svelte`; these are pure
 * functions over it, kept out of the `.svelte.ts` module so they can build
 * plain `Date`s without tripping `svelte/prefer-svelte-reactivity`.
 */
import { displayTimeZone, timeZonePreference } from './timezone.svelte';

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
