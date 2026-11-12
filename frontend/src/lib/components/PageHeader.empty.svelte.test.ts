import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Host from './PageHeader.emptyhost.test.svelte';

/**
 * A slot whose snippet renders nothing must not leave a flex item behind: an empty item that wraps onto its own line costs
 * a row gap at 390 (4px in the title row, 12px between the header rows). Tailwind's `empty:hidden` removes it, but only if
 * the wrapper is really :empty (no text node from template whitespace).
 */
describe('PageHeader empty slots', () => {
	for (const k of ['identity', 'summary', 'below', 'actions']) {
		it(`${k}: an empty snippet leaves an anchors-only wrapper that is hidden`, () => {
			const el = render(Host, { props: { show: false } }).container.querySelector(`[data-ph-${k}]`)!;
			expect([...el.childNodes].every((n) => n.nodeType === 8 || (n.nodeType === 3 && !n.textContent)), 'only anchor comments: :empty in a browser').toBe(true);
			expect(el.className).toContain('empty:hidden');
		});
		it(`${k}: a rendered snippet has content`, () => {
			const el = render(Host, { props: { show: true } }).container.querySelector(`[data-ph-${k}]`)!;
			expect([...el.childNodes].some((n) => n.nodeType !== 8)).toBe(true);
		});
	}
});
