import { describe, it, expect } from 'vitest';
import { replacedFrom } from './data';

const e = (sha: string, timestamp: string, bakeStatus = 'Succeeded') => ({ version: { revision: sha + '0'.repeat(33) }, timestamp, bakeStatus });

/* "Replaces <build>" on the Slipway facts. After a rollback the controller writes the older version as a NEW history entry, so the last healthy
   entry is the build now running: the line must name the build the rollback displaced, never "7c14e2a replaces 7c14e2a". */
describe('replacedFrom', () => {
	it('rollback: current build == last healthy build -> names the displaced (failed) build', () => {
		const hist = [e('7c14e2a', '2026-01-03'), e('a3f9c21', '2026-01-02', 'Failed'), e('7c14e2a', '2026-01-01')];
		const r = replacedFrom(hist, { build: '7c14e2a', at: '2026-01-01' });
		expect(r?.build).toBe('a3f9c21');
		expect(r?.at).toBe('2026-01-02');
	});
	it('normal deploy: keeps the last healthy build', () => {
		const lh = { build: '7c14e2a', at: '2026-01-01' };
		expect(replacedFrom([e('a3f9c21', '2026-01-02'), e('7c14e2a', '2026-01-01')], lh)).toBe(lh);
	});
	it('nothing different to name -> null', () => {
		expect(replacedFrom([e('7c14e2a', '2026-01-02'), e('7c14e2a', '2026-01-01')], { build: '7c14e2a', at: '2026-01-01' })).toBeNull();
	});
});
