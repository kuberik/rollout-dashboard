import { describe, it, expect } from 'vitest';
import { failureActs, failureActionOrder, failedRowAction } from './failure-actions';

describe('failureActs', () => {
	it('recovered: Retry primary, Roll back first secondary, the rest after', () => {
		expect(failureActs(true, { retry: 'retry', rollback: 'rollback', rest: ['open'] })).toEqual({ primary: 'retry', secondary: ['rollback', 'open'] });
	});
	it('failing now: Roll back primary, Retry first secondary', () => {
		expect(failureActs(false, { retry: 'retry', rollback: 'rollback', rest: ['open'] })).toEqual({ primary: 'rollback', secondary: ['retry', 'open'] });
	});
	it('recovered with no retry offered keeps Roll back primary; failing with no rollback has no primary', () => {
		expect(failureActs(true, { rollback: 'rollback', rest: ['open'] })).toEqual({ primary: 'rollback', secondary: ['open'] });
		expect(failureActs(false, { retry: 'retry', rest: ['open'] })).toEqual({ primary: undefined, secondary: ['retry', 'open'] });
	});
	it('the word order follows the same rule', () => {
		expect(failureActionOrder(true)).toEqual(['retry', 'rollback']);
		expect(failureActionOrder(false)).toEqual(['rollback', 'retry']);
	});
});

describe('failedRowAction', () => {
	it('a recovered failure leads with Retry (the Overview), a failing one with its logs', () => {
		expect(failedRowAction(true, false)).toEqual({ label: 'Retry', sub: undefined });
		expect(failedRowAction(false, false)).toEqual({ label: 'Open logs', sub: 'logs' });
	});
	it('on the Overview already, a recovered failure falls back to the logs (never a no-op)', () => {
		expect(failedRowAction(true, true)).toEqual({ label: 'Open logs', sub: 'logs' });
	});
});
