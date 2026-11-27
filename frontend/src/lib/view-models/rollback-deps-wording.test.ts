import { describe, expect, it } from 'vitest';
import type { DependencyBreak, Rollout } from '../../types';
import { autoRollbackView } from './auto-rollback';
import { blockedWhy, breakRows, servicesBreakLabel, skippedBuildsLabel, protectedByMark, protectedConsumersNote, previewLine, rollbackWarning, rollbackWarningParts, skippedBreakRows, skippedLine } from './rollback-deps';

/** the controller's own sentences (rollout-controller internal/controller/autorollback_deps.go), re-said from the structured breaks */
const consumer = (o: Partial<DependencyBreak> = {}): DependencyBreak => ({
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
const target = (o: Partial<DependencyBreak> = {}): DependencyBreak => ({
	kind: 'TargetRequires',
	rollout: 'ledger-books',
	namespace: 'ledger-prod',
	dependency: 'checkout-needs-ledger',
	contract: 'ledger',
	requires: '^5.0.0',
	version: '6.0.0',
	reason: 'ConstraintNotSatisfied',
	...o
});
const ver = (tag: string, version: string) => ({ tag, version, revision: 'a'.repeat(40), created: '2026-11-21T10:00:00Z' });
const baking = (live: unknown): Rollout =>
	({ metadata: { name: 'checkout' }, status: { history: [{ version: ver('r70', '7.0.0'), bakeStatus: 'InProgress' }, { version: ver('r60', '6.0.2'), bakeStatus: 'Succeeded' }], autoRollback: live } }) as unknown as Rollout;

describe('the bake preview: where a failure would go, in one short line', () => {
	it('a skipped build is named, its reasons are not (they are on the Gates tab)', () => {
		const live = { for: 'r70', target: 'r60', skipped: [{ tag: 'r51', version: '5.1.0', breaks: [target()] }] };
		expect(previewLine(baking(live))).toBe('Rollback goes to 6.0.2, skipping 5.1.0');
		const live2 = { for: 'r70', target: 'r60', skipped: [{ tag: 'r51', version: '5.1.0', breaks: [consumer()] }] };
		expect(previewLine(baking(live2))).toBe('Rollback goes to 6.0.2, skipping 5.1.0');
	});
	it('no safe target and only TargetRequires: no consumer is named', () => {
		const line = previewLine(baking({ for: 'r70', blockedBy: [target()] }));
		expect(line).toBe('No earlier build can run against its providers');
		expect(line).not.toContain('ledger-books');
	});
	it('no safe target: names the consumers, two then "and N more"', () => {
		expect(previewLine(baking({ for: 'r70', blockedBy: [consumer()] }))).toBe('Rolling back would break checkout');
		const three = ['a', 'b', 'c'].map((n) => consumer({ rollout: n }));
		expect(previewLine(baking({ for: 'r70', blockedBy: three }))).toBe('Rolling back would break a, b and 1 more');
	});
});

describe('the not-rolled-back banner: a headline, drawn rows, one line (glanceable UI)', () => {
	const blocked = (reason: string, breaks: DependencyBreak[]): Rollout =>
		({
			metadata: { name: 'ledger-books' },
			status: {
				conditions: [{ type: 'AutoRollback', status: 'False', reason, message: 'm' }],
				history: [{ id: 4, version: ver('r70', '7.0.0'), bakeStatus: 'Failed', autoRollback: { usualTarget: 'r51', blockedBy: breaks } }, { id: 3, version: ver('r51', '5.1.0'), bakeStatus: 'Succeeded' }]
			}
		}) as unknown as Rollout;
	it.each([
		['ConsumerRequires', 'Rolling back would break checkout'],
		['TargetRequires', 'No earlier build can run against its providers']
	])('%s: the line says what rolling back would do, in 12 words or fewer', (reason, why) => {
		const v = autoRollbackView(blocked(reason, reason === 'ConsumerRequires' ? [consumer()] : [target()]));
		expect(v?.state === 'not-rolled-back' && v.why).toBe(why);
		expect(why.split(' ').length).toBeLessThanOrEqual(12);
		expect(v?.state === 'not-rolled-back' && v.breaks).toHaveLength(1);
	});
	it('never says "held": it says what the block means for the people on the other side', () => {
		const r = { metadata: { name: 'ledger-core' }, status: { history: [{ version: ver('r70', '7.0.0') }] } } as unknown as Rollout;
		expect(protectedConsumersNote(r, ['checkout'])).toBe('Kept on 7.0.0 so checkout keeps working');
		expect(protectedConsumersNote(r, ['checkout', 'billing'])).toBe('Kept on 7.0.0 so checkout and billing keep working');
		expect(protectedConsumersNote(r, ['a', 'b', 'c'])).toBe('Kept on 7.0.0 so a, b and 1 more keep working');
		expect(protectedByMark('7.0.0')).toBe('Stays on 7.0.0 for this service');
		for (const s of [blockedWhy([consumer()]), protectedConsumersNote(r, ['checkout']), protectedByMark('7.0.0')]) expect(s).not.toMatch(/\bheld\b/i);
	});
	it('a consumer row draws what it needs, then the build that does not serve it', () => {
		const [r] = breakRows([consumer()], '5.1.0');
		expect([r.name, r.contract, r.left, r.right]).toEqual(['checkout', 'ledger', '^6.0.0', '5.1.0']);
	});
	it('a provider row draws what it serves, then what the build needs', () => {
		const [r] = breakRows([target()], '5.1.0');
		expect([r.name, r.contract, r.left, r.right]).toEqual(['ledger-books', 'ledger', '6.0.0', '^5.0.0']);
		const [nothing] = breakRows([target({ version: '' })], '5.1.0');
		expect(nothing.left).toBe('?');
	});
	it('an unreadable requirement draws "?" on the requirement side', () => {
		expect(breakRows([consumer({ reason: 'RequirementUnreadable', requires: '' })], '5.1.0')[0].left).toBe('?');
		expect(breakRows([target({ requires: '' })], '5.1.0')[0].right).toBe('?');
	});
	it('rows keep the sentence form as their title: words as words, only versions as code', () => {
		const [r] = breakRows([consumer()], '5.1.0');
		expect(r.pieces).toEqual([{ lead: 'runs ', code: '3.2.0' }, { lead: 'needs ledger ', code: '^6.0.0' }, { code: '5.1.0', tail: ' does not satisfy' }]);
	});
});

describe('the skipped builds: drawn rows, the controller\'s sentence as their title', () => {
	it('the title lists up to 3 phrases per build, then "and N more"', () => {
		const breaks = ['a', 'b', 'c', 'd', 'e'].map((n) => consumer({ rollout: n }));
		expect(skippedLine({ skipped: [{ tag: 't', version: '5.1.0', breaks }] })).toBe('Skipped 5.1.0: a needs ledger ^6.0.0, b needs ledger ^6.0.0, c needs ledger ^6.0.0 and 2 more.');
	});
	it('every skipped build gets its own rows, newest first', () => {
		const s = (v: string) => ({ tag: v, version: v, breaks: [consumer()] });
		const rows = skippedBreakRows({ skipped: [s('5.3.0'), s('5.2.0')] });
		expect(rows.map((x) => x.build)).toEqual(['5.3.0', '5.2.0']);
		expect(rows[0].rows[0].right).toBe('5.3.0');
	});
	it('title phrases: target phrases begin "it", unreadable consumers are possessive', () => {
		expect(skippedLine({ skipped: [{ tag: 't', version: '5.1.0', breaks: [target()] }] })).toBe('Skipped 5.1.0: it needs ledger ^5.0.0 but ledger-books serves 6.0.0.');
		expect(skippedLine({ skipped: [{ tag: 't', version: '5.1.0', breaks: [consumer({ reason: 'RequirementUnreadable', requires: '' })] }] })).toBe("Skipped 5.1.0: checkout's running build has no readable requirements.");
	});
});

describe('the dialog warning: one sentence, the breaks drawn under it', () => {
	it('a target that cannot run names its provider', () => {
		expect(rollbackWarning('5.1.0', [target({ version: '' })])).toBe("5.1.0 can't run against its providers.");
	});
	it('a consumer break is counted; the rows name it and carry what it needs', () => {
		const w = rollbackWarningParts('5.1.0', [consumer()]);
		expect(w?.lead).toBe('5.1.0 would break 1 consumer.');
		expect(w?.rows.map((r) => r.name)).toEqual(['checkout']);
	});
});

describe('consumers the viewer cannot list', () => {
	it('adds them to the warning', () => {
		expect(rollbackWarning('5.1.0', [consumer()], 2)).toBe("5.1.0 would break 3 consumers, 2 you can't see.");
		expect(rollbackWarning('5.1.0', [consumer()], 1)).toBe("5.1.0 would break 2 consumers, 1 you can't see.");
	});
	it('warns on hidden consumers alone', () => {
		expect(rollbackWarning('5.1.0', [], 3)).toBe("5.1.0 would break 3 consumers, 3 you can't see.");
		expect(rollbackWarning('5.1.0', [], 0)).toBeNull();
	});
});

describe('the narrow toggle is a count, never a sentence', () => {
	it('services that would break, skipped builds', () => {
		expect(servicesBreakLabel(1)).toBe('1 service would break');
		expect(servicesBreakLabel(2)).toBe('2 services would break');
		expect(skippedBuildsLabel(1)).toBe('1 skipped build');
		expect(skippedBuildsLabel(3)).toBe('3 skipped builds');
	});
});
