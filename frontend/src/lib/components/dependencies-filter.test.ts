import { describe, it, expect } from 'vitest';
import { depEntries, depDefs, parseDepFilter, depParams, keptColumns, narrowToSearch } from './dependencies-filter';

const nodes = [{ env: 'prod', name: 'a' }, { env: 'prod', name: 'b' }, { env: 'dev', name: 'a' }, { env: 'payments-core', name: 'c' }];
const es = depEntries(nodes, (e) => ['prod', 'dev'].includes(e));
const defs = depDefs(['prod', 'dev']);
describe('dependencies filter', () => {
	it('splits real environments from namespace columns', () => {
		expect(es.map((e) => [e.env, e.ns])).toEqual([['prod', ''], ['prod', ''], ['dev', ''], ['', 'payments-core']]);
	});
	it('no filter keeps everything (null)', () => expect(keptColumns(es, parseDepFilter(new URLSearchParams('')), defs)).toBeNull());
	it('is / not', () => {
		expect(keptColumns(es, parseDepFilter(new URLSearchParams('env=prod,dev')), defs)).toEqual(['prod', 'dev']);
		expect(keptColumns(es, parseDepFilter(new URLSearchParams('env!=prod')), defs)).toEqual(['dev', 'payments-core']);
		expect(keptColumns(es, parseDepFilter(new URLSearchParams('ns=payments-core')), defs)).toEqual(['payments-core']);
	});
	it('search matches rollout names and the url round-trips', () => {
		const f = parseDepFilter(new URLSearchParams('q=c&scenario=x'));
		expect(keptColumns(es, f, defs)).toEqual(['payments-core']);
		expect(depParams(new URLSearchParams('scenario=x'), f).toString()).toBe('scenario=x&q=c');
	});
	it('search narrows the graph to matching rollouts and their direct links', () => {
		const n = (id: string, name: string) => ({ id, name, env: 'prod' }) as never;
		const e = (from: string, to: string, state = 'ok') => ({ key: `${from}-${to}`, from, to, state }) as never;
		const g = { nodes: [n('1', 'checkout'), n('2', 'ledger'), n('3', 'hello-world')], edges: [e('2', '1', 'blocked')], envs: [], blockedEdges: [], hasCycle: false, unlinkedRollouts: 0 } as never;
		const out = narrowToSearch(g, 'check');
		expect(out.nodes.map((x) => x.name)).toEqual(['checkout', 'ledger']);
		expect(out.blockedEdges).toHaveLength(1);
		expect(narrowToSearch(g, '  ')).toBe(g);
	});
});
