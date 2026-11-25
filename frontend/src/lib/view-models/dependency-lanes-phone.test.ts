import { describe, test, expect } from 'vitest';
import { fleet, environments, list } from './gates-tab-reference.testkit';
import { buildLanes, heldSinceByEdge } from './dependency-lanes';
import { blockerTree, promotionPath, treeSize, needPhrase } from './dependency-lanes-phone';

const g = fleet.providerNetwork;
const m = buildLanes({ graph: g, environments, heldSince: heldSinceByEdge(g, list.rolloutDependencies.items) });

describe('phone geometry (home-incident)', () => {
	test('the top blocker tree frees what the blocker frees, each cell once', () => {
		const top = m.blockers[0];
		const t = blockerTree(m, top);
		expect(t.cell.key).toBe(top.cell.key);
		expect(treeSize(t)).toBe(top.freesCells.length);
		const pay = t.children.find((c) => c.cell.service === 'payments-svc')!;
		expect(pay.via?.held).toBe(true);
		expect(pay.children.map((c) => c.cell.service)).toContain('checkout-api');
	});
	test('promotion path: environments in order, a link into every stop but the first', () => {
		const p = promotionPath(m, 'hello-world');
		expect(p.map((s) => s.col)).toEqual(['dev', 'staging', 'prod']);
		expect(p[0].link).toBeNull();
		expect(p[1].link?.held).toBe(true);
	});
});

describe('needPhrase', () => {
	const link = (needs: string[], ranges: (string | null)[]) =>
		({ contract: 'payments', needs, serves: '2.4.1', edges: ranges.map((r) => ({ state: 'blocked', requiredVersion: r })) }) as never;
	test('one range: one unit', () => {
		expect(needPhrase(link(['^6.0.0'], ['^6.0.0']))).toEqual({ need: 'needs payments ^6.0.0', minority: null, has: 'has 2.4.1' });
	});
	test('regions disagree: the majority leads, the rest is counted', () => {
		const p = needPhrase(link(['~2.9.0', '^3.0.0'], ['^3.0.0', '^3.0.0', '^3.0.0', '~2.9.0']));
		expect(p.need).toBe('needs payments ^3.0.0');
		expect(p.minority).toBe('1 region ~2.9.0');
	});
	test('edges do not carry the ranges: list them, never invent a count', () => {
		expect(needPhrase(link(['~2.9.0', '^3.0.0'], [null, null])).need).toBe('needs payments ~2.9.0 or ^3.0.0');
	});
});
