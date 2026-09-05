import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
	scrollMemoryKey,
	saveScrollPosition,
	getScrollPosition,
	clearScrollMemoryForTest
} from './scroll-memory';

describe('scrollMemoryKey', () => {
	test('is pathname + search', () => {
		expect(scrollMemoryKey(new URL('https://x.test/revisions?tab=history'))).toBe(
			'/revisions?tab=history'
		);
	});

	test('drops the hash', () => {
		expect(scrollMemoryKey(new URL('https://x.test/rollouts#foo'))).toBe('/rollouts');
	});

	test('a bare path has no trailing search', () => {
		expect(scrollMemoryKey(new URL('https://x.test/rollouts'))).toBe('/rollouts');
	});
});

describe('save/get round trip', () => {
	beforeEach(() => {
		clearScrollMemoryForTest();
	});

	test('getScrollPosition is undefined before anything is saved', () => {
		expect(getScrollPosition('/revisions')).toBeUndefined();
	});

	test('saveScrollPosition then getScrollPosition round-trips the offset', () => {
		saveScrollPosition('/revisions', 900);
		expect(getScrollPosition('/revisions')).toBe(900);
	});

	test('different keys do not collide', () => {
		saveScrollPosition('/revisions', 900);
		saveScrollPosition('/rollouts', 240);
		expect(getScrollPosition('/revisions')).toBe(900);
		expect(getScrollPosition('/rollouts')).toBe(240);
	});

	test('a later save for the same key overwrites the earlier one', () => {
		saveScrollPosition('/revisions', 900);
		saveScrollPosition('/revisions', 0);
		expect(getScrollPosition('/revisions')).toBe(0);
	});
});

describe('cap at ~50 entries, oldest-touched evicted first', () => {
	beforeEach(() => {
		clearScrollMemoryForTest();
	});

	test('the 51st distinct key evicts the least-recently-touched one', () => {
		for (let i = 0; i < 50; i++) {
			saveScrollPosition(`/route-${i}`, i);
		}
		expect(getScrollPosition('/route-0')).toBe(0);
		saveScrollPosition('/route-50', 50);
		expect(getScrollPosition('/route-0')).toBeUndefined();
		expect(getScrollPosition('/route-1')).toBe(1);
		expect(getScrollPosition('/route-50')).toBe(50);
	});

	test('re-saving an existing key refreshes its recency and protects it from eviction', () => {
		for (let i = 0; i < 50; i++) {
			saveScrollPosition(`/route-${i}`, i);
		}
		// Touch route-0 again so route-1 becomes the oldest instead.
		saveScrollPosition('/route-0', 999);
		saveScrollPosition('/route-50', 50);
		expect(getScrollPosition('/route-0')).toBe(999);
		expect(getScrollPosition('/route-1')).toBeUndefined();
	});
});

describe('sessionStorage backing survives a simulated reload', () => {
	beforeEach(() => {
		sessionStorage.clear();
		vi.resetModules();
	});

	test('a value saved before "reload" is readable after re-importing the module', async () => {
		const mod = await import('./scroll-memory');
		mod.saveScrollPosition('/revisions', 900);

		// Simulate a plain browser reload: the module is re-evaluated from
		// scratch, so only sessionStorage (not the in-memory Map) can carry the
		// value across. sessionStorage itself is untouched by resetModules.
		vi.resetModules();
		const reloaded = await import('./scroll-memory');
		expect(reloaded.getScrollPosition('/revisions')).toBe(900);
	});

	test('a corrupted sessionStorage entry is ignored, not thrown', async () => {
		sessionStorage.setItem('kuberik.scroll-memory.v1', '{not json');
		const mod = await import('./scroll-memory');
		expect(mod.getScrollPosition('/revisions')).toBeUndefined();
	});

	test('a foreign-shaped sessionStorage entry is ignored', async () => {
		sessionStorage.setItem('kuberik.scroll-memory.v1', JSON.stringify({ not: 'an array' }));
		const mod = await import('./scroll-memory');
		expect(mod.getScrollPosition('/revisions')).toBeUndefined();
	});
});
