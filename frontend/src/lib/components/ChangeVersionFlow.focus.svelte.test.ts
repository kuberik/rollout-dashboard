import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import ChangeVersionFlow from './ChangeVersionFlow.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

if (!Element.prototype.animate) {
	Element.prototype.animate = function () {
		return { cancel() {}, finish() {}, set onfinish(_f: unknown) {}, currentTime: 0, playState: 'finished' } as unknown as Animation;
	};
}
if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () { this.open = true; };
	HTMLDialogElement.prototype.show = function () { this.open = true; };
	HTMLDialogElement.prototype.close = function () { this.open = false; };
}

/** Roll back after a failed build goes warning -> Continue -> picker; closing the picker returns focus to the button that started it. */
const rollout = {
	metadata: { name: 'orders-api', namespace: 'orders' },
	spec: {},
	status: {
		history: [
			{ version: { tag: '1.1.0' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus: 'Failed' },
			{ version: { tag: '1.0.0' }, timestamp: '2026-11-09T10:00:00Z', bakeStatus: 'Succeeded' }
		]
	}
};

describe('Roll back flow returns focus to its trigger', () => {
	test('after the recovery warning and the picker, Cancel puts focus back on the Roll back button', async () => {
		const trigger = document.createElement('button');
		trigger.textContent = 'Roll back';
		document.body.appendChild(trigger);
		trigger.focus();
		render(WithQueryClient, { props: { component: ChangeVersionFlow as never, props: { open: true, rollout, cluster: 'hub', initialSelectedVersion: '1.0.0' } as never } });
		await waitFor(() => expect(screen.getByText(/runs in recovery mode/)).toBeInTheDocument());
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await waitFor(() => expect(screen.getByText(/Recovery mode:/)).toBeInTheDocument());
		(document.activeElement as HTMLElement | null)?.blur();
		const cancel = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find((b) => b.textContent?.trim() === 'Cancel');
		expect(cancel, 'the picker has a Cancel').toBeTruthy();
		await fireEvent.click(cancel!);
		await waitFor(() => expect(document.activeElement).toBe(trigger), { timeout: 2000 });
		trigger.remove();
	});
});
