import { describe, it, expect } from 'vitest';
import { deployReason, isManualDeploy } from './activity-note';

describe('deployReason (QA #14)', () => {
	it('shows a person-typed override reason, markdown stripped', () => {
		expect(deployReason('QA live test: approval gate has no backend')).toBe('QA live test: approval gate has no backend');
		expect(deployReason('*hotfix* for **prod**')).toBe('hotfix for prod');
	});
	it('hides the controller boilerplate and dashboard defaults', () => {
		expect(deployReason('Automatic deployment')).toBeNull();
		expect(deployReason('*Automatic deployment*')).toBeNull();
		expect(deployReason('Force deploy version 1.2.3')).toBeNull();
		expect(deployReason('Pinned version')).toBeNull();
		expect(deployReason(null)).toBeNull();
	});
	it('only a person is manual', () => {
		expect(isManualDeploy('person')).toBe(true);
		expect(isManualDeploy('controller')).toBe(false);
		expect(isManualDeploy('ci')).toBe(false);
	});
});

import { deployMark } from './activity-note';
describe('deployMark: every person-pressed deploy reads manual (owner 2026-11-09: no override mark)', () => {
	it('automatic deploys carry no mark', () => expect(deployMark({ actorKind: 'controller' })).toBeNull());
	it('a plain manual deploy reads manual', () => expect(deployMark({ actorKind: 'person' })).toBe('manual'));
	it('a manual deploy with a bypass-gates annotation or gate flag renders exactly like any manual deploy', () => {
		const withBypass = { actorKind: 'person', message: 'approved by ops', isCurrent: true, gates: [{ bypassGates: true }] } as unknown as Parameters<typeof deployMark>[0];
		expect(deployMark(withBypass)).toBe('manual');
		expect(deployMark(withBypass)).toBe(deployMark({ actorKind: 'person' }));
	});
});
