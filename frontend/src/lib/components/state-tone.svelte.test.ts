import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { waveMark } from '$lib/view-models/wave-mark';
import { beadOf } from '$lib/view-models/bead';
import SiteMark from './SiteMark.svelte';
import WaveMark from './WaveMark.svelte';
import EnvRow, { type EnvCell } from './EnvRow.svelte';

describe('every strip box draws WaveMark and no icon', () => {
	const marks = (c: HTMLElement) => [...c.querySelectorAll('[data-env-box] svg')];
	const cellOf = (extra: Partial<EnvCell>): EnvCell => ({ key: 'prod', label: 'prod', ...extra });
	it.each([
		['mark', cellOf({ mark: { state: 'held' }, word: 'Held' })],
		['bead', cellOf({ beads: [beadOf([{ ref: '#1', state: 'deploying' }])] })],
		['sites', cellOf({ sites: [{ key: 'a', name: 'a', wave: null, state: 'checking', word: 'Checking' }] })]
	])('a %s cell', (_n, cell) => {
		const { container } = render(EnvRow, { props: { cells: [cell] } });
		const svgs = marks(container);
		expect(svgs.length).toBeGreaterThan(0);
		for (const s of svgs) expect(s.hasAttribute('data-wave-mark')).toBe(true);
	});
});

describe('the picker row agrees with the strip dot', () => {
	const paint = (c: HTMLElement) => [...c.querySelectorAll('[data-wave-mark] [fill], [data-wave-mark] [stroke]')].map((e) => [e.tagName, e.getAttribute('fill'), e.getAttribute('stroke'), e.getAttribute('fill-opacity')].join('|'));
	it.each(['done', 'checking', 'deploying', 'held', 'approval', 'failed', 'stuck', 'notreached', 'notaffected'] as const)('%s', (state) => {
		const strip = render(WaveMark, { props: { mark: waveMark([{ state }]) } }).container;
		const picker = render(SiteMark, { props: { state } }).container;
		expect(paint(picker)).toEqual(paint(strip));
		expect(picker.querySelector('[data-wave-mark]')?.getAttribute('data-kinds')).toBe(strip.querySelector('[data-wave-mark]')?.getAttribute('data-kinds'));
	});
});
