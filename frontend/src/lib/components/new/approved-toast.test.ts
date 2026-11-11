import { describe, it, expect } from 'vitest';
import { doneWords } from './approvals.svelte';
import type { ApprovalTarget } from './data';

const target = (waitsOn: string | null): ApprovalTarget => ({ key: 'k', app: 'checkout-api', build: 'f4a2c19', where: '5 prod regions', count: 5, places: [], href: '/rollouts/c/ns/n', waitsOn });

describe('the Approved toast says what is true', () => {
	it('deploying when the approval was the only hold', () => {
		expect(doneWords(target(null))).toEqual({ title: 'Approved f4a2c19', detail: 'checkout-api is deploying to 5 prod regions' });
	});
	it('approved, waits on the dependency that still holds the build', () => {
		const w = doneWords(target('payments-svc'));
		expect(w.title).toBe('Approved f4a2c19');
		expect(w.detail).toBe('checkout-api waits on payments-svc for 5 prod regions');
		expect(w.detail).not.toMatch(/deploying/);
	});
});
