import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import RestGlyph from './RestGlyph.svelte';

const old = new Date(Date.now() - 3 * 3600_000).toISOString();

describe('RestGlyph at rest', () => {
	it('on the newest: the green rest dot', () => {
		const { container } = render(RestGlyph, { bakeStatus: 'Succeeded', timestamp: old });
		expect(container.querySelector('.bg-success-solid')).not.toBeNull();
		expect(container.querySelector('[data-mark="behind"]')).toBeNull();
	});
	it('behind: the hollow neutral ring, never green (one behind mark product-wide)', () => {
		const { container } = render(RestGlyph, { bakeStatus: 'Succeeded', timestamp: old, behind: true });
		expect(container.querySelector('[data-mark="behind"]')).not.toBeNull();
		expect(container.querySelector('.bg-success-solid')).toBeNull();
		expect(container.textContent).toContain('behind the newest build');
	});
	it('a state mark still wins over behind', () => {
		const { container } = render(RestGlyph, { bakeStatus: 'Succeeded', timestamp: old, behind: true, state: 'held', stateWord: 'held' });
		expect(container.querySelector('[data-mark="behind"]')).toBeNull();
	});
});
