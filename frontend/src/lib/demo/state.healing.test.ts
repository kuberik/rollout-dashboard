import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { respond } from './respond';
import { getDetail, getScenarioFleetRollouts, hasFixture, resetDemoState } from './state';
import { CW_NAMESPACE, CW_NAME } from './mock-details';

/**
 * ⭐ ROUND 3 (squad-rollout, coordinator ruling, 2026-10-09): "history must
 * never rewrite a past failure." `healRolloutFailures` (state.ts) now only
 * ever heals `history[0]`, the CURRENT entry — a Failed entry below the
 * head must survive a reset in every scenario. A separate file from
 * `state.test.ts` so this round's change doesn't collide with other
 * concurrent edits there.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fleetRollout(namespace: string, name: string): any {
	return (getScenarioFleetRollouts() as any[]).find(
		(r) => r.metadata?.namespace === namespace && r.metadata?.name === name
	);
}

describe('healRolloutFailures — only the head, never a past record', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		resetDemoState();
		vi.useRealTimers();
	});

	it("calm: checkout-edge-prod's inserted Failed+rollback pair (below the head) survives a reset", () => {
		resetDemoState('calm');
		const r = fleetRollout('checkout-edge-prod', 'checkout-edge');
		expect(r).toBeDefined();
		const history = r.status.history as { version: { tag: string }; bakeStatus?: string }[];
		const failedEntry = history.find((h) => h.version.tag === '62d1c05');
		expect(failedEntry?.bakeStatus).toBe('Failed');
		// The head (the live, currently-running build) is untouched by this
		// assertion — it is `d09e6f4`, several entries newer, and this test
		// is about the entry BELOW it.
		expect(history[0].version.tag).not.toBe('62d1c05');
	});

	it("incident: checkout-edge-prod's Failed entry survives too — healing is scenario-independent for past entries", () => {
		resetDemoState('incident');
		const r = fleetRollout('checkout-edge-prod', 'checkout-edge');
		const history = r.status.history as { version: { tag: string }; bakeStatus?: string }[];
		const failedEntry = history.find((h) => h.version.tag === '62d1c05');
		expect(failedEntry?.bakeStatus).toBe('Failed');
	});

	it("calm: orders-api/dev's own documented 03:00 historical incident entry survives", () => {
		resetDemoState('calm');
		const r = fleetRollout('orders-api-dev', 'orders-api');
		expect(r).toBeDefined();
		const history = r.status.history as { bakeStatus?: string; message?: string }[];
		const historicalIncident = history.find((h) => h.message === 'Hotfix — checkout latency spike');
		expect(historicalIncident?.bakeStatus).toBe('Failed');
		// The invariant this round's fix must NOT break: the HEAD is still
		// healthy in calm — `orders-api/dev`'s own FLEET entry is
		// `Succeeded` by construction, so this is really just confirming
		// the head was never Failed to begin with, not a heal.
		expect(history[0].bakeStatus).not.toBe('Failed');
	});

	it('calm: a currently-failed HEAD is still healed to Succeeded — the invariant this round keeps', () => {
		resetDemoState('calm');
		expect(hasFixture(CW_NAMESPACE, CW_NAME)).toBe(true);
		const detail = getDetail(CW_NAMESPACE, CW_NAME) as {
			rollout: { status: { history: { bakeStatus?: string }[] } };
		};
		expect(detail.rollout.status.history[0].bakeStatus).toBe('Succeeded');
	});

	it('incident: the designated incident rollout keeps its natural head Failed state', () => {
		resetDemoState('incident');
		const detail = getDetail(CW_NAMESPACE, CW_NAME) as {
			rollout: { status: { history: { bakeStatus?: string }[] } };
		};
		expect(detail.rollout.status.history[0].bakeStatus).toBe('Failed');
	});

	/**
	 * ⭐ ROUND 3, FOLLOW-UP (squad lead, 2026-10-09, art-director finding):
	 * the incident's one failure must hold until a RESET or a USER ACTION
	 * (Retry / Roll back / Change version) — never drift back to healthy on
	 * its own with the clock. Audited `state.ts` for anything that could do
	 * that on a GET alone: `freshenInFlight` (re-run on every read, per the
	 * U-4 fix) only ever touches a head entry's `timestamp`/`bakeStartTime`
	 * — never `bakeStatus` — and its own ceiling for a non-InProgress/
	 * Deploying status (`HEAD_MAX_AGE_MIN`, 20h) is far outside the 60
	 * minutes this test advances. `retryRollout` is the ONLY code path that
	 * writes `bakeStatus` outside `resetDemoState`, and it only runs from an
	 * explicit `POST …/retry` — there is no `setInterval`/scheduled call
	 * into it anywhere in this file. So an observed FAILED → DEPLOYED flip
	 * with no reset is a Retry some OTHER session pressed against the same
	 * shared mock server, not a clock-driven heal — this test is the
	 * negative case that proves the clock alone cannot do it.
	 */
	it('incident: the failure survives 60 minutes of clock advance with no reset and no user action', () => {
		resetDemoState('incident');
		vi.useFakeTimers();
		vi.setSystemTime(Date.now() + 60 * 60_000);
		const body = JSON.parse(respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}`).body ?? '{}') as {
			rollout: { status: { history: { bakeStatus?: string }[] } };
		};
		expect(body.rollout.status.history[0].bakeStatus).toBe('Failed');

		// And the SAME is true read through the fleet-wide list every other
		// page (Home, /rollouts, /activity) reads — not just the detail route.
		const list = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as {
			rollouts: { items: { metadata: { namespace: string; name: string }; status: { history?: { bakeStatus?: string }[] } }[] };
		};
		const cw = list.rollouts.items.find(
			(r) => r.metadata.namespace === CW_NAMESPACE && r.metadata.name === CW_NAME
		);
		expect(cw?.status.history?.[0]?.bakeStatus).toBe('Failed');
	});
});
