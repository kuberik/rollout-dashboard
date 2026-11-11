import { describe, expect, it } from 'vitest';
import { pinSince } from './pin-hold';

const ev = (timestamp: string, message: string, tag: string) => ({ timestamp, message, version: { tag } });
const at = (...history: ReturnType<typeof ev>[]) => ({ status: { history } }) as never;

describe('pinSince never prints a wrong age', () => {
	const rollback = ev('2026-11-01T10:00:00Z', 'Rolled back to 4.40', '4.40');
	const cleared = [ev('2026-11-02T10:00:00Z', 'Deployed', '4.41'), ev('2026-11-03T10:00:00Z', 'Deployed', '4.42')];
	it('rollback, pin cleared, newer deploys, no re-pin (kubectl): null, not the stale rollback time', () => {
		expect(pinSince(at(...cleared.slice().reverse(), rollback))).toBeNull();
	});
	it('then re-pinned from the dashboard: the re-pin time wins over the stale rollback', () => {
		const repin = ev('2026-11-04T10:00:00Z', 'Pinned to version 4.42', '4.42');
		expect(pinSince(at(repin, ...cleared.slice().reverse(), rollback))).toBe('2026-11-04T10:00:00Z');
	});
	it('a redeploy of the pinned version after the pin does not invalidate it', () => {
		expect(pinSince(at(ev('2026-11-01T11:00:00Z', 'Deployed', '4.40'), rollback))).toBe('2026-11-01T10:00:00Z');
	});
	it('a rollback with nothing after it keeps its time', () => {
		expect(pinSince(at(rollback, ev('2026-10-30T10:00:00Z', 'Deployed', '4.43')))).toBe('2026-11-01T10:00:00Z');
	});
});
