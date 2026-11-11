import { describe, it, expect, afterEach } from 'vitest';
import { apps, heldUnion, heldBanner, appHolds, placeHolds, gatesOf } from './data';
import { holdRows, pinnedPlaces } from './app/app-model';
import { laneOf } from './Footprint.svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { resetHomeModel } from '$lib/components/home/sketch/home-data';

/** A Holding row lists and counts only the places its cause holds NOW: the rows together cover the held union, no place twice, and the banner, the chips and the rows agree. */
afterEach(() => { installLiveSource(null); resetHomeModel(); });
const item = () => apps('incident').items.find((a) => a.app === 'checkout-api')!;

describe('checkout-api Holding rows', () => {
	const places = placeHolds('checkout-api', 'incident');
	const rows = holdRows(gatesOf('checkout-api', 'incident'), places, null, 'checkout-api', pinnedPlaces(item().holds)).filter((r) => r.holding);
	const covered = rows.flatMap((r) => r.places);
	it('the dependency row lists the places payments-svc holds now: staging and two prod regions (not eu-central healthy, not us-east-2 checking)', () => {
		const dep = rows.find((r) => r.kind === 'dependency')!;
		expect(dep.places).toHaveLength(3);
		expect(dep.places.filter((p) => places.find((x) => x.place === p)!.tier === 'staging')).toHaveLength(1);
		expect(dep.places.filter((p) => places.find((x) => x.place === p)!.tier === 'prod')).toHaveLength(2);
		expect(dep.places.join(' ')).not.toMatch(/eu-central|us-east-2/);
	});
	it('the pin row lists the pinned region only', () => {
		expect(rows.find((r) => r.kind === 'pin')!.places).toHaveLength(1);
		expect(rows.find((r) => r.kind === 'pin')!.places[0]).toMatch(/af-south-1/);
	});
	it('the rows together cover exactly the held union: staging + 3 prod, no place twice', () => {
		expect(new Set(covered).size).toBe(covered.length);
		expect(covered).toHaveLength(4);
		expect(covered.filter((p) => places.find((x) => x.place === p)!.tier === 'prod')).toHaveLength(3);
	});
	it('the banner, the chips and the rows agree (3 prod, staging + 3 prod)', () => {
		const u = heldUnion(item())!;
		expect(u.sentence).toBe('Held in staging and 3 prod regions');
		expect(u.count).toBe(covered.length);
		const b = heldBanner(item(), appHolds(item(), 'incident'))!;
		expect(b.title).toBe('Held in staging and 3 prod regions');
		const { lane } = laneOf(item(), { apps: [] }, []);
		expect(lane.prod.filter((n) => n.state === 'held')).toHaveLength(3);
		expect(lane.prod).toHaveLength(5);
	});
});
