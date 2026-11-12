/**
 * TODAY'S DEPLOY WINDOW AS A BAR (Gates tab "Gatehouse" tiles, 2026-11-12). Role: the schedule tile's one drawing — a 24h track
 * for today in the schedule's own time zone, the hours deploys are allowed filled, and where "now" is. Read straight off the
 * `RolloutSchedule` spec the controller evaluates (`rules[].timeRange / daysOfWeek / dateRange`, `action`, `timezone`); whether the
 * window is open NOW is still the controller's `status.active`, never this arithmetic (the bar shows the shape of the day, the
 * status says the state).
 */

export type ScheduleRuleLike = {
	timeRange?: { start?: string; end?: string } | null;
	daysOfWeek?: string[] | null;
	dateRange?: { start?: string; end?: string } | null;
};

export type WindowSpec = {
	action?: 'Allow' | 'Deny';
	timezone?: string;
	rules?: ScheduleRuleLike[];
};

/**
 * Fractions of today (0..1). `allowed`: the spans deploys may happen in, merged and sorted. `now`: where the tick goes, or `null` when the
 * rules' reading of "allowed now" disagrees with the controller's `status.active` (a controller seconds behind a transition, or a demo whose
 * clock is not the wall clock): the bar then draws the day's shape and makes no claim about now — never a tick beside the opposite word.
 */
export type WindowBar = { allowed: [number, number][]; now: number | null };

function partsIn(now: Date, timeZone: string): { weekday: string; date: string; minutes: number } {
	let tz = timeZone || 'UTC';
	let fmt: Intl.DateTimeFormat;
	try {
		fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
	} catch {
		tz = 'UTC';
		fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
	}
	const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
	return { weekday: p.weekday, date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

function minutesOf(hhmm: string | undefined, fallback: number): number {
	const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
	return m ? Math.min(1440, Number(m[1]) * 60 + Number(m[2])) : fallback;
}

function merge(spans: [number, number][]): [number, number][] {
	const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
	const out: [number, number][] = [];
	for (const [a, b] of s) {
		const last = out[out.length - 1];
		if (last && a <= last[1]) last[1] = Math.max(last[1], b);
		else out.push([a, b]);
	}
	return out;
}

/** The rule spans that apply TODAY, in minutes. A rule with no time range is the whole day; one that crosses midnight is two spans. */
function ruleSpansToday(rules: ScheduleRuleLike[], weekday: string, date: string): [number, number][] {
	const spans: [number, number][] = [];
	for (const r of rules) {
		if (r.daysOfWeek?.length && !r.daysOfWeek.some((d) => d.toLowerCase() === weekday.toLowerCase())) continue;
		if (r.dateRange && ((r.dateRange.start && date < r.dateRange.start.slice(0, 10)) || (r.dateRange.end && date > r.dateRange.end.slice(0, 10)))) continue;
		const a = minutesOf(r.timeRange?.start, 0);
		const b = minutesOf(r.timeRange?.end, 1440);
		if (b >= a) spans.push([a, b]);
		else spans.push([a, 1440], [0, b]);
	}
	return merge(spans);
}

/** null when the spec carries no rules (nothing to draw). */
export function windowBar(spec: (WindowSpec & { active?: boolean }) | null | undefined, now: Date = new Date()): WindowBar | null {
	if (!spec?.rules?.length) return null;
	const { weekday, date, minutes } = partsIn(now, spec.timezone ?? 'UTC');
	const matched = ruleSpansToday(spec.rules, weekday, date);
	let allowed = matched;
	if (spec.action === 'Deny') {
		allowed = [];
		let at = 0;
		for (const [a, b] of matched) {
			if (a > at) allowed.push([at, a]);
			at = Math.max(at, b);
		}
		if (at < 1440) allowed.push([at, 1440]);
	}
	const inside = allowed.some(([a, b]) => minutes >= a && minutes < b);
	/* Allow: active = deploys allowed now. Deny: active = the freeze is in effect now, i.e. NOT allowed. */
	const agrees = spec.active === undefined || (spec.action === 'Deny' ? spec.active === !inside : spec.active === inside);
	return { allowed: allowed.map(([a, b]) => [a / 1440, b / 1440]), now: agrees ? minutes / 1440 : null };
}
