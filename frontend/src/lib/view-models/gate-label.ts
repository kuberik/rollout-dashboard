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
/** the placeholder `classifyGate` uses when it does not know the upstream environment: not a name, never a chip */
const UNKNOWN_UPSTREAM = 'its upstream environment';

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

/** The source environment of a classified promotion gate: its `subject` when that names one environment. A wave ("wave 1 (a, b)") or the unknown placeholder is no single environment: null. */
export function promotionSourceOf(g: { kind?: string | null; subject?: string | null; subjectKind?: string | null }): string | null {
	if (g.kind !== 'promotion' || g.subjectKind !== 'environment' || !g.subject) return null;
	if (g.subject === UNKNOWN_UPSTREAM || /^wave \d/.test(g.subject)) return null;
	return g.subject;
}

/** The label of a CLASSIFIED gate (`classifyGate`'s record): a promotion gate by kind and its source environment, any other by the display name the Gates tab prints. */
export function classifiedGateLabel(g: { kind?: string | null; subject?: string | null; subjectKind?: string | null; displayName?: string; label: string }): GateLabel {
	if (g.kind === 'promotion') return { kind: 'promotion', source: promotionSourceOf(g) };
	return { kind: 'named', text: g.displayName ?? g.label };
}
