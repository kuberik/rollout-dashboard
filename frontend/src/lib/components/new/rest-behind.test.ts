import { it, expect } from 'vitest';
import fs from 'node:fs';
import { rolloutsPage } from './rollouts-page';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';

/* batch4: a rest place that is behind says so, from the ONE count (behind.ts); it never reads "On the newest" */
const load = (f: string, mutate?: (d: any) => void) => {
	const d = JSON.parse(fs.readFileSync(`src/lib/components/new/fixtures/${f}`, 'utf8'));
	mutate?.(d);
	installLiveSource({ rollouts: d.rollouts, environments: d.environments, rolloutDependencies: d.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: [], github: { configured: false, connected: false }, me: '', now: new Date('2026-11-09T14:15:00Z') } as never);
};
const dump = (o?: { settled?: boolean }) => rolloutsPage('incident', o).rest.map((r) => `${r.app}|${r.href}|${r.sentence}`);

const stagingOlder = (d: any) => {
	/* hello-world after 49707a5: staging healthy on e7c1b60 while two newer builds wait behind a schedule gate */
	const st = d.rollouts.find((r: any) => r.metadata.namespace === 'hello-world-staging');
	const newer = [{ tag: 'main-1794240000-aaaaaaa1', version: 'aaaaaaa', revision: 'aaaaaaa1' }, { tag: 'main-1794240100-bbbbbbb1', version: 'bbbbbbb', revision: 'bbbbbbb1' }];
	/* the catalogue (availableReleases) carries the newer builds too: the ONE behind is the catalogue distance */
	st.status.availableReleases = [...(st.status.availableReleases ?? []), ...newer];
	st.status.releaseCandidates = [{ tag: 'main-1794240000-aaaaaaa1', version: 'aaaaaaa', revision: 'aaaaaaa1' }, { tag: 'main-1794240100-bbbbbbb1', version: 'bbbbbbb', revision: 'bbbbbbb1' }];
};
const byHref = (re: RegExp, o?: { settled?: boolean }) => rolloutsPage('incident', o).rest.find((r) => re.test(r.href));

it('a healthy place on an older build, newer builds held by a gate, reads "N behind" (the ONE count), not "On the newest"', () => {
	load('qa-approval-only-held.json', stagingOlder);
	try { expect(byHref(/staging/)?.sentence).toBe('2 behind'); } finally { installLiveSource(null); }
});
it('a place actually on the newest still reads the up-to-date wording', () => {
	load('qa-approval-only-held.json');
	try { expect(byHref(/hello-world-dev/)?.sentence).toBe('On the newest'); } finally { installLiveSource(null); }
});
it('an unsettled fleet prints no count and claims no currency', () => {
	load('qa-approval-only-held.json', stagingOlder);
	try { expect(byHref(/staging/, { settled: false })?.sentence).toBe('Healthy'); } finally { installLiveSource(null); }
});
it('a rolled-back place still reads "Rolled back" and every other rest row is a count the up-to-date word, or Healthy when the lag is unknown', () => {
	for (const hs of ['incident', 'calm'] as const) {
		for (const r of rolloutsPage(hs).rest) expect(r.sentence).toMatch(/^(Rolled back|On the newest|Healthy|\d+ behind)$/);
	}
});
