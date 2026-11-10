import { describe, expect, it } from 'vitest';
import { HF_LANES, mkHfRollout } from './mock-data';
import { deployActs } from '$lib/history-marks';

/**
 * Lane H's own fixture test (squad-rollout spec §1): `checkout-edge-prod`
 * now carries one failed deploy followed by a rollback, and one
 * person-triggered deploy with a note — a separate file so it does not
 * collide with `mocklinks`' own edits to `mock-data.ts` elsewhere.
 */
describe('checkout-edge-prod history fixture', () => {
	const prodLane = HF_LANES.find((l) => l.env === 'prod')!;
	const rollout = mkHfRollout(prodLane);

	it('has at least one Failed entry, and the entry right before it (chronologically) is a rollback', () => {
		const history = rollout.status.history;
		const failedIdx = history.findIndex((h: { bakeStatus?: string }) => h.bakeStatus === 'Failed');
		expect(failedIdx).toBeGreaterThanOrEqual(0);
		// `history` is newest-first, so the rollback (the deploy that FOLLOWED
		// the failure in real time) is at a SMALLER index.
		const acts = deployActs(rollout as never);
		const rollbackIdx = failedIdx - 1;
		expect(acts[rollbackIdx]?.kind).toBe('rollback');
	});

	it('has at least one person-triggered deploy with a recorded note', () => {
		const history = rollout.status.history as {
			message?: string;
			triggeredBy?: { kind?: string };
		}[];
		const noted = history.find((h) => h.triggeredBy?.kind === 'User' && h.message);
		expect(noted).toBeDefined();
	});

	it("did not move the lane's own head — still InProgress on d09e6f4", () => {
		expect(rollout.status.history[0].version.tag).toBe('d09e6f4');
		expect(rollout.status.history[0].bakeStatus).toBe('InProgress');
	});
});
