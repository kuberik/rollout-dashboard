import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import RetryConfirmModal from './RetryConfirmModal.svelte';
import RetryConfirmModalHarness from './RetryConfirmModal.harness.svelte';
import { PlaySolid } from 'flowbite-svelte-icons';
import type { DeployIntent } from '$lib/view-models/deploy-risk';

// See the identical note in `ChangeVersionModal.svelte.test.ts` — jsdom has
// neither the Web Animations API nor a working `<dialog>`.
if (!Element.prototype.animate) {
	Element.prototype.animate = function () {
		return {
			cancel() {},
			finish() {},
			set onfinish(_fn: unknown) {},
			currentTime: 0,
			playState: 'finished'
		} as unknown as Animation;
	};
}

if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.show = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
}

function intent(over: Partial<DeployIntent> = {}): DeployIntent {
	return {
		direction: 'forward',
		production: true,
		vouched: false,
		custom: false,
		environment: 'prod',
		knownFailedHere: false,
		...over
	};
}

/**
 * ⭐ NO MODAL IN THIS PRODUCT HAD `role="dialog"`/`aria-modal`. (operator
 * walk, 2026-09-03) See the identical note in `ClearPinModal.svelte.test.ts`
 * — this dialog already pointed `aria-labelledby`/`aria-describedby` at real
 * `id`s, so only the role/aria-modal half of the defect applied here.
 */
describe('the dialog has role="dialog" and aria-modal', () => {
	test('both are present on the open dialog, alongside its existing labelling', () => {
		render(RetryConfirmModal, {
			open: true,
			intent: intent(),
			consequences: ['This retries a build already refused by the gates.'],
			tag: 'abc1234',
			onConfirm: () => {}
		});

		const dialog = document.querySelector('dialog');
		expect(dialog, 'no <dialog> rendered').not.toBeNull();
		expect(dialog?.getAttribute('role')).toBe('dialog');
		expect(dialog?.getAttribute('aria-modal')).toBe('true');
		expect(dialog?.getAttribute('aria-labelledby')).toBe('rcm-title');
		expect(dialog?.getAttribute('aria-describedby')).toBe('rcm-sub');
	});
});

/** One verb, neutral ink: `Retry <build> in <env>?` over a `Retry` button, no danger disc, no danger-tinted confirm, plain copy for the typed version. */
describe('the Retry dialog says one verb in neutral ink', () => {
	const open = () => {
		render(RetryConfirmModal, { open: true, intent: intent({ direction: 'retry' }), consequences: ['Redeploys 1.4.0 to prod.'], tag: '1.4.0', onConfirm: () => {} });
		return document.querySelector('dialog')!;
	};
	test('title and button share the verb; the title names the build and the place', () => {
		const d = open();
		expect(d.querySelector('#rcm-title')!.textContent).toBe('Retry 1.4.0 in prod?');
		const confirm = [...d.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Retry');
		expect(confirm, 'a confirm button that reads exactly Retry').toBeTruthy();
		expect(d.textContent).not.toMatch(/Redeploy to/);
	});
	test('no danger disc and no danger-tinted confirm', () => {
		const d = open();
		expect(d.querySelector('[data-retry-icon]')!.className).not.toMatch(/danger|held/);
		expect(d.querySelector('.btn-danger')).toBeNull();
		expect(d.innerHTML).not.toContain('bg-danger-tint');
	});
	test('the typed prompt says plainly why, without the vouching claim', () => {
		const d = open();
		const label = d.querySelector('label[for="rcm-confirm"]')!.textContent!.replace(/\s+/g, ' ');
		expect(label).toContain('This deploys to prod again, so it asks you to confirm. Type 1.4.0 to confirm');
		expect(d.textContent).not.toMatch(/vouched/);
	});
});

/** One glyph for Retry: the filled play triangle every Retry trigger draws, in the dialog's header disc and on its confirm button. */
describe('the Retry dialog draws the same glyph as its triggers', () => {
	test('header disc and confirm button both carry the play triangle', () => {
		const ref = render(PlaySolid);
		const play = ref.container.querySelector('svg path')!.getAttribute('d');
		ref.unmount();
		render(RetryConfirmModal, { open: true, intent: intent({ direction: 'retry' }), consequences: ['Redeploys 1.4.0 to prod.'], tag: '1.4.0', onConfirm: () => {} });
		const d = document.querySelector('dialog')!;
		const confirm = [...d.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Retry')!;
		const disc = d.querySelector('#rcm-title')!.parentElement!.parentElement!;
		expect(confirm.querySelector('svg path')!.getAttribute('d')).toBe(play);
		expect(disc.querySelector('svg path')!.getAttribute('d')).toBe(play);
	});
});

/** A failed confirm prints inside the dialog as its own callout: icon + tinted panel in the danger role, above the footer. */
describe('a failed Retry prints as the dialog callout', () => {
	test('icon and tinted danger panel, inset above the footer, one sentence', async () => {
		render(RetryConfirmModal, {
			open: true,
			intent: intent({ direction: 'retry', production: false }),
			consequences: [],
			tag: '1.4.0',
			onConfirm: () => Promise.reject(new Error('Failed to retry: denied'))
		});
		const d = document.querySelector('dialog')!;
		await fireEvent.click([...d.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Retry')!);
		await waitFor(() => expect(d.querySelector('[data-dialog-error]')).not.toBeNull());
		const box = d.querySelector('[data-dialog-error]')!;
		expect(box.getAttribute('role')).toBe('alert');
		expect(box.className).toMatch(/bg-danger-tint/);
		expect(box.className).toMatch(/rounded-md/);
		expect(box.querySelector('svg'), 'an icon').not.toBeNull();
		expect(box.querySelector('[data-retry-error]')!.textContent).toBe('Failed to retry: denied');
	});
});

/** The confirm says what is happening while the request runs, and a failure leaves focus inside the dialog. */
describe('Retry in flight and after a failure', () => {
	test('in flight: spinner and "Retrying…"; failed: focus back on the primary, not <body>', async () => {
		let reject: (e: Error) => void = () => {};
		render(RetryConfirmModal, {
			open: true,
			intent: intent({ direction: 'retry', production: false }),
			consequences: [],
			tag: '1.4.0',
			onConfirm: () => new Promise<void>((_, rej) => (reject = rej))
		});
		const d = document.querySelector('dialog')!;
		const primary = () => [...d.querySelectorAll('button')].find((b) => b.className.includes('btn-primary'))!;
		primary().focus();
		await fireEvent.click(primary());
		await waitFor(() => expect(primary().textContent!.trim()).toBe('Retrying…'));
		expect(primary().querySelector('.animate-spin')).not.toBeNull();
		// Cancel keeps working while the request runs
		const cancel = [...d.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Cancel') as HTMLButtonElement;
		expect(cancel.disabled).toBe(false);
		expect(d.getAttribute('aria-busy')).toBe('true');
		expect(document.activeElement).toBe(d);
		reject(new Error('Failed to retry: denied'));
		await waitFor(() => expect(d.querySelector('[data-dialog-error]')).not.toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(primary()));
		expect(primary().textContent!.trim()).toBe('Retry');
	});
});

describe('the close X', () => {
	test('is the first control of the dialog in tab order, ahead of Cancel and the confirm', () => {
		render(RetryConfirmModal, { open: true, intent: intent({ direction: 'retry', production: false }), consequences: [], tag: '1.4.0', onConfirm: async () => {} });
		const d = document.querySelector('dialog')!;
		const buttons = [...d.querySelectorAll('button')];
		expect(buttons[0].getAttribute('aria-label')).toBe('Close');
		expect(buttons.filter((b) => b.getAttribute('aria-label') === 'Close').length).toBe(1);
	});
	test('pressing it closes the dialog', async () => {
		render(RetryConfirmModalHarness, { intent: intent({ direction: 'retry', production: false }) });
		expect(document.querySelector('[data-open]')!.textContent).toBe('true');
		await fireEvent.click(document.querySelector<HTMLButtonElement>('dialog button[aria-label="Close"]')!);
		await waitFor(() => expect(document.querySelector('[data-open]')!.textContent).toBe('false'));
	});
});
