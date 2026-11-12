import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { apps, inbound } from './data';
import { envPage } from './env/env-page';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';

/* batch4 #1: when the catalogue's newest build runs nowhere, the newest build a healthy lower tier runs is still the promote target. */
describe('hello-world /envs/prod (incident): the catalogue newest e2c9b47 runs nowhere, f68d0ac runs in dev and staging', () => {
	it('is listed in Ready to promote with f68d0ac, and prod Behind is empty', () => {
		const G = envPage('incident', 'prod')!.gangway;
		const r = G.ready.find((x) => x.app === 'hello-world');
		expect(r, 'hello-world in Ready to promote').toBeTruthy();
		expect(G.behind.map((x) => x.app)).not.toContain('hello-world');
		const i = inbound('incident', 'prod').find((x) => x.app === 'hello-world');
		expect(i?.build).toContain('f68d0ac');
		expect(i?.from).toBe('staging');
	});
	it('the /apps tile agrees: Ready to promote, never Behind', () => {
		expect(apps('incident').items.find((a) => a.app === 'hello-world')!.fact).not.toMatch(/^Behind in/);
	});
});

const load = (mutate: (rs: any[]) => void) => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	mutate(d.rollouts);
	installLiveSource({ rollouts: d.rollouts, environments: d.environments, rolloutDependencies: d.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: [], github: { configured: false, connected: false }, me: '', now: new Date('2026-11-09T14:15:00Z') } as never);
};
/* every place of hello-world runs one build, nothing is held, nothing is queued */
const everyPlaceOn = (tag: string) => (rs: any[]) => {
	const h0 = rs.find((r) => r.metadata.namespace === 'hello-world-prod').status.history[0];
	for (const r of rs) { r.status.history = [{ ...h0, version: tag === '' ? h0.version : { tag, version: tag, revision: tag }, bakeStatus: 'Succeeded' }]; r.status.gates = []; r.status.releaseCandidates = []; }
};
const tile = () => apps('incident').items.find((a) => a.app === 'hello-world-app')!;

describe('the /apps tile when no place can take a newer build', () => {
	it('reads "Behind in dev · 5 behind" and /envs/dev lists it under Behind, not Ready to promote', () => {
		load(everyPlaceOn(''));
		try {
			expect(tile().fact).toBe('Behind in dev · 5 behind');
			const G = envPage('incident', 'dev')!.gangway;
			expect(G.behind.map((x) => x.app)).toContain('hello-world-app');
			expect(G.ready.map((x) => x.app)).not.toContain('hello-world-app');
		} finally { installLiveSource(null); }
	});
	it('a custom build (not in the catalogue) prints no count, never "0 behind" or a guessed 1', () => {
		load(everyPlaceOn('hotfix-x'));
		try { expect(tile().fact).toBe('Behind in dev'); } finally { installLiveSource(null); }
	});
});
