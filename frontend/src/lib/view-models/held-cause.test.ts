import { describe, expect, it } from 'vitest';
import { isEnvHeld } from '$lib/rollout-cards';
import { holdCausePredicate, buildPrPipeline } from './pr-pipeline';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';

describe('PrCell.held: absent means "the held-like state stands", never a guess', () => {
	it('a gated cell with no computed held reads held; held:false narrows it', () => {
		expect(isEnvHeld({ state: 'gated' })).toBe(true);
		expect(isEnvHeld({ state: 'gated', held: false })).toBe(false);
		expect(isEnvHeld({ state: 'gated', held: true })).toBe(true);
	});
	it('a non-held-like state is never held, whatever held says', () => {
		expect(isEnvHeld({ state: 'queued' })).toBe(false);
		expect(isEnvHeld({ state: 'queued', held: true })).toBe(false);
	});
});

describe('holdCausePredicate: the shared cause without its subject', () => {
	it('strips "<place> is "', () => {
		const story = {
			blocked: true,
			gates: [],
			person: [{}],
			unknown: [],
			upstream: []
		} as unknown as Parameters<typeof holdCausePredicate>[0];
		expect(holdCausePredicate(story, 'prod')).toBe('waiting on an approval');
	});
	it('is null when nothing holds', () => {
		const story = { blocked: false, gates: [], person: [], unknown: [], upstream: [] } as unknown as Parameters<
			typeof holdCausePredicate
		>[0];
		expect(holdCausePredicate(story, 'prod')).toBeNull();
	});
});

describe('the change page reads the same hold cause as Home', () => {
	it('incident #20: telemetry-indexer held in prod says "waiting on an approval"', () => {
		resetDemoState('incident');
		const json = (u: string) => JSON.parse(respond('GET', u).body ?? 'null');
		const list = json('/api/rollouts');
		const change = json('/api/github/changes?days=30').changes.find((c: { number?: number; repo: string }) =>
			c.repo === 'platform-telemetry' && c.number === 20
		);
		const vm = buildPrPipeline(
			{
				owner: change.owner,
				repo: change.repo,
				number: 20,
				mergedAt: change.mergedAt,
				mergeCommitSha: change.mergeCommitSha,
				containedIn: change.containedIn,
				containedInAll: change.containedInAll
			},
			list.rollouts.items,
			list.environments.items,
			list.rolloutDependencies ?? { items: [] },
			new Date()
		);
		const cell = vm.services.find((s) => s.appName === 'telemetry-indexer')!.cells.find((c) => c.envName === 'prod')!;
		expect(cell.held).toBe(true);
		expect(cell.holdCause).toBe('waiting on an approval');
	});
});
