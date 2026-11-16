import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import FailurePanel from './FailurePanel.svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

const obs = { name: 'error rate', kind: 'Threshold', value: '4.20', limit: '1', unit: '%', direction: 'Above', healthy: false };
const rollout = { metadata: { name: 'orders-api', namespace: 'orders' }, spec: {}, status: { history: [{ version: { tag: '1.0.0' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus: 'Failed' }] } };
const props = (observations: unknown[]) => ({
	rollout, healthChecks: [], failedStepTests: [], stalledKruiseRollout: null, canUpdate: false, canModify: false,
	isDashboardManagingWantedVersion: true, onRetry: () => {},
	failedHCList: [{ name: 'error-rate', message: 'error-rate: 4.2% of requests failed, over a 1% budget', observations }]
}) as never;

describe('rollout detail failure banner', () => {
	test('leads with the measured figure; the name is the caption, the line under it is the budget', () => {
		const { container } = render(WithQueryClient, { props: { component: FailurePanel as never, props: props([obs]) } });
		expect(container.querySelector('[data-observation-figure]')?.textContent).toContain('4.2%');
		expect(container.textContent).toContain('over a 1% budget');
		expect(container.querySelector('[data-observation-figure]')?.textContent).toContain('error rate');
		expect(container.textContent).not.toContain('error rate: over');
	});
	test('no observations: no figure, the sentence is unchanged', () => {
		const { container } = render(WithQueryClient, { props: { component: FailurePanel as never, props: props([]) } });
		expect(container.querySelector('[data-observation-figure]')).toBeNull();
		expect(container.textContent).toContain('of requests failed');
		/* the banner's own sentence, not the Details list below it */
		expect((container.textContent ?? '').split('Details')[0]).toContain('of requests failed');
	});
	test('a check failing without observations beside a recovered one: the sentence stays, no "retry is reasonable"', () => {
		const live = [
			{ metadata: { name: 'error-rate' }, spec: { class: 'datadog' }, status: { status: 'Unhealthy', lastChangeTime: '2026-11-10T10:05:00Z' } },
			{ metadata: { name: 'latency' }, spec: { class: 'datadog' }, status: { status: 'Healthy', lastErrorTime: '2026-11-10T10:03:00Z', lastChangeTime: '2026-11-10T10:06:00Z' } }
		];
		const p = { ...(props([]) as object), healthChecks: live, failedHCList: [{ name: 'latency', message: 'latency monitor alerted' }, { name: 'error-rate', message: 'error-rate: 4.2% of requests failed, over a 1% budget' }] } as never;
		const { container } = render(WithQueryClient, { props: { component: FailurePanel as never, props: p } });
		const head = (container.textContent ?? '').split('Details')[0];
		expect(head).not.toContain('retry is reasonable');
		expect(head.length).toBeGreaterThan('Deployment failed'.length + 5);
	});
	test('one check failing now and one recovered: the sentence counts and names only the failing one', () => {
		const live = [
			{ metadata: { name: 'error-rate' }, spec: { class: 'datadog' }, status: { status: 'Unhealthy', lastChangeTime: '2026-11-10T10:05:00Z' } },
			{ metadata: { name: 'latency' }, spec: { class: 'datadog' }, status: { status: 'Healthy', lastErrorTime: '2026-11-10T10:03:00Z', lastChangeTime: '2026-11-10T10:06:00Z' } }
		];
		const p = { ...(props([]) as object), healthChecks: live, failedHCList: [{ name: 'latency', message: 'latency monitor alerted' }, { name: 'error-rate', message: 'error-rate: 4.2% of requests failed' }] } as never;
		const { container } = render(WithQueryClient, { props: { component: FailurePanel as never, props: p } });
		const head = (container.textContent ?? '').split('Details')[0];
		expect(head).not.toContain('2 health checks failing');
		expect(head).not.toContain('latency');
		expect(head).toContain('error-rate: 4.2% of requests failed');
	});
	/* the pair reads Roll back, then Retry in every state; only the blue one follows the state */
	const pair = (live: unknown[]) => {
		const r = { ...rollout, status: { history: [{ version: { tag: '1.0.1' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus: 'Failed' }, { version: { tag: '1.0.0' }, timestamp: '2026-11-09T10:00:00Z', bakeStatus: 'Succeeded' }] } };
		const p = { ...(props([]) as object), rollout: r, canUpdate: true, canModify: true, healthChecks: live, failedHCList: [{ name: 'error-rate', message: 'error-rate: 4.2% of requests failed' }] } as never;
		const { container } = render(WithQueryClient, { props: { component: FailurePanel as never, props: p } });
		return [...container.querySelectorAll('[data-act-row] [data-action]')].filter((e) => ['rollback', 'retry'].includes((e as HTMLElement).dataset.action ?? '')).map((e) => `${(e as HTMLElement).dataset.action}:${/btn-primary/.test(e.className) ? 'primary' : 'secondary'}`);
	};
	test('failing now: Roll back (blue) first, then Retry', () => {
		const live = [{ metadata: { name: 'error-rate' }, spec: { class: 'datadog' }, status: { status: 'Unhealthy', lastChangeTime: '2026-11-10T10:05:00Z' } }];
		expect(pair(live)).toEqual(['rollback:primary', 'retry:secondary']);
	});
	test('recovered: Roll back first, then Retry (blue)', () => {
		const live = [{ metadata: { name: 'error-rate' }, spec: { class: 'datadog' }, status: { status: 'Healthy', lastErrorTime: '2026-11-10T10:03:00Z', lastChangeTime: '2026-11-10T10:06:00Z' } }];
		expect(pair(live)).toEqual(['rollback:secondary', 'retry:primary']);
	});
});
