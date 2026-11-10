import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import ChangeVersionFlow from './ChangeVersionFlow.svelte';
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

describe('ChangeVersionFlow with checks that arrive after open (AppDetail cold cache)', () => {
	afterEach(() => vi.unstubAllGlobals());
	test('the consent step waits for the checks and still appears when they resolve Unhealthy', async () => {
		let release: (v: unknown) => void = () => {};
		const gate = new Promise((r) => (release = r));
		vi.stubGlobal('fetch', vi.fn(async (url: string) => {
			if (String(url).includes('/health-checks')) {
				await gate;
				return new Response(JSON.stringify({ healthChecks: [unhealthy] }), { status: 200 });
			}
			return new Response('{}', { status: 200 });
		}));
		const r = { ...rollout, spec: { healthCheckSelector: { matchLabels: { app: 'orders' } } } };
		render(WithQueryClient, {
			props: { component: ChangeVersionFlow as never, props: { open: true, rollout: r, cluster: 'hub', initialSelectedVersion: '1.0.0' } as never }
		});
		// While loading: the dialog is the warning shell in its loading state, never the picker.
		await waitFor(() => expect(document.querySelector('#rmw-summary[aria-busy="true"]')).not.toBeNull());
		release(null);
		await waitFor(() => expect(screen.getByText(/Health checks are unhealthy/)).toBeInTheDocument());
		// Positive control: the picker after Continue carries recovery mode.
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await waitFor(() => expect(screen.getByText(/Recovery mode:/)).toBeInTheDocument());
	});

	for (const [label, impl] of [
		['P500: a 500 is not "no checks"', async () => new Response('boom', { status: 500 })],
		['THROW: a network error is not "no checks"', async () => { throw new Error('network'); }]
	] as const) {
		test(label, async () => {
			vi.stubGlobal('fetch', vi.fn(async (url: string) => {
				if (String(url).includes('/health-checks')) return impl();
				return new Response('{}', { status: 200 });
			}));
			const r = { ...rollout, spec: { healthCheckSelector: { matchLabels: { app: 'orders' } } } };
			render(WithQueryClient, {
				props: { component: ChangeVersionFlow as never, props: { open: true, rollout: r, cluster: 'hub', initialSelectedVersion: '1.0.0' } as never }
			});
			await waitFor(() => expect(screen.getByText(/Health checks couldn't be loaded, so the dashboard can't tell whether this (?:deploy|rollback) runs in recovery mode/)).toBeInTheDocument());
			expect(screen.queryByText(/Health checks are unhealthy/)).toBeNull();
			await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
			// The picker opens and does NOT claim recovery mode (the controller decides it).
			// (The warning's outro stays in jsdom: the Web Animations API is stubbed.)
			await waitFor(() => expect(document.querySelector('[data-autofocus]')).not.toBeNull());
			await new Promise((r) => setTimeout(r, 300));
			expect(screen.queryByText(/Recovery mode:/)).toBeNull();
		});
	}
});
