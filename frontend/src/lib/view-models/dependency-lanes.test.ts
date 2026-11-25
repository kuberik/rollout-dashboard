import { describe, test, expect } from 'vitest';
import { fleet, environments, list } from './gates-tab-reference.testkit';
import { buildLanes, heldSinceByEdge, NO_ENV, cellKey } from './dependency-lanes';

const g = fleet.providerNetwork;
const m = buildLanes({ graph: g, environments, heldSince: heldSinceByEdge(g, list.rolloutDependencies.items) });

describe('environment lanes (home-incident)', () => {
	test('columns are the four tiers, no namespace columns', () => {
		expect(m.columns.map((c) => c.key)).toEqual(['dev', 'test', 'staging', 'prod']);
	});
	test('unbound platform rollouts are placed by their cluster or consumers, never a lane each', () => {
		expect(m.cells.get(cellKey('ledger-core', 'prod'))?.placed).toBe('cluster');
		expect(m.cells.get(cellKey('payments-svc', 'staging'))?.placed).toBe('consumers');
		expect([...m.cells.values()].some((c) => c.col === NO_ENV)).toBe(false);
	});
	test('checkout-api prod folds five regions into one cell, one contract link', () => {
		const c = m.cells.get(cellKey('checkout-api', 'prod'))!;
		expect(c.sites).toHaveLength(5);
		expect(c.held).toBe(5);
		const l = m.links.filter((l) => l.kind === 'contract' && l.to === c.key);
		expect(l).toHaveLength(1);
		expect(l[0].heldCount).toBe(4);
		expect(l[0].serves).toBe('2.4.1');
	});
	test('ledger-core in prod frees the most, banner and map name the same blocker', () => {
		const top = m.blockers[0];
		expect(top.node.name).toBe('ledger-core');
		expect(top.frees).toHaveLength(7);
		expect(m.cells.has(top.cell.key)).toBe(true);
		expect(m.heldByDeploy).toBe(12);
		expect(m.heldLinks).toBe(13);
	});
	test('providers sit above their consumers in one group', () => {
		const names = m.rows.map((r) => r.service);
		expect(names.indexOf('ledger-core')).toBeLessThan(names.indexOf('payments-svc'));
		expect(names.indexOf('payments-svc')).toBeLessThan(names.indexOf('checkout-api'));
	});
	test('a filter keeps the held providers of what it keeps', () => {
		const keep = new Set(g.nodes.filter((n) => n.namespace === 'checkout-api-prod-us-east-1').map((n) => n.id));
		const f = buildLanes({ graph: g, environments, keep });
		expect([...f.cells.keys()].sort()).toEqual([cellKey('checkout-api', 'prod'), cellKey('ledger-core', 'prod'), cellKey('payments-svc', 'prod')].sort());
	});
});
