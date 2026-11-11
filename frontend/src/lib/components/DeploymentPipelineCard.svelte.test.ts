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
	const failedCount = (c: HTMLElement) => (c.textContent?.match(/Failed/g) ?? []).length;
	const known = (names: string[], checks: unknown[]) => {
		const { healthChecksUnavailable: _u, ...rest } = failedBake(names);
		return { ...rest, healthChecks: checks };
	};
	const unhealthy = { metadata: { name: 'error-rate', namespace: 'ns' }, status: { status: 'Unhealthy', lastErrorTime: new Date().toISOString() } };
	test('failed load + failed bake WITH a snapshot: reads exactly as when the list is known unhealthy', () => {
		const ref = render(DeploymentPipelineCard, { props: base(known(['error-rate'], [unhealthy])) as any });
		const want = failedCount(ref.container);
		ref.unmount();
		const { container } = render(DeploymentPipelineCard, { props: base(failedBake(['error-rate'])) as any });
		expect(failedCount(container)).toBe(want);
	});
	test('failed load + failed bake with NO snapshot: unknown, so the timer does not claim a timeout', () => {
		const ref = render(DeploymentPipelineCard, { props: base(known([], [unhealthy])) as any });
		const want = failedCount(ref.container); // reference: known-unhealthy (HC row Failed, timer not)
		ref.unmount();
		const { container } = render(DeploymentPipelineCard, { props: base(failedBake([])) as any });
		expect(failedCount(container)).toBe(want);
	});
});
