import { describe, it, expect } from 'vitest';
import { waitsForText } from './waits-for-text';

describe('waitsForText: ONE sentence builder for the clauses a rollout waits on', () => {
	it('one clause keeps its short forms', () => {
		expect(waitsForText(['someone approves it'])).toBe('an approval');
		expect(waitsForText(['the deploy window reopens'])).toBe('the deploy window to reopen');
		expect(waitsForText(['a check starts passing'])).toBe('a check to start passing');
		expect(waitsForText(['staging deploys it first'])).toBe('staging to deploy it first');
	});
	it('joined clauses are each inflected: grammatical, no two finite verbs', () => {
		expect(waitsForText(['someone approves it', 'the deploy window reopens'])).toBe('an approval and the deploy window to reopen');
		expect(waitsForText(['someone approves it', 'a check starts passing', 'payments-svc ships a newer version'])).toBe('an approval, a check to start passing and payments-svc to ship a newer version');
	});
});
