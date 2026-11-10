import { describe, expect, it } from 'vitest';
import { behindOfRollout, behindOfStatus, behindWhenSettled } from './behind';
import { currentRowChip } from './history-current-chip';
import { newerReleaseCountLive } from './failed-builds';
import r from '../components/new/fixtures/checkout-edge-prod-omitempty.json';

/* checkout-edge-prod (mock): 25 availableReleases, NO releaseCandidates field (omitempty), the 3rd history entry (62d1c05) failed its bake and
   sits among the newer builds. The header (behindOfStatus), History (behindOfRollout) and the rank (newerReleaseCountLive) must print ONE number. */
describe('one behind rule when releaseCandidates is absent', () => {
	const f = { environments: [], rollouts: [] };
	it('header == History == rank', () => {
		const header = behindOfStatus(r as never, f);
		expect(behindOfRollout(r as never, null, f)).toBe(header);
		expect(newerReleaseCountLive(r as never, f)).toBe(header);
	});
	it('the failed build is subtracted from the availableReleases slice the controller count covers', () => {
		const raw = (r as { status: { availableReleases: unknown[] } }).status.availableReleases;
		expect(newerReleaseCountLive(r as never, f)).toBe(raw.length - 1 - raw.findIndex((a) => (a as { tag: string }).tag === 'd09e6f4') - 1);
	});
	it('no count until the fleet has answered: null, never a number later corrected', () => {
		expect(behindWhenSettled(r as never, undefined, false)).toBeNull();
		expect(behindWhenSettled(r as never, f, true)).toBe(behindOfStatus(r as never, f));
		expect(currentRowChip('Succeeded', null)).toBeNull();
		expect(currentRowChip('Succeeded', 18)).not.toBeNull();
		expect(currentRowChip('Failed', null)).not.toBeNull();
	});
});
