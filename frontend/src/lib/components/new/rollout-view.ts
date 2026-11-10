/** r34 rollouts lane: view-model of the Rollouts and Needs-you pages. Facts come ONLY from ./data. */
import { placeLabel, heldCauses, checkClock, approvalScope, actionFor } from './data';
import type { TRow, GroupKey, HomeState, Step } from './data';
import { getRolloutEnvironmentTheme } from '$lib/environment-theme';
import { stateWord } from './state-words';

export { stepsOf, failureReason, placeLabel, truthAttrs, inbox, arrivals, lastHealthy, pathPosition } from './data';
export { heldCauses };
export type { Step, StepState, FailureReason, InboxItem, TRow } from './data';

/** the env Chip's theme for a place: the tier's own identity (dev / test / staging / production) */
export const TIER_ENV: Record<string, string> = { dev: 'dev', test: 'test', staging: 'staging', prod: 'production' };
export const envTheme = (tier: string) => getRolloutEnvironmentTheme(null, TIER_ENV[tier] ?? tier);

/** the one mark of a row (StatusMark state) */
export type MarkState = 'failed' | 'approval' | 'held' | 'deploying' | 'checking';
export function markOf(row: TRow): MarkState {
	return row.group === 'failed' ? 'failed' : row.group === 'approval' ? (row.stillChecking ? 'checking' : 'approval') : row.group === 'held' ? 'held' : row.state === 'checking' ? 'checking' : 'deploying';
}

/** the Runway's subject: the lead failure; else (calm / quiet) the newest place that is moving; else null */
export function runwayRow(rows: TRow[]): TRow | null {
	const failing = rows.find((r) => r.group === 'failed' && r.lead) ?? rows.find((r) => r.group === 'failed');
	if (failing) return failing;
	return [...rows].filter((r) => r.group === 'moving').sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''))[0] ?? null;
}

/** r5 R17: the OPENED row of /rollouts = the first row of the first non-empty group in priority order: failing -> waiting for approval (the viewer's own first) -> held -> in progress
 *  (newest). `runwayRow` (failing, else newest moving) stays for the pages that import it. */
export function leadRow(rows: TRow[]): TRow | null {
	const failing = runwayRow(rows.filter((r) => r.group === 'failed'));
	if (failing) return failing;
	const appr = rows.filter((r) => r.group === 'approval');
	const first = appr.find((r) => r.needsYou) ?? appr[0] ?? rows.find((r) => r.group === 'held');
	return first ?? runwayRow(rows);
}

export const FILTERS: { key: GroupKey; label: string }[] = [
	{ key: 'failed', label: 'Failing' }, { key: 'approval', label: 'Waiting for approval' },
	{ key: 'held', label: 'Held' }, { key: 'moving', label: 'In progress' }, { key: 'rest', label: 'At rest' }
];

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function headerFacts(rows: TRow[], _needs?: number) {
	const failing = rows.filter((r) => r.group === 'failed').length;
	const moving = rows.filter((r) => r.group === 'moving').length;
	/* r34 truth-5: approvals are counted in PLACES (data.fleetCounts().places.approval's unit), the one number every page prints */
	const waiting = rows.filter((r) => r.group === 'approval').reduce((n, r) => n + r.regions.length, 0);
	/* what needs ME first: the approvals the viewer can give, named in the header (UX 10); r5 R9: the header and the chip count the same thing (all waiting) and name mine */
	const yours = rows.filter((r) => r.group === 'approval' && r.needsYou).length;
	const facts: { text: string; adverse: boolean }[] = [];
	if (failing) facts.push({ text: `${failing} failing`, adverse: true });
	if (waiting) facts.push({ text: `${plural(waiting, 'place')} waiting for approval`, adverse: false });
	if (yours) facts.push({ text: `${yours} yours to approve`, adverse: false });
	if (moving) facts.push({ text: `${moving} in progress`, adverse: false });
	return facts;
}
/** production first within Failing (stable otherwise); the lead stays first */
export const failFirst = <T extends { tier: string; key: string }>(rows: T[], leadKey: string | null): T[] =>
	[...rows].sort((a, b) => (a.key === leadKey ? -1 : b.key === leadKey ? 1 : (b.tier === 'prod' ? 1 : 0) - (a.tier === 'prod' ? 1 : 0)));
export const groupRollup = (rows: TRow[], places: number) =>
	places !== rows.length ? `${plural(rows.length, 'rollout')} · ${plural(places, 'place')}` : plural(rows.length, 'rollout');
export const groupAdverse = (rows: TRow[]) => {
	const n = rows.filter((r) => r.needsYou).length;
	return n ? `${n} ${n === 1 ? 'needs' : 'need'} you` : null;
};

/** the next thing that will need a person, for the empty Needs-you card: the earliest approval, else the oldest hold */
export function nextThing(rows: TRow[]): string | null {
	const pick = rows.filter((r) => r.group === 'approval').sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))[0]
		?? rows.filter((r) => r.group === 'held').sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))[0];
	if (!pick) return null;
	const place = placeLabel(pick);
	return pick.group === 'approval' ? `Next: ${pick.app} waits for approval in ${place}.` : `Next: ${pick.app} is held in ${place} · ${pick.word.toLowerCase()}.`;
}


/** R11: the tab opens its Roll back dialog from `?action=rollback` (rollout page, `rollbackPending`); Approve has no such param, so it links to the tab. */
/** P4: the two action words are "Approve" and "Roll back", whatever the model labelled them */
export const actionLabel = (a: NonNullable<TRow['action']>): string => (a.kind === 'approve' ? 'Approve' : a.kind === 'rollback' ? 'Roll back' : a.label);

export function actionHref(a: NonNullable<TRow['action']>): string {
	/* rollouts-10 W15: the approval action is one form product-wide - "Review approval ↗" opens the rollout's Gates tab (where approvals live), never the rollout root */
	if (a.kind === 'approve') return /\/gates$/.test(a.href) ? a.href : a.href.replace(/\/$/, '') + '/gates';
	if (a.kind !== 'rollback' || a.href.includes('action=')) return a.href;
	return `${a.href}${a.href.includes('?') ? '&' : '?'}action=rollback`;
}

/** R2: the Failing group lists the OTHER failing places; the lead is the Runway's. Returns the rows to list and the rollup suffix. */
export function withoutLead<T extends { key: string }>(rows: T[], lead: { key: string } | null): T[] {
	return lead ? rows.filter((r) => r.key !== lead.key) : rows;
}

/** the one action a row offers: data.ts `actionFor` (kept under its old name for the pages that import it from here). No fallback: a failing row the model gives no action offers no button. */
export const rowAction = (row: Pick<TRow, 'group' | 'action'>): TRow['action'] => actionFor(row);
/** r34 r4: a held row says what holds it in the rail's own words ("Waits on check integration-tests"), never "a rule"/"a check". */
export function holdWord(row: Pick<TRow, 'key' | 'group' | 'word'>, hs: HomeState): string | null {
	if (row.group !== 'held') return null;
	const h = heldCauses(hs).find((c) => c.rows.some((r) => r.key === row.key));
	if (!h || h.cause === 'Held by a rule') return null;
	return h.cause.replace(/^Waiting/, 'Waits');
}

/* ── r34 v2 RO: the Slipway's facts ─────────────────────────────────────────────────────────────────────────────── */
/** the signed-in viewer: their own change never wears their own face (rule); the fact is "your change" instead */
export const VIEWER = 'danielreed';
export { deployedCommit } from './data';
/** the Slipway's state title: the failing lead says "Deployment failed" (the pane owns the failure; the row carries only the check's
 *  name); a moving lead says the row's own state word ("Deploying" / "Checking") — one word for one state across row, pane and rail.
 *  The step it is in ("Stage 2 running") lives in the pane's facts line. */
export function slipwayTitle(row: Pick<TRow, 'key' | 'group' | 'word'>, hs?: HomeState): string {
	if (row.group === 'failed') return 'Deployment failed';
	/* r6 T7: a held place says what holds it in the row's own words ("Waits on Integration tests"), never "Held by a rule" */
	return (hs && holdWord(row, hs)) || row.word;
}

/** r6 T13: the tab's own ENVIRONMENT name for a place: a production region is "prod-eu-west" (the rollout's environment), not the bare region; dev / staging / production / "N prod regions" are
 *  already the tab's words. `placeLabel` (data.ts, shared) keeps the short form for the pages that have not adopted this. */
export function tabEnv(x: { tier: string; regions?: string[]; label?: string; place?: string }): string {
	const p = placeLabel(x.place && !x.regions && !x.label ? { tier: x.tier, label: x.place } : x);
	return x.tier === 'prod' && p !== 'production' && !/^\d+ prod regions$/.test(p) && !p.startsWith('prod-') ? `prod-${p}` : p;
}
/** r6 T6: the age of a hold = since the waiting build ARRIVED at this place's gate (data.holdSince), never the build's own age; '' when the mock cannot tell */
export { holdSince, recoveredAt } from './data';

/** rollouts-9 W1: the ONE state word a row prints in its state slot (null only for an opened failing/moving lead, whose pane owns the word, and a failing row whose check name stands in).
 *  An approval row ALWAYS says "Waiting for approval" - whoever's change it is; the commit title and "Your change" live in the pane, never in place of the word. */
export function stateWordOf(row: TRow, hs: HomeState, open = false, hasCheck = false, perRow = true): string | null {
	if (row.group === 'failed') return open || hasCheck ? null : (row.failure?.line ?? row.word);
	const clock = checkClock(row);
	/* rollouts-9 W6: the card's title already says "waiting for approval"; the slot says what DIFFERS: the deployed build still checking (mark = word), your approval, else not yet approved */
	if (row.group === 'approval' && !perRow) return stateWord('approval');
	/* rollouts-11 W21: the state slot says what DIFFERS from the card's title: the viewer's approval, the deployed build still checking (the clock only while the row is closed: an opened pane says it once, in its Check timer row),
	   else the scope ("Waiting for approval · 2 regions") */
	if (row.group === 'approval') {
		if (row.stillChecking && clock) return open ? 'Checking' : `Checking · ${clock}`;
		if (row.needsYou && row.action?.kind === 'approve') return stateWord('approval', { yours: true });
		const of = approvalScope(row, hs).of;
		return of > 1 ? `${stateWord('approval')} · ${of} regions` : stateWord('approval');
	}
	if (row.group === 'moving' && clock) return open ? 'Checking' : `Checking · ${clock}`;
	if (open && row.group === 'moving') return null;
	return holdWord(row, hs) ?? (row.word.startsWith('Held by') && (row as TRow).cause ? ((row as TRow).cause as string) : row.word);
}

/** rollouts-9 W4: the opened pane's `Approval` slot, in the scope form of approvalScope everywhere ("Your approval · prod-ap-south · 1 of 5 regions waiting"); null for any row that is not an approval */
export function approvalFact(row: TRow, hs: HomeState): string | null {
	if (row.group !== 'approval') return null;
	return approvalScope(row, hs).sentence.replace(/^Needs your approval/, 'Your approval');
}

/** rollouts-10 W13: the ONE mapping from a step's state to its colour family, used by Pipeline (the mini strand) and TraySteps.
 *  A step that is running is the tab's blue "deploying" unless it is the Check step of a row that is itself CHECKING (yellow); a
 *  row whose state is 'deploying' never shows a yellow ring (checkout-edge Dev: mark and word say Deploying). */
export type StepTone = 'done' | 'deploying' | 'checking' | 'failed' | 'held' | 'todo';
export function stepTone(s: Step, rowState?: string): StepTone {
	if (s.state === 'fail') return 'failed';
	if (s.state === 'hold') return 'held';
	if (s.state === 'done') return 'done';
	if (s.state === 'todo') return 'todo';
	return s.name === 'Check' && rowState !== 'deploying' ? 'checking' : 'deploying';
}

/** rollouts-12 W31: a check named "<app>-<check>" is printed without the app on a phone's line 2 ("error-rate"), so the line never echoes the name above it.
 *  A check that does not start with the app's name keeps its whole name; null stays null. */
export function checkShort(app: string, check: string | null): string | null {
	if (!check) return null;
	const pre = `${app}-`;
	return check.startsWith(pre) && check.length > pre.length ? check.slice(pre.length) : check;
}
