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
	it('current build aged out of availableReleases (rank unknown): no count, not 0 / "Up to date"', () => {
		const v = (t: string) => ({ tag: t, version: t, revision: t.padEnd(40, '0') });
		for (const cands of [[], undefined]) {
			const ro = { metadata: { name: 'a', namespace: 'n' }, status: { currentVersion: 'old', ...(cands ? { releaseCandidates: cands } : {}), availableReleases: [v('b1'), v('b2')], history: [{ bakeStatus: 'Succeeded', version: v('old') }] } };
			expect(newerReleaseCountLive(ro as never, f)).toBeNull();
			const n = behindWhenSettled(ro as never, f, true);
			expect(n).toBeNull();
			expect(currentRowChip('Succeeded', n)).toBeNull();
		}
	});
	it('the count is the NEWEST n availableReleases (OWN2): a failed OLD build outside the slice is not subtracted', () => {
		const raw = (r as { status: { availableReleases: { tag: string }[] } }).status.availableReleases;
		const cur = raw.findIndex((a) => a.tag === 'd09e6f4');
		const slice = raw.slice(cur + 1);
		/* the failed build 62d1c05 sits in the slice; a count over slice(0, n) would also count older builds that never failed here */
		expect(slice.some((a) => a.tag === '62d1c05')).toBe(true);
		expect(newerReleaseCountLive(r as never, f)).toBe(slice.length - 1);
		const mutated = { ...(r as object), status: { ...(r as { status: object }).status, availableReleases: [{ tag: '62d1c05', version: '62d1c05', revision: '62d1c05'.padEnd(40, '0') }, ...raw.filter((a) => a.tag !== '62d1c05')] } };
		expect(newerReleaseCountLive(mutated as never, f)).toBe(slice.length - 1);
	});
});
