import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import SiteMark from './SiteMark.svelte';

/** The site picker draws the strip's own mark: a failed site whose checks recovered is the ring, one failing now the solid disc. */
describe('SiteMark', () => {
	const kinds = (props: Record<string, unknown>) => render(SiteMark, props).container.querySelector('[data-wave-mark]')?.getAttribute('data-kinds');
	it('recovered flag draws the recovered kind; no flag stays failed', () => {
		expect(kinds({ state: 'failed', recovered: true })).toBe('recovered');
		expect(kinds({ state: 'failed' })).toBe('failed');
		expect(kinds({ state: 'done', recovered: true })).toBe('done');
	});
});
