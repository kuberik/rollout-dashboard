/**
 * ⭐ THE ONE GATE LABEL: how a gate is NAMED on any surface (owner decision 2026-11-11, settled).
 *
 * A promotion gate (the environment controller's order rule) NEVER prints its display name. The gate's pretty name is a sentence
 * the controller writes ("Previous environment not ready yet"); the reader needs the OBJECT: a promotion, and which environment it
 * waits on. So it is drawn by kind: the promotion glyph and the source environment's chip (`» [STAGING]`). With no source known
 * the label is the word "Promotion". Every other kind is named by its published name (`gateDisplayName`), unchanged.
 *
 * Surfaces that DRAW (GateRecord, the Gates tab) render `GateLabel.svelte` from this value. Surfaces that print a STRING
 * (a toast, a held-by sentence, a title attribute) print `gateLabelText`. Nothing else decides how a gate is labelled, so a
 * surface that prints `displayName` for a promotion gate is the bug this file exists to prevent.
 *
 * A leaf module: imports only `gate-kind` and `gate-name`.
 */
import { gateKindOf } from './gate-kind';
import { gateDisplayName } from './gate-name';

export const PROMOTION_WORD = 'Promotion';

export type GateLabel =
	| { kind: 'promotion'; /** the source environment ("staging"), null when unknown: the label is then the word "Promotion" */ source: string | null }
	| { kind: 'named'; text: string };

/** `kind` is the backend's (or the classifier's) kind; `source` the environment the promotion waits on, when the caller knows it. */
export function gateLabel(g: { kind?: string | null; name: string }, pretty?: string | null, source?: string | null): GateLabel {
	if (gateKindOf(g) === 'promotion') {
		const s = source?.trim();
		return { kind: 'promotion', source: s ? s : null };
	}
	return { kind: 'named', text: gateDisplayName(g.name, pretty) };
}

/** the label as a plain string, for places that cannot draw (toasts, titles, "Held by …" sentences) */
export function gateLabelText(l: GateLabel): string {
	return l.kind === 'named' ? l.text : l.source ? `${PROMOTION_WORD} from ${l.source}` : PROMOTION_WORD;
}

/** The source environment of a classified promotion gate: the classifier's own `promotionSource` (one environment), null for a wave or an unknown upstream. */
export function promotionSourceOf(g: { kind?: string | null; promotionSource?: string | null }): string | null {
	return g.kind === 'promotion' ? g.promotionSource ?? null : null;
}

/** The label of a CLASSIFIED gate (`classifyGate`'s record): a promotion gate by kind and its source environment, any other by the display name the Gates tab prints. */
export function classifiedGateLabel(g: { kind?: string | null; promotionSource?: string | null; displayName?: string; label: string }): GateLabel {
	if (g.kind === 'promotion') return { kind: 'promotion', source: promotionSourceOf(g) };
	return { kind: 'named', text: g.displayName ?? g.label };
}

/*
 * A CAUSE IS TYPED, NOT A STRING WITH MARKS IN IT. Hold causes ("Held by <gate>", "Waits on <provider>", "<name> held on <gate>") are
 * `Cause` = an array of plain-text runs and `GateLabel`s. A surface that draws maps the array (`CauseText.svelte`: a promotion label
 * becomes the glyph and the chip); every plain-text sink (aria-label, title, clipboard, data-*, a toast's message, a dedupe key)
 * calls `causeText(parts)`, the ONE flattener. Parts, not a `gate` field beside the sentence, because the sentences compose (a
 * suffix "· also needs your approval", "Waits for staging · staging held on <gate>", the toast's "app: <cause> · where") and the
 * label sits in the middle of them; a side field would need every composer to re-splice it.
 */
export type CausePart = string | GateLabel;
export type Cause = CausePart[];
/** a label as a cause part: only a promotion label is drawn; every other kind stays the plain run it always was */
export const labelPart = (l: GateLabel): CausePart => (l.kind === 'promotion' ? l : gateLabelText(l));
/** the cause as plain text: the one flattener for every sink that cannot draw */
export const causeText = (parts: readonly CausePart[]): string => parts.map((p) => (typeof p === 'string' ? p : gateLabelText(p))).join('');
/** `Held by <label>` (or any `lead` + label) as a cause */
export const causeWith = (lead: string, l: GateLabel): Cause => [lead, labelPart(l)];
/** merge adjacent plain runs, so a cause built by concatenation compares and prints like the string it replaces */
export function joinCause(...xs: (CausePart | readonly CausePart[])[]): Cause {
	const out: Cause = [];
	for (const x of xs.flat() as CausePart[]) {
		if (typeof x === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] = (out[out.length - 1] as string) + x;
		else if (x !== '') out.push(x);
	}
	return out;
}
