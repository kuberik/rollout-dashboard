import { describe, it, expect, vi, afterEach } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { CK_NAMESPACE, CK_NAME, CW_NAMESPACE, CW_NAME } from './mock-details';
import { buildRolloutCards, detectRolloutStuck } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { isNeedsYou } from '$lib/view-models/fleet-groups';
import { rolloutMatchesEnvironment } from '$lib/source-dashboard';
import type { Rollout, Environment } from '../../types';

/**
 * ⛔ A THIRD LAYER OF THE SAME U-4 CLASS BUG (2026-10-10). `clock-rot.test.ts`
 * already proved `freshenInFlight`/`freshenCandidateAge` keep the STUCK and
 * NEEDS-YOU predicates from re-rotting on an idle, never-reset dev server.
 * This file proves the layer underneath: a deploying/checking build's own
 * detail page prints "started"/"since" off THREE sources, and only one of
 * them (`history[0].timestamp`/`bakeStartTime`) was ever re-clamped on read.
 * Measured with `vi.setSystemTime`, reset once, no further reset: 6h idle
 * put checkout-api's Pending health check's `lastChangeTime` 369 minutes
 * old and its "Recent events" 365-390 minutes old, while the (already
 * fixed) head timestamp correctly read 25 minutes — three disagreeing
 * answers to "when did this build start" on one page. `freshenAssociated-
 * Timestamps` (`state.ts`) now shifts health-check and event timestamps
 * forward by the exact delta the head got clamped by, so every field keeps
 * the SAME relative story (which check settled how many minutes into the
 * deploy) instead of drifting apart. See that function's own doc comment.
 *
 * This test reads through `respond()` — `/api/rollouts` (the fleet/dep
 * lists) and `/api/rollouts/:ns/:name` + `/health-checks` + `/events` (the
 * three live fixtures' detail pages) — exactly what a browser tab open on
 * Home or a rollout detail page would fetch, never the raw state exports.
 */

const IN_FLIGHT_CEILING_MIN = 25; // IN_FLIGHT_MAX_MIN, state.ts
// Generous slack over the raw ceiling: the fixtures' own health-check/event
// timestamps are authored a few minutes to half an hour BEFORE the head's
// original (pre-clamp) timestamp (see mock-details.ts's `hcAgo(9)`,
// `hcAgo(0.3)`, `hcAgo(30)`), and the fix preserves that offset rather than
// collapsing every field to the identical instant — so a check that was
// always "30 minutes before the deploy's own clamp window" stays there.
// Comfortably under `detectStuck`'s own 1h/60min threshold either way.
const DISPLAY_CEILING_MIN = 59;

type LiveBuild = { namespace: string; name: string; label: string };
const LIVE_BUILDS: LiveBuild[] = [
	{ namespace: CK_NAMESPACE, name: CK_NAME, label: 'checkout-api (checking, every scenario)' }
];

function ageMin(iso: string | undefined, nowMs: number): number | null {
	if (!iso) return null;
	const at = new Date(iso).getTime();
	if (!Number.isFinite(at)) return null;
	return (nowMs - at) / 60_000;
}

function readBuild(namespace: string, name: string, nowMs: number) {
	const detail = JSON.parse(respond('GET', `/api/rollouts/${namespace}/${name}`).body ?? '{}');
	const hc = JSON.parse(
		respond('GET', `/api/rollouts/${namespace}/${name}/health-checks`).body ?? '{}'
	);
	const ev = JSON.parse(respond('GET', `/api/rollouts/${namespace}/${name}/events`).body ?? '{}');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const head = (detail as any).rollout?.status?.history?.[0];
	return {
		bakeStatus: head?.bakeStatus as string | undefined,
		headAgeMin: ageMin(head?.timestamp, nowMs),
		bakeStartAgeMin: ageMin(head?.bakeStartTime, nowMs),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		healthCheckAgesMin: ((hc as any).healthChecks ?? []).flatMap((h: any) => {
			const ages: number[] = [];
			const a = ageMin(h.status?.lastChangeTime, nowMs);
			const b = ageMin(h.status?.lastErrorTime, nowMs);
			if (a !== null) ages.push(a);
			if (b !== null) ages.push(b);
			return ages;
		}),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		eventAgesMin: ((ev as any).events ?? []).flatMap((e: any) => {
			const ages: number[] = [];
			for (const field of ['lastTimestamp', 'firstTimestamp', 'eventTime']) {
				const a = ageMin(e[field], nowMs);
				if (a !== null) ages.push(a);
			}
			return ages;
		})
	};
}

describe.each(['calm', 'incident', 'wide'] as const)('scenario %s', (scenario) => {
	describe.each([
		['1h later, no reset', 60 * 60 * 1000],
		['6h later, no reset', 6 * 60 * 60 * 1000],
		['3 days later, no reset', 3 * 24 * 60 * 60 * 1000]
	] as const)('%s', (_label, advanceMs) => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it('every deploying/checking build reads a plausible, bounded, non-rotting start — and agrees across head/bakeStartTime/health-checks/events', () => {
			resetDemoState(scenario);
			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + advanceMs);
			const nowMs = Date.now();

			for (const build of LIVE_BUILDS) {
				const read = readBuild(build.namespace, build.name, nowMs);
				expect(
					read.bakeStatus,
					`${build.label} should still be in flight`
				).toMatch(/^(InProgress|Deploying)$/);

				expect(
					read.headAgeMin,
					`${build.label} head timestamp age`
				).not.toBeNull();
				expect(read.headAgeMin!).toBeLessThanOrEqual(IN_FLIGHT_CEILING_MIN + 0.01);
				expect(read.headAgeMin!).toBeGreaterThanOrEqual(0);

				// `bakeStartTime`, when present, is stamped identically to the
				// head's own clamped timestamp — see `freshenInFlight`.
				if (read.bakeStartAgeMin !== null) {
					expect(read.bakeStartAgeMin).toBeCloseTo(read.headAgeMin!, 3);
				}

				// Every health-check and event timestamp this build's page prints
				// stays bounded — never the unclamped rot (369min/4329min this
				// bug measured at 6h/3-day idle before the fix) and never past
				// `detectStuck`'s own 1h threshold, so nothing on the page reads
				// as later than the build itself.
				for (const age of [...read.healthCheckAgesMin, ...read.eventAgesMin]) {
					expect(age, `${build.label} associated timestamp age`).toBeLessThanOrEqual(
						DISPLAY_CEILING_MIN
					);
					expect(age).toBeGreaterThanOrEqual(-0.01); // never in the future
				}
			}
		});

		it('re-reading at the SAME advanced instant is idempotent — ages do not keep climbing on repeated GETs', () => {
			resetDemoState(scenario);
			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + advanceMs);
			const nowMs = Date.now();

			for (const build of LIVE_BUILDS) {
				const first = readBuild(build.namespace, build.name, nowMs);
				const second = readBuild(build.namespace, build.name, nowMs);
				expect(second.headAgeMin).toBeCloseTo(first.headAgeMin!, 3);
				expect(second.healthCheckAgesMin).toEqual(first.healthCheckAgesMin);
				expect(second.eventAgesMin).toEqual(first.eventAgesMin);
			}
		});

		it('scenario invariants still hold (stuck set empty, needs-you unchanged)', () => {
			resetDemoState(scenario);
			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + advanceMs);

			const body = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
			const rollouts = body.rollouts.items as Rollout[];
			const environments = body.environments.items as Environment[];
			const gateContext = buildGateContext({
				environments: { items: environments },
				rolloutDependencies: null
			});

			const cards = buildRolloutCards(rollouts, environments, new Date(), gateContext);
			expect(cards.filter((c) => c.stuck != null).map((c) => `${c.ns}/${c.name}`)).toEqual([]);

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

			const needsYou = cards.filter(isNeedsYou).map((c) => `${c.ns}/${c.name}`);
			if (scenario === 'calm') {
				expect(needsYou).toEqual([]);
			} else if (scenario === 'incident') {
				// exactly checkout-worker/staging's own terminal `Failed`
				// state — never a clock-relative predicate.
				expect([...needsYou].sort()).toEqual([`${CW_NAMESPACE}/${CW_NAME}`]);
			} else {
				// `wide` (review-only, round 5 QA-5 item 2) adds
				// telemetry-forwarder/prod as its own always-failed fixture
				// (`TM_ALWAYS_FAILED_KEY`, state.ts) alongside checkout-worker —
				// both terminal `Failed` states, never clock-relative.
				expect([...needsYou].sort()).toEqual(
					[`${CW_NAMESPACE}/${CW_NAME}`, 'telemetry-forwarder-prod/telemetry-forwarder'].sort()
				);
			}
		});
	});
});
