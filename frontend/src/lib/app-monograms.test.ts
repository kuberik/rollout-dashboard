import { describe, it, expect } from 'vitest';
import { monogramsFor, monogramOf } from './app-identity';

const fleet = ['hello-world-app', 'hello-world-manifests', 'hello-second-app', 'hello-second-manifests', 'checkout-api', 'orders'];
describe('monogramsFor (QA2 #11): distinct marks inside one fleet', () => {
	it('apps sharing a default monogram are told apart by the part that differs', () => {
		const m = monogramsFor(fleet);
		expect(m.get('hello-world-app')).toBe('WA');
		expect(m.get('hello-world-manifests')).toBe('WM');
		expect(m.get('hello-second-app')).toBe('SA');
		expect(m.get('hello-second-manifests')).toBe('SM');
		expect(new Set(m.values()).size).toBe(m.size);
	});
	it('unique names keep the default', () => {
		const m = monogramsFor(fleet);
		expect(m.get('checkout-api')).toBe(monogramOf('checkout-api'));
		expect(m.get('orders')).toBe('OR');
	});
	it('does not depend on order', () => {
		const a = monogramsFor(fleet), b = monogramsFor([...fleet].reverse());
		for (const n of fleet) expect(a.get(n)).toBe(b.get(n));
	});
	it('no common token: still distinct', () => {
		const m = monogramsFor(['checkout-api', 'cart-app']);
		expect(m.get('checkout-api')).not.toBe(m.get('cart-app'));
	});
});

import { publishFleetAppNames, expectFleetAppNames, monogramFor } from './components/app-monogram.svelte';
describe('one fleet-wide map (QA2 #11)', () => {
	it('before the fleet names are known there are no letters; after, the final ones (never a default that then changes)', () => {
		expectFleetAppNames();
		expect(monogramFor('hello-world-app')).toBeNull();
		publishFleetAppNames(fleet);
		expect(monogramFor('hello-world-app')).toBe('WA');
		expect(monogramFor('hello-world-manifests')).toBe('WM');
	});
});
