import { describe, test, expect, vi } from 'vitest';

// a pointer device: the banner draws its own tooltip
vi.mock('$lib/can-hover.svelte', () => ({ canHover: { current: true } }));
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import FailurePanel from './FailurePanel.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import { WANTED_VERSION_OWNED_REASON } from '$lib/view-models/pin-hold';

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
const draw = (managed: boolean) =>
	render(WithQueryClient, {
		props: {
			component: FailurePanel as never,
			props: {
				rollout, healthChecks: [], failedHCList: [], failedStepTests: [], stalledKruiseRollout: null, canUpdate: true, canModify: true,
				isDashboardManagingWantedVersion: managed, onRetry: () => {}, cluster: 'hub'
			} as never
		}
	});

describe('the owned Roll back with a hover device', () => {
	test('the custom tooltip carries the reason, so there is no native title beside it; aria-describedby stays', () => {
		const { container } = draw(false);
		const btn = container.querySelector<HTMLButtonElement>('#failure-rollback-btn')!;
		expect(btn.getAttribute('title')).toBeNull();
		const id = btn.getAttribute('aria-describedby');
		expect(document.getElementById(id!)?.textContent).toBe(WANTED_VERSION_OWNED_REASON);
	});
});
