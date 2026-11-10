import { describe, expect, it } from 'vitest';
import {
	APP_FIELD_CHROMA,
	APP_HUES,
	APP_INK_CHROMA,
	ENV_CLEARANCE,
	ENV_HUES,
	STATUS_CLEARANCE,
	STATUS_HUES,
	appIdentity,
	hueDistance,
	monogramOf
} from './app-identity';

describe('appIdentity', () => {
	it('is stable for a name', () => {
		expect(appIdentity('checkout-api')).toEqual(appIdentity('checkout-api'));
	});

	it('uses only the closed hue set', () => {
		for (const n of ['checkout-api', 'orders-api', 'edge-mesh', 'telemetry-indexer', 'hello-world', 'a', 'payments-core']) {
			expect(APP_HUES).toContain(appIdentity(n).hue as (typeof APP_HUES)[number]);
		}
	});

	it('spreads a real fleet over more than one hue', () => {
		const fleet = ['checkout-api', 'checkout-edge', 'checkout-worker', 'edge-mesh', 'hello-frontend-app', 'hello-world', 'orders-api', 'payments-core', 'recommender-svc', 'telemetry-collector', 'telemetry-forwarder', 'telemetry-indexer', 'telemetry-worker'];
		expect(new Set(fleet.map((n) => appIdentity(n).hue)).size).toBeGreaterThanOrEqual(3);
	});
});

describe('the hue rule', () => {
	const hues = APP_HUES.filter((h): h is NonNullable<typeof h> => h != null);
	it.each(hues.map((h) => [h]))('hue %i clears every status hue by >= STATUS_CLEARANCE (12°) and every env seed by >= ENV_CLEARANCE (9°)', (h) => {
		for (const r of Object.values(STATUS_HUES)) expect(hueDistance(h, r)).toBeGreaterThanOrEqual(STATUS_CLEARANCE);
		for (const r of Object.values(ENV_HUES)) expect(hueDistance(h, r)).toBeGreaterThanOrEqual(ENV_CLEARANCE);
	});
	it('has eight hues, no neutral identity (r39)', () => {
		expect(APP_HUES).toHaveLength(8);
		expect(APP_HUES).not.toContain(null);
	});
	it('stays below status saturation', () => {
		// Every status solid is C >= 0.15 (language.css); identity never reaches it.
		expect(Math.max(APP_INK_CHROMA.light, APP_INK_CHROMA.dark)).toBeLessThanOrEqual(0.1);
		expect(Math.max(APP_FIELD_CHROMA.light, APP_FIELD_CHROMA.dark)).toBeLessThanOrEqual(0.045);
	});
	it('measures hue distance on the circle', () => {
		expect(hueDistance(5, 355)).toBe(10);
		expect(hueDistance(344, 25)).toBe(41);
	});
});

describe('monogramOf', () => {
	it.each([
		['checkout-api', 'CA'],
		['orders', 'OR'],
		['hello-frontend-app', 'HF'],
		['telemetry_indexer', 'TI'],
		['x', 'X'],
		['---', '?']
	])('%s → %s', (name, mono) => expect(monogramOf(name)).toBe(mono));
});
