import { describe, it, expect } from 'vitest';
import { doneWords } from './approvals.svelte';
import { stillHeldAfterApproval, type ApprovalTarget } from './data';

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

describe('stillHeldAfterApproval', () => {
	const gates = [
		{ name: 'approval-prod', allowedVersions: ['4.45.0'] },
		{ name: 'dependency-payments-svc', allowedVersions: ['4.44.0'] }
	];
	it('names the dependency provider when its gate still refuses the build', () => {
		expect(stillHeldAfterApproval(gates, '4.45.0', 'payments-svc')).toBe('payments-svc');
	});
	it('names another rule by its display name', () => {
		expect(stillHeldAfterApproval([{ name: 'deploy-window', allowedVersions: [] }], '4.45.0', null, (n) => `rule:${n}`)).toBe('rule:deploy-window');
	});
	it('null when only the approval held it, or the other gate allows it', () => {
		expect(stillHeldAfterApproval([{ name: 'approval-prod', allowedVersions: [] }], '4.45.0', null)).toBeNull();
		expect(stillHeldAfterApproval([{ name: 'dependency-x', allowedVersions: ['4.45.0'] }], '4.45.0', 'x')).toBeNull();
		expect(stillHeldAfterApproval([{ name: 'check', allowedVersions: null }], '4.45.0', null)).toBeNull();
	});
});
