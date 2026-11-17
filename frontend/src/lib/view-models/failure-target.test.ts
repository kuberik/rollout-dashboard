import { describe, expect, it } from 'vitest';
import { rolloutFailureTarget } from './failure-target';
import type { Rollout } from '../../types';

const rollout = (name: string, env: string) => ({ metadata: { name, namespace: 'ns', labels: { environment: env } }, spec: {}, status: {} }) as unknown as Rollout;

describe('rolloutFailureTarget', () => {
	it('a site in the environment is part of the place: "prod · eu-west"', () => {
		expect(rolloutFailureTarget(rollout('invoice-api', 'prod'), 'prod', 'eu-west')).toBe('invoice-api in prod · eu-west');
	});
	it('the rollout label can carry the site when the Environment does not', () => {
		expect(rolloutFailureTarget(rollout('invoice-api', 'prod-eu-west'), 'prod', null)).toBe('invoice-api in prod · eu-west');
	});
	it('a single-site rollout keeps "in prod"', () => {
		expect(rolloutFailureTarget(rollout('orders-hub', 'prod'), 'prod', null)).toBe('orders-hub in prod');
	});
});
