import { describe, expect, it } from 'vitest';
import { gatesPinBox } from './pin-hold';

const v = (t: string) => ({ tag: t, version: t, revision: t.padEnd(40, '0') });
const rels = ['4.40', '4.41', '4.42', '4.43', '4.44'].map(v);
/* pinned to 4.40; 4.41 failed here; 4.42-4.44 are held by the pin and deployable */
const pinned = {
	metadata: { name: 'checkout-api', namespace: 'prod' },
	spec: { wantedVersion: '4.40' },
	status: {
		currentVersion: '4.40',
		availableReleases: rels,
		releaseCandidates: rels.slice(1),
		history: [{ bakeStatus: 'Succeeded', version: v('4.40') }, { bakeStatus: 'Failed', version: v('4.41') }]
	}
};
const fleet = { environments: [], rollouts: [] };
type Box = { kind: string; state: string; held: string[] };
const boxes: Box[] = [
	{ kind: 'approval', state: 'blocked', held: ['4.41', '4.42', '4.43', '4.44'] },
	{ kind: 'pin', state: 'blocked', held: ['4.41', '4.42', '4.43', '4.44'] }
];
const run = (over: Partial<Parameters<typeof gatesPinBox<Box>>[0]> = {}) =>
	gatesPinBox<Box>({ boxes, rollout: pinned as never, fleet, settled: true, hereBuilds: ['4.42'], pinnedTo: '4.40', displayVersion: (c) => c.tag, ...over });

describe('Gates tab pin box', () => {
	it('the pin box holds the builds the header counts (not the gate list): the failed build is out', () => {
		const pin = run().boxes.find((b) => b.kind === 'pin')!;
		expect(pin.held).toEqual(['4.42', '4.43', '4.44']);
	});
	it('a blocked gate box keeps only the builds held HERE', () => {
		expect(run().boxes.find((b) => b.kind === 'approval')!.held).toEqual(['4.42']);
	});
	it('a pin box that is not blocked is left as it was', () => {
		const quiet: Box[] = [{ kind: 'pin', state: 'passing', held: ['x'] }];
		expect(run({ boxes: quiet }).boxes[0].held).toEqual(['x']);
	});
	it('pinned: the Held-here node lists the pin box (3), never the gate list, so it cannot send you to approve', () => {
		expect(run().heldBuildsOverride).toEqual(['4.42', '4.43', '4.44']);
	});
	it('not pinned: the node lists the builds held here', () => {
		expect(run({ pinnedTo: null }).heldBuildsOverride).toEqual(['4.42']);
	});
	it('Clear pin is disabled only when another manager owns wantedVersion', () => {
		const mf = (manager: string) => [{ manager, fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }];
		const other = { ...pinned, metadata: { ...pinned.metadata, managedFields: mf('argocd') } };
		expect(run({ rollout: other as never }).clearPinDisabled).toBe(true);
		expect(run().clearPinDisabled).toBe(false);
	});
});
