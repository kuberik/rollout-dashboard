import { describe, it, expect } from 'vitest';
import { requirementsDelta, requirementsChangedSentence } from './release-delta';

describe('requirementsDelta', () => {
	it('reports nothing when both releases ask the same of every contract', () => {
		const from = { requires: { api: '^1.66.0' } };
		const to = { requires: { api: '^1.66.0' } };
		expect(requirementsDelta(from, to)).toEqual([]);
	});

	it('reports a changed constraint', () => {
		const from = { requires: { api: '^1.66.0' } };
		const to = { requires: { api: '^1.67.0' } };
		expect(requirementsDelta(from, to)).toEqual([
			{ contract: 'api', kind: 'changed', from: '^1.66.0', to: '^1.67.0' }
		]);
	});

	it('reports a contract that appears only on the newer release as added', () => {
		const from = { requires: {} };
		const to = { requires: { api: '^1.67.0' } };
		expect(requirementsDelta(from, to)).toEqual([
			{ contract: 'api', kind: 'added', to: '^1.67.0' }
		]);
	});

	it('reports a contract that disappears as removed', () => {
		const from = { requires: { api: '^1.66.0' } };
		const to = { requires: {} };
		expect(requirementsDelta(from, to)).toEqual([
			{ contract: 'api', kind: 'removed', from: '^1.66.0' }
		]);
	});

	it('handles releases with no requires field at all', () => {
		expect(requirementsDelta(undefined, undefined)).toEqual([]);
		expect(requirementsDelta({}, {})).toEqual([]);
	});

	it('sorts by contract name for a stable sentence', () => {
		const from = { requires: { web: '^1.0.0', api: '^1.0.0' } };
		const to = { requires: { web: '^2.0.0', api: '^2.0.0' } };
		expect(requirementsDelta(from, to).map((c) => c.contract)).toEqual(['api', 'web']);
	});
});

describe('requirementsChangedSentence', () => {
	it('states the exact shape the operator walk asked for', () => {
		const from = { requires: { api: '^1.66.0' } };
		const to = { requires: { api: '^1.67.0' } };
		expect(requirementsChangedSentence('2.66.0-66', from, to)).toBe(
			'Same commit as 2.66.0-66. What changed: requires api ^1.66.0 → ^1.67.0.'
		);
	});

	it('is null when nothing about the requirements changed', () => {
		const from = { requires: { api: '^1.66.0' } };
		const to = { requires: { api: '^1.66.0' } };
		expect(requirementsChangedSentence('2.66.0-66', from, to)).toBeNull();
	});

	it('joins more than one changed contract', () => {
		const from = { requires: { api: '^1.0.0', web: '^1.0.0' } };
		const to = { requires: { api: '^2.0.0', web: '^1.0.0' } };
		expect(requirementsChangedSentence('rel-66', from, to)).toBe(
			'Same commit as rel-66. What changed: requires api ^1.0.0 → ^2.0.0.'
		);
	});
});
