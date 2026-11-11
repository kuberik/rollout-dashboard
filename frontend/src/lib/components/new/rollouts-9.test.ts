import { it, expect } from 'vitest';
import * as D from './data';
import { stateWordOf, VIEWER } from './rollout-view';
/* rollouts-9 W1: every gated row prints its state word first; the viewer's own change never replaces it */
for (const s of ['incident', 'calm', 'quiet'] as const) {
	it(`W1 ${s}: every approval / held / moving row has a state word`, () => {
		for (const r of D.rollouts(s).rows.filter((x) => x.group === 'approval' || x.group === 'held' || x.group === 'moving')) {
			const w = stateWordOf(r, s);
			expect(w, `${r.app} ${r.tier}`).toBeTruthy();
			if (r.group === 'approval') expect(w).toMatch(/^(Needs your approval|Waiting for approval( · \d+ regions)?|Checking · .+)$/);
		}
	});
}
it('W1: an approval whose change is the viewer\'s says "Your approval"', () => {
	const own = D.rollouts('incident').rows.filter((r) => r.group === 'approval').filter((r) => D.buildInQuestionFacts(r)?.author === VIEWER || D.deployedBuild(r)?.author === VIEWER);
	expect(own.length).toBeGreaterThan(0);
	for (const r of own) { const w = stateWordOf(r, 'incident'); if (r.needsYou) expect(w).toBe('Waiting for your approval'); else expect(w).toMatch(/^Waiting for approval( · \d+ regions)?$/); }
});
import { approvalFact } from './rollout-view';
it('W4: the approval slot uses the one scope form', () => {
	const r = D.rollouts('incident').rows.find((x) => x.app === 'payments-core' && x.group === 'approval')!;
	expect(approvalFact(r, 'incident')).toBe('Your approval · 5 of 6 regions');
	expect(approvalFact(D.rollouts('incident').rows.find((x) => x.group === 'failed')!, 'incident')).toBeNull();
});
import { tabEnv } from './rollout-view';
it('W1 form (rollouts-12 ruling b): a multi-region approval row\'s chip names the PLACE where the viewer acts, a single-place row its place; the count is the scope (approvalScope), never a chip', () => {
	for (const r of D.rollouts('incident').rows.filter((x) => x.group === 'approval')) {
		const sc = D.approvalScope(r, 'incident');
		const chip = sc.of > 1 ? sc.acts : tabEnv(r);
		expect(chip).toMatch(/^(dev|test|staging|production|prod-.+)$/);
	}
	const ti = D.rollouts('incident').rows.find((x) => x.app === 'telemetry-indexer' && x.group === 'approval')!;
	expect(D.approvalScope(ti, 'incident').of).toBe(1);
});
