import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import StarToggle from './StarToggle.svelte';
import { STARS_KEY, isStarred, reloadStars, toggleStar } from '$lib/stores/stars.svelte';

beforeEach(() => {
	localStorage.clear();
	reloadStars();
});

describe('StarToggle', () => {
	it('is a toggle button named for the app, not pressed by default', () => {
		const { getByRole } = render(StarToggle, { app: 'orders-api' });
		const btn = getByRole('button', { name: 'Star orders-api' });
		expect(btn).toHaveAttribute('type', 'button');
		expect(btn).toHaveAttribute('aria-pressed', 'false');
		expect(btn).toHaveAttribute('title', 'Star orders-api');
		expect(btn.querySelector('path')).toHaveAttribute('fill', 'none');
		expect(btn).toHaveClass('text-fg-subtle');
	});

	it('a click stars the app, persists it, fills the star; a second click unstars', async () => {
		const { getByRole } = render(StarToggle, { app: 'orders-api' });
		const btn = getByRole('button', { name: 'Star orders-api' });
		await fireEvent.click(btn);
		expect(isStarred('orders-api')).toBe(true);
		expect(JSON.parse(localStorage.getItem(STARS_KEY)!)).toEqual(['orders-api']);
		expect(btn).toHaveAttribute('aria-pressed', 'true');
		expect(btn).toHaveAttribute('title', 'Unstar orders-api');
		// the accessible name stays constant; aria-pressed carries the state
		expect(btn).toHaveAccessibleName('Star orders-api');
		expect(btn.querySelector('path')).toHaveAttribute('fill', 'currentColor');
		// the toggle rule: selected = the product's ink (--k-inverse), never a
		// state hue (amber is STUCK's and nothing else's)
		expect(btn).toHaveClass('text-inverse');
		expect(btn.className).not.toMatch(/warning|amber|yellow/);
		expect(btn.querySelector('path')).toHaveAttribute('stroke', 'currentColor');
		await fireEvent.click(btn);
		expect(isStarred('orders-api')).toBe(false);
		expect(btn).toHaveAttribute('aria-pressed', 'false');
	});

	it('follows the store: a star set elsewhere (another toggle, another tab) shows here', () => {
		const { getByRole } = render(StarToggle, { app: 'billing-api' });
		toggleStar('billing-api', true);
		flushSync();
		expect(getByRole('button')).toHaveAttribute('aria-pressed', 'true');
	});

	it('carries the hit-slop idiom and no outer margin', () => {
		const { getByRole } = render(StarToggle, { app: 'a', class: 'self-center' });
		const cls = getByRole('button').className;
		expect(cls).toContain('hit-32');
		expect(cls).toContain('self-center');
		expect(cls).not.toMatch(/(^|\s)-?m[trblxy]?-/);
	});
});
