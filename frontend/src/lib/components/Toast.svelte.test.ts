import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import Toast from './Toast.svelte';

// jsdom has no layout, so this pins the CLASS CONTRACT the phone position
// relies on; the measured rect (top 4, inside the 52px app bar, never over
// the h1 or the Check row after Retry) is checked by the review scripts
// (review/qa7–8 toast*.mjs). DESIGN-LANGUAGE §3.13.
describe('Toast position', () => {
	const root = (props: Record<string, unknown>) =>
		render(Toast, { open: true, message: 'Deployment retry initiated', ...props }).container.querySelector(
			'[role="status"], [role="alert"]'
		) as HTMLElement;

	it('phone: docks over the app bar, 4px below the safe area, never at the bottom', () => {
		const cls = root({ tone: 'success' }).className;
		expect(cls).toContain('top-[calc(env(safe-area-inset-top,0px)+4px)]');
		expect(cls).not.toMatch(/(^|\s)bottom-\[calc\(var\(--tabbar-h/);
		expect(cls).not.toMatch(/(^|\s)-top-|top-\[-/);
	});

	it('sm and up: bottom-right, 380px', () => {
		const cls = root({ tone: 'success' }).className;
		expect(cls).toContain('sm:top-auto');
		expect(cls).toContain('sm:bottom-4');
		expect(cls).toContain('sm:w-[380px]');
	});

	it('a confirmation is one line on a phone; a danger toast may wrap', () => {
		const ok = root({ tone: 'success' }).querySelector('.t-body') as HTMLElement;
		expect(ok.className).toContain('max-sm:truncate');
		expect(ok.getAttribute('title')).toBe('Deployment retry initiated');
		const bad = root({ tone: 'danger', message: 'Retry failed: the rollout was deleted' }).querySelector('.t-body') as HTMLElement;
		expect(bad.className).not.toContain('truncate');
	});
});
