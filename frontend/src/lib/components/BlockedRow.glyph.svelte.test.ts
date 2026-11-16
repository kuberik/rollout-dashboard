import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import BlockedRow from './BlockedRow.svelte';
import type { RolloutCard } from '$lib/rollout-cards';

/** The state glyph carries hidden text for screen readers: failing while a check fails now, failed once recovered, the kind otherwise. */
const card = { name: 'checkout-worker', ns: 'x', envDisplay: 'prod', theme: null, statusKey: 'failed', checkFailure: null, version: 'a02f1c4', timestamp: new Date().toISOString(), stuck: null, rollout: { metadata: { name: 'checkout-worker', namespace: 'x' }, status: {} } } as unknown as RolloutCard;
const sr = (recovered: boolean, kind: 'failed' | 'stuck' = 'failed') => render(BlockedRow, { card, kind, href: '/x', recovered }).container.querySelector('.sr-only')?.textContent;

describe('BlockedRow glyph', () => {
	it('speaks failing, failed or its kind in hidden text', () => {
		expect(sr(false)).toBe('failing');
		expect(sr(true)).toBe('failed');
		expect(sr(false, 'stuck')).toBe('stuck');
	});
});

describe('BlockedRow glyph mark', () => {
	const chip = (recovered: boolean, kind: 'failed' | 'stuck' = 'failed') => render(BlockedRow, { card, kind, href: '/x', recovered }).container.querySelector('span.rounded-full')!.className;
	it('a recovered failure is the ring, a failing one the solid disc, a recovered flag on another kind changes nothing', () => {
		expect(chip(true)).toContain('ring-[1.5px]');
		expect(chip(true)).not.toContain('bg-danger-solid');
		expect(chip(false)).toContain('bg-danger-solid');
		expect(chip(true, 'stuck')).toBe(chip(false, 'stuck'));
	});
});

describe('BlockedRow palette wrap age', () => {
	it('the build and the age are one no-break fact, so the age never wraps alone', () => {
		const c = { ...card, version: 'a02f1c4' } as unknown as RolloutCard;
		const { container } = render(BlockedRow, { card: c, kind: 'failed', href: '/x', size: 'palette', wrap: true });
		const unit = container.querySelector('[data-build-age]')!;
		expect(unit.className).toContain('whitespace-nowrap');
		expect(unit.textContent).toMatch(/a02f1c4 · \S+ ago$/);
	});
});
