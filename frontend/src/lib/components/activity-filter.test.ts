import { describe, it, expect } from 'vitest';
import { activityFacets, activityText, parseActivityQuery, type FilterEntry } from './activity-filter';
import { applyQuery, optionsOf, queryParams, queryString, EMPTY_QUERY } from './filter/filter-model';

type Kind = 'failed' | 'in_flight' | 'rolled_back' | '';
const row = (rolloutName: string, ns: string, envKey: string, kind: Kind, version = 'v1'): FilterEntry & { kind: Kind } =>
	({ rolloutName, rolloutNamespace: ns, displayName: rolloutName, envKey, envLabel: envKey, version, kind });
const rows = [
	row('checkout-api', 'payments', 'prod-eu-west', 'failed', 'v2.1'),
	row('orders-api', 'shop', 'staging', 'in_flight'),
	row('orders-api', 'shop', 'prod-us-east', ''),
	row('edge-mesh', 'infra', 'dev', 'rolled_back')
];
const defs = activityFacets<(typeof rows)[number]>((e) => e.kind);
const env = new Set(rows.map((r) => r.envKey));
const q = (s: string) => parseActivityQuery(new URLSearchParams(s), defs, env);
const run = (s: string) => applyQuery(rows, q(s), defs, activityText).length;

describe('activity filter', () => {
	it('keeps the old single-param links working', () => {
		expect(run('kind=failed')).toBe(1);
		expect(run('tier=production')).toBe(2);
		expect(run('env=prod-eu-west')).toBe(1);
		expect(run('app=orders-api')).toBe(2);
		expect(run('ns=shop')).toBe(2);
	});
	it('reads a tier word in ?env= as the tier, an exact region as the region', () => {
		expect(q('env=prod').clauses).toEqual([{ key: 'tier', op: 'is', values: ['prod'] }]);
		expect(q('env=prod-eu-west').clauses[0]?.key).toBe('env');
		expect(q('env=prod-eu-west-9').clauses[0]?.key).toBe('env'); // an exact name that merely starts with a tier word stays an environment
	});
	it('supports is-not and multi values, and searches name, namespace and version', () => {
		expect(run('ns!=shop')).toBe(2);
		expect(run('kind=failed,rolled_back')).toBe(2);
		expect(run('q=v2.1')).toBe(1);
		expect(run('q=infra')).toBe(1);
	});
	it('counts options given the other clauses and round-trips the URL', () => {
		const query = q('kind=failed&ns!=shop');
		expect(optionsOf(rows, query, defs, activityText, 'tier').find((o) => o.value === 'prod')?.count).toBe(1);
		expect(queryString(queryParams(new URLSearchParams(), query, defs))).toBe('?kind=failed&ns!=shop');
		expect(queryString(queryParams(new URLSearchParams('x=1'), EMPTY_QUERY, defs))).toBe('?x=1');
	});
});
