import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	changeVersion,
	demoClockSnapshot,
	getDetail,
	getEvents,
	getHealthChecks,
	getManagedResources,
	getPermissionsAll,
	hasFixture,
	registerStreamSubscriber,
	resetDemoState,
	retryRollout,
	runGateSequence
} from './state';
import { NAMESPACE, ROLLOUT_NAME, hcNow } from './mock-data';
import { CK_NAMESPACE, CK_NAME, CW_NAMESPACE, CW_NAME } from './mock-details';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rolloutStatus(namespace: string, name: string): any {
	return (getDetail(namespace, name) as any).rollout.status;
}

describe('state.ts — the mock actually does something when you press it', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetDemoState();
	});

	afterEach(() => {
		resetDemoState();
		vi.useRealTimers();
	});

	it('hasFixture is true only for the three rollouts the film presses buttons on', () => {
		expect(hasFixture(NAMESPACE, ROLLOUT_NAME)).toBe(true);
		expect(hasFixture(CK_NAMESPACE, CK_NAME)).toBe(true);
		expect(hasFixture(CW_NAMESPACE, CW_NAME)).toBe(true);
		expect(hasFixture('some-namespace', 'some-app')).toBe(false);
	});

	it('getPermissionsAll answers the actionable shape for ANY namespace/name, not just hello-world', () => {
		const forHelloWorld = getPermissionsAll(NAMESPACE, ROLLOUT_NAME);
		const forSomeoneElse = getPermissionsAll('checkout-api-prod-us-east-2', 'checkout-api');
		expect(forHelloWorld.permissions).toEqual({ update: true, patch: true, approve: true });
		expect(forSomeoneElse.permissions).toEqual({ update: true, patch: true, approve: true });
		expect(forSomeoneElse.resource).toMatchObject({
			namespace: 'checkout-api-prod-us-east-2',
			name: 'checkout-api'
		});
	});

	it('hello-world ships availableReleases with a build newer than the current one (task B)', () => {
		const status = rolloutStatus(NAMESPACE, ROLLOUT_NAME);
		const releases = status.availableReleases as { tag: string; created: string }[];
		expect(releases.length).toBeGreaterThanOrEqual(2);
		const currentIdx = releases.findIndex((r) => r.tag === status.currentVersion);
		expect(currentIdx).toBeGreaterThanOrEqual(0);
		expect(currentIdx).toBeLessThan(releases.length - 1); // something newer exists after it
	});

	it('hello-world and checkout-api populate releaseCandidates, not just availableReleases — the rollout page reads releaseCandidates directly, never derives it', () => {
		const hw = rolloutStatus(NAMESPACE, ROLLOUT_NAME);
		// `revision` is part of the shape on purpose: `ChangeVersionModal`'s
		// `currentRevision`/`selectedRevision` resolve a build's git sha off
		// it, and without it the deploy dialog can ask GitHub nothing.
		expect(hw.releaseCandidates).toEqual([
			{
				tag: 'e2c9b47',
				version: 'e2c9b47',
				revision: 'e2c9b47',
				created: hw.availableReleases[2].created
			}
		]);

		const ck = rolloutStatus(CK_NAMESPACE, CK_NAME);
		expect(ck.releaseCandidates.map((r: { tag: string }) => r.tag)).toEqual(['b-45', 'b-44', 'b-43']);
	});

	it('hello-world has real events in the BASE fixture, not only under MOCK_FAIL', () => {
		const events = getEvents(NAMESPACE, ROLLOUT_NAME)?.events ?? [];
		expect(events.length).toBeGreaterThanOrEqual(3);
		expect(events.some((e) => (e as { type?: string }).type === 'Normal')).toBe(true);
	});

	/**
	 * ⭐ THE `Warning` EVENT MOVED FROM "always present" TO "present in the
	 * scenario that has a failure". (2026-09-13.) A `Warning` row draws the
	 * adverse glyph in a rail card, so `calm` — whose promise is that nothing
	 * on any page is failing — may not carry one anywhere; `EventsCard`'s info
	 * glyph still has its reachable Warning state, on the incident rollout.
	 */
	it('calm carries no Warning event on any live fixture; incident carries them only on checkout-worker', () => {
		const warningsIn = (ns: string, n: string) =>
			(getEvents(ns, n)?.events ?? []).filter((e) => (e as { type?: string }).type === 'Warning');

		resetDemoState('calm');
		expect(warningsIn(NAMESPACE, ROLLOUT_NAME)).toHaveLength(0);
		expect(warningsIn(CK_NAMESPACE, CK_NAME)).toHaveLength(0);
		expect(warningsIn(CW_NAMESPACE, CW_NAME)).toHaveLength(0);

		resetDemoState('incident');
		expect(warningsIn(NAMESPACE, ROLLOUT_NAME)).toHaveLength(0);
		expect(warningsIn(CK_NAMESPACE, CK_NAME)).toHaveLength(0);
		expect(warningsIn(CW_NAMESPACE, CW_NAME).length).toBeGreaterThan(0);

		resetDemoState('calm');
	});

	/**
	 * `detectStuck` calls an in-flight deploy STUCK at one hour, and the film's
	 * first screen may not open on one — see `freshenInFlight`. This asserts
	 * the DATA condition that produces the chip, in both scenarios, rather
	 * than the chip itself.
	 */
	it('no in-flight deploy is older than the stuck threshold, in either scenario', () => {
		for (const scenario of ['calm', 'incident'] as const) {
			resetDemoState(scenario);
			for (const [ns, n] of [
				[NAMESPACE, ROLLOUT_NAME],
				[CK_NAMESPACE, CK_NAME],
				[CW_NAMESPACE, CW_NAME]
			] as const) {
				const head = rolloutStatus(ns, n).history[0];
				if (head.bakeStatus !== 'InProgress' && head.bakeStatus !== 'Deploying') continue;
				const ageMin = (Date.now() - new Date(head.timestamp).getTime()) / 60_000;
				expect(ageMin).toBeLessThan(60);
			}
		}
		resetDemoState('calm');
	});

	/** A healed rollout's workload is healed with it — see `allReplicasReady`. */
	it('calm leaves no half-ready Deployment on any live fixture', () => {
		resetDemoState('calm');
		for (const [ns, n] of [
			[NAMESPACE, ROLLOUT_NAME],
			[CK_NAMESPACE, CK_NAME],
			[CW_NAMESPACE, CW_NAME]
		] as const) {
			for (const r of getManagedResources(ns, n) ?? []) {
				const res = r as { groupVersionKind?: string; status?: string; object?: { spec?: { replicas?: number }; status?: { readyReplicas?: number } } };
				if (res.groupVersionKind !== 'apps/v1/Deployment') continue;
				expect(res.status).toBe('Current');
				expect(res.object?.status?.readyReplicas).toBe(res.object?.spec?.replicas);
			}
		}
	});

	it('checkout-api-prod-us-east-2/checkout-api has health checks, resources, events and one Pending check', () => {
		const health = getHealthChecks(CK_NAMESPACE, CK_NAME);
		expect(health).toBeTruthy();
		const statuses = health!.healthChecks.map((h) => (h as { status: { status: string } }).status.status);
		expect(statuses.filter((s) => s === 'Pending')).toHaveLength(1);
		expect(statuses.filter((s) => s === 'Healthy')).toHaveLength(2);

		const resources = getManagedResources(CK_NAMESPACE, CK_NAME);
		expect(resources && resources.length).toBeGreaterThan(0);

		const events = getEvents(CK_NAMESPACE, CK_NAME);
		expect(events && events.events.length).toBeGreaterThan(0);
	});

	it('checkout-worker-staging/checkout-worker starts Failed with an Unhealthy check reachable, under the incident scenario', () => {
		resetDemoState('incident');
		const status = rolloutStatus(CW_NAMESPACE, CW_NAME);
		expect(status.history[0].bakeStatus).toBe('Failed');
		expect(status.history[0].failedHealthChecks?.length).toBeGreaterThan(0);
		// Matches the FLEET spec another lane owns — never re-derived here.
		expect(status.currentVersion).toBe('a02f1c4');
		expect(status.previousVersion).toBe('3f1ed09');

		const health = getHealthChecks(CW_NAMESPACE, CW_NAME);
		const unhealthy = health!.healthChecks.filter(
			(h) => (h as { status: { status: string } }).status.status === 'Unhealthy'
		);
		expect(unhealthy).toHaveLength(1);
	});

	describe('retryRollout — checkout-worker-staging/checkout-worker', () => {
		it('flips to Deploying immediately, clearing the failure, then settles Succeeded + recovers health at +5s', () => {
			// Retry only means something starting from the incident scenario's
			// one designated failure — `calm` (the default) has already healed
			// this rollout, and the tl's own requirement is "retry in the
			// incident scenario must still work and must still settle to healthy".
			resetDemoState('incident');
			const ok = retryRollout(CW_NAMESPACE, CW_NAME, 'staging');
			expect(ok).toBe(true);

			const afterRetry = rolloutStatus(CW_NAMESPACE, CW_NAME).history[0];
			expect(afterRetry.bakeStatus).toBe('Deploying');
			expect(afterRetry.bakeStatusMessage).toBeUndefined();
			expect(afterRetry.failedHealthChecks).toBeUndefined();
			expect(afterRetry.bakeEndTime).toBeUndefined();

			// Same version — a new ATTEMPT, not a new deploy.
			expect(afterRetry.version.tag).toBe('a02f1c4');

			vi.advanceTimersByTime(4_999);
			expect(rolloutStatus(CW_NAMESPACE, CW_NAME).history[0].bakeStatus).toBe('Deploying');

			vi.advanceTimersByTime(1);
			const settled = rolloutStatus(CW_NAMESPACE, CW_NAME).history[0];
			expect(settled.bakeStatus).toBe('Succeeded');
			expect(settled.bakeEndTime).toBeTruthy();

			const health = getHealthChecks(CW_NAMESPACE, CW_NAME);
			const unhealthy = health!.healthChecks.filter(
				(h) => (h as { status: { status: string } }).status.status === 'Unhealthy'
			);
			expect(unhealthy).toHaveLength(0);
		});

		it('returns false for a rollout with no live fixture', () => {
			expect(retryRollout('nope', 'nope')).toBe(false);
		});

		// S-2/S-7, 2026-10-08 (coordinator): the retry must read as two real
		// phases on film (~2.5s deploying, then ~2.5s health checks), and
		// Recent events must gain all four of the retry's own beats in
		// order, each with a real, distinct demo-clock timestamp.
		it('logs its four beats in order, each a real timestamp apart, health resolving before the bake settles', () => {
			resetDemoState('incident');
			retryRollout(CW_NAMESPACE, CW_NAME, 'staging');

			const reasonsSoFar = () =>
				getEvents(CW_NAMESPACE, CW_NAME)!.events.map((e) => (e as { reason: string }).reason);
			expect(reasonsSoFar()[0]).toBe('Retry');

			vi.advanceTimersByTime(400);
			expect(reasonsSoFar()[0]).toBe('ScalingReplicaSet');
			expect(reasonsSoFar()[1]).toBe('Retry');
			// Health still unresolved — the "deploying" phase alone, nothing
			// about the checks has happened yet.
			let health = getHealthChecks(CW_NAMESPACE, CW_NAME)!;
			expect(
				health.healthChecks.some((h) => (h as { status: { status: string } }).status.status === 'Pending')
			).toBe(true);
			expect(rolloutStatus(CW_NAMESPACE, CW_NAME).history[0].bakeStatus).toBe('Deploying');

			vi.advanceTimersByTime(2_200); // now at t+2.6s: RETRY_CHECKS_PASSING_MS
			expect(reasonsSoFar()[0]).toBe('HealthChecksPassed');
			health = getHealthChecks(CW_NAMESPACE, CW_NAME)!;
			expect(
				health.healthChecks.some((h) => (h as { status: { status: string } }).status.status === 'Pending')
			).toBe(false);
			// Checks resolved, but the bake itself is not yet called done —
			// the two phases are genuinely sequential, not simultaneous.
			expect(rolloutStatus(CW_NAMESPACE, CW_NAME).history[0].bakeStatus).toBe('Deploying');

			vi.advanceTimersByTime(2_400); // now at t+5s: RETRY_SETTLE_MS
			expect(reasonsSoFar()[0]).toBe('BakeSucceeded');
			expect(rolloutStatus(CW_NAMESPACE, CW_NAME).history[0].bakeStatus).toBe('Succeeded');

			// All four, oldest last (events are unshifted newest-first).
			const all = reasonsSoFar();
			expect(all.slice(0, 4)).toEqual(['BakeSucceeded', 'HealthChecksPassed', 'ScalingReplicaSet', 'Retry']);
			// Real, distinct demo-clock timestamps — not four copies of one.
			const timestamps = getEvents(CW_NAMESPACE, CW_NAME)!
				.events.slice(0, 4)
				.map((e) => (e as { lastTimestamp: string }).lastTimestamp);
			expect(new Set(timestamps).size).toBe(4);
		});

		// U-3, 2026-10-08: a mutation on a server nobody has reset in a while
		// must still stamp "now", not the stale anchor from whenever the
		// server started — see `demoNow`'s own note in state.ts.
		it('self-heals the demo clock once it drifts past a mutation\'s own tolerance', () => {
			resetDemoState('incident');
			vi.setSystemTime(Date.now() + 11 * 60_000); // 11 minutes idle, no reset
			retryRollout(CW_NAMESPACE, CW_NAME, 'staging');
			const head = rolloutStatus(CW_NAMESPACE, CW_NAME).history[0];
			const ageMs = Date.now() - new Date(head.timestamp).getTime();
			expect(ageMs).toBeLessThan(5_000);
		});
	});

	describe('changeVersion — promote / change version / force deploy', () => {
		it('defaults to the newest available build when the body names none, on hello-world', () => {
			const status = rolloutStatus(NAMESPACE, ROLLOUT_NAME);
			const newest = status.availableReleases[status.availableReleases.length - 1].tag;

			changeVersion(NAMESPACE, ROLLOUT_NAME, {}, 'dev');

			const after = rolloutStatus(NAMESPACE, ROLLOUT_NAME);
			expect(after.currentVersion).toBe(newest);
			expect(after.wantedVersion).toBe(newest);
			expect(after.history[0].version.tag).toBe(newest);
			expect(after.history[0].bakeStatus).toBe('Deploying');
		});

		it('deploys the requested build on checkout-api, flips the Pending check at +3s, settles at +6s', () => {
			const status = rolloutStatus(CK_NAMESPACE, CK_NAME);
			const target = status.availableReleases[status.availableReleases.length - 1].tag; // b-45
			const previousHeadCount = status.history.length;
			const previousHeadBake = status.history[0].bakeStatus; // whatever it was — untouched by the promote

			changeVersion(CK_NAMESPACE, CK_NAME, { version: target }, 'prod');

			const afterDeploy = rolloutStatus(CK_NAMESPACE, CK_NAME);
			expect(afterDeploy.currentVersion).toBe(target);
			expect(afterDeploy.history.length).toBe(previousHeadCount + 1); // NEW entry prepended
			expect(afterDeploy.history[0].bakeStatus).toBe('Deploying');
			expect(afterDeploy.history[1].bakeStatus).toBe(previousHeadBake); // old head untouched
			// The just-deployed build is no longer a candidate.
			expect(afterDeploy.releaseCandidates).toEqual([]);

			let health = getHealthChecks(CK_NAMESPACE, CK_NAME)!;
			expect(
				health.healthChecks.filter((h) => (h as { status: { status: string } }).status.status === 'Pending')
			).toHaveLength(1);

			vi.advanceTimersByTime(3_000);
			health = getHealthChecks(CK_NAMESPACE, CK_NAME)!;
			expect(
				health.healthChecks.filter((h) => (h as { status: { status: string } }).status.status === 'Pending')
			).toHaveLength(0);
			expect(rolloutStatus(CK_NAMESPACE, CK_NAME).history[0].bakeStatus).toBe('Deploying');

			vi.advanceTimersByTime(3_000);
			expect(rolloutStatus(CK_NAMESPACE, CK_NAME).history[0].bakeStatus).toBe('Succeeded');
		});

		it('ignores an unknown requested version and falls back to the newest', () => {
			const status = rolloutStatus(CK_NAMESPACE, CK_NAME);
			const newest = status.availableReleases[status.availableReleases.length - 1].tag;
			changeVersion(CK_NAMESPACE, CK_NAME, { version: 'not-a-real-tag' }, 'prod');
			expect(rolloutStatus(CK_NAMESPACE, CK_NAME).currentVersion).toBe(newest);
		});
	});

	describe('resetDemoState', () => {
		it('restores a mutated fixture byte-for-byte and cancels pending timers', () => {
			const pristine = JSON.stringify(getDetail(CW_NAMESPACE, CW_NAME));
			retryRollout(CW_NAMESPACE, CW_NAME, 'staging');
			expect(JSON.stringify(getDetail(CW_NAMESPACE, CW_NAME))).not.toBe(pristine);

			resetDemoState();
			expect(JSON.stringify(getDetail(CW_NAMESPACE, CW_NAME))).toBe(pristine);

			// The +4s settle timer from the retry above must not fire after reset —
			// advancing well past it must not resurrect a "Succeeded" head entry.
			vi.advanceTimersByTime(10_000);
			expect(JSON.stringify(getDetail(CW_NAMESPACE, CW_NAME))).toBe(pristine);
		});

		it('is idempotent and deterministic — two resets produce the same bytes', () => {
			const first = JSON.stringify(getDetail(NAMESPACE, ROLLOUT_NAME));
			resetDemoState();
			const second = JSON.stringify(getDetail(NAMESPACE, ROLLOUT_NAME));
			expect(second).toBe(first);
		});

		// U-3, 2026-10-08: a dev server left running drifts `hcNow` away from
		// the real wall clock the browser compares every "ago" against — see
		// `reanchorClock`'s own note in `mock-data.ts`.
		it('re-anchors the demo clock to the real "now", even after a long idle gap', () => {
			vi.setSystemTime(Date.now() + 20 * 60_000); // 20 minutes pass, no reset yet
			resetDemoState();
			expect(Math.abs(hcNow.getTime() - Date.now())).toBeLessThan(1_000);
		});
	});

	describe('SSE subscriber registry', () => {
		it('broadcasts a `changes` frame with no `object` field on a mutation, and stops after unsubscribe', () => {
			const frames: string[] = [];
			const unsubscribe = registerStreamSubscriber((chunk) => frames.push(chunk));

			retryRollout(CW_NAMESPACE, CW_NAME, 'staging');
			expect(frames.length).toBeGreaterThan(0);
			const frame = frames[0];
			expect(frame).toMatch(/^event: changes\ndata: /);
			const payload = JSON.parse(frame.split('data: ')[1]);
			expect(payload[0]).toMatchObject({ kind: 'Rollout', namespace: CW_NAMESPACE, name: CW_NAME });
			expect(payload[0].object).toBeUndefined();

			unsubscribe();
			const countBeforeSettle = frames.length;
			vi.advanceTimersByTime(5_000); // the retry's own settle step
			// Unsubscribed — no further frames delivered to THIS subscriber.
			expect(frames.length).toBe(countBeforeSettle);
		});
	});

	describe('the demo clock', () => {
		it('is anchored near the fixture anchor, not wall-clock Date.now()', () => {
			const snapshot = demoClockSnapshot();
			const anchorMs = new Date(snapshot.anchor).getTime();
			const nowMs = new Date(snapshot.now).getTime();
			// A handful of seconds of drift from mutations in this file's own
			// tests is expected; hours of drift (the bug this guards against)
			// is not.
			expect(Math.abs(nowMs - anchorMs)).toBeLessThan(5 * 60 * 1000);
		});
	});

	describe('the gate sequence — the build moves with nobody pressing anything', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const checks = () => (getHealthChecks(NAMESPACE, ROLLOUT_NAME) as any).healthChecks;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const log = () => (getEvents(NAMESPACE, ROLLOUT_NAME) as any).events;
		const canary = () => {
			const res = getManagedResources(NAMESPACE, ROLLOUT_NAME) ?? [];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const kr = res.find((r: any) => r.groupVersionKind === 'rollouts.kruise.io/v1beta1/Rollout');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (kr as any)?.object?.status?.canaryStatus;
		};

		it('walks check -> promote -> healthy -> done, and nothing moves before the check passes', () => {
			const before = rolloutStatus(NAMESPACE, ROLLOUT_NAME).currentVersion;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(checks().some((hc: any) => hc.status?.status === 'Pending')).toBe(true);

			expect(runGateSequence(NAMESPACE, ROLLOUT_NAME)).toBe(true);

			// t+2s — the gate has not gone green yet, so nothing has moved.
			vi.advanceTimersByTime(2_000);
			expect(rolloutStatus(NAMESPACE, ROLLOUT_NAME).currentVersion).toBe(before);

			// t+3s — the check passes. Still nothing promoted: the gate goes
			// green FIRST, which is the whole beat.
			vi.advanceTimersByTime(1_000);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(checks().every((hc: any) => hc.status?.status === 'Healthy')).toBe(true);
			expect(log()[0].reason).toBe('HealthChecksPassed');
			expect(rolloutStatus(NAMESPACE, ROLLOUT_NAME).currentVersion).toBe(before);

			// t+3.5s — the controller promotes on its own.
			vi.advanceTimersByTime(500);
			const status = rolloutStatus(NAMESPACE, ROLLOUT_NAME);
			expect(status.currentVersion).not.toBe(before);
			expect(status.wantedVersion).toBe(status.currentVersion);
			const head = status.history[0];
			expect(head.bakeStatus).toBe('Deploying');
			expect(head.triggeredBy).toEqual({ kind: 'System', name: 'rollout-controller' });
			expect(head.message).toContain('checks passed');
			expect(log()[0].reason).toBe('Promoted');
			// The canary re-runs for the new revision…
			expect(canary().currentStepState).not.toBe('Completed');
			expect(canary().canaryRevision).toBe(status.currentVersion);
			// …and the checks that opened the gate STAY passing. Putting one
			// back to `Pending` here read, on screen, as the take's own
			// evidence blinking out 0.6s after it justified the move.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(checks().every((hc: any) => hc.status?.status === 'Healthy')).toBe(true);

			// t+6.5s — still green, nothing amber anywhere after the gate opened.
			vi.advanceTimersByTime(3_000);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(checks().every((hc: any) => hc.status?.status === 'Healthy')).toBe(true);

			// t+9.5s — done, by the same settle path a manual promote takes.
			vi.advanceTimersByTime(3_000);
			const settled = rolloutStatus(NAMESPACE, ROLLOUT_NAME).history[0];
			expect(settled.bakeStatus).toBe('Succeeded');
			expect(log()[0].reason).toBe('BakeSucceeded');
			expect(canary().currentStepState).toBe('Completed');
		});

		it('is idempotent per reset — a second call does not start a second sequence', () => {
			expect(runGateSequence(NAMESPACE, ROLLOUT_NAME)).toBe(true);
			expect(runGateSequence(NAMESPACE, ROLLOUT_NAME)).toBe(true);
			vi.advanceTimersByTime(12_000);
			const history = rolloutStatus(NAMESPACE, ROLLOUT_NAME).history;
			// One promotion, not two. (The BASE fixture's own entries are
			// `System` too — a controller deployed them — so the discriminator
			// is this sequence's own sentence, not the actor.)
			expect(
				history.filter((h: { message?: string }) => /checks passed/i.test(h.message ?? ''))
			).toHaveLength(1);
		});

		it('reports its own elapsed time on the demo clock, and a reset clears it', () => {
			expect(demoClockSnapshot().gate).toBeUndefined();
			runGateSequence(NAMESPACE, ROLLOUT_NAME);
			expect(typeof demoClockSnapshot().gate).toBe('number');
			resetDemoState();
			expect(demoClockSnapshot().gate).toBeUndefined();
		});

		it('says no for a rollout the demo does not carry', () => {
			expect(runGateSequence('nope', 'nothing')).toBe(false);
		});
	});
});
