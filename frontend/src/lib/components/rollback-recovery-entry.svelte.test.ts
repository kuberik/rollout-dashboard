import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import FailurePanel from './FailurePanel.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

// jsdom has neither the Web Animations API nor a working <dialog>.
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

/**
 * Batch4 #8: recovery mode is decided by ONE rule (`recoveryModeReason`) at every
 * entry point. The failure banner's Roll back used to mount ChangeVersionModal
 * directly, so with history[0] Succeeded but a health check Unhealthy (the
 * controller's second recovery trigger) it skipped the consent step.
 */
const rollout = {
	metadata: { name: 'orders-api', namespace: 'orders' },
	spec: {},
	status: {
		history: [
			{ version: { tag: '1.1.0' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus: 'Succeeded' },
			{ version: { tag: '1.0.0' }, timestamp: '2026-11-09T10:00:00Z', bakeStatus: 'Succeeded' }
		]
	}
};
const unhealthy = { metadata: { name: 'error-rate', namespace: 'orders' }, status: { status: 'Unhealthy', message: 'over budget', lastErrorTime: '2026-11-10T10:05:00Z' } };

describe('failure banner Roll back, recovery mode', () => {
	test('Unhealthy check + history[0] Succeeded: the recovery warning opens first', async () => {
		const { container } = render(WithQueryClient, {
			props: {
				component: FailurePanel as never,
				props: {
					rollout, healthChecks: [unhealthy], failedHCList: [{ name: 'error-rate', message: 'over budget' }],
					failedStepTests: [], stalledKruiseRollout: null, canUpdate: true, canModify: true,
					isDashboardManagingWantedVersion: true, onRetry: () => {}, cluster: 'hub'
				} as never
			}
		});
		await fireEvent.click(container.querySelector('#failure-rollback-btn') as HTMLElement);
		await waitFor(() => expect(screen.getByText(/runs in recovery mode/)).toBeInTheDocument());
		expect(screen.getByText(/Health checks are unhealthy/)).toBeInTheDocument();
	});
});
