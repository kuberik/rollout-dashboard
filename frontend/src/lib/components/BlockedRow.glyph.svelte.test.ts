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
