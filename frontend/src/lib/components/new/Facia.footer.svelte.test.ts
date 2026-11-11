import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Facia from './Facia.svelte';
import { laneOf } from './Footprint.svelte';
import { apps } from './data';

/**
 * A quiet tile has no footer (nothing is moving, nothing is waiting). The one exception is an app with no
 * releases: the footer is what names the change it last shipped, so the tile is not just a state word.
 */
const mount = (noReleases: { label: string } | undefined) => {
	const m = apps('incident');
	const base = m.items.find((a) => a.app === 'payments-core')!;
	const item = {
		...base,
		group: 'quiet',
		approval: null,
		fact: '3 environments at rest',
		noReleases
	} as never;
	const { lane, last } = laneOf(item, m.R.c.m as never, m.R.c.events as never);
	return render(Facia, {
		props: { item, lane, approvals: m.R.rows, scenario: 'incident', last, recent: [] } as never
	}).container;
};

describe('Facia tile footer on a quiet tile', () => {
	it('with no releases: the footer shows', () => {
		expect(mount({ label: 'No release source' }).querySelector('[data-fp-footer]')).not.toBeNull();
	});
	it('with releases: no footer', () => {
		expect(mount(undefined).querySelector('[data-fp-footer]')).toBeNull();
	});
	it('the tile lead keeps its health word beside "No releases yet"', () => {
		const t = mount({ label: 'No releases yet' }).textContent ?? '';
		expect(t).toMatch(/All healthy\s*·\s*No releases yet/);
	});
});
