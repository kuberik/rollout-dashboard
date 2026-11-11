/**
 * Round 2 B5 — "how many builds does this place's hold refuse HERE", computed from a rollout DETAIL response (the fleet list lacks the gate
 * objects that tell the chain gate from an approval) with lane A's one rule (`held.ts` heldBuilds), exactly as the Gates tab computes it.
 */
import type { Rollout, Environment } from '../../types';
import { buildGateContext, promotionHoldBreakdown } from './blocking-story';
import { heldBuilds } from './held';

type Detail = { rollout?: Rollout | null; environment?: Environment | null; rolloutGates?: unknown } | null | undefined;

export function heldHereOfDetail(d: Detail): { count: number; ids: Set<string>; waiting: number; stage: string | null } | null {
	if (!d?.rollout) return null;
	const placeEnv = d.environment?.spec?.environment ?? null;
	const ctx = buildGateContext({ environments: d.environment ? { items: [d.environment] } : null, rolloutDependencies: { items: [] }, rollouts: [d.rollout], rolloutGates: (d.rolloutGates ?? null) as never });
	const { held, waiting } = heldBuilds(promotionHoldBreakdown(d.rollout, ctx, { place: placeEnv }), placeEnv);
	return { count: held.length, ids: new Set(held.map((h) => h.build)), waiting: waiting.length, stage: waiting[0]?.stage ?? null };
}
