import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/svelte';
import SectionHeader from './SectionHeader.svelte';
import { createRawSnippet } from 'svelte';
import { ArrowRightOutline } from 'flowbite-svelte-icons';

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
	it('a wrapping rollup keeps the title on its first line: the row aligns to the top and each part centres 16px down', () => {
		const { container } = render(SectionHeader, { title: 'Team', rollup } as never);
		const header = container.querySelector('.section-header')!;
		expect(header.classList.contains('section-header-rolled')).toBe(true);
		expect(container.querySelector('h2')!.classList.contains('mt-1')).toBe(true);
		expect(container.querySelector('[data-rollup]')!.parentElement!.classList.contains('mt-1')).toBe(true);
		const css = readFileSync(join(__dirname, '../../styles/language.css'), 'utf8');
		const block = css.slice(css.indexOf('.section-header.section-header-rolled {'));
		expect(block.slice(0, block.indexOf('}'))).toContain('align-items: flex-start');
	});
	it('a header without a rollup stays centred', () => {
		const { container } = render(SectionHeader, { title: 'Team' } as never);
		expect(container.querySelector('.section-header')!.classList.contains('section-header-rolled')).toBe(false);
	});
});

describe('SectionHeader: count, description and rollup together', () => {
	const rollup = [{ text: '4 failing', ink: 'danger' as const }, '2 failed', '12 apps in prod'];
	it('renders title, count, description and rollup in that order, and the rollup wraps whole units only', () => {
		const { container } = render(SectionHeader, { title: 'Builds', count: 9, description: 'newest first', rollup } as never);
		const kids = [...container.querySelector('.section-header')!.children];
		expect(kids.map((k) => k.tagName + ':' + (k.querySelector('[data-rollup]') ? 'rollup' : k.textContent!.trim()))).toEqual(['SPAN:', 'H2:Builds', 'SPAN:9', 'SPAN:newest first', 'DIV:rollup']);
		const row = container.querySelector('[data-rollup]')!;
		expect(row.className).toContain('flex-wrap');
		for (const part of row.children) expect(part.className).toContain('whitespace-nowrap');
		expect(row.parentElement!.className).toContain('min-w-0');
	});
});

describe('SectionHeader: a rolled header shares one centre line', () => {
	const rollup = ['2 failed', '12 apps'];
	const action = createRawSnippet(() => ({ render: () => '<button>Open</button>' }));
	it('the dot drops 13px, the title and the rollup 4px: all three centre 16px down on the first line', () => {
		const { container } = render(SectionHeader, { title: 'Builds', rollup } as never);
		expect(container.querySelector('.section-dot')!.className).toContain('mt-[13px]');
		expect(container.querySelector('h2')!.className).toContain('mt-1');
		expect(container.querySelector('h2')!.className).toContain('whitespace-nowrap');
		expect(container.querySelector('[data-rollup]')!.parentElement!.className).toMatch(/\bmt-1\b/);
	});
	it('an icon drops 8px (16px glyph centres at 16)', () => {
		const { container } = render(SectionHeader, { title: 'Builds', icon: ArrowRightOutline, rollup } as never);
		expect(container.querySelector('svg')!.getAttribute('class')).toContain('mt-2');
		expect(container.querySelector('.section-dot')).toBeNull();
	});
	it('the action is a 32px box, right-aligned by the rollup beside it (no second auto margin)', () => {
		const { container } = render(SectionHeader, { title: 'Builds', rollup, action } as never);
		const act = container.querySelector('button')!.parentElement!;
		expect(act.className).toContain('h-8');
		expect(act.className).not.toContain('ml-auto');
		expect(container.querySelector('[data-rollup]')!.parentElement!.className).toContain('ml-auto');
	});
	it('without a rollup nothing is offset and the action carries the auto margin', () => {
		const { container } = render(SectionHeader, { title: 'Builds', action } as never);
		expect(container.querySelector('.section-dot')!.className).not.toContain('mt-');
		expect(container.querySelector('h2')!.className).not.toContain('mt-1');
		expect(container.querySelector('button')!.parentElement!.className).toContain('ml-auto');
	});
});
