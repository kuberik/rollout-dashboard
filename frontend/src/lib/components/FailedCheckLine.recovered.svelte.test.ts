import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import FailedCheckLine from './FailedCheckLine.svelte';

/** A recovered check line beside a neutral "recovered" word draws the recovered ring, not the solid "!" disc; a failing line keeps the disc. */
describe('FailedCheckLine: the leading glyph', () => {
	const draw = (recovered: boolean) => render(FailedCheckLine, { props: { check: { name: 'catalog cache hit ratio', message: 'recovered' }, danger: true, ink: true, body: true, recovered } }).container;
	it('recovered: the ring (StatusMark) and no solid disc', () => {
		const c = draw(true);
		expect(c.querySelector('[data-recovered-glyph] span.rounded-full.ring-inset')!.className).toContain('ring-[1.5px]');
		expect(c.querySelector('.check-glyph')).toBeNull();
	});
	it('failing now: the generic solid glyph, no ring', () => {
		const c = draw(false);
		expect(c.querySelector('[data-recovered-glyph]')).toBeNull();
		expect(c.querySelector('.check-glyph')).not.toBeNull();
	});
});
