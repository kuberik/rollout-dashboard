import { describe, test, expect, beforeEach } from 'vitest';
import { rememberShape, recallShape } from './skeleton-hints';

describe('skeleton-hints: round trip', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	test('recallShape is null before anything is remembered', () => {
		expect(recallShape('home')).toBeNull();
	});

	test('rememberShape then recallShape round-trips numbers, booleans and strings', () => {
		rememberShape('home', { held: 2, steady: 4, showRail: true, note: 'x' });
		expect(recallShape('home')).toEqual({ held: 2, steady: 4, showRail: true, note: 'x' });
	});

	test('different keys do not collide', () => {
		rememberShape('home', { held: 1 });
		rememberShape('rollouts', { groups: 3 });
		expect(recallShape('home')).toEqual({ held: 1 });
		expect(recallShape('rollouts')).toEqual({ groups: 3 });
	});

	test('a later rememberShape call overwrites the earlier one for the same key', () => {
		rememberShape('activity', { dayGroups: 3 });
		rememberShape('activity', { dayGroups: 7 });
		expect(recallShape('activity')).toEqual({ dayGroups: 7 });
	});

	test('is namespaced/versioned under a kuberik-prefixed localStorage key', () => {
		rememberShape('home', { held: 1 });
		const keys = Object.keys(localStorage);
		expect(keys.some((k) => k.startsWith('kuberik.skeleton-shape.v1.') && k.endsWith('home'))).toBe(
			true
		);
	});
});

describe('skeleton-hints: corrupted or foreign values never throw and never leak', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	test('non-JSON value recalls as null', () => {
		localStorage.setItem('kuberik.skeleton-shape.v1.home', 'not json{');
		expect(recallShape('home')).toBeNull();
	});

	test('a JSON array recalls as null (must be an object)', () => {
		localStorage.setItem('kuberik.skeleton-shape.v1.home', JSON.stringify([1, 2, 3]));
		expect(recallShape('home')).toBeNull();
	});

	test('a JSON primitive recalls as null', () => {
		localStorage.setItem('kuberik.skeleton-shape.v1.home', JSON.stringify(42));
		expect(recallShape('home')).toBeNull();
	});

	test('an object holding a nested object value recalls as null (not a flat shape)', () => {
		localStorage.setItem(
			'kuberik.skeleton-shape.v1.home',
			JSON.stringify({ held: 2, nested: { a: 1 } })
		);
		expect(recallShape('home')).toBeNull();
	});

	test('null does not throw and never round-trips a null value', () => {
		localStorage.setItem('kuberik.skeleton-shape.v1.home', JSON.stringify(null));
		expect(recallShape('home')).toBeNull();
	});
});

describe('skeleton-hints: SSR guard', () => {
	test('rememberShape and recallShape are no-ops without a localStorage global', () => {
		const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		// Simulate SSR: no `localStorage` global at all.
		// @ts-expect-error - deliberately deleting a browser global for the test
		delete globalThis.localStorage;
		try {
			expect(() => rememberShape('home', { held: 1 })).not.toThrow();
			expect(recallShape('home')).toBeNull();
		} finally {
			if (original) Object.defineProperty(globalThis, 'localStorage', original);
		}
	});
});
