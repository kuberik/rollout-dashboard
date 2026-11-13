/**
 * THE ONE STATE TONE TABLE (owner 2026-11-13: "we aren't using the same component. where else did we copy instead?").
 * ROLE: what a state LOOKS like, once. Every mark and every state word reads it: WaveMark (strip dots and pies), SiteMark (the site
 * picker), StatusMark (the icon mark OUTSIDE strips: banners, rows), the `.st-*` strand dots (language.css, pinned by
 * state-tone.test.ts), EnvStateBar, and every "state -> text colour" map that used to be copied per page (`toneInk`).
 * So "healthy", "stuck", "not reached", "approval", "held" and "failed" are one colour and one shape on every page, and the site
 * you clicked in a strip is drawn in the picker with the same tone.
 *
 * ONE KEY SET: `ToneState`. The product's other spellings (failing, awaiting-approval, approval-yours, baking, deployed, ...) fold
 * into it via `toneOf`; a state this table does not know is `null` and takes the caller's quiet default (never a guessed hue).
 *
 *   done        success   a calm green dot            held       held orange      failed   danger (the one solid disc)
 *   checking    progress  yellow, breathes           approval   held orange      stuck    warning amber
 *   deploying   active    blue, sweeps               notreached dashed subtle ring (WaveMark's ring)   notaffected  dim subtle dot
 */
export type ToneState = 'done' | 'checking' | 'deploying' | 'held' | 'approval' | 'failed' | 'stuck' | 'notreached' | 'notaffected';
export type ToneHue = 'success' | 'progress' | 'active' | 'held' | 'danger' | 'warning' | 'subtle';

export type Tone = {
	hue: ToneHue;
	/** the mark's fill / line colour, a CSS value (strip dots, pies, strand dots) */
	solid: string;
	/** the state's tint and line (a ring-mark's disc and edge) */
	tint: string;
	line: string;
	/** the state word's text colour, a Tailwind class (written out in full so the scanner sees it) */
	ink: string;
	/** the solid as a Tailwind background class (a corner dot, a legend swatch) */
	bg: string;
	/** StatusMark's chip (disc + edge + glyph colour), Tailwind classes */
	chip: string;
	/** 'disc' = filled; 'ring' = the hollow dashed not-reached ring; 'dim' = a quiet dot at reduced opacity */
	shape: 'disc' | 'ring' | 'dim';
	/** does the mark move (only these two ever animate) */
	moves: boolean;
};

/** the word ink of a HUE (a rollup that names a hue, not a state: "danger", "held", "muted"); the state rows below read it too */
export const HUE_INK = {
	danger: 'text-danger',
	held: 'text-held',
	warning: 'text-warning',
	active: 'text-active',
	progress: 'text-progress',
	success: 'text-success',
	muted: 'text-fg-muted',
	subtle: 'text-fg-subtle',
	fg: 'text-fg'
} as const;
export const hueInk = (h: keyof typeof HUE_INK | null | undefined, quiet: string = HUE_INK.muted): string => (h ? (HUE_INK[h] ?? quiet) : quiet);

const hue = (h: Exclude<ToneHue, 'subtle'>) => ({ solid: `var(--k-${h}-solid)`, tint: `var(--k-${h}-tint)`, line: `var(--k-${h}-line)` });
const SUBTLE = { solid: 'var(--k-fg-subtle)', tint: 'var(--k-subtle)', line: 'var(--k-line-strong)' };

export const TONE: Record<ToneState, Tone> = {
	done: { hue: 'success', ...hue('success'), bg: 'bg-success-solid', ink: HUE_INK.muted, chip: 'bg-success-solid', shape: 'disc', moves: false },
	checking: { hue: 'progress', ...hue('progress'), bg: 'bg-progress-solid', ink: HUE_INK.progress, chip: 'bg-progress-tint ring-progress-solid text-progress', shape: 'disc', moves: true },
	deploying: { hue: 'active', ...hue('active'), bg: 'bg-active-solid', ink: HUE_INK.active, chip: 'bg-active-tint ring-active-line text-active', shape: 'disc', moves: true },
	held: { hue: 'held', ...hue('held'), bg: 'bg-held-solid', ink: HUE_INK.held, chip: 'bg-held-tint ring-held-line text-held', shape: 'disc', moves: false },
	approval: { hue: 'held', ...hue('held'), bg: 'bg-held-solid', ink: HUE_INK.held, chip: 'bg-held-tint ring-held-line text-held', shape: 'disc', moves: false },
	// Failed is the ONE solid disc (palette AD r3): white "!" on danger-solid, 4.33:1 light, 3.40:1 dark.
	failed: { hue: 'danger', ...hue('danger'), bg: 'bg-danger-solid', ink: HUE_INK.danger, chip: 'bg-danger-solid ring-danger-solid text-white', shape: 'disc', moves: false },
	stuck: { hue: 'warning', ...hue('warning'), bg: 'bg-warning-solid', ink: HUE_INK.warning, chip: 'bg-warning-tint ring-warning-line text-warning', shape: 'disc', moves: false },
	notreached: { hue: 'subtle', ...SUBTLE, bg: 'bg-fg-subtle', ink: HUE_INK.subtle, chip: 'bg-subtle ring-line text-fg-subtle', shape: 'ring', moves: false },
	notaffected: { hue: 'subtle', ...SUBTLE, bg: 'bg-fg-subtle', ink: HUE_INK.subtle, chip: 'bg-subtle ring-line text-fg-subtle', shape: 'dim', moves: false }
};

/** the product's other spellings of the same states */
const ALIAS: Record<string, ToneState> = {
	done: 'done', deployed: 'done', healthy: 'done', live: 'done', newest: 'done', landed: 'done',
	checking: 'checking', baking: 'checking', retrying: 'checking',
	deploying: 'deploying', current: 'deploying', promoting: 'deploying',
	held: 'held', hold: 'held', 'held-by-rule': 'held',
	approval: 'approval', waiting: 'approval', 'awaiting-approval': 'approval', 'approval-yours': 'approval',
	failed: 'failed', failing: 'failed',
	stuck: 'stuck',
	notreached: 'notreached', 'not-reached': 'notreached', none: 'notreached',
	notaffected: 'notaffected', 'not-affected': 'notaffected'
};

export const toneOf = (s: string | null | undefined): ToneState | null => (s ? (ALIAS[s] ?? null) : null);
/** the Tone of a state spelling, or null */
export const tone = (s: string | null | undefined): Tone | null => { const k = toneOf(s); return k ? TONE[k] : null; };
/** the word ink of a state; `quiet` (default fg-muted) for a state the table does not know */
export const toneInk = (s: string | null | undefined, quiet = 'text-fg-muted'): string => tone(s)?.ink ?? quiet;
/** the fill colour of a state's mark (CSS value) */
export const toneBg = (s: string | null | undefined): string | undefined => tone(s)?.bg;
export const toneSolid = (s: string | null | undefined, quiet = 'var(--k-fg-subtle)'): string => tone(s)?.solid ?? quiet;
