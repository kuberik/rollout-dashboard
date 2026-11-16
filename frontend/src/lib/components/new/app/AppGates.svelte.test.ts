import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import AppGates from './AppGates.svelte';
import type { HoldRow } from './app-model';

/** The health row's mark and dot: failed place with checks OK again is the ring, one failing now the solid disc. */
const row = (recovered?: boolean): HoldRow => ({ key: 'health', kind: 'health', name: 'Health checks', holding: true, places: ['eu-west'], held: ['a11c808'], sentence: 'x', href: '/x/gates', ...(recovered ? { recovered } : {}) });
const parts = (recovered?: boolean) => {
	const { container } = render(AppGates, { rows: [row(recovered)] });
	return { chip: container.querySelector('span.rounded-full.ring-inset')!.className, dot: container.querySelector('p span.h-1\\.5')!.className };
};

describe('AppGates health row', () => {
	it('recovered: ring mark and ring dot', () => {
		const p = parts(true);
		expect(p.chip).toContain('ring-[1.5px]');
		expect(p.chip).not.toContain('bg-danger-solid');
		expect(p.dot).toContain('st-recovered');
		expect(p.dot).not.toContain('bg-danger-solid');
	});
	it('failing now: the solid disc and dot', () => {
		const p = parts(false);
		expect(p.chip).toContain('bg-danger-solid');
		expect(p.dot).toContain('bg-danger-solid');
	});
});
