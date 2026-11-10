import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import {
	stars,
	isStarred,
	toggleStar,
	reloadStars,
	parseStars,
	syncStarsFromStorage,
	STARS_KEY
} from './stars.svelte';

beforeEach(() => {
	localStorage.clear();
	reloadStars();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** What another tab's write looks like from this one: storage changed, then the event. */
function writeFromOtherTab(value: string | null, key: string | null = STARS_KEY) {
	if (key === null) localStorage.clear();
	else if (value === null) localStorage.removeItem(key);
	else localStorage.setItem(key, value);
	window.dispatchEvent(
		new StorageEvent('storage', { key, newValue: value, storageArea: localStorage })
	);
}

describe('stars store', () => {
	it('is reactive: a $derived over stars.apps re-runs on a toggle', () => {
		const seen: boolean[] = [];
		const cleanup = $effect.root(() => {
			$effect(() => {
				seen.push(isStarred('orders-api'));
			});
		});
		flushSync();
		toggleStar('orders-api');
		flushSync();
		cleanup();
		expect(seen).toEqual([false, true]);
	});

	it('starts empty: no demo defaults', () => {
		expect(stars.apps.size).toBe(0);
		expect(isStarred('checkout-api')).toBe(false);
		expect(localStorage.getItem(STARS_KEY)).toBeNull();
	});

	it('reads kuberik.home.starred as a JSON string array', () => {
		expect(STARS_KEY).toBe('kuberik.home.starred');
		localStorage.setItem(STARS_KEY, JSON.stringify(['checkout-api', 'hello-frontend-app']));
		reloadStars();
		expect([...stars.apps].sort()).toEqual(['checkout-api', 'hello-frontend-app']);
		expect(isStarred('checkout-api')).toBe(true);
	});

	it('toggles and persists, sorted', () => {
		expect(toggleStar('billing-api')).toBe(true);
		expect(isStarred('billing-api')).toBe(true);
		expect(JSON.parse(localStorage.getItem(STARS_KEY)!)).toEqual(['billing-api']);
		toggleStar('api-gateway');
		expect(JSON.parse(localStorage.getItem(STARS_KEY)!)).toEqual(['api-gateway', 'billing-api']);
		expect(toggleStar('billing-api')).toBe(false);
		expect(isStarred('billing-api')).toBe(false);
		expect(JSON.parse(localStorage.getItem(STARS_KEY)!)).toEqual(['api-gateway']);
	});

	it('toggleStar(app, on) forces the state and is idempotent', () => {
		expect(toggleStar('x', true)).toBe(true);
		expect(toggleStar('x', true)).toBe(true);
		expect([...stars.apps]).toEqual(['x']);
		expect(toggleStar('x', false)).toBe(false);
		expect(toggleStar('x', false)).toBe(false);
		expect(stars.apps.size).toBe(0);
	});

	it('reads a corrupt or wrong-shaped value as nothing starred', () => {
		localStorage.setItem(STARS_KEY, '{not json');
		reloadStars();
		expect(stars.apps.size).toBe(0);
		expect(parseStars('{"a":1}')).toEqual([]);
		expect(parseStars('"a"')).toEqual([]);
		expect(parseStars('["a", 2, "a", null, ""]')).toEqual(['a']);
		expect(parseStars(null)).toEqual([]);
		expect(parseStars(undefined)).toEqual([]);
		expect(parseStars('')).toEqual([]);
	});

	it('survives storage that throws on read and on write', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('SecurityError');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		expect(() => reloadStars()).not.toThrow();
		expect(stars.apps.size).toBe(0);
		// the star still holds for this page view
		expect(toggleStar('orders-api')).toBe(true);
		expect(isStarred('orders-api')).toBe(true);
	});
});

describe('stars store: other tabs', () => {
	it("takes another tab's write of the key (the module listens for `storage`)", () => {
		writeFromOtherTab(JSON.stringify(['orders-api']));
		expect(isStarred('orders-api')).toBe(true);
		writeFromOtherTab(JSON.stringify([]));
		expect(isStarred('orders-api')).toBe(false);
	});

	it('takes a removal and a clear()', () => {
		toggleStar('a');
		writeFromOtherTab(null);
		expect(isStarred('a')).toBe(false);
		toggleStar('b');
		writeFromOtherTab(null, null);
		expect(isStarred('b')).toBe(false);
	});

	it('ignores other keys', () => {
		toggleStar('a');
		localStorage.setItem('kuberik.theme', 'dark');
		// a stale value under our key that the event must NOT pull in
		localStorage.setItem(STARS_KEY, JSON.stringify(['zzz']));
		syncStarsFromStorage(
			new StorageEvent('storage', { key: 'kuberik.theme', storageArea: localStorage })
		);
		expect([...stars.apps]).toEqual(['a']);
	});

	it('re-runs a reader only when its own app changed', () => {
		toggleStar('a');
		let runs = 0;
		const cleanup = $effect.root(() => {
			$effect(() => {
				isStarred('a');
				runs++;
			});
		});
		flushSync();
		writeFromOtherTab(JSON.stringify(['a', 'b']));
		flushSync();
		expect(isStarred('b')).toBe(true);
		writeFromOtherTab(JSON.stringify(['b']));
		flushSync();
		cleanup();
		expect(runs).toBe(2);
	});
});
