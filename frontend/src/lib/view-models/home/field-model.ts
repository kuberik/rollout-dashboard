/**
 * The one helper Home keeps from the lab's `fieldcalm/field-model.ts`: a
 * wall-clock "when" for a past instant, relative to `now`'s day in the
 * viewer's display zone. `15:17` today, `yesterday 15:17`, `Tue 15:17` this
 * week, `12 Oct 15:17` older. Pure apart from the display-zone preference
 * and the paraglide locale (names and word order come from the messages).
 */
import { startOfDayMs } from '$lib/display-time';
import { displayTimeZone } from '$lib/timezone.svelte';
import * as msg from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';

/** 24h `HH:MM` in the display zone (the lab's `formatClockTime`). */
export function formatClockTime(value: string | number | Date): string {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: displayTimeZone()
	});
}

export function formatWhen(value: string | number | Date, now: Date): string {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return '';
	const clock = formatClockTime(d);
	const days = Math.round((startOfDayMs(now) - startOfDayMs(d)) / 86_400_000);
	if (days <= 0) return clock;
	if (days === 1) return msg.home_m_yesterday({ clock });
	// day and month names in the page's own language (paraglide's locale), in the display zone;
	// their order around the clock is the message's
	const name = (o: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(getLocale(), { ...o, timeZone: displayTimeZone() }).format(d);
	if (days < 7) return msg.home_m_when_weekday({ weekday: name({ weekday: 'short' }), clock });
	return msg.home_m_when_date({
		day: name({ day: 'numeric' }),
		month: name({ month: 'short' }),
		clock
	});
}
