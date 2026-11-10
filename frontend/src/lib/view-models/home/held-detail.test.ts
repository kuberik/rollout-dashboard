import { describe, expect, it } from 'vitest';
import type { Rollout } from '../../../types';
import {
	blockingStory,
	contractHoldClause,
	holdCausePhrase,
	promotionHoldBreakdown,
	type ContractHolds
} from '../blocking-story';
import { ShaSet } from '../pr-pipeline';

/**
 * The held-detail words Home reads off the shared modules: contract holds
 * (blocking-story `contractHolds`), hold-cause phrases, and `ShaSet`'s short
 * vs full commit id rule. On design/rollout these paths are the product's own
 * (not opt-in), so only the words are pinned here.
 */
const rollout = (
	gates: { name: string; passing?: boolean; allowedVersions?: string[] }[]
): Rollout =>
	({
		metadata: { name: 'api', namespace: 'ns' },
		status: {
			history: [{ version: { tag: 'v1', version: 'v1' }, timestamp: '2026-10-24T10:00:00Z' }],
			availableReleases: [{ tag: 'v1' }, { tag: 'v2' }],
			releaseCandidates: [{ tag: 'v2' }],
			gates
		}
	}) as unknown as Rollout;

describe('contract holds (blockingStory / promotionHoldBreakdown)', () => {
	it('words a contract hold', () => {
		expect(contractHoldClause({ provider: 'payments-svc', required: '^1.2', has: '1.1.0' })).toBe(
			'Needs payments-svc ^1.2 · has 1.1.0'
		);
		expect(contractHoldClause({ provider: 'payments-svc' })).toBe('Needs payments-svc');
	});

	it('a candidate held only by a contract makes the story blocked, but only when holds are passed', () => {
		const r = rollout([]);
		const holds: ContractHolds = new Map([
			['v2', [{ provider: 'payments-svc', required: '^1.2' }]]
		]);
		expect(blockingStory(r).blocked).toBe(false);
		const story = blockingStory(r, undefined, { contractHolds: holds });
		expect(story.blocked).toBe(true);
		expect(story.upstream.map((g) => g.subject)).toEqual(['payments-svc']);
		expect(holdCausePhrase(story, { place: 'prod' })).toBe('prod is waiting for payments-svc ^1.2');
		const b = promotionHoldBreakdown(r, undefined, { contractHolds: holds });
		expect([b.anyHeld, b.allHeld, b.deployable]).toEqual([true, true, []]);
		expect(holdCausePhrase(b, { place: 'prod' })).toBe('prod is waiting for payments-svc ^1.2');
	});

	it('words an order hold and an unattributable rule', () => {
		const r = rollout([{ name: 'env-gate', passing: false }]);
		const b = promotionHoldBreakdown(r);
		expect(b.allHeld).toBe(true);
		expect(holdCausePhrase(b, { place: 'dev' })).toBe('dev is waiting on promotion order');
		const story = blockingStory(r);
		expect(story.blocked).toBe(true);
		// a bare non-passing gate nobody owns classifies as unknown or check; the phrase never invents a cause
		expect(holdCausePhrase(story, { place: 'dev' })).toMatch(
			/^dev is (waiting on a rule this dashboard cannot attribute|held)$/
		);
		const unknown = { ...story, person: [], unknown: [story.gates[0]], upstream: [] };
		expect(holdCausePhrase(unknown, { place: 'dev' })).toBe(
			'dev is waiting on a rule this dashboard cannot attribute'
		);
		expect(holdCausePhrase(blockingStory(rollout([])))).toBeNull();
	});

	it('every story now carries its per-candidate breakdown', () => {
		expect(blockingStory(rollout([])).candidates?.map((c) => c.build)).toEqual(['v2']);
	});
});

describe('ShaSet', () => {
	it('matches a short and a full commit id of the same commit, never a too-short prefix', () => {
		const s = new ShaSet(['a11c505f00d']);
		expect(s.has('a11c505')).toBe(true);
		expect(s.has('A11C505F00D1234')).toBe(true);
		expect(s.has('a11c5')).toBe(false);
		expect(s.has('b11c505')).toBe(false);
	});
});
