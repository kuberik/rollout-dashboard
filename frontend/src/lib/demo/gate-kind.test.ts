import { describe, it, expect } from 'vitest';
import { mockGateKind, stampGateKinds } from './gate-kind';

describe('mock gate kinds follow #91', () => {
	it('promotion, dependency, schedule, approval (ownerless + allowedVersions), else unknown', () => {
		expect(mockGateKind({ name: 'promotion-prod' })).toBe('promotion');
		expect(mockGateKind({ name: 'ghd-prod-7f3a' })).toBe('promotion');
		expect(mockGateKind({ name: 'dependency-api-needs-db' })).toBe('dependency');
		expect(mockGateKind({ name: 'deploy-window', allowedVersions: [] })).toBe('schedule');
		expect(mockGateKind({ name: 'telemetry-indexer-manual-approval', allowedVersions: ['a'] })).toBe('approval');
		expect(mockGateKind({ name: 'kill-switch' })).toBe('unknown');
	});
	it('stamps list and detail responses, leaves a kind that is already there', () => {
		const list = JSON.parse(stampGateKinds(JSON.stringify({ rollouts: { items: [{ status: { gates: [{ name: 'x-approval', allowedVersions: [] }, { name: 'p', kind: 'schedule' }] } }] } }))!);
		expect(list.rollouts.items[0].status.gates.map((g: { kind: string }) => g.kind)).toEqual(['approval', 'schedule']);
		const one = JSON.parse(stampGateKinds(JSON.stringify({ rollout: { status: { gates: [{ name: 'promotion-prod' }] } } }))!);
		expect(one.rollout.status.gates[0].kind).toBe('promotion');
		expect(stampGateKinds('not json "gates"')).toBe('not json "gates"');
	});
});
