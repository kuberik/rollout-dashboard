import { describe, it, expect } from 'vitest';
import { scheduleLabelOfGate, scheduleLabelOf, gateDisplayName } from './gate-name';

const sched = (name: string, ns: string, managed: string[], pretty?: string) => ({
	metadata: { name, namespace: ns, ...(pretty ? { annotations: { 'gate.kuberik.com/pretty-name': pretty } } : {}) },
	status: { managedGates: managed }
});

describe('scheduleLabelOfGate: a gate reads as the window that owns it (batch4 b)', () => {
	const data = { rolloutSchedules: { items: [sched('after-hours', 'door-lock-prod', ['schedule-gate-dl1xx'], 'After Hours'), sched('plain', 'door-lock-prod', ['schedule-gate-pl1xx'])] }, clusterRolloutSchedules: { items: [sched('freeze', '', ['other-ns/cg'], 'Freeze')] } };
	it('joins on managedGates in the gate\'s own namespace', () => {
		expect(scheduleLabelOfGate(data, 'door-lock-prod', 'schedule-gate-dl1xx')).toBe('After Hours');
		expect(scheduleLabelOfGate(data, 'elsewhere', 'schedule-gate-dl1xx')).toBeNull();
	});
	it('a schedule with no pretty name reads as its resource name (one rule with withSchedules)', () => {
		expect(scheduleLabelOfGate(data, 'door-lock-prod', 'schedule-gate-pl1xx')).toBe('plain');
		expect(scheduleLabelOf({ name: 'x' })).toBe('x');
		expect(scheduleLabelOf(null)).toBeNull();
	});
	it('a cluster schedule lists namespace/name', () => {
		expect(scheduleLabelOfGate(data, 'other-ns', 'cg')).toBe('Freeze');
	});
	it('no schedule anywhere: null, so the gate keeps "Schedule gate <id>" (gateDisplayName)', () => {
		expect(scheduleLabelOfGate(undefined, 'door-lock-prod', 'schedule-gate-dl1xx')).toBeNull();
		expect(gateDisplayName('schedule-gate-dl1xx')).toBe('Schedule gate dl1xx');
	});
});
