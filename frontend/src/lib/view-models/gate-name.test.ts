import { describe, it, expect } from 'vitest';
import { resolveGateName, prettyNameOf } from './gate-name';
import { gateDisplayName } from './rollout-gates';

describe('one gate name (QA #17 review)', () => {
	const objs = [{ metadata: { name: 'hello-world-manual-approval', annotations: { 'gate.kuberik.com/pretty-name': 'Manual Approval Required' } } }];
	it('the dialog resolver and the Gates tab title agree: the published pretty name wins', () => {
		expect(resolveGateName('hello-world-manual-approval', objs)).toBe('Manual Approval Required');
		expect(gateDisplayName('hello-world-manual-approval', prettyNameOf(objs[0].metadata))).toBe('Manual Approval Required');
	});
	it('without an object it falls back identically to the tab', () => {
		expect(resolveGateName('hello-world-manual-approval')).toBe(gateDisplayName('hello-world-manual-approval'));
		expect(resolveGateName('ghd-6p5hd', [])).toBe('Gate');
	});
});
