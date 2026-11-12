import { describe, it, expect } from 'vitest';
import { displayIdentity, approversWords } from './approval-identity';
import { approvalWrite, approvalUnwrite } from './approval-write';
import { historyApprovalFact, approvalReplacesActor } from './history-approval';

describe('displayIdentity (CONTRACT D6)', () => {
	it('drops everything up to and including the first colon', () => {
		expect(displayIdentity('oidc:luka')).toBe('luka');
		expect(displayIdentity('a:b:c')).toBe('b:c');
	});
	it('a name without a colon is unchanged', () => expect(displayIdentity('luka')).toBe('luka'));
	it('names the approvers of a standing approval: by when present, else the RolloutApproval name', () => {
		expect(approversWords([{ name: 'x-v1', by: 'oidc:wyatt' }, { name: 'x-v1-git' }])).toBe('wyatt, x-v1-git');
	});
});

describe('approvalUnwrite is the inverse of approvalWrite', () => {
	it('removes only that tag', () => {
		expect(approvalUnwrite(approvalWrite(['a', 'b'], 'c'), 'c')).toEqual(['a', 'b']);
		expect(approvalUnwrite(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
		expect(approvalUnwrite(['a'], 'zzz')).toEqual(['a']);
	});
});

describe('the history row\'s approved-by fact', () => {
	it('verified: "approved by wyatt", the tooltip leads with the display name and keeps the identity', () => {
		expect(historyApprovalFact({ name: 'app-v1', by: 'oidc:wyatt' }, true)).toEqual({ text: 'approved by wyatt', title: 'Approved by wyatt (oidc:wyatt)' });
		expect(historyApprovalFact({ name: 'app-v1', by: 'wyatt' }, true)?.title).toBe('Approved by wyatt');
	});
	it('no verified `by` (git, kubectl, unverified): a bare "Approved", the object name only in the tooltip', () => {
		const f = historyApprovalFact({ name: 'hello-world-e4f5a6b' }, true)!;
		expect(f.text).toBe('Approved');
		expect(f.title).toBe('Approved by RolloutApproval hello-world-e4f5a6b (no verified approver)');
		expect(f.text).not.toMatch(/git|hello-world/);
	});
	it('hides `by` when the cluster does not verify it', () => {
		const f = historyApprovalFact({ name: 'app-v1', by: 'oidc:wyatt' }, false)!;
		expect(f.text).toBe('Approved');
		expect(f.text + f.title).not.toMatch(/wyatt/);
	});
	it('an approval replaces the Automatic actor, never a person', () => {
		const f = historyApprovalFact({ name: 'a' }, true);
		expect(approvalReplacesActor(f, 'controller')).toBe(true);
		expect(approvalReplacesActor(f, 'person')).toBe(false);
		expect(approvalReplacesActor(null, 'controller')).toBe(false);
	});
	it('no approval, no fact', () => expect(historyApprovalFact(undefined, true)).toBeNull());
});
