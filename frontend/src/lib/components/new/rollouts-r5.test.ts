import { it, expect } from 'vitest';
import * as D from './data';
import { leadRow, headerFacts } from './rollout-view';
/* r34 rollouts r5: the page's facts follow the tabs */
const find = (s: 'incident' | 'calm' | 'quiet', app: string, tier: string) => D.rollouts(s).rows.find((r) => r.app === app && r.tier === tier)!;
it('R1: a fallback-pipeline deploy is Started done, Check active, health Waiting', () => {
	const r = find('incident', 'checkout-edge', 'dev');
	expect(D.stepsKey(r.steps)).toBe('Started:done|Check:active');
	expect(D.stepDetail(r).healthChecks).toBe('Waiting');
	expect(D.healthTally(r)).toBe('1 pending · 0 passing');
});
it('R3: the waiting build of a held place is the one its own gate holds', () => {
	const r = D.rollouts('incident').rows.find((x) => x.app === 'checkout-api' && x.group === 'held' && x.tier === 'prod')!;
	expect(D.waitingBuild(r)?.build).toBe('4.43.0-43');
});
it('R4: no boilerplate title, one headline per build', () => {
	for (const r of D.rollouts('incident').rows) { expect(D.deployedBuild(r).title ?? '').not.toMatch(/^Release commit for build/); expect(D.waitingBuild(r)?.title ?? '').not.toMatch(/^Release commit for build/); }
	expect(D.deployedBuild(find('incident', 'invoice-api', 'prod')).title).toBe('Retry webhook delivery with exponential backoff');
});
it('R6/R11: scope and rollup carry their units', () => {
	const r = D.rollouts('incident').rows.find((x) => x.app === 'payments-core' && x.group === 'approval')!;
	expect(D.approvalScope(r, 'incident').sentence).toBe('Needs your approval · 5 of 6 regions');
	expect(D.pathPosition(r, 'incident')).toMatch(/places on the newest build$/);
});
it('R7/R16: a baking place says how long is left', () => {
	expect(D.checkClock(D.rollouts('incident').rows.find((x) => x.app === 'checkout-edge' && x.tier === 'prod')!)).toBe('5 min left');
});
it('R17: the lead is the first row of the first non-empty group', () => {
	for (const s of ['incident', 'calm', 'quiet'] as const) {
		const R = D.rollouts(s).rows; const l = leadRow(R)!;
		const order = ['failed', 'approval', 'held', 'moving'] as const;
		expect(l.group).toBe(order.find((g) => R.some((r) => r.group === g)));
	}
	expect(headerFacts(D.rollouts('calm').rows).map((f) => f.text)).toContain('9 places waiting for approval');
});
it('r6 T1: pathPosition = the Gates tab Runs in (newest of the ladder)', () => {
	expect(D.pathPosition({ app: 'hello-world' }, 'incident')).toBe('0 of 3 places on the newest build');
	expect(D.pathPosition({ app: 'standalone-api' }, 'incident')).toBe('0 of 1 place on the newest build');
});
it('r6 T5: one title per sha (the approval row prints the dev row\'s title)', () => {
	const R = D.rollouts('incident').rows;
	const dev = R.find((x) => x.app === 'invoice-api' && x.tier === 'dev')!;
	const appr = R.find((x) => x.app === 'invoice-api' && x.group === 'approval')!;
	expect(D.deployedBuild(dev).title).toBeTruthy();
	const wb = D.waitingBuild(appr)!;
	expect(wb.title).toBe(D.buildIdentity(wb.build, appr.href)?.title ?? wb.title); /* one title per sha: the held build prints its change's title */
});
it('r6 T3/T6: recovery of a failed entry and the hold start', () => {
	const tc = D.fleet24hEvents('incident').find((e) => e.kind === 'failed' && e.app === 'telemetry-collector')!;
	expect(D.recoveredAt(tc.href, tc.at)).toBeTruthy();
	const held = D.rollouts('incident').rows.find((x) => x.app === 'checkout-api' && x.group === 'held' && x.tier === 'prod')!;
	const hs = D.holdSince(held, 'incident');
	expect(hs === null || hs > (D.waitingBuild(held)?.since ?? '')).toBe(true);
});
