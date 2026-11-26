import { describe, expect, it } from 'vitest';
import type { Rollout } from '../../types';
import { severityOf, shortWhy, autoRollbackView, deployKindLabel, entryRollbackNote, entryRolledBack, failedBakeHeld, notRolledBackHeadline, notRolledBackWhy, glanceRows, rolledBackLine, splitSource, triggerLine, verdictRows, whyWords } from './auto-rollback';

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
				{ source: 'RolloutTest ns/flaky-ui', kind: 'TestFailed', severity: 'Warning', rollsBack: false, why: 'BelowThreshold' },
				{ source: 'RolloutTest ns/smoke', kind: 'TestFailed', severity: 'Critical', rollsBack: true, why: 'AtOrAboveThreshold' }
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
	it('words each why from severity + rule', () => {
		expect(whyWords({ why: 'BelowThreshold', severity: 'Warning', rollsBack: false })).toBe("Warning, below the rollout's severity");
		expect(whyWords({ why: 'AtOrAboveThreshold', severity: 'Critical', rollsBack: true })).toBe("Critical, at or above the rollout's severity");
		expect(whyWords({ why: 'CheckErrorNever', rollsBack: false })).toMatch(/never rolls back/);
		expect(whyWords({ why: 'PredatesDeploy', rollsBack: false })).toMatch(/before this deploy/);
	});
	it('an entry without a severity counts as Critical', () => {
		expect(severityOf({})).toBe('Critical');
		expect(shortWhy({ why: 'BelowThreshold', severity: 'Warning' })).toBe('Warning');
		expect(shortWhy({ why: 'CheckErrorNever' })).toBe('check error');
	});
	it('splits a source into type and ref', () => {
		expect(splitSource('RolloutTest ns/t')).toEqual({ type: 'RolloutTest', ref: 'ns/t' });
		expect(splitSource('bare')).toEqual({ type: '', ref: 'bare' });
	});
	it('puts the failures that roll back first', () => {
		const rows = verdictRows(failed as never);
		expect(rows.map((r) => [r.ref, r.word])).toEqual([['ns/smoke', 'rolls back'], ['ns/flaky-ui', 'does not roll back']]);
		expect(rows[1].why).toBe("Test failed · Warning, below the rollout's severity");
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
	it('not rolled back: ManualDeploy gives a short reason beside the state word', () => {
		const r = { status: { conditions: [{ type: 'AutoRollback', status: 'False', reason: 'ManualDeploy' }], history: [{ ...failed, deployKind: 'ForceDeploy' }] } } as never;
		const a = autoRollbackView(r);
		expect(a?.state === 'not-rolled-back' && a.why).toBe('Deployed by hand');
		expect(a?.state === 'not-rolled-back' && a.headline).toBe('Not rolled back · Deployed by hand');
	});
	it('every reason line stays within 12 words', () => {
		const rows = verdictRows(failed as never);
		for (const reason of ['ManualDeploy', 'ManualIntent', 'NoTarget', 'DeployError', 'NotATrigger', 'Other']) {
			expect(notRolledBackWhy(reason, failed as never, rows).split(/\s+/).length).toBeLessThanOrEqual(12);
		}
	});
	it('names the trigger in one line', () => {
		const rows = verdictRows(failed as never).filter((x) => x.rollsBack);
		expect(triggerLine(rows)).toBe('smoke failed');
		expect(triggerLine([...rows, ...rows])).toBe('smoke and 1 more failed');
		expect(triggerLine([])).toBe('');
		expect(rolledBackLine(rows, '1.4.0', true)).toBe("smoke failed · 1.4.0 won't auto-deploy again");
		expect(rolledBackLine(rows, '1.4.0', false)).toBe('smoke failed');
		expect(rolledBackLine([...rows, ...rows], 'build-name-of-some-length', true).split(/\s+/).length).toBeLessThanOrEqual(12);
	});
	it('NotATrigger names the one source that did not trigger', () => {
		const only = { ...failed, failedHealthChecks: [{ ...failed.failedHealthChecks[0], failures: [failed.failedHealthChecks[0].failures[0]] }] };
		const rows = verdictRows(only as never);
		expect(notRolledBackWhy('NotATrigger', only as never, rows)).toBe('flaky-ui failed');
		expect(notRolledBackHeadline('NotATrigger', only as never, rows)).toBe('Not rolled back · flaky-ui failed');
		expect(notRolledBackWhy('Blocked', only as never, rows)).toBe('No earlier build is safe to roll back to');
	});
	it('glance rows: a glyph, a name and a verdict word, never a sentence', () => {
		const rows = verdictRows(failed as never);
		expect(glanceRows(rows, true).map((r) => [r.name, r.verdict, r.tone])).toEqual([['smoke', 'Critical', 'danger'], ['flaky-ui', 'Warning', 'muted']]);
		expect(glanceRows(rows, false)[0].tone).toBe('neutral');
		for (const r of glanceRows(rows, false)) expect(r.verdict.length).toBeLessThanOrEqual(14);
	});
	it('reads the hold from candidates[].failedBake', () => {
		expect(failedBakeHeld(rolledBack(), 'r4')).toBe(true);
		expect(failedBakeHeld(rolledBack(), 'r9')).toBe(false);
	});
});

describe('entryRollbackNote: verdicts follow what the controller decided', () => {
	const failure = { source: 'RolloutTest ns/smoke', kind: 'TestFailed', reason: 'RolloutTestFailed', severity: 'Critical', rollsBack: true, why: 'AtOrAboveThreshold' };
	const failed = (over: Record<string, unknown> = {}) =>
		({ id: 7, version: { tag: 'b7' }, bakeStatus: 'Failed', deployKind: 'Automatic', failedHealthChecks: [{ name: 'k', namespace: 'ns', class: 'kustomization', failures: [failure] }], ...over }) as never;
	const ok = (over: Record<string, unknown> = {}) => ({ id: 6, version: { tag: 'b6' }, bakeStatus: 'Succeeded', deployKind: 'Automatic', ...over }) as never;
	const ro = (enabled: boolean | undefined, history: unknown[], conditions: unknown[] = []) =>
		({ spec: enabled ? { autoRollback: { minSeverity: 'Critical' } } : {}, status: { history, conditions } }) as unknown as Rollout;

	it('rolled back: only when a later AutoRollback entry names this entry', () => {
		const e = failed();
		const r = ro(true, [ok({ id: 8, deployKind: 'AutoRollback', rollbackOf: 7 }), e, ok()]);
		expect(entryRolledBack(r, e)).toBe(true);
		expect(entryRollbackNote(r, e)).toEqual({ ran: true, word: 'Rolled back', why: 'smoke failed', note: 'Rolled back · smoke failed' });
	});
	it('rollout not opted in: never "rolls back"', () => {
		const e = failed();
		expect(entryRollbackNote(ro(undefined, [e, ok()]), e)).toMatchObject({ ran: false, word: 'Would roll back', why: 'Automatic rollback is off' });
		expect(entryRollbackNote(ro(false, [e, ok()]), e).ran).toBe(false);
	});
	it('a rollback of another entry does not count for this one', () => {
		const e = failed({ id: 5 });
		const r = ro(true, [ok({ id: 8, deployKind: 'AutoRollback', rollbackOf: 7 }), failed(), e]);
		expect(entryRolledBack(r, e)).toBe(false);
	});
	it.each([
		['ManualIntent', 'A deploy was already requested by hand'],
		['NoTarget', 'No earlier build passed its bake'],
		['DeployError', 'The rollback deploy could not be written']
	])('skipped as %s: the condition reason is the note, verdicts are conditional', (reason, why) => {
		const e = failed();
		const r = ro(true, [e, ok()], [{ type: 'AutoRollback', status: 'False', reason, message: '' }]);
		expect(entryRollbackNote(r, e)).toMatchObject({ ran: false, word: 'Not rolled back', why });
	});
	it('an unblock-failed deploy is a deploy by hand', () => {
		expect(entryRollbackNote(ro(true, [failed({ deployKind: 'Unblock' })]), failed({ deployKind: 'Unblock' })).note).toBe('Not rolled back · Deployed by hand');
	});
	it('deployed by hand, or before deploy kinds were recorded', () => {
		expect(entryRollbackNote(ro(true, [failed({ deployKind: 'ForceDeploy' })]), failed({ deployKind: 'ForceDeploy' })).note).toBe('Not rolled back · Deployed by hand');
		const old = failed({ deployKind: undefined });
		expect(entryRollbackNote(ro(true, [old]), old)).toMatchObject({ ran: false, why: 'Deployed before rollback decisions were recorded' });
	});
	it('an older failed entry that was not rolled back reads plainly', () => {
		const e = failed({ id: 3 });
		expect(entryRollbackNote(ro(true, [ok({ id: 9 }), e]), e)).toEqual({ ran: false, word: 'Not rolled back', why: '', note: 'Not rolled back' });
	});
});
