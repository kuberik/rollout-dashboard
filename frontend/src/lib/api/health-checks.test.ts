/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import {
	FLEET_HEALTH_CHECKS_KEY,
	fetchFleetHealthChecks,
	fleetHealthChecksQuery,
	healthChecksByRollout,
	rolloutHealthChecks,
	type FleetHealthChecksResponse
} from './health-checks';
import { applyChangeEvents, type ChangeEvent } from './events';
import { SOURCE_CLUSTER_ANNOTATION } from '../source-dashboard';
import { healthCheckKey } from '../health-check-key';

const check = (name: string, ns: string, status = 'Healthy') => ({
	apiVersion: 'kuberik.com/v1alpha1',
	kind: 'HealthCheck',
	metadata: { name, namespace: ns, labels: { app: 'a' } },
	status: { status }
});
const group = (cluster: string, ns: string, name: string, checks: unknown[]) => ({
	metadata: { namespace: ns, name, annotations: { [SOURCE_CLUSTER_ANNOTATION]: cluster } },
	healthChecks: checks as any
});
const response = (): FleetHealthChecksResponse => ({
	rolloutHealthChecks: {
		items: [
			group('prod', 'app-prod', 'app', [check('app-error-rate', 'app-prod')]),
			group('dev', 'app-prod', 'app', [check('app-error-rate', 'app-prod')])
		]
	}
});

afterEach(() => vi.unstubAllGlobals());

describe('fleet health checks — query (hc-v2)', () => {
	it('reads the fleet endpoint through apiPath (no cluster: the hub fan-in)', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(response()), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const res = await fetchFleetHealthChecks();
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/health-checks');
		expect(rolloutHealthChecks(res)).toHaveLength(2);
	});

	it('a backend without the endpoint (404) resolves to null, and the query stops polling', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('404 page not found', { status: 404 }))
		);
		expect(await fetchFleetHealthChecks()).toBeNull();
		const q = fleetHealthChecksQuery();
		expect(q.queryKey).toEqual(FLEET_HEALTH_CHECKS_KEY);
		expect(q.refetchInterval({ state: { status: 'success', error: null, data: null } })).toBe(
			false
		);
		expect(
			q.refetchInterval({ state: { status: 'success', error: null, data: response() } })
		).toBeGreaterThan(0);
	});

	it('a 5xx is an error, not "no endpoint"', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 503 }))
		);
		await expect(fetchFleetHealthChecks()).rejects.toBeTruthy();
	});

	it('groups by cluster + namespace + rollout, so the same name on two clusters stays apart', () => {
		const m = healthChecksByRollout(rolloutHealthChecks(response()));
		expect([...m.keys()].sort()).toEqual([
			healthCheckKey('dev', 'app-prod', 'app'),
			healthCheckKey('prod', 'app-prod', 'app')
		]);
		expect(healthChecksByRollout(rolloutHealthChecks({ rolloutHealthChecks: null })).size).toBe(0);
	});
});

describe('fleet health checks — applyChangeEvents (hc-v2)', () => {
	const ev = (o: Partial<ChangeEvent>): ChangeEvent => ({
		type: 'update',
		kind: 'HealthCheck',
		namespace: 'app-prod',
		name: 'app-error-rate',
		cluster: 'prod',
		resourceVersion: '2',
		ts: 2,
		...o
	});
	const setup = () => {
		const qc = new QueryClient();
		qc.setQueryData(FLEET_HEALTH_CHECKS_KEY, response());
		return qc;
	};
	const items = (qc: QueryClient) =>
		(qc.getQueryData(FLEET_HEALTH_CHECKS_KEY) as FleetHealthChecksResponse).rolloutHealthChecks!
			.items!;

	it('patches a known check in place on ITS cluster only', () => {
		const qc = setup();
		applyChangeEvents(qc, [
			ev({ object: check('app-error-rate', 'app-prod', 'Unhealthy') as any })
		]);
		expect((items(qc)[0].healthChecks[0] as any).status.status).toBe('Unhealthy');
		expect((items(qc)[1].healthChecks[0] as any).status.status).toBe('Healthy');
		expect(qc.getQueryState(FLEET_HEALTH_CHECKS_KEY)?.isInvalidated).toBe(false);
	});

	it('removes a deleted check', () => {
		const qc = setup();
		applyChangeEvents(qc, [ev({ type: 'delete' })]);
		expect(items(qc)[0].healthChecks).toHaveLength(0);
		expect(items(qc)[1].healthChecks).toHaveLength(1);
	});

	it('an UPDATE to a check no rollout selects changes nothing and refetches nothing', () => {
		const qc = setup();
		const before = qc.getQueryData(FLEET_HEALTH_CHECKS_KEY);
		applyChangeEvents(qc, [
			ev({ name: 'unrelated', object: check('unrelated', 'app-prod') as any })
		]);
		expect(qc.getQueryData(FLEET_HEALTH_CHECKS_KEY)).toBe(before);
		expect(qc.getQueryState(FLEET_HEALTH_CHECKS_KEY)?.isInvalidated).toBe(false);
	});

	it('an ADDED check nobody holds yet refetches the list (a rollout may select it)', () => {
		const qc = setup();
		applyChangeEvents(qc, [
			ev({ type: 'add', name: 'new-check', object: check('new-check', 'app-prod') as any })
		]);
		expect(qc.getQueryState(FLEET_HEALTH_CHECKS_KEY)?.isInvalidated).toBe(true);
	});
});

describe('fleet health checks — unknown is never "none" (hc-v2, backend contract)', () => {
	const res = (partialReads?: string[]): FleetHealthChecksResponse => ({
		...response(),
		partialReads
	});

	it('a hub partial read "<cluster>/<namespace>" drops exactly that cluster\'s groups there', () => {
		const known = rolloutHealthChecks(res(['prod/app-prod']));
		expect(known.map((g) => g.metadata.annotations?.[SOURCE_CLUSTER_ANNOTATION])).toEqual(['dev']);
		const m = healthChecksByRollout(known);
		expect(m.has(healthCheckKey('prod', 'app-prod', 'app'))).toBe(false);
		expect(m.has(healthCheckKey('dev', 'app-prod', 'app'))).toBe(true);
	});

	it('a leg partial read (bare namespace) drops every group in that namespace', () => {
		expect(rolloutHealthChecks(res(['app-prod']))).toEqual([]);
	});

	it('a partial read elsewhere drops nothing', () => {
		expect(rolloutHealthChecks(res(['prod/other-ns', 'other-ns']))).toHaveLength(2);
	});
});
