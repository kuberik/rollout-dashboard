import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import ApprovalLayer from './ApprovalLayer.svelte';
import { approvalUi, askApprove, confirmApprove, pauseDone, resumeDone, undoApprove, UNDO_MS } from './approvals.svelte';
import { rollouts, approvalTarget, revokeApproval } from './data';

const raf = () => new Promise((r) => requestAnimationFrame(() => r(0)));
let lastTarget: ReturnType<typeof approvalTarget> = null;

if (!Element.prototype.animate) {
	Element.prototype.animate = function () {
		return { cancel() {}, finish() {}, onfinish: null, finished: Promise.resolve() } as unknown as Animation;
	};
}

/** a grant is module state: put the fixture row back after every test */
afterEach(() => { if (lastTarget) revokeApproval(lastTarget); lastTarget = null; });

describe('after Approve, focus goes to the toast Undo, never BODY', () => {
	beforeEach(() => { approvalUi.ask = null; approvalUi.done = null; });
	it('the trigger is unmounted by the grant and focus still lands on Undo', async () => {
		render(ApprovalLayer);
		const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
		const r = rollouts('incident').rows.find((x) => x.state === 'awaiting-approval' && x.needsYou)!;
		lastTarget = approvalTarget(r, 'incident')!;
		askApprove(lastTarget, { currentTarget: trigger } as unknown as Event);
		await tick();
		confirmApprove((async () => new Response('{}')) as unknown as typeof fetch);
		trigger.remove(); // the row moved on every page
		await tick();
		await new Promise((res) => setTimeout(res, 100));
		expect(document.activeElement).toBe(document.querySelector('[data-action="approve-undo"]'));
		expect(document.activeElement).not.toBe(document.body);
	});
});

describe('the toast auto-dismiss waits for the person and never drops focus to BODY', () => {
	beforeEach(() => { approvalUi.ask = null; approvalUi.done = null; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
	afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
	const open = async () => {
		const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
		const r = rollouts('incident').rows.find((x) => x.state === 'awaiting-approval' && x.needsYou)!;
		lastTarget = approvalTarget(r, 'incident')!;
		askApprove(lastTarget, { currentTarget: trigger } as unknown as Event);
		await tick();
		confirmApprove((async () => new Response('{}')) as unknown as typeof fetch);
		return trigger;
	};
	it('hovering or focusing the toast pauses the 8 s timer; leaving restarts it', async () => {
		render(ApprovalLayer);
		await open();
		await tick(); await raf(); await raf();
		(document.activeElement as HTMLElement)?.blur(); // focus has left the toast: only the pointer holds
		pauseDone();
		vi.advanceTimersByTime(UNDO_MS * 3);
		expect(approvalUi.done).not.toBeNull();
		resumeDone();
		vi.advanceTimersByTime(UNDO_MS + 1);
		expect(approvalUi.done).toBeNull();
	});
	it('after auto-dismiss with the row gone, focus lands on the main heading, not BODY', async () => {
		render(ApprovalLayer);
		const main = document.createElement('main'); main.innerHTML = '<h1>Apps</h1>'; document.body.append(main);
		const trigger = await open();
		await tick(); await raf(); await raf();
		trigger.remove();
		expect(document.activeElement).toBe(document.querySelector('[data-action="approve-undo"]')); // focus on the toast holds the timer
		vi.advanceTimersByTime(UNDO_MS * 2);
		expect(approvalUi.done).not.toBeNull();
		(document.activeElement as HTMLElement).blur(); // focus leaves: the 8 s run
		vi.advanceTimersByTime(UNDO_MS + 1);
		await tick(); await tick(); await raf();
		expect(document.activeElement).toBe(main.querySelector('h1'));
	});
	it('after dismiss with the row still mounted, focus returns to the row trigger', async () => {
		render(ApprovalLayer);
		const trigger = await open();
		await tick(); await raf(); await raf();
		(document.activeElement as HTMLElement)?.blur();
		vi.advanceTimersByTime(UNDO_MS + 1);
		await tick(); await tick(); await raf();
		expect(document.activeElement).toBe(trigger);
	});
	it("the toast's own x (any control inside it) hands focus off too, never BODY", async () => {
		render(ApprovalLayer);
		const main = document.createElement('main'); main.innerHTML = '<h1>Apps</h1>'; document.body.append(main);
		const trigger = await open();
		await tick(); await raf(); await raf();
		trigger.remove();
		const x = document.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!;
		x.focus(); x.click();
		await tick(); await raf();
		expect(document.activeElement).toBe(main.querySelector('h1'));
	});
	it('Escape dismisses the toast with the same hand-off', async () => {
		render(ApprovalLayer);
		const main = document.createElement('main'); main.innerHTML = '<h1>Apps</h1>'; document.body.append(main);
		const trigger = await open();
		await tick(); await raf(); await raf();
		trigger.remove();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await tick();
		expect(approvalUi.done).toBeNull();
		expect(document.activeElement).toBe(main.querySelector('h1'));
	});
	it('hover and focus are separate holds: the pointer leaving while focus is on Undo does not start the clock', async () => {
		render(ApprovalLayer);
		await open();
		await tick(); await raf(); await raf();
		const undo = document.querySelector<HTMLButtonElement>('[data-action="approve-undo"]')!;
		expect(document.activeElement).toBe(undo);
		undo.dispatchEvent(new Event('pointerover', { bubbles: true }));
		undo.dispatchEvent(new Event('pointerout', { bubbles: true }));
		vi.advanceTimersByTime(UNDO_MS * 2);
		expect(approvalUi.done).not.toBeNull();
	});
	it('Escape already taken by another overlay (defaultPrevented, or a modal dialog open) does not dismiss the toast', async () => {
		render(ApprovalLayer);
		await open();
		await tick();
		const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
		e.preventDefault();
		window.dispatchEvent(e);
		expect(approvalUi.done).not.toBeNull();
		const dlg = document.createElement('div'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); document.body.append(dlg);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(approvalUi.done).not.toBeNull();
	});
	it('a new toast never inherits a held state from the previous one', async () => {
		render(ApprovalLayer);
		await open();
		pauseDone('hover'); pauseDone('focus');
		undoApprove((async () => new Response('{}')) as unknown as typeof fetch);
		await open();
		await tick(); await raf(); await raf();
		(document.activeElement as HTMLElement)?.blur(); // focus leaves; a stale hover hold would keep the clock stopped
		vi.advanceTimersByTime(UNDO_MS + 1);
		expect(approvalUi.done).toBeNull();
	});
});

