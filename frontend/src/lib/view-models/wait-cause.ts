/**
 * WHY AN APP'S NEXT PLACE HAS NOT TAKEN ITS NEWEST BUILD — Home round R
 * (2026-10-12). One true, named cause per app, from the mechanisms the
 * data model actually has, and nothing else:
 *
 *   - `bake`     — the place upstream is still baking the build (its own
 *                  `bakeStartTime` + `spec.bakeTime`), so the promotion
 *                  gate has nothing to pass yet;
 *   - `approval` — the place is held by an approval (the shared
 *                  `isHeldByApproval`);
 *   - `rule`     — the place is held by a named rule: a dependency on
 *                  another service (`heldCause === 'dependency'`, its
 *                  provider app) or a non-passing check gate (its name);
 *   - `window`   — held by a deploy window (`heldCause === 'clock'`);
 *   - `cycle`    — nothing refuses it and the upstream place has had it for
 *                  less than one normal promotion cycle (`NORMAL_CYCLE_MS`);
 *   - `stalled`  — nothing refuses it and the cycle has long passed. That is
 *                  a real problem state: the caller inks it as a warning and
 *                  counts it in "Needs a person". Never hidden.
 *
 * Pure: every state is the shared lane state (`nodeState` via `kApp`), every
 * hold the card's own precomputed `held`/`heldCause` (the shared held rule).
 * Moved out of `ControlCenter.svelte`, where round Q improvised it inline.
 */
import { availableReleases } from '$lib/releases/registry.svelte';
import type { RolloutCard } from '$lib/rollout-cards';
import type { KApp, KPlateModel } from '$lib/view-models/kstairs';
import { computeBakeProgress } from './bake-progress';
import { formatTimeAgoCompact } from '$lib/utils';

/**
 * One normal promotion cycle: the environment controller re-reads the
 * upstream deployment every `requeueInterval` (1m by default,
 * environment-controller `githubenvironment_controller.go`), then the
 * rollout controller reconciles the newly allowed candidate. Five minutes
 * covers both with room; past that, a wait nothing explains is a stall.
 */
export const NORMAL_CYCLE_MS = 5 * 60_000;

export type WaitCause =
	| { kind: 'bake'; place: string; upstream: string; id: string; leftMs: number | null }
	| { kind: 'approval'; place: string }
	| { kind: 'rule'; place: string; name: string; app: string | null }
	| { kind: 'window'; place: string; name: string }
	/** `waitedMs`: how long this wait has lasted so far (still inside the normal cycle). */
	| { kind: 'cycle'; place: string; usualMs: number; waitedMs?: number | null }
	| { kind: 'stalled'; place: string; id: string; forMs: number };

export type WaitCauseCtx = {
	now: Date;
	/** The id a person reads for a build: its PR number, else its short version. */
	idOf: (version: string | null | undefined) => string;
	isApproval: (c: RolloutCard) => boolean;
	cycleMs?: number;
};

const placeOf = (p: KPlateModel) => (p.set ? 'prod' : p.label);
const head = (c: RolloutCard) => c.rollout.status?.history?.[0];

/** The name of the rule that refuses the build here: a dependency's
 *  provider app, else the first non-passing gate that is not the
 *  environment's own promotion-order gate. */
export function ruleOf(c: RolloutCard): { name: string; app: string | null } | null {
	if (c.heldCause === 'dependency' && c.heldCauseLabel && c.heldCauseLabel !== 'a dependency') return { name: c.heldCauseLabel, app: c.heldCauseLabel };
	// The backend's `kind` decides (live gates are named ghd-*, not promotion-*); the name prefix only covers a summary that has no kind yet.
	// Minimal read of the summary's `kind` (#91); swap for gateKindOf once #92 lands.
	const isPromotion = (g: { name?: string; kind?: string }) => (g.kind ? g.kind === 'promotion' : !!g.name?.startsWith('promotion-'));
	const gate = (c.rollout.status?.gates ?? []).find((g) => g.passing === false && !isPromotion(g as { name?: string; kind?: string }));
	return gate?.name ? { name: gate.name, app: null } : null;
}

export function waitCause(m: KApp, ctx: WaitCauseCtx): WaitCause | null {
	const cycleMs = ctx.cycleMs ?? NORMAL_CYCLE_MS;
	for (let i = 0; i < m.plates.length; i++) {
		const p = m.plates[i];
		const place = placeOf(p);
		const held = p.nodes.filter((n) => n.state === 'held');
		if (held.length) {
			if (held.some((n) => ctx.isApproval(n.card))) return { kind: 'approval', place };
			const c = held[0].card;
			if (c.heldCause === 'clock' && c.heldCauseLabel) return { kind: 'window', place, name: c.heldCauseLabel };
			const r = ruleOf(c);
			if (r) return { kind: 'rule', place, ...r };
		}
		const behind = p.nodes.find((n) => n.state === 'behind');
		if (!behind && !held.length) continue;
		const up = i > 0 ? m.plates[i - 1] : null;
		if (up) {
			const baking = up.nodes.find((n) => n.state === 'checking');
			if (baking) {
				const h = head(baking.card);
				const prog = computeBakeProgress(h?.bakeStartTime, baking.card.rollout.spec?.bakeTime, ctx.now);
				return { kind: 'bake', place, upstream: placeOf(up), id: ctx.idOf(baking.card.version), leftMs: prog ? Math.max(0, prog.totalMs - prog.elapsedMs) : null };
			}
			// An upstream deploy in flight is the app's own headline; no wait to explain yet.
			if (up.nodes.some((n) => n.state === 'deploying')) return null;
			const src = up.nodes.find((n) => n.state === 'newest') ?? up.nodes[0];
			// Already running what upstream runs: this place is not the one waiting.
			if (!behind || (behind.card.version && behind.card.version === src.card.version)) continue;
			const h = head(src.card);
			const at = h?.bakeEndTime ?? h?.timestamp ?? null;
			const waited = at ? ctx.now.getTime() - Date.parse(at) : null;
			if (waited == null || waited <= cycleMs) return { kind: 'cycle', place, usualMs: cycleMs, waitedMs: waited };
			return { kind: 'stalled', place, id: ctx.idOf(src.card.version), forMs: waited };
		}
		// The first place: its upstream is CI. The newest release it has been offered.
		if (!behind) continue;
		const rel = [...(availableReleases(behind.card.rollout) ?? [])].sort((a, b) => Date.parse(b.created ?? '') - Date.parse(a.created ?? ''))[0];
		const waited = rel?.created ? ctx.now.getTime() - Date.parse(rel.created) : null;
		if (waited == null || waited <= cycleMs) return { kind: 'cycle', place, usualMs: cycleMs, waitedMs: waited };
		return { kind: 'stalled', place, id: ctx.idOf(rel?.version ?? rel?.tag ?? null), forMs: waited };
	}
	return null;
}

/** A span as the product prints it: `12m`, `6h`. */
export function spanText(ms: number): string {
	return formatTimeAgoCompact(new Date(0).toISOString(), new Date(Math.max(0, ms)));
}
