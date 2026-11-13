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
	it.each(['done', 'checking', 'deploying', 'held', 'approval', 'approval-yours', 'failed', 'stuck', 'notreached', 'notaffected'] as const)('%s', (state) => {
		const strip = render(WaveMark, { props: { mark: waveMark([{ state }]) } }).container;
		const picker = render(SiteMark, { props: { state } }).container;
		expect(paint(picker)).toEqual(paint(strip));
		expect(picker.querySelector('[data-wave-mark]')?.getAttribute('data-kinds')).toBe(strip.querySelector('[data-wave-mark]')?.getAttribute('data-kinds'));
	});
});

describe('the viewer\'s approval carries a ring and nothing else changes', () => {
	const ringOf = (c: HTMLElement) => c.querySelector('[data-wave-mark] [data-yours]');
	const disc = (c: HTMLElement) => [...c.querySelectorAll('[data-wave-mark] path')].map((e) => e.getAttribute('d') + e.getAttribute('fill'));
	it('approval-yours is the approval orange plus a ring, the same slot, the same disc', () => {
		const other = render(WaveMark, { props: { mark: waveMark([{ state: 'approval' }]) } }).container;
		const yours = render(WaveMark, { props: { mark: waveMark([{ state: 'approval-yours' }]) } }).container;
		expect(ringOf(other)).toBeNull();
		expect(ringOf(yours)).not.toBeNull();
		expect(disc(yours)).toEqual(disc(other));
		expect(yours.querySelector('svg')?.getAttribute('width')).toBe(other.querySelector('svg')?.getAttribute('width'));
	});
	it('only an approval of the viewer\'s gets the ring', () => {
		for (const state of ['held', 'done', 'failed', 'checking'] as const) expect(ringOf(render(WaveMark, { props: { mark: waveMark([{ state }]) } }).container)).toBeNull();
	});
});
