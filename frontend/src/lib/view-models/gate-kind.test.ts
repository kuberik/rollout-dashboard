import { describe, it, expect } from 'vitest';
import { gateKindOf } from './gate-kind';

describe('gateKindOf', () => {
	it('reads the backend kind', () => {
		for (const k of ['approval', 'schedule', 'dependency', 'promotion'] as const) expect(gateKindOf({ kind: k })).toBe(k);
	});
	it('an older backend (no kind), a novel kind, or no gate is unknown, and the name is never read', () => {
		expect(gateKindOf({})).toBe('unknown');
		expect(gateKindOf({ kind: 'something-new' })).toBe('unknown');
		expect(gateKindOf(null)).toBe('unknown');
		expect(gateKindOf({ name: 'release-approval' } as { kind?: string })).toBe('unknown');
	});
});
