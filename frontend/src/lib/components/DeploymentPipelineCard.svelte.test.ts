import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import DeploymentPipelineCard from './DeploymentPipelineCard.svelte';

/* QA round 2, A2: a deploy that is still going out and whose canary has not started selects the NEXT step, never "Final check". */
const steps = [{}, {}, {}];
const kr = { metadata: { name: 'kr', namespace: 'ns' }, spec: { strategy: { canary: { steps } } }, status: {} } as any;
const props = (bakeStatus: string, currentStepIndex: number) => ({
	rollout: { metadata: { name: 'r', namespace: 'ns' }, spec: {}, status: { history: [{ bakeStatus }] } } as any,
	latestEntry: { bakeStatus, timestamp: new Date().toISOString(), version: { tag: 't' } },
	pipelineValidRollouts: [{ rolloutResource: {}, kruiseRollout: kr, rolloutData: { currentStepIndex }, canarySteps: steps, isCompleted: false }],
	pipelineValidTests: [], healthChecks: [], canUpdate: false, namespace: 'ns', name: 'r', onContinue: () => {}
});
describe('DeploymentPipelineCard auto selection', () => {
	test('Deploying with no step started selects Stage 1, not Final check', () => {
		const { container } = render(DeploymentPipelineCard, { props: props('Deploying', 0) as any });
		expect(container.textContent).not.toContain('Final check');
	});
});

/* batch4: a failed health-checks load is UNKNOWN. The step row must not say Healthy. */
describe('DeploymentPipelineCard Health checks row on a failed load', () => {
	const base = (extra: object) => ({
		rollout: { metadata: { name: 'r', namespace: 'ns' }, spec: { healthCheckSelector: { matchLabels: { a: 'b' } } }, status: { history: [{ bakeStatus: 'Succeeded' }] } } as any,
		latestEntry: { bakeStatus: 'Succeeded', timestamp: new Date().toISOString(), version: { tag: 't' } },
		pipelineValidRollouts: [], pipelineValidTests: [], healthChecks: [], canUpdate: false, namespace: 'ns', name: 'r', onContinue: () => {},
		...extra
	});
	test('positive control: an empty, loaded list reads Healthy', () => {
		const { container } = render(DeploymentPipelineCard, { props: base({}) as any });
		expect(container.textContent).toContain('Healthy');
	});
	test('healthChecksUnavailable reads Unavailable, never Healthy', () => {
		const { container } = render(DeploymentPipelineCard, { props: base({ healthChecksUnavailable: true }) as any });
		expect(container.textContent).toContain('Health checks');
		expect(container.textContent).toContain('Unavailable');
		expect(container.textContent).not.toContain('Healthy');
	});
	test('a failed load PLUS a failed bake reads Failed and names the recorded checks', () => {
		const failedEntry = { bakeStatus: 'Failed', timestamp: new Date().toISOString(), version: { tag: 't' }, failedHealthChecks: [{ name: 'error-rate' }, { name: 'p99-latency' }] };
		const { container } = render(DeploymentPipelineCard, {
			props: base({ healthChecksUnavailable: true, latestEntry: failedEntry, rollout: { metadata: { name: 'r', namespace: 'ns' }, spec: { healthCheckSelector: { matchLabels: { a: 'b' } } }, status: { history: [failedEntry] } } }) as any
		});
		expect(container.textContent).not.toContain('Unavailable');
		expect(container.textContent).toContain('Failed');
		expect(container.textContent).toContain('error-rate, p99-latency');
	});

	const failedBake = (names: string[]) => {
		const e = { bakeStatus: 'Failed', timestamp: new Date().toISOString(), version: { tag: 't' }, failedHealthChecks: names.map((name) => ({ name })) };
		return { healthChecksUnavailable: true, latestEntry: e, rollout: { metadata: { name: 'r', namespace: 'ns' }, spec: { healthCheckSelector: { matchLabels: { a: 'b' } } }, status: { history: [e] } } };
	};
	/** The state word of one sub-row, read directly (no count comparison). */
	const rowText = (c: HTMLElement, title: string) =>
		(Array.from(c.querySelectorAll('span.truncate')).find((e) => e.textContent?.trim() === title)
			?.closest('.px-4.py-3')?.textContent ?? '')
			.replace(/\s+/g, ' ')
			.trim();
	const pendingList = (names: string[]) => {
		const { healthChecksUnavailable: _u, ...rest } = failedBake(names);
		return { ...rest, healthChecksPending: true };
	};
	test('timer: failed load + failed bake, NO snapshot: the timer says Pending, never Failed (the timeout is not known)', () => {
		const { container } = render(DeploymentPipelineCard, { props: base(failedBake([])) as any });
		expect(rowText(container, 'Check timer')).toBe('Check timer Pending');
	});
	test('timer: failed load + failed bake WITH a snapshot: the timer says Pending (a check failed, not the clock)', () => {
		const { container } = render(DeploymentPipelineCard, { props: base(failedBake(['error-rate'])) as any });
		expect(rowText(container, 'Check timer')).toBe('Check timer Pending');
		expect(rowText(container, 'Health checks')).toContain('Failed');
	});
	test('timer: loading list + failed bake, NO snapshot: Pending, not Failed', () => {
		const { container } = render(DeploymentPipelineCard, { props: base(pendingList([])) as any });
		expect(rowText(container, 'Check timer')).toBe('Check timer Pending');
	});
	test('loading list + failed bake WITH a snapshot: the row reads Failed and names the checks; the timer is Pending', () => {
		const { container } = render(DeploymentPipelineCard, { props: base(pendingList(['error-rate'])) as any });
		expect(rowText(container, 'Health checks')).toContain('Failed');
		expect(rowText(container, 'Health checks')).toContain('error-rate');
		expect(rowText(container, 'Check timer')).toBe('Check timer Pending');
	});
	test('loading list, bake not failed: the Health checks row is never Healthy', () => {
		const { container } = render(DeploymentPipelineCard, { props: base({ healthChecksPending: true }) as any });
		expect(rowText(container, 'Health checks')).not.toContain('Healthy');
		expect(rowText(container, 'Health checks')).not.toContain('Failed');
	});
	test('a loaded, genuinely healthy list with a failed bake and no snapshot still reads the timer Failed (control)', () => {
		const { container } = render(DeploymentPipelineCard, {
			props: base({ ...failedBake([]), healthChecksUnavailable: false }) as any
		});
		expect(rowText(container, 'Check timer')).toBe('Check timer Failed');
	});
});
