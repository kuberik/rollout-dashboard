import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildChangeRows, standingWords } from './changes';

/**
 * Worst state wins in the standing phrase too. In incident, the viewer's
 * checkout-worker #14 (a02f1c4) failed in staging while dev has not taken it
 * yet: its row reads "failed in staging" (an adverse phrase, so ChangeLine
 * inks it), never "queued for dev" in danger ink (design-rollout, Home at
 * 1440 light).
 */
function json(url: string) {
	const r = respond('GET', url);
	return JSON.parse(r.body ?? 'null');
}

describe('standing phrase on the incident fixture', () => {
	it('#14 reads "failed in staging" and its verdict is failed', () => {
		resetDemoState('incident');
		const list = json('/api/rollouts');
		const changes = json('/api/github/changes?days=30').changes;
		const rows = buildChangeRows(
			changes,
			list.rollouts.items,
			list.environments.items,
			list.rolloutDependencies ?? null,
			new Date()
		);
		const row = rows.find((r) => r.shortSha === 'a02f1c4' || r.sha?.startsWith('a02f1c4'));
		expect(row).toBeTruthy();
		expect(row!.verdictTone).toBe('failed');
		expect(standingWords(row!)).toBe('failed in staging');
	});
});
