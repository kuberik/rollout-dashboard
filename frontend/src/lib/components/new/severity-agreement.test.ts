/**
 * ONE severity order across surfaces. The headline of a change (spreadOf), the order of its service list (servicesByUrgency), the /environments
 * tile's mark (markOfPlaces), the beads and the lane fold all rank with view-models/severity.ts; this pins that they AGREE for every set of
 * states, so the three disagreements that shipped (checking vs deploying, approval vs deploying, a headline that names one service while the
 * list leads with another) cannot come back.
 */
import { describe, expect, it } from 'vitest';
import { SEVERITY_ORDER, severityRank, mostSevere, beadRank } from '$lib/view-models/severity';
import { beadsFor } from '$lib/view-models/bead';
import { spreadOf, type Svc, type SvcState } from './change/service-spread';
import { servicesByUrgency } from './changes-plumb';
import { markOfPlaces } from './envs-model';

const svc = (app: string, state: SvcState): Svc => ({ app, tier: 'prod', state, next: null, since: null, href: null, done: false });
/** a service state as the place state the tiles and Home read */
const PLACE: Record<SvcState, string> = { failed: 'failed', 'approval-yours': 'awaiting-approval', approval: 'awaiting-approval', held: 'held-by-rule', deploying: 'deploying', checking: 'checking', landed: 'healthy' };
const STATES: SvcState[] = ['failed', 'approval-yours', 'approval', 'held', 'deploying', 'checking', 'landed'];
/** every non-empty subset of the states (2^7 - 1) */
const subsets = STATES.map((_, i) => i).reduce<SvcState[][]>((acc, i) => [...acc, ...acc.map((s) => [...s, STATES[i]])], [[]]).filter((s) => s.length);

describe('the order', () => {
	it('is failed > approval > held > deploying > checking > rolled back > behind > healthy > not reached', () => {
		expect(SEVERITY_ORDER.filter((s) => s !== 'stuck')).toEqual(['failed', 'approval', 'held', 'deploying', 'checking', 'rolled-back', 'behind', 'healthy', 'none']);
	});
	it('puts deploying before checking, and approval before deploying, in every vocabulary', () => {
		for (const [a, b] of [['deploying', 'checking'], ['awaiting-approval', 'deploying'], ['approval-yours', 'deploying'], ['approval', 'checking'], ['held-by-rule', 'deploying'], ['held', 'checking'], ['failed', 'approval']]) {
			expect(severityRank(a), `${a} before ${b}`).toBeLessThan(severityRank(b));
		}
	});
	it('ranks every spelling of one slot the same, and an unknown word last', () => {
		expect(severityRank('awaiting-approval')).toBe(severityRank('approval-yours'));
		expect(severityRank('newest')).toBe(severityRank('landed'));
		expect(severityRank('???')).toBeGreaterThan(severityRank('none'));
	});
});

describe('headline, list order and tile agree', () => {
	it('for every set of service states: the change headline, the first service of the list and the tile mark are the same slot', () => {
		for (const states of subsets) {
			const svcs = states.map((s, i) => svc(`svc-${i}`, s));
			const headline = spreadOf(svcs);
			const list = servicesByUrgency(svcs);
			expect(severityRank(PLACE[list[0].state]), states.join()).toBe(severityRank(PLACE[headline.state === 'checking' && states.every((s) => s === 'landed') ? 'landed' : headline.state]));
			/* the headline names the list's first service whenever one service is strictly worse than the rest */
			const worst = mostSevere(svcs, (s) => PLACE[s.state])!;
			const strict = svcs.filter((s) => severityRank(PLACE[s.state]) === severityRank(PLACE[worst.state])).length === 1;
			if (strict) expect(list[0].app, states.join()).toBe(headline.service);
			const mark = markOfPlaces(svcs.map((s) => ({ state: PLACE[s.state] })));
			const slot = (w: string) => (w === 'newest' ? 'healthy' : w);
			const expected = PLACE[worst.state] === 'awaiting-approval' ? 'approval' : PLACE[worst.state] === 'held-by-rule' ? 'held' : PLACE[worst.state];
			expect(slot(mark), states.join()).toBe(expected === 'healthy' ? 'healthy' : expected);
		}
	});
	it('the three shipped disagreements', () => {
		/* checking + deploying: deploying leads everywhere (it used to be checking on /envs/prod) */
		expect(markOfPlaces([{ state: 'checking' }, { state: 'deploying' }])).toBe('deploying');
		expect(servicesByUrgency([svc('a', 'checking'), svc('b', 'deploying')])[0].app).toBe('b');
		expect(spreadOf([svc('a', 'checking'), svc('b', 'deploying')]).service).toBe('b');
		/* approval + deploying: approval leads, on the tile too (it used to be last there) */
		expect(markOfPlaces([{ state: 'deploying' }, { state: 'awaiting-approval' }])).toBe('approval');
		expect(spreadOf([svc('a', 'deploying'), svc('b', 'approval')]).service).toBe('b');
		/* one /changes row: the headline names the service the list puts first */
		const s = [svc('a', 'deploying'), svc('b', 'approval'), svc('c', 'checking')];
		expect(spreadOf(s).service).toBe(servicesByUrgency(s)[0].app);
	});
	it('the beads lead with the same state', () => {
		for (const states of subsets) {
			const changes = states.map((s, i) => ({ state: s, ref: `#${i}`, href: '' }));
			const beads = beadsFor(changes as never, { team: true });
			const worst = mostSevere(states, (s) => s)!;
			expect(severityRank(beads[0].state), states.join()).toBe(severityRank(worst));
			expect(beadRank(beads[0].state)).toBe(Math.min(...states.map(beadRank)));
		}
	});
});
