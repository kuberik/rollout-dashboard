import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stalledKruise, stalledKruiseName, hasFailedStepTests } from './retry-context';

const kr = (name: string, stalled: boolean) => ({ groupVersionKind: 'rollouts.kruise.io/v1beta1/Rollout', object: { metadata: { name }, status: { conditions: [{ type: 'Stalled', status: stalled ? 'True' : 'False' }] } } }) as never;
const test_ = (rolloutName: string, phase: string) => ({ groupVersionKind: 'rollout.kuberik.com/v1alpha1/RolloutTest', object: { spec: { rolloutName, stepIndex: 1 }, status: { phase } } }) as never;

describe('retry context read from managed resources', () => {
	test('the Overview and the tabs read the same stalled Kruise Rollout object', () => {
		expect(stalledKruise({ k: [kr('a', false), kr('b', true)] })?.metadata?.name).toBe('b');
		expect(stalledKruise({})).toBeNull();
	});
	test('the stalled Kruise Rollout is named, an unstalled one is not', () => {
		expect(stalledKruiseName({ k: [kr('a', false), kr('b', true)] })).toBe('b');
		expect(stalledKruiseName({ k: [kr('a', false)] })).toBeUndefined();
		expect(stalledKruiseName({})).toBeUndefined();
	});
	test('a failed test on a Kruise step asks its own question', () => {
		expect(hasFailedStepTests({ k: [kr('a', true), test_('a', 'Failed')] })).toBe(true);
		expect(hasFailedStepTests({ k: [kr('a', true), test_('a', 'Passed')] })).toBe(false);
		expect(hasFailedStepTests({ k: [test_('other', 'Failed')] })).toBe(false);
	});
});

describe('the Overview reads the same stalled Kruise Rollout', () => {
	test('its stalledKruiseRollout is the shared helper, not a second loop', () => {
		const src = readFileSync(resolve(__dirname, '../../routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte'), 'utf8');
		expect(src).toMatch(/const stalledKruiseRollout = \$derived\(stalledKruise\(managedResources\)\)/);
	});
});
