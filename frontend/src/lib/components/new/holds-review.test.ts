import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { appHolds, heldCauses, apps, placeHolds, gatesOf } from './data';
import { holdRows, pinnedPlaces, pinnedVersion } from './app/app-model';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { source, resetHomeModel } from '$lib/components/home/sketch/home-data';

/** review fixes on the cross-surface holds: type role of the Behind figure, the Holding row's spacing, and the held, named window's clause. */
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
afterEach(() => { vi.useRealTimers(); installLiveSource(null); resetHomeModel(); });

describe('/envs Behind draws "N behind" in the body role (400), as /apps and /rollouts do', () => {
	it('the figure carries t-body, never the link\'s 500', () => {
		const s = src('./env/EnvPage.svelte');
		const fig = /<span class="([^"]*)">\{a\.place[^<]*\{a\.n\} behind · \{a\.why\}<\/span>/.exec(s);
		expect(fig, 'the figure span exists').not.toBeNull();
		expect(fig![1]).toMatch(/\bt-body\b/);
	});
});

describe('the expanded Holding row', () => {
	it('separates the places list from the "Releases when" line by 4px (mt-1)', () => {
		const s = src('./app/AppGates.svelte');
		expect(s).toMatch(/<p class="t-meta mt-1 text-fg-subtle">\{r\.sentence\}<\/p>/);
	});
});

type R = { metadata: { name: string; namespace: string }; status: { gates?: unknown[] } };
describe('a held, named deploy window says when it opens, in the banner', () => {
	it('payments-core: "Held by Business Hours Only in <places> · opens Mon 09:00 UTC"', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
		const rs = (source().rollouts as unknown as R[]).filter((r) => r.metadata.name === 'payments-core' && /prod-(us-east|us-west|eu-west|ap-south|sa-east)$/.test(r.metadata.namespace));
		const gate = { name: 'schedule-gate-qqqqq', kind: 'schedule', passing: false, allowedVersions: null };
		rs.forEach((r) => r.status.gates!.push({ ...gate }));
		const sched = { metadata: { name: 'business-hours', annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' } }, spec: { action: 'Allow', timezone: 'UTC' }, status: { active: false, nextTransition: '2026-11-16T09:00:00Z', managedGates: [gate.name] } };
		installLiveSource({ ...(source() as object), schedules: new Map([['prod', { clusterRolloutSchedules: { items: [sched] } }]]) } as never);
		resetHomeModel();
		try {
			
			expect(heldCauses('incident').some((c) => c.window?.opens === 'opens Mon 09:00 UTC'), 'the held cause carries the clause').toBe(true);
			const h = appHolds({ app: 'payments-core', holds: [] }, 'incident').find((x) => x.text.startsWith('Held by Business Hours Only in '));
			expect(h?.text).toMatch(/^Held by Business Hours Only in .+ · opens Mon 09:00 UTC$/);
		} finally { rs.forEach((r) => { r.status.gates = r.status.gates!.filter((g) => (g as { name: string }).name !== gate.name); }); }
	});
});

describe('one pin, one wording on the Holding row', () => {
	it('checkout-api: the pin row is titled with the pinned build', () => {
		const places = placeHolds('checkout-api', 'incident');
		const item = apps('incident').items.find((a) => a.app === 'checkout-api')!;
		expect(pinnedVersion(item.holds)).toBe('4.40.0-40');
		const row = holdRows(gatesOf('checkout-api', 'incident'), places, null, 'checkout-api', pinnedPlaces(item.holds), pinnedVersion(item.holds)).find((r) => r.kind === 'pin');
		expect(row?.name).toBe('Pinned to 4.40.0-40');
	});
	it('no pins or different builds: no version', () => {
		expect(pinnedVersion([])).toBeNull();
		expect(pinnedVersion(['Pinned to 1.0 in a', 'Pinned to 2.0 in b'])).toBeNull();
	});
});
