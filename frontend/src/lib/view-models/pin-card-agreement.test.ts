import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { behindWhenSettled } from './behind';
import omitempty from '../components/new/fixtures/checkout-edge-prod-omitempty.json';
import { dashboardManagesWantedVersion, newerBuildsShown } from './pin-hold';

const v = (t: string) => ({ tag: t, version: t, revision: t.padEnd(40, '0') });
const rels = ['4.38', '4.39', '4.40', '4.41', '4.42', '4.43', '4.44', '4.45'].map(v);
/* pinned to 4.40; 4.41 failed here; five candidates are newer, four are held by the pin and deployable */
const pinned = {
	metadata: { name: 'checkout-api', namespace: 'prod' },
	spec: { wantedVersion: '4.40' },
	status: {
		currentVersion: '4.40',
		availableReleases: rels,
		releaseCandidates: rels.slice(3),
		history: [
			{ bakeStatus: 'Succeeded', version: v('4.40') },
			{ bakeStatus: 'Failed', version: v('4.41') }
		]
	}
};
const fleet = { environments: [], rollouts: [] };

describe('the Gates tab pin card and the header share one list', () => {
	const header = (r: unknown, settled: boolean) => (settled ? newerBuildsShown(r as never, fleet, true).length : 0);
	it('a build that failed here is not held by the pin: 4, as the header says, not 5', () => {
		const card = newerBuildsShown(pinned as never, fleet, true);
		expect(card.length).toBe(4);
		expect(card.map((h) => h.tag)).not.toContain('4.41');
		expect(header(pinned, true)).toBe(card.length);
	});
	it('before the fleet answers the whole list stays and the header prints no chip', () => {
		expect(newerBuildsShown(pinned as never, fleet, false).length).toBe(5);
		expect(header(pinned, false)).toBe(0);
	});
	it('every candidate failed here: header and card both keep the one list (never "0 newer" over a card of 5)', () => {
		const allFailed = { ...pinned, status: { ...pinned.status, history: [{ bakeStatus: 'Succeeded', version: v('4.40') }, ...rels.slice(3).map((r) => ({ bakeStatus: 'Failed', version: r }))] } };
		const card = newerBuildsShown(allFailed as never, fleet, true);
		expect(header(allFailed, true)).toBe(card.length);
		expect(card.length).toBe(5);
	});
	it('the list a rollout with no releaseCandidates field shows has the length of the settled behind count', () => {
		const f = { environments: [], rollouts: [] };
		expect(newerBuildsShown(omitempty as never, f, true).length).toBe(behindWhenSettled(omitempty as never, f, true));
	});
	it('the sources read the one helper: no second newerCountShown in the Overview or the Gates tab', () => {
		const dir = new URL('../../routes/rollouts/[cluster]/[namespace]/[name]/', import.meta.url);
		for (const u of [new URL('+page.svelte', dir), new URL('gates/+page.svelte', dir)]) {
			const s = readFileSync(u, 'utf8');
			expect(s).toMatch(/newerBuildsShown\(|gatesPinBox\(/);
			expect(s).not.toMatch(/newerCountShown\(/);
		}
	});
});

describe('Clear pin disabled state is one predicate', () => {
	const mf = (manager: string) => [{ manager, fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }];
	it('another manager owns wantedVersion: disabled', () => {
		const r = { ...pinned, metadata: { ...pinned.metadata, managedFields: mf('argocd') } };
		expect(dashboardManagesWantedVersion(r as never)).toBe(false);
	});
	it('the dashboard owns it, or no one: enabled', () => {
		expect(dashboardManagesWantedVersion({ ...pinned, metadata: { ...pinned.metadata, managedFields: mf('rollout-dashboard') } } as never)).toBe(true);
		expect(dashboardManagesWantedVersion(pinned as never)).toBe(true);
	});
	it('the Overview, the Gates tab and the dialog all read it; none keeps its own copy', () => {
		const dir = new URL('../../routes/rollouts/[cluster]/[namespace]/[name]/', import.meta.url);
		const srcs = [new URL('+page.svelte', dir), new URL('gates/+page.svelte', dir), new URL('../../../../../lib/components/ClearPinModal.svelte', dir)].map((u) => readFileSync(u, 'utf8'));
		for (const s of srcs) {
			expect(s).toMatch(/dashboardManagesWantedVersion|gatesPinBox/);
			expect(s).not.toMatch(/isFieldManagedByOtherManager\(/);
		}
	});
});
