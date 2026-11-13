export type RowState = 'failed' | 'stuck' | 'approval' | 'deploying' | 'checking' | 'held' | 'waiting' | 'rest' | 'arrived' | 'rolledback';
import { shortRevisionOrNull } from '$lib/version-utils';
import type { EnvPipeline } from '$lib/view-models/home-model';
import type { TierKey } from '../roster-data';
/** craft r1: ONE change, ONE mark. A change in the 'waiting' group is the hollow ring unless the data says it is held by a rule or waits for approval (the tab's own state). */
export const changeMark = (group: string, glyph: string): RowState =>
	group === 'waiting' && glyph !== 'approval' && glyph !== 'held' ? 'waiting' : (glyph as RowState);

/**
 * craft r2: the step a failing ROLLOUT row failed at, in the words of the rollout's own tab: "bake" when the
 * bake cell fails, "deploy" for the single-track fallback, "step N" (1-based across canary tracks) otherwise.
 * null when the pipeline names none (the row then says just "Failing").
 */
export function failStep(p: EnvPipeline | null | undefined, bakeWord = false): string | null {
	if (!p) return bakeWord ? 'check' : null;
	/* the tab names its nodes "Stage N" (per KruiseRollout) and "Check"; a fallback pipeline has only Check */
	if (p.isFallback) return p.bake === 'fail' || p.tracks[0]?.stages[0]?.state === 'fail' ? 'check' : bakeWord ? 'check' : null;
	if (p.bake === 'fail') return 'check';
	for (const t of p.tracks) {
		const i = t.stages.findIndex((s) => s.state === 'fail');
		if (i >= 0) return `stage ${i + 1}`;
	}
	return bakeWord ? 'check' : null;
}
/** craft r2: rollout row outcome, one spelling: "Failing at bake" (only "Failing" inked). */
export const failingAt = (p: EnvPipeline | null | undefined, bakeWord = false) => {
	const s = failStep(p, bakeWord);
	return { text: s ? `Failing at ${s}` : 'Failing', adverse: 'Failing' };
};

const T: TierKey[] = [...TIER_LIST];
const HELD = new Set(['awaiting-approval', 'held-by-rule', 'not-deployed']);
type Env = { tier: string; isProdRegion?: boolean; version: string | null; state: string };
const tierOf = (e: Env): TierKey => (e.isProdRegion || e.tier === 'prod' ? 'prod' : e.tier === 'dev' ? 'dev' : e.tier === 'test' ? 'test' : 'staging');
/**
 * craft r2 (R1-1, meter truth): how far the build THE ROW'S WORDS ARE ABOUT has travelled. The app row's outcome
 * fact describes its worst rollout row `w` (a build `w.version` at tier `w.tier`); the reach is the furthest tier
 * where that same build runs (a failing or deploying place counts as reached; a held or approval place does not).
 */
export function appReach(envs: Env[], version: string | null, at: TierKey | null): TierKey | null {
	if (!version) return null;
	const got = envs.filter((e) => shortRevisionOrNull(e.version) === version && !HELD.has(e.state)).map(tierOf);
	if (!got.length) return null;
	void at;
	return got.reduce((b, t) => (T.indexOf(t) > T.indexOf(b) ? t : b));
}
/** craft r2: the 'hold' tone drawn at a held or approval tier (reached-but-held), used by Reach. */
export const isHoldTone = (tone: string) => tone === 'you' || tone === 'waiting';

/* ═══ craft r3 (core): ONE METER, ONE MARK MAPPING ═══════════════════════════════════════════════════════════
 * Every list page draws a rollout / change / app through THESE functions, so the same fact is the same drawing
 * everywhere (AD r2 R2-1, R2-3). Meter tones (owner taste: calm, colour lives in the mark): segments are neutral
 * except failing. done = fg-subtle, in flight = fg + pulse, held or waiting at a gate = an OUTLINED segment,
 * to do = the track (line), failing = danger-solid. No blue / yellow / orange fill.
 * Two kinds, because two objects: a ROLLOUT PLACE draws its own steps (caption = what is happening there:
 * "Failing at bake", "Held by a rule", "2/3 steps"); a CHANGE or an APP draws the tiers its build has
 * travelled (caption = where it stands: "production"). Same function per kind on every page.
 */
import type { RolloutRow } from '../roster-data';
import { TIERS as TIER_LIST } from '$lib/view-models/sites-waves';
export type Seg = 'done' | 'active' | 'hold' | 'todo' | 'fail';
export type Meter = { kind: 'steps' | 'reach'; segs: Seg[]; cap: string; adverse?: string; label: string; /** craft r6 (N1): a reach meter's nodes: the environments the app has, in promotion order */ tiers?: TierKey[] };
export type ReachTone = 'failed' | 'waiting' | 'you' | 'moving' | 'landed';

/** the mark of a rollout place: the row's own glyph, never re-derived per page (held stays held, R2-3) */
export const rowMark = (r: { glyph: string }): RowState => r.glyph as RowState;

/** the worst rollout row of an app or a change (same pick as roster-data's `apps()`): failing, yours, moving, then the first */
export function worstOf(rows: RolloutRow[]): RolloutRow | null {
	return rows.find((r) => r.group === 'failed') ?? rows.find((r) => r.needsYou) ?? rows.find((r) => r.group === 'moving') ?? rows[0] ?? null;
}

/**
 * craft r5 (D1): the steps of a rollout place are the TAB's Deployment-pipeline nodes: "Started", one node per canary stage
 * of every linked KruiseRollout, and "Check". With no KruiseRollout linked (`isFallback`) the pipeline is exactly
 * Started + Check (the single deploy stage is not a node of its own: DeploymentPipelineCard builds Started + Bake), so a
 * deploying place reads Check as active, a test/image failure (deploy 'fail') reads as a failed Check. The count and the
 * name of the failing step come from here, never from a second derivation.
 */
export function pipelineSegs(p: EnvPipeline): Seg[] {
	const st = (s: string): Seg => (s === 'done' ? 'done' : s === 'fail' ? 'fail' : s === 'active' ? 'active' : 'todo');
	if (p.isFallback) {
		const deploy = p.tracks[0]?.stages[0]?.state ?? 'pending';
		return ['done', st(deploy === 'fail' || deploy === 'active' ? deploy : p.bake)];
	}
	return ['done', ...p.tracks.flatMap((t) => t.stages.map((x) => st(x.state))), st(p.bake)];
}

/** the steps meter of one rollout place (Rollouts rows, Needs you rows) */
export function rowMeter(r: RolloutRow): Meter | null {
	const p = r.pipeline;
	if (r.group === 'approval' || r.group === 'held') {
		const n = p ? pipelineSegs(p).length : 2;
		const cap = r.word.replace('Waits for your approval', 'Waits for approval');
		return { kind: 'steps', segs: Array.from({ length: Math.max(n, 2) }, (_, i): Seg => (i === 0 ? 'hold' : 'todo')), cap, label: cap };
	}
	if (!p) return null;
	const segs = pipelineSegs(p);
	const done = segs.filter((s) => s === 'done').length;
	if (r.group === 'failed') {
		const f = failingAt(p, r.lead);
		return { kind: 'steps', segs, cap: f.text, adverse: f.adverse, label: `${f.text}, ${done} of ${segs.length} steps done` };
	}
	return { kind: 'steps', segs, cap: `${done}/${segs.length} steps`, label: `${done} of ${segs.length} steps done` };
}

const TIERS4: TierKey[] = [...TIER_LIST];
const TIER_WORD: Record<TierKey, string> = { dev: 'dev', test: 'test', staging: 'staging', prod: 'production' };
/** the reach meter of a change or an app: the tiers its build has travelled, the state drawn at the tier where it happens */
export function reachMeter(reach: TierKey | null, at: TierKey | null, tone: ReachTone, outcome: string | null = null, tiers: TierKey[] = TIERS4): Meter | null {
	/* craft r6 (N1): one node per environment the app HAS (the tab's environment strip), in promotion order; a tier the app lacks
	   resolves to the furthest environment it has at or before it */
	const T4 = tiers.length ? tiers : TIERS4;
	const ix = (t: TierKey | null) => (t ? T4.reduce((b, x, i) => (TIERS4.indexOf(x) <= TIERS4.indexOf(t) ? i : b), -1) : -1);
	const r = ix(reach);
	const a = tone !== 'landed' ? ix(at) : -1;
	const hold = tone === 'you' || tone === 'waiting';
	const wt = a >= 0 ? T4[a] : reach ? T4[Math.max(0, r)] : null;
	const where = wt ? TIER_WORD[wt] : null;
	if (!where) return null;
	/* craft r4 (R3-4): the caption is the OUTCOME ("Failing in production", "Held in 3 prod regions", "Deploying to dev"), the same
	   sentence the steps meter speaks for a place; only "Failing" is inked. The tier word is the fallback. */
	const cap = outcome ?? where;
	const segs = T4.map((_, i): Seg =>
		i === a && hold ? 'hold'
		: i === a && a <= r && tone === 'failed' ? 'fail'
		: i === a && a <= r && tone === 'moving' ? 'active'
		: hold && a >= 0 ? (i < a ? 'done' : 'todo') /* a gated build has passed every tier before its gate */
		: i <= r ? 'done' : 'todo');
	return { kind: 'reach', segs, tiers: T4, cap, adverse: tone === 'failed' && cap.startsWith('Failing') ? 'Failing' : undefined, label: outcome ? `${outcome}; ${hold ? 'held at' : 'reached'} ${where}` : hold ? `Held at ${where}` : `Reached ${where}` };
}
/** the tone of a rollout row for the reach meter */
export const toneOf = (w: RolloutRow): ReachTone => (w.group === 'failed' ? 'failed' : w.group === 'moving' ? 'moving' : 'waiting');

/** an app's reach meter, from its worst rollout row (the build the row's words are about) */
export function appMeter(w: RolloutRow | null, envs: Env[], fallback: { reach: TierKey | null; at: TierKey | null }, tone: ReachTone, outcome: string | null = null, tiers: TierKey[] = TIERS4): Meter | null {
	if (!w) return reachMeter(fallback.reach, fallback.at, tone, outcome, tiers);
	/* a failing or deploying place has the build (it counts as reached); a held place does not */
	const got = appReach(envs, w.version, w.tier);
	const reach = tone === 'waiting' || tone === 'you' ? got : got && T.indexOf(got) > T.indexOf(w.tier) ? got : w.tier;
	return reachMeter(reach, w.tier, tone, outcome, tiers);
}

/** one string per drawn meter: the dev assertion script compares it across pages */
export const meterKey = (m: Meter | null) => (m ? `${m.kind}:${m.segs.join(',')}|${m.cap}` : 'none');
