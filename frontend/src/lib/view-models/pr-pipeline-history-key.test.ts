import { describe, expect, it } from 'vitest';
import { historyRowKey } from './pr-pipeline';

describe('historyRowKey', () => {
	const c = { cluster: 'dev', namespace: 'hello-multi-dev', rolloutName: 'hello-multi-app' };
	it('separates ids 25 and 26 (same second, same revision)', () => {
		expect(historyRowKey(c, { id: 25, index: 3 })).not.toBe(historyRowKey(c, { id: 26, index: 2 }));
	});
	it('separates the same id in two namespaces', () => {
		expect(historyRowKey(c, { id: 25, index: 3 })).not.toBe(historyRowKey({ ...c, namespace: 'hello-multi-prod' }, { id: 25, index: 3 }));
	});
	it('falls back to position', () => {
		expect(historyRowKey(c, { index: 1 })).not.toBe(historyRowKey(c, { index: 0 }));
	});
});
