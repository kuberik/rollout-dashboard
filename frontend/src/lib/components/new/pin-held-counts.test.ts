import { describe, it, expect, afterEach } from 'vitest';
import { fleetCounts, rollouts, pinOnlyPlaces } from './data';
import { rolloutsPage } from './rollouts-page';
import { homePage, foldPinIntoFleet } from './home-page';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { resetHomeModel } from '$lib/components/home/sketch/home-data';

/** A pin is a hold in every COUNT: fleetCounts (Apps header, /environments, /envs/prod), the /rollouts totals and Home's Fleet read one union per place, a place never twice. */
afterEach(() => { installLiveSource(null); resetHomeModel(); });

const env = (o: Partial<{ env: string; label: string; tier: string; state: string; pinned: boolean; href: string }>) =>
	({ env: 'prod-a', label: 'a', tier: 'prod', state: 'rolled-back', pinned: true, href: '/rollouts/prod/x-a/x', ...o }) as never;

describe('pinOnlyPlaces: the places only the pin holds', () => {
	it('a pinned place with a quiet state and no row is pin-only', () => {
		const out = pinOnlyPlaces([{ app: 'x', envs: [env({})] }], []);
		expect(out.map((p) => p.label)).toEqual(['a']);
	});
	it('a place both pinned and dependency-held has a row: counted by the row, never again', () => {
		const e = env({ state: 'held-by-rule' });
		expect(pinOnlyPlaces([{ app: 'x', envs: [e] }], [{ app: 'x', tier: 'prod', href: '/rollouts/prod/x-a/x', regions: ['a'] }])).toEqual([]);
		expect(pinOnlyPlaces([{ app: 'x', envs: [e] }], [])).toEqual([]);
	});
	it('a place named by a row of its own app and tier is covered even under another href', () => {
		expect(pinOnlyPlaces([{ app: 'x', envs: [env({ state: 'healthy' })] }], [{ app: 'x', tier: 'prod', href: '/other', regions: ['a', 'b'] }])).toEqual([]);
	});
	it('a staging pin counts too, and one place is listed once', () => {
		const st = env({ env: 'staging', label: 'staging', tier: 'staging', state: 'healthy', href: '/rollouts/staging/x-s/x' });
		expect(pinOnlyPlaces([{ app: 'x', envs: [st, st] }], []).map((p) => p.tier)).toEqual(['staging']);
	});
	it('a place already in an ask or in "yours" (its row key) is not listed again', () => {
		const st = env({ env: 'staging', label: 'staging', tier: 'staging', state: 'healthy', href: '/rollouts/staging/x-s/x' });
		expect(pinOnlyPlaces([{ app: 'x', envs: [st] }], [], new Set(['x@staging']))).toEqual([]);
	});
	it('a pin that holds nothing newer (no pinned flag) holds nothing', () => {
		expect(pinOnlyPlaces([{ app: 'x', envs: [env({ pinned: false })] }], [])).toEqual([]);
	});
});

describe('checkout-api prod: the pinned region is held in every count', () => {
	const rows = () => rollouts('incident').rows;
	const rowPlaces = (g: string) => rows().filter((r) => r.group === g).reduce((n, r) => n + r.regions.length, 0);
	it('fleetCounts adds the one pin-only place (af-south-1) to the places held by rules, once', () => {
		const c = fleetCounts('incident');
		expect(rowPlaces('held')).toBe(6);
		expect(c.places.held).toBe(7);
		expect(c.places.waiting).toBe(rowPlaces('approval') + 7);
		expect(c.holds.places).toBe(rowPlaces('approval') + 7);
	});
	it('the /rollouts totals count it as held (one more Held row), and it is no longer at rest', () => {
		const base = rolloutsPage('incident');
		const held = rows().filter((r) => r.group === 'held').length;
		expect(base.counts.held).toBe(held + 1);
		expect(base.rest.some((p) => p.app === 'checkout-api' && p.place.includes('af-south-1'))).toBe(false);
		expect(base.counts.rest).toBe(base.rest.length);
	});
});

describe('Home Fleet: the pin folds into the app\'s held row by union', () => {
	const pin = (o: Partial<{ app: string; tier: string; label: string }> = {}) => ({ app: 'x', tier: 'prod', label: 'a', href: '/h', key: 'x@prod-a', since: '', ...o });
	const fold = (pins: ReturnType<typeof pin>[], held: [string, string[]][] = []) => {
		const by = new Map<string, never>() as never as Map<string, any>;
		const regs = new Map<string, Map<string, string[]>>(held.length ? [['x', new Map(held)]] : []);
		foldPinIntoFleet(by as never, regs, pins as never);
		return [...by.values()] as unknown as { places: { tier: string; place: string }[] }[];
	};
	it('checkout-api prod reads 3 of 5 regions (2 held by a rule + the pin) and staging once', () => {
		const t = homePage('incident').fleet.trouble.filter((x) => x.app === 'checkout-api' && x.mark === 'held');
		expect(t).toHaveLength(1);
		expect(t[0].places.map((p) => p.tier)).toEqual(['staging', 'prod']);
		expect(t[0].places.find((p) => p.tier === 'prod')?.place).toBe('3 of 5 regions');
	});
	it('a pinned staging place is listed under staging, not dropped', () => {
		const [row] = fold([pin({ tier: 'staging', label: 'staging' })]);
		expect(row.places.map((p) => p.tier)).toEqual(['staging']);
	});
	it('a label the app\'s held rows already name is not counted twice', () => {
		const [row] = fold([pin({ label: 'a' }), pin({ label: 'a' })], [['prod', ['a', 'b']]]);
		expect(row.places.find((p) => p.tier === 'prod')?.place).toBe('2 regions');
	});
	it('two pins in different regions join the rule-held ones', () => {
		const [row] = fold([pin({ label: 'c' }), pin({ label: 'd' })], [['prod', ['a', 'b']]]);
		expect(row.places.find((p) => p.tier === 'prod')?.place).toBe('4 regions');
	});
});
