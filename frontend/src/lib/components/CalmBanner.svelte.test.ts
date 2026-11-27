import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { UndoOutline } from 'flowbite-svelte-icons';
import CalmBanner from './CalmBanner.svelte';

const rows = [
	{ key: 'a', name: 'cart-smoke-test', mono: true, tag: 'Critical', tone: 'danger' as const, text: 'error rate 4.2% over 1%' },
	{ key: 'b', name: 'a-very-long-check-name-that-has-to-be-cut-off-somewhere-in-the-middle-of-it', mono: true, tag: 'Warning', text: '3 of 40 specs failed' }
];
const mount = (p: object = {}) =>
	render(CalmBanner, { props: { icon: UndoOutline, title: 'Rolled back automatically', tone: 'neutral', move: { from: '2.4.0', to: '2.3.0' }, line: '`cart-smoke-test` failed', rows, ...p } as never });

describe('CalmBanner (the Q1L report banner)', () => {
	test('two text lines: the title, then one sentence with the versions in the code role', () => {
		const { container } = mount();
		expect(container.querySelector('.cb-title')!.textContent).toBe('Rolled back automatically');
		const line = container.querySelector('[data-calm-line]')!;
		expect(line.querySelector('[data-calm-move]')!.textContent).toContain('2.4.0');
		expect(line.querySelector('[data-calm-move]')!.textContent).toContain('2.3.0');
		expect(line.querySelector('.t-code.text-fg:not([data-calm-move] *)')!.textContent).toBe('cart-smoke-test');
		expect(line.textContent!.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(12);
	});
	test('a successful rollback has the normal card border, a live failure a danger one; no tinted fill', () => {
		const ok = mount().container.querySelector('[data-calm-banner]')!;
		expect(ok.className).toContain('border-line');
		expect(ok.getAttribute('data-tone')).toBe('neutral');
		expect(ok.className).toContain('bg-surface');
		const bad = mount({ tone: 'danger' }).container.querySelector('[data-calm-banner]')!;
		expect(bad.getAttribute('data-tone')).toBe('danger');
		expect(bad.className).not.toMatch(/field-|border-l-/);
	});
	test('Details holds severity and the failure list; it is in the DOM closed and opens on press', async () => {
		const { container } = mount();
		const panel = container.querySelector('[data-calm-panel]') as HTMLElement;
		const btn = container.querySelector('[data-calm-details]') as HTMLElement;
		expect(panel.hidden).toBe(true);
		expect(panel.textContent).toContain('Critical');
		expect(btn).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(btn);
		expect(panel.hidden).toBe(false);
		expect(btn).toHaveAttribute('aria-expanded', 'true');
	});
	test('a long check name truncates behind a native tooltip', () => {
		const { container } = mount();
		const names = [...container.querySelectorAll('.cb-name')] as HTMLElement[];
		expect(names[1].className).toContain('truncate');
		expect(names[1].getAttribute('title')).toContain('a-very-long-check-name');
	});
	test('buttons: two at most visible, bare verbs, the rest behind the more menu', async () => {
		const onclick = vi.fn();
		const { container, getByRole } = mount({
			tone: 'danger',
			primary: { label: 'Retry', key: 'retry' },
			secondary: { label: 'Open checkout', key: 'open', href: '/x' },
			more: [{ label: 'Roll back anyway…', key: 'anyway', onclick }]
		});
		const visible = [...container.querySelectorAll('[data-act-row] .ar-item')].map((e) => e.textContent!.replace('›', '').trim());
		expect(visible).toEqual(['Open checkout', 'Retry']);
		await fireEvent.click(getByRole('button', { name: 'More actions' }));
		await fireEvent.click(getByRole('menuitem', { name: /Roll back anyway/ }));
		expect(onclick).toHaveBeenCalled();
		for (const l of [...visible, 'Roll back anyway…']) expect(l).not.toMatch(/\d+\.\d+/);
	});
	test('no actions row without actions', () => {
		expect(mount().container.querySelector('[data-act-row]')).toBeNull();
	});
});

describe('ActRow shortLabel', () => {
	test('a short label is drawn beside the full one (CSS picks by container width); aria-label keeps the name', () => {
		const { container } = mount({ tone: 'danger', primary: { label: 'Retry', key: 'retry' }, secondary: { label: 'Open ledger-books', shortLabel: 'Open provider', ariaLabel: 'Open ledger-books', href: '/x', key: 'o' } });
		const a = container.querySelector('[data-action="o"]')!;
		expect(a.getAttribute('aria-label')).toBe('Open ledger-books');
		expect(a.querySelector('.ar-long')!.textContent).toBe('Open ledger-books');
		expect(a.querySelector('.ar-short')!.textContent).toBe('Open provider');
	});
});
