import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { UndoOutline } from 'flowbite-svelte-icons';
import Banner from './Banner.svelte';

const rows = [
	{ key: 'a', name: 'cart-smoke-test', mono: true, tag: 'Critical', tone: 'danger' as const, text: 'error rate 4.2% over 1%' },
	{ key: 'b', name: 'a-very-long-check-name-that-has-to-be-cut-off-somewhere-in-the-middle-of-it', mono: true, tag: 'Warning', text: '3 of 40 specs failed' }
];
const mount = (p: object = {}) =>
	render(Banner, { props: { icon: UndoOutline, title: 'Rolled back automatically', severity: 'info', move: { from: '2.4.0', to: '2.3.0' }, line: '`cart-smoke-test` failed', rows, ...p } as never });

describe('Banner (the one shell)', () => {
	test('two text lines: the title, then one sentence with the versions in the code role', () => {
		const { container } = mount();
		expect(container.querySelector('[data-banner-title]')!.textContent).toBe('Rolled back automatically');
		const line = container.querySelector('[data-banner-line]')!;
		/* the drawn move sits inline in the text column, ahead of the sentence */
		expect(container.querySelector('[data-banner-move]')!.textContent).toContain('2.4.0');
		expect(container.querySelector('[data-banner-shape]')!.textContent).toContain('2.3.0');
		expect(line.querySelector('.t-code.text-fg')!.textContent).toBe('cart-smoke-test');
		expect(line.textContent!.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(12);
	});

	test('every severity, info and success included, is a tinted field with its own hue line and no side bar', () => {
		for (const s of ['critical', 'warning', 'held', 'info', 'success']) {
			const el = mount({ severity: s }).container.querySelector('[data-banner]')!;
			expect(el.getAttribute('data-severity')).toBe(s);
			expect(el.className).toContain('bn-f-');
			expect(el.className).toContain('rounded-md');
			expect(el.className).not.toContain('border-l-');
		}
	});

	test('critical speaks as an alert, everything else as a status; `role` overrides', () => {
		expect(mount({ severity: 'critical' }).container.querySelector('[data-banner]')).toHaveAttribute('role', 'alert');
		for (const s of ['warning', 'held', 'info', 'success']) {
			expect(mount({ severity: s }).container.querySelector('[data-banner]')).toHaveAttribute('role', 'status');
		}
		expect(mount({ severity: 'critical', role: 'status' }).container.querySelector('[data-banner]')).toHaveAttribute('role', 'status');
	});

	test('Details holds severity and the failure list; it is in the DOM closed and opens on press', async () => {
		const { container } = mount();
		const panel = container.querySelector('[data-banner-panel]') as HTMLElement;
		const btn = container.querySelector('[data-banner-details]') as HTMLElement;
		expect(panel.hidden).toBe(true);
		expect(panel.textContent).toContain('Critical');
		expect(btn.textContent!.trim()).toBe('Details');
		expect(btn).toHaveAttribute('aria-expanded', 'false');
		expect(btn).toHaveAttribute('aria-controls', panel.id);
		await fireEvent.click(btn);
		expect(panel.hidden).toBe(false);
		expect(btn).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(btn);
		expect(panel.hidden).toBe(true);
	});

	test('no rows and no details body: no Details control, no panel', () => {
		const { container } = mount({ rows: [] });
		expect(container.querySelector('[data-banner-details]')).toBeNull();
		expect(container.querySelector('[data-banner-panel]')).toBeNull();
	});

	test('a long check name truncates behind a native tooltip', () => {
		const { container } = mount();
		const names = [...container.querySelectorAll('.bn-name')] as HTMLElement[];
		expect(names[1].className).toContain('truncate');
		expect(names[1].getAttribute('title')).toContain('a-very-long-check-name');
	});

	test('buttons: primary rightmost, secondary beside it, the rest behind the more menu, bare verbs', async () => {
		const onclick = vi.fn();
		const { container, getByRole } = mount({
			severity: 'critical',
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

	test('a toggle is one chevron at the end of the action column', async () => {
		const onclick = vi.fn();
		const { container } = mount({ toggle: { open: false, onclick, label: 'Show changes' } });
		const t = container.querySelector('.bn-toggle') as HTMLElement;
		expect(t).toHaveAttribute('aria-label', 'Show changes');
		expect(t).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(t);
		expect(onclick).toHaveBeenCalled();
	});

	test('open=false collapses the banner out of the page', async () => {
		const { container, rerender } = mount({ open: true });
		expect(container.querySelector('[data-banner]')).not.toBeNull();
		await rerender({ open: false });
		const collapse = container.querySelector('.bn-collapse');
		expect(collapse === null || collapse.classList.contains('bn-collapse--closing')).toBe(true);
	});
});

describe('ActRow shortLabel', () => {
	test('a short label is drawn beside the full one (CSS picks by container width); aria-label keeps the name', () => {
		const { container } = mount({ severity: 'critical', primary: { label: 'Retry', key: 'retry' }, secondary: { label: 'Open ledger-books', shortLabel: 'Open provider', ariaLabel: 'Open ledger-books', href: '/x', key: 'o' } });
		const a = container.querySelector('[data-action="o"]')!;
		expect(a.getAttribute('aria-label')).toBe('Open ledger-books');
		expect(a.querySelector('.ar-long')!.textContent).toBe('Open ledger-books');
		expect(a.querySelector('.ar-short')!.textContent).toBe('Open provider');
	});
});
