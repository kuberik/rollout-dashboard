import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import EnvStateBar from './EnvStateBar.svelte';

/** The tile's lead mark is the ring when every failed place's checks are OK again. */
describe('EnvStateBar lead mark', () => {
	const tile = (markRecovered?: boolean) => ({ mark: 'failed' as const, markRecovered, lead: { text: '1 failed', ink: 'muted' as const }, parts: [], calm: false, label: 'x', failing: 1, waiting: 0, moving: 0, rest: 3 });
	const chip = (markRecovered?: boolean) => render(EnvStateBar, { tile: tile(markRecovered) }).container.querySelector('.et-mk span.rounded-full')!.className;
	it('recovered = ring, otherwise the solid disc', () => {
		expect(chip(true)).toContain('ring-[1.5px]');
		expect(chip(true)).not.toContain('bg-danger-solid');
		expect(chip(undefined)).toContain('bg-danger-solid');
	});
});
