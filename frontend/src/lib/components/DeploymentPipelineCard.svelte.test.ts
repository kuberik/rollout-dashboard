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
