/**
 * ATTENTION CARD MODEL (r39 kit parts/attention.js, FINAL.md "Attention card"). Pure: decides WHAT the card leads with; the
 * component only draws it. ONE card on every page (Home, Changes, Rollouts), so ONE place decides the lead:
 *
 *   failing ask   -> the check's first drawable observation (status.observations[], rollout-controller type, max 16):
 *                      Threshold -> figure + unit + "over a <limit> budget" (+ a gauge)   8.2 % error rate
 *                      Ratio     -> "N of M" + name
 *                      Count     -> number + name
 *                    State, an absent list, or a Threshold missing limit/direction, a Ratio missing total -> NO figure: the card
 *                    falls back to the check's NAME (500, colon) + its message (`checkFact`), title-led.
 *   approval ask  -> the Ratio drawing from the app's prod regions (data.ts `regionStates`: the same count the change's own
 *                    line prints, `regionsWaiting`), "5 of 6 prod regions"; a one-region place has no ratio -> title-led.
 *
 * A healthy observation is never the lead of a failing card (it is not why the card is here): only `healthy !== true` ones
 * are candidates, in array order ("the FIRST observation"); all healthy -> the check fallback.
 */
import type { HealthObservation } from '$lib/../types';
import { failedWord } from '$lib/components/new/state-words';

export type AttentionState = 'failed' | 'approval';

export type Gauge = { /** 0..1 fill */ fill: number; /** 0..1 where the limit sits */ limitAt: number; over: boolean };
export type FigureLead = { kind: 'threshold' | 'ratio' | 'count'; value: string; unit: string; /** beside the figure: the observation's name */ label: string; /** Threshold only: "over a 1% budget" (the fact line) */ budget: string | null; gauge: Gauge | null; /** Ratio / Count: the unit word ("ready"), the fact line's lead when there is no budget */ phrase?: string | null; /** the observation's own `message`, the rest of the fact line (the name is the caption, said once) */ detail?: string | null };
export type CheckLead = { kind: 'check'; name: string | null; message: string };
export type AttentionLead = FigureLead | CheckLead;

const DEC = /^-?\d+(\.\d+)?$/;
const isDec = (s: unknown): s is string => typeof s === 'string' && DEC.test(s.trim());
/** a decimal string as the person reads it: at most 2 decimals, no trailing zeros ("8.20" -> "8.2", "12" -> "12") */
export function num(s: string): string {
	const n = Number(s);
	if (!Number.isFinite(n)) return s;
	return String(+n.toFixed(2));
}
/** a unit that sits against the number ("8.2%") vs after a space ("500 ms") */
const tight = (u: string) => u === '%' || u === '‰';
const withUnit = (v: string, u: string) => (u ? (tight(u) ? `${v}${u}` : `${v} ${u}`) : v);

/** the observation the card can draw as a figure, or null */
export function drawable(o: HealthObservation): FigureLead | null {
	const name = o.name;
	if (o.kind === 'Threshold') {
		if (!isDec(o.value) || !isDec(o.limit) || (o.direction !== 'Above' && o.direction !== 'Below')) return null;
		const v = Number(o.value), l = Number(o.limit);
		const unit = o.unit ?? '';
		const over = o.direction === 'Above' ? v > l : v < l;
		// the limit sits at the middle of the track; the fill saturates at twice the limit (Below: mirrored)
		const gauge: Gauge | null = l > 0 ? { fill: Math.max(0, Math.min(1, v / (2 * l))), limitAt: 0.5, over } : null;
		const budget = o.direction === 'Above' ? `over a ${withUnit(num(o.limit), unit)} budget` : `under a ${withUnit(num(o.limit), unit)} floor`;
		return { kind: 'threshold', value: num(o.value), unit, label: name, budget, gauge, detail: o.message?.trim() || null };
	}
	if (o.kind === 'Ratio') {
		if (!isDec(o.value) || !isDec(o.total) || Number(o.total) <= 0) return null;
		/* the unit word stays on the figure line ("1 of 3 ready"), never alone on the message line */
		return { kind: 'ratio', value: num(o.value), unit: `of ${num(o.total)}${o.unit ? ` ${o.unit}` : ''}`, label: name, budget: null, gauge: null, phrase: null, detail: o.message?.trim() || null };
	}
	if (o.kind === 'Count') {
		if (!isDec(o.value)) return null;
		return { kind: 'count', value: num(o.value), unit: o.unit ?? '', label: name, budget: null, gauge: null, phrase: null, detail: o.message?.trim() || null };
	}
	return null; // State: a word, not a measurement
}

/** the failing card's lead: first not-healthy drawable observation, else the check name + message */
export function failingLead(check: { name?: string | null; message?: string | null } | null, observations?: HealthObservation[] | null): AttentionLead {
	for (const o of observations ?? []) {
		if (o.healthy === true) continue;
		const f = drawable(o);
		if (f) return f;
	}
	return { kind: 'check', name: check?.name ?? null, message: check?.message ?? '' };
}

/** the approval card's lead: "5 of 6 prod regions" from the app's regionStates (ink 'waiting'); null for one region or none waiting */
export function approvalLead(regions: readonly { ink: string }[] | null | undefined, noun = 'prod regions'): FigureLead | null {
	const m = regions?.length ?? 0;
	const n = (regions ?? []).filter((r) => r.ink === 'waiting').length;
	if (m < 2 || n === 0) return null;
	return { kind: 'ratio', value: String(n), unit: `of ${m}`, label: noun, budget: null, gauge: null };
}

/** "Name: message" with the name a string run (the component bolds it), never a trailing colon without a message */
export function checkFact(check: { name: string | null; message: string }): { name: string | null; message: string } {
	return { name: check.name, message: check.message };
}

/** a failure whose checks all recovered reads `Failed`; `Failing` is a check failing now (state-words.ts failedWord) */
export const statusWord = (s: AttentionState, recovered = false): string => (s === 'failed' ? failedWord(recovered) : 'Needs your approval');

export type AttentionInput = {
	state: AttentionState;
	/** compact age ("9h"): printed as "for 9h" */
	age?: string | null;
	/** the instant `age` counts from (ISO): a card that ticks prints the age against the live clock, as the banners do, so one failure has one age on every page */
	ageAt?: string | null;
	tier?: string;
	place?: string;
	/** the failing check (Failing) — name + message */
	check?: { name?: string | null; message?: string | null } | null;
	observations?: HealthObservation[] | null;
	/** the app's prod regions (Needs your approval) */
	regions?: readonly { ink: string }[] | null;
	/** the approval's fact line ("Releases when someone approves") */
	gateSentence?: string | null;
	/** health evidence: a quiet line under the fact ("+2 more failing") and the recovered flag (word `Failed`, not `Failing`) */
	note?: string | null;
	recovered?: boolean;
	/** recovered: "09:34", the moment the check went OK (the card's fact: "recovered at 09:34") */
	recoveredAt?: string | null;
	/** the failing check's class (kustomization, datadog, prometheus, incidents): the fact line's glyph */
	cls?: string;
	/** the title-led title (the change title or the ask's message) */
	title?: string;
};
export type AttentionModel = {
	state: AttentionState;
	word: string;
	forAge: string | null;
	/** the instant `forAge` counts from, when the card should tick it live */
	forAgeAt: string | null;
	tier: string;
	place: string;
	lead: AttentionLead | null;
	/** figure-led (a measured fact) vs title-led */
	figure: FigureLead | null;
	title: string;
	/** the fact line: a failing check's name + message, or an approval's sentence */
	fact: { name: string | null; message: string } | null;
	note: string | null;
	/** the check is OK again: the figure draws in recovered ink */
	recovered: boolean;
	cls: string;
};

export function attentionModel(i: AttentionInput): AttentionModel {
	const failed = i.state === 'failed';
	const lead = failed ? failingLead(i.check ?? null, i.observations) : approvalLead(i.regions);
	const figure = lead && lead.kind !== 'check' ? lead : null;
	/* the name appears once, as the figure's caption: the fact line under it is the limit phrase and the observation's message */
	const figLine = figure ? [figure.budget ?? figure.phrase, figure.detail].filter(Boolean).join(' \u00b7 ') : '';
	const fact = failed && figure && i.recovered
		? { name: null, message: i.recoveredAt ? `recovered at ${i.recoveredAt}` : 'recovered' }
		: failed && figure
		? figLine ? { name: null, message: figLine } : null
		: failed
		? i.check && (i.check.name || i.check.message) ? { name: i.check.name ?? null, message: i.check.message ?? '' } : null
		: i.gateSentence ? { name: null, message: i.gateSentence } : null;
	return {
		state: i.state,
		word: statusWord(i.state, !!i.recovered),
		forAge: i.age ? `for ${i.age}` : null,
		forAgeAt: i.ageAt ?? null,
		tier: i.tier ?? '',
		place: i.place ?? '',
		lead,
		figure,
		title: i.title ?? '',
		fact,
		note: failed ? i.note ?? null : null,
		recovered: !!(failed && i.recovered),
		cls: i.cls ?? ''
	};
}

/** band columns: 1 phone, 2 default, 4-up only when the main is wide; the lead spans when the 2-col count is odd */
export function bandSpec(count: number, cols: 2 | 3 | 4 = 2, lead: boolean | 'auto' = 'auto'): { span: boolean } {
	const span = lead === true || (lead === 'auto' && cols === 2 && count % 2 === 1 && count > 1);
	return { span };
}
