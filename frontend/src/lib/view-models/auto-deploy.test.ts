import { describe, it, expect } from 'vitest';
import {
	autoDeployState,
	autoDeployWhy,
	manualDeployNote,
	clearPinOutcome,
	AUTO_DEPLOY_RUNNING
} from './auto-deploy';
import type { Rollout, RolloutGate } from '../../types';

/**
 * THE FIXTURE IS THE LIVE HUB'S OWN SHAPE.
 *
 * `hello-world-prod/hello-world-app` on 2026-08-30: `GatesPassing=False`,
 * `DeploymentBlocked=False`, three gates of which the schedule one is blocking,
 * `gatedReleaseCandidates: []`, no `wantedVersion`. That is exactly the state
 * the critique operated, and it is the state the old banner described as
 * "Deployments currently blocked" one press before production changed.
 */
function rollout(over: Record<string, unknown> = {}): Rollout {
	return {
		metadata: { name: 'hello-world-app', namespace: 'hello-world-prod' },
		spec: {},
		status: {
			conditions: [
				{ type: 'GatesPassing', status: 'False', reason: 'SomeGatesBlocking', message: '' },
				{ type: 'DeploymentBlocked', status: 'False', reason: 'HealthChecksHealthy', message: '' }
			],
			gates: [
				{ name: 'schedule-gate-zvsqr', passing: false },
				{ name: 'hello-world-manual-approval', passing: true }
			],
			history: [{ version: { tag: 't' }, bakeStatus: 'Succeeded' }]
		},
		...over
	} as unknown as Rollout;
}

const gates = [
	{
		metadata: {
			name: 'schedule-gate-zvsqr',
			annotations: { 'gate.kuberik.com/pretty-name': 'Business Hours Only' }
		}
	}
] as unknown as RolloutGate[];

describe('autoDeployState', () => {
	it('is running when there is no rollout at all', () => {
		expect(autoDeployState(null)).toEqual(AUTO_DEPLOY_RUNNING);
	});

	it('reads a blocking gate as paused, and uses the gate PRETTY name', () => {
		const s = autoDeployState(rollout(), gates);
		expect(s.paused).toBe(true);
		expect(s.reasons).toEqual(['gates']);
		expect(s.gateNames).toEqual(['Business Hours Only']);
	});

	it('never promotes a generated gate name into the sentence', () => {
		// `schedule-gate-zvsqr` explains nothing. With no pretty-name published
		// the state stays paused and the sentence stops at the consequence.
		const s = autoDeployState(rollout(), []);
		expect(s.paused).toBe(true);
		expect(s.gateNames).toEqual([]);
		expect(autoDeployWhy(s)).toBe('a rule is holding it');
	});

	it('is running when every gate passes and nothing else holds it', () => {
		const r = rollout();
		r.status!.conditions = [{ type: 'GatesPassing', status: 'True' } as never];
		r.status!.gates = [{ name: 'g', passing: true } as never];
		expect(autoDeployState(r).paused).toBe(false);
	});

	it('counts unhealthy health checks — the controller gates automatic deploys on them too', () => {
		const r = rollout();
		r.status!.conditions = [{ type: 'DeploymentBlocked', status: 'True' } as never];
		r.status!.gates = [];
		expect(autoDeployState(r).reasons).toEqual(['health']);
	});

	it('counts a pin: a pinned rollout does not promote itself either', () => {
		const r = rollout({ spec: { wantedVersion: 'main-abc' } });
		expect(autoDeployState(r).reasons).toContain('pin');
	});

	it('counts a failed bake, and stops counting it once unblock-failed is set', () => {
		const failed = rollout();
		failed.status!.history = [{ version: { tag: 't' }, bakeStatus: 'Failed' } as never];
		expect(autoDeployState(failed).reasons).toContain('failed');

		const unblocked = rollout({
			metadata: { name: 'x', annotations: { 'rollout.kuberik.com/unblock-failed': 'true' } }
		});
		unblocked.status!.history = [{ version: { tag: 't' }, bakeStatus: 'Failed' } as never];
		expect(autoDeployState(unblocked).reasons).not.toContain('failed');
	});

	it('de-duplicates and sorts gate names so two gates never print one twice', () => {
		const r = rollout();
		r.status!.gates = [
			{ name: 'b', passing: false },
			{ name: 'a', passing: false },
			{ name: 'a', passing: false }
		] as never;
		const named = [
			{ metadata: { name: 'a', annotations: { 'gate.kuberik.com/pretty-name': 'Bakes First' } } },
			{ metadata: { name: 'b', annotations: { 'gate.kuberik.com/pretty-name': 'Approval' } } }
		] as unknown as RolloutGate[];
		expect(autoDeployState(r, named).gateNames).toEqual(['Approval', 'Bakes First']);
	});
});

describe('autoDeployWhy', () => {
	it('names the gate rather than only counting objects', () => {
		expect(autoDeployWhy(autoDeployState(rollout(), gates))).toBe(
			'a rule is holding it (Business Hours Only)'
		);
	});

	it('joins several reasons into one sentence', () => {
		const r = rollout({ spec: { wantedVersion: 'main-abc' } });
		expect(autoDeployWhy(autoDeployState(r, gates))).toBe(
			'a rule is holding it (Business Hours Only), and it is pinned to one version'
		);
	});
});

describe('manualDeployNote — the sentence inside the deploy modal', () => {
	it('says nothing when automatic promotion is running normally', () => {
		expect(manualDeployNote(AUTO_DEPLOY_RUNNING)).toBeNull();
	});

	it('restates the gate AND says this deploy is not held by it', () => {
		const note = manualDeployNote(autoDeployState(rollout(), gates))!;
		expect(note).toContain('Automatic promotion is paused');
		expect(note).toContain('Business Hours Only');
		// The half the old UI never said, and that cost a production change.
		expect(note).toContain('applies immediately');
	});
});

describe('clearPinOutcome — the promise the old dialog could not keep', () => {
	it('promises advancement ONLY when nothing else is holding it', () => {
		const pinnedOnly = autoDeployState(
			(() => {
				const r = rollout({ spec: { wantedVersion: 'main-abc' } });
				r.status!.conditions = [{ type: 'GatesPassing', status: 'True' } as never];
				r.status!.gates = [];
				return r;
			})()
		);
		expect(clearPinOutcome(pinnedOnly)).toContain('moves to the newest allowed version');
	});

	it('says nothing will move when a gate is still blocking — the live case', () => {
		const s = autoDeployState(rollout({ spec: { wantedVersion: 'main-abc' } }), gates);
		const out = clearPinOutcome(s);
		expect(out).toContain('nothing will move yet');
		expect(out).toContain('Business Hours Only');
		expect(out).not.toContain('moves to the newest allowed version');
	});
});
