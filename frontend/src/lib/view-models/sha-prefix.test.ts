import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildChangeRows } from './changes';

/**
 * A release's revision may be the full 40-char sha while a change names its
 * short sha (git's own prefix rule). No deployed change reads "no release"
 * because the two spellings differ.
 */
describe('a deployed change is never "no release" over sha length', () => {
	it.each(['calm', 'incident', 'wide'] as const)('%s', (scenario) => {
		resetDemoState(scenario);
		const json = (u: string) => JSON.parse(respond('GET', u).body ?? 'null');
		const list = json('/api/rollouts');
		const changes = json('/api/github/changes?days=30').changes as { mergeCommitSha: string }[];
		const deployed = new Set<string>();
		for (const r of list.rollouts.items)
			for (const h of r.status?.history ?? []) if (h.version?.revision) deployed.add(String(h.version.revision).slice(0, 7));
		const rows = buildChangeRows(
			changes.filter((c) => deployed.has(c.mergeCommitSha.slice(0, 7))) as never,
			list.rollouts.items,
			list.environments.items,
			list.rolloutDependencies ?? null,
			new Date()
		);
		expect(rows.length).toBeGreaterThan(10);
		expect(rows.filter((r) => r.noRelease).map((r) => `${r.repo}@${r.shortSha}`)).toEqual([]);
	});
});
