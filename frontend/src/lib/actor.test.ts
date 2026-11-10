import { describe, expect, it } from 'vitest';
import { actorFrom, CONTROLLER_NAME } from './actor';

describe('actorFrom', () => {
	it('maps the controller (System or nothing) to the kuberik mark, never "System"', () => {
		expect(actorFrom({ kind: 'System', name: 'System' })).toEqual({ kind: 'controller', name: CONTROLLER_NAME });
		expect(actorFrom(undefined)).toEqual({ kind: 'controller', name: CONTROLLER_NAME });
		expect(actorFrom({ kind: 'User', name: '' })).toEqual({ kind: 'controller', name: CONTROLLER_NAME });
	});
	it('maps a person, with a picture only when given one', () => {
		expect(actorFrom({ kind: 'User', name: 'alice' })).toEqual({ kind: 'person', name: 'alice' });
		expect(actorFrom({ kind: 'User', name: 'alice' }, 'data:image/png;base64,x')).toEqual({
			kind: 'person',
			name: 'alice',
			src: 'data:image/png;base64,x'
		});
	});
	it('maps automation accounts to ci', () => {
		for (const name of ['github-actions[bot]', 'dependabot', 'renovate-bot', 'release-ci']) {
			expect(actorFrom({ kind: 'User', name }).kind).toBe('ci');
		}
	});
	it('spreads straight onto Avatar props', () => {
		const { kind, name } = actorFrom({ kind: 'User', name: 'bob' });
		expect({ kind, name }).toEqual({ kind: 'person', name: 'bob' });
	});
});
