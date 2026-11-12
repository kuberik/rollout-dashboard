import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import BlockedActions from './BlockedActions.svelte';

/**
 * The Gates link must not move when the approve slot collapses (batch4 b4-49). The slot is reserved while the ask loads and
 * disappears for a non-approver; anything that precedes the link in the row shifts it. So nothing may precede it.
 */
function row(slot: 'approve' | 'reserved' | 'none') {
	const { container } = render(BlockedActions, { state: slot, ask: null, gatesHref: '/x/gates' });
	return [...container.childNodes].filter((n) => n.nodeType === 1) as HTMLElement[];
}

describe('BlockedActions order', () => {
	test('the Gates link is the first element in the loading state', () => {
		const els = row('reserved');
		expect(els[0]).toHaveAttribute('data-gates-link');
		expect(els[1]).toHaveAttribute('data-approve-slot');
	});
	test('the Gates link is the first element once a non-approver resolves', () => {
		expect(row('none')[0]).toHaveAttribute('data-gates-link');
	});
	test('Gates sits at the same index (0) in both states, so nothing before it changes', () => {
		const a = row('reserved').findIndex((e) => e.hasAttribute('data-gates-link'));
		const b = row('none').findIndex((e) => e.hasAttribute('data-gates-link'));
		expect(a).toBe(0);
		expect(b).toBe(a);
	});
});
