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
});
