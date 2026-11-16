import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import ChangeDetail from './ChangeDetail.svelte';
import { changes } from '../data';
import { hueInk } from '$lib/view-models/state-tone';

/** The Summary's "Merge to production … · failing" takes the danger ink of the "1 failing" above it; a recovered "· failed" stays in the row's ink. */
describe('ChangeDetail Summary', () => {
	it('inks "failing" in the production row like the places count', () => {
		const list = (changes('incident') as unknown as { items: { title: string }[] }).items;
		const change = list.find((x) => x.title === 'Improve accessibility of nav menu')!;
		const { container } = render(ChangeDetail, { props: { change, scenario: 'incident' } as never });
		const f = container.querySelector('[data-failing]');
		expect(f?.textContent).toBe('failing');
		for (const cls of hueInk('danger').split(' ')) expect(f?.className).toContain(cls);
	});
});
