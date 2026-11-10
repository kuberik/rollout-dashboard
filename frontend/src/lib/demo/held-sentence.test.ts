import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { buildRolloutGraph, heldClause, heldSummary } from '../view-models/dependency-graph';
import type { GraphNode } from '../view-models/dependency-graph';
import type { Environment, Rollout, RolloutDependency } from '../../types';

/**
 * `/dependencies`' banner on the demo fleet at rest: 11 of 22 links held,
 * several consumers of ONE contract held on different ranges. The clause names
 * each provider/contract once (2026-10-09).
 */
describe("/dependencies' held clause on the demo fleet (14 held: 8 contract + 6 promotion edges)", () => {
	beforeEach(() => resetDemoState('calm'));
	afterEach(() => resetDemoState('calm'));

	it('names each provider and contract once', () => {
		const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as {
			rollouts: { items: Rollout[] };
			environments: { items: Environment[] };
			rolloutDependencies: { items: RolloutDependency[] };
		};
		const g = buildRolloutGraph({
			rollouts: l.rollouts.items,
			environments: l.environments.items,
			dependencies: l.rolloutDependencies.items,
			envOrder: []
		});
		expect(g.blockedEdges).toHaveLength(14);
		const clause = heldClause(g.blockedEdges, new Map(g.nodes.map((n) => [n.id, n])));
		expect(clause.match(/payments-svc ships/g)).toHaveLength(1);
		expect(clause.match(/ledger-core ships/g)).toHaveLength(1);
		const heldNodes = [...new Set(g.blockedEdges.map((e) => e.to))].map(
			(id) => g.nodes.find((n) => n.id === id)!
		);
		expect(heldSummary(heldNodes)).toBe(
			'5 services, mostly checkout-api and hello-world,'
		);
		expect(clause).toBe(
			'ledger-core ships ledger ^6.0.0, payments-svc ships the payments each of them needs (~2.9.0, ^3.0.0) and the deploy in front of each of them lands'
		);
		// The banner's own form: providers only, versions left to the graph.
		expect(heldClause(g.blockedEdges, new Map(g.nodes.map((n) => [n.id, n])), { brief: true })).toBe(
			'ledger-core and payments-svc ship the versions they need and the deploys ahead of them land'
		);
	});
});

describe('heldSummary', () => {
	const node = (name: string, env: string) => ({ id: `${name}/${env}`, name, env }) as GraphNode;

	it('keeps the full list for one or two apps', () => {
		expect(heldSummary([node('a', 'dev'), node('a', 'prod'), node('b', 'dev')])).toBe(
			'a in dev and prod and b in dev'
		);
	});

	it('says "including" when no app is held in more than one place', () => {
		expect(heldSummary([node('a', 'dev'), node('b', 'dev'), node('c', 'dev')])).toBe(
			'3 services, including a and b,'
		);
	});
});

describe('heldClause brief', () => {
	const nodes = new Map([
		['api', { id: 'api', name: 'hello-api-app', env: 'dev' } as GraphNode],
		['fe', { id: 'fe', name: 'fe', env: 'dev' } as GraphNode]
	]);
	const edge = (writer: 'contract' | 'promotion', to = 'fe') =>
		({ key: writer + to, from: 'api', to, writer, gate: 'g', state: 'blocked', contract: 'api', requiredVersion: '^1', providedVersion: null, relType: null, message: '', cyclic: false, held: [] }) as never;
	it('one provider: singular verb, no versions', () => {
		expect(heldClause([edge('contract')], nodes, { brief: true })).toBe(
			'hello-api-app ships the versions they need'
		);
	});
	it('promotion only: the brief order clause', () => {
		expect(heldClause([edge('promotion')], nodes, { brief: true })).toBe('the deploys ahead of them land');
	});
});
