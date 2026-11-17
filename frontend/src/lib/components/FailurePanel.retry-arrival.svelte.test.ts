/** A Retry link (`?action=retry`) opens the confirm; it never deploys by itself, even where a press would fire without asking. */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/view-models/retry-confirm', () => ({
	retryConfirm: () => ({ intent: { direction: 'same' }, level: 'none', displayTag: '1.0.1', consequences: [] })
}));

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

const history = [{ version: { tag: '1.0.1' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus: 'Failed' }, { version: { tag: '1.0.0' }, timestamp: '2026-11-09T10:00:00Z', bakeStatus: 'Succeeded' }];
const panel = (requestRetry: boolean, onRetry: () => Promise<void>) =>
	render(WithQueryClient, { props: { component: FailurePanel as never, props: {
		rollout: { metadata: { name: 'app', namespace: 'ns' }, spec: {}, status: { history } }, healthChecks: [], failedStepTests: [], stalledKruiseRollout: null,
		canUpdate: true, canModify: true, isDashboardManagingWantedVersion: true, environmentName: 'dev', onRetry, requestRetry, onRequestHandled: () => {},
		failedHCList: []
	} as never } });

describe('Retry at the no-confirm level', () => {
	it('arriving by a Retry link opens the confirm and deploys nothing', () => {
		document.body.innerHTML = '';
		const onRetry = vi.fn(async () => {});
		panel(true, onRetry);
		expect(document.querySelector('#rcm-title')?.textContent).toMatch(/^Retry /);
		expect(onRetry).not.toHaveBeenCalled();
	});
	it('a press on Retry still fires without a dialog', async () => {
		document.body.innerHTML = '';
		const onRetry = vi.fn(async () => {});
		panel(false, onRetry);
		await fireEvent.click(document.querySelector('#failure-retry-btn') as HTMLElement);
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(document.querySelector('#rcm-title')).toBeNull();
	});
});
