import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import ChangeDot from './ChangeDot.svelte';
import { beadOf, type BeadState } from '../view-models/bead';

/** THE BEAD draws the strip's own WaveMark (one dot in the state's tone), never a StatusMark icon (2026-11-13). */
const draw = (state: BeadState) => render(ChangeDot, { props: { bead: beadOf([{ ref: '#1', state }]) } }).container;

describe('ChangeDot bead', () => {
	test.each([
		['failed', 'failed'],
		['held', 'held'],
		['deploying', 'deploying'],
		['checking', 'checking'],
		['approval', 'held'],
		['approval-yours', 'held']
	] as [BeadState, string][])('a %s bead is a WaveMark dot of kind %s', (state, kind) => {
		const c = draw(state);
		expect(c.querySelector('[data-wave-mark]')?.getAttribute('data-kinds')).toBe(kind);
		expect(c.querySelector('svg:not([data-wave-mark])')).toBeNull();
	});

	test('a landed bead draws no mark, only its ref', () => {
		const c = draw('landed');
		expect(c.querySelector('[data-wave-mark]')).toBeNull();
		expect(c.textContent).toContain('#1');
	});
});
