import { describe, expect, it } from 'vitest';
import type { Rollout } from '../../types';
import { autoRollbackView, deployKindLabel, failedBakeHeld, notRolledBackHeadline, splitSource, verdictRows, whyWords } from './auto-rollback';

const v = (tag: string) => ({ tag, version: `1.${tag.slice(-1)}.0`, revision: 'a'.repeat(40), created: '2026-11-21T10:00:00Z' });
const failed = {
	id: 4,
	version: v('r4'),
	timestamp: '2026-11-21T10:00:00Z',
	bakeStatus: 'Failed',
	deployKind: 'Automatic',
	failedHealthChecks: [
		{
			name: 'k',
			namespace: 'ns',
			class: 'kustomization',
			failures: [
				{ source: 'RolloutTest ns/flaky-ui', kind: 'TestFailed', rollsBack: false, why: 'SourceOptedOut' },
				{ source: 'RolloutTest ns/smoke', kind: 'TestFailed', rollsBack: true, why: 'CheckRollbackOn' }
			]
		}
	]
};
const rolledBack = (): Rollout =>
	({
		status: {
			conditions: [{ type: 'AutoRollback', status: 'True', reason: 'RolledBack', message: 'm' }],
			history: [{ id: 5, version: v('r3'), timestamp: 't', deployKind: 'AutoRollback', rollbackOf: 4, bakeStatus: 'Succeeded' }, failed],
			candidates: [{ tag: 'r4', gated: true, failedBake: true }]
		}
	}) as unknown as Rollout;

describe('auto-rollback view-model', () => {
	it('labels how a build was deployed; Automatic says nothing', () => {
		expect(deployKindLabel('AutoRollback')).toBe('Automatic rollback');
		expect(deployKindLabel('ForceDeploy')).toBe('Force deployed');
		expect(deployKindLabel('Automatic')).toBeNull();
		expect(deployKindLabel(undefined)).toBeNull();
	});
	it('words each why from kind + why, naming the opt-out annotation', () => {
		expect(whyWords({ kind: 'TestFailed', why: 'SourceOptedOut', rollsBack: false })).toContain('rollout.kuberik.com/rollback: false');
		expect(whyWords({ kind: 'Incident', why: 'NotInRollbackOn', rollsBack: false })).toBe('the check does not roll back on incidents');
		expect(whyWords({ kind: 'TestFailed', why: 'CheckRollbackOn', rollsBack: true })).toBe('the check rolls back on test failures');
		expect(whyWords({ kind: 'CheckError', why: 'CheckErrorNever', rollsBack: false })).toMatch(/never rolls back/);
	});
	it('splits a source into type and ref', () => {
		expect(splitSource('RolloutTest ns/t')).toEqual({ type: 'RolloutTest', ref: 'ns/t' });
		expect(splitSource('bare')).toEqual({ type: '', ref: 'bare' });
	});
	it('puts the failures that roll back first', () => {
		const rows = verdictRows(failed as never);
		expect(rows.map((r) => [r.ref, r.word])).toEqual([['ns/smoke', 'rolls back'], ['ns/flaky-ui', 'does not roll back']]);
		expect(rows[1].why).toBe('Test failed · opted out with rollout.kuberik.com/rollback: false');
	});
	it('rolled back: the failed entry is found by rollbackOf, triggers and spared split', () => {
		const a = autoRollbackView(rolledBack());
		expect(a?.state).toBe('rolled-back');
		if (a?.state !== 'rolled-back') return;
		expect(a.failed.version.tag).toBe('r4');
		expect(a.triggers.map((x) => x.ref)).toEqual(['ns/smoke']);
		expect(a.spared.map((x) => x.ref)).toEqual(['ns/flaky-ui']);
	});
	it('no condition, or a newer deploy after the rollback, says nothing', () => {
		expect(autoRollbackView({ status: { history: [failed] } } as never)).toBeNull();
		const r = rolledBack();
		r.status!.history = [{ id: 6, version: v('r5'), timestamp: 't', deployKind: 'Automatic', bakeStatus: 'InProgress' } as never, ...r.status!.history!];
		expect(autoRollbackView(r)).toBeNull();
	});
	it('not rolled back: ManualDeploy uses the design wording', () => {
		const r = { status: { conditions: [{ type: 'AutoRollback', status: 'False', reason: 'ManualDeploy' }], history: [{ ...failed, deployKind: 'ForceDeploy' }] } } as never;
		const a = autoRollbackView(r);
		expect(a?.state === 'not-rolled-back' && a.headline).toBe('Not rolled back automatically: deployed by hand');
	});
	it('NotATrigger names the one source that did not trigger', () => {
		const only = { ...failed, failedHealthChecks: [{ ...failed.failedHealthChecks[0], failures: [failed.failedHealthChecks[0].failures[0]] }] };
		const rows = verdictRows(only as never);
		expect(notRolledBackHeadline('NotATrigger', only as never, rows)).toBe('Not rolled back: flaky-ui failed, and it does not roll back');
	});
	it('reads the hold from candidates[].failedBake', () => {
		expect(failedBakeHeld(rolledBack(), 'r4')).toBe(true);
		expect(failedBakeHeld(rolledBack(), 'r9')).toBe(false);
	});
});
