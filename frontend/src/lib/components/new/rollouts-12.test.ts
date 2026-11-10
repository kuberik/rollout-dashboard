import { waitScope } from './change-cards';
import { it, expect } from 'vitest';
import * as D from './data';
import { checkShort, stateWordOf } from './rollout-view';
/* rollouts-12 */
it('W31: a check named "<app>-<check>" is printed without the app on a phone line 2; others keep their whole name', () => {
	expect(checkShort('hello-frontend-app', 'hello-frontend-app-error-rate')).toBe('error-rate');
	expect(checkShort('checkout-worker', 'checkout-worker-prometheus-high-error-rate')).toBe('prometheus-high-error-rate');
	expect(checkShort('invoice-api', 'error-rate')).toBe('error-rate');
	expect(checkShort('invoice-api', 'invoice-api-')).toBe('invoice-api-');
	expect(checkShort('invoice-api', null)).toBeNull();
	for (const r of D.rollouts('incident').rows.filter((x) => x.group === 'failed' && x.failure?.check)) expect(checkShort(r.app, r.failure!.check!)!.startsWith(r.app)).toBe(false);
});
it('ruling (b): the viewer\'s multi-region approval names the place where they act; the count is the scope, said once', () => {
	const r = D.rollouts('incident').rows.find((x) => x.app === 'payments-core' && x.group === 'approval')!;
	const sc = D.approvalScope(r, 'incident');
	expect(sc.acts).toBe('prod-ap-south');
	expect(sc.of).toBe(5);
	expect(stateWordOf(r, 'incident')).toBe('Needs your approval');
	expect(sc.sentence).toBe('Needs your approval · 5 of 6 regions'); /* the row fold's sentence (data truth); the ROW prints the shared regionStates scope below */
	expect(waitScope(D.regionStates('payments-core', 'incident'))).toMatch(/^\d+ (of \d+ )?regions$/);
});
it('W33: an opened failing lead has no state word of its own in the slot (the row shows its check name instead)', () => {
	const f = D.rollouts('incident').rows.find((x) => x.group === 'failed' && x.failure?.check)!;
	expect(stateWordOf(f, 'incident', true, true)).toBeNull();
});
it('Slipway approval facts: Place = the environment and Scope = the shared region count for a multi-region approval', () => {
	const r = D.rollouts('incident').rows.find((x) => x.app === 'payments-core' && x.group === 'approval')!;
	const sc = D.approvalScope(r, 'incident');
	expect(sc.scope).toBe('5 of 6 regions');
	expect(sc.place).toBe('production');
	expect(sc.n).toBe(5);
	const ti = D.rollouts('incident').rows.find((x) => x.app === 'telemetry-indexer' && x.group === 'approval')!;
	expect(D.approvalScope(ti, 'incident').scope).toBeNull();
	expect(D.approvalScope(ti, 'incident').place).toBe(D.approvalScope(ti, 'incident').acts);
});
