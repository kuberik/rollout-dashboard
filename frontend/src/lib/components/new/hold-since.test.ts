import { it, expect } from 'vitest';
import fs from 'node:fs';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { holdSince, buildInQuestionFacts } from './data';

/* QA round 2 A6: live hub data, prod waits on an approval; newer builds keep arriving. The wait clock starts when the OLDEST still-held build
   reached its gate, so a newer build never resets it. */
it('holdSince is the arrival of the oldest held build, not of the build the approval is named after', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	installLiveSource({ rollouts: d.rollouts, environments: d.environments, rolloutDependencies: d.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: [], github: { configured: false, connected: false }, me: '', now: new Date() } as never);
	try {
		const prod = d.rollouts.find((r: any) => r.metadata.namespace === 'hello-world-prod');
		const row = { app: 'hello-world-app', href: '/rollouts/prod/hello-world-prod/hello-world-app', tier: 'prod' } as never;
		const since = holdSince(row);
		const named = buildInQuestionFacts(row);
		const lower = d.rollouts.filter((r: any) => r.metadata.namespace !== 'hello-world-prod');
		const arrivals = lower.flatMap((r: any) => r.status.history.map((h: any) => h.timestamp)).sort();
		/* d993f4d (held) reached dev/staging at 13:58:21; e7c1b60, the build the approval is named after, arrived hours later */
		expect(named?.build).toBe('e7c1b60');
		expect(since).toBe('2026-11-09T13:58:21Z');
		void prod;
	} finally { installLiveSource(null); }
});

/* QA2 #8: one row, one clock. The approval row's age slot is the hold's clock, the same instant its sentence ("for 5h") prints. */
it('waitClock is the hold clock, and the Rollouts row prints the clock once, in the age slot', async () => {
	const { waitClock } = await import('./data');
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	installLiveSource({ rollouts: d.rollouts, environments: d.environments, rolloutDependencies: d.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: [], github: { configured: false, connected: false }, me: '', now: new Date() } as never);
	try {
		const row = { app: 'hello-world-app', href: '/rollouts/prod/hello-world-prod/hello-world-app', tier: 'prod' } as never;
		expect(waitClock(row)).toBe('2026-11-09T13:58:21Z');
		const { rolloutsPage } = await import('./rollouts-page');
		const rows = rolloutsPage('incident').groups.flatMap((g) => g.rows).filter((x) => x.row.group === 'approval');
		expect(rows.length).toBeGreaterThan(0);
		for (const s of rows) { expect(s.rest).not.toMatch(/^for /); expect(s.age).toMatch(/\d/); }
	} finally { installLiveSource(null); }
});
