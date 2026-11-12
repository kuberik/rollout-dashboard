import { describe, it, expect } from 'vitest';
import type { PlaceHold } from '../data';
import { holdRows, holdWord, holdSentences } from './app-model';

/**
 * One cause per hold: the app banner ("Waits on payments-svc") and the Holding card read the same place. A place the model
 * says is held by a rule, with no gate object listing it (a dependency is a RolloutDependency join), has the card row of
 * its own cause, never "Health checks".
 */
const place = (o: Partial<PlaceHold>): PlaceHold => ({ wave: null, env: 'staging', label: 'staging', place: 'staging', tier: 'staging', state: 'held-by-rule', href: '/rollouts/staging/x/x', deployedBuild: '4.43.0-43', holdReason: 'rule', gate: { name: 'payments-svc', sentence: 'Releases when payments-svc ships', label: { kind: 'named', text: 'payments-svc' } }, upstreamFailed: null, heldBuilds: [{ build: '4.44.0-44' }, { build: '4.45.0-45' }] as never, newerShown: [], runs: null, ...o }) as PlaceHold;

describe('holding card and banner name one cause', () => {
	const P = [place({})];
	it('the card row for a rule-held place without a gate object is that place\'s cause', () => {
		const rows = holdRows([], P, null, 'checkout-api');
		expect(rows.map((r) => r.name)).toEqual(['payments-svc']);
		expect(rows[0].places).toEqual(['staging']);
		expect(rows[0].held).toEqual(['4.44.0-44', '4.45.0-45']);
		expect(rows.some((r) => r.name === 'Health checks')).toBe(false);
	});
	it('the header word and the card row agree', () => {
		expect(holdWord(P[0])).toBe('payments-svc');
		expect(holdSentences(P)[0]).toMatch(/payments-svc/);
	});
	it('a place a HOLDING gate already lists gets no second row', () => {
		const gate = { id: 'g', name: 'payments-svc', kind: 'dependency', sentence: '', holding: true, heldPending: false, places: ['staging'], holdsAt: ['staging'], held: ['4.45.0-45'], releasedBy: '' } as never;
		expect(holdRows([gate], P, null, 'checkout-api').length).toBe(1);
	});
	it('a passing gate that merely lists the place does not hide the place\'s own cause', () => {
		const passing = { id: 'w', name: 'Business hours', kind: 'schedule', sentence: '', holding: false, heldPending: false, places: ['staging'], holdsAt: [], held: [], releasedBy: '' } as never;
		expect(holdRows([passing], P, null, 'checkout-api').filter((r) => r.holding).map((r) => r.name)).toEqual(['payments-svc']);
	});
});
