import { it, expect } from 'vitest';
import fs from 'node:fs';
import { installLiveSource } from '../../home/sketch/fleet-source.svelte';
import { publishHeldHere, heldKeyOfHref } from '$lib/view-models/held-here.svelte';
import { envPage } from './env-page';

/* Round 2 B5: the /envs/prod held tile prints the builds the hold refuses HERE, not a fixed "1 build". */
it('hello-world-app on /envs/prod: the held tile counts the published held-here builds', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	installLiveSource({ rollouts: d.rollouts, environments: d.environments, rolloutDependencies: d.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: [], github: { configured: false, connected: false }, me: '', now: new Date() } as never);
	try {
		const before = envPage('incident', 'prod')!.gangway.held.find((t) => t.app === 'hello-world-app');
		expect(before?.rolloutHref).toBeTruthy();
		expect(before?.count).toBeNull(); /* pending: never a guessed "1 build" */
		publishHeldHere(heldKeyOfHref(before!.rolloutHref!)!, { count: 3, ids: new Set(['a', 'b', 'c']), waiting: 0, stage: null });
		const after = envPage('incident', 'prod')!.gangway.held.find((t) => t.app === 'hello-world-app');
		expect(after?.rolloutHref).toMatch(/hello-world-prod\/hello-world-app$/);
		expect(after?.count).toBe('3 builds');
	} finally { installLiveSource(null); }
});
