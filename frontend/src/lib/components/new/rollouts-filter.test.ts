import { describe, it, expect } from 'vitest';
import { parseFilter, filterParams, filterList, facets, isFiltered, toggled, nsOfHref, EMPTY_FILTER, type RolloutFilter } from './rollouts-filter';
import type { RolloutsPage, StrandRow, RestRow } from './rollouts-page';

const strand = (app: string, ns: string, tier: string, version: string): StrandRow => ({ key: `${ns}/${app}`, app, href: `/rollouts/c1/${ns}/${app}`, tier, row: { version } as never } as unknown as StrandRow);
const rest = (app: string, ns: string, tier: string, code: string): RestRow => ({ key: `${ns}/${app}`, app, href: `/rollouts/c1/${ns}/${app}`, tier, code } as unknown as RestRow);
const P: Pick<RolloutsPage, 'groups' | 'rest' | 'counts' | 'restApps'> = {
	groups: [
		{ key: 'moving', word: 'In flight', rows: [strand('billing-api', 'billing-dev', 'dev', 'a1b2c3d'), strand('orders-api', 'orders-prod', 'prod', '9f8e7d6')] },
		{ key: 'held', word: 'Held', rows: [strand('billing-api', 'billing-prod', 'prod', 'a1b2c3d')] }
	],
	rest: [rest('hello-world', 'hello-prod', 'prod', 'deadbee'), rest('hello-world', 'hello-dev', 'dev', 'deadbee')],
	counts: { moving: 2, waiting: 0, held: 1, rest: 2 }, restApps: 1
};
const f = (o: Partial<RolloutFilter>): RolloutFilter => ({ ...EMPTY_FILTER, ...o });
const names = (r: ReturnType<typeof filterList>) => [...r.groups.flatMap((g) => g.rows.map((x) => x.key)), ...r.rest.map((x) => x.key)];

describe('filterList', () => {
	it('an empty filter keeps everything, untouched', () => {
		const r = filterList(P, EMPTY_FILTER);
		expect(r.groups).toBe(P.groups);
		expect(r.shown).toBe(5);
		expect(isFiltered(EMPTY_FILTER)).toBe(false);
	});
	it('search matches name, namespace and version, case-insensitive', () => {
		expect(names(filterList(P, f({ q: 'ORDERS' })))).toEqual(['orders-prod/orders-api']);
		expect(names(filterList(P, f({ q: 'billing-prod' })))).toEqual(['billing-prod/billing-api']);
		expect(names(filterList(P, f({ q: '9f8e' })))).toEqual(['orders-prod/orders-api']);
		expect(names(filterList(P, f({ q: 'DEADBEE' })))).toEqual(['hello-prod/hello-world', 'hello-dev/hello-world']);
	});
	it('within a row OR, across rows AND', () => {
		expect(names(filterList(P, f({ env: ['prod', 'dev'] }))).length).toBe(5);
		expect(names(filterList(P, f({ env: ['prod'] })))).toEqual(['orders-prod/orders-api', 'billing-prod/billing-api', 'hello-prod/hello-world']);
		expect(names(filterList(P, f({ env: ['prod'], state: ['held', 'rest'] })))).toEqual(['billing-prod/billing-api', 'hello-prod/hello-world']);
		expect(names(filterList(P, f({ state: ['progress'], ns: ['billing-dev', 'orders-prod'] })))).toEqual(['billing-dev/billing-api', 'orders-prod/orders-api']);
	});
	it('a group with no match is gone and the counts are the filtered ones', () => {
		const r = filterList(P, f({ state: ['held'] }));
		expect(r.groups.map((g) => g.key)).toEqual(['held']);
		expect(r.counts).toEqual({ moving: 0, waiting: 0, held: 1, rest: 0 });
		expect(r.rest).toEqual([]);
		expect(filterList(P, f({ state: ['rest'], q: 'hello' })).restApps).toBe(1);
		expect(filterList(P, f({ q: 'nothing-like-this' })).shown).toBe(0);
	});
});

describe('url', () => {
	it('round-trips, keeps foreign params, drops empty dimensions', () => {
		const flt = f({ q: ' world ', state: ['held', 'rest'], env: ['prod'], ns: ['a', 'b'] });
		const out = filterParams(new URLSearchParams('scenario=incident&state=old'), flt);
		expect(out.toString()).toBe('scenario=incident&q=world&state=held%2Crest&env=prod&ns=a%2Cb');
		expect(parseFilter(out)).toEqual({ ...flt, q: 'world' });
		expect(filterParams(out, EMPTY_FILTER).toString()).toBe('scenario=incident');
	});
	it('parses old state links, drops unknown words (failing has no group), dedups, lowercases env', () => {
		expect(parseFilter(new URLSearchParams('state=failing,held,held,bogus&env=PROD,dev')).state).toEqual(['held']);
		expect(parseFilter(new URLSearchParams('state=progress,waiting,held,rest')).state).toEqual(['progress', 'waiting', 'held', 'rest']);
		expect(parseFilter(new URLSearchParams('env=PROD,dev')).env).toEqual(['prod', 'dev']);
		expect(parseFilter(new URLSearchParams(''))).toEqual(EMPTY_FILTER);
	});
	it('toggled and nsOfHref', () => {
		expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
		expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
		expect(nsOfHref('/rollouts/c1/ns-x/app?tab=1')).toBe('ns-x');
		expect(nsOfHref('/apps/x')).toBe('');
	});
});

describe('facets', () => {
	it('offers what the list holds, in product order, with counts given the OTHER rows', () => {
		const fx = facets(P, f({ env: ['prod'] }));
		expect(fx.state.map((o) => o.value)).toEqual(['progress', 'held', 'rest']);
		expect(fx.state.map((o) => o.count)).toEqual([1, 1, 1]);
		expect(fx.env.map((o) => [o.value, o.count, o.selected])).toEqual([['prod', 3, true], ['dev', 2, false]]);
		expect(fx.ns.length).toBe(5);
	});
	it('a selected value that is no longer in the list stays offered so it can be cleared', () => {
		expect(facets(P, f({ ns: ['gone-ns'] })).ns.find((o) => o.value === 'gone-ns')).toMatchObject({ count: 0, selected: true });
	});
});
