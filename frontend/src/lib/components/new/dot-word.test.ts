import { describe, it, expect } from 'vitest';
import { dotWord } from './envs-model';

describe('a dot title says failed for a recovered failure, failing while a check fails now', () => {
	it('failed mark', () => {
		expect(dotWord('failed', false, 'Failing')).toBe('Failing');
		expect(dotWord('failed', true, 'Failing')).toBe('Failed');
	});
	it('other marks keep their own word, recovered or not', () => expect(dotWord('held', true, 'Held')).toBe('Held'));
});
