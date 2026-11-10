import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractClusterHint, respond, stripClusterPrefix } from './respond';
import { resetDemoState } from './state';
import { NAMESPACE, ROLLOUT_NAME } from './mock-data';
import { CK_NAMESPACE, CK_NAME, CW_NAMESPACE, CW_NAME } from './mock-details';

function bodyOf(result: ReturnType<typeof respond>): unknown {
	return JSON.parse(result.body ?? '{}');
}

describe('respond.ts — routing for the demo mode mutations', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetDemoState();
	});

	afterEach(() => {
		resetDemoState();
		vi.useRealTimers();
	});

	it('extractClusterHint reads the cluster segment before stripClusterPrefix throws it away', () => {
		const url = '/api/clusters/staging/rollouts/checkout-worker-staging/checkout-worker/retry';
		expect(extractClusterHint(url)).toBe('staging');
		expect(stripClusterPrefix(url)).toBe('/api/rollouts/checkout-worker-staging/checkout-worker/retry');
		expect(extractClusterHint('/api/events/stream')).toBeUndefined();
	});

	it('permissions/all answers the actionable shape for any namespace/name (task A.5)', () => {
		const res = respond('GET', `/api/rollouts/${CK_NAMESPACE}/${CK_NAME}/permissions/all`);
		expect(res.status).toBe(200);
		expect(bodyOf(res)).toMatchObject({ permissions: { update: true, patch: true } });

		const otherNs = respond('GET', '/api/rollouts/some-namespace/some-app/permissions/all');
		expect(bodyOf(otherNs)).toMatchObject({ permissions: { update: true, patch: true } });
	});

	it('POST retry mutates checkout-worker and the mutation is visible on the very next GET', () => {
		const url = `/api/clusters/staging/rollouts/${CW_NAMESPACE}/${CW_NAME}/retry`;
		const post = respond('POST', url, { body: '{}' });
		expect(post.status).toBe(200);

		const detail = bodyOf(
			respond('GET', `/api/clusters/staging/rollouts/${CW_NAMESPACE}/${CW_NAME}`)
		) as { rollout: { status: { history: { bakeStatus: string }[] } } };
		expect(detail.rollout.status.history[0].bakeStatus).toBe('Deploying');
	});

	it('a promoted rollout is reflected on the /api/rollouts fleet list, not just its own detail route', () => {
		respond('POST', `/api/clusters/prod/rollouts/${CK_NAMESPACE}/${CK_NAME}/change-version`, {
			body: JSON.stringify({ version: 'b-45' })
		});
		const list = bodyOf(respond('GET', '/api/rollouts')) as {
			rollouts: { items: { metadata: { namespace: string; name: string }; status: { currentVersion: string } }[] };
		};
		const entry = list.rollouts.items.find(
			(r) => r.metadata.namespace === CK_NAMESPACE && r.metadata.name === CK_NAME
		);
		expect(entry?.status.currentVersion).toBe('b-45');
	});

	it('GET/POST /api/demo/reset restores the fixture and answers ok on both methods', () => {
		// checkout-worker only starts `Failed` under the `incident` scenario —
		// `calm` (the default) has already healed it.
		resetDemoState('incident');
		respond('POST', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}/retry`, { body: '{}' });
		expect(
			(bodyOf(respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}`)) as { rollout: { status: { history: { bakeStatus: string }[] } } })
				.rollout.status.history[0].bakeStatus
		).toBe('Deploying');

		expect((bodyOf(respond('GET', '/api/demo/reset')) as { ok: boolean }).ok).toBe(true);

		expect(
			(bodyOf(respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}`)) as { rollout: { status: { history: { bakeStatus: string }[] } } })
				.rollout.status.history[0].bakeStatus
		).toBe('Failed');

		expect((bodyOf(respond('POST', '/api/demo/reset')) as { ok: boolean }).ok).toBe(true);
	});

	it('GET /api/demo/now answers a clock snapshot', () => {
		const now = bodyOf(respond('GET', '/api/demo/now')) as { now: string; anchor: string };
		expect(new Date(now.now).toString()).not.toBe('Invalid Date');
		expect(new Date(now.anchor).toString()).not.toBe('Invalid Date');
	});

	it('health-checks, events and managed-resources all answer for the live fixtures', () => {
		for (const [ns, name] of [
			[NAMESPACE, ROLLOUT_NAME],
			[CK_NAMESPACE, CK_NAME],
			[CW_NAMESPACE, CW_NAME]
		]) {
			const health = bodyOf(respond('GET', `/api/rollouts/${ns}/${name}/health-checks`)) as {
				healthChecks: unknown[];
			};
			expect(health.healthChecks.length).toBeGreaterThan(0);

			const events = bodyOf(respond('GET', `/api/rollouts/${ns}/${name}/events`)) as { events: unknown[] };
			expect(events.events.length).toBeGreaterThan(0);
		}
	});

	it('MOCK_FAIL still answers its own three-entry event set on hello-world, unaffected by task B', () => {
		const events = bodyOf(
			respond('GET', `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/events`, { fail: true })
		) as { events: { message: string }[] };
		expect(events.events).toHaveLength(3);
		expect(events.events[0].message).toContain('Scaled up replica set');
	});

	it('POST force-deploy is mapped onto the same change-version mutation, forced', () => {
		const res = respond('POST', `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/force-deploy`, { body: '{}' });
		expect(res.status).toBe(200);
		const detail = bodyOf(respond('GET', `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}`)) as {
			rollout: { status: { history: { bakeStatus: string; message?: string }[] } };
		};
		expect(detail.rollout.status.history[0].bakeStatus).toBe('Deploying');
		expect(detail.rollout.status.history[0].message).toContain('Force deploy');
	});

	it('a mutation on a rollout with no live fixture falls through to the empty-JSON fallback', () => {
		const res = respond('POST', '/api/rollouts/some-namespace/some-app/retry', { body: '{}' });
		expect(res.status).toBe(200);
		expect(bodyOf(res)).toEqual({});
	});

	describe('calm / incident scenarios (tl-dashboard-demo-2)', () => {
		type RolloutItem = {
			metadata: { namespace: string; name: string };
			status: { history?: { bakeStatus?: string }[] };
		};

		/**
		 * ⭐ SCOPED TO THE HEAD ENTRY (round 3, squad-rollout, coordinator
		 * ruling, 2026-10-09): "history must never rewrite a past failure."
		 * `healRolloutFailures` (state.ts) now only ever heals
		 * `history[0]` — a rollout whose CURRENT state is healthy can still
		 * carry a Failed entry further back (e.g. `checkout-edge-prod`'s
		 * own inserted Failed+rollback pair, or `orders-api/dev`'s
		 * documented 03:00 historical incident), and that is correct, not
		 * a regression. This helper's job is "how many rollouts need a
		 * person RIGHT NOW", which is a question about the HEAD only —
		 * matching `detectRollback`/`cardStateMark`'s own `history[0]`
		 * scoping everywhere else in the product. It used to scan the
		 * whole array because, before this round, nothing ever put a
		 * Failed entry anywhere but the head — the two scopings were
		 * indistinguishable until squad-rollout's History redesign made
		 * them diverge for real.
		 */
		function countFailures(): { total: number; namespaces: string[] } {
			const list = bodyOf(respond('GET', '/api/rollouts')) as { rollouts: { items: RolloutItem[] } };
			const failing = list.rollouts.items.filter((r) => r.status.history?.[0]?.bakeStatus === 'Failed');
			return { total: failing.length, namespaces: failing.map((r) => r.metadata.namespace) };
		}

		// ⛔ ROUND 5 QA-5, ITEM 2 (2026-10-09) — `telemetry-forwarder-prod`
		// (the `platform-telemetry` multi-service demo, `mock-data.ts`'s
		// `TM_CELLS`) MOVED OUT OF `incident` INTO ITS OWN `wide` SCENARIO.
		// `incident`'s own contract ("exactly one failure", the landing
		// film's "one failure, late" rule) is restored — a SECOND,
		// unrelated failure there broke that contract for every other
		// reviewer of `incident` (Home, `/activity`, the film's own
		// incident chapter), not just this lane's own PR page. `wide`
		// exists ONLY to review `LandingGrid`'s one-fill-per-row rule on
		// the platform-telemetry PR (state.ts's `Scenario` doc comment).
		const TM_NAMESPACE = 'telemetry-forwarder-prod';

		it('calm (the default) has zero rollouts CURRENTLY failing', () => {
			respond('GET', '/api/demo/reset?scenario=calm');
			expect(countFailures()).toEqual({ total: 0, namespaces: [] });

			const now = bodyOf(respond('GET', '/api/demo/now')) as { scenario: string };
			expect(now.scenario).toBe('calm');
		});

		/**
		 * ⭐ ROUND 3 COMPANION TO THE INVARIANT ABOVE: "zero failing" is
		 * about the HEAD, never a claim that no rollout's history contains
		 * a Failed entry — `state.healing.test.ts` has the full case list
		 * (orders-api/dev's historical incident, checkout-edge-prod's
		 * Failed+rollback pair); this is the one-line version at the same
		 * `/api/rollouts` surface `countFailures` itself reads.
		 */
		it('calm: a past Failed entry below the head is not healed away', () => {
			respond('GET', '/api/demo/reset?scenario=calm');
			const list = bodyOf(respond('GET', '/api/rollouts')) as {
				rollouts: { items: { metadata: { namespace: string }; status: { history?: { bakeStatus?: string }[] } }[] };
			};
			const ckEdgeProd = list.rollouts.items.find((r) => r.metadata.namespace === 'checkout-edge-prod');
			expect(ckEdgeProd?.status.history?.some((h) => h.bakeStatus === 'Failed')).toBe(true);
			// And its HEAD is still healthy — the invariant above, restated.
			expect(ckEdgeProd?.status.history?.[0]?.bakeStatus).not.toBe('Failed');
		});

		it('incident has exactly one Failed rollout: checkout-worker in staging', () => {
			respond('GET', '/api/demo/reset?scenario=incident');
			expect(countFailures()).toEqual({
				total: 1,
				namespaces: [CW_NAMESPACE]
			});

			const cwDetail = bodyOf(respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}`)) as {
				rollout: { status: { history: { bakeStatus: string }[] } };
			};
			expect(cwDetail.rollout.status.history[0].bakeStatus).toBe('Failed');

			const health = bodyOf(respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}/health-checks`)) as {
				healthChecks: { status: { status: string } }[];
			};
			expect(health.healthChecks.filter((h) => h.status.status === 'Unhealthy')).toHaveLength(1);
		});

		it('wide has exactly two Failed rollouts: checkout-worker in staging and telemetry-forwarder in prod', () => {
			respond('GET', '/api/demo/reset?scenario=wide');
			expect(countFailures()).toEqual({
				total: 2,
				namespaces: [CW_NAMESPACE, TM_NAMESPACE]
			});

			const now = bodyOf(respond('GET', '/api/demo/now')) as { scenario: string };
			expect(now.scenario).toBe('wide');
		});

		it('a plain reset (no ?scenario=) keeps whatever scenario is already active', () => {
			respond('GET', '/api/demo/reset?scenario=wide');
			respond('GET', '/api/demo/reset'); // no query — must NOT fall back to calm
			expect(countFailures()).toEqual({
				total: 2,
				namespaces: [CW_NAMESPACE, TM_NAMESPACE]
			});
		});

		it('retry still works and settles checkout-worker to healthy inside the wide scenario, leaving only the telemetry failure', () => {
			respond('GET', '/api/demo/reset?scenario=wide');
			respond('POST', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}/retry`, { body: '{}' });
			vi.advanceTimersByTime(5_000);
			const detail = bodyOf(respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}`)) as {
				rollout: { status: { history: { bakeStatus: string }[] } };
			};
			expect(detail.rollout.status.history[0].bakeStatus).toBe('Succeeded');
			expect(countFailures()).toEqual({ total: 1, namespaces: [TM_NAMESPACE] });
		});
	});

	/**
	 * ⭐ THE CLOCK JUMP (logs round 8, squad-rollout lead, item 4): "the
	 * time column showed 12:xx in one shoot and 17:xx in the next." The
	 * logs SSE handlers used to anchor their backlog off `hcNow`, which
	 * can sit anywhere from fresh to ~10 minutes (or, on a long-idle dev
	 * server between resets, far longer) behind the real clock — so two
	 * screenshots taken hours apart could legitimately show two different
	 * "now"s for the SAME backlog-ends-at-now claim. Every logs handler is
	 * `Date.now()`-anchored now (see each one's own doc for why not
	 * `hcNow`/`peekDemoClock()`); this is the regression guard — read the
	 * SSE stream's own emitted `log` events directly (not through
	 * `LogsViewer`, which is a rendering concern) and check the newest
	 * one's `timestamp` lands within a few real seconds of `Date.now()`,
	 * for every scenario's own failing-or-not Logs source.
	 */
	describe('logs SSE streams — the backlog ends at "now" (logs round 8, item 4)', () => {
		function newestLogTimestamp(result: ReturnType<typeof respond>): number {
			const chunks: string[] = [];
			const stop = result.stream!.start((chunk) => chunks.push(chunk));
			stop();
			const timestamps = chunks
				.map((chunk) => chunk.match(/^event: log\ndata: (.+)\n\n$/))
				.filter((m): m is RegExpMatchArray => m !== null)
				.map((m) => JSON.parse(m[1]).timestamp as number)
				.filter((ts) => typeof ts === 'number' && Number.isFinite(ts));
			expect(timestamps.length).toBeGreaterThan(0);
			return Math.max(...timestamps);
		}

		it('calm: checkout-edge-prod\'s newest backlog line is within a few seconds of now', () => {
			respond('GET', '/api/demo/reset?scenario=calm');
			const result = respond('GET', `/api/rollouts/${CK_NAMESPACE}/${CK_NAME}/pods/logs`);
			expect(Date.now() - newestLogTimestamp(result)).toBeLessThan(5000);
		});

		it('incident: checkout-worker-staging\'s newest backlog line is within a few seconds of now', () => {
			respond('GET', '/api/demo/reset?scenario=incident');
			const result = respond('GET', `/api/rollouts/${CW_NAMESPACE}/${CW_NAME}/pods/logs`);
			expect(Date.now() - newestLogTimestamp(result)).toBeLessThan(5000);
		});

		it("hello-world's pod source newest backlog line is within a few seconds of now", () => {
			respond('GET', '/api/demo/reset?scenario=calm');
			const podResult = respond('GET', `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/pods/logs?type=pod`);
			expect(Date.now() - newestLogTimestamp(podResult)).toBeLessThan(5000);
		});

		// The Tests source is a FINISHED run, not a live tail — its own
		// doc (the handler's "i * 2000, not (initialCount + i) * 2000"
		// comment) deliberately ends it ~46s before now, not AT now. The
		// invariant here is looser on purpose: recently finished, not
		// mid-stream and not in the future.
		it("hello-world's test source newest backlog line is recent (a finished run, not a live tail)", () => {
			respond('GET', '/api/demo/reset?scenario=calm');
			const testResult = respond('GET', `/api/rollouts/${NAMESPACE}/${ROLLOUT_NAME}/pods/logs?type=test`);
			const ageMs = Date.now() - newestLogTimestamp(testResult);
			expect(ageMs).toBeGreaterThanOrEqual(0); // never in the future
			expect(ageMs).toBeLessThan(90_000);
		});
	});
});
