import { describe, it, expect, afterEach } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { heldCauses, gatesOf, apps } from './data';

afterEach(() => installLiveSource(null));

/* batch4: the API serves `displayName` (the gate's pretty-name annotation) on every gate summary. With no gate object loaded yet (a cold page)
   every surface that names a gate must read it, through the one gateDisplayName, never the generic "Gate". */
function withDisplayName(name: string | undefined) {
	const src = fixtureSource();
	const rollouts = structuredClone(src.rollouts) as typeof src.rollouts;
	const touched: string[] = [];
	for (const r of rollouts) for (const g of r.status?.gates ?? []) {
		(g as { displayName?: string }).displayName = name; touched.push(g.name);
	}
	installLiveSource({ ...src, rollouts } as never);
	return touched;
}

describe('a gate summary displayName names the gate with no gate object loaded', () => {
	it('baseline: no displayName keeps today\'s names', () => {
		withDisplayName(undefined);
		const names = apps('incident').items.flatMap((a) => gatesOf(a.app, 'incident').map((g) => g.name));
		expect(names.length).toBeGreaterThan(0);
		expect(names).not.toContain('Business Hours Only');
	});
	it('Holding card / Gates list rows read the displayName', () => {
		withDisplayName('Business Hours Only');
		const names = apps('incident').items.flatMap((a) => gatesOf(a.app, 'incident').map((g) => g.name));
		expect(names.length).toBeGreaterThan(0);
		for (const n of names) expect(n).toBe('Business Hours Only');
	});
	it('the held-cause row reads the displayName, never "Gate"', () => {
		withDisplayName('Business Hours Only');
		const causes = heldCauses('incident').map((c) => c.cause).filter((c) => /^Waiting on /.test(c));
		for (const c of causes) expect(c).not.toMatch(/Gate\b/);
	});
});

import { buildGateContext, blockingStory } from '$lib/view-models/blocking-story';
import { rolloutGateBoxes } from '$lib/view-models/rollout-gates';
import { stillHeldAfterApproval } from './data';

const summaryRollout = (displayName?: string) => ({
	metadata: { name: 'app', namespace: 'ns' },
	spec: {},
	status: { gates: [{ name: 'ghd-6p5hd', passing: false, ...(displayName ? { displayName } : {}) }], releaseCandidates: [{ tag: 'r2' }] }
}) as never;

describe('the gate context and the Gates tab read the summary displayName', () => {
	it('blocking-story ctx.pretty is seeded from the summaries (no gate object)', () => {
		const ctx = buildGateContext({ rollouts: [summaryRollout('Business Hours Only')] });
		expect(ctx.pretty?.get('ns/ghd-6p5hd')).toBe('Business Hours Only');
		expect(buildGateContext({ rollouts: [summaryRollout()] }).pretty?.size).toBe(0);
	});
	it('a gate box with no object is titled by the summary displayName, else "Gate"', () => {
		const focus = { holds: [{ gate: 'ghd-6p5hd', clears: 'check', short: 'Not passing' }] } as never;
		const title = (dn?: string) => rolloutGateBoxes({ focus, rollout: summaryRollout(dn), rolloutGates: [], schedules: [], healthChecks: null, edgeGates: new Set() }).map((b) => b.title);
		expect(title('Business Hours Only')).toContain('Business Hours Only');
		expect(title()).not.toContain('Business Hours Only');
	});
	it('the toast names the still-holding gate through the same pretty reader', () => {
		const gates = [{ name: 'ghd-6p5hd', allowedVersions: [] as string[] }];
		expect(stillHeldAfterApproval(gates, 'r2', null, (n) => (n === 'ghd-6p5hd' ? 'Business Hours Only' : n))).toBe('Business Hours Only');
	});
});
