import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Facia from './Facia.svelte';
import { laneOf } from './Footprint.svelte';
import { apps } from './data';

/**
 * The phone's one-line fact under a lead quiet tile folds away when the app is at rest. "At rest" is the lane's state
 * (every place healthy), never the words of the fact line: a fact worded any way still folds, and a fact that says
 * "at rest" over a place that is not healthy does not.
 */
const mount = (fact: string, adverse: boolean) => {
	const m = apps('incident');
	const base = m.items.find((a) => a.app === 'payments-core')!;
	const item = { ...base, group: 'quiet', approval: null, fact, noReleases: undefined } as never;
	const { lane, last } = laneOf(item, m.R.c.m as never, m.R.c.events as never);
	for (const t of Object.values(lane.byTier)) for (const n of t ?? []) (n as { state: string }).state = adverse ? 'failed' : 'newest';
	return render(Facia, { props: { item, lane, approvals: m.R.rows, scenario: 'incident', last, recent: [], lead: true } as never }).container;
};

describe('Facia phone fold for a quiet lead tile', () => {
	it('a healthy app folds its fact line whatever the fact says', () => {
		expect(mount('Everything is calm', false).querySelector('div.sm\\:hidden[data-fp-line2]')).toBeNull();
	});
	it('a fact that says "at rest" over a failing place keeps its line', () => {
		expect(mount('3 environments at rest', true).querySelector('div.sm\\:hidden[data-fp-line2]')).not.toBeNull();
	});
});
