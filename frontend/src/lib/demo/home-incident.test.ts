import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	rebaseInstants,
	rebasedHomeFixture,
	respondHomeIncident,
	withObservationSnapshots,
	withPromotionHolds,
	type HomeFixture
} from './home-incident';
import { applySlicesMode } from './mock-slices';

const fixture = JSON.parse(
	readFileSync(new URL('../view-models/home/fixtures/incident-input.json', import.meta.url), 'utf8')
) as HomeFixture;

const SHIFT = 3 * 86_400_000 + 1234;
const now = new Date(Date.parse(fixture.capturedAt) + SHIFT);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (url: string): any => {
	const r = respondHomeIncident('GET', url, fixture, now);
	return r && { status: r.status, body: JSON.parse(r.body ?? 'null') };
};

describe('incident-input fixture', () => {
	it('carries every raw Home input', () => {
		expect(fixture.me).toBe('danielreed');
		expect(Number.isNaN(Date.parse(fixture.capturedAt))).toBe(false);
		for (const k of ['rollouts', 'environments', 'rolloutDependencies', 'kustomizations', 'kruiseRollouts', 'changes'] as const) {
			expect(Array.isArray(fixture[k]), k).toBe(true);
		}
		expect(fixture.rollouts.length).toBeGreaterThan(0);
		expect(fixture.changes.length).toBeGreaterThan(0);
	});

	it('holds no managedFields', () => {
		expect(JSON.stringify(fixture)).not.toContain('managedFields');
	});
});

describe('home-incident re-basing (clock-rot rule)', () => {
	it('moves every ISO instant by now - capturedAt and nothing else', () => {
		const live = rebasedHomeFixture(fixture, now);
		expect(live.capturedAt).toBe(now.toISOString());
		const age = (iso: string, at: string) => Date.parse(at) - Date.parse(iso);
		fixture.changes.forEach((c, i) => {
			expect(age(live.changes[i].mergedAt, live.capturedAt)).toBe(age(c.mergedAt, fixture.capturedAt));
		});
		expect(live.rollouts.map((r) => r.metadata.name)).toEqual(fixture.rollouts.map((r) => r.metadata.name));
		expect(fixture.capturedAt).not.toBe(live.capturedAt);
	});

	it('leaves date-like but non-instant strings alone', () => {
		expect(rebaseInstants({ v: '2026-10-24', t: 'v1.2.3', n: 5 }, 60_000)).toEqual({ v: '2026-10-24', t: 'v1.2.3', n: 5 });
		expect(rebaseInstants('2026-10-24T00:00:00Z', 60_000)).toBe('2026-10-24T00:01:00.000Z');
	});
});

describe('respondHomeIncident', () => {
	it('serves the list as the fixture, re-based, under any cluster prefix', () => {
		for (const url of ['/api/rollouts', '/api/clusters/prod/rollouts']) {
			const { body } = get(url);
			/* apps-10/11: invoice-api's and hello-frontend-app's older history entries are SPREAD over the week in the served response (same names, same count), so those two compare by shape */
			/* r39: the served list also carries the failing checks' observations on the head history entry (withObservationSnapshots) */
			const served = rebasedHomeFixture(withObservationSnapshots(withPromotionHolds(fixture)), now);
			const plain = (items: { metadata: { name: string } }[]) => items.filter((r) => !/^(invoice-api|hello-frontend-app)/.test(r.metadata.name));
			/* the served list is the fixture with the serve-time slices conversion applied (./mock-slices.ts) */
			expect(plain(body.rollouts.items)).toEqual(plain(applySlicesMode(served.rollouts).rollouts));
			expect(body.rollouts.items.map((r: { metadata: { name: string } }) => r.metadata.name)).toEqual(rebasedHomeFixture(fixture, now).rollouts.map((r) => r.metadata.name));
			expect(body.environments.items).toHaveLength(fixture.environments.length);
			expect(body.rolloutDependencies.items).toHaveLength(fixture.rolloutDependencies.length);
			expect(body.kustomizations.items).toHaveLength(fixture.kustomizations.length);
			expect(body.kruiseRollouts.items).toHaveLength(fixture.kruiseRollouts.length);
			expect(body.clusterErrors).toEqual([]);
		}
	});

	it('reports GitHub connected as fixture.me, and filters changes by the days window', () => {
		expect(get('/api/auth/github/status').body).toMatchObject({ configured: true, connected: true, login: 'danielreed', avatarUrl: expect.stringMatching(/^data:image/) });
		const all = get('/api/github/changes?days=365').body;
		const week = get('/api/github/changes?days=7').body;
		expect(all.user).toBe('danielreed');
		expect(all.changes).toHaveLength(fixture.changes.length);
		expect(week.changes.length).toBeLessThanOrEqual(all.changes.length);
		for (const c of week.changes) expect(Date.parse(c.mergedAt)).toBeGreaterThanOrEqual(now.getTime() - 7 * 86_400_000);
	});

	it('detail: environment, gates, KruiseRollout and a health-check selector from the fixture', () => {
		const useast = get('/api/clusters/prod/rollouts/invoice-api-prod-us-east/invoice-api').body;
		// sites and waves: `prod-us-east` is the prod tier's `us-east` site (place key unchanged)
		expect(useast.environment.spec).toMatchObject({ environment: 'prod', site: 'us-east', wave: 1 });
		expect(useast.rolloutGates.items.map((g: { metadata: { name: string } }) => g.metadata.name)).toEqual([
			'invoice-api-manual-approval'
		]);
		expect(useast.rollout.spec.healthCheckSelector).toEqual({ matchLabels: { app: 'invoice-api' } });
		const dev = get('/api/rollouts/invoice-api-dev/invoice-api').body;
		expect(dev.kruiseRollout.metadata.name).toBe('invoice-api-canary-dev');
		expect(dev.kustomizations.items).toHaveLength(1);
		expect(get('/api/rollouts/nope/nope').status).toBe(404);
	});

	it('a failing check on a Failed head is Unhealthy on the detail page, witnessed at the bake failure', () => {
		for (const [ns, name, check] of [
			['invoice-api-prod-eu-west', 'invoice-api', 'invoice-api-error-rate'],
			['hello-dep-prod', 'hello-frontend-app', 'hello-frontend-app-error-rate'],
			['checkout-worker-staging', 'checkout-worker', 'checkout-worker-prometheus-high-error-rate']
		]) {
			const hc = get(`/api/rollouts/${ns}/${name}/health-checks`).body.healthChecks;
			const failing = hc.find((h: { metadata: { name: string } }) => h.metadata.name === check);
			expect(failing.status.status, ns).toBe('Unhealthy');
			// the controller only writes failedHealthChecks with BakeStatus=Failed
			const head = get(`/api/rollouts/${ns}/${name}`).body.rollout.status.history[0];
			expect(head.bakeStatus, ns).toBe('Failed');
			expect(failing.status.lastErrorTime, ns).toBe(head.bakeEndTime);
			if (head.lastRetryTimestamp)
				expect(Date.parse(failing.status.lastErrorTime), ns).toBeGreaterThan(Date.parse(head.lastRetryTimestamp));
			const events = get(`/api/rollouts/${ns}/${name}/events`).body.events;
			const warning = events.find((e: { type: string }) => e.type === 'Warning');
			expect(warning?.message, ns).toBe(head.failedHealthChecks[0].message);
			expect(warning?.message, ns).not.toMatch(/completed successfully/);
		}
		const calm = get('/api/rollouts/billing-api-prod/billing-api/health-checks').body.healthChecks;
		expect(calm.map((h: { status: { status: string } }) => h.status.status)).toEqual(['Healthy']);
	});

	it('answers the fixture commits and PRs, and falls through for unknown refs', () => {
		const commit = get('/api/clusters/prod/github/repos/exampleco/invoice-api/commits/a11c202').body;
		expect(commit.subject).toBe('Retry webhook delivery with exponential backoff');
		expect(get('/api/github/repos/exampleco/invoice-api/commits/a11c202/pulls').body[0].number).toBe(37);
		expect(get('/api/github/pulls/exampleco/invoice-api/37').body.mergeCommitSha).toBe('a11c202');
		expect(get('/api/github/repos/exampleco/invoice-api/commits/ffffff0')).toBeNull();
		// a tag is a ref: rel-66 is the commit its build was made from (#13)
		const tagged = get('/api/clusters/prod/github/repos/exampleco/hello-frontend-app/commits/rel-66').body;
		expect(tagged.sha).toBe('9f10e494d560c1db68aef5203e3afdc5fd9e1e10');
		expect(get('/api/github/repos/exampleco/hello-frontend-app/commits/rel-66/pulls').body[0].number).toBe(13);
		expect(get('/api/github/pulls/exampleco/invoice-api/9999')).toBeNull();
	});

	it('never answers a mutation or an unknown route', () => {
		expect(respondHomeIncident('POST', '/api/rollouts/invoice-api-dev/invoice-api/retry', fixture, now)).toBeNull();
		expect(get('/api/rollouts/invoice-api-dev/invoice-api/permissions/all')).toBeNull();
	});
});

describe('home-incident rollout detail: the gates the controllers write', () => {
	it('every RolloutDependency consumer carries its dependency-<name> gate, the allow list = admittedVersions', () => {
		for (const dep of fixture.rolloutDependencies) {
			const r = fixture.rollouts.find(
				(x: { metadata: { namespace: string; name: string } }) =>
					x.metadata.namespace === dep.metadata.namespace &&
					x.metadata.name === dep.spec.rolloutRef.name
			);
			expect(r, dep.metadata.name).toBeDefined();
			const g = r!.status.gates.find((x: { name: string }) => x.name === dep.status.gateName);
			expect(g, dep.status.gateName).toMatchObject({
				passing: true,
				allowedVersions: dep.status.admittedVersions ?? []
			});
		}
	});

	it("a dependency's gate object carries its controller owner, so it never reads as a hand-authored rule", () => {
		const body = get('/api/rollouts/checkout-api-prod-ap-southeast-2/checkout-api').body as {
			rolloutGates: { items: { metadata: Record<string, unknown> }[] };
		};
		const gate = body.rolloutGates.items.find(
			(g) => g.metadata.name === 'dependency-checkout-api-needs-payments'
		)!;
		expect(gate.metadata).toMatchObject({
			ownerReferences: [
				{ kind: 'RolloutDependency', name: 'checkout-api-needs-payments', controller: true }
			],
			annotations: { 'gate.kuberik.com/pretty-name': 'Depends on payments-svc' }
		});
		const promo = body.rolloutGates.items.find(
			(g) => g.metadata.name === 'promotion-prod-ap-southeast-2'
		)!;
		expect(promo.metadata.ownerReferences).toBeUndefined();
	});
});

describe('withPromotionHolds (batch4 #75): the served fixture has places a promotion gate itself holds', () => {
	it('adds one refusing promotion gate to exactly two places (telemetry-indexer prod a pure promotion hold, payments-svc beside its approval), and changes nothing else', () => {
		const out = withPromotionHolds(fixture);
		const diff = out.rollouts.filter((r, i) => r !== fixture.rollouts[i]).map((r) => `${r.metadata.namespace}/${r.metadata.name}`);
		expect(diff).toEqual(['telemetry-indexer-prod/telemetry-indexer', 'platform-staging/payments-svc']);
		for (const r of out.rollouts.filter((r, i) => r !== fixture.rollouts[i])) {
			const gates = (r.status as { gates: { kind: string; allowedVersions: string[] }[] }).gates;
			expect(gates.filter((g) => g.kind === 'promotion')).toEqual([expect.objectContaining({ allowedVersions: [] })]);
			expect(gates.some((g) => g.kind === 'approval'), r.metadata.name).toBe(r.metadata.name === 'payments-svc');
		}
		expect(out.environments).toEqual(fixture.environments);
	});
});
