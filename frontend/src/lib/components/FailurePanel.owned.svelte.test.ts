import { describe, test, expect } from 'vitest';
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

describe('the failure banner\'s Roll back on a rollout another controller owns', () => {
	test('it is disabled and carries the reason in its title and through aria-describedby', () => {
		const { container } = draw(false);
		const btn = container.querySelector<HTMLButtonElement>('#failure-rollback-btn')!;
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute('title')).toBe(WANTED_VERSION_OWNED_REASON);
		const id = btn.getAttribute('aria-describedby');
		expect(id).toBeTruthy();
		expect(document.getElementById(id!)?.textContent).toBe(WANTED_VERSION_OWNED_REASON);
	});
	test('owned by the dashboard: enabled, no reason', () => {
		const { container } = draw(true);
		const btn = container.querySelector<HTMLButtonElement>('#failure-rollback-btn')!;
		expect(btn.disabled).toBe(false);
		expect(btn.getAttribute('aria-describedby')).toBeNull();
		expect(btn.getAttribute('title')).toBeNull();
	});
});
