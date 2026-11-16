import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/svelte';
import SectionHeader from './SectionHeader.svelte';

/** The rollup is the shared dot list: separators are drawn by the list (neutral, the size of the text middle dot), never inherited from a part's ink, and a wrapped line never starts or ends on one. */
describe('SectionHeader rollup', () => {
	const rollup = [{ text: '4 failing', ink: 'danger' as const }, '2 failed', '0 moving', '7 people'];
	it('draws its parts as the facts of a dot list, with no separator of its own', () => {
		const { container } = render(SectionHeader, { title: 'Team', rollup } as never);
		const row = container.querySelector('[data-rollup]')!;
		expect(row.className).toContain('dot-list-row');
		expect(row.className).toContain('flex-wrap');
		expect(row.parentElement?.className).toContain('dot-list');
		expect([...row.children].map((c) => c.textContent)).toEqual(['4 failing', '2 failed', '0 moving', '7 people']);
		expect(container.querySelector('.rp-dot')).toBeNull();
		expect(row.children[0].className).toContain('font-medium');
		expect(row.children[1].className).not.toContain('font-medium');
	});
	it('the list separator is a neutral disc, not currentColor, so a red part keeps a grey dot', () => {
		const css = readFileSync(join(__dirname, '../../styles/language.css'), 'utf8');
		const block = css.slice(css.indexOf('.dot-list .dot-list-row > *,'));
		const rule = block.slice(0, block.indexOf('}'));
		expect(rule).toContain('var(--k-fg-disabled)');
		expect(rule).not.toContain('currentColor');
	});
});
