import { describe, it, expect, afterEach } from 'vitest';
import { apps, regionStates, heldUnion, heldBanner, appHolds, placeHolds, gatesOf, inbound, heldCauses } from './data';
import { holdRows, pinnedPlaces } from './app/app-model';
import { homePage } from './home-page';
import { laneOf, nodeStateOfPlace } from './Footprint.svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { resetHomeModel } from '$lib/components/home/sketch/home-data';

/** A pin is a hold, so checkout-api prod reads "3 of 5" held (payments-svc waits in 2 regions, the pin holds 1) on every surface: one predicate (`pinHoldsBuilds`), one view of the state (`placeStateWithPin`). */
afterEach(() => { installLiveSource(null); resetHomeModel(); });

const item = () => apps('incident').items.find((a) => a.app === 'checkout-api')!;

describe('checkout-api prod: the pinned region counts as held, on the Apps tile, the app page and Home', () => {
	it('the promotion lane (Apps tile, app page chip) holds 3 of 5 prod regions', () => {
		const { lane } = laneOf(item(), { apps: [] }, []);
		expect(lane.prod).toHaveLength(5);
		expect(lane.prod.filter((n) => n.state === 'held')).toHaveLength(3);
	});
	it('the live lane (Apps tile) maps the same place to the same state: a pinned place is held, an unpinned rolled-back one is not', () => {
		expect(nodeStateOfPlace({ state: 'rolled-back', pinned: true })).toBe('held');
		expect(nodeStateOfPlace({ state: 'rolled-back', pinned: false })).toBeUndefined();
	});
	it('the Home Fleet row for checkout-api reads "3 of 5": the same count as the Apps lane (3 held of 5 prod regions)', () => {
		const row = homePage('incident').fleet.trouble.find((t) => t.app === 'checkout-api' && t.mark === 'held')!;
		expect(row.places.find((p) => p.tier === 'prod')?.place).toBe('3 of 5 regions');
		expect(`${row.word} ${row.places.map((p) => p.place).join(' ')}`).toContain('3 of 5');
		const { lane } = laneOf(item(), { apps: [] }, []);
		expect(row.places.find((p) => p.tier === 'prod')?.place).toBe(`${lane.prod.filter((n) => n.state === 'held').length} of ${lane.prod.length} regions`);
	});
	it('the pin is a separate flag: the approval counts (ink waiting) are unchanged by it', () => {
		const regs = regionStates('checkout-api', 'incident');
		const pinned = regs.filter((r) => r.pinned);
		expect(pinned.length, 'one pinned region').toBe(1);
		expect(pinned.every((r) => r.ink !== 'waiting'), 'the pin never inks waiting').toBe(true);
		expect(regs.filter((r) => r.ink === 'waiting')).toHaveLength(2);
	});
});

describe('the app banner and the Holding card', () => {
	it('the banner headline counts every held place, the pin included: staging and 3 prod regions', () => {
		const u = heldUnion(item())!;
		expect(u.sentence).toBe('Held in staging and 3 prod regions');
		expect(u.count).toBe(4);
	});
	it('the banner lists each cause once under that headline, never the same cause twice', () => {
		const b = heldBanner(item(), appHolds(item(), 'incident'))!;
		expect(b.title).toBe('Held in staging and 3 prod regions');
		expect(b.message).toBe('Waits on payments-svc in staging and 2 prod regions · Pinned to 4.40.0-40 in af-south-1');
	});
	it('each Holding row counts only staging and prod places (the banner\'s tiers), the pin row included', () => {
		const places = placeHolds('checkout-api', 'incident');
		const rows = holdRows(gatesOf('checkout-api', 'incident'), places, null, 'checkout-api', pinnedPlaces(item().holds)).filter((r) => r.holding);
		expect(rows.length).toBeGreaterThan(1);
		for (const r of rows) for (const pl of r.places) expect(['staging', 'prod'], `${r.name}: ${pl}`).toContain(places.find((x) => x.place === pl)!.tier);
		/* the scope in numbers: the dependency row's 3 places (only what it holds now) = staging 1 + prod 2, the pin row's 1 = prod 1 */
		const tiersOf = (r: (typeof rows)[number]) => r.places.map((pl) => places.find((x) => x.place === pl)!.tier);
		const dep = rows.find((r) => r.kind === 'dependency')!, pin = rows.find((r) => r.kind === 'pin')!;
		expect(dep.places).toHaveLength(3);
		expect(tiersOf(dep).filter((t) => t === 'staging')).toHaveLength(1);
		expect(tiersOf(dep).filter((t) => t === 'prod')).toHaveLength(2);
		expect(tiersOf(pin)).toEqual(['prod']);
	});
});

describe('/envs/prod Held row for checkout-api', () => {
	it('links to a place held by the cause it names, never to the pinned sibling listed first', () => {
		const x = inbound('incident', 'prod').find((i) => i.app === 'checkout-api')!;
		expect(x.reason).toBe('Waiting on payments-svc');
		const c = heldCauses('incident').find((h) => h.cause === x.reason)!;
		expect(c.rows.some((r) => r.href === x.href)).toBe(true);
	});
});
