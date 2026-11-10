import { describe, expect, it } from 'vitest';
import { buildHomeModel, buildLumenHome, watchSub } from './index';
import { homeInput } from './fixture';
import fixture from './fixtures/incident-input.json';
import {
	homeIncidentFleetHealthChecks,
	respondHomeIncident,
	type HomeFixture
} from '$lib/demo/home-incident';
import { rolloutHealthChecks, type FleetHealthChecksResponse } from '$lib/api/health-checks';

/**
 * hc-v2 THE FLAPPING CHECK. telemetry-collector prod (platform-telemetry: the viewer,
 * danielreed, authors #20, which the app runs, so the app is one of the viewer's and its
 * flapping check is a line under its row in Your changes, not a Watch line) carries one prometheus-alert
 * HealthCheck, `telemetry-collector-error-rate` (display name `error-rate`):
 * - 18:21 7b3c9f1 deployed; 18:24 the check fired and the rollout-controller
 *   failed the deploy, recording it in that entry's failedHealthChecks;
 * - 19:21 4a8d2e6 force-deployed; its bake started, so the check was Healthy;
 * - the alert fired again after the bake (last Unhealthy evaluation 19:33) and
 *   the check is Healthy since 19:34.
 * Two separate failures in 1h17m, passing between them: flapping.
 */
const STARS = [new Set<string>(), new Set(['hello-frontend-app', 'checkout-api'])];

function build(starredApps: ReadonlySet<string>, withChecks = true) {
	const input = homeInput();
	const model = buildHomeModel({
		...input,
		healthChecks: withChecks ? input.healthChecks : null,
		starredApps
	});
	return buildLumenHome(model, input.now, { starredApps });
}

describe('the flapping check (hc-v2)', () => {
	it("is one line on the viewer's own app: flapping, actual against expected, not a Watch line", () => {
		for (const starred of STARS) {
			const home = build(starred);
			expect(home.watch.filter((x) => x.app === 'telemetry-collector')).toHaveLength(0);
			const g = [...home.busy, ...home.allLive].find((x) => x.app === 'telemetry-collector')!;
			expect(g.others).toHaveLength(1);
			const w = g.others[0];
			expect(w).toMatchObject({
				kind: 'flapping',
				kindWord: 'flapping',
				place: 'prod',
				age: '8m',
				href: '/rollouts/prod/telemetry-collector-prod/telemetry-collector',
				facts: {
					kind: 'signal',
					signal: { kind: 'check-flapping', check: 'error-rate', failures: 2 }
				}
			});
			expect(`${w.app} · ${w.place} · ${w.kindWord}${watchSub(w)}`).toBe(
				'telemetry-collector · prod · flapping · error-rate 2× in 1h, expected 0 · 8m'
			);
		}
	});

	it('leaves Needs you and Your changes exactly as they are without the check feed', () => {
		for (const starred of STARS) {
			const on = build(starred);
			const off = build(starred, false);
			expect(on.needs).toEqual(off.needs);
			expect(on.busy).toEqual(off.busy);
			expect(on.allFlights).toEqual(off.allFlights);
			expect(on.totals).toEqual(off.totals);
			// the only Watch difference is the one flapping line
			expect(on.watch.filter((x) => x.app !== 'telemetry-collector')).toEqual(off.watch);
		}
	});

	it("the mock's fleet list is exactly the per-rollout endpoint, rollout by rollout", () => {
		const f = fixture as unknown as HomeFixture;
		const now = new Date(f.capturedAt);
		const fleet = JSON.parse(
			respondHomeIncident('GET', '/api/health-checks', f, now)!.body as string
		);
		/* apps-10/11: the served list SPREADS invoice-api's and hello-frontend-app's history over the week, so their check times differ from the raw fixture's; every other rollout is served as the raw fixture reads */
		const plain = (g: { rolloutHealthChecks: { items: { metadata: { name: string } }[] } }) =>
			g.rolloutHealthChecks.items.filter((r) => !/^(invoice-api|hello-frontend-app)/.test(r.metadata.name));
		expect(plain(fleet)).toEqual(plain(homeIncidentFleetHealthChecks(f) as never));
		const viaCluster = JSON.parse(
			respondHomeIncident('GET', '/api/clusters/prod/health-checks', f, now)!.body as string
		);
		expect(viaCluster).toEqual(fleet);
		for (const g of fleet.rolloutHealthChecks.items) {
			const one = respondHomeIncident(
				'GET',
				`/api/rollouts/${g.metadata.namespace}/${g.metadata.name}/health-checks`,
				f,
				now
			)!;
			expect(JSON.parse(one.body as string).healthChecks, `${g.metadata.namespace}`).toEqual(
				g.healthChecks
			);
		}
		const tc = fleet.rolloutHealthChecks.items.find(
			(g: { metadata: { namespace: string } }) =>
				g.metadata.namespace === 'telemetry-collector-prod'
		);
		expect(tc.healthChecks.map((h: { metadata: { name: string } }) => h.metadata.name)).toEqual([
			'telemetry-collector-error-rate',
			'telemetry-collector-kustomization-health-check'
		]);
	});

	it('a partial read over its namespace makes the check unknown: no flapping, no recovered', () => {
		const f = fixture as unknown as HomeFixture;
		const res = {
			...(homeIncidentFleetHealthChecks(f) as FleetHealthChecksResponse),
			partialReads: ['prod/telemetry-collector-prod']
		};
		const input = homeInput();
		const starredApps = new Set<string>();
		const model = buildHomeModel({ ...input, healthChecks: rolloutHealthChecks(res), starredApps });
		expect(model.signals.filter((s) => s.app === 'telemetry-collector')).toEqual([]);
		const home = buildLumenHome(model, input.now, { starredApps });
		expect(home.watch.some((w) => w.app === 'telemetry-collector')).toBe(false);
	});
});
