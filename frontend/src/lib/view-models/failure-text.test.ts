import { describe, test, expect } from 'vitest';
import { DIALOG_ERROR_CLASS, retryFailureText, retryOutcome, failureText, RETRY_FAILED } from './failure-text';

describe('a failed Retry reads one way', () => {
	test('the server reason is written once, with one prefix', async () => {
		const text = await failureText(RETRY_FAILED, new Response(JSON.stringify({ error: 'admission webhook denied' }), { status: 500 }));
		expect(text).toBe('Failed to retry: admission webhook denied');
		expect(retryFailureText(new Error(text))).toBe('Failed to retry: admission webhook denied');
	});
	test('a network error gets the prefix; nothing at all reads "Failed to retry"', () => {
		expect(retryFailureText(new TypeError('Failed to fetch'))).toBe('Failed to retry: Failed to fetch');
		expect(retryFailureText(undefined)).toBe('Failed to retry');
	});
	test('an open confirm prints it inside itself and raises no toast; without one a toast carries it', () => {
		expect(retryOutcome(new Error('Failed to retry: nope'), true)).toEqual({ message: 'Failed to retry: nope', toast: false });
		expect(retryOutcome(new Error('Failed to retry: nope'), false)).toEqual({ message: 'Failed to retry: nope', toast: true });
	});
});

describe('the dialog error callout', () => {
	test('is the routine note shape in the danger role', () => {
		for (const c of ['rounded-md', 'border', 'p-3', 'flex', 'items-start', 'border-danger-line', 'bg-danger-tint', 'text-danger']) expect(DIALOG_ERROR_CLASS.split(' ')).toContain(c);
	});
});
