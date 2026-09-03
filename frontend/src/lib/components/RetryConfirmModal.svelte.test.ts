import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import RetryConfirmModal from './RetryConfirmModal.svelte';
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
