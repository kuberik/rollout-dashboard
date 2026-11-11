import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import ApprovalLayer from './ApprovalLayer.svelte';
import { approvalUi, askApprove } from './approvals.svelte';
import { rollouts, approvalTarget, revokeApproval } from './data';

if (!Element.prototype.animate) {
	Element.prototype.animate = function () {
		return { cancel() {}, finish() {}, onfinish: null, finished: Promise.resolve() } as unknown as Animation;
	};
}

/* The panel's height is MEASURED, and re-measured when it changes: a later change of the panel's own height (its text wraps differently, a font loads)
   must move the above/below decision, not leave it one measurement stale. */
describe('the approve panel flips above/below from its CURRENT height', () => {
	let height = 120;
	let notify: (() => void) | null = null;
	let target: ReturnType<typeof approvalTarget> = null;
	beforeEach(() => {
		approvalUi.ask = null; approvalUi.done = null; height = 120; notify = null;
		vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { notify = cb; } observe() {} disconnect() {} unobserve() {} });
		vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
	});
	afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); if (target) revokeApproval(target); target = null; document.body.innerHTML = ''; });
	it('a taller panel at the viewport foot moves from below the button to above it', async () => {
		render(ApprovalLayer);
		const trigger = document.createElement('button'); document.body.append(trigger);
		trigger.getBoundingClientRect = () => ({ top: 570, left: 277, right: 404, bottom: 606, width: 127, height: 36, x: 277, y: 570, toJSON() {} }) as DOMRect;
		const r = rollouts('incident').rows.find((x) => x.state === 'awaiting-approval' && x.needsYou)!;
		target = approvalTarget(r, 'incident')!;
		askApprove(target, { currentTarget: trigger } as unknown as Event);
		await tick(); await tick();
		const panel = () => document.querySelector<HTMLElement>('[data-approve-confirm]')!;
		expect(panel().style.top, 'a 120px panel fits below the button').not.toBe('');
		height = 200; // 606 + 8 + 200 > 768: no longer fits
		notify?.();
		await tick();
		expect(panel().style.bottom, 'the 200px panel now sits above the button').not.toBe('');
		expect(panel().style.top).toBe('');
	});
});
