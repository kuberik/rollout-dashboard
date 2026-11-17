import { describe, expect, it, beforeEach } from 'vitest';
import { failureToasts, reportFailure, dismissFailure, resetFailureToasts, failureTarget, failureToastText } from './failure-toasts.svelte';

beforeEach(resetFailureToasts);

describe('failure toast wording', () => {
	it('names the target before the reason', () => {
		expect(failureToastText(failureTarget('orders-hub', 'prod'), 'Failed to roll back: denied')).toBe('orders-hub in prod: Failed to roll back: denied');
	});
	it('with no place it names the rollout alone; with no target it is the bare reason', () => {
		expect(failureTarget('orders-hub', null)).toBe('orders-hub');
		expect(failureToastText('', 'Failed to retry')).toBe('Failed to retry');
	});
});

describe('the failure toast list', () => {
	it('keeps a failure until it is dismissed, and says one sentence once', () => {
		reportFailure('orders-hub in prod', 'Failed to retry: nope');
		reportFailure('orders-hub in prod', 'Failed to retry: nope');
		expect(failureToasts.items.map((t) => t.message)).toEqual(['orders-hub in prod: Failed to retry: nope']);
		dismissFailure(failureToasts.items[0].id);
		expect(failureToasts.items).toEqual([]);
	});
	it('the same failure on two sites is two toasts, never one', () => {
		reportFailure('checkout-api in prod · eu-central', 'Failed to roll back: denied');
		reportFailure('checkout-api in prod · us-east-1', 'Failed to roll back: denied');
		expect(failureToasts.items.map((t) => t.message)).toEqual([
			'checkout-api in prod · eu-central: Failed to roll back: denied',
			'checkout-api in prod · us-east-1: Failed to roll back: denied'
		]);
	});
	it('the list is capped: the oldest give way', () => {
		for (let i = 0; i < 30; i++) reportFailure(`app-${i} in prod`, 'Failed to retry');
		expect(failureToasts.items.length).toBe(25);
		expect(failureToasts.items[0].message).toBe('app-5 in prod: Failed to retry');
	});
});
