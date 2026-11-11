import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import ApprovalLayer from './ApprovalLayer.svelte';
import { approvalUi, askApprove, confirmApprove } from './approvals.svelte';
import { rollouts, approvalTarget } from './data';

if (!Element.prototype.animate) {
	Element.prototype.animate = function () {
		return { cancel() {}, finish() {}, onfinish: null, finished: Promise.resolve() } as unknown as Animation;
	};
}

describe('after Approve, focus goes to the toast Undo, never BODY', () => {
	beforeEach(() => { approvalUi.ask = null; approvalUi.done = null; });
	it('the trigger is unmounted by the grant and focus still lands on Undo', async () => {
		render(ApprovalLayer);
		const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
		const r = rollouts('incident').rows.find((x) => x.state === 'awaiting-approval' && x.needsYou)!;
		askApprove(approvalTarget(r, 'incident')!, { currentTarget: trigger } as unknown as Event);
		await tick();
		confirmApprove((async () => new Response('{}')) as unknown as typeof fetch);
		trigger.remove(); // the row moved on every page
		await tick();
		await new Promise((res) => setTimeout(res, 100));
		expect(document.activeElement).toBe(document.querySelector('[data-action="approve-undo"]'));
		expect(document.activeElement).not.toBe(document.body);
	});
});
