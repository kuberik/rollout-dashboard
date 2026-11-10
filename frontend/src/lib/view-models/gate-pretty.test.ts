import { it, expect } from 'vitest';
import { prettyMapOf } from './gate-pretty';
import { gateDisplayName } from './gate-name';

it('round 2 B4: the Holding card name is the Gates tab name (published pretty name wins; a generated id is never prettified)', () => {
	const m = prettyMapOf({ items: [{ metadata: { name: 'hello-world-manual-approval', annotations: { 'gate.kuberik.com/pretty-name': 'Manual Approval Required' } } }, { metadata: { name: 'ghd-4bntr' } }] });
	expect(gateDisplayName('hello-world-manual-approval', m.get('hello-world-manual-approval'))).toBe('Manual Approval Required');
	expect(gateDisplayName('ghd-4bntr', m.get('ghd-4bntr'))).toBe('Gate');
	expect(gateDisplayName('hello-world-manual-approval', null)).toBe('Hello world manual approval');
});
