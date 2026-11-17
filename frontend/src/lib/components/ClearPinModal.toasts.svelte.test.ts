import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ClearPinModal from './ClearPinModal.svelte';
import type { Rollout } from '../../types';
import { toastVisibility, resetToastVisibility } from '$lib/stores/toast-visibility.svelte';
import { failureToasts, resetFailureToasts } from '$lib/stores/failure-toasts.svelte';

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

function devRollout(over: Record<string, unknown> = {}): Rollout {
	return {
		metadata: {
			name: 'hello-world-app',
			namespace: 'hello-world-dev',
			labels: { environment: 'dev' }
		},
		spec: { wantedVersion: 'main-abc123' },
		status: {
			availableReleases: [{ tag: 'main-abc123', version: 'abc1234' }],
			gates: [],
			history: [{ version: { tag: 'main-abc123', version: 'abc1234' }, bakeStatus: 'Succeeded' }]
		},
		...over
	} as unknown as Rollout;
}


/** The Gates tab mounts the dialog with its own toast. A failure is the only record once the dialog closes, so it follows the shared tone rule. */
describe('Clear pin toasts', () => {
	beforeEach(() => { resetToastVisibility(); resetFailureToasts(); });
	afterEach(() => vi.unstubAllGlobals());
	const press = async (status: number) => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(status === 200 ? '{}' : '{"error":"denied"}', { status })));
		render(ClearPinModal, { open: true, rollout: devRollout() });
		await fireEvent.click(screen.getByRole('button', { name: /^Clear pin$/ }));
	};
	test('a failed Clear pin waits to be dismissed, naming the rollout and place', async () => {
		await press(500);
		await waitFor(() => expect(failureToasts.items.length).toBe(1));
		expect(failureToasts.items[0].message).toMatch(/^hello-world-app in dev: /);
		await new Promise((r) => setTimeout(r, 3500));
		expect(failureToasts.items.length).toBe(1);
	}, 15_000);
	test('a successful Clear pin hides by itself', async () => {
		await press(200);
		await waitFor(() => expect(toastVisibility.count).toBe(1));
		await waitFor(() => expect(toastVisibility.count).toBe(0), { timeout: 5000 });
	}, 15_000);
});
