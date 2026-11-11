import { describe, it, expect, afterEach } from 'vitest';
import { apps, placeHolds, gatesOf } from './data';
import { holdRows, pinnedPlaces } from './app/app-model';
import { newerBuildsShown, gatesPinBox } from '$lib/view-models/pin-hold';
import { getDisplayVersion } from '$lib/utils';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { source, resetHomeModel } from '$lib/components/home/sketch/home-data';

/** A pin is per place: the builds it holds are the same number on the app page's Holding row, the rollout Overview ("N newer") and the Gates tab's pin box. */
afterEach(() => { installLiveSource(null); resetHomeModel(); });

describe('checkout-api: the pinned place holds the same builds on every surface', () => {
	const item = () => apps('incident').items.find((a) => a.app === 'checkout-api')!;
	it('app-page Holding row == Overview count == Gates pin box (4)', () => {
		const places = placeHolds('checkout-api', 'incident');
		const pins = pinnedPlaces(item().holds);
		const row = holdRows(gatesOf('checkout-api', 'incident'), places, new Set(['4.43.0-43']), 'checkout-api', pins).find((r) => r.kind === 'pin')!;
		const pinned = places.find((p) => pins.has(p.place))!;
		const [, , , ns, name] = pinned.href.split('/');
		const rollout = (source().rollouts as unknown as { metadata: { namespace: string; name: string } }[]).find((r) => r.metadata.namespace === ns && r.metadata.name === name)!;
		const fleet = { environments: source().environments as never, rollouts: source().rollouts as never };
		const overview = newerBuildsShown(rollout as never, fleet, true).length;
		const gates = gatesPinBox({ boxes: [{ kind: 'pin', state: 'blocked', held: [] }], rollout: rollout as never, fleet, settled: true, hereBuilds: [], pinnedTo: '4.40', displayVersion: (c) => getDisplayVersion(c as never) }).boxes[0].held.length;
		expect(overview).toBe(4);
		expect(gates).toBe(overview);
		expect(row.held.length).toBe(overview);
	});
});
