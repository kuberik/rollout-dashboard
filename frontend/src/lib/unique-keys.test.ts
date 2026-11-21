import { describe, expect, it } from 'vitest';
import { historyEntryKey, uniqueKeyed } from './unique-keys';

describe('uniqueKeyed', () => {
	it('suffixes repeated keys and keeps the first', () => {
		const out = uniqueKeyed([{ key: 'a' }, { key: 'b' }, { key: 'a' }, { key: 'a' }]);
		expect(out.map((x) => x.key)).toEqual(['a', 'b', 'a#2', 'a#3']);
	});
	it('returns the same array when nothing repeats', () => {
		const items = [{ key: 'a' }, { key: 'b' }];
		expect(uniqueKeyed(items)).toBe(items);
	});
});

describe('historyEntryKey', () => {
	const r = { cluster: 'dev', namespace: 'hello-multi-dev', name: 'hello-multi-app' };
	it('separates entries 25 and 26 that share a second', () => {
		expect(historyEntryKey(r, { id: 25 }, 3)).not.toBe(historyEntryKey(r, { id: 26 }, 2));
	});
	it('separates the same id in two rollouts', () => {
		expect(historyEntryKey(r, { id: 25 }, 0)).not.toBe(historyEntryKey({ ...r, namespace: 'hello-multi-prod' }, { id: 25 }, 0));
	});
	it('falls back to position without an id', () => {
		expect(historyEntryKey(r, {}, 1)).not.toBe(historyEntryKey(r, {}, 2));
	});
});
