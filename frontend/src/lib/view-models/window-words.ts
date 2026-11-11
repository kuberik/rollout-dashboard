import { gateDisplayName } from './gate-name';
/**
 * THE ONE WAY A DEPLOY WINDOW IS NAMED. Every surface that says a place is held by a window (the row, the toast, the held causes the banner
 * and /environments read, the app page's rail) prints this: the window's own published name when there is one, "Held by Business Hours Only",
 * and otherwise (the gate has no pretty name yet, or the schedule is not joined) "Waits for the deploy window". Its opening time, when known,
 * rides after the place as its own clause ("opens Mon 09:00 UTC"), never inside the name. A leaf module (imports only the gate-name reader).
 */
/** the generic labels that name nothing: a gate with no published name reads "Gate", the model's own fallback reads "deploy window" */
const UNNAMED = /^(gate|deploy window|a deploy window)?$/i;
/** a published name ("Business Hours Only") passes through; a raw resource name is made readable by the one gate-name reader, and a generated id reads as no name */
export const windowNameOf = (label: string | null | undefined): string | null => {
	const t = (label ?? '').trim();
	if (!t) return null;
	const n = gateDisplayName(t, /[A-Z\s]/.test(t) ? t : null);
	return UNNAMED.test(n) ? null : n;
};
export const windowHeld = (label?: string | null): string => {
	const n = windowNameOf(label);
	return n ? `Held by ${n}` : 'Waits for the deploy window';
};
/** the opening clause ("opens Mon 09:00 UTC"), from the already formatted instant; null when no transition is published */
export const windowOpensClause = (formatted: string | null | undefined): string | null => (formatted ? `opens ${formatted}` : null);
/** a message split so the opening clause ("opens Mon 09:00 UTC", up to the next " · ") is one unit that never breaks mid-phrase on a narrow banner; the rest (the window's name, the places) may wrap */
export const splitOpensClause = (text: string): { text: string; unit: boolean }[] =>
	text.split(/(opens [^·]*[^\s·])/).filter(Boolean).map((t) => ({ text: t, unit: /^opens /.test(t) }));
