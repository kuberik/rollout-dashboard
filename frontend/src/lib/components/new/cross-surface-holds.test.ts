import { describe, it, expect, afterEach } from 'vitest';
import { rollouts, apps, placeHolds, gatesOf, heldCauses, appHolds, holdLead, approvalTarget, type TRow } from './data';
import { sentenceOf } from './rollouts-page';
import { holdRows, pinnedPlaces } from './app/app-model';
import { behindOfApp, stepSplit } from './env/env-page';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { source, resetHomeModel } from '$lib/components/home/sketch/home-data';

/**
 * One predicate per fact, every surface reads it: the same app or place never says two things. These pin the
 * cross-surface agreements for a deploy window (named one way), a pin (a hold on the Holding card as on the place row),
 * the Apps list lead (never wrapped twice) and /envs "In step" (the same newest-build predicate as the at-rest rows).
 */
afterEach(() => { installLiveSource(null); resetHomeModel(); });

type G = { name: string; kind?: string; displayName?: string; passing?: boolean; allowedVersions?: string[] | null };
type R = { metadata: { name: string; namespace: string }; status: { gates?: G[] } };
const prodRs = () => (source().rollouts as unknown as R[]).filter((r) => r.metadata.name === 'payments-core' && /prod-(us-east|us-west|eu-west|ap-south|sa-east)$/.test(r.metadata.namespace));
const withGates = (gates: G[], run: () => void) => {
	const rs = prodRs();
	rs.forEach((r) => r.status.gates!.push(...gates.map((g) => ({ ...g }))));
	resetHomeModel();
	try { run(); } finally { rs.forEach((r) => { r.status.gates = r.status.gates!.filter((g) => !gates.some((x) => x.name === g.name)); }); resetHomeModel(); }
};
const prodRow = (): TRow => rollouts('incident').rows.find((r) => r.app === 'payments-core' && r.tier === 'prod')!;

describe('a deploy window is named one way on every surface', () => {
	const window_ = (displayName?: string): G => ({ name: 'schedule-gate-qqqqq', kind: 'schedule', passing: false, allowedVersions: null, ...(displayName ? { displayName } : {}) });
	it('named: the row, the held causes, the app banner and the Holding card all say "Business Hours Only"', () => {
		withGates([window_('Business Hours Only')], () => {
			const row = prodRow();
			expect(sentenceOf(row, 'incident')[0]).toBe('Held by Business Hours Only · also needs your approval');
			const hc = heldCauses('incident').find((c) => c.rows.some((r) => r.href === row.href));
			expect(hc?.cause, 'the held cause (banner, /environments) reads the row\'s own wording').toBe('Held by Business Hours Only');
			expect(appHolds({ app: 'payments-core', holdCauses: [] }, 'incident').some((h) => h.text.startsWith('Held by Business Hours Only in ')), 'the app banner').toBe(true);
			const g = gatesOf('payments-core', 'incident').find((x) => x.kind === 'schedule');
			expect(g?.name, 'the Holding card names the window the same way').toBe('Business Hours Only');
		});
	});
	it('unnamed: the row, the held causes and the banner say "Waits for the deploy window", never "Held by Gate" or "Held by a rule"', () => {
		withGates([window_()], () => {
			const row = prodRow();
			const s = sentenceOf(row, 'incident')[0];
			expect(s).toMatch(/^Waits for the deploy window/);
			expect(s).not.toMatch(/Held by (Gate|a rule)/);
			expect(heldCauses('incident').find((c) => c.rows.some((r) => r.href === row.href))?.cause).toBe('Waits for the deploy window');
			expect(appHolds({ app: 'payments-core', holdCauses: [] }, 'incident').some((h) => /^Waits for the deploy window in /.test(h.text))).toBe(true);
			expect(gatesOf('payments-core', 'incident').find((x) => x.kind === 'schedule')?.name).toBe('Deploy window');
		});
	});
	it('one Holding row per window, however many places carry its gate (each place has its own gate object)', () => {
		const rs = prodRs();
		const added = rs.map((r, i) => { const g: G = { name: `schedule-gate-p${i}`, kind: 'schedule', passing: false, allowedVersions: null, displayName: 'Business Hours Only' }; r.status.gates!.push(g); return [r, g] as const; });
		resetHomeModel();
		try {
			const rows = gatesOf('payments-core', 'incident').filter((g) => g.kind === 'schedule');
			expect(rows.map((g) => g.name)).toEqual(['Business Hours Only']);
			expect(rows[0].places.length, 'it lists every place the window holds').toBeGreaterThan(1);
		} finally { added.forEach(([r, g]) => { r.status.gates = r.status.gates!.filter((x) => x !== g); }); resetHomeModel(); }
	});
	it('the window is named even when the schedule is not joined and the gate carries only its kind', () => {
		withGates([window_()], () => {
			installLiveSource({ ...(source() as object), schedules: null } as never);
			const hc = heldCauses('incident').find((c) => c.rows.some((r) => r.href === prodRow().href));
			expect(hc?.cause).not.toMatch(/Held by a rule|Gate|check/);
		});
	});
});

describe('the Apps list lead', () => {
	it('is the hold in its own words, never wrapped in "Waiting on" again', () => {
		expect(holdLead('Waits on payments-svc in 2 prod regions')).toBe('Waiting on payments-svc');
		expect(holdLead('Held by Business Hours Only in dev')).toBe('Held by Business Hours Only');
		expect(holdLead('Held by Business Hours Only in eu-west and us-east · opens Mon 09:00 UTC')).toBe('Held by Business Hours Only');
		expect(holdLead('Waits for the deploy window in prod')).toBe('Waits for the deploy window');
		expect(holdLead('Integration tests in staging')).toBe('Waiting on Integration tests');
	});
});

describe('a pin is a hold on every page of the app', () => {
	it('checkout-api: the place row says held by the pin, so the Holding card lists the pin (never "Nothing held" beside it)', () => {
		const places = placeHolds('checkout-api', 'incident');
		const item = apps('incident').items.find((a) => a.app === 'checkout-api')!;
		const pins = pinnedPlaces(item.holds);
		expect(pins.size, 'the fixture app is pinned').toBeGreaterThan(0);
		const rows = holdRows(gatesOf('checkout-api', 'incident'), places, null, 'checkout-api', pins);
		const pin = rows.find((r) => r.kind === 'pin');
		expect(pin?.holding).toBe(true);
		expect(pin?.places).toEqual([...pins].map((p) => places.find((x) => x.place === p)!.place));
		expect(holdRows(gatesOf('checkout-api', 'incident'), places, null, 'checkout-api').some((r) => r.kind === 'pin'), 'without the pins argument there is no pin row (the defect)').toBe(false);
	});
});

describe('/envs In step is the at-rest predicate', () => {
	it('an app one build behind here with nothing inbound is listed Behind with its number, never In step', () => {
		const items = new Map([
			['one-behind', { placeList: [{ tier: 'staging', label: 'staging', behind: 1 }] }],
			['newest', { placeList: [{ tier: 'staging', label: 'staging', behind: 0 }] }],
			['behind-elsewhere', { placeList: [{ tier: 'prod', label: 'eu', behind: 3 }, { tier: 'staging', label: 'staging', behind: 0 }] }],
			['one-here-three-there', { placeList: [{ tier: 'staging', label: 'staging', behind: 1 }, { tier: 'prod', label: 'eu', behind: 3 }] }]
		]);
		const behindOf = (app: string) => behindOfApp(items.get(app) ?? null, 'staging', null);
		const s = stepSplit(['one-behind', 'newest', 'behind-elsewhere', 'one-here-three-there'].map((app) => ({ app, href: `/apps/${app}` })), behindOf);
		expect(s.inStep.map((a) => a.app)).toEqual(['newest', 'behind-elsewhere']);
		/* THIS environment's distance, not the app's maximum over every place: 1 behind in staging, not 3 */
		expect(s.behind).toEqual([{ app: 'one-behind', href: '/apps/one-behind', n: 1 }, { app: 'one-here-three-there', href: '/apps/one-here-three-there', n: 1 }]);
	});
});

void approvalTarget;
