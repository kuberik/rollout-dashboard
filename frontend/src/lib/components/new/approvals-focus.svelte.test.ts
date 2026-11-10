import { describe, it, expect, beforeEach } from 'vitest';
import { approvalUi, askApprove, cancelApprove, closeApprove, refreshAnchor } from './approvals.svelte';
import { rollouts, approvalTarget } from './data';

const target = () => { const r = rollouts('incident').rows.find((x) => x.state === 'awaiting-approval' && x.needsYou)!; return approvalTarget(r, 'incident')!; };
const mk = () => { const b = document.createElement('button'); document.body.append(b); return b; };
const press = (b: HTMLElement) => askApprove(target(), { currentTarget: b } as unknown as Event);

describe('approve confirm focus and anchor', () => {
	beforeEach(() => { approvalUi.ask = null; document.body.innerHTML = ''; });
	it('Cancel / Escape (cancelApprove) returns focus to the Approve trigger, not BODY', () => {
		const b = mk(); press(b);
		cancelApprove();
		expect(approvalUi.ask).toBeNull();
		expect(document.activeElement).toBe(b);
	});
	it('click-away closes without stealing focus', () => {
		const b = mk(); const other = mk(); press(b); other.focus();
		closeApprove();
		expect(document.activeElement).toBe(other);
	});
	it('refreshAnchor re-measures the trigger after <main> scrolls', () => {
		const b = mk(); let top = 100;
		b.getBoundingClientRect = () => ({ top, bottom: top + 30, left: 10, right: 90 } as DOMRect);
		press(b); expect(approvalUi.ask!.anchor!.top).toBe(100);
		top = 40; refreshAnchor();
		expect(approvalUi.ask!.anchor).toEqual({ top: 40, bottom: 70, left: 10, right: 90 });
	});
});
