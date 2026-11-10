import { describe, it, expect } from 'vitest';
import { envForRollout } from './pocket-data';
import { arrivalRows } from '../roster/roster-data';

/* the live shape (QA2 #2): hello-world-manifests has NO environment name (env "" and label ""), its prod rollout is hello-world-prod/hello-world-manifests */
const env = (tier: string, href: string, name = '') => ({ env: name, label: name, tier, isProdRegion: tier === 'prod', href });
const manifests = [env('dev', '/rollouts/dev/hello-world-dev/hello-world-manifests'), env('staging', '/rollouts/dev/hello-world-staging/hello-world-manifests'), env('prod', '/rollouts/dev/hello-world-prod/hello-world-manifests')];
describe('envForRollout', () => {
	it('finds the place of an app whose environments carry no name, by the rollout the place links to', () => {
		expect(envForRollout(manifests, 'hello-world-prod', 'hello-world-manifests')?.tier).toBe('prod');
		expect(envForRollout(manifests, 'hello-world-dev', 'hello-world-manifests')?.tier).toBe('dev');
	});
	it('a rollout that is none of the places matches nothing (not the first nameless place)', () => {
		expect(envForRollout(manifests, 'other-prod', 'hello-world-manifests')).toBeNull();
	});
	it('named environments still match by namespace suffix when the href cannot say', () => {
		const named = [env('prod', '/x', 'prod')];
		expect(envForRollout(named, 'hello-multi-prod', 'hello-multi-app')?.tier).toBe('prod');
	});
});
describe('arrivalRows keeps an app whose place has no name', () => {
	it('lists it, placed "production" by its empty label', () => {
		const e = { app: 'hello-world-manifests', label: '', tier: 'prod', isProdRegion: true, state: 'healthy', version: 'a6f160c', arrivedAt: '2026-11-09T17:10:01Z', heldSince: null, myChanges: [] } as never;
		const rows = arrivalRows([{ app: 'hello-world-manifests', env: '', where: '', at: '2026-11-09T17:10:01Z', kind: 'prod', ref: 'a6f160c' }], [{ app: 'hello-world-manifests', envs: [e] }]);
		expect(rows.map((r) => r.app)).toEqual(['hello-world-manifests']);
	});
});
