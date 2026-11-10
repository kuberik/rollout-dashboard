import { describe, it, expect, vi, afterEach } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { CW_NAMESPACE, CW_NAME } from './mock-details';
import { buildRolloutCards, detectRolloutStuck } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { isNeedsYou } from '$lib/view-models/fleet-groups';
import { rolloutMatchesEnvironment } from '$lib/source-dashboard';
import type { Rollout, Environment } from '../../types';

/**
 * ⛔ THE U-4 CLASS BUG: A DEV SERVER LEFT RUNNING AGES BACK INTO "STUCK"
 * (2026-10-09, coordinator finding — art director kept seeing "N need you"
 * reappear roughly an hour after a reset, on a server nobody touched).
 *
 * `f3fb44c`/`f984340` fixed the release-calendar rot by moving `created`
 * dates onto `hcAgo()`, and `freshenInFlight` (`state.ts`) clamped the
 * in-flight bake head so a `CHECKING`/`DEPLOYING` card never read as
 * `STUCK` on its own 1h threshold. Both fixes only ran once — at
 * `resetDemoState()` — because `hcAgo()`/`hcNow` are evaluated at RESET or
 * at PROCESS START, and nothing re-applied either clamp on a plain GET.
 * A capture resets right before recording, so this never showed there; a
 * dev server left open with nobody pressing a button (exactly the calm
 * story, and exactly what an idle film take looks like) just watched real
 * wall-clock time carry every one of those timestamps past its threshold
 * all over again.
 *
 * Three distinct predicates read three different timestamp sources, and
 * all three rotted the same way — confirmed by advancing the clock with NO
 * reset in between and watching each one light up before the fix below:
 *
 *   1. `detectStuck` (utils.ts) — a rollout's OWN head `timestamp`, >1h ago
 *      while `InProgress`/`Deploying`. (`freshenInFlight`, pre-existing,
 *      just never re-run on read.)
 *   2. `detectStuckPromotion` (`promotion.ts`) — the newest UNCLAIMED
 *      release's `created` (`availableReleases`/`releaseCandidates`), >24h
 *      old. New: `freshenCandidateAge`.
 *   3. `detectStuckBehind` (`utils.ts`) — a PEER rollout's own head
 *      `timestamp`, >24h old — this one reads a timestamp that ISN'T even
 *      `InProgress`/`Deploying`, which is why `freshenInFlight`'s old
 *      bake-status guard had to go, not just gain a read-time call site.
 *
 * All three are fixed by the SAME mechanism: `getScenarioFleetRollouts`/
 * `getScenarioDepRollouts`/`getDetail` (`state.ts`) now re-run
 * `freshenInFlight`+`freshenCandidateAge` on EVERY call, not just at
 * reset, clamped against `peekDemoClock()` which itself self-heals toward
 * real wall time on every call (`ensureClockFresh`) — so "in flight" and
 * "released recently" both read as fresh forever on an idle server, with
 * no second reset required.
 *
 * This test proves it the way the coordinator reproduced the bug: reset
 * ONCE, then advance the clock — via `vi.setSystemTime`, since every
 * consumer here (`$now`/`new Date()` in `detectRolloutStuck`'s callers) is
 * real wall-clock, never the demo clock — by 6h and by 3 days, with NO
 * further reset, and read `/api/rollouts` (not the raw fixture exports)
 * so every list/detail/events/health-check/history/activity/Home/`/apps`
 * reader gets the same answer this test checks.
 */
describe.each([
	['6h later, no reset', 6 * 60 * 60 * 1000],
	['3 days later, no reset', 3 * 24 * 60 * 60 * 1000]
] as const)('the demo clock does not re-rot the stuck/needs-you sets (%s)', (_label, advanceMs) => {
	afterEach(() => {
		vi.useRealTimers();
	});

	function rolloutsAndEnvironmentsAfter(scenario: 'calm' | 'incident') {
		resetDemoState(scenario);
		vi.useFakeTimers();
		vi.setSystemTime(Date.now() + advanceMs);
		const body = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		return {
			rollouts: body.rollouts.items as Rollout[],
			environments: body.environments.items as Environment[]
		};
	}

	describe.each(['calm', 'incident'] as const)('%s scenario', (scenario) => {
		it('the stuck set (detectRolloutStuck, same join buildRolloutCards and /apps/[name] use) stays empty', () => {
			const { rollouts, environments } = rolloutsAndEnvironmentsAfter(scenario);
			const gateContext = buildGateContext({
				environments: { items: environments },
				rolloutDependencies: null
			});

			// Surface A: Home / `/rollouts` / the command palette.
			const cards = buildRolloutCards(rollouts, environments, new Date(), gateContext);
			const cardStuck = cards.filter((c) => c.stuck != null).map((c) => `${c.ns}/${c.name}`);
			expect(cardStuck).toEqual([]);

			// Surface B: `/apps/[name]`, `/environments`, `/envs/[name]` —
			// the direct per-rollout `detectRolloutStuck` call, with every
			// OTHER environment of the SAME app as its peers (what those
			// three pages each separately compose).
			for (const r of rollouts) {
				const appPeers = rollouts
					.filter((peer) => peer !== r && peer.metadata?.name === r.metadata?.name)
					.map((peer) => {
						const env = environments.find((e) => rolloutMatchesEnvironment(peer, e));
						return { envName: env?.spec?.environment ?? '', rollout: peer };
					});
				const reason = detectRolloutStuck(r, appPeers, { now: new Date(), gateContext });
				expect(reason, `${r.metadata?.namespace}/${r.metadata?.name} should not be stuck`).toBeNull();
			}
		});

		it('the Home "needs you" set is unchanged — empty in calm, exactly checkout-worker/staging in incident', () => {
			const { rollouts, environments } = rolloutsAndEnvironmentsAfter(scenario);
			const gateContext = buildGateContext({
				environments: { items: environments },
				rolloutDependencies: null
			});
			const cards = buildRolloutCards(rollouts, environments, new Date(), gateContext);
			const needsYou = cards.filter(isNeedsYou).map((c) => `${c.ns}/${c.name}`);

			if (scenario === 'calm') {
				expect(needsYou).toEqual([]);
			} else {
				// ⛔ ROUND 5 QA-5, ITEM 2 (2026-10-09) — `incident` IS EXACTLY
				// ONE FAILURE AGAIN. `telemetry-forwarder/prod` moved to its
				// own `wide` scenario (`TM_ALWAYS_FAILED_KEY` in state.ts) —
				// `incident`'s own contract ("exactly one failure", the
				// landing film's "one failure, late" rule) is restored here.
				// checkout-worker's failed deploy on staging needs you
				// because `statusKey === 'failed'` (a terminal state
				// `healRolloutFailures` never touches for the designated
				// incident fixture), not because of any clock-relative
				// predicate — so it is expected to show up here untouched
				// by the clock advance.
				expect([...needsYou].sort()).toEqual([`${CW_NAMESPACE}/${CW_NAME}`]);
			}
		});
	});
});
