/** A Retry on the Overview's failure banner whose confirm is closed while the request runs: the failure is still reported to the host. */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

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

describe('FailurePanel: Retry closed while in flight, then failing', () => {
	it('reports the failure to the host (onError) instead of losing it', async () => {
		document.body.innerHTML = '';
		const onError = vi.fn();
		const onRetry = vi.fn(() => new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Failed to retry: nope')), 200)));
		render(WithQueryClient, { props: { component: FailurePanel as never, props: {
			rollout: { metadata: { name: 'app', namespace: 'ns' }, spec: {}, status: { history } }, healthChecks: [], failedStepTests: [], stalledKruiseRollout: null,
			canUpdate: true, canModify: true, isDashboardManagingWantedVersion: true, environmentName: 'dev', onRetry, requestRetry: true, onRequestHandled: () => {}, onError,
			failedHCList: []
		} as never } });
		const d = document.querySelector('dialog')!;;
		await fireEvent.click([...d.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Deploy Now')!);
		await fireEvent.click([...d.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Cancel')!);
		await waitFor(() => expect(onError).toHaveBeenCalledWith('Failed to retry: nope'), { timeout: 3000 });
	});
});
