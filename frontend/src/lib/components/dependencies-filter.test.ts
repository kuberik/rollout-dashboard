import { describe, it, expect } from 'vitest';
import { depEntries, depDefs, parseDepFilter, depParams, keptColumns } from './dependencies-filter';

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
});
