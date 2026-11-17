import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import FailurePanel from './FailurePanel.svelte';
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

/** A rollout in ONE region of prod: every Roll back / Retry confirm names that place, never bare `prod` (all regions) and never `prod-eu-west` (a second spelling). */
const regional = (envLabel: string) => ({
	metadata: { name: 'invoice-api', namespace: 'invoice-api-prod-eu-west', labels: { environment: envLabel } },
	spec: {},
	status: {
		history: [
			{ version: { tag: 'a11c202' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus: 'Failed' },
			{ version: { tag: 'a11c101' }, timestamp: '2026-11-09T10:00:00Z', bakeStatus: 'Succeeded' }
		]
	}
});
const panel = (envLabel: string) =>
	render(WithQueryClient, {
		props: {
			component: FailurePanel as never,
			props: {
				rollout: regional(envLabel), healthChecks: [], failedHCList: [], failedStepTests: [], stalledKruiseRollout: null,
				canUpdate: true, canModify: true, isDashboardManagingWantedVersion: true, onRetry: () => {}, cluster: 'prod', environmentName: 'prod'
			} as never
		}
	});

describe('confirm titles name the place of a regional rollout', () => {
	test('Roll back names prod · eu-west', async () => {
		const { container } = panel('prod-eu-west');
		await fireEvent.click(container.querySelector('#failure-rollback-btn') as HTMLElement);
		await waitFor(() => expect(screen.getByText(/a11c101 to prod · eu-west|Roll back prod · eu-west to a11c101/)).toBeInTheDocument());
		expect(screen.queryByText(/prod-eu-west/)).toBeNull();
	});
	test('Retry: "Retry a11c202 in prod · eu-west?"', async () => {
		const { container } = panel('prod-eu-west');
		await fireEvent.click(container.querySelector('#failure-retry-btn, [data-action="retry"], #failure-retry') as HTMLElement);
		await waitFor(() => expect(document.querySelector('#rcm-title')).not.toBeNull());
		expect(document.querySelector('#rcm-title')!.textContent).toBe('Retry a11c202 in prod · eu-west?');
	});
	test('a rollout with no site keeps the plain environment', async () => {
		const { container } = panel('prod');
		await fireEvent.click(container.querySelector('#failure-rollback-btn') as HTMLElement);
		await waitFor(() => expect(screen.getByText(/a11c101 to prod$|Roll back prod to a11c101/)).toBeInTheDocument());
	});
});
