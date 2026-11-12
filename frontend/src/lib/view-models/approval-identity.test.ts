import { describe, it, expect } from 'vitest';
import { displayIdentity, approversWords } from './approval-identity';
import { approvalWrite, approvalUnwrite } from './approval-write';
import { historyApprovalFact } from './history-approval';

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
	it('shows who approved when `by` is present and the cluster verifies it; the full name is the title', () => {
		expect(historyApprovalFact({ name: 'app-v1', by: 'oidc:wyatt' }, true)).toEqual({ text: 'approved by wyatt', title: 'Approved by oidc:wyatt' });
	});
	it('falls back to the approval name when `by` is absent (a git approval)', () => {
		expect(historyApprovalFact({ name: 'app-v1' }, true)?.text).toBe('approval app-v1');
	});
	it('hides `by` when the cluster does not verify it', () => {
		const f = historyApprovalFact({ name: 'app-v1', by: 'oidc:wyatt' }, false)!;
		expect(f.text).toBe('approval app-v1');
		expect(f.text + f.title).not.toMatch(/wyatt/);
	});
	it('no approval, no fact', () => expect(historyApprovalFact(undefined, true)).toBeNull());
});
