import { describe, expect, it } from 'vitest';
import type { DependencyBreak, Rollout } from '../../types';
import { autoRollbackView, entryRollbackNote } from './auto-rollback';
import { blockedWhy, consumerVerdicts, breakRows, historyBlockedNote, historyRolledBackNote, nowSafeView, previewLine, protectingConsumers, protectingMark, rollbackVerdict, rollbackWarning, skippedLine } from './rollback-deps';

const brk = (o: Partial<DependencyBreak> = {}): DependencyBreak => ({
	kind: 'ConsumerRequires',
	rollout: 'checkout',
	namespace: 'checkout-prod',
	dependency: 'checkout-needs-ledger',
	contract: 'ledger',
	requires: '^6.0.0',
	version: '3.2.0',
	reason: 'ConstraintNotSatisfied',
	...o
});
const ver = (tag: string, version: string) => ({ tag, version, revision: 'a'.repeat(40), created: '2026-11-21T10:00:00Z' });
const sel = { usualTarget: 'r51', blockedBy: [brk()] };

function blocked(over: Record<string, unknown> = {}, live?: unknown): Rollout {
	return {
		metadata: { name: 'ledger-books', namespace: 'ledger-prod' },
		spec: { autoRollback: { minSeverity: 'Critical' } },
		status: {
			conditions: [{ type: 'AutoRollback', status: 'False', reason: 'ConsumerRequires', message: 'm' }],
			autoRollback: live,
			history: [
				{ id: 4, version: ver('r70', '7.0.0'), bakeStatus: 'Failed', deployKind: 'Automatic', autoRollback: sel, ...over },
				{ id: 3, version: ver('r60', '6.0.2'), bakeStatus: 'Succeeded' },
				{ id: 2, version: ver('r51', '5.1.0'), bakeStatus: 'Succeeded' }
			]
		}
	} as unknown as Rollout;
}

describe('rollback-deps view-model', () => {
	it('the line says what rolling back would do; the rows draw what each consumer needs', () => {
		expect(blockedWhy([brk()])).toBe('Rolling back would break checkout');
		const [r] = breakRows([brk(), brk({ rollout: 'billing' })], '5.1.0');
		expect([r.name, r.contract, r.left, r.right]).toEqual(['checkout', 'ledger', '^6.0.0', '5.1.0']);
	});
	it('rows read consumer, running build, constraint, verdict; by hand is said', () => {
		const [r] = breakRows([brk({ deployKind: 'ForceDeploy' })], '5.1.0');
		expect(r.text).toBe('checkout · runs 3.2.0 · deployed by hand · needs ledger ^6.0.0 · 5.1.0 does not satisfy');
		expect(breakRows([brk({ reason: 'RequirementUnreadable', requires: '' })], '5.1.0')[0].text).toBe('checkout · runs 3.2.0 · requirements unreadable');
	});
	it('the banner view carries the headline, rows and the usual target', () => {
		const v = autoRollbackView(blocked());
		expect(v?.state).toBe('not-rolled-back');
		if (v?.state !== 'not-rolled-back') return;
		expect(v.headline).toBe('Not rolled back \u00b7 Rolling back would break checkout');
		expect(v.why).toBe('Rolling back would break checkout');
		expect(v.breaks).toHaveLength(1);
		expect(v.usualTarget).toBe('5.1.0');
	});
	it('now safe: names the target and where the consumer is now', () => {
		const live = { for: 'r70', target: 'r51', usualTarget: 'r51' };
		const r = blocked({}, live);
		const n = nowSafeView(r, () => ({ version: '2.9.0', requires: '^5.0.0' }));
		expect(n?.headline).toBe('Rollback to `5.1.0` is now safe: checkout moved to `2.9.0`');
		expect(n?.targetTag).toBe('r51');
		expect(nowSafeView(r)?.headline).toBe('Rollback to `5.1.0` is now safe: checkout moved');
		expect(nowSafeView(blocked({}, { for: 'r70', blockedBy: [brk()] }))).toBeNull();
		expect(nowSafeView(blocked({}, { for: 'r60', target: 'r51' }))).toBeNull();
	});
	it('skipped line: one per skipped build, capped', () => {
		const s = (tag: string, version: string) => ({ tag, version, breaks: [brk()] });
		expect(skippedLine({ skipped: [s('r51', '5.1.0')] })).toBe('Skipped 5.1.0: checkout needs ledger ^6.0.0.');
		expect(skippedLine({})).toBeNull();
		expect(skippedLine(undefined)).toBeNull();
	});
	it('preview: rolls back to the safe build, or says none is; silent when nothing is skipped', () => {
		const baking = (live: unknown): Rollout => ({ status: { history: [{ version: ver('r70', '7.0.0'), bakeStatus: 'InProgress' }, { version: ver('r60', '6.0.2'), bakeStatus: 'Succeeded' }], autoRollback: live } }) as unknown as Rollout;
		expect(previewLine(baking({ for: 'r70', target: 'r60', skipped: [{ tag: 'r51', version: '5.1.0', breaks: [brk()] }] }))).toBe('Rollback goes to 6.0.2, skipping 5.1.0');
		expect(previewLine(baking({ for: 'r70', blockedBy: [brk()] }))).toBe('Rolling back would break checkout');
		expect(previewLine(baking({ for: 'r70', target: 'r60' }))).toBeNull();
		expect(previewLine(baking({ for: 'r60', blockedBy: [brk()] }))).toBeNull();
		expect(previewLine(baking(undefined))).toBeNull();
	});
	it('history labels', () => {
		expect(historyBlockedNote({ autoRollback: { blockedBy: [brk(), brk({ rollout: 'billing' })] } } as never)).toBe('Rolling back would break checkout and billing');
		expect(historyBlockedNote({ autoRollback: { blockedBy: [brk({ allowed: true })] } } as never)).toBeNull();
		const rb = { deployKind: 'AutoRollback', version: ver('r60', '6.0.2'), autoRollback: { target: 'r60', skipped: [{ tag: 'r51', version: '5.1.0', breaks: [brk()] }] } };
		expect(historyRolledBackNote(rb as never)).toBe('Rolled back to 6.0.2 · skipped 5.1.0 (checkout needs ledger ^6.0.0)');
		expect(historyRolledBackNote({ ...rb, autoRollback: { target: 'r60' } } as never)).toBeNull();
		const r = blocked();
		expect(entryRollbackNote(r, r.status!.history![0] as never).note).toBe('Not rolled back \u00b7 Rolling back would break checkout');
	});
	it('held mark: active only while the block stands', () => {
		const r = blocked();
		expect(protectingConsumers(r)).toEqual([{ namespace: 'checkout-prod', name: 'checkout', contract: 'ledger' }]);
		expect(protectingMark(r, 'checkout')).toBe('Kept on 7.0.0 so checkout keeps working');
		expect(protectingConsumers(blocked({}, { for: 'r70', target: 'r51' }))).toEqual([]);
		const other = blocked();
		other.status!.conditions![0].reason = 'NoTarget';
		expect(protectingConsumers(other)).toEqual([]);
	});
	it('captions and verdicts', () => {
		expect(rollbackVerdict('5.1.0')).toBe('A rollback to 5.1.0 would break this');
	});
	it('dialog warning: a warning with the way out, nothing when the edge allows it', () => {
		expect(rollbackWarning('5.1.0', [brk()])).toBe('5.1.0 would break 1 consumer.');
		expect(rollbackWarning('5.1.0', [brk(), brk({ rollout: 'billing', version: '1.0.0' })])).toBe('5.1.0 would break 2 consumers.');
		expect(rollbackWarning('5.1.0', [brk({ allowed: true })])).toBeNull();
		expect(rollbackWarning('5.1.0', [])).toBeNull();
		expect(rollbackWarning('5.1.0', undefined)).toBeNull();
	});
	it('provider gates tab: a verdict per consumer while blocked or previewed', () => {
		expect([...consumerVerdicts(blocked()).entries()]).toEqual([['checkout', 'A rollback to 5.1.0 would break this']]);
		expect(consumerVerdicts(blocked({}, { for: 'r70', target: 'r51' })).size).toBe(0);
		const baking = { status: { history: [{ version: ver('r70', '7.0.0'), bakeStatus: 'InProgress' }], autoRollback: { for: 'r70', target: 'r60', skipped: [{ tag: 'r51', version: '5.1.0', breaks: [brk()] }] } } } as unknown as Rollout;
		expect(consumerVerdicts(baking).get('checkout')).toBe('A rollback to 5.1.0 would break this');
		expect(consumerVerdicts(undefined).size).toBe(0);
	});
});

describe('historySkippedBuilds', () => {
	it('lists the skipped builds only, the reasons stay in historySkippedTail', async () => {
		const { historySkippedBuilds } = await import('./rollback-deps');
		const brk = { kind: 'ConsumerRequires', rollout: 'checkout', namespace: 'shop', contract: 'ledger', requires: '^6.0.0', reason: 'ConsumerRequires' };
		const rb = { deployKind: 'AutoRollback', version: { tag: 'r60', version: '6.0.2' }, autoRollback: { target: 'r60', skipped: [{ tag: 'r51', version: '5.1.0', breaks: [brk] }] } };
		expect(historySkippedBuilds(rb as never)).toEqual({ builds: ['5.1.0'], rest: 0 });
		expect(historySkippedBuilds({ ...rb, deployKind: 'Manual' } as never)).toBeNull();
		expect(historySkippedBuilds({ ...rb, autoRollback: { target: 'r60' } } as never)).toBeNull();
	});
});
