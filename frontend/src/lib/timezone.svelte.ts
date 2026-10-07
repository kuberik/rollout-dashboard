/**
 * ⭐ THE DISPLAY TIMEZONE — one switch for every clock the dashboard prints.
 * (2026-10-07) On-call asked for Grafana's "Browser time / UTC" toggle: during
 * an incident the deploy timeline, the logs and the schedule windows all have
 * to be read against alerts and other tools that speak UTC, and a dashboard
 * that only knows the browser's zone makes every reader convert by hand.
 *
 * `local` is the browser's own zone (the default, and what every formatter
 * did before this existed); `utc` is UTC. The choice is a per-viewer
 * preference kept in localStorage, never shared state.
 *
 * It is a `$state` object, so any formatter that reads `displayTimeZone()`
 * inside a template or a `$derived` — including the plain `.ts` view-models
 * those call — re-renders when the toggle flips, with no prop threading.
 *
 * ⛔ Pass `displayTimeZone()` as Intl's `timeZone` option on every date/time
 * `toLocale*String` call. A call without it silently prints browser time while
 * the navbar says UTC. A schedule RULE (`14:00–00:00 Europe/Zurich`) is the
 * exception: that is the rule as written, not an instant, and keeps its zone.
 */

export type DisplayTimeZone = 'local' | 'utc';

const STORAGE_KEY = 'displayTimeZone';

function load(): DisplayTimeZone {
	try {
		return localStorage.getItem(STORAGE_KEY) === 'utc' ? 'utc' : 'local';
	} catch {
		return 'local';
	}
}

export const timeZonePreference = $state<{ zone: DisplayTimeZone }>({
	zone: typeof localStorage === 'undefined' ? 'local' : load()
});

export function setDisplayTimeZone(zone: DisplayTimeZone): void {
	timeZonePreference.zone = zone;
	try {
		localStorage.setItem(STORAGE_KEY, zone);
	} catch {
		// localStorage unavailable; preference is non-critical
	}
}

/** Intl `timeZone` option for the current preference; undefined = browser zone. */
export function displayTimeZone(): string | undefined {
	return timeZonePreference.zone === 'utc' ? 'UTC' : undefined;
}
